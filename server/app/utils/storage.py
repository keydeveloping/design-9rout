import io
import mimetypes
import os
from functools import lru_cache
from urllib.parse import quote, unquote

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").strip().lower()
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "").strip()
S3_ACCESS_KEY_ID = os.getenv("S3_ACCESS_KEY_ID", "").strip()
S3_SECRET_ACCESS_KEY = os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
S3_BUCKET = os.getenv("S3_BUCKET", "keyworkflow").strip()
S3_REGION = os.getenv("S3_REGION", "us-east-1").strip()
S3_FORCE_PATH_STYLE = os.getenv("S3_FORCE_PATH_STYLE", "true").strip().lower() in {"1", "true", "yes", "on"}
S3_CREATE_BUCKET = os.getenv("S3_CREATE_BUCKET", "true").strip().lower() in {"1", "true", "yes", "on"}
S3_PRESIGNED_EXPIRES_SECONDS = int(os.getenv("S3_PRESIGNED_EXPIRES_SECONDS", "604800") or "604800")
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").strip().rstrip("/")


def is_object_storage_enabled() -> bool:
    return STORAGE_BACKEND in {"minio", "s3"}


def quote_key(key: str) -> str:
    return "/".join(quote(part) for part in key.split("/"))


def stable_object_url(key: str) -> str:
    return f"{PUBLIC_BASE_URL}/api/app/object/{quote_key(validate_object_key(key))}"


def object_key_from_stable_url(url: str) -> str | None:
    prefix = f"{PUBLIC_BASE_URL}/api/app/object/"
    if not url.startswith(prefix):
        return None
    return validate_object_key(unquote(url[len(prefix):]))


def validate_object_key(key: str | None) -> str:
    normalized = (key or "").strip().lstrip("/")
    if not normalized or ".." in normalized or "\\" in normalized:
        raise HTTPException(status_code=400, detail="Invalid object key")
    return normalized


def guess_content_type(suffix: str, content_type: str | None = None) -> str:
    if content_type:
        return content_type
    return mimetypes.types_map.get(suffix.lower(), "application/octet-stream")


@lru_cache(maxsize=1)
def s3_client():
    if not is_object_storage_enabled():
        return None
    if not S3_ENDPOINT_URL:
        raise HTTPException(status_code=500, detail="S3_ENDPOINT_URL is required when STORAGE_BACKEND=minio")
    if not S3_ACCESS_KEY_ID or not S3_SECRET_ACCESS_KEY:
        raise HTTPException(status_code=500, detail="S3 credentials are required when STORAGE_BACKEND=minio")
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT_URL,
        aws_access_key_id=S3_ACCESS_KEY_ID,
        aws_secret_access_key=S3_SECRET_ACCESS_KEY,
        region_name=S3_REGION,
        config=Config(s3={"addressing_style": "path" if S3_FORCE_PATH_STYLE else "auto"}),
    )


@lru_cache(maxsize=1)
def ensure_bucket() -> bool:
    client = s3_client()
    if client is None:
        return True
    try:
        client.head_bucket(Bucket=S3_BUCKET)
        return True
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        if not S3_CREATE_BUCKET or error_code not in {"404", "NoSuchBucket", "NotFound"}:
            raise HTTPException(status_code=500, detail=f"S3 bucket unavailable: {S3_BUCKET}") from exc
    try:
        client.create_bucket(Bucket=S3_BUCKET)
        return True
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create S3 bucket: {S3_BUCKET}") from exc


async def upload_object_bytes(content: bytes, key: str, suffix: str, content_type: str | None = None) -> str:
    client = s3_client()
    if client is None:
        raise HTTPException(status_code=500, detail="Object storage is not enabled")
    safe_key = validate_object_key(key)
    ensure_bucket()
    try:
        client.upload_fileobj(
            io.BytesIO(content),
            S3_BUCKET,
            safe_key,
            ExtraArgs={"ContentType": guess_content_type(suffix, content_type)},
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail="Failed to upload file to object storage") from exc
    return stable_object_url(safe_key)


def get_signed_object_download_url(key_or_url: str, expires_seconds: int | None = None) -> str:
    client = s3_client()
    if client is None:
        raise HTTPException(status_code=500, detail="Object storage is not enabled")
    key = object_key_from_stable_url(key_or_url) or validate_object_key(key_or_url)
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": S3_BUCKET, "Key": key},
            ExpiresIn=expires_seconds or S3_PRESIGNED_EXPIRES_SECONDS,
        )
    except (BotoCoreError, ClientError) as exc:
        raise HTTPException(status_code=500, detail="Failed to generate signed object URL") from exc

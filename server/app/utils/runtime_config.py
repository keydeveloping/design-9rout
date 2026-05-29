from dataclasses import dataclass
from urllib.parse import urlparse

from fastapi import HTTPException, Request

ROUTER_URL_HEADER = "X-KeyWorkflow-Router-URL"
ROUTER_KEY_HEADER = "X-KeyWorkflow-Router-Key"

RUNTIME_SETTINGS_REQUIRED = {
    "code": "runtime_settings_required",
    "message": "9router Base URL and API key are required. Open Settings to continue.",
}


@dataclass(frozen=True)
class RuntimeConfig:
    base_url: str
    api_key: str


def validate_router_base_url(base_url: str) -> str:
    value = (base_url or "").strip().rstrip("/")
    if not value:
        raise HTTPException(status_code=400, detail=RUNTIME_SETTINGS_REQUIRED)

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400,
            detail="9router Base URL must use http or https.",
        )
    if not parsed.hostname:
        raise HTTPException(
            status_code=400,
            detail="9router Base URL must include a hostname.",
        )
    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=400,
            detail="9router Base URL must not include username or password.",
        )
    if parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=400,
            detail="9router Base URL must not include query string or fragment.",
        )
    return value


def runtime_config_from_request(request: Request) -> RuntimeConfig:
    base_url = (request.headers.get(ROUTER_URL_HEADER) or "").strip()
    api_key = (request.headers.get(ROUTER_KEY_HEADER) or "").strip()
    if not base_url or not api_key:
        raise HTTPException(status_code=400, detail=RUNTIME_SETTINGS_REQUIRED)
    return RuntimeConfig(
        base_url=validate_router_base_url(base_url),
        api_key=api_key,
    )

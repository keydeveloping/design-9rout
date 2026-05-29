import asyncio
import base64
import copy
import ipaddress
import json
import hashlib
import logging
import mimetypes
import os
import re
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from app.utils.runtime_config import RuntimeConfig
from app.utils.storage import (
    guess_content_type,
    is_object_storage_enabled,
    upload_object_bytes,
)

BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
GENERATED_DIR = DATA_DIR / "generated"
UPLOADS_DIR = GENERATED_DIR / "uploads"
TTS_DIR = GENERATED_DIR / "tts"
IMAGES_DIR = GENERATED_DIR / "images"
WORKFLOWS_FILE = DATA_DIR / "workflows.json"
RUNS_FILE = DATA_DIR / "runs.json"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "http://127.0.0.1:8000").rstrip("/")
ALLOW_LOCAL_REFERENCE_IMAGES_ENV = (
    os.getenv("ALLOW_LOCAL_REFERENCE_IMAGES", "").strip().lower()
    in {"1", "true", "yes", "on"}
)
MODEL_CACHE_TTL_SECONDS = 300
DEFAULT_PROMPT_LLM_MODEL = os.getenv("PROMPT_LLM_MODEL", "openai/gpt-4o").strip() or "openai/gpt-4o"

IMAGE_FIELD_OVERRIDES = {
    "size": {
        "label": "Size",
        "enum": [
            "auto",
            "1024x1024",
            "1024x768",
            "1920x1088",
            "1920x1200",
            "1536x1024",
            "1024x1536",
            "1360x1088",
            "1088x1920",
            "2560x1088",
        ],
        "enum_labels": {
            "auto": "Auto",
            "1024x1024": "1:1 — Square (1024×1024)",
            "1024x768": "4:3 — Standard (1024×768)",
            "1920x1088": "16:9 — Widescreen (1920×1088)",
            "1920x1200": "16:10 — Wide (1920×1200)",
            "1536x1024": "3:2 — Photo (1536×1024)",
            "1024x1536": "2:3 — Portrait (1024×1536)",
            "1360x1088": "5:4 — Social Portrait (1360x1088)",
            "1088x1920": "9:16 — Story (1088×1920)",
            "2560x1088": "21:9 — Ultrawide (2560×1088)",
        },
        "default": "auto",
    },
    "quality": {
        "label": "Quality",
        "enum": ["auto", "standard", "hd"],
        "default": "auto",
    },
    "background": {
        "label": "Background",
        "enum": ["auto", "transparent", "opaque"],
        "default": "auto",
    },
    "image_detail": {
        "label": "Image Detail",
        "enum": ["auto", "low", "high", "original"],
        "default": "original",
    },
    "output_format": {
        "label": "Output Format",
        "enum": ["png", "jpeg", "webp"],
        "default": "png",
    },
    "response_format": {
        "label": "Response Format",
        "enum": ["url", "b64_json"],
        "default": "url",
    },
}

_MODEL_CACHE: dict[str, dict[str, Any]] = {}


def runtime_cache_key(runtime: RuntimeConfig) -> str:
    key_hash = hashlib.sha256(runtime.api_key.encode("utf-8")).hexdigest()[:16]
    return f"{runtime.base_url}|{key_hash}"


def sample_model_ids(discovered: dict[str, Any], limit: int = 5) -> list[str]:
    ids: list[str] = []
    for bucket in ["chat", "vision", "image", "tts", "stt"]:
        for item in discovered.get(bucket, []):
            model_id = item.get("id")
            if model_id and model_id not in ids:
                ids.append(model_id)
            if len(ids) >= limit:
                return ids
    return ids


async def test_runtime_connection(runtime: RuntimeConfig) -> dict[str, Any]:
    discovered = await fetch_discovered_models(runtime, refresh=True)
    models_count = sum(
        len(discovered.get(bucket, [])) for bucket in ["chat", "vision", "image", "tts", "stt"]
    )
    if models_count == 0:
        raise HTTPException(
            status_code=502,
            detail="9router connection test failed or returned no models.",
        )
    return {
        "ok": True,
        "models_count": models_count,
        "sample_models": sample_model_ids(discovered),
        "base_url": runtime.base_url,
    }


async def fetch_discovered_models(runtime: RuntimeConfig, refresh: bool = False) -> dict[str, Any]:
    import time

    cache_key = runtime_cache_key(runtime)
    cached = _MODEL_CACHE.get(cache_key)
    if not refresh and cached and cached["expires_at"] > time.time():
        return cached["value"]

    image_models, tts_models, stt_models, chat_models, vision_models = await gather_model_lists(runtime)
    value = {
        "image": image_models.get("data", []),
        "tts": tts_models.get("data", []),
        "stt": stt_models.get("data", []),
        "chat": chat_models.get("data", []),
        "vision": vision_models.get("data", []),
    }
    _MODEL_CACHE[cache_key] = {
        "value": value,
        "expires_at": time.time() + MODEL_CACHE_TTL_SECONDS,
    }
    return value


async def safe_model_list(runtime: RuntimeConfig, path: str) -> dict[str, Any]:
    try:
        return await nine_router_get_json(runtime, path)
    except HTTPException as exc:
        logger.warning("Failed to fetch 9router model list %s: %s", path, exc.detail)
        return {"data": []}


async def gather_model_lists(runtime: RuntimeConfig):
    image_models = await safe_model_list(runtime, "/v1/models/image")
    tts_models = await safe_model_list(runtime, "/v1/models/tts")
    stt_models = await safe_model_list(runtime, "/v1/models/stt")
    chat_models = await safe_model_list(runtime, "/v1/models")
    vision_models = await safe_model_list(runtime, "/v1/models/image-to-text")
    return image_models, tts_models, stt_models, chat_models, vision_models


async def get_model_info(runtime: RuntimeConfig, model_id: str) -> dict[str, Any]:
    try:
        return await nine_router_get_json(runtime, "/v1/models/info", params={"id": model_id})
    except HTTPException:
        return {}


async def build_node_schemas(runtime: RuntimeConfig) -> dict[str, Any]:
    discovered = await fetch_discovered_models(runtime)
    chat_model_ids = [item.get("id") for item in discovered.get("chat", []) if item.get("id")] or [DEFAULT_PROMPT_LLM_MODEL]
    vision_model_ids = [item.get("id") for item in discovered.get("vision", []) if item.get("id")] or chat_model_ids

    image_models: dict[str, Any] = {
        "image-passthrough": passthrough_schema(
            "image_url", "image", "Image URL", "URL of input image."
        )
    }
    for item in discovered["image"]:
        model_id = item["id"]
        info = await get_model_info(runtime, model_id)
        properties, required = build_image_model_properties(model_id, info)
        image_models[model_id] = {
            **item,
            "input_schema": {
                "schemas": {
                    "input_data": {
                        "properties": properties,
                        "required": required,
                    }
                }
            },
        }

    audio_models: dict[str, Any] = {
        "audio-passthrough": passthrough_schema(
            "audio_url", "audio", "Audio URL", "URL of input audio."
        )
    }
    for item in discovered["tts"]:
        model_id = item["id"]
        info = await get_model_info(runtime, model_id)
        properties = {
            "input": field_schema(
                "Text", "string", description="Text to speak.", name="input"
            ),
            "format": enum_field_schema("Format", ["mp3", "wav"], "mp3"),
        }
        voice_options = extract_voice_options(info)
        if voice_options:
            properties["voice"] = enum_field_schema(
                "Voice", voice_options, voice_options[0]
            )
        audio_models[model_id] = {
            **item,
            "input_schema": {
                "schemas": {
                    "input_data": {
                        "properties": properties,
                        "required": ["input"],
                    }
                }
            },
        }

    text_models: dict[str, Any] = {
        "text-passthrough": {
            "id": "text-passthrough",
            "name": "Input Text",
            "input_schema": {
                "schemas": {
                    "input_data": {
                        "properties": {
                            "prompt": field_schema(
                                "Prompt",
                                "string",
                                "Input text.",
                                name="prompt",
                            ),
                        },
                        "required": ["prompt"],
                    }
                }
            },
        }
    }
    for item in discovered["stt"]:
        model_id = item["id"]
        text_models[model_id] = {
            **item,
            "input_schema": {
                "schemas": {
                    "input_data": {
                        "properties": {
                            "audio_url": field_schema(
                                "Audio URL",
                                "string",
                                field="audio",
                                description="Audio URL to transcribe.",
                                name="audio_url",
                            ),
                            "language": field_schema(
                                "Language",
                                "string",
                                description="Optional language code, e.g. en or id.",
                            ),
                            "prompt": field_schema(
                                "Prompt",
                                "string",
                                description="Optional hint text for transcription.",
                            ),
                            "response_format": enum_field_schema(
                                "Response Format",
                                ["json", "text", "verbose_json", "srt", "vtt"],
                                "json",
                            ),
                            "temperature": number_field_schema("Temperature", 0),
                        },
                        "required": ["audio_url"],
                    }
                }
            },
        }

    utility_models = {
        "prompt-concatenator": build_prompt_concatenator_schema(chat_model_ids, vision_model_ids),
        "array-separator": build_array_separator_schema(),
        "list": build_list_schema(),
    }

    return {
        "categories": {
            "image": {"models": image_models},
            "audio": {"models": audio_models},
            "text": {"models": text_models},
            "utility": {"models": utility_models},
        }
    }


async def get_node_schemas_helper(workflow_id: str, runtime: RuntimeConfig):
    return await build_node_schemas(runtime)


async def run_workflow_in_background(
    workflow_id: str, run_id: str, runtime: RuntimeConfig
):
    store = load_workflows_store()
    workflow = copy.deepcopy(store["workflows"].get(workflow_id))
    if not workflow:
        return
    order = build_topological_order(workflow)
    for node_id in order:
        await run_single_node(workflow, node_id, run_id, runtime)


async def run_workflow_helper(
    workflow_id: str, payload: dict, runtime: RuntimeConfig
):
    workflow_id = normalize_workflow_id(workflow_id)
    if not load_workflows_store()["workflows"].get(workflow_id):
        raise HTTPException(status_code=404, detail="Workflow not found")
    run_id = uuid.uuid4().hex
    run_store = load_runs_store()
    run_store["runs"][run_id] = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "nodes": {},
    }
    save_runs_store(run_store)
    asyncio.create_task(run_workflow_in_background(workflow_id, run_id, runtime))
    return {"run_id": run_id}


async def run_node_in_background(
    workflow_id: str, node_id: str, run_id: str, runtime: RuntimeConfig
):
    workflow = copy.deepcopy(get_workflow_or_404(workflow_id))
    await run_single_node(workflow, node_id, run_id, runtime)


async def run_node_helper(
    workflow_id: str, node_id: str, payload: dict, runtime: RuntimeConfig
):
    workflow_id = normalize_workflow_id(workflow_id)
    run_id = payload.get("run_id") or uuid.uuid4().hex
    run_store = load_runs_store()
    run_store["runs"][run_id] = {
        "run_id": run_id,
        "workflow_id": workflow_id,
        "nodes": {},
    }
    save_runs_store(run_store)
    asyncio.create_task(run_node_in_background(workflow_id, node_id, run_id, runtime))
    return {"run_id": run_id}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dirs() -> None:
    for path in [DATA_DIR, GENERATED_DIR, UPLOADS_DIR, TTS_DIR, IMAGES_DIR]:
        path.mkdir(parents=True, exist_ok=True)


def _read_json(path: Path, default: Any) -> Any:
    ensure_dirs()
    if not path.exists():
        path.write_text(json.dumps(default, indent=2), encoding="utf-8")
        return copy.deepcopy(default)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=500, detail=f"Invalid data store: {path.name}"
        ) from exc


def _write_json(path: Path, data: Any) -> None:
    ensure_dirs()
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_workflows_store() -> dict[str, Any]:
    return _read_json(WORKFLOWS_FILE, {"workflows": {}})


def save_workflows_store(store: dict[str, Any]) -> None:
    _write_json(WORKFLOWS_FILE, store)


def load_runs_store() -> dict[str, Any]:
    return _read_json(RUNS_FILE, {"runs": {}})


def save_runs_store(store: dict[str, Any]) -> None:
    _write_json(RUNS_FILE, store)


def workflow_public_view(workflow: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": workflow["workflow_id"],
        "name": workflow.get("name", "Untitled Workflow"),
        "updated_at": workflow.get("updated_at", now_iso()),
        "thumbnail": workflow.get("thumbnail"),
        "category": workflow.get("category", "General"),
    }


def normalize_workflow(
    payload: dict[str, Any], existing: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    workflow_id = (
        payload.get("workflow_id")
        or (existing or {}).get("workflow_id")
        or str(uuid.uuid4())
    )
    updated_at = now_iso()
    workflow = copy.deepcopy(existing) if existing else {}
    workflow.update(
        {
            "workflow_id": workflow_id,
            "name": payload.get("name") or workflow.get("name") or "Untitled Workflow",
            "edges": copy.deepcopy(payload.get("edges", [])),
            "data": copy.deepcopy(payload.get("data", {"nodes": []})),
            "category": payload.get("category")
            or workflow.get("category")
            or "General",
            "updated_at": updated_at,
            "created_at": workflow.get("created_at") or updated_at,
            "is_owner": True,
            "is_published": workflow.get("is_published", False),
            "show_temp_button": workflow.get("show_temp_button", False),
            "is_template": workflow.get("is_template", False),
            "thumbnail": workflow.get("thumbnail"),
            "run_id": workflow.get("run_id"),
            "run_history": workflow.get("run_history", {}),
        }
    )
    return workflow


def is_local_9router_url(base_url: str) -> bool:
    try:
        host = (httpx.URL(base_url).host or "").strip().lower()
    except Exception:
        return False
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "host.docker.internal"}:
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return bool(
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_unspecified
        or ip.is_reserved
    )


def nine_router_headers(runtime: RuntimeConfig, json_content: bool = True) -> dict[str, str]:
    headers: dict[str, str] = {"Authorization": f"Bearer {runtime.api_key}"}
    if json_content:
        headers["Content-Type"] = "application/json"
    return headers


def nine_router_url(runtime: RuntimeConfig, path: str) -> str:
    suffix = path if path.startswith("/") else f"/{path}"
    return f"{runtime.base_url}{suffix}"


async def nine_router_get_json(
    runtime: RuntimeConfig, path: str, params: Optional[dict[str, Any]] = None
) -> dict[str, Any]:
    url = nine_router_url(runtime, path)
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.get(
                url,
                params=params,
                headers=nine_router_headers(runtime, json_content=False),
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502, detail=f"9router request failed: {exc}"
            ) from exc
    if response.status_code >= 400:
        detail = response.text
        try:
            body = response.json()
            detail = body.get("error", {}).get("message") or body.get("detail") or detail
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response.json()


async def nine_router_post_json(
    runtime: RuntimeConfig,
    path: str,
    payload: dict[str, Any],
    params: Optional[dict[str, Any]] = None,
    accept: Optional[str] = None,
) -> httpx.Response:
    url = nine_router_url(runtime, path)
    headers = nine_router_headers(runtime)
    if accept:
        headers["Accept"] = accept
    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            response = await client.post(
                url, params=params, json=payload, headers=headers
            )
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502, detail=f"9router request failed: {exc}"
            ) from exc
    if response.status_code >= 400:
        detail = response.text
        try:
            body = response.json()
            detail = (
                body.get("error", {}).get("message") or body.get("detail") or detail
            )
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response


async def nine_router_post_sse(
    runtime: RuntimeConfig,
    path: str,
    payload: dict[str, Any],
    params: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    url = nine_router_url(runtime, path)
    headers = nine_router_headers(runtime)
    headers["Accept"] = "text/event-stream"
    done_payload = None
    current_event = None
    data_lines: list[str] = []

    async with httpx.AsyncClient(timeout=300.0) as client:
        try:
            async with client.stream(
                "POST", url, params=params, json=payload, headers=headers
            ) as response:
                if response.status_code >= 400:
                    body = await response.aread()
                    detail = body.decode(errors="ignore")
                    raise HTTPException(status_code=response.status_code, detail=detail)
                async for line in response.aiter_lines():
                    if line.startswith("event:"):
                        current_event = line.split(":", 1)[1].strip()
                        data_lines = []
                    elif line.startswith("data:"):
                        if current_event == "done":
                            data_lines.append(line.split(":", 1)[1].strip())
                    elif line == "":
                        if current_event == "done" and data_lines:
                            raw = "\n".join(data_lines)
                            return json.loads(raw)
                        current_event = None
                        data_lines = []

                if current_event == "done" and data_lines:
                    raw = "\n".join(data_lines)
                    return json.loads(raw)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502, detail=f"9router request failed: {exc}"
            ) from exc

    raise HTTPException(
        status_code=502, detail="9router SSE response missing done payload"
    )


def should_use_sse_image(model: str) -> bool:
    return model.startswith("cx/")


def decode_image_response(body: dict[str, Any]) -> list[dict[str, Any]]:
    outputs: list[dict[str, Any]] = []
    for item in body.get("data", []):
        if item.get("url"):
            outputs.append({"type": "image_url", "value": item["url"]})
        elif item.get("b64_json"):
            image_bytes = base64.b64decode(item["b64_json"])
            outputs.append({"type": "image_url", "value": image_bytes})
    return outputs


def finalize_image_outputs(outputs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    finalized = []
    for item in outputs:
        value = item["value"]
        if isinstance(value, bytes):
            finalized.append({"type": item["type"], "value": value})
        else:
            finalized.append(item)
    return finalized


async def materialize_image_outputs(
    outputs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    materialized: list[dict[str, Any]] = []
    for item in outputs:
        value = item["value"]
        if isinstance(value, bytes):
            file_url = await save_generated_bytes(value, IMAGES_DIR, ".png", "image/png")
            materialized.append({"type": item["type"], "value": file_url})
        else:
            materialized.append(item)
    return materialized


async def parse_image_response(response: httpx.Response) -> list[dict[str, Any]]:
    body = response.json()
    outputs = decode_image_response(body)
    if not outputs:
        raise HTTPException(
            status_code=502, detail="9router image response missing output"
        )
    return await materialize_image_outputs(outputs)


async def parse_image_sse(body: dict[str, Any]) -> list[dict[str, Any]]:
    outputs = decode_image_response(body)
    if not outputs:
        raise HTTPException(
            status_code=502, detail="9router SSE image response missing output"
        )
    return await materialize_image_outputs(outputs)


async def fetch_image_outputs(
    runtime: RuntimeConfig, payload: dict[str, Any]
) -> list[dict[str, Any]]:
    model = payload["model"]
    if should_use_sse_image(model):
        body = await nine_router_post_sse(runtime, "/v1/images/generations", payload)
        return await parse_image_sse(body)
    response = await nine_router_post_json(runtime, "/v1/images/generations", payload)
    return await parse_image_response(response)


def normalize_image_prompt(prompt: Any) -> str:
    if prompt is None:
        return ""
    if not isinstance(prompt, str):
        return str(prompt)
    stripped = prompt.strip()
    if not stripped:
        return ""
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        return prompt
    if isinstance(parsed, dict) and parsed.get("prompt"):
        return str(parsed["prompt"])
    return prompt


def prune_empty_params(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value for key, value in payload.items() if value not in [None, "", [], {}]
    }


def ensure_public_reference_image(
    image_url: Optional[str], runtime: RuntimeConfig
) -> None:
    if not image_url:
        return
    try:
        parsed = httpx.URL(image_url)
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail="Reference image URL is invalid"
        ) from exc

    host = (parsed.host or "").strip().lower()
    if not host:
        raise HTTPException(
            status_code=400, detail="Reference image URL must include a public host"
        )
    if parsed.scheme not in ["http", "https"]:
        raise HTTPException(
            status_code=400, detail="Reference image URL must use http or https"
        )

    is_local_host = host in {"localhost", "0.0.0.0", "host.docker.internal"}
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        ip = None
    is_private_ip = bool(
        ip
        and (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_unspecified
            or ip.is_reserved
        )
    )

    allow_local_reference_images = (
        ALLOW_LOCAL_REFERENCE_IMAGES_ENV or is_local_9router_url(runtime.base_url)
    )
    if is_local_host or is_private_ip:
        if allow_local_reference_images:
            logger.warning(
                "Allowing local reference image URL for local 9router development: %s",
                image_url,
            )
            return
        raise HTTPException(
            status_code=400,
            detail="Reference image URL must be publicly reachable by 9router/provider. Set PUBLIC_BASE_URL to a public tunnel/domain and re-upload image, or use local 9router development mode.",
        )


async def build_image_payload(
    runtime: RuntimeConfig, model: str, params: dict[str, Any]
) -> dict[str, Any]:
    prompt = normalize_image_prompt(params.get("prompt"))
    if not prompt:
        raise HTTPException(status_code=400, detail="Image generation requires prompt")

    image_list = [
        value
        for value in (
            params.get("images_list")
            or params.get("images")
            or params.get("image_urls")
            or []
        )
        if value
    ]
    first_image = params.get("image") or (image_list[0] if image_list else None)

    if first_image:
        ensure_public_reference_image(first_image, runtime)
    for image_url in image_list:
        ensure_public_reference_image(image_url, runtime)

    if should_use_sse_image(model):
        return prune_empty_params(
            {
                "model": model,
                "prompt": prompt,
                "n": int(params.get("n", 1) or 1),
                "size": params.get("size") or "auto",
                "quality": params.get("quality") or "auto",
                "background": params.get("background") or "auto",
                "image_detail": params.get("image_detail") or "high",
                "output_format": params.get("output_format") or "png",
                "image": first_image,
                "images_list": image_list,
                "images": image_list,
                "image_urls": image_list,
            }
        )

    payload = {
        "model": model,
        "prompt": prompt,
        "response_format": params.get("response_format") or "url",
        "image": first_image,
        "images_list": image_list,
        "images": image_list,
        "image_urls": image_list,
    }
    if params.get("n"):
        payload["n"] = int(params.get("n") or 1)
    if params.get("size"):
        payload["size"] = params["size"]
    if params.get("quality"):
        payload["quality"] = params["quality"]
    return prune_empty_params(payload)


async def execute_image_node(
    runtime: RuntimeConfig, model: str, params: dict[str, Any]
) -> list[dict[str, Any]]:
    payload = await build_image_payload(runtime, model, params)
    logger.info(
        "9router image request model=%s prompt_chars=%s keys=%s",
        model,
        len(payload.get("prompt", "")),
        sorted(payload.keys()),
    )
    return await fetch_image_outputs(runtime, payload)


async def execute_tts_node(
    runtime: RuntimeConfig, model: str, params: dict[str, Any]
) -> list[dict[str, Any]]:
    audio_format = params.get("format") or "mp3"
    payload = {
        "model": build_tts_model(model, params.get("voice")),
        "input": params.get("input", ""),
    }
    response = await nine_router_post_json(
        runtime, "/v1/audio/speech", payload, params={"response_format": audio_format}
    )
    extension = ".wav" if audio_format == "wav" else ".mp3"
    file_url = await save_generated_bytes(response.content, TTS_DIR, extension, f"audio/{audio_format}")
    return [{"type": "audio_url", "value": file_url}]


def build_tts_model(model: str, voice: Optional[str]) -> str:
    if not voice:
        return model
    if model.endswith(f"/{voice}"):
        return model
    provider = model.split("/", 1)[0] if "/" in model else ""
    if provider and model.count("/") == 1:
        return f"{model}/{voice}"
    return voice if model.endswith("tts") else model


async def execute_stt_node(
    runtime: RuntimeConfig, model: str, params: dict[str, Any]
) -> list[dict[str, Any]]:
    audio_url = params.get("audio_url")
    if not audio_url:
        raise HTTPException(status_code=400, detail="STT requires audio_url")
    file_bytes, content_type = await download_remote_file(audio_url)
    extension = mimetypes.guess_extension(content_type) or ".mp3"
    data = {"model": model}
    for key in ["language", "prompt", "response_format", "temperature"]:
        value = params.get(key)
        if value not in [None, ""]:
            data[key] = str(value)
    files = {
        "file": (f"audio{extension}", file_bytes, content_type),
    }
    response = await nine_router_post_multipart(
        runtime, "/v1/audio/transcriptions", data=data, files=files
    )
    fmt = params.get("response_format") or "json"
    if fmt == "json":
        text = response.json().get("text", "")
    elif fmt == "verbose_json":
        body = response.json()
        text = body.get("text") or "\n".join(
            segment.get("text", "") for segment in body.get("segments", [])
        )
    else:
        text = response.text
    return [{"type": "text", "value": text}]


def build_prompt_concatenator_schema(chat_model_ids: Optional[list[str]] = None, vision_model_ids: Optional[list[str]] = None) -> dict[str, Any]:
    chat_model_ids = chat_model_ids or [DEFAULT_PROMPT_LLM_MODEL]
    vision_model_ids = vision_model_ids or chat_model_ids or [DEFAULT_PROMPT_LLM_MODEL]
    return {
        "id": "prompt-concatenator",
        "name": "Prompt Concatenator",
        "input_schema": {
            "schemas": {
                "input_data": {
                    "properties": {
                        "prompt": field_schema("Prompt", "string", description="Primary instruction or text input."),
                        "system_prompt": field_schema("System Prompt", "string", description="Optional system instruction for the LLM."),
                        "image_url": field_schema("Image URL", "string", description="Optional image input for vision analysis.", field="image"),
                        "image_urls": {
                            "title": "Image Inputs",
                            "name": "image_urls",
                            "type": "array",
                            "field": "images_list",
                            "items": {"type": "string"},
                            "default": [],
                            "description": "Additional image inputs for vision analysis.",
                        },
                        "mode": enum_field_schema("Mode", ["rewrite", "concat", "vision_json", "extract_image_prompt", "extract_video_prompt"], "rewrite"),
                        "llm_model": enum_field_schema("LLM Model", chat_model_ids, chat_model_ids[0]),
                        "vision_model": enum_field_schema("Vision Model", vision_model_ids, vision_model_ids[0]),
                        "temperature": number_field_schema("Temperature", 0.2),
                    },
                    "required": ["prompt"],
                }
            }
        },
    }


def build_array_separator_schema() -> dict[str, Any]:
    return {
        "id": "array-separator",
        "name": "Array Separator",
        "input_schema": {
            "schemas": {
                "input_data": {
                    "properties": {
                        "text": field_schema("Text", "string", description="Text to split into items."),
                        "separator": {
                            **field_schema("Separator", "string", description="Separator used to split text."),
                            "default": "\n",
                            "examples": ["\n", "|", ","],
                        },
                        "trim_items": {
                            "title": "Trim Items",
                            "name": "trim_items",
                            "type": "boolean",
                            "default": True,
                            "description": "Trim whitespace around each item.",
                        },
                        "remove_empty": {
                            "title": "Remove Empty",
                            "name": "remove_empty",
                            "type": "boolean",
                            "default": True,
                            "description": "Remove empty items after split.",
                        },
                    },
                    "required": ["text"],
                }
            }
        },
    }


def build_list_schema() -> dict[str, Any]:
    return {
        "id": "list",
        "name": "List",
        "input_schema": {
            "schemas": {
                "input_data": {
                    "properties": {
                        "items": {
                            "title": "Items",
                            "name": "items",
                            "type": "array",
                            "items": {"type": "string"},
                            "default": [],
                            "description": "List of text items.",
                        },
                        "selected_index": {
                            "title": "Selected Index",
                            "name": "selected_index",
                            "type": "number",
                            "default": 0,
                            "description": "Selected item index.",
                        },
                    },
                    "required": ["items"],
                }
            }
        },
    }


async def execute_chat_completion(
    runtime: RuntimeConfig,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float = 0.2,
) -> str:
    response = await nine_router_post_json(
        runtime,
        "/v1/chat/completions",
        {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": False,
        },
    )
    body = response.json()
    choices = body.get("choices") or []
    if not choices:
        raise HTTPException(status_code=502, detail="Chat completion response missing choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        text_parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text" and item.get("text"):
                text_parts.append(str(item["text"]))
        if text_parts:
            return "\n".join(text_parts).strip()
    raise HTTPException(status_code=502, detail="Chat completion response missing text content")


async def execute_prompt_concatenator_node(
    runtime: RuntimeConfig, params: dict[str, Any]
) -> list[dict[str, Any]]:
    mode = (params.get("mode") or "concat").strip()
    llm_model = (params.get("llm_model") or DEFAULT_PROMPT_LLM_MODEL).strip() or DEFAULT_PROMPT_LLM_MODEL
    vision_model = (params.get("vision_model") or llm_model).strip() or llm_model
    temperature = float(params.get("temperature") or 0.2)
    system_prompt = (params.get("system_prompt") or "").strip()
    prompt = (params.get("prompt") or "").strip()
    merged_text = prompt

    if mode == "concat":
        return [{"type": "text", "value": merged_text}]

    image_url = (params.get("image_url") or "").strip()
    image_urls = [
        str(value).strip()
        for value in (params.get("image_urls") or params.get("images_list") or [])
        if str(value).strip()
    ]
    if image_url:
        ensure_public_reference_image(image_url, runtime)
    for extra_image_url in image_urls:
        ensure_public_reference_image(extra_image_url, runtime)
    unique_image_urls = []
    for candidate in ([image_url] if image_url else []) + image_urls:
        if candidate and candidate not in unique_image_urls:
            unique_image_urls.append(candidate)
    multimodal_images = [
        {"type": "image_url", "image_url": {"url": image_source}}
        for image_source in unique_image_urls
    ]

    if mode == "vision_json":
        if not unique_image_urls:
            raise HTTPException(status_code=400, detail="Prompt Concatenator vision_json mode requires image input")
        messages = []
        messages.append({
            "role": "system",
            "content": system_prompt or "Analyze provided image and instruction. Return valid JSON only with keys image_prompt and video_prompt.",
        })
        messages.append({
            "role": "user",
            "content": [
                {"type": "text", "text": merged_text or "Analyze this image and return image_prompt and video_prompt JSON."},
                *multimodal_images,
            ],
        })
        content = await execute_chat_completion(runtime, vision_model, messages, temperature)
        return [{"type": "text", "value": content}]

    parsed_json = None
    try:
        parsed_json = json.loads(merged_text)
    except Exception:
        parsed_json = None

    if mode == "extract_image_prompt" and isinstance(parsed_json, dict) and parsed_json.get("image_prompt"):
        return [{"type": "text", "value": str(parsed_json["image_prompt"]).strip()}]
    if mode == "extract_video_prompt" and isinstance(parsed_json, dict) and parsed_json.get("video_prompt"):
        return [{"type": "text", "value": str(parsed_json["video_prompt"]).strip()}]

    if mode in {"rewrite", "extract_image_prompt", "extract_video_prompt"}:
        default_system_prompt = {
            "rewrite": "Rewrite provided inputs into one clean final prompt. Return plain text only.",
            "extract_image_prompt": "Extract or rewrite only final image prompt from provided context. Return plain text only.",
            "extract_video_prompt": "Extract or rewrite only final video prompt from provided context. Return plain text only.",
        }[mode]
        messages = [{"role": "system", "content": system_prompt or default_system_prompt}]
        user_content = merged_text or prompt or default_system_prompt
        if multimodal_images:
            messages.append({
                "role": "user",
                "content": [
                    {"type": "text", "text": user_content},
                    *multimodal_images,
                ],
            })
        else:
            messages.append({"role": "user", "content": user_content})
        content = await execute_chat_completion(runtime, llm_model, messages, temperature)
        return [{"type": "text", "value": content}]

    raise HTTPException(status_code=400, detail=f"Unsupported Prompt Concatenator mode: {mode}")


async def execute_utility_node(
    runtime: RuntimeConfig, node: dict[str, Any], params: dict[str, Any]
) -> list[dict[str, Any]]:
    model = node.get("model")
    if model == "prompt-concatenator":
        return await execute_prompt_concatenator_node(runtime, params)
    if model == "array-separator":
        text = params.get("text")
        if text is None:
            text = ""
        if not isinstance(text, str):
            text = str(text)
        raw_separator = params.get("separator")
        separator = "\n" if raw_separator in [None, ""] else str(raw_separator)
        separator = separator.replace("\r\n", "\n").strip() or "\\n"
        separator = (
            separator.replace("\\r", "\r")
            .replace("\\n", "\n")
            .replace("\\t", "\t")
        )
        trim_items = bool(params.get("trim_items", True))
        remove_empty = bool(params.get("remove_empty", True))
        items = text.split(separator)
        if trim_items:
            items = [item.strip() for item in items]
        if remove_empty:
            items = [item for item in items if item]
        return [{"type": "text", "value": item} for item in items]
    if model == "list":
        raw_items = params.get("items") or []
        if not isinstance(raw_items, list):
            raw_items = [raw_items]
        items = [str(item) for item in raw_items if item not in [None, ""]]
        try:
            selected_index = int(params.get("selected_index") or 0)
        except (TypeError, ValueError):
            selected_index = 0
        if not items:
            return []
        selected_index = max(0, min(selected_index, len(items) - 1))
        return [{"type": "text", "value": items[selected_index]}]
    raise HTTPException(status_code=400, detail=f"Unsupported utility model: {model}")


async def execute_node(
    runtime: RuntimeConfig, node: dict[str, Any], params: dict[str, Any]
) -> list[dict[str, Any]]:
    category = node.get("category")
    model = node.get("model")

    if model == "text-passthrough":
        return [{"type": "text", "value": params.get("prompt", "")}]
    if model == "image-passthrough":
        return [{"type": "image_url", "value": params.get("image_url", "")}]
    if model == "audio-passthrough":
        return [{"type": "audio_url", "value": params.get("audio_url", "")}]

    if category == "image":
        return await execute_image_node(runtime, model, params)
    if category == "audio":
        return await execute_tts_node(runtime, model, params)
    if category == "text":
        return await execute_stt_node(runtime, model, params)
    if category == "utility":
        return await execute_utility_node(runtime, node, params)

    raise HTTPException(
        status_code=400, detail=f"Unsupported node category: {category}"
    )


async def persist_run_result(
    workflow: dict[str, Any],
    run: dict[str, Any],
    node_id: str,
    outputs: list[dict[str, Any]],
    status: str = "succeeded",
) -> dict[str, Any]:
    result_id = uuid.uuid4().hex
    run_entry = {
        "node_run_id": uuid.uuid4().hex,
        "status": status,
        "started_at": now_iso(),
        "result": {
            "id": result_id,
            "outputs": outputs,
        },
    }
    upsert_run_entry(run, node_id, run_entry)
    workflow.setdefault("run_history", {}).setdefault(node_id, [])
    workflow["run_history"][node_id].append(run_entry)

    node = find_node(workflow, node_id)
    output_value = outputs[0]["value"] if outputs else None
    node.setdefault("output_params", {})
    node["output_params"]["outputs"] = outputs
    node["output_params"]["resultUrl"] = output_value
    return run_entry


async def persist_run_failure(
    workflow: dict[str, Any], run: dict[str, Any], node_id: str, message: str
) -> dict[str, Any]:
    run_entry = {
        "node_run_id": uuid.uuid4().hex,
        "status": "failed",
        "started_at": now_iso(),
        "result": {
            "id": uuid.uuid4().hex,
            "outputs": [{"type": "text", "value": {"error": message}}],
        },
    }
    upsert_run_entry(run, node_id, run_entry)
    workflow.setdefault("run_history", {}).setdefault(node_id, []).append(run_entry)
    return run_entry


async def run_single_node(
    workflow: dict[str, Any],
    node_id: str,
    run_id: str,
    runtime: RuntimeConfig,
    visited: Optional[set[str]] = None,
) -> dict[str, Any]:
    run_store = load_runs_store()
    run = run_store["runs"].get(run_id) or {
        "run_id": run_id,
        "workflow_id": workflow["workflow_id"],
        "nodes": {},
    }
    visited = visited or set()
    if node_id in visited:
        return run
    visited.add(node_id)

    upstream_ids = [
        edge.get("source")
        for edge in workflow.get("edges", [])
        if edge.get("target") == node_id
    ]
    for upstream_id in upstream_ids:
        upstream_entries = run.get("nodes", {}).get(upstream_id) or []
        upstream_latest = upstream_entries[0] if upstream_entries else None
        if not upstream_latest or upstream_latest.get("status") not in [
            "succeeded",
            "completed",
        ]:
            await run_single_node(workflow, upstream_id, run_id, runtime, visited)
            run = load_runs_store()["runs"].get(run_id) or run

    node = find_node(workflow, node_id)
    node_outputs = {
        key: entries[0]["result"]["outputs"]
        for key, entries in run.get("nodes", {}).items()
        if entries and entries[0].get("result", {}).get("outputs")
    }
    params = resolve_payload_values(
        copy.deepcopy(node.get("params") or node.get("input_params") or {}),
        node_outputs,
    )
    params = apply_edge_fallbacks(workflow, node, params, node_outputs)
    try:
        outputs = await execute_node(runtime, node, params)
        await persist_run_result(workflow, run, node_id, outputs)
    except HTTPException as exc:
        await persist_run_failure(
            workflow,
            run,
            node_id,
            exc.detail if isinstance(exc.detail, str) else str(exc.detail),
        )
    except Exception as exc:
        logger.exception("Node execution failed")
        await persist_run_failure(workflow, run, node_id, str(exc))

    workflow["run_id"] = run_id
    run_store = load_runs_store()
    run_store["runs"][run_id] = run
    save_runs_store(run_store)
    store = load_workflows_store()
    store["workflows"][workflow["workflow_id"]] = workflow
    save_workflows_store(store)
    return run


async def nine_router_post_multipart(
    runtime: RuntimeConfig, path: str, data: dict[str, Any], files: dict[str, Any]
) -> httpx.Response:
    url = nine_router_url(runtime, path)
    headers = nine_router_headers(runtime, json_content=False)
    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            response = await client.post(url, data=data, files=files, headers=headers)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=502, detail=f"9router request failed: {exc}"
            ) from exc
    if response.status_code >= 400:
        detail = response.text
        try:
            body = response.json()
            detail = (
                body.get("error", {}).get("message") or body.get("detail") or detail
            )
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=detail)
    return response


def build_image_model_properties(
    model_id: str, info: dict[str, Any]
) -> tuple[dict[str, Any], list[str]]:
    params = info.get("params") or []
    capabilities = set(info.get("capabilities") or [])
    properties: dict[str, Any] = {
        "prompt": field_schema(
            "Prompt", "string", description="Prompt for image generation."
        ),
        "n": number_field_schema("Count", 1),
    }
    required = ["prompt"]

    if "edit" in capabilities:
        properties["image"] = field_schema(
            "Reference Image",
            "string",
            description="Reference image URL.",
            field="image",
            name="image",
        )
        properties["images_list"] = {
            "title": "Reference Images",
            "name": "images_list",
            "type": "array",
            "field": "images_list",
            "items": {"type": "string"},
            "default": [],
            "description": "Reference image URLs.",
        }
        properties["images"] = {
            "title": "Images",
            "name": "images",
            "type": "array",
            "field": "images_list",
            "items": {"type": "string"},
            "default": [],
            "description": "Reference image URLs.",
        }
        properties["image_urls"] = {
            "title": "Image URLs",
            "name": "image_urls",
            "type": "array",
            "field": "images_list",
            "items": {"type": "string"},
            "default": [],
            "description": "Reference image URLs.",
        }

    for param in params:
        override = IMAGE_FIELD_OVERRIDES.get(param)
        if not override:
            properties[param] = field_schema(
                format_name_for_label(param),
                "string",
                description=format_name_for_label(param),
                name=param,
            )
            continue
        properties[param] = enum_field_schema(
            override["label"], override["enum"], override["default"]
        )
        if override.get("enum_labels"):
            properties[param]["enum_labels"] = override["enum_labels"]
        properties[param]["name"] = param

    if should_use_sse_image(model_id):
        properties.setdefault(
            "background",
            enum_field_schema("Background", ["auto", "transparent", "opaque"], "auto"),
        )
        properties.setdefault(
            "image_detail",
            enum_field_schema(
                "Image Detail", ["auto", "low", "high", "original"], "original"
            ),
        )
        properties.setdefault(
            "output_format",
            enum_field_schema("Output Format", ["png", "jpeg", "webp"], "png"),
        )
    else:
        properties.setdefault(
            "response_format",
            enum_field_schema("Response Format", ["url", "b64_json"], "url"),
        )

    return properties, required


def format_name_for_label(value: str) -> str:
    return " ".join(part.capitalize() for part in value.split("_"))


def extract_voice_options(info: dict[str, Any]) -> list[str]:
    if not info:
        return []
    candidates = []
    for key in ["voices", "voice_ids", "voiceOptions"]:
        value = info.get(key)
        if isinstance(value, list):
            candidates.extend([str(item) for item in value if item])
    params = info.get("params") or info.get("parameters") or {}
    for value in params.values() if isinstance(params, dict) else []:
        if (
            isinstance(value, dict)
            and isinstance(value.get("enum"), list)
            and value.get("name") == "voice"
        ):
            candidates.extend([str(item) for item in value["enum"] if item])
    seen = set()
    result = []
    for voice in candidates:
        if voice not in seen:
            seen.add(voice)
            result.append(voice)
    return result


def field_schema(
    title: str,
    field_type: str,
    description: str = "",
    field: Optional[str] = None,
    name: Optional[str] = None,
) -> dict[str, Any]:
    schema = {
        "title": title,
        "type": field_type,
        "description": description,
        "name": name or title.lower().replace(" ", "_"),
        "examples": [""] if field_type == "string" else [],
    }
    if field:
        schema["field"] = field
    return schema


def enum_field_schema(title: str, options: list[str], default: str) -> dict[str, Any]:
    return {
        "title": title,
        "name": title.lower().replace(" ", "_"),
        "type": "string",
        "enum": options,
        "default": default,
        "description": title,
    }


def number_field_schema(title: str, default: int | float) -> dict[str, Any]:
    return {
        "title": title,
        "name": title.lower().replace(" ", "_"),
        "type": "number",
        "default": default,
        "description": title,
    }


def passthrough_schema(
    field_name: str, field_type: str, title: str, description: str
) -> dict[str, Any]:
    return {
        "id": title.lower().replace(" ", "-"),
        "name": title,
        "input_schema": {
            "schemas": {
                "input_data": {
                    "properties": {
                        field_name: {
                            "examples": [],
                            "description": description,
                            "field": field_type,
                            "type": "string",
                            "title": title,
                            "name": field_name,
                        }
                    },
                    "required": [field_name],
                }
            }
        },
    }


def normalize_workflow_id(workflow_id: Any) -> str:
    if isinstance(workflow_id, str):
        return workflow_id
    if isinstance(workflow_id, dict):
        for key in ["id", "workflow_id"]:
            value = workflow_id.get(key)
            if isinstance(value, str):
                return value
    return str(workflow_id)


def get_workflow_or_404(workflow_id: str) -> dict[str, Any]:
    workflow_id = normalize_workflow_id(workflow_id)
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return workflow


def get_run_or_404(run_id: str) -> dict[str, Any]:
    store = load_runs_store()
    run = store["runs"].get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def resolve_reference_string(
    value: str, node_outputs: dict[str, list[dict[str, Any]]]
) -> str:
    pattern = re.compile(r"\{\{\s*([^.\s]+)\.outputs\[(\d+)\]\.value\s*\}\}")

    def replace(match: re.Match[str]) -> str:
        node_id = match.group(1)
        output_index = int(match.group(2))
        outputs = node_outputs.get(node_id, [])
        if len(outputs) <= output_index:
            return ""
        raw = outputs[output_index].get("value")
        return "" if raw is None else str(raw)

    return pattern.sub(replace, value)


def resolve_payload_values(
    value: Any, node_outputs: dict[str, list[dict[str, Any]]]
) -> Any:
    if isinstance(value, str):
        return resolve_reference_string(value, node_outputs)
    if isinstance(value, list):
        return [resolve_payload_values(item, node_outputs) for item in value]
    if isinstance(value, dict):
        return {
            key: resolve_payload_values(item, node_outputs)
            for key, item in value.items()
        }
    return value


def incoming_outputs_for_node(
    workflow: dict[str, Any],
    node_id: str,
    node_outputs: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    outputs: list[dict[str, Any]] = []
    for edge in workflow.get("edges", []):
        if edge.get("target") != node_id:
            continue
        outputs.extend(node_outputs.get(edge.get("source"), []))
    return outputs


def apply_edge_fallbacks(
    workflow: dict[str, Any],
    node: dict[str, Any],
    params: dict[str, Any],
    node_outputs: dict[str, list[dict[str, Any]]],
) -> dict[str, Any]:
    resolved = dict(params)
    incoming = incoming_outputs_for_node(workflow, node.get("id"), node_outputs)
    text_values = [
        item.get("value")
        for item in incoming
        if item.get("type") == "text" and item.get("value")
    ]
    image_values = [
        item.get("value")
        for item in incoming
        if item.get("type") == "image_url" and item.get("value")
    ]
    audio_values = [
        item.get("value")
        for item in incoming
        if item.get("type") == "audio_url" and item.get("value")
    ]

    if (
        node.get("category") == "utility"
        and node.get("model") == "prompt-concatenator"
        and not resolved.get("prompt")
    ):
        resolved["prompt"] = "\n".join(str(value) for value in text_values)
    if node.get("category") == "image":
        if not resolved.get("prompt") and text_values:
            resolved["prompt"] = str(text_values[0])
        if not resolved.get("image_url") and image_values:
            resolved["image_url"] = image_values[0]
        if not resolved.get("image") and image_values:
            resolved["image"] = image_values[0]
        if image_values and not resolved.get("images_list"):
            resolved["images_list"] = image_values
        if image_values and not resolved.get("images"):
            resolved["images"] = image_values
        if image_values and not resolved.get("image_urls"):
            resolved["image_urls"] = image_values
    if node.get("category") == "audio" and not resolved.get("input") and text_values:
        resolved["input"] = str(text_values[0])
    if (
        node.get("category") == "text"
        and not resolved.get("audio_url")
        and audio_values
    ):
        resolved["audio_url"] = audio_values[0]

    return resolved


def find_node(workflow: dict[str, Any], node_id: str) -> dict[str, Any]:
    for node in workflow.get("data", {}).get("nodes", []):
        if node.get("id") == node_id:
            return node
    raise HTTPException(status_code=404, detail=f"Node {node_id} not found")


def build_node_lookup(workflow: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        node.get("id"): node
        for node in workflow.get("data", {}).get("nodes", [])
        if node.get("id")
    }


def build_topological_order(workflow: dict[str, Any]) -> list[str]:
    nodes = build_node_lookup(workflow)
    incoming: dict[str, int] = {node_id: 0 for node_id in nodes}
    graph: dict[str, list[str]] = defaultdict(list)
    for edge in workflow.get("edges", []):
        source = edge.get("source")
        target = edge.get("target")
        if source in nodes and target in nodes:
            graph[source].append(target)
            incoming[target] += 1
    queue = deque(
        sorted([node_id for node_id, degree in incoming.items() if degree == 0])
    )
    order: list[str] = []
    while queue:
        node_id = queue.popleft()
        order.append(node_id)
        for nxt in graph[node_id]:
            incoming[nxt] -= 1
            if incoming[nxt] == 0:
                queue.append(nxt)
    if len(order) != len(nodes):
        raise HTTPException(status_code=400, detail="Workflow graph contains a cycle")
    return order


def upsert_run_entry(run: dict[str, Any], node_id: str, entry: dict[str, Any]) -> None:
    run.setdefault("nodes", {})[node_id] = [entry]


def storage_prefix_for_folder(folder: Path) -> str:
    try:
        return folder.relative_to(GENERATED_DIR).as_posix().strip("/") or "generated"
    except ValueError:
        return folder.name or "generated"


async def save_generated_bytes(
    content: bytes,
    folder: Path,
    suffix: str,
    content_type: str | None = None,
) -> str:
    ensure_dirs()
    filename = f"{uuid.uuid4().hex}{suffix}"
    if is_object_storage_enabled():
        prefix = storage_prefix_for_folder(folder)
        key = f"{prefix}/{filename}"
        return await upload_object_bytes(
            content,
            key,
            suffix,
            content_type or guess_content_type(suffix),
        )
    path = folder / filename
    path.write_bytes(content)
    relative = path.relative_to(GENERATED_DIR)
    return f"{PUBLIC_BASE_URL}/generated/{relative.as_posix()}"


async def download_remote_file(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=180.0) as client:
        try:
            response = await client.get(url)
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=400, detail=f"Failed to download file from URL: {exc}"
            ) from exc
    if response.status_code >= 400:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to download file from URL: {response.status_code}",
        )
    content_type = (
        response.headers.get("content-type", "application/octet-stream")
        .split(";")[0]
        .strip()
    )
    return response.content, content_type


async def create_or_update_workflow(payload: dict):
    store = load_workflows_store()
    workflow_id = payload.get("workflow_id") or str(uuid.uuid4())
    existing = store["workflows"].get(workflow_id)
    payload = copy.deepcopy(payload)
    payload["workflow_id"] = workflow_id
    workflow = normalize_workflow(payload, existing)
    store["workflows"][workflow_id] = workflow
    save_workflows_store(store)
    return {"workflow_id": workflow_id}


async def get_api_node_schemas_helper(workflow_id: str):
    return {"models": {}}


async def get_workflow_def_helper(workflow_id: str):
    return get_workflow_or_404(workflow_id)


async def get_workflow_defs_helper():
    store = load_workflows_store()
    workflows = [workflow_public_view(item) for item in store["workflows"].values()]
    workflows.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    return workflows


async def delete_workflow_def_by_id(workflow_id: str):
    store = load_workflows_store()
    if workflow_id not in store["workflows"]:
        raise HTTPException(status_code=404, detail="Workflow not found")
    del store["workflows"][workflow_id]
    save_workflows_store(store)
    run_store = load_runs_store()
    run_store["runs"] = {
        run_id: run
        for run_id, run in run_store["runs"].items()
        if run.get("workflow_id") != workflow_id
    }
    save_runs_store(run_store)
    return {"deleted": True}


async def update_workflow_name_helper(workflow_id: str, payload: dict):
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow["name"] = payload.get("name") or workflow.get("name")
    workflow["updated_at"] = now_iso()
    save_workflows_store(store)
    return {"workflow_id": workflow_id, "name": workflow["name"]}


async def get_run_status_helper(run_id: str):
    return get_run_or_404(run_id)


async def publish_workflow_helper(workflow_id: str, payload: dict):
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow["is_published"] = bool(payload.get("publish"))
    workflow["updated_at"] = now_iso()
    save_workflows_store(store)
    return {"publish": workflow["is_published"]}


async def template_workflow_helper(workflow_id: str, payload: dict):
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow["is_template"] = bool(payload.get("is_template"))
    workflow["updated_at"] = now_iso()
    save_workflows_store(store)
    return {"is_template": workflow["is_template"]}


async def cloudfront_signed_url_helper(payload: dict):
    return {"signed_url": payload.get("url")}


async def generate_thumbnail_helper(workflow_id: str, payload: dict):
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow["thumbnail"] = (
        payload.get("url") or payload.get("thumbnail") or payload.get("image_url")
    )
    workflow["updated_at"] = now_iso()
    save_workflows_store(store)
    return {"thumbnail": workflow.get("thumbnail")}


async def get_file_upload_url_helper(params: dict):
    filename = params.get("filename") or "upload.bin"
    return {
        "upload_url": f"{PUBLIC_BASE_URL}/api/app/upload-file",
        "filename": filename,
    }


async def get_workflow_last_run(workflow_id: str):
    workflow = get_workflow_or_404(workflow_id)
    run_id = workflow.get("run_id")
    if not run_id:
        return {"run_id": None, "nodes": {}}
    return get_run_or_404(run_id)


async def architect_workflow_helper(payload: dict):
    return {
        "request_id": uuid.uuid4().hex,
        "status": "failed",
        "message": "Architect flow not supported in 9router mode.",
        "workflow": {"nodes": [], "edges": []},
        "suggestions": [],
    }


async def poll_architect_result_helper(id: str):
    return {
        "request_id": id,
        "status": "failed",
        "message": "Architect flow not supported in 9router mode.",
        "workflow": {"nodes": [], "edges": []},
        "suggestions": [],
    }


async def delete_node_run_by_id_helper(node_run_id: str):
    run_store = load_runs_store()
    workflow_store = load_workflows_store()
    removed = False
    for run in run_store["runs"].values():
        for node_id, entries in list(run.get("nodes", {}).items()):
            filtered = [
                entry for entry in entries if entry.get("node_run_id") != node_run_id
            ]
            if len(filtered) != len(entries):
                run["nodes"][node_id] = filtered
                removed = True
    for workflow in workflow_store["workflows"].values():
        history = workflow.get("run_history", {})
        for node_id, entries in list(history.items()):
            history[node_id] = [
                entry for entry in entries if entry.get("node_run_id") != node_run_id
            ]
    if not removed:
        raise HTTPException(status_code=404, detail="Node run not found")
    save_runs_store(run_store)
    save_workflows_store(workflow_store)
    return {"deleted": True}


async def update_workflow_category_helper(workflow_id: str, payload: dict):
    store = load_workflows_store()
    workflow = store["workflows"].get(workflow_id)
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow["category"] = (
        payload.get("category") or workflow.get("category") or "General"
    )
    workflow["updated_at"] = now_iso()
    save_workflows_store(store)
    return {"category": workflow["category"]}


async def get_workflow_api_inputs_helper(workflow_id: str):
    return {"inputs": []}


async def execute_workflow_via_api_helper(workflow_id: str, payload: dict):
    raise HTTPException(
        status_code=400, detail="API execution not supported in 9router mode"
    )


async def get_workflow_api_outputs_helper(run_id: str):
    raise HTTPException(
        status_code=400, detail="API outputs not supported in 9router mode"
    )


async def handle_uploaded_file(
    filename: str,
    content: bytes,
    content_type: str | None = None,
) -> dict[str, Any]:
    suffix = Path(filename).suffix or ".bin"
    file_url = await save_generated_bytes(
        content,
        UPLOADS_DIR,
        suffix,
        content_type or guess_content_type(suffix),
    )
    return {"url": file_url}


async def calculate_dynamic_cost_helper(payload: dict) -> dict[str, Any]:
    return {"cost": 0}

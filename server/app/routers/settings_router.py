from fastapi import APIRouter, HTTPException, Request

from app.utils.runtime_config import runtime_config_from_request
from app.utils.workflow_helper import test_runtime_connection

router = APIRouter()


@router.post("/runtime/test")
async def test_runtime(request: Request):
    try:
        runtime = runtime_config_from_request(request)
        return await test_runtime_connection(runtime)
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise exc
        raise HTTPException(status_code=502, detail="Failed to test 9router connection")

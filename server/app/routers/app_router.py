from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse
from app.utils.storage import get_signed_object_download_url
from app.utils.workflow_helper import (
    calculate_dynamic_cost_helper,
    get_file_upload_url_helper,
    handle_uploaded_file,
)

router = APIRouter()

@router.get("/get_file_upload_url")
async def get_file_upload_url(request: Request):
    try:
        params = dict(request.query_params)
        return await get_file_upload_url_helper(params)
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/upload-file")
async def upload_file(file: UploadFile = File(...)):
    try:
        content = await file.read()
        return await handle_uploaded_file(file.filename or "upload.bin", content, file.content_type)
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/object/{object_key:path}")
async def download_object(object_key: str):
    try:
        return RedirectResponse(get_signed_object_download_url(object_key), status_code=307)
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/calculate_dynamic_cost")
async def calculate_dynamic_cost(request: Request):
    try:
        payload = await request.json()
        return await calculate_dynamic_cost_helper(payload)
    except Exception as e:
        if isinstance(e, HTTPException): raise e
        raise HTTPException(status_code=400, detail=str(e))

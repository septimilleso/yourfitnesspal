"""Workout templates and folders. Thin layer over app/services/templates.py."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user
from app.db import get_session
from app.models.user import User
from app.schemas.workout import (
    FolderIn,
    FolderOut,
    TemplateIn,
    TemplateOut,
    TemplatePatch,
    TemplatesResponse,
)
from app.services import templates

router = APIRouter(prefix="/api", tags=["templates"])


@router.get("/templates", response_model=TemplatesResponse)
async def list_all(
    session: AsyncSession = Depends(get_session), user: User = Depends(get_current_user)
) -> TemplatesResponse:
    return await templates.list_templates(session, user)


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create(
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.create_template(session, user, payload)


@router.get("/templates/{template_id}", response_model=TemplateOut)
async def get_one(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.get_template(session, user, template_id)


@router.put("/templates/{template_id}", response_model=TemplateOut)
async def replace(
    template_id: int,
    payload: TemplateIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.replace_template(session, user, template_id, payload)


@router.patch("/templates/{template_id}", response_model=TemplateOut)
async def patch(
    template_id: int,
    payload: TemplatePatch,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.patch_template(session, user, template_id, payload)


@router.delete("/templates/{template_id}", status_code=204)
async def delete(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await templates.delete_template(session, user, template_id)


@router.post("/templates/{template_id}/duplicate", response_model=TemplateOut, status_code=201)
async def duplicate(
    template_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> TemplateOut:
    return await templates.duplicate_template(session, user, template_id)


@router.post("/template-folders", response_model=FolderOut, status_code=201)
async def create_folder(
    payload: FolderIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderOut:
    return await templates.create_folder(session, user, payload)


@router.patch("/template-folders/{folder_id}", response_model=FolderOut)
async def rename_folder(
    folder_id: int,
    payload: FolderIn,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FolderOut:
    return await templates.rename_folder(session, user, folder_id, payload)


@router.delete("/template-folders/{folder_id}", status_code=204)
async def delete_folder(
    folder_id: int,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    await templates.delete_folder(session, user, folder_id)

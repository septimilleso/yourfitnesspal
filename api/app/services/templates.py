"""Workout templates and their folders.

A template is replaced as a whole on edit (`PUT`): the SPA edits a local
draft and saves once. Positions are 0-based and rewritten on every change.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.workout import TemplateExercise, TemplateFolder, TemplateSet, WorkoutTemplate
from app.permissions import Permission, ensure_permission
from app.schemas.workout import (
    FolderIn,
    FolderOut,
    SetValues,
    TemplateExerciseIn,
    TemplateExerciseOut,
    TemplateIn,
    TemplateOut,
    TemplatePatch,
    TemplatesResponse,
    TemplateSummary,
)
from app.services.errors import NotFound
from app.services.exercises import exercise_out, get_visible_exercises
from app.services.gym_rules import normalize_supersets, tracking_fields


def template_out(template: WorkoutTemplate) -> TemplateOut:
    return TemplateOut(
        id=template.id, name=template.name, folder_id=template.folder_id,
        last_used_at=template.last_used_at,
        exercises=[
            TemplateExerciseOut(
                id=item.id, exercise=exercise_out(item.exercise), rest_seconds=item.rest_seconds,
                superset_group=item.superset_group, note=item.note,
                sets=[SetValues.model_validate(s) for s in item.sets],
            )
            for item in template.exercises
        ],
    )


async def find_template(
    db: AsyncSession, user: User, template_id: int
) -> WorkoutTemplate | None:
    return await db.scalar(
        sa.select(WorkoutTemplate)
        .where(WorkoutTemplate.id == template_id, WorkoutTemplate.user_id == user.id)
        .options(
            selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise),
            selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.sets),
        )
        .execution_options(populate_existing=True)
    )


async def own_template(db: AsyncSession, user: User, template_id: int) -> WorkoutTemplate:
    template = await find_template(db, user, template_id)
    if template is None:
        raise NotFound("template not found")
    return template


async def own_folder(db: AsyncSession, user: User, folder_id: int) -> TemplateFolder:
    folder = await db.scalar(
        sa.select(TemplateFolder).where(
            TemplateFolder.id == folder_id, TemplateFolder.user_id == user.id
        )
    )
    if folder is None:
        raise NotFound("folder not found")
    return folder


async def next_template_position(db: AsyncSession, user: User, folder_id: int | None) -> int:
    in_folder = (
        WorkoutTemplate.folder_id.is_(None)
        if folder_id is None
        else WorkoutTemplate.folder_id == folder_id
    )
    current = await db.scalar(
        sa.select(sa.func.max(WorkoutTemplate.position)).where(
            WorkoutTemplate.user_id == user.id, in_folder
        )
    )
    return 0 if current is None else current + 1


async def _build_exercises(
    db: AsyncSession, user: User, items: Sequence[TemplateExerciseIn]
) -> list[TemplateExercise]:
    exercises = await get_visible_exercises(db, user, {item.exercise_id for item in items})
    groups = normalize_supersets([item.superset_group for item in items])
    result = []
    for position, item in enumerate(items):
        exercise = exercises[item.exercise_id]
        used_fields = tracking_fields(exercise.tracking)
        result.append(
            TemplateExercise(
                exercise_id=item.exercise_id, exercise=exercise, position=position,
                rest_seconds=item.rest_seconds, superset_group=groups[position], note=item.note,
                sets=[
                    TemplateSet(
                        position=number,
                        **{
                            field: getattr(values, field) if field in used_fields else None
                            for field in ("weight_kg", "reps", "duration_s")
                        },
                    )
                    for number, values in enumerate(item.sets)
                ],
            )
        )
    return result


async def list_templates(db: AsyncSession, user: User) -> TemplatesResponse:
    ensure_permission(user, Permission.workouts)
    folders = (
        await db.scalars(
            sa.select(TemplateFolder)
            .where(TemplateFolder.user_id == user.id)
            .order_by(TemplateFolder.position, TemplateFolder.id)
        )
    ).all()
    rows = (
        await db.scalars(
            sa.select(WorkoutTemplate)
            .where(WorkoutTemplate.user_id == user.id)
            .options(
                selectinload(WorkoutTemplate.exercises).selectinload(TemplateExercise.exercise)
            )
            .order_by(WorkoutTemplate.position, WorkoutTemplate.id)
        )
    ).all()
    return TemplatesResponse(
        folders=[FolderOut.model_validate(folder) for folder in folders],
        templates=[
            TemplateSummary(
                id=t.id, name=t.name, folder_id=t.folder_id, last_used_at=t.last_used_at,
                exercise_names=[item.exercise.name for item in t.exercises],
            )
            for t in rows
        ],
    )


async def create_folder(db: AsyncSession, user: User, payload: FolderIn) -> FolderOut:
    ensure_permission(user, Permission.workouts)
    current = await db.scalar(
        sa.select(sa.func.max(TemplateFolder.position)).where(TemplateFolder.user_id == user.id)
    )
    folder = TemplateFolder(
        user_id=user.id, name=payload.name, position=0 if current is None else current + 1
    )
    db.add(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


async def rename_folder(
    db: AsyncSession, user: User, folder_id: int, payload: FolderIn
) -> FolderOut:
    ensure_permission(user, Permission.workouts)
    folder = await own_folder(db, user, folder_id)
    folder.name = payload.name
    await db.commit()
    return FolderOut.model_validate(folder)


async def delete_folder(db: AsyncSession, user: User, folder_id: int) -> None:
    """Delete a folder; its templates move out of it (they are not deleted)."""
    ensure_permission(user, Permission.workouts)
    folder = await own_folder(db, user, folder_id)
    await db.execute(
        sa.update(WorkoutTemplate)
        .where(WorkoutTemplate.folder_id == folder.id)
        .values(folder_id=None)
        .execution_options(synchronize_session="fetch")
    )
    await db.delete(folder)
    await db.commit()


async def create_template(db: AsyncSession, user: User, payload: TemplateIn) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    if payload.folder_id is not None:
        await own_folder(db, user, payload.folder_id)
    template = WorkoutTemplate(
        user_id=user.id, folder_id=payload.folder_id, name=payload.name,
        position=await next_template_position(db, user, payload.folder_id),
        exercises=await _build_exercises(db, user, payload.exercises),
    )
    db.add(template)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def get_template(db: AsyncSession, user: User, template_id: int) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    return template_out(await own_template(db, user, template_id))


async def _move(
    db: AsyncSession, user: User, template: WorkoutTemplate, folder_id: int | None
) -> None:
    if folder_id == template.folder_id:
        return
    if folder_id is not None:
        await own_folder(db, user, folder_id)
    template.position = await next_template_position(db, user, folder_id)
    template.folder_id = folder_id


async def replace_template(
    db: AsyncSession, user: User, template_id: int, payload: TemplateIn
) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    template = await own_template(db, user, template_id)
    await _move(db, user, template, payload.folder_id)
    template.name = payload.name
    template.exercises = await _build_exercises(db, user, payload.exercises)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def patch_template(
    db: AsyncSession, user: User, template_id: int, payload: TemplatePatch
) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    template = await own_template(db, user, template_id)
    if "name" in payload.model_fields_set and payload.name is not None:
        template.name = payload.name
    if "folder_id" in payload.model_fields_set:
        await _move(db, user, template, payload.folder_id)
    await db.commit()
    return template_out(await own_template(db, user, template.id))


async def delete_template(db: AsyncSession, user: User, template_id: int) -> None:
    ensure_permission(user, Permission.workouts)
    await db.delete(await own_template(db, user, template_id))
    await db.commit()


async def duplicate_template(db: AsyncSession, user: User, template_id: int) -> TemplateOut:
    ensure_permission(user, Permission.workouts)
    source = await own_template(db, user, template_id)
    copy = WorkoutTemplate(
        user_id=user.id, folder_id=source.folder_id, name=f"{source.name} Copia"[:100],
        position=await next_template_position(db, user, source.folder_id),
        exercises=[
            TemplateExercise(
                exercise_id=item.exercise_id, exercise=item.exercise, position=item.position,
                rest_seconds=item.rest_seconds, superset_group=item.superset_group,
                note=item.note,
                sets=[
                    TemplateSet(
                        position=s.position, weight_kg=s.weight_kg, reps=s.reps,
                        duration_s=s.duration_s,
                    )
                    for s in item.sets
                ],
            )
            for item in source.exercises
        ],
    )
    db.add(copy)
    await db.commit()
    return template_out(await own_template(db, user, copy.id))

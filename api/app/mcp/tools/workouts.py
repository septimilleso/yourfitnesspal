"""MCP tools for the gym: exercises, workout templates and workout history.

No tool drives the live session: that happens in the app, at the gym.
"""

from datetime import datetime
from typing import Annotated, Any

import sqlalchemy as sa
from mcp.server.mcpserver import MCPServer
from pydantic import Field

from app.mcp.context import tool_scope
from app.models.workout import TemplateFolder
from app.schemas.workout import (
    FolderIn,
    TemplateExerciseIn,
    TemplateIn,
    TemplateOut,
    WorkoutOut,
)
from app.services import exercises as exercise_service
from app.services import templates, workouts
from app.services.gym_rules import format_set


def _exercise(item) -> dict[str, Any]:
    return {
        "exercise_id": item.id,
        "name": item.name,
        "equipment": item.equipment,
        "primary_muscles": item.primary_muscles,
        "tracking": item.tracking.value,
        "custom": item.custom,
    }


def _template(template: TemplateOut) -> dict[str, Any]:
    return {
        "template_id": template.id,
        "name": template.name,
        "folder_id": template.folder_id,
        "exercises": [
            {
                "exercise_id": item.exercise.id,
                "name": item.exercise.name,
                "tracking": item.exercise.tracking.value,
                "rest_seconds": item.rest_seconds,
                "superset_group": item.superset_group,
                "sets": [s.model_dump() for s in item.sets],
            }
            for item in template.exercises
        ],
    }


def _workout(workout: WorkoutOut) -> dict[str, Any]:
    return {
        "workout_id": workout.id,
        "name": workout.name,
        "status": workout.status.value,
        "started_at": workout.started_at.isoformat(),
        "finished_at": workout.finished_at.isoformat() if workout.finished_at else None,
        "exercises": [
            {
                "name": item.exercise.name,
                "sets": [
                    format_set(item.exercise.tracking, (s.weight_kg, s.reps, s.duration_s))
                    for s in item.sets
                ],
            }
            for item in workout.exercises
        ],
    }


def register_workout_tools(server: MCPServer) -> None:
    @server.tool(description=(
        "Search the exercise catalog (English names) plus the user's custom exercises. "
        "Optional filters: equipment (e.g. barbell, dumbbell, body only) and primary muscle "
        "(e.g. chest, quadriceps). Use exercise_id with create_workout_template."
    ))
    async def search_exercises(
        query: Annotated[str, Field(max_length=100)] = "",
        equipment: str | None = None,
        muscle: str | None = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 20,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            found = await exercise_service.search_exercises(
                scope.db, scope.user, q=query, equipment=equipment, muscle=muscle, limit=limit
            )
            return {"exercises": [_exercise(item) for item in found.items], "total": found.total}

    @server.tool(description="The user's workout template folders and templates.")
    async def list_workout_templates() -> dict[str, Any]:
        async with tool_scope() as scope:
            listing = await templates.list_templates(scope.db, scope.user)
            names = {folder.id: folder.name for folder in listing.folders}
            return {
                "folders": [{"folder_id": f.id, "name": f.name} for f in listing.folders],
                "templates": [
                    {
                        "template_id": t.id,
                        "name": t.name,
                        "folder": names.get(t.folder_id) if t.folder_id else None,
                        "exercises": t.exercise_names,
                        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
                    }
                    for t in listing.templates
                ],
            }

    @server.tool(description="One workout template with its exercises, sets and rest times.")
    async def get_workout_template(template_id: int) -> dict[str, Any]:
        async with tool_scope() as scope:
            return _template(await templates.get_template(scope.db, scope.user, template_id))

    @server.tool(description=(
        "Create a workout template. Each exercise needs exercise_id and at least one set "
        "(weight_kg + reps, reps only, or duration_s, matching the exercise's tracking); "
        "rest_seconds defaults to 90. Exercises with the same superset_group next to each "
        "other form a superset. `folder` is a folder name, created if missing. "
        "Confirm the plan with the user first."
    ))
    async def create_workout_template(
        name: Annotated[str, Field(min_length=1, max_length=100)],
        exercises: list[TemplateExerciseIn],
        folder: Annotated[str | None, Field(max_length=100)] = None,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            folder_id = None
            if folder and folder.strip():
                folder_id = await scope.db.scalar(
                    sa.select(TemplateFolder.id).where(
                        TemplateFolder.user_id == scope.user.id,
                        sa.func.lower(TemplateFolder.name) == folder.strip().lower(),
                    )
                )
                if folder_id is None:
                    created_folder = await templates.create_folder(
                        scope.db, scope.user, FolderIn(name=folder)
                    )
                    folder_id = created_folder.id
            template = await templates.create_template(
                scope.db, scope.user,
                TemplateIn(name=name, folder_id=folder_id, exercises=exercises),
            )
            await scope.audit("create_workout_template", {"template_id": template.id})
            return _template(template)

    @server.tool(description=(
        "Finished workouts, newest first. Pass `before` (from next_before) for older ones."
    ))
    async def list_workouts(
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
        before: datetime | None = None,
    ) -> dict[str, Any]:
        async with tool_scope() as scope:
            page = await workouts.list_history(scope.db, scope.user, before=before, limit=limit)
            return {
                "workouts": [
                    {
                        "workout_id": item.id,
                        "name": item.name,
                        "started_at": item.started_at.isoformat(),
                        "duration_min": round(
                            (item.finished_at - item.started_at).total_seconds() / 60
                        ),
                        "exercises": [e.model_dump() for e in item.exercises],
                    }
                    for item in page.items
                ],
                "next_before": page.next_before.isoformat() if page.next_before else None,
            }

    @server.tool(description="One workout with every set (e.g. '80 kg × 8').")
    async def get_workout(workout_id: int) -> dict[str, Any]:
        async with tool_scope() as scope:
            return _workout(await workouts.get_workout(scope.db, scope.user, workout_id))

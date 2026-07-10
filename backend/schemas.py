from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class SavedSelectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    attribute_filters: dict[str, Any]
    region_polygon: dict[str, Any] | None = None


class SavedSelectionSummary(BaseModel):
    id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SavedSelectionRead(SavedSelectionSummary):
    attribute_filters: dict[str, Any]
    region_polygon: dict[str, Any] | None

    model_config = {"from_attributes": True}


class SpreadsheetPayload(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class SpreadsheetSaveResponse(BaseModel):
    trees: dict[str, Any]
    analysis: dict[str, Any]

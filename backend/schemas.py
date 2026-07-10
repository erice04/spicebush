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


class PcaPoint(BaseModel):
    id: int
    pc1: float
    pc2: float
    sex: str | None
    sex_known: bool
    is_prediction: bool
    probability_female: float | None = None


class PcaLoading(BaseModel):
    variable: str
    label: str
    pc1: float
    pc2: float


class PcaResult(BaseModel):
    points: list[PcaPoint]
    loadings: list[PcaLoading]
    explained_variance_ratio: list[float]


class ConfusionMatrix(BaseModel):
    labels: list[str]
    matrix: list[list[int]]


class ClassificationPrediction(BaseModel):
    id: int
    predicted_sex: str
    probability_female: float
    is_prediction: bool
    evaluation: str
    actual_sex: str | None = None
    sex: str | None = None


class ClassificationResult(BaseModel):
    labeled_count: int
    unlabeled_count: int
    loocv_accuracy: float
    confusion_matrix: ConfusionMatrix
    loocv_predictions: list[ClassificationPrediction]
    predictions: list[ClassificationPrediction]


class PreprocessingInfo(BaseModel):
    feature_columns: list[str]
    labeled_sex_values: list[str]
    unlabeled_sex_values: list[str]
    imputed_features: dict[str, str]
    pca_sample_size: int
    classification_sample_size: int


class AnalysisResponse(BaseModel):
    pca: PcaResult
    classification: ClassificationResult
    preprocessing: PreprocessingInfo


class SpreadsheetPayload(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]


class SpreadsheetSaveResponse(BaseModel):
    trees: dict[str, Any]
    analysis: dict[str, Any]

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from sklearn.decomposition import PCA
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.model_selection import LeaveOneOut, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "spicebush.json"

FEATURE_COLUMNS = [
    "dbh_cm",
    "base_diameter_cm",
    "stem_count",
    "height_m",
]

FEATURE_LABELS = {
    "dbh_cm": "DBH (cm)",
    "base_diameter_cm": "Base diameter (cm)",
    "stem_count": "Stem count",
    "height_m": "Height (m)",
}

LABELED_SEX_VALUES = {"M", "F"}


def _parse_stem_count(value: str) -> float:
    if value == "M":
        return 3.0
    return float(int(value))


def _dataframe_from_collection(payload: dict[str, Any]) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for feature in payload["features"]:
        properties = feature["properties"]
        rows.append(
            {
                "id": int(properties["id"]),
                "sex": properties.get("sex"),
                "dbh_cm": properties.get("dbh_cm"),
                "base_diameter_cm": properties.get("base_diameter_cm"),
                "height_m": properties.get("height_m"),
                "stem_count_raw": str(properties.get("stem_count", "")).strip(),
            }
        )

    frame = pd.DataFrame(rows)
    frame["stem_count"] = frame["stem_count_raw"].map(_parse_stem_count)
    frame["dbh_cm"] = frame["dbh_cm"].fillna(0.0)
    frame["sex_known"] = frame["sex"].isin(LABELED_SEX_VALUES)
    return frame


def _load_dataframe() -> pd.DataFrame:
    with DATA_PATH.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    return _dataframe_from_collection(payload)


def _build_analysis(frame: pd.DataFrame) -> dict[str, Any]:
    pca = _run_pca(frame)
    classification = _run_classification(frame)

    probability_by_id = {
        item["id"]: item["probability_female"]
        for item in classification["loocv_predictions"]
    }
    probability_by_id.update(
        {
            item["id"]: item["probability_female"]
            for item in classification["predictions"]
        }
    )

    for point in pca["points"]:
        point["probability_female"] = (
            float(probability_by_id[point["id"]])
            if point["id"] in probability_by_id
            else None
        )
        point["is_prediction"] = not point["sex_known"]

    return {
        "pca": pca,
        "classification": classification,
        "preprocessing": {
            "feature_columns": FEATURE_COLUMNS,
            "labeled_sex_values": sorted(LABELED_SEX_VALUES),
            "unlabeled_sex_values": sorted(
                set(frame.loc[~frame["sex_known"], "sex"].dropna().unique())
            ),
            "imputed_features": {
                "dbh_cm": "missing/NA treated as 0",
                "stem_count": "'M' (multiple stems) treated as 3",
            },
            "pca_sample_size": int(len(frame)),
            "classification_sample_size": int(frame["sex_known"].sum()),
        },
    }


def compute_analysis_from_collection(payload: dict[str, Any]) -> dict[str, Any]:
    return _build_analysis(_dataframe_from_collection(payload))


@lru_cache(maxsize=1)
def compute_analysis() -> dict[str, Any]:
    return _build_analysis(_load_dataframe())


def _run_pca(frame: pd.DataFrame) -> dict[str, Any]:
    features = frame[FEATURE_COLUMNS].to_numpy(dtype=float)
    scaler = StandardScaler()
    scaled = scaler.fit_transform(features)

    correlation = np.corrcoef(scaled, rowvar=False)

    pca = PCA(n_components=len(FEATURE_COLUMNS))
    coordinates = pca.fit_transform(scaled)
    loadings = pca.components_.T * np.sqrt(pca.explained_variance_)

    points: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        points.append(
            {
                "id": int(row["id"]),
                "pc1": float(coordinates[index, 0]),
                "pc2": float(coordinates[index, 1]),
                "sex": row["sex"],
                "sex_known": bool(row["sex_known"]),
            }
        )

    loading_rows = [
        {
            "variable": column,
            "label": FEATURE_LABELS[column],
            "pc1": float(loadings[column_index, 0]),
            "pc2": float(loadings[column_index, 1]),
            "weight_pc1": float(pca.components_[0, column_index]),
            "weight_pc2": float(pca.components_[1, column_index]),
        }
        for column_index, column in enumerate(FEATURE_COLUMNS)
    ]

    return {
        "points": points,
        "loadings": loading_rows,
        "explained_variance_ratio": [
            float(value) for value in pca.explained_variance_ratio_
        ],
        "correlation": {
            "variables": FEATURE_COLUMNS,
            "labels": [
                FEATURE_LABELS[column].split(" (")[0]
                for column in FEATURE_COLUMNS
            ],
            "matrix": correlation.round(4).tolist(),
        },
    }


def _run_classification(frame: pd.DataFrame) -> dict[str, Any]:
    labeled = frame[frame["sex_known"]].copy()
    unlabeled = frame[~frame["sex_known"]].copy()

    x_labeled = labeled[FEATURE_COLUMNS].to_numpy(dtype=float)
    y_labeled = labeled["sex"].to_numpy()

    pipeline = Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                LogisticRegression(max_iter=1000, random_state=0),
            ),
        ]
    )

    loo = LeaveOneOut()
    predicted_labels = cross_val_predict(pipeline, x_labeled, y_labeled, cv=loo)
    predicted_probabilities = cross_val_predict(
        pipeline,
        x_labeled,
        y_labeled,
        cv=loo,
        method="predict_proba",
    )

    label_order = sorted(np.unique(y_labeled), key=lambda value: value != "F")
    female_index = label_order.index("F")
    loocv_points: list[dict[str, Any]] = []
    for index, row in labeled.reset_index(drop=True).iterrows():
        loocv_points.append(
            {
                "id": int(row["id"]),
                "actual_sex": row["sex"],
                "predicted_sex": predicted_labels[index],
                "probability_female": float(predicted_probabilities[index, female_index]),
                "is_prediction": True,
                "evaluation": "loocv",
            }
        )

    accuracy = float(accuracy_score(y_labeled, predicted_labels))
    matrix = confusion_matrix(y_labeled, predicted_labels, labels=label_order)

    pipeline.fit(x_labeled, y_labeled)

    x_unlabeled = unlabeled[FEATURE_COLUMNS].to_numpy(dtype=float)
    unlabeled_probabilities = pipeline.predict_proba(x_unlabeled)
    unlabeled_labels = pipeline.predict(x_unlabeled)

    predictions: list[dict[str, Any]] = []
    for index, row in unlabeled.reset_index(drop=True).iterrows():
        predictions.append(
            {
                "id": int(row["id"]),
                "sex": row["sex"],
                "predicted_sex": unlabeled_labels[index],
                "probability_female": float(unlabeled_probabilities[index, female_index]),
                "is_prediction": True,
                "evaluation": "model",
            }
        )

    return {
        "labeled_count": int(len(labeled)),
        "unlabeled_count": int(len(unlabeled)),
        "loocv_accuracy": accuracy,
        "confusion_matrix": {
            "labels": label_order,
            "matrix": matrix.astype(int).tolist(),
        },
        "loocv_predictions": loocv_points,
        "predictions": predictions,
    }

"""Read/write field plants + dated measurements (SQLite locally, Neon in production)."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

import pandas as pd
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from analysis import compute_analysis, compute_analysis_from_collection
from database import SessionLocal, engine
from models import CachedAnalysis, FieldMeasurement, FieldPlant

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "Spicebush.xlsx"
DATA_DIR = ROOT / "data"
GEOJSON_PATH = DATA_DIR / "spicebush.geojson"
JSON_PATH = DATA_DIR / "spicebush.json"
PUBLIC_JSON_PATH = ROOT / "frontend" / "public" / "data" / "spicebush.json"

ANALYSIS_OUTPUT_PATHS = [
    DATA_DIR / "analysis.json",
    ROOT / "frontend" / "public" / "data" / "analysis.json",
    ROOT / "frontend" / "src" / "data" / "analysis.json",
]

SPREADSHEET_COLUMNS = [
    "ID",
    "Date",
    "N (41 20')",
    "W (72 54')",
    "Stem #",
    "Dbase (cm)",
    "DBH (cm)",
    "Height (m)",
    "Sex",
    "Notes",
]

ALLOWED_SEX = {"M", "F", "J", "U"}
YM_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")

N_DEG, N_MIN = 41, 20
W_DEG, W_MIN = 72, 54


def parse_minutes_offset(raw: int | float, base_minutes: int) -> float:
    return base_minutes + int(raw) / 10000.0


def minutes_to_decimal(degrees: int, minutes: float) -> float:
    return degrees + minutes / 60.0


def parse_latitude(raw: int | float) -> float:
    return minutes_to_decimal(N_DEG, parse_minutes_offset(raw, N_MIN))


def parse_longitude(raw: int | float) -> float:
    return -minutes_to_decimal(W_DEG, parse_minutes_offset(raw, W_MIN))


def default_observed_ym_for_id(plant_id: int) -> str:
    """IDs 1–56 → March 2025; later IDs → June 2025."""
    return "2025-03" if plant_id <= 56 else "2025-06"


def month_index(ym: str) -> int:
    year, month = ym.split("-")
    return int(year) * 12 + int(month)


def months_between(earlier: str, later: str) -> int:
    return month_index(later) - month_index(earlier)


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, str) and value.strip() == "":
        return True
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    return False


def _cell_to_json(value: Any) -> Any:
    if _is_blank(value):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    text = str(value).strip()
    return text if text else None


def _parse_optional_float(value: Any, field: str, row_index: int) -> float | None:
    if _is_blank(value):
        return None
    text = str(value).strip()
    if text.lower() in {"na", "n/a"}:
        return None
    try:
        return float(text)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Row {row_index + 1}: {field} must be numeric") from exc


def _parse_required_number(value: Any, field: str, row_index: int) -> float:
    if _is_blank(value):
        raise ValueError(f"Row {row_index + 1}: {field} is required")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Row {row_index + 1}: {field} must be numeric") from exc


def _normalize_ym(value: Any, plant_id: int, row_index: int) -> str:
    if _is_blank(value):
        return default_observed_ym_for_id(plant_id)
    text = str(value).strip()
    if YM_RE.match(text):
        return text
    # Accept Excel date-like values.
    try:
        parsed = pd.to_datetime(text)
        return f"{parsed.year:04d}-{parsed.month:02d}"
    except Exception as exc:
        raise ValueError(
            f"Row {row_index + 1}: Date must be YYYY-MM (got {text!r})"
        ) from exc


def validate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not rows:
        raise ValueError("Spreadsheet must include at least one row")

    normalized: list[dict[str, Any]] = []
    seen_keys: set[tuple[int, str]] = set()
    coords_by_id: dict[int, tuple[float, float]] = {}
    prev_id: int | None = None

    for index, raw in enumerate(rows):
        row = {column: raw.get(column) for column in SPREADSHEET_COLUMNS}

        # Extra measurements may omit ID/GPS; inherit from the previous plant row.
        if _is_blank(row["ID"]):
            if prev_id is None:
                raise ValueError(f"Row {index + 1}: ID is required")
            tree_id = prev_id
        else:
            try:
                tree_id = int(float(row["ID"]))
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Row {index + 1}: ID must be an integer") from exc
            prev_id = tree_id

        observed_ym = _normalize_ym(row["Date"], tree_id, index)
        key = (tree_id, observed_ym)
        if key in seen_keys:
            raise ValueError(
                f"Duplicate measurement for ID {tree_id} on {observed_ym}"
            )
        seen_keys.add(key)

        if _is_blank(row["N (41 20')"]):
            if tree_id not in coords_by_id:
                raise ValueError(f"Row {index + 1}: N (41 20') is required")
            n_value = coords_by_id[tree_id][0]
        else:
            n_value = _parse_required_number(row["N (41 20')"], "N (41 20')", index)

        if _is_blank(row["W (72 54')"]):
            if tree_id not in coords_by_id:
                raise ValueError(f"Row {index + 1}: W (72 54') is required")
            w_value = coords_by_id[tree_id][1]
        else:
            w_value = _parse_required_number(row["W (72 54')"], "W (72 54')", index)

        if tree_id in coords_by_id:
            prev_n, prev_w = coords_by_id[tree_id]
            if abs(prev_n - n_value) > 1e-6 or abs(prev_w - w_value) > 1e-6:
                raise ValueError(
                    f"Row {index + 1}: N/W for ID {tree_id} must match other rows"
                )
        else:
            coords_by_id[tree_id] = (n_value, w_value)

        if _is_blank(row["Stem #"]):
            raise ValueError(f"Row {index + 1}: Stem # is required")
        stem = str(row["Stem #"]).strip()

        sex_value = None if _is_blank(row["Sex"]) else str(row["Sex"]).strip().upper()
        if sex_value is not None and sex_value not in ALLOWED_SEX:
            raise ValueError(
                f"Row {index + 1}: Sex must be one of M, F, J, U (got {sex_value!r})"
            )

        notes = None if _is_blank(row["Notes"]) else str(row["Notes"]).strip()
        dbase = _parse_optional_float(row["Dbase (cm)"], "Dbase (cm)", index)
        dbh = _parse_optional_float(row["DBH (cm)"], "DBH (cm)", index)
        height = _parse_optional_float(row["Height (m)"], "Height (m)", index)

        normalized.append(
            {
                "ID": tree_id,
                "Date": observed_ym,
                "N (41 20')": int(n_value) if float(n_value).is_integer() else n_value,
                "W (72 54')": int(w_value) if float(w_value).is_integer() else w_value,
                "Stem #": stem,
                "Dbase (cm)": dbase,
                "DBH (cm)": dbh,
                "Height (m)": height,
                "Sex": sex_value,
                "Notes": notes,
            }
        )

    return normalized


def _stem_numeric(value: str | None) -> float | None:
    if value is None or str(value).strip() == "":
        return None
    text = str(value).strip()
    if text.upper() == "M":
        return 3.0
    try:
        return float(int(text))
    except ValueError:
        try:
            return float(text)
        except ValueError:
            return None


def _rate(
    earlier: float | None,
    later: float | None,
    months: int,
) -> float | None:
    if months <= 0 or earlier is None or later is None:
        return None
    return (later - earlier) / months


def compute_growth(measurements: list[dict[str, Any]]) -> dict[str, float | None]:
    ordered = sorted(measurements, key=lambda item: item["observed_ym"])
    empty = {
        "dbh_cm_per_month": None,
        "base_diameter_cm_per_month": None,
        "stem_count_per_month": None,
        "height_m_per_month": None,
    }
    if len(ordered) < 2:
        return empty

    first, last = ordered[0], ordered[-1]
    months = months_between(first["observed_ym"], last["observed_ym"])
    return {
        "dbh_cm_per_month": _rate(first.get("dbh_cm"), last.get("dbh_cm"), months),
        "base_diameter_cm_per_month": _rate(
            first.get("base_diameter_cm"),
            last.get("base_diameter_cm"),
            months,
        ),
        "stem_count_per_month": _rate(
            _stem_numeric(first.get("stem_count")),
            _stem_numeric(last.get("stem_count")),
            months,
        ),
        "height_m_per_month": _rate(
            first.get("height_m"),
            last.get("height_m"),
            months,
        ),
    }


def read_xlsx_rows(path: Path = XLSX_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(f"Spreadsheet not found: {path}")

    frame = pd.read_excel(path)
    # Support legacy sheets without Date.
    if "Date" not in frame.columns:
        frame["Date"] = [
            default_observed_ym_for_id(int(row["ID"])) for _, row in frame.iterrows()
        ]

    missing = [column for column in SPREADSHEET_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Spreadsheet missing columns: {', '.join(missing)}")

    rows: list[dict[str, Any]] = []
    for _, row in frame.iterrows():
        rows.append({column: _cell_to_json(row[column]) for column in SPREADSHEET_COLUMNS})
    return rows


def _row_from_plant_and_measurement(
    plant: FieldPlant,
    measurement: FieldMeasurement,
) -> dict[str, Any]:
    n_coord = plant.n_coord
    w_coord = plant.w_coord
    return {
        "ID": plant.id,
        "Date": measurement.observed_ym,
        "N (41 20')": int(n_coord) if float(n_coord).is_integer() else n_coord,
        "W (72 54')": int(w_coord) if float(w_coord).is_integer() else w_coord,
        "Stem #": measurement.stem_count,
        "Dbase (cm)": measurement.base_diameter_cm,
        "DBH (cm)": measurement.dbh_cm if measurement.dbh_cm is not None else "NA",
        "Height (m)": measurement.height_m,
        "Sex": measurement.sex,
        "Notes": measurement.notes,
    }


def load_rows_from_db(db: Session | None = None) -> list[dict[str, Any]]:
    owns_session = db is None
    session = db or SessionLocal()
    try:
        plants = {
            plant.id: plant
            for plant in session.query(FieldPlant).order_by(FieldPlant.id.asc()).all()
        }
        measurements = (
            session.query(FieldMeasurement)
            .order_by(FieldMeasurement.plant_id.asc(), FieldMeasurement.observed_ym.asc())
            .all()
        )
        rows: list[dict[str, Any]] = []
        for item in measurements:
            plant = plants.get(item.plant_id)
            if plant is None:
                continue
            rows.append(_row_from_plant_and_measurement(plant, item))
        return rows
    finally:
        if owns_session:
            session.close()


def rows_to_feature_collection(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Build GeoJSON using the latest measurement per plant."""
    by_id: dict[int, list[dict[str, Any]]] = {}
    coords: dict[int, tuple[float, float]] = {}

    for row in rows:
        plant_id = int(row["ID"])
        coords[plant_id] = (float(row["N (41 20')"]), float(row["W (72 54')"]))
        measurement = {
            "observed_ym": str(row["Date"]),
            "stem_count": str(row["Stem #"]).strip(),
            "base_diameter_cm": (
                None if _is_blank(row["Dbase (cm)"]) else float(row["Dbase (cm)"])
            ),
            "dbh_cm": (
                None
                if _is_blank(row["DBH (cm)"])
                or str(row["DBH (cm)"]).strip().lower() in {"na", "n/a"}
                else float(row["DBH (cm)"])
            ),
            "height_m": (
                None if _is_blank(row["Height (m)"]) else float(row["Height (m)"])
            ),
            "sex": row["Sex"],
            "notes": row["Notes"],
        }
        by_id.setdefault(plant_id, []).append(measurement)

    features: list[dict[str, Any]] = []
    for plant_id in sorted(by_id):
        measurements = sorted(by_id[plant_id], key=lambda item: item["observed_ym"])
        latest = measurements[-1]
        n_coord, w_coord = coords[plant_id]
        lat = parse_latitude(n_coord)
        lon = parse_longitude(w_coord)
        growth = compute_growth(measurements)
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "id": plant_id,
                    "stem_count": latest["stem_count"],
                    "base_diameter_cm": latest["base_diameter_cm"],
                    "dbh_cm": latest["dbh_cm"],
                    "height_m": latest["height_m"],
                    "sex": latest["sex"],
                    "notes": latest["notes"],
                    "observed_ym": latest["observed_ym"],
                    "measurements": measurements,
                    "growth": growth,
                },
            }
        )

    return {"type": "FeatureCollection", "features": features}


def load_feature_collection(db: Session | None = None) -> dict[str, Any]:
    return rows_to_feature_collection(load_rows_from_db(db))


def read_spreadsheet() -> dict[str, Any]:
    rows = load_rows_from_db()
    if not rows:
        raise FileNotFoundError(
            "No field data in the database yet. Restart the API to seed from Spicebush.xlsx."
        )
    return {"columns": list(SPREADSHEET_COLUMNS), "rows": rows}


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, indent=2, allow_nan=False),
        encoding="utf-8",
    )


def _best_effort_write_local_artifacts(
    collection: dict[str, Any],
    analysis: dict[str, Any],
    rows: list[dict[str, Any]],
) -> None:
    try:
        export_rows = []
        for row in rows:
            export = dict(row)
            if export.get("DBH (cm)") is None:
                export["DBH (cm)"] = "NA"
            export_rows.append(export)
        frame = pd.DataFrame(export_rows, columns=SPREADSHEET_COLUMNS)
        frame.to_excel(XLSX_PATH, index=False)
    except Exception:
        pass

    try:
        _write_json(JSON_PATH, collection)
        _write_json(PUBLIC_JSON_PATH, collection)
        _write_json(GEOJSON_PATH, collection)
    except Exception:
        pass

    try:
        text = json.dumps(analysis, indent=2, allow_nan=False)
        for path in ANALYSIS_OUTPUT_PATHS:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
    except Exception:
        pass


def _replace_all(db: Session, rows: list[dict[str, Any]]) -> None:
    db.query(FieldMeasurement).delete()
    db.query(FieldPlant).delete()

    plants: dict[int, FieldPlant] = {}
    for row in rows:
        plant_id = int(row["ID"])
        if plant_id not in plants:
            plants[plant_id] = FieldPlant(
                id=plant_id,
                n_coord=float(row["N (41 20')"]),
                w_coord=float(row["W (72 54')"]),
            )
            db.add(plants[plant_id])

        dbh = row["DBH (cm)"]
        dbh_value = (
            None
            if _is_blank(dbh) or str(dbh).strip().lower() in {"na", "n/a"}
            else float(dbh)
        )
        db.add(
            FieldMeasurement(
                plant_id=plant_id,
                observed_ym=str(row["Date"]),
                stem_count=str(row["Stem #"]).strip(),
                base_diameter_cm=(
                    None if _is_blank(row["Dbase (cm)"]) else float(row["Dbase (cm)"])
                ),
                dbh_cm=dbh_value,
                height_m=(
                    None if _is_blank(row["Height (m)"]) else float(row["Height (m)"])
                ),
                sex=row["Sex"],
                notes=row["Notes"],
            )
        )
    db.commit()


def _store_analysis_cache(db: Session, analysis: dict[str, Any]) -> None:
    payload = json.dumps(analysis, allow_nan=False)
    cached = db.get(CachedAnalysis, 1)
    if cached is None:
        db.add(CachedAnalysis(id=1, payload=payload))
    else:
        cached.payload = payload
    db.commit()


def get_cached_analysis() -> dict[str, Any] | None:
    db = SessionLocal()
    try:
        cached = db.get(CachedAnalysis, 1)
        if cached is None:
            return None
        return json.loads(cached.payload)
    finally:
        db.close()


def get_or_compute_analysis() -> dict[str, Any]:
    cached = get_cached_analysis()
    if cached is not None:
        return cached

    collection = load_feature_collection()
    if not collection["features"]:
        compute_analysis.cache_clear()
        return compute_analysis()

    analysis = compute_analysis_from_collection(collection)
    db = SessionLocal()
    try:
        _store_analysis_cache(db, analysis)
    finally:
        db.close()
    return analysis


def save_spreadsheet_and_refresh(rows: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = validate_rows(rows)
    collection = rows_to_feature_collection(normalized)
    analysis = compute_analysis_from_collection(collection)

    db = SessionLocal()
    try:
        _replace_all(db, normalized)
        _store_analysis_cache(db, analysis)
    finally:
        db.close()

    compute_analysis.cache_clear()
    _best_effort_write_local_artifacts(collection, analysis, normalized)
    return {"trees": collection, "analysis": analysis}


def _migrate_legacy_individuals(db: Session) -> bool:
    """Copy old field_individuals rows into plants + measurements if needed."""
    inspector = inspect(engine)
    if "field_individuals" not in inspector.get_table_names():
        return False
    if db.query(FieldPlant).count() > 0:
        return False

    result = db.execute(text("SELECT * FROM field_individuals"))
    legacy_rows = result.mappings().all()
    if not legacy_rows:
        return False

    for legacy in legacy_rows:
        plant_id = int(legacy["id"])
        db.add(
            FieldPlant(
                id=plant_id,
                n_coord=float(legacy["n_coord"]),
                w_coord=float(legacy["w_coord"]),
            )
        )
        db.add(
            FieldMeasurement(
                plant_id=plant_id,
                observed_ym=default_observed_ym_for_id(plant_id),
                stem_count=str(legacy["stem_count"]),
                base_diameter_cm=legacy["base_diameter_cm"],
                dbh_cm=legacy["dbh_cm"],
                height_m=legacy["height_m"],
                sex=legacy["sex"],
                notes=legacy["notes"],
            )
        )
    db.commit()
    return True


def seed_database_if_empty() -> int:
    from database import Base

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        migrated = _migrate_legacy_individuals(db)
        count = db.query(FieldPlant).count()
        if count > 0:
            if migrated or db.get(CachedAnalysis, 1) is None:
                analysis = compute_analysis_from_collection(load_feature_collection(db))
                _store_analysis_cache(db, analysis)
                compute_analysis.cache_clear()
            return count

        if not XLSX_PATH.exists():
            raise FileNotFoundError(
                f"Database empty and spreadsheet not found at {XLSX_PATH}"
            )

        raw_rows = read_xlsx_rows(XLSX_PATH)
        normalized = validate_rows(raw_rows)
        _replace_all(db, normalized)
        collection = rows_to_feature_collection(normalized)
        analysis = compute_analysis_from_collection(collection)
        _store_analysis_cache(db, analysis)
        _best_effort_write_local_artifacts(collection, analysis, normalized)
        compute_analysis.cache_clear()
        return len({row["ID"] for row in normalized})
    finally:
        db.close()

import json
import os

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from database import Base, engine, get_db
from models import SavedSelection
from schemas import (
    AnalysisResponse,
    SavedSelectionCreate,
    SavedSelectionRead,
    SavedSelectionSummary,
    SpreadsheetPayload,
    SpreadsheetSaveResponse,
)
from spreadsheet import (
    get_or_compute_analysis,
    load_feature_collection,
    read_spreadsheet,
    save_spreadsheet_and_refresh,
    seed_database_if_empty,
)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Spicebush API", version="1.0.0")

allowed_origins = os.getenv(
    "CORS_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in allowed_origins if origin.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_seed() -> None:
    try:
        seeded = seed_database_if_empty()
        print(f"Field data ready ({seeded} individuals)")
    except Exception as exc:
        print(f"Warning: could not seed field data: {exc}")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/analysis")
def get_analysis():
    try:
        return get_or_compute_analysis()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/data/trees")
def get_trees():
    try:
        collection = load_feature_collection()
        if not collection["features"]:
            raise HTTPException(status_code=404, detail="No field data in database")
        return collection
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/data/spreadsheet", response_model=SpreadsheetPayload)
def get_spreadsheet():
    try:
        return read_spreadsheet()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.put("/api/data/spreadsheet", response_model=SpreadsheetSaveResponse)
def put_spreadsheet(payload: SpreadsheetPayload):
    try:
        return save_spreadsheet_and_refresh(payload.rows)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to save spreadsheet: {exc}",
        ) from exc


@app.get("/api/selections", response_model=list[SavedSelectionSummary])
def list_selections(db: Session = Depends(get_db)):
    return (
        db.query(SavedSelection)
        .order_by(SavedSelection.created_at.desc())
        .all()
    )


@app.get("/api/selections/{selection_id}", response_model=SavedSelectionRead)
def get_selection(selection_id: int, db: Session = Depends(get_db)):
    row = db.get(SavedSelection, selection_id)
    if not row:
        raise HTTPException(status_code=404, detail="Selection not found")
    return _to_read(row)


@app.post("/api/selections", response_model=SavedSelectionRead, status_code=201)
def create_selection(payload: SavedSelectionCreate, db: Session = Depends(get_db)):
    existing = (
        db.query(SavedSelection)
        .filter(SavedSelection.name == payload.name.strip())
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="A selection with this name already exists")

    row = SavedSelection(
        name=payload.name.strip(),
        attribute_filters=json.dumps(payload.attribute_filters),
        region_polygon=(
            json.dumps(payload.region_polygon) if payload.region_polygon else None
        ),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_read(row)


@app.delete("/api/selections/{selection_id}", status_code=204)
def delete_selection(selection_id: int, db: Session = Depends(get_db)):
    row = db.get(SavedSelection, selection_id)
    if not row:
        raise HTTPException(status_code=404, detail="Selection not found")
    db.delete(row)
    db.commit()


def _to_read(row: SavedSelection) -> SavedSelectionRead:
    return SavedSelectionRead(
        id=row.id,
        name=row.name,
        created_at=row.created_at,
        attribute_filters=json.loads(row.attribute_filters),
        region_polygon=(
            json.loads(row.region_polygon) if row.region_polygon else None
        ),
    )

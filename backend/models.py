from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class SavedSelection(Base):
    __tablename__ = "saved_selections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    attribute_filters: Mapped[str] = mapped_column(Text, nullable=False)
    region_polygon: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )


class FieldPlant(Base):
    """Stable plant identity and GPS (N/W minute offsets)."""

    __tablename__ = "field_plants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    n_coord: Mapped[float] = mapped_column(Float, nullable=False)
    w_coord: Mapped[float] = mapped_column(Float, nullable=False)


class FieldMeasurement(Base):
    """One month-stamped field observation for a plant."""

    __tablename__ = "field_measurements"
    __table_args__ = (
        UniqueConstraint("plant_id", "observed_ym", name="uq_plant_observed_ym"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    plant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    observed_ym: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    stem_count: Mapped[str] = mapped_column(String(32), nullable=False)
    base_diameter_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    dbh_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    height_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    sex: Mapped[str | None] = mapped_column(String(8), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class CachedAnalysis(Base):
    """Singleton cached analysis payload (id=1)."""

    __tablename__ = "cached_analysis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

"""
Parse Spicebush field data from Excel into a GeoDataFrame and export GeoJSON.

Coordinate encoding:
  - Column headers give degrees and whole minutes: 41°20' N, 72°54' W
  - Cell values extend minutes with four decimal digits (value / 10000):
      e.g. N=1577 → 20.1577' → 41°20'09.46" N
           W=5881 → 54.5881' → 72°54'35.29" W
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).resolve().parent.parent
XLSX_PATH = ROOT / "Spicebush.xlsx"
OUTPUT_PATH = ROOT / "data" / "spicebush.geojson"

N_DEG, N_MIN = 41, 20
W_DEG, W_MIN = 72, 54


def parse_minutes_offset(raw: int | float, base_minutes: int) -> float:
    """Decode cell value as fractional minutes added to the column's minute prefix."""
    return base_minutes + int(raw) / 10000.0


def minutes_to_decimal(degrees: int, minutes: float) -> float:
    return degrees + minutes / 60.0


def parse_latitude(raw: int | float) -> float:
    minutes = parse_minutes_offset(raw, N_MIN)
    return minutes_to_decimal(N_DEG, minutes)


def parse_longitude(raw: int | float) -> float:
    minutes = parse_minutes_offset(raw, W_MIN)
    return -minutes_to_decimal(W_DEG, minutes)


def normalize_dbh(value) -> float | None:
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text.lower() in {"na", "n/a", ""}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def load_field_data(path: Path = XLSX_PATH) -> gpd.GeoDataFrame:
    df = pd.read_excel(path)

    records = []
    for _, row in df.iterrows():
        lat = parse_latitude(row["N (41 20')"])
        lon = parse_longitude(row["W (72 54')"])
        records.append(
            {
                "id": int(row["ID"]),
                "latitude": lat,
                "longitude": lon,
                "stem_count": str(row["Stem #"]).strip(),
                "base_diameter_cm": (
                    None if pd.isna(row["Dbase (cm)"]) else float(row["Dbase (cm)"])
                ),
                "dbh_cm": normalize_dbh(row["DBH (cm)"]),
                "height_m": (
                    None if pd.isna(row["Height (m)"]) else float(row["Height (m)"])
                ),
                "sex": None if pd.isna(row["Sex"]) else str(row["Sex"]).strip(),
                "notes": None if pd.isna(row["Notes"]) else str(row["Notes"]).strip(),
                "geometry": Point(lon, lat),
            }
        )

    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
    return gdf


def to_json_value(value):
    """Convert pandas/numpy missing values to JSON-safe null."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if pd.isna(value):
        return None
    return value


def export_geojson(gdf: gpd.GeoDataFrame, path: Path = OUTPUT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(path, driver="GeoJSON")

    # Also write a lightweight JSON copy for the frontend (no GIS deps needed at runtime)
    features = []
    for _, row in gdf.iterrows():
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [row["longitude"], row["latitude"]],
                },
                "properties": {
                    "id": int(row["id"]),
                    "stem_count": row["stem_count"],
                    "base_diameter_cm": to_json_value(row["base_diameter_cm"]),
                    "dbh_cm": to_json_value(row["dbh_cm"]),
                    "height_m": to_json_value(row["height_m"]),
                    "sex": to_json_value(row["sex"]),
                    "notes": to_json_value(row["notes"]),
                },
            }
        )

    collection = {"type": "FeatureCollection", "features": features}
    json_path = path.with_suffix(".json")
    json_path.write_text(
        json.dumps(collection, indent=2, allow_nan=False),
        encoding="utf-8",
    )
    print(f"Wrote {len(gdf)} trees to {path}")
    print(f"Wrote {len(gdf)} trees to {json_path}")


def main() -> None:
    gdf = load_field_data()
    print(f"Loaded {len(gdf)} trees")
    print(
        f"Lat range: {gdf['latitude'].min():.6f} – {gdf['latitude'].max():.6f}"
    )
    print(
        f"Lon range: {gdf['longitude'].min():.6f} – {gdf['longitude'].max():.6f}"
    )
    export_geojson(gdf)


if __name__ == "__main__":
    main()

# Spicebush Field Survey Tool

An interactive web app for mapping, analyzing, and managing field data on Northern spicebush (*Lindera benzoin*) at East Rock Park, New Haven, CT. Built on top of a Yale School of the Environment census of the species.

**Live app:** https://spicebush.onrender.com/

---

## Overview

Spicebush is dioecious — individual plants are either male or female — but sex is only visually obvious when plants are flowering or fruiting. This project explores whether sex can be predicted from morphology (trunk diameter, base diameter, stem count, height) when flowers or fruit aren't present, while also serving as a practical tool for planning and recording field surveys.

## Features

**Map**
- Interactive map of surveyed plants on outdoor/satellite basemaps
- Hover for quick ID, click for full detail card
- Density heatmap toggle

**Selection & filtering**
- Filter by sex (including predicted sex for unlabeled plants), stem count, base diameter, DBH, and height
- Draw a custom region on the map to select plants within it
- Save named filter presets for later use

**Route planning**
- Generates a walking route through currently visible/selected plants
- Nearest-neighbor construction with 2-opt refinement for a practical field walking order

**Analysis**
- PCA biplot of morphology, linked to map selection
- Correlation heatmap and loadings
- Logistic regression model predicting sex from morphology, validated with leave-one-out cross-validation (LOOCV)
- Mid-confidence predictions flagged as uncertain rather than presented as fact

**Data editor**
- Spreadsheet view for entering new measurements or adding new plants
- CSV/Excel import and export
- Saving triggers a recomputation of the analysis and refreshes the map

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router |
| Mapping | Mapbox GL JS, Mapbox Draw, Turf.js |
| Visualization | D3.js, SheetJS |
| Backend | FastAPI, Uvicorn |
| Database | SQLite (local), Neon Postgres (production) |
| ML/Stats | scikit-learn, NumPy, pandas |
| Deployment | Render |

## Architecture

The app is designed to stay usable even when the backend is cold-starting on free-tier hosting:

1. The map loads instantly from a bundled static GeoJSON file
2. It then refreshes in the background from the live API once available
3. Analysis results fall back in this order: live API → cached static file → bundled JSON

Editing data, saving filters, and other write operations require the live API and show a loading indicator while it wakes up.

## Data model

- **Plants** — ID and GPS location
- **Measurements** — plant ID, date, stem count, base diameter, DBH, height, sex, notes
- **Saved selections** — name, filter criteria, optional drawn region
- **Cached analysis** — most recent PCA and classification results

GPS coordinates are stored as minute offsets from two fixed reference points and converted to standard lat/lon. Plants surveyed on multiple dates use their most recent measurement on the map, with growth calculated between visits.

## Known limitations

- The morphology-to-sex signal is real but weak — this is called out directly in the app, not oversold
- No authentication; fine for a small research tool, not for multi-tenant use
- No automated tests yet
- Free-tier hosting means occasional cold starts on the API

## Possible next steps

- Add authentication/roles for data editing
- Add test coverage and CI
- Improve offline support

---

Built from a Yale School of the Environment field study on spicebush morphology between March 2025 - August 2025.

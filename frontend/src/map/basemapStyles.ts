import type { BasemapStyle } from "../types";
import type { Map as MapboxMap, AnyLayer, RasterSourceSpecification } from "mapbox-gl";

/**
 * Basemap strategy (3 options, all Mapbox GL):
 * - Topo: Mapbox Outdoors.
 * - Summer: CT ECO NAIP 2023 leaf-on aerial (~0.6 m) — green canopy season.
 * - Spring: CT ECO 2023 3″ statewide ortho — sharper, early-season flight.
 *
 * Mapbox Satellite Streets is not used: in this area it reads as winter/leaf-off.
 */

const TERRAIN_STYLE_URL = "mapbox://styles/mapbox/outdoors-v12";
/** Streets-only base so we can drape CT aerials under vector labels. */
const LABELS_STYLE_URL = "mapbox://styles/mapbox/streets-v12";

export const CT_ORTHO_SOURCE_ID = "ct-ortho-2023";
export const CT_NAIP_SOURCE_ID = "ct-naip-2023";
export const ESRI_IMAGERY_SOURCE_ID = "esri-world-imagery";
export const CT_ORTHO_LAYER_ID = "ct-ortho-2023";
export const CT_NAIP_LAYER_ID = "ct-naip-2023";
export const ESRI_IMAGERY_LAYER_ID = "esri-world-imagery";

const CT_ORTHO_TILES =
  "https://cteco.uconn.edu/ctraster/rest/services/images/Ortho_2023_tiled/ImageServer/tile/{z}/{y}/{x}";

/** Dynamic export — NAIP_2023 has no public XYZ cache; Mapbox {bbox-epsg-3857} works. */
const CT_NAIP_TILES =
  "https://cteco.uconn.edu/ctraster/rest/services/images/NAIP_2023/ImageServer/exportImage?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image&bandIds=0,1,2&compressionQuality=85";

const ESRI_WORLD_IMAGERY_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

const CT_ORTHO_ATTRIBUTION =
  "CT ECO | UConn 2023 Spring Ortho Imagery (4-band, 3 in)";
const CT_NAIP_ATTRIBUTION =
  "CT ECO | USDA NAIP 2023 Summer Aerial Imagery (4-band, 0.6 m)";
const ESRI_ATTRIBUTION = "Esri, Vantor, Earthstar Geographics";

export const AERIAL_ATTRIBUTION = CT_ORTHO_ATTRIBUTION;
export const SUMMER_ATTRIBUTION = CT_NAIP_ATTRIBUTION;
/** @deprecated Prefer getBasemapAttribution() */
export const IMAGERY_ATTRIBUTION = AERIAL_ATTRIBUTION;

const CT_ORTHO_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: [CT_ORTHO_TILES],
  tileSize: 256,
  maxzoom: 21,
  attribution: CT_ORTHO_ATTRIBUTION,
};

const CT_NAIP_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: [CT_NAIP_TILES],
  tileSize: 256,
  /** ~0.6 m GSD ≈ Web Mercator z17–18; allow slight overzoom. */
  maxzoom: 18,
  attribution: CT_NAIP_ATTRIBUTION,
};

const ESRI_IMAGERY_SOURCE: RasterSourceSpecification = {
  type: "raster",
  tiles: [ESRI_WORLD_IMAGERY_TILES],
  tileSize: 256,
  maxzoom: 19,
  attribution: ESRI_ATTRIBUTION,
};

export function getBasemapStyleUrl(basemap: BasemapStyle): string {
  if (basemap === "aerial") {
    const custom = import.meta.env.VITE_MAPBOX_STYLE_AERIAL?.trim();
    return custom || LABELS_STYLE_URL;
  }
  if (basemap === "satellite") {
    const custom = import.meta.env.VITE_MAPBOX_STYLE_SATELLITE?.trim();
    // Custom override only; default is Streets + NAIP summer overlay (not Mapbox Satellite).
    return custom || LABELS_STYLE_URL;
  }
  const custom = import.meta.env.VITE_MAPBOX_STYLE_TERRAIN?.trim();
  return custom || TERRAIN_STYLE_URL;
}

export function isCustomTerrainStyle(): boolean {
  return Boolean(import.meta.env.VITE_MAPBOX_STYLE_TERRAIN?.trim());
}

export function isCustomAerialStyle(): boolean {
  return Boolean(import.meta.env.VITE_MAPBOX_STYLE_AERIAL?.trim());
}

export function isCustomSatelliteStyle(): boolean {
  return Boolean(import.meta.env.VITE_MAPBOX_STYLE_SATELLITE?.trim());
}

export function usesCtAerialOverlay(basemap: BasemapStyle): boolean {
  if (basemap === "aerial") {
    return !isCustomAerialStyle();
  }
  if (basemap === "satellite") {
    return !isCustomSatelliteStyle();
  }
  return false;
}

/** @deprecated Prefer usesCtAerialOverlay */
export function usesCtOrthoImagery(basemap: BasemapStyle): boolean {
  return usesCtAerialOverlay(basemap);
}

export function getBasemapAttribution(basemap: BasemapStyle): string | null {
  if (basemap === "aerial" && !isCustomAerialStyle()) {
    return AERIAL_ATTRIBUTION;
  }
  if (basemap === "satellite" && !isCustomSatelliteStyle()) {
    return SUMMER_ATTRIBUTION;
  }
  return null;
}

function layers(map: MapboxMap): AnyLayer[] {
  return map.getStyle()?.layers ?? [];
}

function setPaint(
  map: MapboxMap,
  layerId: string,
  property: string,
  value: unknown,
) {
  if (!map.getLayer(layerId)) {
    return;
  }
  try {
    map.setPaintProperty(
      layerId,
      property as Parameters<MapboxMap["setPaintProperty"]>[1],
      value as never,
    );
  } catch {
    // Unsupported on this layer revision.
  }
}

function setLayout(
  map: MapboxMap,
  layerId: string,
  property: string,
  value: unknown,
) {
  if (!map.getLayer(layerId)) {
    return;
  }
  try {
    map.setLayoutProperty(
      layerId,
      property as Parameters<MapboxMap["setLayoutProperty"]>[1],
      value as never,
    );
  } catch {
    // Unsupported on this layer revision.
  }
}

function declutterCommercialPois(map: MapboxMap) {
  for (const layer of layers(map)) {
    if (layer.type !== "symbol") {
      continue;
    }
    const id = layer.id;
    if (
      id === "poi-label" ||
      id.startsWith("poi-") ||
      id.includes("airport-label") ||
      id.includes("transit") ||
      id.includes("rail-station-label")
    ) {
      setLayout(map, id, "visibility", "none");
    }
  }
}

function emphasizePathsSlightly(map: MapboxMap) {
  for (const layer of layers(map)) {
    if (layer.type !== "line") {
      continue;
    }
    const id = layer.id;
    if (/(?:^|-)(path|steps)(?:-|$)/.test(id) || /path-bg$/.test(id)) {
      setPaint(map, id, "line-opacity", 1);
    }
  }
}

function applyTerrainCartography(map: MapboxMap) {
  declutterCommercialPois(map);
  emphasizePathsSlightly(map);

  for (const layer of layers(map)) {
    if (layer.type !== "symbol") {
      continue;
    }
    const id = layer.id;
    if (id.includes("road-label") || id.includes("road-number")) {
      setPaint(map, id, "text-opacity", 0.75);
    }
  }
}

const APP_OVERLAY_PREFIXES = [
  "spicebush-",
  "survey-route-",
  "gl-draw",
  "mapbox-gl-draw",
] as const;

function isAppOverlayLayer(id: string): boolean {
  return APP_OVERLAY_PREFIXES.some((prefix) => id.startsWith(prefix));
}

function firstSymbolLayerId(map: MapboxMap): string | undefined {
  // Skip app overlays so aerial rasters stay under basemap labels, not under
  // route stop numbers (which would bury the orange route line).
  return layers(map).find(
    (layer) => layer.type === "symbol" && !isAppOverlayLayer(layer.id),
  )?.id;
}

function ensureRasterSource(
  map: MapboxMap,
  id: string,
  spec: RasterSourceSpecification,
) {
  if (map.getSource(id)) {
    return;
  }
  map.addSource(id, spec);
}

/**
 * Hide Streets fill/line chrome; stack Esri fallback + CT aerial under labels.
 * Removes the other CT season layer so Summer ↔ Spring swaps cleanly in place.
 */
function applyCtRasterOverStreets(
  map: MapboxMap,
  primary: { sourceId: string; layerId: string; spec: RasterSourceSpecification },
) {
  const otherLayerId =
    primary.layerId === CT_ORTHO_LAYER_ID ? CT_NAIP_LAYER_ID : CT_ORTHO_LAYER_ID;
  const otherSourceId =
    primary.sourceId === CT_ORTHO_SOURCE_ID ? CT_NAIP_SOURCE_ID : CT_ORTHO_SOURCE_ID;

  if (map.getLayer(otherLayerId)) {
    map.removeLayer(otherLayerId);
  }
  if (map.getSource(otherSourceId)) {
    try {
      map.removeSource(otherSourceId);
    } catch {
      // Still referenced — leave it; visibility swap is enough.
    }
  }

  ensureRasterSource(map, ESRI_IMAGERY_SOURCE_ID, ESRI_IMAGERY_SOURCE);
  ensureRasterSource(map, primary.sourceId, primary.spec);

  const beforeId = firstSymbolLayerId(map);
  const managedIds = new Set([ESRI_IMAGERY_LAYER_ID, primary.layerId]);

  if (!map.getLayer(ESRI_IMAGERY_LAYER_ID)) {
    map.addLayer(
      {
        id: ESRI_IMAGERY_LAYER_ID,
        type: "raster",
        source: ESRI_IMAGERY_SOURCE_ID,
        paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
      },
      beforeId,
    );
  }

  if (!map.getLayer(primary.layerId)) {
    map.addLayer(
      {
        id: primary.layerId,
        type: "raster",
        source: primary.sourceId,
        paint: { "raster-opacity": 1, "raster-fade-duration": 0 },
      },
      beforeId,
    );
  } else {
    setLayout(map, primary.layerId, "visibility", "visible");
  }

  for (const layer of layers(map)) {
    const id = layer.id;
    if (managedIds.has(id) || isAppOverlayLayer(id)) {
      continue;
    }
    if (layer.type === "symbol") {
      continue;
    }
    setLayout(map, id, "visibility", "none");
  }

  declutterCommercialPois(map);

  for (const layer of layers(map)) {
    if (layer.type !== "symbol") {
      continue;
    }
    const id = layer.id;
    if (
      id === "poi-label" ||
      id.startsWith("poi-") ||
      id.includes("airport-label") ||
      id.includes("transit")
    ) {
      continue;
    }
    setPaint(map, id, "text-color", "#f7faf4");
    setPaint(map, id, "text-halo-color", "rgba(10, 18, 12, 0.82)");
    setPaint(map, id, "text-halo-width", 1.35);
    if (id.includes("road-label") || id.includes("road-number")) {
      setPaint(map, id, "text-opacity", 0.88);
    }
  }
}

function applyCtOrthoImageryBasemap(map: MapboxMap) {
  applyCtRasterOverStreets(map, {
    sourceId: CT_ORTHO_SOURCE_ID,
    layerId: CT_ORTHO_LAYER_ID,
    spec: CT_ORTHO_SOURCE,
  });
}

function applyCtNaipSummerBasemap(map: MapboxMap) {
  applyCtRasterOverStreets(map, {
    sourceId: CT_NAIP_SOURCE_ID,
    layerId: CT_NAIP_LAYER_ID,
    spec: CT_NAIP_SOURCE,
  });
}

/**
 * Presentation pass after style load.
 */
export function applyFieldResearchCartography(
  map: MapboxMap,
  basemap: BasemapStyle,
): void {
  if (basemap === "terrain") {
    if (isCustomTerrainStyle()) {
      return;
    }
    applyTerrainCartography(map);
    return;
  }

  if (basemap === "aerial") {
    if (isCustomAerialStyle()) {
      return;
    }
    applyCtOrthoImageryBasemap(map);
    return;
  }

  if (basemap === "satellite") {
    if (isCustomSatelliteStyle()) {
      return;
    }
    applyCtNaipSummerBasemap(map);
  }
}

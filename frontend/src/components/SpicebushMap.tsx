import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Polygon } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import type { BasemapStyle, TreeFeature } from "../types";
import type { ComputedRoute } from "../utils/route";
import {
  buildPartialRouteGeoJSON,
  EMPTY_ROUTE_LINE,
  EMPTY_ROUTE_STOPS,
  haversineDistanceM,
  routeTraceDurationMs,
} from "../utils/route";
import {
  SEX_COLORS,
  SEX_LEGEND_ITEMS,
  SEX_MARKER_STROKE,
  sexCircleColorExpression,
} from "../theme/sexColors";
import {
  applyFieldResearchCartography,
  getBasemapAttribution,
  getBasemapStyleUrl,
  usesCtAerialOverlay,
} from "../map/basemapStyles";
import { useCloseAnimation } from "../hooks/useCloseAnimation";
import "./SpicebushMap.css";

const TRAIL_OUTLINE_COLOR = "#a8a092";
const TRAIL_OUTLINE_ORANGE = "hsl(35, 80%, 48%)";

function isTrailOutlineLayer(layerId: string): boolean {
  return /^(?:road|bridge|tunnel)-path-bg$/.test(layerId);
}

function withDarkBrownTrailOutline(
  lineColor: unknown,
): mapboxgl.ExpressionSpecification | string | null {
  if (lineColor === TRAIL_OUTLINE_ORANGE) {
    return TRAIL_OUTLINE_COLOR;
  }

  if (
    !Array.isArray(lineColor) ||
    lineColor[0] !== "match" ||
    !Array.isArray(lineColor[1]) ||
    lineColor[1][0] !== "get" ||
    lineColor[1][1] !== "type"
  ) {
    return null;
  }

  const updated = [...lineColor] as unknown[];
  for (let index = 0; index < updated.length; index += 1) {
    if (updated[index] === TRAIL_OUTLINE_ORANGE) {
      updated[index] = TRAIL_OUTLINE_COLOR;
    }
  }

  return updated as mapboxgl.ExpressionSpecification;
}

function applyTrailBorderColorOverride(map: mapboxgl.Map, basemap: BasemapStyle) {
  if (basemap !== "terrain") {
    return;
  }

  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type !== "line" || !isTrailOutlineLayer(layer.id)) {
      continue;
    }

    const paint = layer.paint as Record<string, unknown> | undefined;
    const updatedLineColor = withDarkBrownTrailOutline(paint?.["line-color"]);
    if (!updatedLineColor) {
      continue;
    }

    try {
      map.setPaintProperty(layer.id, "line-color", updatedLineColor);
    } catch {
      // Some outline layers do not expose line-color.
    }
  }
}

function applyBasemapPresentation(map: mapboxgl.Map, basemap: BasemapStyle) {
  applyFieldResearchCartography(map, basemap);
  applyTrailBorderColorOverride(map, basemap);
}

interface SpicebushMapProps {
  trees: TreeFeature[];
  basemap: BasemapStyle;
  mapboxToken: string;
  regionPolygon: Polygon | null;
  manualExcludedIds: number[];
  selectedTreeId: number | null;
  highlightedTreeId: number | null;
  route: ComputedRoute | null;
  routeLine: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  routeStops: GeoJSON.FeatureCollection<GeoJSON.Point>;
  routeStartTreeId: number | null;
  routeStartPickMode: boolean;
  onSelectTree: (tree: TreeFeature) => void;
  onHoverTree: (treeId: number | null) => void;
  onToggleTree: (tree: TreeFeature) => void;
  onClearTree: () => void;
  onRegionChange: (polygon: Polygon | null) => void;
  onRouteStartPick: (tree: TreeFeature) => void;
  analysisPopupHeight?: number;
  flyToOnSelect?: boolean;
  densityHeatmap?: boolean;
  showTreePoints?: boolean;
  colorBySex?: boolean;
}

function getOverlayInsetPx(container: HTMLElement): number {
  const insetValue = getComputedStyle(container)
    .getPropertyValue("--overlay-inset")
    .trim();
  if (!insetValue) {
    return 20;
  }
  if (insetValue.endsWith("rem")) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return parseFloat(insetValue) * rootFontSize;
  }
  return parseFloat(insetValue);
}

function getTreePopupOffset(
  map: mapboxgl.Map,
  coordinates: [number, number],
  analysisPopupHeight: number,
): mapboxgl.PopupOptions["offset"] {
  if (analysisPopupHeight <= 0) {
    return 10;
  }

  const mapContainer = map.getContainer();
  const appMain = mapContainer.closest(".app-main") as HTMLElement | null;
  const insetPx = getOverlayInsetPx(appMain ?? mapContainer);
  const occlusionBottom = insetPx + analysisPopupHeight + 8;
  const screenPoint = map.project(coordinates);

  if (screenPoint.y >= occlusionBottom) {
    return 10;
  }

  return [0, occlusionBottom - screenPoint.y + 10];
}

function treesToGeoJSON(trees: TreeFeature[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: trees.map((tree) => ({
      type: "Feature",
      geometry: tree.geometry,
      properties: {
        id: tree.properties.id,
        sex: tree.properties.sex ?? "U",
      },
    })),
  };
}

function patchDrawControlTitles(map: mapboxgl.Map) {
  const polygonButton = map
    .getContainer()
    .querySelector<HTMLButtonElement>(".mapbox-gl-draw_polygon");
  const trashButton = map
    .getContainer()
    .querySelector<HTMLButtonElement>(".mapbox-gl-draw_trash");

  polygonButton?.setAttribute("title", "Polygon Tool");
  trashButton?.setAttribute("title", "Delete selection");
}

const HOME_ICON_SVG =
  '<svg class="spicebush-ctrl-home-icon" width="18" height="18" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.1 2.2 7.4h1.6v6h3.4V9.6h1.6v3.8h3.4v-6h1.6L8 2.1Z" fill="currentColor"/></svg>';

/** Custom "reset view" control; merged into the main bottom-left toolbar. */
class HomeControl implements mapboxgl.IControl {
  private container: HTMLElement | null = null;

  constructor(private readonly onActivate: () => void) {}

  onAdd(): HTMLElement {
    const container = document.createElement("div");
    container.className =
      "mapboxgl-ctrl mapboxgl-ctrl-group spicebush-ctrl-home";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "spicebush-ctrl-home-btn";
    button.title = "Reset view to survey area";
    button.setAttribute("aria-label", "Reset view to survey area");
    button.innerHTML = HOME_ICON_SVG;
    button.addEventListener("click", this.onActivate);
    container.appendChild(button);
    this.container = container;
    return container;
  }

  onRemove(): void {
    this.container?.remove();
    this.container = null;
  }
}

function mergeHomeIntoNavigation(map: mapboxgl.Map) {
  const corner = map
    .getContainer()
    .querySelector<HTMLElement>(".mapboxgl-ctrl-bottom-left");
  const homeGroup = corner?.querySelector<HTMLElement>(".spicebush-ctrl-home");
  const zoomGroup = corner
    ?.querySelector<HTMLElement>(".mapboxgl-ctrl-zoom-in")
    ?.closest<HTMLElement>(".mapboxgl-ctrl-group");
  const homeButton = homeGroup?.querySelector("button");
  if (!homeGroup || !zoomGroup || !homeButton) {
    return;
  }
  zoomGroup.appendChild(homeButton);
  homeGroup.remove();
}

/** The compass renders as its own detached circular control. */
function markCompassGroup(map: mapboxgl.Map) {
  map
    .getContainer()
    .querySelector<HTMLElement>(
      ".mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-compass",
    )
    ?.closest<HTMLElement>(".mapboxgl-ctrl-group")
    ?.classList.add("spicebush-ctrl-compass-group");
}

function mergeDrawControlsIntoNavigation(map: mapboxgl.Map) {
  const corner = map
    .getContainer()
    .querySelector<HTMLElement>(".mapboxgl-ctrl-bottom-left");
  if (!corner) {
    return;
  }

  const groups = Array.from(
    corner.querySelectorAll<HTMLElement>(":scope > .mapboxgl-ctrl-group"),
  );
  if (groups.length < 2) {
    return;
  }

  const navGroup =
    groups.find((group) => group.querySelector(".mapboxgl-ctrl-zoom-in")) ??
    groups[0];
  const drawGroup = groups.find((group) =>
    group.querySelector(".mapbox-gl-draw_polygon"),
  );

  if (!drawGroup || navGroup === drawGroup) {
    return;
  }

  const zoomIn = navGroup.querySelector(".mapboxgl-ctrl-zoom-in");
  const drawButtons = Array.from(
    drawGroup.querySelectorAll<HTMLButtonElement>(".mapbox-gl-draw_ctrl-draw-btn"),
  );

  drawButtons.forEach((button) => {
    if (zoomIn) {
      navGroup.insertBefore(button, zoomIn);
    } else {
      navGroup.prepend(button);
    }
  });

  drawGroup.remove();

  const drawControl = corner.querySelector<HTMLElement>(".mapbox-gl-draw");
  if (drawControl && !drawControl.querySelector(".mapbox-gl-draw_ctrl-draw-btn")) {
    drawControl.remove();
  }

  navGroup.classList.add("spicebush-map-ctrl-group");
}

const MEASURE_SOURCE = "spicebush-measure";
const MEASURE_LINE_LAYER = "spicebush-measure-line";
const MEASURE_POINT_LAYER = "spicebush-measure-points";
const MEASURE_PREVIEW_SOURCE = "spicebush-measure-preview";
const MEASURE_PREVIEW_LAYER = "spicebush-measure-preview-line";
const MEASURE_LABEL_LAYER = "spicebush-measure-label";
const MEASURE_LEG_LABEL_LAYER = "spicebush-measure-leg-labels";
// Teal from mapbox-gl-draw's default theme, so measure lines match the
// region-polygon tool's lines.
const MEASURE_COLOR = "#3bb2d0";

const EMPTY_FEATURE_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

const RULER_ICON_SVG =
  '<svg class="spicebush-ctrl-measure-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">' +
  '<path d="M10.9 1.6 1.6 10.9a1 1 0 0 0 0 1.4l2.1 2.1a1 1 0 0 0 1.4 0l9.3-9.3a1 1 0 0 0 0-1.4L12.3 1.6a1 1 0 0 0-1.4 0Z" stroke="currentColor" stroke-width="1.3"/>' +
  '<path d="m4.2 8.3 1.4 1.4M6.3 6.2l1.4 1.4M8.4 4.1l1.4 1.4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' +
  "</svg>";

function measureGeoJSON(points: [number, number][]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = points.map((coordinates, index) => ({
    type: "Feature",
    properties: { index },
    geometry: { type: "Point", coordinates },
  }));

  // Per-leg distance labels at each segment midpoint.
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    features.push({
      type: "Feature",
      properties: {
        legLabel: formatMeasureDistance(
          haversineDistanceM(points[i - 1], points[i]),
        ),
      },
      geometry: {
        type: "Point",
        coordinates: [(ax + bx) / 2, (ay + by) / 2],
      },
    });
  }

  if (points.length >= 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: points },
    });
  }

  return { type: "FeatureCollection", features };
}

function measureTotalMeters(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineDistanceM(points[i - 1], points[i]);
  }
  return total;
}

function formatMeasureDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  if (meters >= 100) {
    return `${Math.round(meters)} m`;
  }
  return `${meters.toFixed(1)} m`;
}

function extractPolygon(draw: MapboxDraw): Polygon | null {
  const collection = draw.getAll();
  const polygonFeature = collection.features.find(
    (feature) => feature.geometry.type === "Polygon",
  );

  if (!polygonFeature || polygonFeature.geometry.type !== "Polygon") {
    return null;
  }

  return polygonFeature.geometry;
}

const TREE_CIRCLE_LAYER = "spicebush-circles";
const TREE_FOCUS_LAYER = "spicebush-circles-focus";
const TREE_HEATMAP_LAYER = "spicebush-heatmap";

function ensureHeatmapLayer(map: mapboxgl.Map) {
  if (!map.getSource("spicebush-trees") || map.getLayer(TREE_HEATMAP_LAYER)) {
    return;
  }

  const beforeId = map.getLayer(TREE_CIRCLE_LAYER)
    ? TREE_CIRCLE_LAYER
    : undefined;

  map.addLayer(
    {
      id: TREE_HEATMAP_LAYER,
      type: "heatmap",
      source: "spicebush-trees",
      layout: {
        visibility: "none",
      },
      paint: {
        "heatmap-weight": 1,
        "heatmap-intensity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          0.55,
          16.5,
          1.05,
          18,
          1.35,
        ],
        "heatmap-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          14,
          18,
          16.5,
          32,
          18,
          48,
        ],
        "heatmap-opacity": 0.78,
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(61, 122, 61, 0)",
          0.15,
          "rgba(103, 169, 140, 0.45)",
          0.35,
          "rgba(209, 229, 180, 0.75)",
          0.55,
          "rgba(253, 200, 120, 0.85)",
          0.75,
          "rgba(239, 138, 98, 0.92)",
          1,
          "rgb(178, 48, 40)",
        ],
      },
    },
    beforeId,
  );
}

function applyHeatmapState(
  map: mapboxgl.Map,
  enabled: boolean,
  excludedIds: number[],
) {
  ensureHeatmapLayer(map);
  if (!map.getLayer(TREE_HEATMAP_LAYER)) {
    return;
  }

  map.setLayoutProperty(
    TREE_HEATMAP_LAYER,
    "visibility",
    enabled ? "visible" : "none",
  );

  map.setFilter(
    TREE_HEATMAP_LAYER,
    excludedIds.length > 0
      ? ["!", ["in", ["get", "id"], ["literal", excludedIds]]]
      : null,
  );
}

function applyTreePointVisibility(map: mapboxgl.Map, visible: boolean) {
  const visibility = visible ? "visible" : "none";
  if (map.getLayer(TREE_CIRCLE_LAYER)) {
    map.setLayoutProperty(TREE_CIRCLE_LAYER, "visibility", visibility);
  }
  if (map.getLayer(TREE_FOCUS_LAYER)) {
    map.setLayoutProperty(TREE_FOCUS_LAYER, "visibility", visibility);
  }
}

function ensureFocusCircleLayer(map: mapboxgl.Map) {
  if (!map.getSource("spicebush-trees") || map.getLayer(TREE_FOCUS_LAYER)) {
    return;
  }

  map.addLayer({
    id: TREE_FOCUS_LAYER,
    type: "circle",
    source: "spicebush-trees",
    filter: ["==", ["get", "id"], -1],
    paint: {
      "circle-radius": isTouchUi() ? 8 : 7,
      "circle-color": sexCircleColorExpression(),
      "circle-stroke-color": SEX_MARKER_STROKE,
      "circle-stroke-width": 2,
      "circle-opacity": 0.92,
    },
  });
}

function isActiveTreeExpression(
  selectedTreeId: number | null,
  highlightedTreeId: number | null,
): mapboxgl.Expression {
  return [
    "any",
    ["==", ["get", "id"], selectedTreeId ?? -1],
    ["==", ["get", "id"], highlightedTreeId ?? -1],
  ];
}

function isTouchUi(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.matchMedia("(pointer: coarse)").matches ||
    window.matchMedia("(hover: none)").matches ||
    navigator.maxTouchPoints > 0
  );
}

function queryTreeFeatures(
  map: mapboxgl.Map,
  point: mapboxgl.Point,
): mapboxgl.MapboxGeoJSONFeature[] {
  // Fat-finger hit box (~44px target on touch).
  const pad = isTouchUi() ? 44 : 12;
  const bbox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
    [point.x - pad, point.y - pad],
    [point.x + pad, point.y + pad],
  ];

  const layers = [
    ...(map.getLayer(TREE_FOCUS_LAYER) ? [TREE_FOCUS_LAYER] : []),
    ...(map.getLayer(TREE_CIRCLE_LAYER) ? [TREE_CIRCLE_LAYER] : []),
  ];
  if (layers.length === 0) {
    return [];
  }

  const features = map.queryRenderedFeatures(bbox, { layers });
  if (features.length <= 1) {
    return features;
  }

  let best = features[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const feature of features) {
    if (feature.geometry.type !== "Point") {
      continue;
    }
    const projected = map.project(
      feature.geometry.coordinates as [number, number],
    );
    const dist =
      (projected.x - point.x) ** 2 + (projected.y - point.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = feature;
    }
  }
  return [best];
}

function mapPointFromClient(
  map: mapboxgl.Map,
  clientX: number,
  clientY: number,
): mapboxgl.Point {
  const rect = map.getContainer().getBoundingClientRect();
  return new mapboxgl.Point(clientX - rect.left, clientY - rect.top);
}

const DEFAULT_TREE_COLOR = "#3d7a3d";

function applyCircleStyles(
  map: mapboxgl.Map,
  selectedTreeId: number | null,
  highlightedTreeId: number | null,
  excludedIds: number[],
  routeStartTreeId: number | null,
  colorBySex: boolean,
) {
  if (!map.getLayer(TREE_CIRCLE_LAYER)) {
    return;
  }

  ensureFocusCircleLayer(map);

  const activeTree = isActiveTreeExpression(selectedTreeId, highlightedTreeId);

  const baseColor = colorBySex
    ? sexCircleColorExpression()
    : DEFAULT_TREE_COLOR;

  const circleColor: mapboxgl.Expression = [
    "case",
    ["==", ["get", "id"], routeStartTreeId ?? -1],
    "#c9781a",
    [
      "all",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["in", ["get", "id"], ["literal", excludedIds]],
    ],
    "#c49a62",
    ["==", ["get", "id"], selectedTreeId ?? -1],
    "#c9781a",
    ["in", ["get", "id"], ["literal", excludedIds]],
    SEX_COLORS.unknown,
    baseColor,
  ];

  const circleOpacity: mapboxgl.Expression = [
    "case",
    [
      "all",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["in", ["get", "id"], ["literal", excludedIds]],
    ],
    0.72,
    ["==", ["get", "id"], selectedTreeId ?? -1],
    1,
    ["in", ["get", "id"], ["literal", excludedIds]],
    0.5,
    0.92,
  ];

  const circleStrokeColor: mapboxgl.Expression = [
    "case",
    [
      "all",
      ["==", ["get", "id"], highlightedTreeId ?? -1],
      ["in", ["get", "id"], ["literal", excludedIds]],
    ],
    "#6b7f6b",
    ["==", ["get", "id"], highlightedTreeId ?? -1],
    "#2d4a2d",
    ["==", ["get", "id"], selectedTreeId ?? -1],
    SEX_MARKER_STROKE,
    ["in", ["get", "id"], ["literal", excludedIds]],
    "#d0d8cc",
    SEX_MARKER_STROKE,
  ];

  const circleStrokeWidth: mapboxgl.Expression = [
    "case",
    activeTree,
    2.5,
    2,
  ];

  map.setPaintProperty(
    TREE_CIRCLE_LAYER,
    "circle-radius",
    isTouchUi() ? 8 : 7,
  );
  map.setPaintProperty(TREE_CIRCLE_LAYER, "circle-color", circleColor);
  map.setPaintProperty(TREE_CIRCLE_LAYER, "circle-opacity", [
    "case",
    activeTree,
    0,
    circleOpacity,
  ]);
  map.setPaintProperty(TREE_CIRCLE_LAYER, "circle-stroke-color", circleStrokeColor);
  map.setPaintProperty(TREE_CIRCLE_LAYER, "circle-stroke-width", 2);

  if (!map.getLayer(TREE_FOCUS_LAYER)) {
    return;
  }

  const hasActiveTree =
    selectedTreeId !== null || highlightedTreeId !== null;

  map.setFilter(
    TREE_FOCUS_LAYER,
    hasActiveTree
      ? activeTree
      : ["==", ["get", "id"], -1],
  );

  map.setPaintProperty(
    TREE_FOCUS_LAYER,
    "circle-radius",
    isTouchUi() ? 8 : 7,
  );
  map.setPaintProperty(TREE_FOCUS_LAYER, "circle-color", circleColor);
  map.setPaintProperty(TREE_FOCUS_LAYER, "circle-opacity", circleOpacity);
  map.setPaintProperty(TREE_FOCUS_LAYER, "circle-stroke-color", circleStrokeColor);
  map.setPaintProperty(TREE_FOCUS_LAYER, "circle-stroke-width", circleStrokeWidth);
}

export default function SpicebushMap({
  trees,
  basemap,
  mapboxToken,
  regionPolygon,
  manualExcludedIds,
  selectedTreeId,
  highlightedTreeId,
  route,
  routeLine,
  routeStops,
  routeStartTreeId,
  routeStartPickMode,
  onSelectTree,
  onHoverTree,
  onToggleTree,
  onClearTree,
  onRegionChange,
  onRouteStartPick,
  analysisPopupHeight = 0,
  flyToOnSelect = true,
  densityHeatmap = false,
  showTreePoints = true,
  colorBySex = true,
}: SpicebushMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const analysisPopupHeightRef = useRef(analysisPopupHeight);
  const treesRef = useRef(trees);
  const excludedIdsRef = useRef(manualExcludedIds);
  const densityHeatmapRef = useRef(densityHeatmap);
  const showTreePointsRef = useRef(showTreePoints);
  const colorBySexRef = useRef(colorBySex);
  const onSelectTreeRef = useRef(onSelectTree);
  const onHoverTreeRef = useRef(onHoverTree);
  const onToggleTreeRef = useRef(onToggleTree);
  const onClearTreeRef = useRef(onClearTree);
  const onRegionChangeRef = useRef(onRegionChange);
  const onRouteStartPickRef = useRef(onRouteStartPick);
  const routeStartPickModeRef = useRef(routeStartPickMode);
  const routeLineRef = useRef(routeLine);
  const routeStopsRef = useRef(routeStops);
  const routeStartTreeIdRef = useRef(routeStartTreeId);
  const regionPolygonRef = useRef(regionPolygon);
  const isSyncingDrawRef = useRef(false);
  const treeHandlersAttachedRef = useRef(false);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ignoreClickUntilRef = useRef(0);
  const touchGestureRef = useRef<{
    startX: number;
    startY: number;
    longPressTimer: ReturnType<typeof setTimeout> | null;
    longPressFired: boolean;
  } | null>(null);
  const routeAnimFrameRef = useRef<number | null>(null);
  const lastAnimatedRouteRef = useRef<ComputedRoute | null>(null);
  const measureActiveRef = useRef(false);
  const measurePointsRef = useRef<[number, number][]>([]);
  const measureHoverPointRef = useRef<[number, number] | null>(null);
  const measureClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const measureButtonRef = useRef<HTMLButtonElement | null>(null);
  const setMeasureModeRef = useRef<(active: boolean) => void>(() => {});
  const [measureActive, setMeasureActive] = useState(false);

  treesRef.current = trees;
  excludedIdsRef.current = manualExcludedIds;
  densityHeatmapRef.current = densityHeatmap;
  showTreePointsRef.current = showTreePoints;
  colorBySexRef.current = colorBySex;
  onSelectTreeRef.current = onSelectTree;
  onHoverTreeRef.current = onHoverTree;
  onToggleTreeRef.current = onToggleTree;
  onClearTreeRef.current = onClearTree;
  onRegionChangeRef.current = onRegionChange;
  onRouteStartPickRef.current = onRouteStartPick;
  routeStartPickModeRef.current = routeStartPickMode;
  routeLineRef.current = routeLine;
  routeStopsRef.current = routeStops;
  routeStartTreeIdRef.current = routeStartTreeId;
  regionPolygonRef.current = regionPolygon;
  analysisPopupHeightRef.current = analysisPopupHeight;

  const syncDrawPolygon = useCallback((polygon: Polygon | null) => {
    const draw = drawRef.current;
    if (!draw) {
      return;
    }

    isSyncingDrawRef.current = true;
    draw.deleteAll();
    if (polygon) {
      draw.add({
        type: "Feature",
        properties: {},
        geometry: polygon,
      });
    }
    isSyncingDrawRef.current = false;
  }, []);

  const publishDrawnRegion = useCallback(() => {
    if (isSyncingDrawRef.current || !drawRef.current) {
      return;
    }
    onRegionChangeRef.current(extractPolygon(drawRef.current));
  }, []);

  const setupDrawControl = useCallback(
    (map: mapboxgl.Map) => {
      if (!drawRef.current) {
        const draw = new MapboxDraw({
          displayControlsDefault: false,
          controls: {
            polygon: true,
            trash: true,
          },
          defaultMode: "simple_select",
        });

        map.addControl(draw, "bottom-left");
        drawRef.current = draw;
        patchDrawControlTitles(map);
        mergeDrawControlsIntoNavigation(map);

        map.on("draw.create", (event: { features: GeoJSON.Feature[] }) => {
          const activeDraw = drawRef.current;
          if (!activeDraw) {
            return;
          }

          const allFeatures = activeDraw.getAll();
          if (allFeatures.features.length > 1) {
            const created = event.features[0];
            activeDraw.deleteAll();
            if (created) {
              activeDraw.add(created);
            }
          }

          publishDrawnRegion();
        });

        map.on("draw.update", publishDrawnRegion);
        map.on("draw.delete", publishDrawnRegion);
        map.on("draw.modechange", (event: { mode: string }) => {
          // Region drawing takes over map clicks — leave measure mode.
          if (measureActiveRef.current && event.mode !== "simple_select") {
            setMeasureModeRef.current(false);
          }
        });
      } else if (!map.hasControl(drawRef.current)) {
        map.addControl(drawRef.current, "bottom-left");
        patchDrawControlTitles(map);
        mergeDrawControlsIntoNavigation(map);
      }

      syncDrawPolygon(regionPolygonRef.current);
    },
    [publishDrawnRegion, syncDrawPolygon],
  );

  const ensureMeasureLayers = useCallback(function ensure(map: mapboxgl.Map) {
    // isStyleLoaded() is false while tiles stream after a style swap (same
    // issue as the route layers) — retry on idle instead of dropping the
    // restore. The source reads measurePointsRef at add time, so no refresh
    // is needed on the retry.
    if (!map.isStyleLoaded()) {
      map.once("idle", () => ensure(map));
      return;
    }

    if (!map.getSource(MEASURE_SOURCE)) {
      map.addSource(MEASURE_SOURCE, {
        type: "geojson",
        data: measureGeoJSON(measurePointsRef.current),
      });
    }
    if (!map.getSource(MEASURE_PREVIEW_SOURCE)) {
      map.addSource(MEASURE_PREVIEW_SOURCE, {
        type: "geojson",
        data: EMPTY_FEATURE_COLLECTION,
      });
    }

    if (!map.getLayer(MEASURE_PREVIEW_LAYER)) {
      map.addLayer({
        id: MEASURE_PREVIEW_LAYER,
        type: "line",
        source: MEASURE_PREVIEW_SOURCE,
        paint: {
          "line-color": MEASURE_COLOR,
          "line-width": 2,
          "line-dasharray": [2, 2],
          "line-opacity": 0.75,
        },
      });
    }
    if (!map.getLayer(MEASURE_LINE_LAYER)) {
      map.addLayer({
        id: MEASURE_LINE_LAYER,
        type: "line",
        source: MEASURE_SOURCE,
        filter: ["==", "$type", "LineString"],
        paint: {
          "line-color": MEASURE_COLOR,
          "line-width": 2,
        },
      });
    }
    if (!map.getLayer(MEASURE_POINT_LAYER)) {
      map.addLayer({
        id: MEASURE_POINT_LAYER,
        type: "circle",
        source: MEASURE_SOURCE,
        // Midpoint leg-label features share the source — don't dot them.
        filter: ["all", ["==", "$type", "Point"], ["!has", "legLabel"]],
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": MEASURE_COLOR,
          "circle-stroke-width": 2,
        },
      });
    }
    if (!map.getLayer(MEASURE_LEG_LABEL_LAYER)) {
      map.addLayer({
        id: MEASURE_LEG_LABEL_LAYER,
        type: "symbol",
        source: MEASURE_SOURCE,
        filter: ["all", ["==", "$type", "Point"], ["has", "legLabel"]],
        layout: {
          "text-field": ["get", "legLabel"],
          "text-size": 11,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, -0.7],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": MEASURE_COLOR,
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
    }
    if (!map.getLayer(MEASURE_LABEL_LAYER)) {
      // Running total rendered on the map itself (like the route stop
      // numbers), following the cursor while previewing.
      map.addLayer({
        id: MEASURE_LABEL_LAYER,
        type: "symbol",
        source: MEASURE_PREVIEW_SOURCE,
        filter: ["==", "$type", "Point"],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 12,
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-offset": [0, -1.1],
          "text-anchor": "bottom",
          "text-allow-overlap": true,
          "text-ignore-placement": true,
        },
        paint: {
          "text-color": MEASURE_COLOR,
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.5,
        },
      });
    }
  }, []);

  const refreshMeasureData = useCallback((map: mapboxgl.Map) => {
    (
      map.getSource(MEASURE_SOURCE) as mapboxgl.GeoJSONSource | undefined
    )?.setData(measureGeoJSON(measurePointsRef.current));
  }, []);

  /** Redraws the dashed cursor segment and the running-total map label. */
  const updateMeasurePreview = useCallback(
    (map: mapboxgl.Map, cursor: [number, number] | null) => {
      const source = map.getSource(MEASURE_PREVIEW_SOURCE) as
        | mapboxgl.GeoJSONSource
        | undefined;
      if (!source) {
        return;
      }

      const points = measurePointsRef.current;
      const last = points[points.length - 1];
      const features: GeoJSON.Feature[] = [];

      if (cursor && last) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [last, cursor] },
        });
      }

      // Total label sits at the cursor while previewing, else on the last vertex.
      const anchor = cursor && last ? cursor : last;
      const legCount = points.length - 1 + (cursor && last ? 1 : 0);
      if (anchor && legCount >= 1) {
        const total =
          measureTotalMeters(points) +
          (cursor && last ? haversineDistanceM(last, cursor) : 0);
        features.push({
          type: "Feature",
          properties: {
            // Legs get midpoint labels, so mark the sum once it's a real sum.
            label:
              formatMeasureDistance(total) + (legCount >= 2 ? " total" : ""),
          },
          geometry: { type: "Point", coordinates: anchor },
        });
      }

      source.setData({ type: "FeatureCollection", features });
    },
    [],
  );

  const setMeasureMode = useCallback(
    (active: boolean) => {
      measureActiveRef.current = active;
      measureHoverPointRef.current = null;
      setMeasureActive(active);
      if (measureClickTimeoutRef.current) {
        clearTimeout(measureClickTimeoutRef.current);
        measureClickTimeoutRef.current = null;
      }
      // Finishing keeps the measurement on screen; the next activation (or an
      // exit with nothing measured) clears it.
      if (active || measurePointsRef.current.length < 2) {
        measurePointsRef.current = [];
      }

      const button = measureButtonRef.current;
      button?.classList.toggle("spicebush-ctrl-measure-btn--active", active);
      button?.setAttribute("aria-pressed", String(active));

      const map = mapRef.current;
      if (!map) {
        return;
      }

      if (active) {
        // Region drawing and measuring both claim map clicks — one at a time.
        try {
          drawRef.current?.changeMode("simple_select");
        } catch {
          // Draw control may not be fully initialized yet.
        }
        ensureMeasureLayers(map);
      }

      refreshMeasureData(map);
      updateMeasurePreview(map, null);
      map.getCanvas().style.cursor =
        active || routeStartPickModeRef.current ? "crosshair" : "";
    },
    [ensureMeasureLayers, refreshMeasureData, updateMeasurePreview],
  );
  setMeasureModeRef.current = setMeasureMode;

  /** Adds a plain DOM ruler button to the merged bottom-left nav group. */
  const setupMeasureControl = useCallback((map: mapboxgl.Map) => {
    if (measureButtonRef.current?.isConnected) {
      return;
    }

    const navGroup = map
      .getContainer()
      .querySelector<HTMLElement>(".mapboxgl-ctrl-bottom-left .mapboxgl-ctrl-zoom-in")
      ?.closest<HTMLElement>(".mapboxgl-ctrl-group");
    if (!navGroup) {
      return;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "spicebush-ctrl-measure-btn";
    button.title = "Measure distance";
    button.setAttribute("aria-label", "Measure distance");
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = RULER_ICON_SVG;
    button.addEventListener("click", () => {
      setMeasureModeRef.current(!measureActiveRef.current);
    });

    // Ruler goes at the top of the toolbox, above the polygon/trash buttons.
    navGroup.insertBefore(
      button,
      navGroup.querySelector(".mapbox-gl-draw_polygon") ??
        navGroup.querySelector(".mapboxgl-ctrl-zoom-in"),
    );
    measureButtonRef.current = button;
  }, []);

  const ensureRouteLineLayer = useCallback((map: mapboxgl.Map) => {
    // addSource/addLayer throw if the style is still loading (common on first mount).
    if (!map.isStyleLoaded()) {
      return;
    }

    if (!map.getSource("survey-route-line")) {
      map.addSource("survey-route-line", {
        type: "geojson",
        data: routeLineRef.current,
      });
    }

    // Keep the line above the heatmap and under tree circles/stops so it stays
    // visible when density is on (stops were already on top — numbers showed).
    const beforeLayer = map.getLayer(TREE_CIRCLE_LAYER)
      ? TREE_CIRCLE_LAYER
      : map.getLayer("survey-route-stops")
        ? "survey-route-stops"
        : undefined;

    if (!map.getLayer("survey-route-line")) {
      map.addLayer(
        {
          id: "survey-route-line",
          type: "line",
          source: "survey-route-line",
          paint: {
            "line-color": "#c9781a",
            "line-width": 2.5,
            "line-opacity": 0.9,
          },
        },
        beforeLayer,
      );
      return;
    }

    try {
      map.setLayoutProperty("survey-route-line", "visibility", "visible");
    } catch {
      // Layer may be mid-teardown during a style swap.
    }

    if (beforeLayer) {
      try {
        map.moveLayer("survey-route-line", beforeLayer);
      } catch {
        // Layer order is best-effort if the stack changed mid-update.
      }
    }
  }, []);

  const ensureRouteStopLayer = useCallback((map: mapboxgl.Map) => {
    if (!map.isStyleLoaded()) {
      return;
    }

    if (!map.getSource("survey-route-stops")) {
      map.addSource("survey-route-stops", {
        type: "geojson",
        data: routeStopsRef.current,
      });
    }

    if (map.getLayer("survey-route-stops")) {
      return;
    }

    map.addLayer({
      id: "survey-route-stops",
      type: "symbol",
      source: "survey-route-stops",
      layout: {
        "text-field": ["get", "stop"],
        "text-size": 11,
        "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
        "text-offset": [0, -1.35],
        "text-anchor": "bottom",
        // Stops sit close together; without these Mapbox's collision pass
        // silently drops most (often all) of the numbers.
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#c9781a",
        "text-halo-color": "#ffffff",
        "text-halo-width": 1.5,
      },
    });
  }, []);

  const updateRouteLayers = useCallback((map: mapboxgl.Map) => {
    const lineSource = map.getSource("survey-route-line") as
      | mapboxgl.GeoJSONSource
      | undefined;
    const stopSource = map.getSource("survey-route-stops") as
      | mapboxgl.GeoJSONSource
      | undefined;

    lineSource?.setData(routeLineRef.current);
    stopSource?.setData(routeStopsRef.current);
  }, []);

  const cancelRouteAnimation = useCallback(() => {
    if (routeAnimFrameRef.current !== null) {
      window.cancelAnimationFrame(routeAnimFrameRef.current);
      routeAnimFrameRef.current = null;
    }
  }, []);

  const setRouteLayerData = useCallback(
    (
      map: mapboxgl.Map,
      line: GeoJSON.FeatureCollection<GeoJSON.LineString>,
      stops: GeoJSON.FeatureCollection<GeoJSON.Point>,
    ) => {
      const lineSource = map.getSource("survey-route-line") as
        | mapboxgl.GeoJSONSource
        | undefined;
      const stopSource = map.getSource("survey-route-stops") as
        | mapboxgl.GeoJSONSource
        | undefined;
      lineSource?.setData(line);
      stopSource?.setData(stops);
    },
    [],
  );

  const attachTreeInteractionHandlers = useCallback((map: mapboxgl.Map) => {
    if (treeHandlersAttachedRef.current) {
      return;
    }

    treeHandlersAttachedRef.current = true;

    const drawBlocksInteraction = () => {
      const draw = drawRef.current;
      return Boolean(draw && draw.getMode() !== "simple_select");
    };

    const treeFromPoint = (point: mapboxgl.Point) => {
      const features = queryTreeFeatures(map, point);
      if (features.length === 0) {
        return null;
      }
      const treeId = features[0].properties?.id as number;
      return treesRef.current.find((t) => t.properties.id === treeId) ?? null;
    };

    const selectTreeAtPoint = (point: mapboxgl.Point) => {
      if (drawBlocksInteraction() || measureActiveRef.current) {
        return false;
      }
      const tree = treeFromPoint(point);
      if (!tree) {
        return false;
      }
      if (routeStartPickModeRef.current) {
        if (excludedIdsRef.current.includes(tree.properties.id)) {
          return true;
        }
        onRouteStartPickRef.current(tree);
        return true;
      }
      onSelectTreeRef.current(tree);
      return true;
    };

    const toggleTreeAtPoint = (point: mapboxgl.Point) => {
      if (
        drawBlocksInteraction() ||
        routeStartPickModeRef.current ||
        measureActiveRef.current
      ) {
        return false;
      }
      const tree = treeFromPoint(point);
      if (!tree) {
        return false;
      }
      onToggleTreeRef.current(tree);
      return true;
    };

    const measureVertexAt = (point: mapboxgl.Point) => {
      const hitBox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
        [point.x - 6, point.y - 6],
        [point.x + 6, point.y + 6],
      ];
      return map.getLayer(MEASURE_POINT_LAYER)
        ? map.queryRenderedFeatures(hitBox, { layers: [MEASURE_POINT_LAYER] })
        : [];
    };

    // Measure mode: click adds a vertex; clicking an existing vertex removes
    // it. Deferred like tree clicks so a double-click (finish) can cancel the
    // two single-click edits it would otherwise trigger.
    const handleMeasureClick = (event: mapboxgl.MapMouseEvent) => {
      if (measureClickTimeoutRef.current) {
        clearTimeout(measureClickTimeoutRef.current);
      }

      const { point } = event;
      const lngLat: [number, number] = [event.lngLat.lng, event.lngLat.lat];

      measureClickTimeoutRef.current = setTimeout(() => {
        measureClickTimeoutRef.current = null;
        const hits = measureVertexAt(point);

        if (hits.length > 0) {
          const removeIndex = hits[0].properties?.index as number;
          measurePointsRef.current = measurePointsRef.current.filter(
            (_, index) => index !== removeIndex,
          );
        } else {
          ensureMeasureLayers(map);
          measurePointsRef.current = [...measurePointsRef.current, lngLat];
        }

        refreshMeasureData(map);
        updateMeasurePreview(map, measureHoverPointRef.current);
      }, 250);
    };

    map.on("click", (event) => {
      // Synthetic click after a handled touch tap — ignore to avoid double work / clear.
      if (performance.now() < ignoreClickUntilRef.current) {
        return;
      }

      if (measureActiveRef.current) {
        handleMeasureClick(event);
        return;
      }

      if (drawBlocksInteraction()) {
        return;
      }

      const tree = treeFromPoint(event.point);

      if (tree) {
        if (routeStartPickModeRef.current) {
          if (excludedIdsRef.current.includes(tree.properties.id)) {
            return;
          }
          onRouteStartPickRef.current(tree);
          return;
        }

        // Touch: select immediately. Desktop: delay so dblclick can exclude.
        if (isTouchUi()) {
          onSelectTreeRef.current(tree);
          return;
        }

        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
        }
        clickTimeoutRef.current = setTimeout(() => {
          onSelectTreeRef.current(tree);
          clickTimeoutRef.current = null;
        }, 250);
        return;
      }

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      onClearTreeRef.current();
    });

    map.on("dblclick", (event) => {
      if (isTouchUi()) {
        return;
      }

      // Double-click finishes the measurement: place the final vertex (unless
      // on an existing one) and exit mode, leaving the drawing on screen.
      if (measureActiveRef.current) {
        event.preventDefault();
        if (measureClickTimeoutRef.current) {
          clearTimeout(measureClickTimeoutRef.current);
          measureClickTimeoutRef.current = null;
        }
        if (measureVertexAt(event.point).length === 0) {
          measurePointsRef.current = [
            ...measurePointsRef.current,
            [event.lngLat.lng, event.lngLat.lat],
          ];
        }
        setMeasureModeRef.current(false);
        return;
      }

      if (drawBlocksInteraction()) {
        return;
      }

      const tree = treeFromPoint(event.point);
      if (!tree) {
        return;
      }

      event.preventDefault();

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }

      onToggleTreeRef.current(tree);
    });

    // Mapbox Draw / delayed-click often swallows or cancels taps on phones.
    // Handle touch directly on the canvas for reliable selection.
    const canvas = map.getCanvas();
    const clearTouchGesture = () => {
      const gesture = touchGestureRef.current;
      if (gesture?.longPressTimer) {
        clearTimeout(gesture.longPressTimer);
      }
      touchGestureRef.current = null;
    };

    const onTouchStart = (event: TouchEvent) => {
      // In measure mode, let the synthetic click through so taps add points.
      if (
        event.touches.length !== 1 ||
        drawBlocksInteraction() ||
        measureActiveRef.current
      ) {
        clearTouchGesture();
        return;
      }
      const touch = event.touches[0];
      clearTouchGesture();
      touchGestureRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        longPressFired: false,
        longPressTimer: setTimeout(() => {
          const gesture = touchGestureRef.current;
          if (!gesture) {
            return;
          }
          gesture.longPressFired = true;
          const point = mapPointFromClient(map, gesture.startX, gesture.startY);
          if (toggleTreeAtPoint(point)) {
            ignoreClickUntilRef.current = performance.now() + 500;
          }
        }, 550),
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      if (!gesture || event.touches.length !== 1) {
        return;
      }
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.startX;
      const dy = touch.clientY - gesture.startY;
      if (dx * dx + dy * dy > 100) {
        clearTouchGesture();
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      if (!gesture) {
        return;
      }
      const longPressFired = gesture.longPressFired;
      const { startX, startY } = gesture;
      clearTouchGesture();

      if (longPressFired || drawBlocksInteraction()) {
        ignoreClickUntilRef.current = performance.now() + 500;
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        return;
      }
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (dx * dx + dy * dy > 100) {
        return;
      }

      const point = mapPointFromClient(map, touch.clientX, touch.clientY);
      if (selectTreeAtPoint(point)) {
        ignoreClickUntilRef.current = performance.now() + 500;
        event.preventDefault();
      }
    };

    const onTouchCancel = () => {
      clearTouchGesture();
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: true });
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchCancel, { passive: true });

    const handleTreeMouseEnter = (
      event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] },
    ) => {
      if (isTouchUi() || measureActiveRef.current) {
        return;
      }
      map.getCanvas().style.cursor = routeStartPickModeRef.current
        ? "crosshair"
        : "pointer";

      const feature = event.features?.[0];
      if (!feature) return;

      const treeId = feature.properties?.id as number;
      const tree = treesRef.current.find((t) => t.properties.id === treeId);
      if (!tree) return;

      onHoverTreeRef.current(treeId);

      popupRef.current?.remove();
      const coordinates = tree.geometry.coordinates as [number, number];
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: getTreePopupOffset(
          map,
          coordinates,
          analysisPopupHeightRef.current,
        ),
        className: "tree-hover-popup",
      })
        .setLngLat(coordinates)
        .setHTML(`ID #${treeId}`)
        .addTo(map);
    };

    const handleTreeMouseLeave = () => {
      if (isTouchUi()) {
        return;
      }
      map.getCanvas().style.cursor =
        routeStartPickModeRef.current || measureActiveRef.current
          ? "crosshair"
          : "";
      onHoverTreeRef.current(null);
      popupRef.current?.remove();
      popupRef.current = null;
    };

    map.on("mouseenter", TREE_CIRCLE_LAYER, handleTreeMouseEnter);
    map.on("mouseenter", TREE_FOCUS_LAYER, handleTreeMouseEnter);
    map.on("mouseleave", TREE_CIRCLE_LAYER, handleTreeMouseLeave);
    map.on("mouseleave", TREE_FOCUS_LAYER, handleTreeMouseLeave);

    map.on("mousemove", (event) => {
      if (!measureActiveRef.current || isTouchUi()) {
        return;
      }
      measureHoverPointRef.current = [event.lngLat.lng, event.lngLat.lat];
      updateMeasurePreview(map, measureHoverPointRef.current);
    });

    map.on("mouseout", () => {
      if (!measureActiveRef.current) {
        return;
      }
      measureHoverPointRef.current = null;
      updateMeasurePreview(map, null);
    });
  }, [ensureMeasureLayers, refreshMeasureData, updateMeasurePreview]);

  const addTreeLayer = useCallback((map: mapboxgl.Map) => {
    if (map.getSource("spicebush-trees")) {
      (map.getSource("spicebush-trees") as mapboxgl.GeoJSONSource).setData(
        treesToGeoJSON(treesRef.current),
      );
      ensureHeatmapLayer(map);
      applyHeatmapState(
        map,
        densityHeatmapRef.current,
        excludedIdsRef.current,
      );
      applyTreePointVisibility(map, showTreePointsRef.current);
      applyCircleStyles(
        map,
        null,
        null,
        excludedIdsRef.current,
        routeStartTreeIdRef.current,
        colorBySexRef.current,
      );
      ensureRouteLineLayer(map);
      ensureRouteStopLayer(map);
      updateRouteLayers(map);
      attachTreeInteractionHandlers(map);
      return;
    }

    map.addSource("spicebush-trees", {
      type: "geojson",
      data: treesToGeoJSON(treesRef.current),
    });

    map.addLayer({
      id: TREE_CIRCLE_LAYER,
      type: "circle",
      source: "spicebush-trees",
      paint: {
        "circle-radius": isTouchUi() ? 8 : 7,
        "circle-color": sexCircleColorExpression(),
        "circle-stroke-color": SEX_MARKER_STROKE,
        "circle-stroke-width": 2,
        "circle-opacity": 0.92,
      },
    });

    ensureHeatmapLayer(map);
    applyHeatmapState(
      map,
      densityHeatmapRef.current,
      excludedIdsRef.current,
    );
    applyTreePointVisibility(map, showTreePointsRef.current);

    applyCircleStyles(
      map,
      null,
      null,
      excludedIdsRef.current,
      routeStartTreeIdRef.current,
      colorBySexRef.current,
    );
    // Line must be ensured after circles/heatmap so it sits above the heatmap.
    ensureRouteLineLayer(map);
    ensureRouteStopLayer(map);
    updateRouteLayers(map);
    attachTreeInteractionHandlers(map);
  }, [attachTreeInteractionHandlers, ensureRouteLineLayer, ensureRouteStopLayer, updateRouteLayers]);

  const initializeMapContent = useCallback(
    (map: mapboxgl.Map) => {
      applyBasemapPresentation(map, basemap);
      addTreeLayer(map);
      setupDrawControl(map);
      // Measure layers sit above trees; restore them (and any in-progress
      // measurement) after basemap style swaps. Button setup runs after the
      // draw merge so the ruler lands below the polygon/trash buttons.
      ensureMeasureLayers(map);
      refreshMeasureData(map);
      setupMeasureControl(map);
    },
    [
      addTreeLayer,
      basemap,
      setupDrawControl,
      ensureMeasureLayers,
      refreshMeasureData,
      setupMeasureControl,
    ],
  );
  const initializeMapContentRef = useRef(initializeMapContent);
  initializeMapContentRef.current = initializeMapContent;

  const prevBasemap = useRef<BasemapStyle | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getBasemapStyleUrl(basemap),
      center: [-72.916, 41.337],
      zoom: 16.5,
      maxZoom: 21,
      attributionControl: false,
    });

    const fitSurveyBounds = (duration: number) => {
      if (treesRef.current.length === 0) {
        return;
      }
      const bounds = new mapboxgl.LngLatBounds();
      treesRef.current.forEach((tree) => {
        bounds.extend(tree.geometry.coordinates);
      });
      map.fitBounds(bounds, { padding: 120, maxZoom: 17.5, duration });
    };

    map.addControl(
      new mapboxgl.NavigationControl({ showCompass: false }),
      "bottom-left",
    );
    map.addControl(new HomeControl(() => fitSurveyBounds(900)), "bottom-left");
    map.addControl(
      new mapboxgl.NavigationControl({ showZoom: false, visualizePitch: true }),
      "bottom-left",
    );
    mergeHomeIntoNavigation(map);
    markCompassGroup(map);
    map.doubleClickZoom.disable();
    map.on("load", () => {
      prevBasemap.current = basemap;
      initializeMapContentRef.current(map);
      fitSurveyBounds(0);
      map.resize();
    });

    mapRef.current = map;

    const resizeMap = () => {
      map.resize();
    };

    const resizeObserver = new ResizeObserver(resizeMap);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }
    window.addEventListener("resize", resizeMap);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", resizeMap);
      popupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      drawRef.current = null;
      prevBasemap.current = null;
      treeHandlersAttachedRef.current = false;
      measureButtonRef.current = null;
      measureActiveRef.current = false;
      measurePointsRef.current = [];
      measureHoverPointRef.current = null;
      setMeasureActive(false);
      if (routeAnimFrameRef.current !== null) {
        window.cancelAnimationFrame(routeAnimFrameRef.current);
        routeAnimFrameRef.current = null;
      }
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      if (measureClickTimeoutRef.current) {
        clearTimeout(measureClickTimeoutRef.current);
        measureClickTimeoutRef.current = null;
      }
    };
    // Create the map once per token. Style/content updates use separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- basemap is initial style only
  }, [mapboxToken]);

  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container) return;

    if (prevBasemap.current === null) {
      prevBasemap.current = basemap;
      return;
    }

    if (prevBasemap.current === basemap) return;

    const previousBasemap = prevBasemap.current;
    prevBasemap.current = basemap;

    const previousUrl = getBasemapStyleUrl(previousBasemap);
    const nextUrl = getBasemapStyleUrl(basemap);
    const sameUrl = previousUrl === nextUrl;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    // Summer and Spring both use Streets + a CT raster overlay. Mapbox will not
    // re-fire style.load for the same URL, so swap overlays in place.
    if (sameUrl && prefersReducedMotion) {
      applyBasemapPresentation(map, basemap);
      ensureRouteLineLayer(map);
      ensureRouteStopLayer(map);
      updateRouteLayers(map);
      return;
    }

    let cancelled = false;
    let fadeInTimer: number | null = null;
    let swapTimer: number | null = null;
    const fadeMs = 280;
    const startedAt = performance.now();

    const reveal = () => {
      if (cancelled) {
        return;
      }
      if (!sameUrl) {
        initializeMapContentRef.current(map);
      }
      const elapsed = performance.now() - startedAt;
      const wait = prefersReducedMotion ? 0 : Math.max(0, fadeMs - elapsed);
      fadeInTimer = window.setTimeout(() => {
        if (!cancelled) {
          container.classList.remove("spicebush-map--style-swap");
        }
      }, wait);
    };

    if (!prefersReducedMotion) {
      // Fade through black both ways (Mapbox only fades satellite raster in natively).
      container.classList.add("spicebush-map--style-swap");
    }

    if (sameUrl) {
      // Swap the raster overlay behind the fade, then reveal once tiles settle.
      swapTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        applyBasemapPresentation(map, basemap);
        ensureRouteLineLayer(map);
        ensureRouteStopLayer(map);
        updateRouteLayers(map);
        map.once("idle", reveal);
      }, fadeMs);
    } else {
      map.once("style.load", reveal);
      map.setStyle(nextUrl);
    }

    return () => {
      cancelled = true;
      if (fadeInTimer !== null) {
        window.clearTimeout(fadeInTimer);
      }
      if (swapTimer !== null) {
        window.clearTimeout(swapTimer);
      }
      map.off("style.load", reveal);
      map.off("idle", reveal);
      container.classList.remove("spicebush-map--style-swap");
    };
  }, [basemap, ensureRouteLineLayer, ensureRouteStopLayer, updateRouteLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("spicebush-trees")) return;

    (map.getSource("spicebush-trees") as mapboxgl.GeoJSONSource).setData(
      treesToGeoJSON(trees),
    );
    treesRef.current = trees;
  }, [trees]);

  useEffect(() => {
    syncDrawPolygon(regionPolygon);
  }, [regionPolygon, syncDrawPolygon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("spicebush-trees")) return;

    applyCircleStyles(
      map,
      selectedTreeId,
      highlightedTreeId,
      manualExcludedIds,
      routeStartTreeId,
      colorBySex,
    );
    applyHeatmapState(map, densityHeatmap, manualExcludedIds);
    applyTreePointVisibility(map, showTreePoints);
    ensureRouteLineLayer(map);

    if (selectedTreeId !== null && flyToOnSelect) {
      const tree = trees.find((t) => t.properties.id === selectedTreeId);
      if (tree) {
        const [lng, lat] = tree.geometry.coordinates;
        map.flyTo({
          center: [lng, lat],
          zoom: Math.max(map.getZoom(), 17),
          duration: 800,
        });
      }
    }
  }, [selectedTreeId, highlightedTreeId, manualExcludedIds, routeStartTreeId, trees, flyToOnSelect, densityHeatmap, showTreePoints, colorBySex, ensureRouteLineLayer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    let disposed = false;
    let completed = false;

    const apply = () => {
      if (disposed) {
        return;
      }

      // Creating route layers before style load throws and can blank the page.
      // isStyleLoaded() is also false whenever tiles are streaming (routine
      // with the CT aerial overlays) — retry on idle instead of dropping the
      // update, which used to leave stale/partial routes stuck on the map.
      if (!map.isStyleLoaded() || !map.getSource("spicebush-trees")) {
        map.once("idle", apply);
        return;
      }

      ensureRouteLineLayer(map);
      ensureRouteStopLayer(map);

      if (!map.getSource("survey-route-line")) {
        return;
      }

      cancelRouteAnimation();

      const fullLine = routeLine;
      const fullStops = routeStops;
      const hasLine =
        (fullLine.features[0]?.geometry.coordinates.length ?? 0) >= 2;

      if (!route || !hasLine) {
        lastAnimatedRouteRef.current = null;
        setRouteLayerData(map, EMPTY_ROUTE_LINE, EMPTY_ROUTE_STOPS);
        return;
      }

      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      // Same route object — only refresh geometry (e.g. tree coords), don't replay.
      if (route === lastAnimatedRouteRef.current) {
        setRouteLayerData(map, fullLine, fullStops);
        return;
      }

      lastAnimatedRouteRef.current = route;

      if (prefersReducedMotion) {
        setRouteLayerData(map, fullLine, fullStops);
        return;
      }

      const durationMs = routeTraceDurationMs(route.orderedIds.length);
      const startedAt = performance.now();

      const tick = (now: number) => {
        const elapsed = now - startedAt;
        const t = Math.min(1, elapsed / durationMs);
        const eased = 1 - (1 - t) ** 2;
        const partial = buildPartialRouteGeoJSON(fullLine, fullStops, eased);
        setRouteLayerData(map, partial.line, partial.stops);

        if (t < 1) {
          routeAnimFrameRef.current = window.requestAnimationFrame(tick);
        } else {
          completed = true;
          routeAnimFrameRef.current = null;
          setRouteLayerData(map, fullLine, fullStops);
        }
      };

      const initial = buildPartialRouteGeoJSON(fullLine, fullStops, 0);
      setRouteLayerData(map, initial.line, initial.stops);
      routeAnimFrameRef.current = window.requestAnimationFrame(tick);
    };

    apply();

    return () => {
      disposed = true;
      map.off("idle", apply);
      cancelRouteAnimation();
      // Allow replay if this effect is cleaned up mid-trace (e.g. Strict Mode).
      if (!completed && lastAnimatedRouteRef.current === route) {
        lastAnimatedRouteRef.current = null;
      }
    };
  }, [
    route,
    routeLine,
    routeStops,
    cancelRouteAnimation,
    ensureRouteLineLayer,
    ensureRouteStopLayer,
    setRouteLayerData,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.getCanvas().style.cursor =
      routeStartPickMode || measureActiveRef.current ? "crosshair" : "";
  }, [routeStartPickMode]);

  useEffect(() => {
    if (!measureActive) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMeasureMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [measureActive, setMeasureMode]);

  const sexLegendVisible = colorBySex && showTreePoints;
  const [sexLegendPresent, setSexLegendPresent] = useState(sexLegendVisible);
  const { closing: sexLegendClosing, beginClose: beginSexLegendClose } =
    useCloseAnimation(240);

  useEffect(() => {
    if (sexLegendVisible) {
      setSexLegendPresent(true);
      return;
    }
    if (!sexLegendPresent || sexLegendClosing) {
      return;
    }
    beginSexLegendClose(() => setSexLegendPresent(false));
  }, [
    sexLegendVisible,
    sexLegendPresent,
    sexLegendClosing,
    beginSexLegendClose,
  ]);

  return (
    <div
      ref={containerRef}
      className={`spicebush-map${routeStartPickMode ? " spicebush-map--route-pick" : ""}`}
    >
      {sexLegendPresent && (
        <div
          className={`spicebush-map__sex-legend${
            sexLegendClosing ? " spicebush-map__sex-legend--closing" : ""
          }`}
          aria-label="Sex legend"
          aria-hidden={sexLegendClosing}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onTouchStart={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <p className="spicebush-map__sex-legend-title">Sex</p>
          <div className="spicebush-map__sex-legend-body">
            {SEX_LEGEND_ITEMS.map((item) => (
              <div key={item.key} className="spicebush-map__sex-legend-item">
                <span
                  className="spicebush-map__sex-legend-swatch"
                  style={{ background: item.color }}
                  aria-hidden="true"
                />
                <span className="spicebush-map__sex-legend-label">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {usesCtAerialOverlay(basemap) && getBasemapAttribution(basemap) && (
        <div className="spicebush-map__attribution" aria-hidden="true">
          {getBasemapAttribution(basemap)}
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useCallback } from "react";
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
  routeTraceDurationMs,
} from "../utils/route";
import "./SpicebushMap.css";

const STYLE_URLS: Record<BasemapStyle, string> = {
  satellite: "mapbox://styles/mapbox/satellite-streets-v12",
  terrain: "mapbox://styles/mapbox/outdoors-v12",
};

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
      properties: { id: tree.properties.id },
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
      "circle-radius": 7,
      "circle-color": "#3d7a3d",
      "circle-stroke-color": "#f4f7f0",
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

function queryTreeFeatures(
  map: mapboxgl.Map,
  point: mapboxgl.PointLike,
): mapboxgl.MapboxGeoJSONFeature[] {
  if (map.getLayer(TREE_FOCUS_LAYER)) {
    const focused = map.queryRenderedFeatures(point, {
      layers: [TREE_FOCUS_LAYER],
    });
    if (focused.length > 0) {
      return focused;
    }
  }

  return map.queryRenderedFeatures(point, {
    layers: [TREE_CIRCLE_LAYER],
  });
}

function applyCircleStyles(
  map: mapboxgl.Map,
  selectedTreeId: number | null,
  highlightedTreeId: number | null,
  excludedIds: number[],
  routeStartTreeId: number | null,
) {
  if (!map.getLayer(TREE_CIRCLE_LAYER)) {
    return;
  }

  ensureFocusCircleLayer(map);

  const activeTree = isActiveTreeExpression(selectedTreeId, highlightedTreeId);

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
    "#8a968a",
    "#3d7a3d",
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
    "#f4f7f0",
    ["in", ["get", "id"], ["literal", excludedIds]],
    "#d0d8cc",
    "#f4f7f0",
  ];

  const circleStrokeWidth: mapboxgl.Expression = [
    "case",
    activeTree,
    2.5,
    2,
  ];

  map.setPaintProperty(TREE_CIRCLE_LAYER, "circle-radius", 7);
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

  map.setPaintProperty(TREE_FOCUS_LAYER, "circle-radius", 7);
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
}: SpicebushMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const analysisPopupHeightRef = useRef(analysisPopupHeight);
  const treesRef = useRef(trees);
  const excludedIdsRef = useRef(manualExcludedIds);
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
  const routeAnimFrameRef = useRef<number | null>(null);
  const lastAnimatedRouteRef = useRef<ComputedRoute | null>(null);

  treesRef.current = trees;
  excludedIdsRef.current = manualExcludedIds;
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
      } else if (!map.hasControl(drawRef.current)) {
        map.addControl(drawRef.current, "bottom-left");
        patchDrawControlTitles(map);
        mergeDrawControlsIntoNavigation(map);
      }

      syncDrawPolygon(regionPolygonRef.current);
    },
    [publishDrawnRegion, syncDrawPolygon],
  );

  const ensureRouteLineLayer = useCallback((map: mapboxgl.Map) => {
    if (map.getSource("survey-route-line")) {
      return;
    }

    map.addSource("survey-route-line", {
      type: "geojson",
      data: routeLineRef.current,
    });

    const beforeLayer = map.getLayer("spicebush-circles")
      ? "spicebush-circles"
      : undefined;

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
  }, []);

  const ensureRouteStopLayer = useCallback((map: mapboxgl.Map) => {
    if (map.getSource("survey-route-stops")) {
      return;
    }

    map.addSource("survey-route-stops", {
      type: "geojson",
      data: routeStopsRef.current,
    });

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

    map.on("click", (event) => {
      const draw = drawRef.current;
      if (draw && draw.getMode() !== "simple_select") {
        return;
      }

      const features = queryTreeFeatures(map, event.point);

      if (features.length > 0) {
        const feature = features[0];
        const treeId = feature.properties?.id as number;
        const tree = treesRef.current.find((t) => t.properties.id === treeId);
        if (!tree) return;

        if (routeStartPickModeRef.current) {
          if (excludedIdsRef.current.includes(treeId)) {
            return;
          }
          onRouteStartPickRef.current(tree);
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
      const draw = drawRef.current;
      if (draw && draw.getMode() !== "simple_select") {
        return;
      }

      const features = queryTreeFeatures(map, event.point);

      if (features.length === 0) {
        return;
      }

      event.preventDefault();

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }

      const feature = features[0];
      const treeId = feature.properties?.id as number;
      const tree = treesRef.current.find((t) => t.properties.id === treeId);
      if (!tree) return;

      onToggleTreeRef.current(tree);
    });

    const handleTreeMouseEnter = (
      event: mapboxgl.MapMouseEvent & { features?: mapboxgl.MapboxGeoJSONFeature[] },
    ) => {
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
      map.getCanvas().style.cursor = routeStartPickModeRef.current
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
  }, []);

  const addTreeLayer = useCallback((map: mapboxgl.Map) => {
    if (map.getSource("spicebush-trees")) {
      (map.getSource("spicebush-trees") as mapboxgl.GeoJSONSource).setData(
        treesToGeoJSON(treesRef.current),
      );
      applyCircleStyles(
        map,
        null,
        null,
        excludedIdsRef.current,
        routeStartTreeIdRef.current,
      );
      ensureRouteLineLayer(map);
      ensureRouteStopLayer(map);
      updateRouteLayers(map);
      attachTreeInteractionHandlers(map);
      return;
    }

    ensureRouteLineLayer(map);

    map.addSource("spicebush-trees", {
      type: "geojson",
      data: treesToGeoJSON(treesRef.current),
    });

    map.addLayer({
      id: TREE_CIRCLE_LAYER,
      type: "circle",
      source: "spicebush-trees",
      paint: {
        "circle-radius": 7,
        "circle-color": "#3d7a3d",
        "circle-stroke-color": "#f4f7f0",
        "circle-stroke-width": 2,
        "circle-opacity": 0.92,
      },
    });

    applyCircleStyles(
      map,
      null,
      null,
      excludedIdsRef.current,
      routeStartTreeIdRef.current,
    );
    ensureRouteStopLayer(map);
    updateRouteLayers(map);
    attachTreeInteractionHandlers(map);
  }, [attachTreeInteractionHandlers, ensureRouteLineLayer, ensureRouteStopLayer, updateRouteLayers]);

  const initializeMapContent = useCallback(
    (map: mapboxgl.Map) => {
      applyTrailBorderColorOverride(map, basemap);
      addTreeLayer(map);
      setupDrawControl(map);
    },
    [addTreeLayer, basemap, setupDrawControl],
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
      style: STYLE_URLS[basemap],
      center: [-72.916, 41.337],
      zoom: 16.5,
    });

    map.addControl(new mapboxgl.NavigationControl(), "bottom-left");
    map.doubleClickZoom.disable();
    map.on("load", () => {
      prevBasemap.current = basemap;
      initializeMapContentRef.current(map);

      const bounds = new mapboxgl.LngLatBounds();
      treesRef.current.forEach((tree) => {
        bounds.extend(tree.geometry.coordinates);
      });
      map.fitBounds(bounds, { padding: 80, maxZoom: 17, duration: 0 });
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
      if (routeAnimFrameRef.current !== null) {
        window.cancelAnimationFrame(routeAnimFrameRef.current);
        routeAnimFrameRef.current = null;
      }
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
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
    prevBasemap.current = basemap;

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let cancelled = false;
    let fadeInTimer: number | null = null;
    const fadeMs = 280;
    const startedAt = performance.now();

    const reveal = () => {
      if (cancelled) {
        return;
      }
      initializeMapContentRef.current(map);
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

    map.once("style.load", reveal);
    map.setStyle(STYLE_URLS[basemap]);

    return () => {
      cancelled = true;
      if (fadeInTimer !== null) {
        window.clearTimeout(fadeInTimer);
      }
      map.off("style.load", reveal);
      container.classList.remove("spicebush-map--style-swap");
    };
  }, [basemap]);

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
    if (!map) return;

    applyCircleStyles(
      map,
      selectedTreeId,
      highlightedTreeId,
      manualExcludedIds,
      routeStartTreeId,
    );

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
  }, [selectedTreeId, highlightedTreeId, manualExcludedIds, routeStartTreeId, trees, flyToOnSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("survey-route-line")) {
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
    let completed = false;

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

    return () => {
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
    setRouteLayerData,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    map.getCanvas().style.cursor = routeStartPickMode ? "crosshair" : "";
  }, [routeStartPickMode]);

  return (
    <div
      ref={containerRef}
      className={`spicebush-map${routeStartPickMode ? " spicebush-map--route-pick" : ""}`}
    />
  );
}

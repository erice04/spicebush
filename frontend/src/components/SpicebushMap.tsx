import { useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Polygon } from "geojson";
import "mapbox-gl/dist/mapbox-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import type { BasemapStyle, TreeFeature } from "../types";
import type { ComputedRoute } from "../utils/route";
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

function applyCircleStyles(
  map: mapboxgl.Map,
  selectedTreeId: number | null,
  highlightedTreeId: number | null,
  excludedIds: number[],
  routeStartTreeId: number | null,
) {
  if (!map.getLayer("spicebush-circles")) {
    return;
  }

  map.setPaintProperty("spicebush-circles", "circle-radius", [
    "case",
    [
      "any",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["==", ["get", "id"], highlightedTreeId ?? -1],
    ],
    9,
    7,
  ]);

  map.setPaintProperty("spicebush-circles", "circle-color", [
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
  ]);

  map.setPaintProperty("spicebush-circles", "circle-opacity", [
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
  ]);

  map.setPaintProperty("spicebush-circles", "circle-stroke-color", [
    "case",
    [
      "any",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["==", ["get", "id"], highlightedTreeId ?? -1],
    ],
    "#2d4a2d",
    [
      "all",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["in", ["get", "id"], ["literal", excludedIds]],
    ],
    "#e8d4bc",
    ["==", ["get", "id"], selectedTreeId ?? -1],
    "#f4ece0",
    ["in", ["get", "id"], ["literal", excludedIds]],
    "#d0d8cc",
    "#f4f7f0",
  ]);

  map.setPaintProperty("spicebush-circles", "circle-stroke-width", [
    "case",
    [
      "any",
      ["==", ["get", "id"], selectedTreeId ?? -1],
      ["==", ["get", "id"], highlightedTreeId ?? -1],
    ],
    2.5,
    2,
  ]);
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
}: SpicebushMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const drawRef = useRef<MapboxDraw | null>(null);
  const popupRef = useRef<mapboxgl.Popup | null>(null);
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
  const isSyncingDrawRef = useRef(false);
  const treeHandlersAttachedRef = useRef(false);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      syncDrawPolygon(regionPolygon);
    },
    [publishDrawnRegion, regionPolygon, syncDrawPolygon],
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

      const features = map.queryRenderedFeatures(event.point, {
        layers: ["spicebush-circles"],
      });

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

      const features = map.queryRenderedFeatures(event.point, {
        layers: ["spicebush-circles"],
      });

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

    map.on("mouseenter", "spicebush-circles", (event) => {
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
      popupRef.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 10,
        className: "tree-hover-popup",
      })
        .setLngLat(tree.geometry.coordinates)
        .setHTML(`ID #${treeId}`)
        .addTo(map);
    });

    map.on("mouseleave", "spicebush-circles", () => {
      map.getCanvas().style.cursor = routeStartPickModeRef.current
        ? "crosshair"
        : "";
      onHoverTreeRef.current(null);
      popupRef.current?.remove();
      popupRef.current = null;
    });
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
      id: "spicebush-circles",
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
      initializeMapContent(map);

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
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
    };
  }, [mapboxToken, basemap, initializeMapContent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (prevBasemap.current === null) {
      prevBasemap.current = basemap;
      return;
    }

    if (prevBasemap.current === basemap) return;
    prevBasemap.current = basemap;

    map.setStyle(STYLE_URLS[basemap]);
    map.once("style.load", () => initializeMapContent(map));
  }, [basemap, initializeMapContent]);

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

    if (selectedTreeId !== null) {
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
  }, [selectedTreeId, highlightedTreeId, manualExcludedIds, routeStartTreeId, trees]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("survey-route-line")) {
      return;
    }

    updateRouteLayers(map);
  }, [route, routeLine, routeStops, updateRouteLayers]);

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

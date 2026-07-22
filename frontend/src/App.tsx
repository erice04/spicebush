import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SpicebushMap from "./components/SpicebushMap";
import TreeSidebar from "./components/TreeSidebar";
import FilterPanel from "./components/FilterPanel";
import DataPanel from "./components/DataPanel";
import RoutePanel from "./components/RoutePanel";
import AnalysisPanel, { AnalysisPanelTab } from "./components/AnalysisPanel";
import HelpPanel from "./components/HelpPanel";
import MapLayersControl from "./components/MapLayersControl";
import type {
  BasemapStyle,
  SelectionState,
  TreeFeature,
  TreeFeatureCollection,
} from "./types";
import {
  deleteSavedSelection,
  getSavedSelection,
  listSavedSelections,
  saveSelection,
  type SavedSelectionSummary,
} from "./api/selections";
import { getAnalysis, getBundledAnalysis } from "./api/analysis";
import { checkApiHealth } from "./api/health";
import { getTrees } from "./api/spreadsheet";
import type { AnalysisResponse } from "./types/analysis";
import {
  clampFiltersToBounds,
  computeDataBounds,
  countActiveFilters,
  createDefaultFilters,
  type SexPredictionById,
} from "./utils/filters";
import {
  clearManualExcluded,
  countActiveSelectionLayers,
  createDefaultSelection,
  getMapTrees,
  getVisibleTrees,
  toggleManualExcluded,
} from "./utils/selection";
import {
  buildRouteGeoJSON,
  computeSurveyRoute,
  type ComputedRoute,
} from "./utils/route";
import { isUncertainPrediction } from "./utils/sexPrediction";
import { subscribeDataUpdated } from "./utils/dataSync";
import "./App.css";

function App() {
  const [trees, setTrees] = useState<TreeFeature[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeFeature | null>(null);
  const [basemap, setBasemap] = useState<BasemapStyle>("satellite");
  const [densityHeatmap, setDensityHeatmap] = useState(false);
  const [showTreePoints, setShowTreePoints] = useState(true);
  const [colorBySex, setColorBySex] = useState(true);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const hasOpenedHelp = useRef(false);
  const [savedSelections, setSavedSelections] = useState<SavedSelectionSummary[]>([]);
  const [selectionApiAvailable, setSelectionApiAvailable] = useState(false);
  const [selectionApiConnecting, setSelectionApiConnecting] = useState(true);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [route, setRoute] = useState<ComputedRoute | null>(null);
  const [routeActive, setRouteActive] = useState(false);
  const [routeStartTreeId, setRouteStartTreeId] = useState<number | null>(null);
  const [routeStartPickMode, setRouteStartPickMode] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(() =>
    getBundledAnalysis(),
  );
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisExpanded, setAnalysisExpanded] = useState(false);
  const [analysisPageExiting, setAnalysisPageExiting] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [routeCloseSignal, setRouteCloseSignal] = useState(0);
  const [filterCloseSignal, setFilterCloseSignal] = useState(0);
  const [highlightedTreeId, setHighlightedTreeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appMainRef = useRef<HTMLElement>(null);

  const bounds = useMemo(
    () => (trees.length > 0 ? computeDataBounds(trees) : null),
    [trees],
  );

  const sexPredictions = useMemo((): SexPredictionById | undefined => {
    if (!analysis) {
      return undefined;
    }
    const map: SexPredictionById = new Map();
    for (const point of analysis.pca.points) {
      map.set(point.id, {
        sexKnown: point.sex_known,
        probabilityFemale: point.probability_female,
      });
    }
    return map;
  }, [analysis]);

  const mapTrees = useMemo(() => {
    if (!selection || !bounds) {
      return trees;
    }
    return getMapTrees(trees, selection, bounds, sexPredictions);
  }, [trees, selection, bounds, sexPredictions]);

  const treesForMap = useMemo(() => {
    if (
      selectedTree &&
      !mapTrees.some(
        (tree) => tree.properties.id === selectedTree.properties.id,
      )
    ) {
      return [...mapTrees, selectedTree];
    }
    return mapTrees;
  }, [mapTrees, selectedTree]);

  const visibleTrees = useMemo(() => {
    if (!selection || !bounds) {
      return trees;
    }
    return getVisibleTrees(trees, selection, bounds, sexPredictions);
  }, [trees, selection, bounds, sexPredictions]);

  const manualExcludedIds = useMemo(
    () => (selection ? [...selection.manualExcluded] : []),
    [selection],
  );

  const activeAttributeCount = useMemo(() => {
    if (!selection || !bounds) {
      return 0;
    }
    return countActiveFilters(selection.attributeFilters, bounds);
  }, [selection, bounds]);

  const activeSelectionCount = useMemo(() => {
    if (!selection || !bounds) {
      return 0;
    }
    return countActiveSelectionLayers(selection, activeAttributeCount);
  }, [selection, bounds, activeAttributeCount]);

  useEffect(() => {
    let cancelled = false;

    async function loadTrees() {
      try {
        const res = await fetch("/data/spicebush.json");
        if (!res.ok) {
          throw new Error(`Failed to load spicebush data (${res.status})`);
        }
        const data = (await res.json()) as TreeFeatureCollection;
        if (cancelled) {
          return;
        }
        setTrees(data.features);
        setSelection(
          createDefaultSelection(
            createDefaultFilters(computeDataBounds(data.features)),
          ),
        );
        setLoading(false);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load data");
        setLoading(false);
        return;
      }

      // Refresh from API in the background once the free tier wakes (non-blocking).
      void getTrees()
        .then((fromApi) => {
          if (cancelled) {
            return;
          }
          setSelectionApiConnecting(false);
          setSelectionApiAvailable(true);
          const nextTrees = fromApi.features;
          const nextBounds = computeDataBounds(nextTrees);
          setTrees(nextTrees);
          setSelection((current) => {
            if (!current) {
              return createDefaultSelection(createDefaultFilters(nextBounds));
            }
            return {
              ...current,
              attributeFilters: clampFiltersToBounds(
                current.attributeFilters,
                nextBounds,
              ),
            };
          });
        })
        .catch(() => undefined);
    }

    void loadTrees();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return subscribeDataUpdated(() => {
      void getTrees()
        .then((collection) => {
          const nextTrees = collection.features;
          const nextBounds = computeDataBounds(nextTrees);
          setTrees(nextTrees);
          setSelection(createDefaultSelection(createDefaultFilters(nextBounds)));
          setSelectedTree(null);
          setHighlightedTreeId(null);
          setRoute(null);
          setRouteActive(false);
          setRouteStartTreeId(null);
          setRouteStartPickMode(false);
        })
        .catch(() => undefined);
      void getAnalysis()
        .then((next) => {
          setAnalysis(next);
          setAnalysisError(null);
        })
        .catch(() => undefined);
    });
  }, []);

  useEffect(() => {
    getAnalysis()
      .then((result) => {
        setAnalysis(result);
        setAnalysisError(null);
      })
      .catch(() => {
        setAnalysis(getBundledAnalysis());
        setAnalysisError(null);
      });
  }, []);

  useEffect(() => {
    if (!loading && !hasOpenedHelp.current) {
      hasOpenedHelp.current = true;
      setHelpOpen(true);
    }
  }, [loading]);

  const visibleTreeIds = useMemo(
    () => visibleTrees.map((tree) => tree.properties.id),
    [visibleTrees],
  );

  const routeGeoJSON = useMemo(
    () => buildRouteGeoJSON(route, visibleTrees),
    [route, visibleTrees],
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    let attempt = 0;

    const refreshSavedSelections = () => {
      listSavedSelections()
        .then((items) => {
          if (cancelled) {
            return;
          }
          setSavedSelections(items);
          setSelectionApiAvailable(true);
        })
        .catch(() => {
          if (!cancelled) {
            setSelectionApiAvailable(false);
          }
        });
    };

    const pollApi = async () => {
      const healthy = await checkApiHealth();
      if (cancelled) {
        return;
      }

      if (healthy) {
        setSelectionApiConnecting(false);
        setSelectionApiAvailable(true);
        refreshSavedSelections();
        return;
      }

      setSelectionApiAvailable(false);
      setSelectionApiConnecting(true);
      attempt += 1;
      if (attempt <= 30) {
        retryTimer = window.setTimeout(
          () => {
            void pollApi();
          },
          Math.min(1000 * attempt, 4000),
        );
      } else {
        setSelectionApiConnecting(false);
      }
    };

    void pollApi();

    const onFocus = () => {
      if (cancelled) {
        return;
      }
      attempt = 0;
      void pollApi();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (
      routeStartTreeId !== null &&
      !visibleTreeIds.includes(routeStartTreeId)
    ) {
      setRouteStartTreeId(null);
      setRoute(null);
      setRouteActive(false);
      setRouteStartPickMode(false);
      return;
    }

    if (!routeActive || routeStartTreeId === null) {
      return;
    }

    if (visibleTrees.length < 2) {
      setRoute(null);
      return;
    }

    setRoute(
      computeSurveyRoute(visibleTrees, {
        startMode: "click",
        startTreeId: routeStartTreeId,
      }),
    );
  }, [visibleTrees, visibleTreeIds, routeActive, routeStartTreeId]);

  useEffect(() => {
    if (!selection) {
      return;
    }

    const validIds = new Set(mapTrees.map((tree) => tree.properties.id));
    const pruned = [...selection.manualExcluded].filter((id) => validIds.has(id));

    if (pruned.length !== selection.manualExcluded.size) {
      setSelection((current) =>
        current ? { ...current, manualExcluded: new Set(pruned) } : current,
      );
    }
  }, [mapTrees, manualExcludedIds, selection]);

  useEffect(() => {
    if (
      selectedTree &&
      !trees.some((tree) => tree.properties.id === selectedTree.properties.id)
    ) {
      setSelectedTree(null);
    }
  }, [trees, selectedTree]);

  const handleSelectTree = (tree: TreeFeature) => {
    setSelectedTree(tree);
  };

  const handleSearchTreeId = (id: number) => {
    const tree = trees.find((item) => item.properties.id === id);
    if (!tree) {
      return false;
    }
    setSelectedTree(tree);
    return true;
  };

  const handleAnalysisSelectTree = (treeId: number | null) => {
    if (treeId === null) {
      setSelectedTree(null);
      return;
    }

    const tree = trees.find((item) => item.properties.id === treeId);
    if (tree) {
      setSelectedTree(tree);
    }
  };

  const handleHoverTree = (treeId: number | null) => {
    setHighlightedTreeId(treeId);
  };

  const handleToggleTree = (tree: TreeFeature) => {
    setSelection((current) =>
      current ? toggleManualExcluded(current, tree.properties.id) : current,
    );
    setSelectedTree(tree);
  };

  const handleCloseSidebar = () => {
    setSelectedTree(null);
  };

  const handleClearSelection = () => {
    setSelectedTree(null);
  };

  const handleSaveSelection = async (name: string) => {
    if (!selection || selectionBusy) {
      return;
    }

    setSelectionBusy(true);
    try {
      const saved = await saveSelection({
        name,
        attribute_filters: selection.attributeFilters,
        region_polygon: selection.regionPolygon,
      });
      setSavedSelections((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSelectionApiAvailable(true);
      setSelectionApiConnecting(false);
    } catch {
      // Keep save UI quiet on failure; button state reflects API availability.
    } finally {
      setSelectionBusy(false);
    }
  };

  const handleLoadSelection = async (id: number) => {
    if (!id || !bounds || selectionBusy) {
      return;
    }

    setSelectionBusy(true);
    try {
      const saved = await getSavedSelection(id);
      setSelection((current) =>
        current
          ? {
              ...current,
              attributeFilters: clampFiltersToBounds(saved.attribute_filters, bounds),
              regionPolygon: saved.region_polygon,
              manualExcluded: new Set(),
            }
          : current,
      );
      setSelectedTree(null);
    } catch {
      // Quiet on failure.
    } finally {
      setSelectionBusy(false);
    }
  };

  const handleDeleteSelection = async (id: number) => {
    const item = savedSelections.find((entry) => entry.id === id);
    if (!item || selectionBusy) {
      return;
    }

    if (!window.confirm(`Delete "${item.name}"?`)) {
      return;
    }

    setSelectionBusy(true);
    try {
      await deleteSavedSelection(id);
      setSavedSelections((current) => current.filter((entry) => entry.id !== id));
    } catch {
      // Quiet on failure.
    } finally {
      setSelectionBusy(false);
    }
  };

  const handlePickRouteStart = () => {
    setRouteStartPickMode((current) => !current);
  };

  const handleRouteStartPick = (tree: TreeFeature) => {
    setRouteStartTreeId(tree.properties.id);
    setRouteStartPickMode(false);
  };

  const handleGenerateRoute = () => {
    if (routeStartTreeId === null || visibleTrees.length < 2) {
      return;
    }

    setRoute(
      computeSurveyRoute(visibleTrees, {
        startMode: "click",
        startTreeId: routeStartTreeId,
      }),
    );
    setRouteActive(true);
  };

  const handleClearRoute = () => {
    setRoute(null);
    setRouteActive(false);
    setRouteStartPickMode(false);
    setRouteStartTreeId(null);
  };

  const handleCloseRoutePanel = () => {
    setRouteStartPickMode(false);
    setRouteStartTreeId(null);
  };

  const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN?.trim();

  const selectedSexPrediction = useMemo(() => {
    if (!selectedTree || !analysis) {
      return null;
    }

    const point = analysis.pca.points.find(
      (item) => item.id === selectedTree.properties.id,
    );
    if (
      !point ||
      point.sex_known ||
      point.probability_female === null ||
      point.probability_female === undefined
    ) {
      return null;
    }

    const probabilityFemale = point.probability_female;
    return {
      probabilityFemale,
      predictedSex: (probabilityFemale >= 0.5 ? "F" : "M") as "F" | "M",
      uncertain: isUncertainPrediction(probabilityFemale),
    };
  }, [analysis, selectedTree]);

  const analysisPopupOpen = analysisOpen && !analysisExpanded;
  const showAnalysisPage =
    analysisOpen && (analysisExpanded || analysisPageExiting);

  /** One overlay panel at a time: opening any panel closes the other three. */
  const closeOtherPanels = (
    except: "route" | "filters" | "layers" | "analysis",
  ) => {
    if (except !== "route") {
      setRouteCloseSignal((signal) => signal + 1);
    }
    if (except !== "filters") {
      setFilterCloseSignal((signal) => signal + 1);
    }
    if (except !== "layers") {
      setLayersPanelOpen(false);
    }
    if (except !== "analysis") {
      setAnalysisOpen(false);
      setAnalysisExpanded(false);
    }
  };

  useLayoutEffect(() => {
    if (loading || error || !mapboxToken) {
      return;
    }
    const main = appMainRef.current;
    if (!main) return;

    const FULL = {
      height: 2.55,
      font: 0.88,
      padX: 0.85,
      fabFont: 1.05,
      filterMin: 5.9,
      railWidth: 7.5,
    };
    const MIN_SCALE = 0.72;
    const GAP_PX = 10;

    const applyScale = (scale: number) => {
      const s = Math.max(MIN_SCALE, Math.min(1, scale));
      main.style.setProperty(
        "--map-control-btn-height",
        `${(FULL.height * s).toFixed(3)}rem`,
      );
      main.style.setProperty(
        "--map-control-btn-font",
        `${(FULL.font * s).toFixed(3)}rem`,
      );
      main.style.setProperty(
        "--map-control-btn-pad-x",
        `${(FULL.padX * s).toFixed(3)}rem`,
      );
      main.style.setProperty(
        "--map-control-fab-font",
        `${(FULL.fabFont * s).toFixed(3)}rem`,
      );
      main.style.setProperty(
        "--map-control-filter-min-width",
        `${(FULL.filterMin * s).toFixed(3)}rem`,
      );
      main.style.setProperty(
        "--map-tool-rail-width",
        `${(FULL.railWidth * s).toFixed(3)}rem`,
      );
    };

    const fitControls = () => {
      const left = main.querySelector(
        ".map-tool-rail--left",
      ) as HTMLElement | null;
      const right = main.querySelector(
        ".map-top-controls",
      ) as HTMLElement | null;
      const rightRail = main.querySelector(
        ".map-tool-rail--right",
      ) as HTMLElement | null;
      if (!left && !right) {
        applyScale(1);
        return;
      }

      const styles = getComputedStyle(main);
      const insetRaw = styles.getPropertyValue("--controls-inset").trim();
      const rootFont =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const insetPx = insetRaw.endsWith("rem")
        ? (parseFloat(insetRaw) || 1.5) * rootFont
        : parseFloat(insetRaw) || 24;
      const available = main.clientWidth - 2 * insetPx;

      let scale = 1;
      for (let i = 0; i < 6; i++) {
        applyScale(scale);
        const leftWidth = left?.getBoundingClientRect().width ?? 0;
        const rightWidth = right?.getBoundingClientRect().width ?? 0;
        const needed = leftWidth + rightWidth + GAP_PX;
        if (needed <= available || needed <= 0) break;
        scale = Math.max(MIN_SCALE, scale * (available / needed));
      }

      // Match sex legend edges to the right tool rail’s real width (min-width token can undershoot).
      if (rightRail) {
        const railWidth = rightRail.getBoundingClientRect().width;
        if (railWidth > 0) {
          main.style.setProperty(
            "--map-tool-rail-actual-width",
            `${railWidth.toFixed(2)}px`,
          );
        }
      }
    };

    fitControls();
    const observer = new ResizeObserver(() => fitControls());
    observer.observe(main);
    window.addEventListener("resize", fitControls);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fitControls);
    };
  }, [loading, error, mapboxToken, selection, analysis, showAnalysisPage, filterExpanded, helpOpen, layersPanelOpen]);

  if (!mapboxToken) {
    return (
      <div className="app-shell app-shell--centered">
        <div className="setup-card">
          <h1>Spicebush Field Map</h1>
          <p>
            Add your Mapbox access token to <code>frontend/.env</code>, then
            restart the dev server (<code>npm run dev</code>):
          </p>
          <pre>VITE_MAPBOX_TOKEN=pk.your_token_here</pre>
          <p>
            Get a free token at{" "}
            <a href="https://account.mapbox.com/" target="_blank" rel="noreferrer">
              mapbox.com
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return null;
  }

  if (error) {
    return (
      <div className="app-shell app-shell--centered">
        <p className="error-text">{error}</p>
      </div>
    );
  }

  const selectedIsExcluded =
    selectedTree !== null &&
    selection?.manualExcluded.has(selectedTree.properties.id) === true;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header__title">
          <h1>
            Spicebush{" "}
            <span className="app-header__scientific">
              (<em>Lindera benzoin</em>)
            </span>
          </h1>
          <p className="subtitle">
            <span className="app-header__park">East Rock Park · </span>
            <span className="app-header__location">New Haven, CT</span>
          </p>
        </div>
        <div className="app-header__meta">
          <span className="app-header__stat">
            {visibleTrees.length === trees.length
              ? `${trees.length} plants`
              : `${visibleTrees.length} of ${trees.length} plants`}
          </span>
          <span
            className={`app-header__stat app-header__stat--status app-header__stat--${
              selectionApiConnecting
                ? "connecting"
                : selectionApiAvailable
                  ? "live"
                  : "offline"
            }`}
          >
            <span className="app-header__status-dot" aria-hidden="true" />
            {selectionApiConnecting
              ? "Connecting"
              : selectionApiAvailable
                ? "Live"
                : "Offline"}
          </span>
        </div>
      </header>

      <main
        ref={appMainRef}
        className={[
          "app-main",
          analysisPopupOpen || routeExpanded || filterExpanded || layersPanelOpen
            ? "app-main--panel-open"
            : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SpicebushMap
          trees={treesForMap}
          basemap={basemap}
          densityHeatmap={densityHeatmap}
          showTreePoints={showTreePoints}
          colorBySex={colorBySex}
          mapboxToken={mapboxToken}
          regionPolygon={selection?.regionPolygon ?? null}
          manualExcludedIds={manualExcludedIds}
          selectedTreeId={selectedTree?.properties.id ?? null}
          highlightedTreeId={highlightedTreeId}
          route={route}
          routeLine={routeGeoJSON.line}
          routeStops={routeGeoJSON.stops}
          routeStartTreeId={routeStartTreeId}
          routeStartPickMode={routeStartPickMode}
          flyToOnSelect
          onSelectTree={handleSelectTree}
          onHoverTree={handleHoverTree}
          onToggleTree={handleToggleTree}
          onClearTree={handleClearSelection}
          onRegionChange={(regionPolygon) =>
            setSelection((current) =>
              current ? { ...current, regionPolygon } : current,
            )
          }
          onRouteStartPick={handleRouteStartPick}
        />
        <div
          className={`map-top-controls${layersPanelOpen ? " map-top-controls--layers-open" : ""}`}
        >
          <div
            className="map-tool-rail map-tool-rail--right"
            role="toolbar"
            aria-label="Map tools"
          >
            <MapLayersControl
              basemap={basemap}
              densityHeatmap={densityHeatmap}
              showTreePoints={showTreePoints}
              colorBySex={colorBySex}
              open={layersPanelOpen}
              onOpenChange={(next) => {
                setLayersPanelOpen(next);
                if (next) {
                  closeOtherPanels("layers");
                }
              }}
              onBasemapChange={setBasemap}
              onDensityChange={setDensityHeatmap}
              onShowTreePointsChange={setShowTreePoints}
              onColorBySexChange={setColorBySex}
            />
            {selection && bounds && (
              <FilterPanel
                attributeFilters={selection.attributeFilters}
                bounds={bounds}
                visibleCount={visibleTrees.length}
                totalCount={trees.length}
                activeFilterCount={activeSelectionCount}
                hasRegion={selection.regionPolygon !== null}
                manualExcludedCount={selection.manualExcluded.size}
                savedSelections={savedSelections}
                selectionApiAvailable={selectionApiAvailable}
                selectionApiConnecting={selectionApiConnecting}
                selectionBusy={selectionBusy}
                onAttributeFiltersChange={(attributeFilters) =>
                  setSelection((current) =>
                    current ? { ...current, attributeFilters } : current,
                  )
                }
                onResetAttributes={() =>
                  setSelection((current) =>
                    current
                      ? { ...current, attributeFilters: createDefaultFilters(bounds) }
                      : current,
                  )
                }
                onClearRegion={() =>
                  setSelection((current) =>
                    current ? { ...current, regionPolygon: null } : current,
                  )
                }
                onClearManualExcluded={() =>
                  setSelection((current) =>
                    current ? clearManualExcluded(current) : current,
                  )
                }
                onSaveSelection={handleSaveSelection}
                onLoadSelection={handleLoadSelection}
                onDeleteSelection={handleDeleteSelection}
                onSearchTreeId={handleSearchTreeId}
                closeSignal={filterCloseSignal}
                onExpandedChange={(expanded) => {
                  if (expanded && !filterExpanded) {
                    closeOtherPanels("filters");
                  }
                  setFilterExpanded(expanded);
                }}
              />
            )}
            {selection && bounds && (
              <RoutePanel
                visibleCount={visibleTrees.length}
                route={route}
                routeStartTreeId={routeStartTreeId}
                routeStartPickMode={routeStartPickMode}
                onPickRouteStart={handlePickRouteStart}
                onGenerateRoute={handleGenerateRoute}
                onClearRoute={handleClearRoute}
                onClose={handleCloseRoutePanel}
                closeSignal={routeCloseSignal}
                onExpandedChange={(expanded) => {
                  if (expanded && !routeExpanded) {
                    closeOtherPanels("route");
                  }
                  setRouteExpanded(expanded);
                }}
              />
            )}
            {analysis && (
              <AnalysisPanelTab
                open={analysisOpen && !analysisExpanded}
                onToggle={() => {
                  if (analysisOpen && !analysisExpanded) {
                    setAnalysisOpen(false);
                    setAnalysisExpanded(false);
                    return;
                  }
                  closeOtherPanels("analysis");
                  setAnalysisExpanded(false);
                  setAnalysisOpen(true);
                }}
              />
            )}
            <DataPanel apiConnecting={selectionApiConnecting} />
            <HelpPanel
              open={helpOpen}
              individualCount={trees.length}
              onOpen={() => setHelpOpen(true)}
              onClose={() => setHelpOpen(false)}
            />
          </div>
          {analysis && analysisOpen && (
            <AnalysisPanel
              analysis={analysis}
              expanded={false}
              dormant={analysisExpanded}
              trees={trees}
              highlightedTreeId={highlightedTreeId}
              selectedTreeId={selectedTree?.properties.id ?? null}
              visibleTreeIds={visibleTreeIds}
              onHoverTree={handleHoverTree}
              onSelectTree={handleAnalysisSelectTree}
              onExpand={() => setAnalysisExpanded(true)}
              onMinimize={() => setAnalysisExpanded(false)}
              onClose={() => {
                setAnalysisOpen(false);
                setAnalysisExpanded(false);
                setAnalysisPageExiting(false);
              }}
            />
          )}
          {analysisError && !analysis && (
            <p className="analysis-panel__error">{analysisError}</p>
          )}
        </div>
        {selectedTree && !showAnalysisPage && (
          <TreeSidebar
            tree={selectedTree}
            manuallyExcluded={selectedIsExcluded}
            sexPrediction={selectedSexPrediction}
            onClose={handleCloseSidebar}
          />
        )}
      </main>
      {analysis && showAnalysisPage && (
        <AnalysisPanel
          analysis={analysis}
          expanded
          trees={trees}
          highlightedTreeId={highlightedTreeId}
          selectedTreeId={selectedTree?.properties.id ?? null}
          onHoverTree={handleHoverTree}
          onSelectTree={handleAnalysisSelectTree}
          onExpand={() => setAnalysisExpanded(true)}
          onMinimize={() => {
            setAnalysisExpanded(false);
            setAnalysisPageExiting(true);
          }}
          onMinimized={() => setAnalysisPageExiting(false)}
          onClose={() => {
            setAnalysisOpen(false);
            setAnalysisExpanded(false);
            setAnalysisPageExiting(false);
          }}
        />
      )}
    </div>
  );
}

export default App;

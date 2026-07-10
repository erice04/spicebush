import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SpicebushMap from "./components/SpicebushMap";
import TreeSidebar from "./components/TreeSidebar";
import FilterPanel from "./components/FilterPanel";
import DataPanel from "./components/DataPanel";
import RoutePanel from "./components/RoutePanel";
import AnalysisPanel, { AnalysisPanelTab } from "./components/AnalysisPanel";
import HelpPanel from "./components/HelpPanel";
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
  const [basemap, setBasemap] = useState<BasemapStyle>("terrain");
  const [densityHeatmap, setDensityHeatmap] = useState(false);
  const [showTreePoints, setShowTreePoints] = useState(true);
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
  const [analysisPopupClosing, setAnalysisPopupClosing] = useState(false);
  const [analysisPopupHeight, setAnalysisPopupHeight] = useState(0);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [routeExpanded, setRouteExpanded] = useState(false);
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [highlightedTreeId, setHighlightedTreeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const appMainRef = useRef<HTMLElement>(null);
  const appHeaderRef = useRef<HTMLElement>(null);

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
  /** Layout signal for ID card: drop as soon as popup close animation starts. */
  const analysisLayoutActive = analysisPopupOpen && !analysisPopupClosing;
  const toolboxOverlayOpen = analysisLayoutActive || routeExpanded;
  const showAnalysisPage =
    analysisOpen && (analysisExpanded || analysisPageExiting);

  useLayoutEffect(() => {
    if (loading || error || !mapboxToken) {
      return;
    }
    const header = appHeaderRef.current;
    if (!header) {
      return;
    }

    const FULL = {
      font: 0.85,
      padY: 0.45,
      padX: 0.9,
      gap: 1.35,
      checkFont: 0.7,
      checkSize: 0.7,
      radius: 8,
      pad: 3,
    };
    const MIN_SCALE = 0.62;
    const MIN_GAP_PX = 12;

    const applyScale = (scale: number) => {
      const s = Math.max(MIN_SCALE, Math.min(1, scale));
      header.style.setProperty(
        "--header-toggle-font",
        `${(FULL.font * s).toFixed(3)}rem`,
      );
      header.style.setProperty(
        "--header-toggle-pad-y",
        `${(FULL.padY * s).toFixed(3)}rem`,
      );
      header.style.setProperty(
        "--header-toggle-pad-x",
        `${(FULL.padX * s).toFixed(3)}rem`,
      );
      header.style.setProperty(
        "--header-toggle-gap",
        `${(FULL.gap * s).toFixed(3)}rem`,
      );
      header.style.setProperty(
        "--header-toggle-radius",
        `${(FULL.radius * s).toFixed(2)}px`,
      );
      header.style.setProperty(
        "--header-toggle-pad",
        `${Math.max(2, FULL.pad * s).toFixed(2)}px`,
      );
      header.style.setProperty(
        "--density-check-font",
        `${(FULL.checkFont * s).toFixed(3)}rem`,
      );
      header.style.setProperty(
        "--density-check-size",
        `${(FULL.checkSize * s).toFixed(3)}rem`,
      );
    };

    const fitHeaderToggles = () => {
      let scale = 1;
      for (let i = 0; i < 8; i++) {
        applyScale(scale);
        const title = header.querySelector(
          ".app-header__title",
        ) as HTMLElement | null;
        const toggles = header.querySelector(
          ".app-header__toggles",
        ) as HTMLElement | null;
        if (!title || !toggles) {
          break;
        }
        const titleRight = title.getBoundingClientRect().right;
        const togglesLeft = toggles.getBoundingClientRect().left;
        const gap = togglesLeft - titleRight;
        if (gap >= MIN_GAP_PX) {
          break;
        }
        const togglesWidth = toggles.getBoundingClientRect().width;
        if (togglesWidth <= 0) {
          break;
        }
        const overflow = MIN_GAP_PX - gap;
        scale = Math.max(MIN_SCALE, scale * ((togglesWidth - overflow) / togglesWidth));
      }
    };

    fitHeaderToggles();
    const observer = new ResizeObserver(() => fitHeaderToggles());
    observer.observe(header);
    window.addEventListener("resize", fitHeaderToggles);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fitHeaderToggles);
    };
  }, [loading, error, mapboxToken, densityHeatmap]);

  useLayoutEffect(() => {
    if (loading || error || !mapboxToken) {
      return;
    }
    const main = appMainRef.current;
    if (!main) return;

    const FULL = {
      height: 2.7,
      font: 0.95,
      padX: 1.05,
      fabFont: 1.15,
      filterMin: 5.9,
    };
    const MIN_SCALE = 0.68;
    const GAP_PX = 8;

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
    };

    const fitControls = () => {
      const left = main.querySelector(
        ".map-top-left-controls__tabs",
      ) as HTMLElement | null;
      const right = main.querySelector(".map-top-controls") as HTMLElement | null;
      if (!left || !right) {
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
        const rightPills = Array.from(
          right.querySelectorAll(".help-panel__fab, .filter-panel__tab"),
        ) as HTMLElement[];
        const leftWidth = left.getBoundingClientRect().width;
        const rightWidth =
          rightPills.length > 0
            ? rightPills.reduce(
                (sum, el) => sum + el.getBoundingClientRect().width,
                0,
              ) +
              Math.max(0, rightPills.length - 1) * GAP_PX
            : 0;
        const needed = leftWidth + rightWidth + GAP_PX;
        if (needed <= available || needed <= 0) break;
        scale = Math.max(MIN_SCALE, scale * (available / needed));
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
  }, [loading, error, mapboxToken, selection, analysis, showAnalysisPage, filterExpanded, helpOpen]);

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
      <header className="app-header" ref={appHeaderRef}>
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
        <div className="app-header__toggles">
          <div className="density-controls" role="group" aria-label="Plant density">
            <div className="basemap-toggle">
              <button
                type="button"
                className={densityHeatmap ? "active" : ""}
                onClick={() => {
                  setDensityHeatmap((current) => {
                    if (current) {
                      setShowTreePoints(true);
                    }
                    return !current;
                  });
                }}
                aria-pressed={densityHeatmap}
              >
                Density
              </button>
            </div>
            {densityHeatmap && (
              <label className="density-points-check">
                <input
                  type="checkbox"
                  checked={showTreePoints}
                  onChange={() => setShowTreePoints((current) => !current)}
                />
                Points
              </label>
            )}
          </div>
          <div className="basemap-toggle" role="group" aria-label="Basemap style">
            <button
              type="button"
              className={basemap === "terrain" ? "active" : ""}
              onClick={() => setBasemap("terrain")}
            >
              Default
            </button>
            <button
              type="button"
              className={basemap === "satellite" ? "active" : ""}
              onClick={() => setBasemap("satellite")}
            >
              Satellite
            </button>
          </div>
        </div>
      </header>

      <main
        ref={appMainRef}
        className={[
          "app-main",
          analysisPopupOpen ? "app-main--analysis-popup-open" : "",
          analysisPopupOpen || routeExpanded ? "app-main--toolbox-open" : "",
          filterExpanded ? "app-main--filter-open" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <SpicebushMap
          trees={treesForMap}
          basemap={basemap}
          densityHeatmap={densityHeatmap}
          showTreePoints={showTreePoints}
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
          analysisPopupHeight={analysisPopupOpen ? analysisPopupHeight + 44 : 0}
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
        <div className="map-top-left-controls">
          <div className="map-top-left-controls__tabs">
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
                suppress={analysisPopupOpen}
                onExpandedChange={(expanded) => {
                  setRouteExpanded(expanded);
                  if (expanded) {
                    setAnalysisOpen(false);
                    setAnalysisExpanded(false);
                    setAnalysisPopupClosing(false);
                  }
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
                    setAnalysisPopupClosing(false);
                    return;
                  }
                  setAnalysisExpanded(false);
                  setAnalysisPopupClosing(false);
                  setAnalysisOpen(true);
                }}
              />
            )}
            <DataPanel apiConnecting={selectionApiConnecting} />
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
              onCloseBegin={() => setAnalysisPopupClosing(true)}
              onClose={() => {
                setAnalysisOpen(false);
                setAnalysisExpanded(false);
                setAnalysisPageExiting(false);
                setAnalysisPopupClosing(false);
              }}
              onPopupHeightChange={setAnalysisPopupHeight}
            />
          )}
          {analysisError && !analysis && (
            <p className="analysis-panel__error">{analysisError}</p>
          )}
        </div>
        <div className="map-top-controls">
          <div className="map-top-controls__help">
            <HelpPanel
              open={helpOpen}
              showFab={!showAnalysisPage}
              individualCount={trees.length}
              onOpen={() => setHelpOpen(true)}
              onClose={() => setHelpOpen(false)}
            />
          </div>
          {selection && bounds && !showAnalysisPage && (
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
              onExpandedChange={setFilterExpanded}
            />
          )}
        </div>
        {selectedTree && !showAnalysisPage && (
          <TreeSidebar
            tree={selectedTree}
            manuallyExcluded={selectedIsExcluded}
            compact={toolboxOverlayOpen}
            analysisLayout={analysisLayoutActive}
            reflowKey={toolboxOverlayOpen ? analysisPopupHeight + (routeExpanded ? 1 : 0) : 0}
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
            setAnalysisPopupClosing(false);
          }}
        />
      )}
    </div>
  );
}

export default App;

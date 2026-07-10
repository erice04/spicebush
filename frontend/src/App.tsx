import { useEffect, useMemo, useRef, useState } from "react";
import SpicebushMap from "./components/SpicebushMap";
import TreeSidebar from "./components/TreeSidebar";
import FilterPanel from "./components/FilterPanel";
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
import { getAnalysis } from "./api/analysis";
import type { AnalysisResponse } from "./types/analysis";
import {
  clampFiltersToBounds,
  computeDataBounds,
  countActiveFilters,
  createDefaultFilters,
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
import "./App.css";

function App() {
  const [trees, setTrees] = useState<TreeFeature[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeFeature | null>(null);
  const [basemap, setBasemap] = useState<BasemapStyle>("terrain");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const hasOpenedHelp = useRef(false);
  const [savedSelections, setSavedSelections] = useState<SavedSelectionSummary[]>([]);
  const [selectionApiAvailable, setSelectionApiAvailable] = useState(true);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [route, setRoute] = useState<ComputedRoute | null>(null);
  const [routeActive, setRouteActive] = useState(false);
  const [routeStartTreeId, setRouteStartTreeId] = useState<number | null>(null);
  const [routeStartPickMode, setRouteStartPickMode] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [highlightedTreeId, setHighlightedTreeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const bounds = useMemo(
    () => (trees.length > 0 ? computeDataBounds(trees) : null),
    [trees],
  );

  const mapTrees = useMemo(() => {
    if (!selection || !bounds) {
      return trees;
    }
    return getMapTrees(trees, selection, bounds);
  }, [trees, selection, bounds]);

  const visibleTrees = useMemo(() => {
    if (!selection || !bounds) {
      return trees;
    }
    return getVisibleTrees(trees, selection, bounds);
  }, [trees, selection, bounds]);

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
    fetch("/data/spicebush.json")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to load spicebush data (${res.status})`);
        }
        return res.json() as Promise<TreeFeatureCollection>;
      })
      .then((data) => {
        setTrees(data.features);
        setSelection(
          createDefaultSelection(
            createDefaultFilters(computeDataBounds(data.features)),
          ),
        );
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    getAnalysis()
      .then((result) => {
        setAnalysis(result);
        setAnalysisError(null);
      })
      .catch(() => {
        setAnalysisError("Analysis data could not be loaded.");
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
    listSavedSelections()
      .then((items) => {
        setSavedSelections(items);
        setSelectionApiAvailable(true);
      })
      .catch(() => {
        setSelectionApiAvailable(false);
        setSelectionMessage(
          "Saved filters require the API server on port 8000.",
        );
      });
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
      !mapTrees.some((tree) => tree.properties.id === selectedTree.properties.id)
    ) {
      setSelectedTree(null);
    }
  }, [mapTrees, selectedTree]);

  const handleSelectTree = (tree: TreeFeature) => {
    setSelectedTree(tree);
  };

  const handleAnalysisSelectTree = (treeId: number) => {
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
    if (!selection) {
      return;
    }

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
      setSelectionMessage(`Saved "${saved.name}"`);
    } catch (err) {
      setSelectionMessage(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleLoadSelection = async (id: number) => {
    if (!id || !bounds) {
      return;
    }

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
      setSelectionMessage(`Loaded "${saved.name}"`);
    } catch (err) {
      setSelectionMessage(err instanceof Error ? err.message : "Load failed");
    }
  };

  const handleDeleteSelection = async (id: number) => {
    const item = savedSelections.find((entry) => entry.id === id);
    if (!item) {
      return;
    }

    if (!window.confirm(`Delete "${item.name}"?`)) {
      return;
    }

    try {
      await deleteSavedSelection(id);
      setSavedSelections((current) => current.filter((entry) => entry.id !== id));
      setSelectionMessage(`Deleted "${item.name}"`);
    } catch (err) {
      setSelectionMessage(err instanceof Error ? err.message : "Delete failed");
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
    return (
      <div className="app-shell app-shell--centered">
        <p>Loading 74 spicebush individuals…</p>
      </div>
    );
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
      </header>

      <main className="app-main">
        <SpicebushMap
          trees={mapTrees}
          basemap={basemap}
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
          {analysis && (
            analysisOpen ? (
              <AnalysisPanel
                analysis={analysis}
                highlightedTreeId={highlightedTreeId}
                selectedTreeId={selectedTree?.properties.id ?? null}
                onHoverTree={handleHoverTree}
                onSelectTree={handleAnalysisSelectTree}
                onClose={() => setAnalysisOpen(false)}
              />
            ) : (
              <AnalysisPanelTab
                open={false}
                onToggle={() => setAnalysisOpen(true)}
              />
            )
          )}
          {analysisError && !analysis && (
            <p className="analysis-panel__error">{analysisError}</p>
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
            />
          )}
        </div>
        <div className="map-top-controls">
          <HelpPanel
            open={helpOpen}
            showFab={!selectedTree}
            onOpen={() => setHelpOpen(true)}
            onClose={() => setHelpOpen(false)}
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
              selectionMessage={selectionMessage}
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
            />
          )}
        </div>
        {selectedTree && (
          <TreeSidebar
            tree={selectedTree}
            manuallyExcluded={selectedIsExcluded}
            onClose={handleCloseSidebar}
          />
        )}
      </main>
    </div>
  );
}

export default App;

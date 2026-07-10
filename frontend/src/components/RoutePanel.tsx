import { useState } from "react";
import { formatRouteSummary, type ComputedRoute } from "../utils/route";
import "./RoutePanel.css";

interface RoutePanelProps {
  visibleCount: number;
  route: ComputedRoute | null;
  routeStartTreeId: number | null;
  routeStartPickMode: boolean;
  onPickRouteStart: () => void;
  onGenerateRoute: () => void;
  onClearRoute: () => void;
  onClose: () => void;
}

export default function RoutePanel({
  visibleCount,
  route,
  routeStartTreeId,
  routeStartPickMode,
  onPickRouteStart,
  onGenerateRoute,
  onClearRoute,
  onClose,
}: RoutePanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        className="route-panel__tab"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-label="Show route"
      >
        Route
        {route ? " ✓" : ""}
      </button>
    );
  }

  return (
    <aside className="route-panel">
      <div className="route-panel__header">
        <h2>Route</h2>
        <button
          type="button"
          className="route-panel__collapse"
          onClick={() => {
            onClose();
            setExpanded(false);
          }}
          aria-label="Hide route"
        >
          ×
        </button>
      </div>

      <p className="route-panel__help">
        Uses the {visibleCount} currently visible individuals.
      </p>
      <button
        type="button"
        className={`route-panel__pick${routeStartPickMode ? " route-panel__pick--active" : ""}`}
        disabled={visibleCount < 1}
        onClick={onPickRouteStart}
      >
        {routeStartPickMode ? "Click a point…" : "Set start"}
      </button>
      {routeStartTreeId !== null && (
        <p className="route-panel__start">Start: ID #{routeStartTreeId}</p>
      )}
      <div className="route-panel__actions">
        <button
          type="button"
          className="route-panel__primary"
          disabled={visibleCount < 2 || routeStartTreeId === null}
          onClick={onGenerateRoute}
        >
          Generate
        </button>
        <button
          type="button"
          className="route-panel__secondary"
          disabled={!route}
          onClick={onClearRoute}
        >
          Clear
        </button>
      </div>
      {formatRouteSummary(route) && (
        <p className="route-panel__summary">{formatRouteSummary(route)}</p>
      )}
    </aside>
  );
}

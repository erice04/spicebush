import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatRouteSummary, type ComputedRoute } from "../utils/route";
import { useAnimatedOpen } from "../hooks/useCloseAnimation";
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
  suppress?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
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
  suppress = false,
  onExpandedChange,
}: RoutePanelProps) {
  const { open: expanded, closing, requestOpen, requestClose } =
    useAnimatedOpen();
  const wasExpandedRef = useRef(false);
  const tabRef = useRef<HTMLButtonElement>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);

  useLayoutEffect(() => {
    setOverlayHost(
      tabRef.current?.closest(".map-top-left-controls") ?? null,
    );
  }, []);

  useEffect(() => {
    if (suppress && expanded) {
      requestClose();
    }
  }, [suppress, expanded, requestClose]);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    return () => onExpandedChange?.(false);
  }, [onExpandedChange]);

  useEffect(() => {
    if (wasExpandedRef.current && !expanded) {
      onClose();
    }
    wasExpandedRef.current = expanded;
  }, [expanded, onClose]);

  const panel =
    expanded && overlayHost
      ? createPortal(
          <aside
            className={`route-panel route-panel--overlay${
              closing ? " route-panel--closing" : ""
            }`}
          >
            <div className="route-panel__header">
              <h2>Route</h2>
              <button
                type="button"
                className="route-panel__collapse"
                onClick={requestClose}
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
          </aside>,
          overlayHost,
        )
      : null;

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={`route-panel__tab${expanded ? " route-panel__tab--active" : ""}`}
        onClick={expanded ? requestClose : requestOpen}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide route" : "Show route"}
      >
        Route
        {route ? " ✓" : ""}
      </button>
      {panel}
    </>
  );
}

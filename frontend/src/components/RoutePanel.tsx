import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatRouteSummary, type ComputedRoute } from "../utils/route";
import { useAnimatedOpen } from "../hooks/useCloseAnimation";
import { IconRoute } from "./railIcons";
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
  /** Increment to request this panel close (another panel opened). */
  closeSignal?: number;
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
  closeSignal = 0,
  onExpandedChange,
}: RoutePanelProps) {
  const { open: expanded, closing, requestOpen, requestClose } =
    useAnimatedOpen(220);
  const wasExpandedRef = useRef(false);
  const tabRef = useRef<HTMLButtonElement>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);
  const prevCloseSignal = useRef(closeSignal);

  useLayoutEffect(() => {
    setOverlayHost(tabRef.current?.closest(".map-top-controls") ?? null);
  }, []);

  useEffect(() => {
    if (prevCloseSignal.current === closeSignal) {
      return;
    }
    prevCloseSignal.current = closeSignal;
    if (expanded) {
      requestClose();
    }
  }, [closeSignal, expanded, requestClose]);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (routeStartPickMode) {
          onPickRouteStart();
        } else {
          requestClose();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, routeStartPickMode, onPickRouteStart, requestClose]);

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
            className={`route-panel route-panel--overlay sb-dock-panel${
              closing ? " route-panel--closing" : ""
            }`}
          >
            <div className="route-panel__header sb-dock-panel__header">
              <div className="sb-dock-panel__title-row">
                <IconRoute />
                <h2 className="sb-dock-panel__title">Route</h2>
              </div>
              <button
                type="button"
                className="route-panel__collapse sb-dock-panel__close"
                onClick={requestClose}
                aria-label="Hide route"
              >
                ×
              </button>
            </div>

            <div className="route-panel__body sb-dock-panel__body">
            <p className="route-panel__help">
              Plans a walking route through the {visibleCount} plants currently
              visible on the map.
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
                Generate route
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
            </div>
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
        <IconRoute />
        <span>
          Route
          {route ? " ✓" : ""}
        </span>
      </button>
      {panel}
    </>
  );
}

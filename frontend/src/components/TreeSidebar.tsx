import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TreeFeature, TreeMeasurement } from "../types";
import { formatSex, formatStemCount } from "../utils/labels";
import { useCloseAnimation } from "../hooks/useCloseAnimation";
import "./TreeSidebar.css";

interface SexPredictionInfo {
  probabilityFemale: number;
  predictedSex: "F" | "M";
  uncertain: boolean;
}

interface TreeSidebarProps {
  tree: TreeFeature;
  manuallyExcluded?: boolean;
  compact?: boolean;
  /** Analysis-popup layout: # stems label, no uncertain, below-analysis placement. */
  analysisLayout?: boolean;
  reflowKey?: number;
  sexPrediction?: SexPredictionInfo | null;
  onClose: () => void;
}

interface LayoutMode {
  compact: boolean;
  analysisLayout: boolean;
}

const MIN_FIT_SCALE = 0.6;
const SIDEBAR_UI_REF_WIDTH = 320;
const RISE_OUT_MS = 180;
const RISE_IN_MS = 200;
const FADE_MS = 180;

function layoutKey(mode: LayoutMode): string {
  return `${mode.compact ? "c" : "d"}-${mode.analysisLayout ? "a" : "n"}`;
}

function formatMeasurement(
  value: number | null,
  unit: string,
  digits = 1,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)} ${unit}`;
}

function formatGrowthRate(
  value: number | null | undefined,
  unitPerMonth: string,
): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  const digits = Math.abs(value) >= 10 ? 1 : 2;
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)} ${unitPerMonth}`;
}

function monthIndex(ym: string): number {
  const [year, month] = ym.split("-");
  return Number(year) * 12 + Number(month);
}

function monthsBetween(earlier: string, later: string): number {
  return monthIndex(later) - monthIndex(earlier);
}

function stemNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value.trim() === "") {
    return null;
  }
  const text = value.trim();
  if (text.toUpperCase() === "M") {
    return 3;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function ratePerMonth(
  earlier: number | null,
  later: number | null,
  months: number,
): number | null {
  if (months <= 0 || earlier === null || later === null) {
    return null;
  }
  return (later - earlier) / months;
}

/** Growth from the prior visit to the selected measurement. */
function growthFromPrevious(
  history: TreeMeasurement[],
  selectedYm: string | null,
): {
  dbh_cm_per_month: number | null;
  base_diameter_cm_per_month: number | null;
  stem_count_per_month: number | null;
  height_m_per_month: number | null;
} {
  const empty = {
    dbh_cm_per_month: null,
    base_diameter_cm_per_month: null,
    stem_count_per_month: null,
    height_m_per_month: null,
  };

  if (!selectedYm || history.length < 2) {
    return empty;
  }

  const selectedIndex = history.findIndex(
    (item) => item.observed_ym === selectedYm,
  );
  if (selectedIndex <= 0) {
    return empty;
  }

  const previous = history[selectedIndex - 1];
  const selected = history[selectedIndex];
  const months = monthsBetween(previous.observed_ym, selected.observed_ym);

  return {
    dbh_cm_per_month: ratePerMonth(previous.dbh_cm, selected.dbh_cm, months),
    base_diameter_cm_per_month: ratePerMonth(
      previous.base_diameter_cm,
      selected.base_diameter_cm,
      months,
    ),
    stem_count_per_month: ratePerMonth(
      stemNumeric(previous.stem_count),
      stemNumeric(selected.stem_count),
      months,
    ),
    height_m_per_month: ratePerMonth(
      previous.height_m,
      selected.height_m,
      months,
    ),
  };
}

function formatYmLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function measurementView(
  tree: TreeFeature,
  selectedYm: string | null,
): {
  stem_count: string;
  base_diameter_cm: number | null;
  dbh_cm: number | null;
  height_m: number | null;
  sex: string | null;
  notes: string | null;
  observed_ym: string | null;
} {
  const { properties } = tree;
  const history = properties.measurements ?? [];
  const match =
    selectedYm === null
      ? null
      : history.find((item) => item.observed_ym === selectedYm);

  if (match) {
    return {
      stem_count: match.stem_count,
      base_diameter_cm: match.base_diameter_cm,
      dbh_cm: match.dbh_cm,
      height_m: match.height_m,
      sex: match.sex,
      notes: match.notes,
      observed_ym: match.observed_ym,
    };
  }

  return {
    stem_count: properties.stem_count,
    base_diameter_cm: properties.base_diameter_cm,
    dbh_cm: properties.dbh_cm,
    height_m: properties.height_m,
    sex: properties.sex,
    notes: properties.notes,
    observed_ym: properties.observed_ym ?? null,
  };
}

function clearSidebarPosition(sidebar: HTMLElement) {
  sidebar.style.setProperty("--sidebar-ui-scale", "1");
  sidebar.style.setProperty("--sidebar-fit-scale", "1");
  sidebar.style.left = "";
  sidebar.style.right = "";
  sidebar.style.width = "";
  sidebar.style.maxWidth = "";
  sidebar.style.top = "";
}

function fitSidebarToLayout(
  sidebar: HTMLElement,
  main: Element,
  compact: boolean,
) {
  if (compact) {
    const leftControls = main.querySelector<HTMLElement>(
      ".map-top-left-controls",
    );
    const analysisPopup = main.querySelector<HTMLElement>(
      ".analysis-popup:not(.analysis-popup--dormant):not(.analysis-popup--closing)",
    );
    const routeOverlay = main.querySelector<HTMLElement>(
      ".route-panel--overlay",
    );
    const popup = analysisPopup ?? routeOverlay;
    const width =
      popup?.offsetWidth ??
      leftControls?.offsetWidth ??
      main.getBoundingClientRect().width;
    const uiScale = Math.min(1, Math.max(0.65, width / SIDEBAR_UI_REF_WIDTH));
    sidebar.style.setProperty("--sidebar-ui-scale", uiScale.toFixed(3));

    if (leftControls && analysisPopup) {
      const mainRect = main.getBoundingClientRect();
      const analysisRect = analysisPopup.getBoundingClientRect();
      const gap = 20;
      sidebar.style.left = `${Math.max(0, analysisRect.left - mainRect.left)}px`;
      sidebar.style.right = `${Math.max(
        0,
        mainRect.right - analysisRect.right,
      )}px`;
      sidebar.style.width = "auto";
      sidebar.style.maxWidth = "none";
      sidebar.style.top = `${Math.max(
        0,
        analysisRect.bottom - mainRect.top + gap,
      )}px`;
    } else if (leftControls && routeOverlay) {
      const mainRect = main.getBoundingClientRect();
      const overlayRect = routeOverlay.getBoundingClientRect();
      const gap = 8;
      sidebar.style.left = `${Math.max(
        0,
        overlayRect.right - mainRect.left + gap,
      )}px`;
      sidebar.style.right = "";
      sidebar.style.width = "";
      sidebar.style.maxWidth = "";
      sidebar.style.top = `${Math.max(
        0,
        leftControls.getBoundingClientRect().top - mainRect.top,
      )}px`;
    }
  } else {
    clearSidebarPosition(sidebar);
  }

  sidebar.style.setProperty("--sidebar-fit-scale", "1");

  const mainRect = main.getBoundingClientRect();
  const sidebarTop = sidebar.getBoundingClientRect().top;
  const rem =
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16;
  // Match map-top-left-controls top: var(--controls-inset)
  const controlsInsetRaw = getComputedStyle(main)
    .getPropertyValue("--controls-inset")
    .trim();
  const overlayInsetRaw = getComputedStyle(main)
    .getPropertyValue("--overlay-inset")
    .trim();
  const toPx = (value: string, fallback: number) => {
    const n = Number.parseFloat(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return value.endsWith("rem") ? n * rem : n;
  };
  const edgeInset = toPx(controlsInsetRaw, toPx(overlayInsetRaw, 24));
  const availableHeight = mainRect.bottom - sidebarTop - edgeInset;
  const naturalHeight = sidebar.scrollHeight;

  if (availableHeight > 0 && naturalHeight > availableHeight) {
    const scale = Math.min(
      1,
      Math.max(MIN_FIT_SCALE, availableHeight / naturalHeight),
    );
    sidebar.style.setProperty("--sidebar-fit-scale", scale.toFixed(3));
  }
}

function TreeSidebarCard({
  tree,
  manuallyExcluded = false,
  compact,
  analysisLayout,
  reflowKey = 0,
  sexPrediction = null,
  motion,
  frozenBox = null,
  sidebarRef: sidebarRefProp,
  onClose,
}: {
  tree: TreeFeature;
  manuallyExcluded?: boolean;
  compact: boolean;
  analysisLayout: boolean;
  reflowKey?: number;
  sexPrediction?: SexPredictionInfo | null;
  motion: "rise" | "rise-out" | "fade-in" | "fade-out" | "none";
  frozenBox?: {
    left: string;
    top: string;
    width: string;
    right: string;
    maxWidth: string;
    uiScale: string;
    fitScale: string;
  } | null;
  sidebarRef?: (node: HTMLElement | null) => void;
  onClose?: () => void;
}) {
  const localRef = useRef<HTMLElement | null>(null);
  const setSidebarRef = (node: HTMLElement | null) => {
    localRef.current = node;
    sidebarRefProp?.(node);
  };
  const { properties } = tree;
  const [lng, lat] = tree.geometry.coordinates;

  const history = useMemo(() => {
    const items = [...(properties.measurements ?? [])];
    items.sort((a, b) => a.observed_ym.localeCompare(b.observed_ym));
    return items;
  }, [properties.measurements]);

  const latestYm =
    properties.observed_ym ??
    (history.length > 0 ? history[history.length - 1].observed_ym : null);

  const [selectedYm, setSelectedYm] = useState<string | null>(latestYm);

  useEffect(() => {
    setSelectedYm(latestYm);
  }, [tree.properties.id, latestYm]);

  const view = measurementView(tree, selectedYm);
  const growth = useMemo(
    () => growthFromPrevious(history, selectedYm),
    [history, selectedYm],
  );
  const dbhGrowth = formatGrowthRate(growth.dbh_cm_per_month, "cm / month");
  const baseGrowth = formatGrowthRate(
    growth.base_diameter_cm_per_month,
    "cm / month",
  );
  const stemGrowth = formatGrowthRate(
    growth.stem_count_per_month,
    "stems / month",
  );
  const heightGrowth = formatGrowthRate(growth.height_m_per_month, "m / month");

  useLayoutEffect(() => {
    const sidebar = localRef.current;
    if (!sidebar) {
      return;
    }

    if (frozenBox) {
      sidebar.style.left = frozenBox.left;
      sidebar.style.top = frozenBox.top;
      sidebar.style.width = frozenBox.width;
      sidebar.style.right = frozenBox.right;
      sidebar.style.maxWidth = frozenBox.maxWidth;
      sidebar.style.setProperty("--sidebar-ui-scale", frozenBox.uiScale);
      sidebar.style.setProperty("--sidebar-fit-scale", frozenBox.fitScale);
      return;
    }

    const main = sidebar.closest(".app-main");
    if (!main) {
      return;
    }

    const sync = () => fitSidebarToLayout(sidebar, main, compact);
    sync();

    const observer = new ResizeObserver(sync);
    observer.observe(sidebar);
    observer.observe(main);
    const leftControls = main.querySelector(".map-top-left-controls");
    if (leftControls) {
      observer.observe(leftControls);
    }
    const tabs = main.querySelector(".map-top-left-controls__tabs");
    if (tabs) {
      observer.observe(tabs);
    }
    main
      .querySelectorAll(".analysis-popup, .route-panel--overlay")
      .forEach((node) => observer.observe(node));
    window.addEventListener("resize", sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      clearSidebarPosition(sidebar);
    };
  }, [
    compact,
    frozenBox,
    tree,
    reflowKey,
    sexPrediction,
    selectedYm,
    view.notes,
  ]);

  const motionClass =
    motion === "rise"
      ? " tree-sidebar--rise"
      : motion === "rise-out"
        ? " tree-sidebar--rise-out"
        : motion === "fade-in"
          ? " tree-sidebar--fade-in"
          : motion === "fade-out"
            ? " tree-sidebar--fade-out"
            : "";

  return (
    <aside
      ref={setSidebarRef}
      className={`tree-sidebar${compact ? " tree-sidebar--compact" : ""}${
        analysisLayout ? " tree-sidebar--analysis" : ""
      }${motionClass}`}
      aria-hidden={motion === "fade-out" || motion === "rise-out"}
    >
      <div className="tree-sidebar__header">
        <h2>ID #{properties.id}</h2>
        {onClose && (
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      {manuallyExcluded && (
        <p className="tree-sidebar__status">Manually excluded from results</p>
      )}

      <div className="tree-sidebar__body">
        <dl className="tree-sidebar__metrics">
          <div>
            <dt>DBH</dt>
            <dd>
              {formatMeasurement(view.dbh_cm, "cm")}
              {dbhGrowth && (
                <span className="tree-sidebar__growth">{dbhGrowth}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Base diameter</dt>
            <dd>
              {formatMeasurement(view.base_diameter_cm, "cm")}
              {baseGrowth && (
                <span className="tree-sidebar__growth">{baseGrowth}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>{analysisLayout ? "# stems" : "Stem count"}</dt>
            <dd>
              {formatStemCount(view.stem_count)}
              {stemGrowth && (
                <span className="tree-sidebar__growth">{stemGrowth}</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Height</dt>
            <dd>
              {formatMeasurement(view.height_m, "m")}
              {heightGrowth && (
                <span className="tree-sidebar__growth">{heightGrowth}</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="tree-sidebar__meta">
          <p>
            <span className="label">GPS</span>
            <span className="tree-sidebar__gps">
              {compact ? (
                <>
                  {lat.toFixed(6)}° N
                  <br />
                  {Math.abs(lng).toFixed(6)}° W
                </>
              ) : (
                <>
                  {lat.toFixed(6)}° N, {Math.abs(lng).toFixed(6)}° W
                </>
              )}
            </span>
          </p>
          {view.sex && (
            <p>
              <span className="label">Sex</span>
              <span>{formatSex(view.sex)}</span>
            </p>
          )}
          {sexPrediction && (
            <p>
              <span className="label">Model</span>
              <span>
                Predicted {sexPrediction.predictedSex}{" "}
                {(
                  (sexPrediction.predictedSex === "F"
                    ? sexPrediction.probabilityFemale
                    : 1 - sexPrediction.probabilityFemale) * 100
                ).toFixed(0)}
                %
                {!analysisLayout && sexPrediction.uncertain
                  ? " · uncertain"
                  : ""}
              </span>
            </p>
          )}
        </div>

        <div className="tree-sidebar__aside">
          <div className="tree-sidebar__notes">
            <span className="label">Notes</span>
            <span>{view.notes?.trim() ? view.notes : "—"}</span>
          </div>

          {history.length > 0 && (
            <div className="tree-sidebar__history">
              <span className="label">History</span>
              <div
                className="tree-sidebar__history-tabs"
                role="tablist"
                aria-label="Measurement history"
              >
                {history.map((item: TreeMeasurement) => {
                  const selected = item.observed_ym === (selectedYm ?? latestYm);
                  return (
                    <button
                      key={item.observed_ym}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      className={`tree-sidebar__history-tab${
                        selected ? " tree-sidebar__history-tab--active" : ""
                      }`}
                      onClick={() => setSelectedYm(item.observed_ym)}
                    >
                      {formatYmLabel(item.observed_ym)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function TreeSidebar({
  tree,
  manuallyExcluded = false,
  compact = false,
  analysisLayout = false,
  reflowKey = 0,
  sexPrediction = null,
  onClose,
}: TreeSidebarProps) {
  const { closing, beginClose } = useCloseAnimation();
  const [active, setActive] = useState<LayoutMode>({ compact, analysisLayout });
  const [outgoing, setOutgoing] = useState<LayoutMode | null>(null);
  const [outgoingBox, setOutgoingBox] = useState<{
    left: string;
    top: string;
    width: string;
    right: string;
    maxWidth: string;
    uiScale: string;
    fitScale: string;
  } | null>(null);
  /** Sequential analysis swap: close (rise-out) then open (rise-in). */
  const [swapPhase, setSwapPhase] = useState<"idle" | "out" | "in">("idle");
  const pendingRef = useRef<LayoutMode | null>(null);
  const activeNodeRef = useRef<HTMLElement | null>(null);
  const initialRise = useRef(true);
  const reduceMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const captureOutgoingBox = () => {
    const node = activeNodeRef.current;
    const main = node?.closest(".app-main");
    if (!node || !main) {
      setOutgoingBox(null);
      return;
    }
    const mainRect = main.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    setOutgoingBox({
      left: `${rect.left - mainRect.left}px`,
      top: `${rect.top - mainRect.top}px`,
      width: `${rect.width}px`,
      right: "auto",
      maxWidth: "none",
      uiScale: styles.getPropertyValue("--sidebar-ui-scale").trim() || "1",
      fitScale: styles.getPropertyValue("--sidebar-fit-scale").trim() || "1",
    });
  };

  useEffect(() => {
    if (closing) {
      setOutgoing(null);
      setOutgoingBox(null);
      setSwapPhase("idle");
      pendingRef.current = null;
    }
  }, [closing]);

  useEffect(() => {
    const next: LayoutMode = { compact, analysisLayout };
    if (layoutKey(next) === layoutKey(active) && swapPhase === "idle") {
      return;
    }

    // Queue the latest target while a sequential swap is running.
    if (swapPhase !== "idle") {
      pendingRef.current = next;
      return;
    }

    if (layoutKey(next) === layoutKey(active)) {
      return;
    }

    if (reduceMotion.current || closing) {
      setOutgoing(null);
      setOutgoingBox(null);
      initialRise.current = false;
      setActive(next);
      return;
    }

    initialRise.current = false;
    const isAnalysisV2Swap = active.analysisLayout || next.analysisLayout;

    if (isAnalysisV2Swap) {
      // Close current (rise-out), then open next (rise-in).
      pendingRef.current = next;
      captureOutgoingBox();
      setOutgoing(active);
      setSwapPhase("out");
      return;
    }

    // Route overlay: simultaneous crossfade.
    captureOutgoingBox();
    setOutgoing(active);
    setActive(next);
  }, [compact, analysisLayout, closing, active, swapPhase]);

  // Analysis sequential: after rise-out, swap layout and rise-in.
  useEffect(() => {
    if (swapPhase !== "out") {
      return;
    }
    const timer = window.setTimeout(() => {
      const next = pendingRef.current ?? active;
      setActive(next);
      setOutgoing(null);
      setOutgoingBox(null);
      setSwapPhase("in");
    }, RISE_OUT_MS);
    return () => window.clearTimeout(timer);
  }, [swapPhase, active]);

  useEffect(() => {
    if (swapPhase !== "in") {
      return;
    }
    const timer = window.setTimeout(() => {
      setSwapPhase("idle");
      const pending = pendingRef.current;
      pendingRef.current = null;
      // If props changed during the open animation, start another sequential swap.
      if (pending && layoutKey(pending) !== layoutKey(active)) {
        captureOutgoingBox();
        setOutgoing(active);
        pendingRef.current = pending;
        setSwapPhase("out");
      }
    }, RISE_IN_MS);
    return () => window.clearTimeout(timer);
  }, [swapPhase, active]);

  // Route simultaneous: clear outgoing after fade.
  useEffect(() => {
    if (!outgoing || swapPhase !== "idle") {
      return;
    }
    const timer = window.setTimeout(() => {
      setOutgoing(null);
      setOutgoingBox(null);
    }, FADE_MS);
    return () => window.clearTimeout(timer);
  }, [outgoing, active, swapPhase]);

  const shared = {
    tree,
    manuallyExcluded,
    reflowKey,
    sexPrediction,
  };

  const showOutgoing =
    outgoing !== null && (swapPhase === "out" || swapPhase === "idle");
  const showActive = swapPhase !== "out";
  const analysisSequential = swapPhase === "out" || swapPhase === "in";

  const activeMotion = closing
    ? "none"
    : swapPhase === "in"
      ? "rise"
      : outgoing && swapPhase === "idle"
        ? "fade-in"
        : initialRise.current
          ? "rise"
          : "none";

  const outgoingMotion = analysisSequential ? "rise-out" : "fade-out";

  return (
    <div
      className={`tree-sidebar-layer${closing ? " tree-sidebar-layer--closing" : ""}`}
    >
      {showOutgoing && outgoing && (
        <TreeSidebarCard
          key={`out-${layoutKey(outgoing)}`}
          {...shared}
          compact={outgoing.compact}
          analysisLayout={outgoing.analysisLayout}
          motion={outgoingMotion}
          frozenBox={outgoingBox}
        />
      )}
      {showActive && (
        <TreeSidebarCard
          key={`in-${layoutKey(active)}`}
          {...shared}
          compact={active.compact}
          analysisLayout={active.analysisLayout}
          motion={activeMotion}
          sidebarRef={(node) => {
            activeNodeRef.current = node;
          }}
          onClose={() => beginClose(onClose)}
        />
      )}
    </div>
  );
}

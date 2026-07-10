import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AnalysisResponse,
  CorrelationMatrix,
  PcaLoading,
} from "../types/analysis";
import type { TreeFeature } from "../types";
import { useCloseAnimation } from "../hooks/useCloseAnimation";
import PcaBiplot from "./PcaBiplot";
import "./AnalysisPanel.css";

type AnalysisDepth = "brief" | "technical";

interface AnalysisPanelProps {
  analysis: AnalysisResponse;
  expanded: boolean;
  /** Keep popup mounted but invisible (e.g. under full-page analysis). */
  dormant?: boolean;
  trees: TreeFeature[];
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  visibleTreeIds?: number[];
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
  onExpand: () => void;
  onMinimize: () => void;
  /** Called after the full-page minimize animation finishes. */
  onMinimized?: () => void;
  onClose: () => void;
  /** Called when the popup/page close animation starts (before unmount). */
  onCloseBegin?: () => void;
  onPopupHeightChange?: (height: number) => void;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatWeight(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${Math.abs(value).toFixed(3)}`;
}

function formatCorrelation(value: number): string {
  return value.toFixed(2);
}

function correlationColor(value: number): string {
  const intensity = Math.min(1, Math.abs(value));
  if (value >= 0) {
    return `rgba(45, 74, 45, ${0.08 + intensity * 0.72})`;
  }
  return `rgba(154, 74, 74, ${0.08 + intensity * 0.72})`;
}

function correlationTextColor(value: number): string {
  return Math.abs(value) >= 0.55 ? "#f4f7f0" : "#2d4a2d";
}

function ensureLoadingWeights(
  loadings: PcaLoading[],
): Array<PcaLoading & { weight_pc1: number; weight_pc2: number }> {
  const hasWeights = loadings.every(
    (loading) =>
      Number.isFinite(loading.weight_pc1) && Number.isFinite(loading.weight_pc2),
  );
  if (hasWeights) {
    return loadings.map((loading) => ({
      ...loading,
      weight_pc1: loading.weight_pc1 as number,
      weight_pc2: loading.weight_pc2 as number,
    }));
  }

  const norm1 = Math.hypot(...loadings.map((loading) => loading.pc1)) || 1;
  const norm2 = Math.hypot(...loadings.map((loading) => loading.pc2)) || 1;

  return loadings.map((loading) => ({
    ...loading,
    weight_pc1: Number.isFinite(loading.weight_pc1)
      ? (loading.weight_pc1 as number)
      : loading.pc1 / norm1,
    weight_pc2: Number.isFinite(loading.weight_pc2)
      ? (loading.weight_pc2 as number)
      : loading.pc2 / norm2,
  }));
}

function findLoading(
  loadings: Array<PcaLoading & { weight_pc1: number; weight_pc2: number }>,
  variable: string,
): (PcaLoading & { weight_pc1: number; weight_pc2: number }) | undefined {
  return loadings.find((loading) => loading.variable === variable);
}

function VariableContributions({ loadings }: { loadings: PcaLoading[] }) {
  return (
    <section className="analysis-page__card">
      <h3 className="analysis-page__card-title">PCA loadings</h3>
      <p className="analysis-page__card-lead">
        Correlation of each standardized trait with the component scores
        (loading = eigenvector × √eigenvalue).
      </p>
      <table className="analysis-panel__contributions">
        <thead>
          <tr>
            <th scope="col">Trait</th>
            <th scope="col">PC1</th>
            <th scope="col">PC2</th>
          </tr>
        </thead>
        <tbody>
          {loadings.map((loading) => (
            <tr key={loading.variable}>
              <th scope="row">{loading.label}</th>
              <td>{loading.pc1.toFixed(3)}</td>
              <td>{loading.pc2.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function traitLabelWithoutUnits(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function CorrelationHeatmap({ correlation }: { correlation: CorrelationMatrix }) {
  return (
    <section className="analysis-page__card">
      <h3 className="analysis-page__card-title">Trait correlation matrix</h3>
      <p className="analysis-page__card-lead">
        Pearson correlations on z-scored morphology (n = all surveyed
        individuals). Diagonal entries are 1 by definition.
      </p>
      <div className="analysis-panel__heatmap-wrap">
        <table className="analysis-panel__heatmap">
          <thead>
            <tr>
              <th scope="col" />
              {correlation.labels.map((label) => (
                <th key={label} scope="col">
                  {traitLabelWithoutUnits(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {correlation.matrix.map((row, rowIndex) => (
              <tr key={correlation.variables[rowIndex]}>
                <th scope="row">
                  {traitLabelWithoutUnits(correlation.labels[rowIndex])}
                </th>
                {row.map((value, columnIndex) => (
                  <td
                    key={`${rowIndex}-${columnIndex}`}
                    style={{
                      background: correlationColor(value),
                      color: correlationTextColor(value),
                    }}
                  >
                    {formatCorrelation(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultsStrip({ analysis }: { analysis: AnalysisResponse }) {
  const { pca, classification, preprocessing } = analysis;
  const retained =
    pca.explained_variance_ratio[0] + pca.explained_variance_ratio[1];

  return (
    <section
      className="analysis-page__card analysis-page__strip"
      aria-label="Analysis summary"
    >
      <h3 className="analysis-page__card-title">Summary</h3>
      <div className="analysis-page__strip-items">
        <div className="analysis-page__strip-item">
          <span className="analysis-page__strip-label">Sample</span>
          <strong>{preprocessing.pca_sample_size} surveyed</strong>
        </div>
        <div className="analysis-page__strip-item">
          <span className="analysis-page__strip-label">Labels</span>
          <strong>
            {classification.labeled_count} labeled (M/F),{" "}
            {classification.unlabeled_count} predicted (U/J)
          </strong>
        </div>
        <div className="analysis-page__strip-item">
          <span className="analysis-page__strip-label">PC1–PC2</span>
          <strong>{formatPercent(retained)} variance</strong>
        </div>
        <div className="analysis-page__strip-item">
          <span className="analysis-page__strip-label">Sex model</span>
          <strong>{formatPercent(classification.loocv_accuracy)} accuracy</strong>
        </div>
      </div>
    </section>
  );
}

function AnalysisPopup({
  analysis,
  dormant = false,
  highlightedTreeId,
  selectedTreeId,
  visibleTreeIds,
  onHoverTree,
  onSelectTree,
  onExpand,
  onClose,
  onCloseBegin,
  onPopupHeightChange,
}: {
  analysis: AnalysisResponse;
  dormant?: boolean;
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  visibleTreeIds?: number[];
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
  onExpand: () => void;
  onClose: () => void;
  onCloseBegin?: () => void;
  onPopupHeightChange?: (height: number) => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  const dormantRef = useRef(dormant);
  const skipEnterRef = useRef(dormant);
  const { closing, beginClose } = useCloseAnimation();

  dormantRef.current = dormant;
  if (dormant) {
    skipEnterRef.current = true;
  }

  useEffect(() => {
    const popup = popupRef.current;
    if (!popup || !onPopupHeightChange) {
      return;
    }

    const syncHeight = () => {
      if (dormantRef.current) return;
      onPopupHeightChange(popup.offsetHeight);
    };

    syncHeight();
    const observer = new ResizeObserver(syncHeight);
    observer.observe(popup);
    return () => {
      observer.disconnect();
      onPopupHeightChange(0);
    };
  }, [onPopupHeightChange]);

  const handleClose = () => {
    if (closing) {
      return;
    }
    onCloseBegin?.();
    beginClose(onClose);
  };

  return (
    <div
      ref={popupRef}
      className={`analysis-popup${closing ? " analysis-popup--closing" : ""}${
        skipEnterRef.current || dormant ? " analysis-popup--no-enter" : ""
      }${dormant ? " analysis-popup--dormant" : ""}`}
      role="dialog"
      aria-label="Morphology plot"
      aria-hidden={dormant}
    >
      <button
        type="button"
        className="analysis-popup__close"
        onClick={handleClose}
        aria-label="Close analysis"
      >
        ×
      </button>
      <AnalysisPlotSection
        layout="popup"
        pca={analysis.pca}
        trees={[]}
        highlightedTreeId={highlightedTreeId}
        selectedTreeId={selectedTreeId}
        visibleTreeIds={visibleTreeIds}
        onHoverTree={onHoverTree}
        onSelectTree={onSelectTree}
      />
      <button
        type="button"
        className="analysis-popup__more"
        onClick={onExpand}
      >
        See more
      </button>
    </div>
  );
}

function AnalysisPlotSection({
  pca,
  trees,
  highlightedTreeId,
  selectedTreeId,
  visibleTreeIds,
  onHoverTree,
  onSelectTree,
  layout = "default",
}: {
  pca: AnalysisResponse["pca"];
  trees: TreeFeature[];
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  visibleTreeIds?: number[];
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
  layout?: "default" | "popup";
}) {
  return (
    <section className="analysis-page__plot" aria-label="PCA scatter plot">
      <PcaBiplot
        layout={layout}
        pca={pca}
        trees={trees}
        highlightedTreeId={highlightedTreeId}
        selectedTreeId={selectedTreeId}
        visibleTreeIds={visibleTreeIds}
        onHoverTree={onHoverTree}
        onSelectTree={onSelectTree}
      />
    </section>
  );
}

function BriefContent({
  analysis,
  trees,
  highlightedTreeId,
  selectedTreeId,
  onHoverTree,
  onSelectTree,
}: {
  analysis: AnalysisResponse;
  trees: TreeFeature[];
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
}) {
  const { pca, classification } = analysis;
  const matrix = classification.confusion_matrix;
  const pc1Percent = formatPercent(pca.explained_variance_ratio[0]);
  const pc2Percent = formatPercent(pca.explained_variance_ratio[1]);

  return (
    <div className="analysis-page__body">
      <aside className="analysis-page__details">
        <section className="analysis-page__card">
          <h3 className="analysis-page__card-title">Key findings</h3>
            <ul className="analysis-page__tech-list">
              <li>
                <strong>PC1 ({pc1Percent})</strong> is a size axis: DBH, base
                diameter, and height move together. Larger plants plot right.{" "}
                <strong>PC2 ({pc2Percent})</strong> mainly reflects stem count
                after size is accounted for.
              </li>
              <li>
                Size traits are strongly intercorrelated, while stem count is
                only moderately related. See the correlation matrix on the
                Technical tab.
              </li>
              <li>
                Sex correlation with morphology is weak: the model reaches only{" "}
                {formatPercent(classification.loocv_accuracy)} leave-one-out
                accuracy on {classification.labeled_count} labeled trees.
              </li>
              <li>
                The {classification.unlabeled_count} Unknown/Juvenile plants are
                colored by model prediction on the plot. Mid-range probabilities
                (0.3-0.7) are marked uncertain; treat those as guesses, not field
                labels.
              </li>
            </ul>
          </section>

          <section className="analysis-page__card">
            <h3 className="analysis-page__card-title">Classification snapshot</h3>
            <p className="analysis-page__card-lead">
              A model guesses male vs female from the four size measurements,
              trained only on plants with known sex, then tested leave-one-out.
              Rows are true sex; columns are the model prediction.
            </p>
            <table className="analysis-panel__matrix">
              <caption>
                Diagonal = correct ({matrix.matrix[0]?.[0] ?? 0} F,{" "}
                {matrix.matrix[1]?.[1] ?? 0} M). Off-diagonal = mistakes.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Actual \ Pred</th>
                  {matrix.labels.map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.matrix.map((row, rowIndex) => (
                  <tr key={matrix.labels[rowIndex]}>
                    <th scope="row">{matrix.labels[rowIndex]}</th>
                    {row.map((value, columnIndex) => (
                      <td key={`${rowIndex}-${columnIndex}`}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </aside>

        <div className="analysis-page__chart-col">
          <AnalysisPlotSection
            pca={pca}
            trees={trees}
            highlightedTreeId={highlightedTreeId}
            selectedTreeId={selectedTreeId}
            onHoverTree={onHoverTree}
            onSelectTree={onSelectTree}
          />
        </div>
      </div>
  );
}

function TechnicalContent({
  analysis,
  trees,
  highlightedTreeId,
  selectedTreeId,
  onHoverTree,
  onSelectTree,
}: {
  analysis: AnalysisResponse;
  trees: TreeFeature[];
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
}) {
  const { pca, classification, preprocessing } = analysis;
  const loadings = useMemo(
    () => ensureLoadingWeights(pca.loadings),
    [pca.loadings],
  );
  const matrix = classification.confusion_matrix;
  const pc1Percent = formatPercent(pca.explained_variance_ratio[0]);
  const pc2Percent = formatPercent(pca.explained_variance_ratio[1]);
  const pc3Percent = formatPercent(pca.explained_variance_ratio[2] ?? 0);
  const pc4Percent = formatPercent(pca.explained_variance_ratio[3] ?? 0);
  const base = findLoading(loadings, "base_diameter_cm");
  const height = findLoading(loadings, "height_m");
  const dbh = findLoading(loadings, "dbh_cm");
  const stems = findLoading(loadings, "stem_count");

  return (
    <div className="analysis-page__body">
      <aside className="analysis-page__details">
        <section className="analysis-page__card">
          <h3 className="analysis-page__card-title">Principal components</h3>
            <p className="analysis-page__card-lead">
              PCA was fit on all {preprocessing.pca_sample_size} individuals after
              z-scoring DBH, base diameter, stem count, and height. Component
              scores are linear combinations of the standardized traits using the
              unit-length eigenvectors below.
            </p>
            <p className="analysis-page__equation">
              PC1 ({pc1Percent} variance) ={" "}
              {loadings
                .map(
                  (loading) =>
                    `${formatWeight(loading.weight_pc1)}·z(${loading.label})`,
                )
                .join(" ")}
            </p>
            <p className="analysis-page__equation">
              PC2 ({pc2Percent} variance) ={" "}
              {loadings
                .map(
                  (loading) =>
                    `${formatWeight(loading.weight_pc2)}·z(${loading.label})`,
                )
                .join(" ")}
            </p>
            <ul className="analysis-page__tech-list">
              <li>
                PC1 is a size axis: all four weights are positive, with the
                largest contributions from base diameter (
                {formatWeight(base?.weight_pc1 ?? Number.NaN)}), height (
                {formatWeight(height?.weight_pc1 ?? Number.NaN)}), and DBH (
                {formatWeight(dbh?.weight_pc1 ?? Number.NaN)}).
              </li>
              <li>
                PC2 contrasts stem count (
                {formatWeight(stems?.weight_pc2 ?? Number.NaN)}) against the
                diameter and height traits, capturing residual branching structure
                after overall size is removed.
              </li>
              <li>
                Remaining variance: PC3 {pc3Percent}, PC4 {pc4Percent}. The
                biplot retains PC1–PC2 only (~
                {formatPercent(
                  pca.explained_variance_ratio[0] +
                    pca.explained_variance_ratio[1],
                )}{" "}
                cumulative).
              </li>
            </ul>
          </section>

          <VariableContributions loadings={loadings} />

          <section className="analysis-page__card">
            <h3 className="analysis-page__card-title">Sex classification</h3>
            <p className="analysis-page__card-lead">
              L2-regularized logistic regression on the same four z-scored traits,
              trained on field-labeled M/F only (n ={" "}
              {classification.labeled_count}). Leave-one-out cross-validation
              accuracy: {formatPercent(classification.loocv_accuracy)}. Applied to{" "}
              {classification.unlabeled_count} unlabeled (U/J) individuals for
              predicted sex on the biplot. Probabilities in [0.30, 0.70] are
              treated as uncertain.
            </p>
            <table className="analysis-panel__matrix">
              <caption>LOOCV confusion matrix</caption>
              <thead>
                <tr>
                  <th scope="col">Actual \ Pred</th>
                  {matrix.labels.map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.matrix.map((row, rowIndex) => (
                  <tr key={matrix.labels[rowIndex]}>
                    <th scope="row">{matrix.labels[rowIndex]}</th>
                    {row.map((value, columnIndex) => (
                      <td key={`${rowIndex}-${columnIndex}`}>{value}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="analysis-panel__note">
              Missing DBH values were coded as 0; stem count &quot;M&quot;
              (multiple) was coded as 3 prior to scaling. Unlabeled predictions
              are model estimates, not field labels.
            </p>
          </section>
        </aside>

        <div className="analysis-page__chart-col">
          <AnalysisPlotSection
            pca={pca}
            trees={trees}
            highlightedTreeId={highlightedTreeId}
            selectedTreeId={selectedTreeId}
            onHoverTree={onHoverTree}
            onSelectTree={onSelectTree}
          />
          {pca.correlation ? (
            <CorrelationHeatmap correlation={pca.correlation} />
          ) : (
            <section className="analysis-page__card">
              <h3 className="analysis-page__card-title">
                Trait correlation matrix
              </h3>
              <p className="analysis-page__card-lead">
                Correlation matrix unavailable in the loaded analysis payload.
                Refresh or regenerate analysis data.
              </p>
            </section>
          )}
        </div>
      </div>
  );
}

export default function AnalysisPanel({
  analysis,
  expanded,
  dormant,
  trees,
  highlightedTreeId,
  selectedTreeId,
  visibleTreeIds,
  onHoverTree,
  onSelectTree,
  onExpand,
  onMinimize,
  onMinimized,
  onClose,
  onCloseBegin,
  onPopupHeightChange,
}: AnalysisPanelProps) {
  const [depth, setDepth] = useState<AnalysisDepth>("brief");
  const { closing, beginClose } = useCloseAnimation(220);
  const [exitKind, setExitKind] = useState<"minimize" | "close" | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const depthTrackRef = useRef<HTMLDivElement>(null);
  const briefBtnRef = useRef<HTMLButtonElement>(null);
  const technicalBtnRef = useRef<HTMLButtonElement>(null);
  const [pill, setPill] = useState({ left: 0, width: 0 });

  useEffect(() => {
    if (!expanded) {
      setHasOpened(false);
      return;
    }
    const timer = window.setTimeout(() => setHasOpened(true), 220);
    return () => window.clearTimeout(timer);
  }, [expanded]);

  const syncDepthPill = () => {
    const track = depthTrackRef.current;
    const activeBtn =
      depth === "brief" ? briefBtnRef.current : technicalBtnRef.current;
    if (!track || !activeBtn) {
      return;
    }
    const trackRect = track.getBoundingClientRect();
    const btnRect = activeBtn.getBoundingClientRect();
    setPill({
      left: btnRect.left - trackRect.left,
      width: btnRect.width,
    });
  };

  useLayoutEffect(() => {
    syncDepthPill();
  }, [depth]);

  useEffect(() => {
    const onResize = () => syncDepthPill();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [depth]);

  const handleMinimize = () => {
    if (closing) {
      return;
    }
    setExitKind("minimize");
    // Reveal the dormant popup immediately; keep this page mounted until the exit animation ends.
    onMinimize();
    beginClose(() => {
      onMinimized?.();
    });
  };

  const handleClose = () => {
    if (closing) {
      return;
    }
    setExitKind("close");
    onCloseBegin?.();
    beginClose(onClose);
  };

  if (!expanded) {
    return (
      <AnalysisPopup
        analysis={analysis}
        dormant={dormant}
        highlightedTreeId={highlightedTreeId}
        selectedTreeId={selectedTreeId}
        visibleTreeIds={visibleTreeIds}
        onHoverTree={onHoverTree}
        onSelectTree={onSelectTree}
        onExpand={onExpand}
        onClose={onClose}
        onCloseBegin={onCloseBegin}
        onPopupHeightChange={onPopupHeightChange}
      />
    );
  }

  const pageMotionClass = closing
    ? exitKind === "minimize"
      ? " analysis-page--minimizing"
      : " analysis-page--closing"
    : hasOpened
      ? ""
      : " analysis-page--opening";

  return (
    <div
      className={`analysis-page${pageMotionClass}`}
      role="dialog"
      aria-labelledby="analysis-title"
    >
      <header className="analysis-page__header">
        <h2 id="analysis-title">
          <span className="analysis-page__title-full">Statistical </span>
          Analysis
        </h2>
        <div className="analysis-page__header-actions">
          <div
            ref={depthTrackRef}
            className="analysis-page__depth"
            role="group"
            aria-label="Analysis depth"
          >
            <span
              className="analysis-page__depth-pill"
              style={{
                width: pill.width > 0 ? `${pill.width}px` : undefined,
                transform:
                  pill.width > 0 ? `translateX(${pill.left}px)` : undefined,
              }}
              aria-hidden
            />
            <button
              ref={briefBtnRef}
              type="button"
              className={`analysis-page__depth-btn${
                depth === "brief" ? " analysis-page__depth-btn--active" : ""
              }`}
              onClick={() => setDepth("brief")}
              aria-pressed={depth === "brief"}
            >
              Brief
            </button>
            <button
              ref={technicalBtnRef}
              type="button"
              className={`analysis-page__depth-btn${
                depth === "technical" ? " analysis-page__depth-btn--active" : ""
              }`}
              onClick={() => setDepth("technical")}
              aria-pressed={depth === "technical"}
            >
              Technical
            </button>
          </div>
          <div className="analysis-page__window-controls">
            <button
              type="button"
              className="analysis-page__minimize"
              onClick={handleMinimize}
              aria-label="Minimize to plot"
            >
              −
            </button>
            <button
              type="button"
              className="analysis-page__close"
              onClick={handleClose}
              aria-label="Close analysis"
            >
              ×
            </button>
          </div>
        </div>
      </header>

      <div className="analysis-page__main">
        <div
          key={depth}
          className={`analysis-page__scroll analysis-page__scroll--${depth} ui-rise-in`}
        >
          <ResultsStrip analysis={analysis} />
          {depth === "brief" ? (
            <BriefContent
              analysis={analysis}
              trees={trees}
              highlightedTreeId={highlightedTreeId}
              selectedTreeId={selectedTreeId}
              onHoverTree={onHoverTree}
              onSelectTree={onSelectTree}
            />
          ) : (
            <TechnicalContent
              analysis={analysis}
              trees={trees}
              highlightedTreeId={highlightedTreeId}
              selectedTreeId={selectedTreeId}
              onHoverTree={onHoverTree}
              onSelectTree={onSelectTree}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function AnalysisPanelTab({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`analysis-panel__tab${open ? " analysis-panel__tab--active" : ""}`}
      onClick={onToggle}
      aria-expanded={open}
    >
      Analysis
    </button>
  );
}

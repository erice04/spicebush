import type { AnalysisResponse } from "../types/analysis";
import PcaBiplot from "./PcaBiplot";
import "./AnalysisPanel.css";

interface AnalysisPanelProps {
  analysis: AnalysisResponse;
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number) => void;
  onClose: () => void;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function AnalysisPanel({
  analysis,
  highlightedTreeId,
  selectedTreeId,
  onHoverTree,
  onSelectTree,
  onClose,
}: AnalysisPanelProps) {
  const { pca, classification, preprocessing } = analysis;
  const matrix = classification.confusion_matrix;

  return (
    <section className="analysis-panel" aria-label="Morphology analysis">
      <header className="analysis-panel__header">
        <h2>Analysis</h2>
        <button
          type="button"
          className="analysis-panel__close"
          onClick={onClose}
          aria-label="Close analysis panel"
        >
          ×
        </button>
      </header>

      <PcaBiplot
        pca={pca}
        highlightedTreeId={highlightedTreeId}
        selectedTreeId={selectedTreeId}
        onHoverTree={onHoverTree}
        onSelectTree={onSelectTree}
      />

      <div className="analysis-panel__stats">
        <p>
          <strong>LOOCV accuracy:</strong>{" "}
          {formatPercent(classification.loocv_accuracy)} (
          {classification.labeled_count} labeled M/F)
        </p>
        <p>
          <strong>Unlabeled predictions:</strong>{" "}
          {classification.unlabeled_count} individuals (U/J)
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
          PCA uses all {preprocessing.pca_sample_size} individuals. Sex
          classification trains on {preprocessing.labeled_sex_values.join("/")}{" "}
          only. Missing DBH and multiple-stem (&quot;M&quot;) values were median-imputed.
          Unlabeled predictions are model estimates, not field labels.
        </p>
      </div>
    </section>
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

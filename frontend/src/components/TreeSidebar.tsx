import type { TreeFeature } from "../types";
import { formatSex, formatStemCount } from "../utils/labels";
import "./TreeSidebar.css";

interface TreeSidebarProps {
  tree: TreeFeature;
  manuallyExcluded?: boolean;
  onClose: () => void;
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

export default function TreeSidebar({
  tree,
  manuallyExcluded = false,
  onClose,
}: TreeSidebarProps) {
  const { properties } = tree;
  const [lng, lat] = tree.geometry.coordinates;

  return (
    <aside className="tree-sidebar">
      <div className="tree-sidebar__header">
        <h2>ID #{properties.id}</h2>
        <button type="button" className="close-btn" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      {manuallyExcluded && (
        <p className="tree-sidebar__status">Manually excluded from results</p>
      )}

      <dl className="tree-sidebar__metrics">
        <div>
          <dt>DBH</dt>
          <dd>{formatMeasurement(properties.dbh_cm, "cm")}</dd>
        </div>
        <div>
          <dt>Base diameter</dt>
          <dd>{formatMeasurement(properties.base_diameter_cm, "cm")}</dd>
        </div>
        <div>
          <dt>Stem count</dt>
          <dd>{formatStemCount(properties.stem_count)}</dd>
        </div>
        <div>
          <dt>Height</dt>
          <dd>{formatMeasurement(properties.height_m, "m")}</dd>
        </div>
      </dl>

      <div className="tree-sidebar__meta">
        <p>
          <span className="label">Coordinates</span>
          <span>
            {lat.toFixed(6)}° N, {Math.abs(lng).toFixed(6)}° W
          </span>
        </p>
        {properties.sex && (
          <p>
            <span className="label">Sex</span>
            <span>{formatSex(properties.sex)}</span>
          </p>
        )}
        {properties.notes && (
          <p>
            <span className="label">Notes</span>
            <span>{properties.notes}</span>
          </p>
        )}
      </div>
    </aside>
  );
}

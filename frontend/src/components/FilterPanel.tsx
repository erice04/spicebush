import { useState } from "react";
import type { DataBounds, TreeFilters } from "../types";
import type { SavedSelectionSummary } from "../api/selections";
import { SEX_OPTIONS } from "../utils/filters";
import RangeSlider from "./RangeSlider";
import "./FilterPanel.css";

interface FilterPanelProps {
  attributeFilters: TreeFilters;
  bounds: DataBounds;
  visibleCount: number;
  totalCount: number;
  activeFilterCount: number;
  hasRegion: boolean;
  manualExcludedCount: number;
  savedSelections: SavedSelectionSummary[];
  selectionApiAvailable: boolean;
  selectionMessage: string | null;
  onAttributeFiltersChange: (filters: TreeFilters) => void;
  onResetAttributes: () => void;
  onClearRegion: () => void;
  onClearManualExcluded: () => void;
  onSaveSelection: (name: string) => void;
  onLoadSelection: (id: number) => void;
  onDeleteSelection: (id: number) => void;
}

export default function FilterPanel({
  attributeFilters,
  bounds,
  visibleCount,
  totalCount,
  activeFilterCount,
  hasRegion,
  manualExcludedCount,
  savedSelections,
  selectionApiAvailable,
  selectionMessage,
  onAttributeFiltersChange,
  onResetAttributes,
  onClearRegion,
  onClearManualExcluded,
  onSaveSelection,
  onLoadSelection,
  onDeleteSelection,
}: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [loadSelectionId, setLoadSelectionId] = useState("");

  const updateSex = (sex: keyof TreeFilters["sex"], checked: boolean) => {
    onAttributeFiltersChange({
      ...attributeFilters,
      sex: { ...attributeFilters.sex, [sex]: checked },
    });
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="filter-panel__tab"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        aria-label="Show filters"
      >
        Filters
        {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
      </button>
    );
  }

  return (
    <aside className="filter-panel">
      <div className="filter-panel__header">
        <div>
          <h2>Filters</h2>
          <p className="filter-panel__count">
            Showing {visibleCount} of {totalCount}
          </p>
        </div>
        <div className="filter-panel__header-actions">
          <button type="button" className="filter-panel__reset" onClick={onResetAttributes}>
            Reset
          </button>
          <button
            type="button"
            className="filter-panel__collapse"
            onClick={() => setExpanded(false)}
            aria-label="Hide filters"
          >
            ×
          </button>
        </div>
      </div>

      {(hasRegion || manualExcludedCount > 0) && (
        <div className="filter-panel__quick-actions">
          {hasRegion && (
            <button type="button" className="filter-panel__chip" onClick={onClearRegion}>
              Clear region
            </button>
          )}
          {manualExcludedCount > 0 && (
            <button
              type="button"
              className="filter-panel__save filter-panel__save--inline"
              onClick={onClearManualExcluded}
            >
              Reset
            </button>
          )}
        </div>
      )}

      <fieldset className="filter-panel__group">
        <legend>Sex</legend>
        <div className="filter-panel__checkboxes">
          {SEX_OPTIONS.map(({ value, label }) => (
            <label key={value} className="filter-panel__checkbox">
              <input
                type="checkbox"
                checked={attributeFilters.sex[value]}
                onChange={(event) => updateSex(value, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="filter-panel__sliders">
        <RangeSlider
          label="Base diameter"
          min={bounds.baseDiameter.min}
          max={bounds.baseDiameter.max}
          value={attributeFilters.baseDiameter}
          step={0.1}
          unit="cm"
          digits={1}
          onChange={(baseDiameter) =>
            onAttributeFiltersChange({ ...attributeFilters, baseDiameter })
          }
        />
        <RangeSlider
          label="Stem count"
          min={bounds.stemCount.min}
          max={bounds.stemCount.max}
          value={attributeFilters.stemCount}
          step={1}
          digits={0}
          onChange={(stemCount) =>
            onAttributeFiltersChange({ ...attributeFilters, stemCount })
          }
        />
        <RangeSlider
          label="DBH"
          min={bounds.dbh.min}
          max={bounds.dbh.max}
          value={attributeFilters.dbh}
          step={0.1}
          unit="cm"
          digits={1}
          onChange={(dbh) => onAttributeFiltersChange({ ...attributeFilters, dbh })}
        />
        <RangeSlider
          label="Height"
          min={bounds.height.min}
          max={bounds.height.max}
          value={attributeFilters.height}
          step={0.1}
          unit="m"
          digits={1}
          onChange={(height) =>
            onAttributeFiltersChange({ ...attributeFilters, height })
          }
        />
      </div>

      <fieldset className="filter-panel__group">
        <legend>Saved filters</legend>
        <div className="filter-panel__save-row">
          <input
            type="text"
            className="filter-panel__input"
            value={saveName}
            onChange={(event) => setSaveName(event.target.value)}
            placeholder="Name…"
            maxLength={120}
            disabled={!selectionApiAvailable}
            aria-label="Saved filter name"
          />
          <button
            type="button"
            className="filter-panel__save"
            disabled={!selectionApiAvailable || !saveName.trim()}
            onClick={() => {
              onSaveSelection(saveName.trim());
              setSaveName("");
            }}
          >
            Save
          </button>
        </div>
        {savedSelections.length > 0 ? (
          <div className="filter-panel__load-row">
            <select
              className="filter-panel__select"
              value={loadSelectionId}
              onChange={(event) => setLoadSelectionId(event.target.value)}
              disabled={!selectionApiAvailable}
              aria-label="Saved filters"
            >
              <option value="">Load…</option>
              {savedSelections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="filter-panel__load"
              disabled={!selectionApiAvailable || !loadSelectionId}
              onClick={() => {
                onLoadSelection(Number(loadSelectionId));
                setLoadSelectionId("");
              }}
            >
              Load
            </button>
            <button
              type="button"
              className="filter-panel__delete"
              disabled={!selectionApiAvailable || !loadSelectionId}
              onClick={() => {
                onDeleteSelection(Number(loadSelectionId));
                setLoadSelectionId("");
              }}
            >
              Delete
            </button>
          </div>
        ) : (
          <p className="filter-panel__empty-saved">
            {selectionApiAvailable ? "None saved yet." : "API unavailable."}
          </p>
        )}
        {selectionMessage && (
          <p className="filter-panel__message">{selectionMessage}</p>
        )}
      </fieldset>
    </aside>
  );
}

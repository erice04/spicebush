import { useEffect, useState } from "react";
import type {
  DataBounds,
  PredictedSexCategory,
  PredictedSexGroup,
  TreeFilters,
} from "../types";
import type { SavedSelectionSummary } from "../api/selections";
import {
  SEX_OPTIONS,
  PREDICTED_SEX_OPTIONS,
  normalizePredictedSex,
} from "../utils/filters";
import { useAnimatedOpen } from "../hooks/useCloseAnimation";
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
  onAttributeFiltersChange: (filters: TreeFilters) => void;
  onResetAttributes: () => void;
  onClearRegion: () => void;
  onClearManualExcluded: () => void;
  onSaveSelection: (name: string) => void;
  onLoadSelection: (id: number) => void;
  onDeleteSelection: (id: number) => void;
  onSearchTreeId: (id: number) => boolean;
  onExpandedChange?: (expanded: boolean) => void;
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
  onAttributeFiltersChange,
  onResetAttributes,
  onClearRegion,
  onClearManualExcluded,
  onSaveSelection,
  onLoadSelection,
  onDeleteSelection,
  onSearchTreeId,
  onExpandedChange,
}: FilterPanelProps) {
  const { open: expanded, closing, requestOpen, requestClose } =
    useAnimatedOpen();
  const [saveName, setSaveName] = useState("");
  const [loadSelectionId, setLoadSelectionId] = useState("");
  const [loadedSelectionId, setLoadedSelectionId] = useState("");
  const [idQuery, setIdQuery] = useState("");
  const [idSearchMessage, setIdSearchMessage] = useState<string | null>(null);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  useEffect(() => {
    return () => onExpandedChange?.(false);
  }, [onExpandedChange]);

  const predictedSex = normalizePredictedSex(attributeFilters.predictedSex);

  const updateSex = (sex: keyof TreeFilters["sex"], checked: boolean) => {
    onAttributeFiltersChange({
      ...attributeFilters,
      sex: { ...attributeFilters.sex, [sex]: checked },
    });
  };

  const updatePredictedSex = (
    group: PredictedSexGroup,
    category: PredictedSexCategory,
    checked: boolean,
  ) => {
    onAttributeFiltersChange({
      ...attributeFilters,
      predictedSex: {
        ...predictedSex,
        [group]: {
          ...predictedSex[group],
          [category]: checked,
        },
      },
    });
  };

  const renderSexOption = (value: (typeof SEX_OPTIONS)[number]["value"]) => {
    const option = SEX_OPTIONS.find((item) => item.value === value);
    if (!option) {
      return null;
    }
    return (
      <label key={value} className="filter-panel__checkbox">
        <input
          type="checkbox"
          checked={attributeFilters.sex[value]}
          onChange={(event) => updateSex(value, event.target.checked)}
        />
        <span>{option.label}</span>
      </label>
    );
  };

  const renderPredictedRow = (group: PredictedSexGroup) => {
    if (!attributeFilters.sex[group]) {
      return null;
    }
    return (
      <div className="filter-panel__predicted">
        <span className="filter-panel__predicted-label">Predicted</span>
        <div className="filter-panel__predicted-checkboxes">
          {PREDICTED_SEX_OPTIONS.map(({ value, label }) => (
            <label
              key={value}
              className="filter-panel__checkbox filter-panel__checkbox--predicted"
            >
              <input
                type="checkbox"
                checked={predictedSex[group][value]}
                onChange={(event) =>
                  updatePredictedSex(group, value, event.target.checked)
                }
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>
    );
  };

  const tabLabel = `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`;

  if (!expanded) {
    return (
      <button
        type="button"
        className="filter-panel__tab"
        onClick={requestOpen}
        aria-expanded={false}
        aria-label="Show filters"
      >
        {tabLabel}
      </button>
    );
  }

  return (
    <div className="filter-panel-anchor">
      {/* Reserve the Filters tab footprint so ? does not shift when the panel opens */}
      <span className="filter-panel__tab filter-panel__tab--sizer" aria-hidden="true">
        {tabLabel}
      </span>
      <aside
        className={`filter-panel${closing ? " filter-panel--closing" : ""}`}
      >
      <div className="filter-panel__header">
        <div className="filter-panel__header-text">
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
            onClick={requestClose}
            aria-label="Hide filters"
          >
            ×
          </button>
        </div>
      </div>

      <form
        className="filter-panel__id-search"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = idQuery.trim();
          if (!trimmed) {
            setIdSearchMessage(null);
            return;
          }
          const id = Number(trimmed);
          if (!Number.isFinite(id)) {
            setIdSearchMessage("Enter a numeric ID");
            return;
          }
          const found = onSearchTreeId(id);
          setIdSearchMessage(found ? null : "ID not found");
        }}
      >
        <input
          type="search"
          value={idQuery}
          onChange={(event) => {
            setIdQuery(event.target.value);
            setIdSearchMessage(null);
          }}
          placeholder="Search ID…"
          aria-label="Search plant by ID"
        />
        <button type="submit" className="filter-panel__id-search-btn">
          Search
        </button>
      </form>
      {idSearchMessage && (
        <p className="filter-panel__id-search-msg">{idSearchMessage}</p>
      )}

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
        <div className="filter-panel__checkboxes filter-panel__checkboxes--sex">
          {renderSexOption("M")}
          {renderSexOption("F")}
          <div className="filter-panel__sex-block">
            {renderSexOption("J")}
            {renderPredictedRow("J")}
          </div>
          <div className="filter-panel__sex-block">
            {renderSexOption("U")}
            {renderPredictedRow("U")}
          </div>
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
        {savedSelections.length > 0 && (
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
              disabled={
                !selectionApiAvailable ||
                !loadSelectionId ||
                loadSelectionId === loadedSelectionId
              }
              onClick={() => {
                onLoadSelection(Number(loadSelectionId));
                setLoadedSelectionId(loadSelectionId);
              }}
            >
              Load
            </button>
            <button
              type="button"
              className="filter-panel__delete"
              disabled={!selectionApiAvailable || !loadSelectionId}
              onClick={() => {
                const id = Number(loadSelectionId);
                onDeleteSelection(id);
                if (loadSelectionId === loadedSelectionId) {
                  setLoadedSelectionId("");
                }
                setLoadSelectionId("");
              }}
            >
              Delete
            </button>
          </div>
        )}
      </fieldset>
    </aside>
    </div>
  );
}

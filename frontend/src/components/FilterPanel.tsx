import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { sexFillColor } from "../theme/sexColors";
import { useAnimatedOpen } from "../hooks/useCloseAnimation";
import RangeSlider from "./RangeSlider";
import { IconFilter } from "./railIcons";
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
  selectionApiConnecting?: boolean;
  selectionBusy?: boolean;
  /** Increment to request this panel close (another panel opened). */
  closeSignal?: number;
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
  selectionApiConnecting = false,
  selectionBusy = false,
  closeSignal = 0,
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
    useAnimatedOpen(220);
  const tabRef = useRef<HTMLButtonElement>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);
  const [saveName, setSaveName] = useState("");
  const [loadedSelectionId, setLoadedSelectionId] = useState("");
  const [idQuery, setIdQuery] = useState("");
  const [idSearchMessage, setIdSearchMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    setOverlayHost(tabRef.current?.closest(".map-top-controls") ?? null);
  }, []);

  const prevCloseSignal = useRef(closeSignal);

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
        requestClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [expanded, requestClose]);

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

  const updatePredicted = (
    group: PredictedSexGroup,
    key: PredictedSexCategory,
    checked: boolean,
  ) => {
    const next = normalizePredictedSex(attributeFilters.predictedSex);
    onAttributeFiltersChange({
      ...attributeFilters,
      predictedSex: {
        ...next,
        [group]: { ...next[group], [key]: checked },
      },
    });
  };

  const renderSexOption = (value: keyof TreeFilters["sex"]) => {
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
        <span
          className="filter-panel__sex-swatch"
          style={{ background: sexFillColor(value) }}
          aria-hidden="true"
        />
        {option.label}
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
          {PREDICTED_SEX_OPTIONS.map((option) => (
            <label
              key={`${group}-${option.value}`}
              className="filter-panel__checkbox filter-panel__checkbox--predicted"
            >
              <input
                type="checkbox"
                checked={predictedSex[group][option.value]}
                onChange={(event) =>
                  updatePredicted(group, option.value, event.target.checked)
                }
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const tabLabel = `Filters${activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}`;

  const panel =
    expanded && overlayHost
      ? createPortal(
          <aside
            className={`filter-panel filter-panel--overlay sb-dock-panel${
              closing ? " filter-panel--closing" : ""
            }`}
          >
            <div className="filter-panel__header sb-dock-panel__header">
              <div className="filter-panel__header-text">
                <div className="sb-dock-panel__title-row">
                  <IconFilter />
                  <h2 className="sb-dock-panel__title">Filters</h2>
                </div>
                <p className="filter-panel__count sb-dock-panel__subtitle">
                  Showing {visibleCount} of {totalCount}
                </p>
              </div>
              <div className="filter-panel__header-actions">
                <button
                  type="button"
                  className="filter-panel__reset"
                  onClick={onResetAttributes}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="filter-panel__collapse sb-dock-panel__close"
                  onClick={requestClose}
                  aria-label="Hide filters"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="filter-panel__body sb-dock-panel__body">
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
                  <button
                    type="button"
                    className="filter-panel__chip"
                    onClick={onClearRegion}
                  >
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
                onChange={(dbh) =>
                  onAttributeFiltersChange({ ...attributeFilters, dbh })
                }
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

            <fieldset className="filter-panel__group filter-panel__group--saved">
              <legend>Saved Filters</legend>
              <div className="filter-panel__saved-save">
                <input
                  type="text"
                  className="filter-panel__saved-name"
                  value={saveName}
                  onChange={(event) => setSaveName(event.target.value)}
                  placeholder="Save current filters as…"
                  aria-label="Name for saved filters"
                  disabled={!selectionApiAvailable || selectionBusy}
                />
                <button
                  type="button"
                  className="filter-panel__save"
                  disabled={
                    !selectionApiAvailable ||
                    selectionBusy ||
                    !saveName.trim()
                  }
                  onClick={() => {
                    onSaveSelection(saveName.trim());
                    setSaveName("");
                  }}
                >
                  Save
                </button>
              </div>
              <div className="filter-panel__load-row">
                <select
                  className="filter-panel__select"
                  value={loadedSelectionId}
                  disabled={
                    !selectionApiAvailable ||
                    selectionBusy ||
                    savedSelections.length === 0
                  }
                  aria-label="Saved filter to load"
                  onChange={(event) => {
                    setLoadedSelectionId(event.target.value);
                  }}
                >
                  <option value="">
                    {savedSelections.length === 0
                      ? "No saved filters"
                      : "Load saved filter…"}
                  </option>
                  {savedSelections.map((item) => (
                    <option key={item.id} value={String(item.id)}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="filter-panel__load"
                  disabled={
                    !selectionApiAvailable ||
                    selectionBusy ||
                    !loadedSelectionId
                  }
                  onClick={() => {
                    const id = Number(loadedSelectionId);
                    if (Number.isFinite(id)) {
                      onLoadSelection(id);
                    }
                  }}
                >
                  Load
                </button>
                <button
                  type="button"
                  className="filter-panel__delete"
                  disabled={
                    !selectionApiAvailable ||
                    selectionBusy ||
                    !loadedSelectionId
                  }
                  aria-label="Delete selected saved filter"
                  onClick={() => {
                    const id = Number(loadedSelectionId);
                    if (Number.isFinite(id)) {
                      onDeleteSelection(id);
                      setLoadedSelectionId("");
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              {selectionApiConnecting && (
                <p className="filter-panel__hint">Connecting…</p>
              )}
            </fieldset>
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
        className={`filter-panel__tab${expanded ? " filter-panel__tab--active" : ""}`}
        onClick={expanded ? requestClose : requestOpen}
        aria-expanded={expanded}
        aria-label={expanded ? "Hide filters" : "Show filters"}
      >
        <IconFilter />
        <span>{tabLabel}</span>
      </button>
      {panel}
    </>
  );
}

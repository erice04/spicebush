import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  getSpreadsheet,
  saveSpreadsheet,
  type SpreadsheetPayload,
} from "../api/spreadsheet";
import { notifyDataUpdated } from "../utils/dataSync";
import {
  exportSpreadsheetCsv,
  exportSpreadsheetXlsx,
} from "../utils/exportSpreadsheet";
import "../components/DataPanel.css";
import "../App.css";

type CellValue = string | number | null;
type RowData = Record<string, CellValue>;

const MEASUREMENT_COLUMNS = [
  "Date",
  "Stem #",
  "Dbase (cm)",
  "DBH (cm)",
  "Height (m)",
  "Sex",
  "Notes",
] as const;

const EDITABLE_COLUMNS = [
  "ID",
  "N (41 20')",
  "W (72 54')",
  ...MEASUREMENT_COLUMNS,
] as const;

const ALL_COLUMNS = [
  "ID",
  "Date",
  "N (41 20')",
  "W (72 54')",
  "Stem #",
  "Dbase (cm)",
  "DBH (cm)",
  "Height (m)",
  "Sex",
  "Notes",
] as const;

function cellToInput(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function inputToCell(value: string): CellValue {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function handleCellArrowNavigate(event: KeyboardEvent<HTMLInputElement>) {
  const { key } = event;
  if (
    key !== "ArrowUp" &&
    key !== "ArrowDown" &&
    key !== "ArrowLeft" &&
    key !== "ArrowRight"
  ) {
    return;
  }

  // Value is already committed via controlled onChange; stop caret movement and move focus.
  event.preventDefault();

  const current = event.currentTarget;
  const table = current.closest("table");
  if (!table) {
    return;
  }

  const row = Number(current.dataset.navRow);
  const col = Number(current.dataset.navCol);
  if (!Number.isFinite(row) || !Number.isFinite(col)) {
    return;
  }

  const inputs = Array.from(
    table.querySelectorAll<HTMLInputElement>(
      "tbody input.data-panel__cell[data-nav-row][data-nav-col]:not(:disabled)",
    ),
  );
  const byPos = new Map<string, HTMLInputElement>();
  let maxRow = 0;
  for (const input of inputs) {
    const r = Number(input.dataset.navRow);
    const c = Number(input.dataset.navCol);
    if (!Number.isFinite(r) || !Number.isFinite(c)) {
      continue;
    }
    byPos.set(`${r}:${c}`, input);
    maxRow = Math.max(maxRow, r);
  }
  const maxCol = EDITABLE_COLUMNS.length - 1;

  const focusAt = (r: number, c: number) => {
    const target = byPos.get(`${r}:${c}`);
    if (!target) {
      return false;
    }
    target.focus();
    target.select();
    return true;
  };

  if (key === "ArrowLeft") {
    for (let c = col - 1; c >= 0; c -= 1) {
      if (focusAt(row, c)) {
        return;
      }
    }
    for (let r = row - 1; r >= 0; r -= 1) {
      for (let c = maxCol; c >= 0; c -= 1) {
        if (focusAt(r, c)) {
          return;
        }
      }
    }
    return;
  }

  if (key === "ArrowRight") {
    for (let c = col + 1; c <= maxCol; c += 1) {
      if (focusAt(row, c)) {
        return;
      }
    }
    for (let r = row + 1; r <= maxRow; r += 1) {
      for (let c = 0; c <= maxCol; c += 1) {
        if (focusAt(r, c)) {
          return;
        }
      }
    }
    return;
  }

  if (key === "ArrowUp") {
    for (let r = row - 1; r >= 0; r -= 1) {
      if (focusAt(r, col)) {
        return;
      }
    }
    return;
  }

  for (let r = row + 1; r <= maxRow; r += 1) {
    if (focusAt(r, col)) {
      return;
    }
  }
}

function cloneRows(rows: RowData[]): RowData[] {
  return rows.map((row) => ({ ...row }));
}

function parsePlantId(value: CellValue): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function currentYm(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function columnContentWidth(column: string, rows: RowData[]): number {
  let maxLen = column.length;
  for (const row of rows) {
    maxLen = Math.max(maxLen, cellToInput(row[column] ?? null).length);
  }
  if (column === "Date") {
    maxLen = Math.max(maxLen, 7); // YYYY-MM
  }
  if (column === "Notes") {
    maxLen = Math.max(maxLen, 12);
  }
  // Room for padded column titles (~1.25rem each side)
  const titlePadCh = 6;
  return Math.min(56, Math.max(4, maxLen + 1 + titlePadCh));
}

interface PlantGroup {
  plantId: number | null;
  key: string;
  nCoord: CellValue;
  wCoord: CellValue;
  rows: { row: RowData; index: number }[];
}

type SortColumn =
  | "ID"
  | "N (41 20')"
  | "W (72 54')"
  | "Date"
  | "Stem #"
  | "Dbase (cm)"
  | "DBH (cm)"
  | "Height (m)"
  | "Sex";

type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

const PLANT_SORT_COLUMNS: SortColumn[] = ["ID", "N (41 20')", "W (72 54')"];
const SORTABLE_COLUMNS: SortColumn[] = [
  ...PLANT_SORT_COLUMNS,
  "Date",
  "Stem #",
  "Dbase (cm)",
  "DBH (cm)",
  "Height (m)",
  "Sex",
];

function isBlankSortValue(value: CellValue): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function stemSortValue(value: CellValue): number {
  if (isBlankSortValue(value)) {
    return Number.NEGATIVE_INFINITY;
  }
  const text = String(value).trim();
  if (text.toUpperCase() === "M") {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function dbhSortValue(value: CellValue): number {
  if (isBlankSortValue(value)) {
    return 0;
  }
  const text = String(value).trim();
  if (text.toUpperCase() === "NA" || text.toUpperCase() === "N/A") {
    return 0;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function numericSortValue(value: CellValue): number {
  if (isBlankSortValue(value)) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function textSortValue(value: CellValue): string {
  if (isBlankSortValue(value)) {
    return "";
  }
  return String(value).trim();
}

function compareSortValues(
  column: SortColumn,
  left: CellValue,
  right: CellValue,
): number {
  if (column === "Stem #") {
    return stemSortValue(left) - stemSortValue(right);
  }
  if (column === "DBH (cm)") {
    return dbhSortValue(left) - dbhSortValue(right);
  }
  if (
    column === "ID" ||
    column === "N (41 20')" ||
    column === "W (72 54')" ||
    column === "Dbase (cm)" ||
    column === "Height (m)"
  ) {
    return numericSortValue(left) - numericSortValue(right);
  }
  // Date, Sex — alphabetical / chronological string order
  return textSortValue(left).localeCompare(textSortValue(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
}

function groupSortValue(group: PlantGroup, column: SortColumn): CellValue {
  if (column === "ID") {
    return group.plantId ?? group.rows[0]?.row.ID ?? null;
  }
  if (column === "N (41 20')") {
    return group.nCoord;
  }
  if (column === "W (72 54')") {
    return group.wCoord;
  }
  return group.rows[0]?.row[column] ?? null;
}

function sortPlantGroups(
  groups: PlantGroup[],
  sort: SortState | null,
): PlantGroup[] {
  const withOrderedRows = groups.map((group) => {
    const measurementRows = [...group.rows];
    if (sort && !PLANT_SORT_COLUMNS.includes(sort.column)) {
      measurementRows.sort((a, b) => {
        const cmp = compareSortValues(
          sort.column,
          a.row[sort.column] ?? null,
          b.row[sort.column] ?? null,
        );
        return sort.direction === "asc" ? cmp : -cmp;
      });
    } else {
      measurementRows.sort((a, b) =>
        cellToInput(a.row.Date).localeCompare(cellToInput(b.row.Date)),
      );
    }
    return { ...group, rows: measurementRows };
  });

  if (!sort) {
    return withOrderedRows.sort((a, b) => {
      if (a.plantId === null && b.plantId === null) {
        return 0;
      }
      if (a.plantId === null) {
        return 1;
      }
      if (b.plantId === null) {
        return -1;
      }
      return a.plantId - b.plantId;
    });
  }

  return withOrderedRows.sort((a, b) => {
    const cmp = compareSortValues(
      sort.column,
      groupSortValue(a, sort.column),
      groupSortValue(b, sort.column),
    );
    if (cmp !== 0) {
      return sort.direction === "asc" ? cmp : -cmp;
    }
    const aId = a.plantId ?? Number.POSITIVE_INFINITY;
    const bId = b.plantId ?? Number.POSITIVE_INFINITY;
    return aId - bId;
  });
}

function isBlankCell(value: CellValue): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

function groupRowsByPlant(rows: RowData[]): PlantGroup[] {
  const groups = new Map<string, PlantGroup>();
  const order: string[] = [];
  let lastPlantKey: string | null = null;

  rows.forEach((row, index) => {
    const plantId = parsePlantId(row.ID);

    // Blank ID = extra measurement under the most recent plant.
    if (plantId === null && lastPlantKey && groups.has(lastPlantKey)) {
      const existing = groups.get(lastPlantKey)!;
      if (existing.plantId !== null) {
        existing.rows.push({ row, index });
        if (existing.nCoord == null && row["N (41 20')"] != null) {
          existing.nCoord = row["N (41 20')"];
        }
        if (existing.wCoord == null && row["W (72 54')"] != null) {
          existing.wCoord = row["W (72 54')"];
        }
        return;
      }
    }

    const key = plantId === null ? `unset-${index}` : String(plantId);
    lastPlantKey = key;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        plantId,
        key,
        nCoord: row["N (41 20')"] ?? null,
        wCoord: row["W (72 54')"] ?? null,
        rows: [{ row, index }],
      });
      order.push(key);
      return;
    }
    existing.rows.push({ row, index });
    if (existing.nCoord == null && row["N (41 20')"] != null) {
      existing.nCoord = row["N (41 20')"];
    }
    if (existing.wCoord == null && row["W (72 54')"] != null) {
      existing.wCoord = row["W (72 54')"];
    }
  });

  return order.map((key) => groups.get(key)!);
}

/** Fill inherited plant ID/GPS onto every measurement row before save. */
function rowsWithInheritedPlantFields(rows: RowData[]): RowData[] {
  const groups = groupRowsByPlant(rows);
  const fillByIndex = new Map<
    number,
    { id: CellValue; n: CellValue; w: CellValue }
  >();

  for (const group of groups) {
    const id = group.plantId ?? group.rows[0]?.row.ID ?? null;
    const n = group.nCoord ?? group.rows[0]?.row["N (41 20')"] ?? null;
    const w = group.wCoord ?? group.rows[0]?.row["W (72 54')"] ?? null;
    for (const { index } of group.rows) {
      fillByIndex.set(index, { id, n, w });
    }
  }

  return rows.map((row, index) => {
    const fill = fillByIndex.get(index);
    if (!fill) {
      return row;
    }
    return {
      ...row,
      ID: isBlankCell(row.ID) ? fill.id : row.ID,
      "N (41 20')": isBlankCell(row["N (41 20')"]) ? fill.n : row["N (41 20')"],
      "W (72 54')": isBlankCell(row["W (72 54')"]) ? fill.w : row["W (72 54')"],
    };
  });
}

function rowMatchesSearch(
  row: RowData,
  query: string,
  plantFields?: { id: CellValue; n: CellValue; w: CellValue },
): boolean {
  const needle = query.trim();
  if (!needle) {
    return true;
  }
  const values: CellValue[] = [
    plantFields?.id ?? row.ID ?? null,
    plantFields?.n ?? row["N (41 20')"] ?? null,
    plantFields?.w ?? row["W (72 54')"] ?? null,
    ...MEASUREMENT_COLUMNS.map((column) => row[column] ?? null),
  ];
  return values.some((value) => cellToInput(value).includes(needle));
}

export default function DataPage() {
  const [columns, setColumns] = useState<string[]>([...ALL_COLUMNS]);
  const [rows, setRows] = useState<RowData[]>([]);
  const [baseline, setBaseline] = useState<SpreadsheetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiAvailable, setApiAvailable] = useState(true);
  const [pendingDeleteIndex, setPendingDeleteIndex] = useState<number | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadMenuRef = useRef<HTMLDivElement | null>(null);
  const dirtyRef = useRef(false);

  const groups = useMemo(
    () => sortPlantGroups(groupRowsByPlant(rows), sort),
    [rows, sort],
  );

  const visibleGroups = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return groups;
    }
    return groups
      .map((group) => {
        const plantFields = {
          id: group.plantId ?? group.rows[0]?.row.ID ?? null,
          n: group.nCoord,
          w: group.wCoord,
        };
        const matchedRows = group.rows.filter(({ row }) =>
          rowMatchesSearch(row, query, plantFields),
        );
        if (matchedRows.length === 0) {
          return null;
        }
        return { ...group, rows: matchedRows };
      })
      .filter((group): group is PlantGroup => group !== null);
  }, [groups, searchQuery]);

  const dirty =
    baseline !== null &&
    (rows.length !== baseline.rows.length ||
      JSON.stringify(rows) !== JSON.stringify(baseline.rows));

  dirtyRef.current = dirty;

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!downloadOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (
        downloadMenuRef.current &&
        !downloadMenuRef.current.contains(event.target as Node)
      ) {
        setDownloadOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [downloadOpen]);

  const confirmDiscardUnsaved = () => {
    if (!dirty) {
      return true;
    }
    return window.confirm(
      "You have unsaved changes. Discard them and continue?",
    );
  };

  const handleReload = () => {
    if (!confirmDiscardUnsaved()) {
      return;
    }
    void loadSpreadsheet();
  };

  const handleDownload = (format: "csv" | "xlsx") => {
    setDownloadOpen(false);
    if (columns.length === 0) {
      return;
    }
    if (format === "csv") {
      exportSpreadsheetCsv(columns, rows);
      return;
    }
    exportSpreadsheetXlsx(columns, rows);
  };

  const toggleSort = (column: SortColumn) => {
    setSort((current) => {
      if (!current || current.column !== column) {
        return { column, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { column, direction: "desc" };
      }
      return null;
    });
  };

  const sortIndicator = (column: SortColumn) => {
    if (!sort || sort.column !== column) {
      return "⇅";
    }
    return sort.direction === "asc" ? "↑" : "↓";
  };

  const renderSortHeader = (column: SortColumn, label: string) => (
    <button
      type="button"
      className={
        sort?.column === column
          ? "data-page__sort-btn data-page__sort-btn--active"
          : "data-page__sort-btn"
      }
      onClick={() => toggleSort(column)}
      aria-label={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="data-page__sort-icon" aria-hidden="true">
        {sortIndicator(column)}
      </span>
    </button>
  );

  const columnWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    for (const column of MEASUREMENT_COLUMNS) {
      widths[column] = columnContentWidth(column, rows);
    }
    widths.ID = columnContentWidth("ID", rows);
    widths["N (41 20')"] = Math.max(8, columnContentWidth("N (41 20')", rows));
    widths["W (72 54')"] = Math.max(8, columnContentWidth("W (72 54')", rows));
    return widths;
  }, [rows]);

  const loadSpreadsheet = useCallback(async () => {
    setLoading(true);
    setError(null);

    const maxAttempts = 24;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const payload = await getSpreadsheet();
        setColumns(
          payload.columns.length > 0 ? payload.columns : [...ALL_COLUMNS],
        );
        setRows(cloneRows(payload.rows));
        setBaseline(payload);
        setApiAvailable(true);
        setLoading(false);
        return;
      } catch (err) {
        if (attempt >= maxAttempts) {
          setApiAvailable(false);
          setError(
            err instanceof Error
              ? err.message
              : "Could not load spreadsheet (is the API running?)",
          );
          setLoading(false);
          return;
        }
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.min(800 * attempt, 4000)),
        );
      }
    }
  }, []);

  useEffect(() => {
    void loadSpreadsheet();
  }, [loadSpreadsheet]);

  const updateCell = (rowIndex: number, column: string, value: string) => {
    setRows((current) =>
      current.map((row, index) =>
        index === rowIndex ? { ...row, [column]: inputToCell(value) } : row,
      ),
    );
  };

  const updatePlantField = (
    plantId: number | null,
    groupKey: string,
    column: "ID" | "N (41 20')" | "W (72 54')",
    value: string,
  ) => {
    const nextValue = inputToCell(value);
    setRows((current) => {
      const group =
        groupRowsByPlant(current).find((entry) => entry.key === groupKey) ??
        groupRowsByPlant(current).find((entry) => entry.plantId === plantId);
      if (!group) {
        return current;
      }
      // Plant identity lives on the first row; extra measurements inherit on save.
      const headIndex = group.rows[0]?.index;
      if (headIndex === undefined) {
        return current;
      }
      return current.map((row, index) =>
        index === headIndex ? { ...row, [column]: nextValue } : row,
      );
    });
  };

  const addPlant = () => {
    const used = new Set(
      rows
        .map((row) => parsePlantId(row.ID))
        .filter((id): id is number => id !== null),
    );
    let nextId = 1;
    while (used.has(nextId)) {
      nextId += 1;
    }
    const blank: RowData = {
      ID: nextId,
      Date: currentYm(),
      "N (41 20')": null,
      "W (72 54')": null,
      "Stem #": null,
      "Dbase (cm)": null,
      "DBH (cm)": null,
      "Height (m)": null,
      Sex: null,
      Notes: null,
    };
    setRows((current) => [...current, blank]);
  };

  const addMeasurement = (group: PlantGroup) => {
    const blank: RowData = {
      ID: null,
      Date: currentYm(),
      "N (41 20')": null,
      "W (72 54')": null,
      "Stem #": null,
      "Dbase (cm)": null,
      "DBH (cm)": null,
      "Height (m)": null,
      Sex: null,
      Notes: null,
    };
    setRows((current) => {
      const latest = groupRowsByPlant(current).find(
        (entry) => entry.key === group.key,
      );
      const lastIndex =
        latest?.rows[latest.rows.length - 1]?.index ??
        group.rows[group.rows.length - 1]?.index;
      if (lastIndex === undefined) {
        return [...current, blank];
      }
      const next = [...current];
      next.splice(lastIndex + 1, 0, blank);
      return next;
    });
  };

  const removeRow = (rowIndex: number) => {
    setPendingDeleteIndex(rowIndex);
  };

  const confirmDeleteRow = () => {
    if (pendingDeleteIndex === null) {
      return;
    }
    const index = pendingDeleteIndex;
    setPendingDeleteIndex(null);
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  };

  const cancelDeleteRow = () => {
    setPendingDeleteIndex(null);
  };

  const pendingDeleteLabel = (() => {
    if (pendingDeleteIndex === null) {
      return null;
    }
    const row = rows[pendingDeleteIndex];
    if (!row) {
      return `row ${pendingDeleteIndex + 1}`;
    }
    const idPart =
      row.ID != null ? `ID ${row.ID}` : `row ${pendingDeleteIndex + 1}`;
    const datePart =
      row.Date != null && String(row.Date).trim() !== ""
        ? ` (${row.Date})`
        : "";
    return `${idPart}${datePart}`;
  })();

  const handleSave = async () => {
    if (!apiAvailable || columns.length === 0) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payloadRows = rowsWithInheritedPlantFields(rows);
      await saveSpreadsheet({ columns, rows: payloadRows });
      setRows(cloneRows(payloadRows));
      setBaseline({ columns, rows: cloneRows(payloadRows) });
      notifyDataUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const plantCount = groups.filter((group) => group.plantId !== null).length;

  return (
    <div className="app-shell">
      <div className="data-page" aria-label="Spreadsheet data editor">
        <div className="data-page__header">
          <div>
            <h1>Field data</h1>
            <p className="data-page__count">
              {loading ? (
                <span className="data-page__waking" aria-label="Loading">
                  <span className="ui-spinner" aria-hidden="true" />
                </span>
              ) : (
                `${plantCount} plant${plantCount === 1 ? "" : "s"} · ${rows.length} measurement${rows.length === 1 ? "" : "s"}`
              )}
              {dirty ? " · unsaved changes" : ""}
            </p>
          </div>
          <div className="data-page__header-actions">
            <input
              className="data-page__filter"
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search…"
              aria-label="Search all fields"
              disabled={loading}
            />
            <div className="data-page__download" ref={downloadMenuRef}>
              <button
                type="button"
                className="data-panel__btn"
                onClick={() => setDownloadOpen((open) => !open)}
                disabled={loading || rows.length === 0}
                aria-expanded={downloadOpen}
                aria-haspopup="menu"
              >
                Download
              </button>
              {downloadOpen && (
                <div className="data-page__download-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleDownload("csv")}
                  >
                    CSV
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => handleDownload("xlsx")}
                  >
                    Excel (.xlsx)
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              className="data-panel__btn"
              onClick={handleReload}
              disabled={loading || saving}
            >
              Reload
            </button>
            <button
              type="button"
              className="data-panel__btn"
              onClick={addPlant}
              disabled={loading || saving}
            >
              Add row
            </button>
            <button
              type="button"
              className="data-panel__btn data-panel__btn--primary"
              onClick={() => void handleSave()}
              disabled={loading || saving || !apiAvailable || !dirty}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {error && <p className="data-panel__error">{error}</p>}

        {pendingDeleteIndex !== null && pendingDeleteLabel && (
          <div
            className="data-page__confirm"
            role="alertdialog"
            aria-modal="true"
          >
            <p>
              Are you sure you want to delete{" "}
              <strong>{pendingDeleteLabel}</strong>?
            </p>
            <div className="data-page__confirm-actions">
              <button
                type="button"
                className="data-panel__btn"
                onClick={cancelDeleteRow}
              >
                Cancel
              </button>
              <button
                type="button"
                className="data-panel__btn data-page__confirm-delete"
                onClick={confirmDeleteRow}
              >
                Delete
              </button>
            </div>
          </div>
        )}

        <div className="data-page__table-wrap">
          {loading ? (
            <p className="data-panel__empty data-page__loading-panel" aria-label="Loading">
              <span className="ui-spinner" aria-hidden="true" />
            </p>
          ) : visibleGroups.length > 0 ? (
            <table className="data-panel__table data-panel__table--fit data-page__sheet">
              <thead>
                <tr>
                  <th style={{ width: `${columnWidths.ID}ch` }}>
                    {renderSortHeader("ID", "ID")}
                  </th>
                  <th style={{ width: `${columnWidths["N (41 20')"]}ch` }}>
                    {renderSortHeader("N (41 20')", "N (41 20')")}
                  </th>
                  <th style={{ width: `${columnWidths["W (72 54')"]}ch` }}>
                    {renderSortHeader("W (72 54')", "W (72 54')")}
                  </th>
                  {MEASUREMENT_COLUMNS.map((column) => (
                    <th
                      key={column}
                      className={
                        column === "Notes" ? "data-plant__notes-col" : undefined
                      }
                      style={
                        column === "Notes"
                          ? undefined
                          : { width: `${columnWidths[column]}ch` }
                      }
                    >
                      {column === "Notes" ||
                      !SORTABLE_COLUMNS.includes(column as SortColumn) ? (
                        column
                      ) : (
                        renderSortHeader(column as SortColumn, column)
                      )}
                    </th>
                  ))}
                  <th
                    className="data-panel__actions-col"
                    aria-label="Row actions"
                  />
                  <th className="data-plant__add-col" aria-label="Add measurement" />
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let navRow = 0;
                  return visibleGroups.map((group) => {
                    const [first, ...rest] = group.rows;
                    const mainNavRow = navRow;
                    navRow += 1;
                    return (
                      <Fragment key={group.key}>
                        <tr className="data-plant__main-row">
                          <td style={{ width: `${columnWidths.ID}ch` }}>
                            <input
                              className="data-panel__cell"
                              data-nav-row={mainNavRow}
                              data-nav-col={0}
                              value={cellToInput(
                                group.plantId ?? first?.row.ID ?? null,
                              )}
                              size={columnWidths.ID}
                              style={{ width: `${columnWidths.ID}ch` }}
                              onChange={(event) =>
                                updatePlantField(
                                  group.plantId,
                                  group.key,
                                  "ID",
                                  event.target.value,
                                )
                              }
                              onKeyDown={handleCellArrowNavigate}
                              disabled={saving}
                              aria-label={`Plant ID for group ${group.key}`}
                            />
                          </td>
                          <td
                            style={{
                              width: `${columnWidths["N (41 20')"]}ch`,
                            }}
                          >
                            <input
                              className="data-panel__cell"
                              data-nav-row={mainNavRow}
                              data-nav-col={1}
                              value={cellToInput(group.nCoord)}
                              size={columnWidths["N (41 20')"]}
                              style={{
                                width: `${columnWidths["N (41 20')"]}ch`,
                              }}
                              onChange={(event) =>
                                updatePlantField(
                                  group.plantId,
                                  group.key,
                                  "N (41 20')",
                                  event.target.value,
                                )
                              }
                              onKeyDown={handleCellArrowNavigate}
                              disabled={saving}
                              aria-label={`N coordinate for ID ${group.plantId ?? "new"}`}
                            />
                          </td>
                          <td
                            style={{
                              width: `${columnWidths["W (72 54')"]}ch`,
                            }}
                          >
                            <input
                              className="data-panel__cell"
                              data-nav-row={mainNavRow}
                              data-nav-col={2}
                              value={cellToInput(group.wCoord)}
                              size={columnWidths["W (72 54')"]}
                              style={{
                                width: `${columnWidths["W (72 54')"]}ch`,
                              }}
                              onChange={(event) =>
                                updatePlantField(
                                  group.plantId,
                                  group.key,
                                  "W (72 54')",
                                  event.target.value,
                                )
                              }
                              onKeyDown={handleCellArrowNavigate}
                              disabled={saving}
                              aria-label={`W coordinate for ID ${group.plantId ?? "new"}`}
                            />
                          </td>
                          {first &&
                            MEASUREMENT_COLUMNS.map((column, colOffset) => (
                              <td
                                key={column}
                                className={
                                  column === "Notes"
                                    ? "data-plant__notes-col"
                                    : undefined
                                }
                                style={
                                  column === "Notes"
                                    ? undefined
                                    : { width: `${columnWidths[column]}ch` }
                                }
                              >
                                <input
                                  className="data-panel__cell"
                                  data-nav-row={mainNavRow}
                                  data-nav-col={3 + colOffset}
                                  value={cellToInput(
                                    first.row[column] ?? null,
                                  )}
                                  {...(column === "Notes"
                                    ? {}
                                    : {
                                        size: columnWidths[column],
                                        style: {
                                          width: `${columnWidths[column]}ch`,
                                        },
                                      })}
                                  onChange={(event) =>
                                    updateCell(
                                      first.index,
                                      column,
                                      event.target.value,
                                    )
                                  }
                                  onKeyDown={handleCellArrowNavigate}
                                  disabled={saving}
                                  aria-label={`${column}, ID ${group.plantId ?? "new"}, row ${first.index + 1}`}
                                />
                              </td>
                            ))}
                          <td className="data-panel__actions-col data-plant__actions-cell">
                            {first && (
                              <button
                                type="button"
                                className="data-panel__row-delete"
                                onClick={() => removeRow(first.index)}
                                disabled={saving}
                                aria-label={`Delete measurement row ${first.index + 1}`}
                              >
                                ×
                              </button>
                            )}
                          </td>
                          <td className="data-plant__add-col">
                            <button
                              type="button"
                              className="data-panel__btn data-plant__add-btn"
                              onClick={() => addMeasurement(group)}
                              disabled={saving || group.plantId === null}
                            >
                              Add measurement
                            </button>
                          </td>
                        </tr>
                        {rest.map(({ row, index }) => {
                          const subNavRow = navRow;
                          navRow += 1;
                          return (
                            <tr
                              key={`m-${index}`}
                              className="data-plant__sub-row"
                            >
                              <td
                                colSpan={3}
                                className="data-plant__sub-spacer"
                              />
                              {MEASUREMENT_COLUMNS.map((column, colOffset) => (
                                <td
                                  key={column}
                                  className={
                                    column === "Notes"
                                      ? "data-plant__notes-col"
                                      : undefined
                                  }
                                  style={
                                    column === "Notes"
                                      ? undefined
                                      : {
                                          width: `${columnWidths[column]}ch`,
                                        }
                                  }
                                >
                                  <input
                                    className="data-panel__cell"
                                    data-nav-row={subNavRow}
                                    data-nav-col={3 + colOffset}
                                    value={cellToInput(row[column] ?? null)}
                                    {...(column === "Notes"
                                      ? {}
                                      : {
                                          size: columnWidths[column],
                                          style: {
                                            width: `${columnWidths[column]}ch`,
                                          },
                                        })}
                                    onChange={(event) =>
                                      updateCell(
                                        index,
                                        column,
                                        event.target.value,
                                      )
                                    }
                                    onKeyDown={handleCellArrowNavigate}
                                    disabled={saving}
                                    aria-label={`${column}, ID ${group.plantId ?? "new"}, row ${index + 1}`}
                                  />
                                </td>
                              ))}
                              <td className="data-panel__actions-col">
                                <button
                                  type="button"
                                  className="data-panel__row-delete"
                                  onClick={() => removeRow(index)}
                                  disabled={saving}
                                  aria-label={`Delete measurement row ${index + 1}`}
                                >
                                  ×
                                </button>
                              </td>
                              <td className="data-plant__add-col" />
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  });
                })()}
              </tbody>
            </table>
          ) : (
            !loading && (
              <p className="data-panel__empty">
                {apiAvailable
                  ? searchQuery.trim()
                    ? "No rows match that search."
                    : "No plants loaded."
                  : "API unavailable. The free-tier server may be asleep — try Reload."}
              </p>
            )
          )}
        </div>
      </div>
    </div>
  );
}

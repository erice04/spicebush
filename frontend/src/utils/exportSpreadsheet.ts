import * as XLSX from "xlsx";

type CellValue = string | number | null;
type RowData = Record<string, CellValue>;

function cellToExport(value: CellValue): string | number {
  if (value === null || value === undefined) {
    return "";
  }
  return value;
}

function buildSheet(columns: string[], rows: RowData[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [
    columns,
    ...rows.map((row) => columns.map((column) => cellToExport(row[column] ?? null))),
  ];
  return XLSX.utils.aoa_to_sheet(aoa);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function exportSpreadsheetCsv(columns: string[], rows: RowData[]) {
  const sheet = buildSheet(columns, rows);
  const csv = XLSX.utils.sheet_to_csv(sheet);
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `spicebush-field-data-${stamp()}.csv`,
  );
}

export function exportSpreadsheetXlsx(columns: string[], rows: RowData[]) {
  const sheet = buildSheet(columns, rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Field data");
  const buffer = XLSX.write(book, { bookType: "xlsx", type: "array" });
  downloadBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    `spicebush-field-data-${stamp()}.xlsx`,
  );
}

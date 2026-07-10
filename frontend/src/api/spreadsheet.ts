import type { AnalysisResponse } from "../types/analysis";
import type { TreeFeatureCollection } from "../types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface SpreadsheetPayload {
  columns: string[];
  rows: Record<string, string | number | null>[];
}

export interface SpreadsheetSaveResponse {
  trees: TreeFeatureCollection;
  analysis: AnalysisResponse;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        detail?: string | { msg: string }[];
      };
      if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (Array.isArray(body.detail)) {
        detail = body.detail.map((item) => item.msg).join(", ");
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export function getSpreadsheet(): Promise<SpreadsheetPayload> {
  return apiFetch("/api/data/spreadsheet");
}

export function getTrees(): Promise<TreeFeatureCollection> {
  return apiFetch("/api/data/trees");
}

export function saveSpreadsheet(
  payload: SpreadsheetPayload,
): Promise<SpreadsheetSaveResponse> {
  return apiFetch("/api/data/spreadsheet", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

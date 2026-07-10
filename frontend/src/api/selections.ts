import type { TreeFilters } from "../types";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export interface SavedSelectionSummary {
  id: number;
  name: string;
  created_at: string;
}

export interface SavedSelectionRead extends SavedSelectionSummary {
  attribute_filters: TreeFilters;
  region_polygon: GeoJSON.Polygon | null;
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

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function listSavedSelections(): Promise<SavedSelectionSummary[]> {
  return apiFetch("/api/selections");
}

export function getSavedSelection(id: number): Promise<SavedSelectionRead> {
  return apiFetch(`/api/selections/${id}`);
}

export function saveSelection(payload: {
  name: string;
  attribute_filters: TreeFilters;
  region_polygon: GeoJSON.Polygon | null;
}): Promise<SavedSelectionRead> {
  return apiFetch("/api/selections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteSavedSelection(id: number): Promise<void> {
  return apiFetch(`/api/selections/${id}`, { method: "DELETE" });
}

import bundledAnalysis from "../data/analysis.json";
import type { AnalysisResponse } from "../types/analysis";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function getBundledAnalysis(): AnalysisResponse {
  return bundledAnalysis as AnalysisResponse;
}

function isCompleteAnalysis(payload: unknown): payload is AnalysisResponse {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const analysis = payload as AnalysisResponse;
  return Boolean(
    analysis.pca?.points &&
      analysis.pca?.loadings &&
      analysis.pca?.correlation?.matrix &&
      analysis.classification,
  );
}

export async function getAnalysis(): Promise<AnalysisResponse> {
  const bundled = getBundledAnalysis();

  try {
    const apiResponse = await fetch(`${API_BASE}/api/analysis`, {
      cache: "no-store",
    });
    if (apiResponse.ok) {
      const payload: unknown = await apiResponse.json();
      if (isCompleteAnalysis(payload)) {
        return payload;
      }
    }
  } catch {
    // Fall through.
  }

  try {
    const staticResponse = await fetch("/data/analysis.json", {
      cache: "no-store",
    });
    if (staticResponse.ok) {
      const payload: unknown = await staticResponse.json();
      if (isCompleteAnalysis(payload)) {
        return payload;
      }
    }
  } catch {
    // Fall through.
  }

  return bundled;
}

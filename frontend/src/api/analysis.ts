import type { AnalysisResponse } from "../types/analysis";

export async function getAnalysis(): Promise<AnalysisResponse> {
  try {
    const apiResponse = await fetch("/api/analysis");
    if (apiResponse.ok) {
      return apiResponse.json() as Promise<AnalysisResponse>;
    }
  } catch {
    // Backend unavailable; fall back to static analysis file.
  }

  const staticResponse = await fetch("/data/analysis.json");
  if (!staticResponse.ok) {
    throw new Error(`Failed to load analysis (${staticResponse.status})`);
  }

  return staticResponse.json() as Promise<AnalysisResponse>;
}

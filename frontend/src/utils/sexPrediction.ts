import type { PredictedSexCategory } from "../types";

export const UNCERTAIN_PROB_LOW = 0.3;
export const UNCERTAIN_PROB_HIGH = 0.7;

export type { PredictedSexCategory };

export function isUncertainPrediction(
  probabilityFemale: number | null | undefined,
): boolean {
  if (probabilityFemale === null || probabilityFemale === undefined) {
    return false;
  }
  return (
    probabilityFemale >= UNCERTAIN_PROB_LOW &&
    probabilityFemale <= UNCERTAIN_PROB_HIGH
  );
}

/** Category for model predictions on unlabeled plants; null if known sex or no probability. */
export function getPredictedSexCategory(
  sexKnown: boolean,
  probabilityFemale: number | null | undefined,
): PredictedSexCategory | null {
  if (sexKnown || probabilityFemale === null || probabilityFemale === undefined) {
    return null;
  }
  if (isUncertainPrediction(probabilityFemale)) {
    return "uncertain";
  }
  return probabilityFemale >= 0.5 ? "F" : "M";
}

import type {
  TreeFeature,
  TreeFilters,
  DataBounds,
  SexCategory,
  PredictedSexCategory,
  PredictedSexGroup,
} from "../types";
import { getPredictedSexCategory } from "./sexPrediction";

export const SEX_OPTIONS: { value: SexCategory; label: string }[] = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "J", label: "Juvenile" },
  { value: "U", label: "Unknown" },
];

export const PREDICTED_SEX_GROUPS: PredictedSexGroup[] = ["J", "U"];

export const PREDICTED_SEX_OPTIONS: {
  value: PredictedSexCategory;
  label: string;
}[] = [
  { value: "M", label: "M" },
  { value: "F", label: "F" },
  { value: "uncertain", label: "?" },
];

export type SexPredictionById = Map<
  number,
  { sexKnown: boolean; probabilityFemale: number | null }
>;

export function createDefaultPredictedSexFlags(): Record<
  PredictedSexCategory,
  boolean
> {
  return { M: true, F: true, uncertain: true };
}

export function createDefaultPredictedSex(): TreeFilters["predictedSex"] {
  return {
    J: createDefaultPredictedSexFlags(),
    U: createDefaultPredictedSexFlags(),
  };
}

function normalizePredictedSexFlags(
  predicted?: Partial<Record<PredictedSexCategory, boolean>> | null,
): Record<PredictedSexCategory, boolean> {
  const defaults = createDefaultPredictedSexFlags();
  if (!predicted) {
    return defaults;
  }
  return {
    M: predicted.M ?? defaults.M,
    F: predicted.F ?? defaults.F,
    uncertain: predicted.uncertain ?? defaults.uncertain,
  };
}

function isGroupedPredictedSex(
  predicted: unknown,
): predicted is TreeFilters["predictedSex"] {
  if (!predicted || typeof predicted !== "object") {
    return false;
  }
  return "J" in predicted || "U" in predicted;
}

export function normalizePredictedSex(
  predicted?: TreeFilters["predictedSex"] | Partial<Record<PredictedSexCategory, boolean>> | null,
): TreeFilters["predictedSex"] {
  const defaults = createDefaultPredictedSex();
  if (!predicted) {
    return defaults;
  }

  if (isGroupedPredictedSex(predicted)) {
    return {
      J: normalizePredictedSexFlags(predicted.J),
      U: normalizePredictedSexFlags(predicted.U),
    };
  }

  // Legacy flat { M, F, uncertain } — apply to both groups.
  const flags = normalizePredictedSexFlags(predicted);
  return { J: { ...flags }, U: { ...flags } };
}

export const SLIDER_BOUNDS: DataBounds = {
  stemCount: { min: 1, max: 20 },
  baseDiameter: { min: 0, max: 20 },
  dbh: { min: 0, max: 10 },
  height: { min: 0, max: 10 },
};

function parseStemCount(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundUpToNearest5(value: number): number {
  if (value <= 0) {
    return 0;
  }
  return Math.ceil(value / 5) * 5;
}

function maxBoundFromData(maxValue: number, fallbackMax: number, min: number): number {
  if (!(maxValue > 0)) {
    return fallbackMax;
  }
  return Math.max(min, roundUpToNearest5(maxValue));
}

export function computeDataBounds(trees: TreeFeature[] = []): DataBounds {
  if (trees.length === 0) {
    return {
      stemCount: { ...SLIDER_BOUNDS.stemCount },
      baseDiameter: { ...SLIDER_BOUNDS.baseDiameter },
      dbh: { ...SLIDER_BOUNDS.dbh },
      height: { ...SLIDER_BOUNDS.height },
    };
  }

  let maxBase = 0;
  let maxStem = 0;
  let maxDbh = 0;
  let maxHeight = 0;

  for (const tree of trees) {
    const { properties } = tree;
    if (
      properties.base_diameter_cm !== null &&
      Number.isFinite(properties.base_diameter_cm)
    ) {
      maxBase = Math.max(maxBase, properties.base_diameter_cm);
    }
    const stemCount = parseStemCount(properties.stem_count);
    if (stemCount !== null) {
      maxStem = Math.max(maxStem, stemCount);
    }
    if (properties.dbh_cm !== null && Number.isFinite(properties.dbh_cm)) {
      maxDbh = Math.max(maxDbh, properties.dbh_cm);
    }
    if (properties.height_m !== null && Number.isFinite(properties.height_m)) {
      maxHeight = Math.max(maxHeight, properties.height_m);
    }
  }

  return {
    stemCount: {
      min: SLIDER_BOUNDS.stemCount.min,
      max: maxBoundFromData(
        maxStem,
        SLIDER_BOUNDS.stemCount.max,
        SLIDER_BOUNDS.stemCount.min,
      ),
    },
    baseDiameter: {
      min: SLIDER_BOUNDS.baseDiameter.min,
      max: maxBoundFromData(
        maxBase,
        SLIDER_BOUNDS.baseDiameter.max,
        SLIDER_BOUNDS.baseDiameter.min,
      ),
    },
    dbh: {
      min: SLIDER_BOUNDS.dbh.min,
      max: maxBoundFromData(maxDbh, SLIDER_BOUNDS.dbh.max, SLIDER_BOUNDS.dbh.min),
    },
    height: {
      min: SLIDER_BOUNDS.height.min,
      max: maxBoundFromData(
        maxHeight,
        SLIDER_BOUNDS.height.max,
        SLIDER_BOUNDS.height.min,
      ),
    },
  };
}

function clampRange(
  range: { min: number; max: number },
  bounds: { min: number; max: number },
): { min: number; max: number } {
  const min = Math.max(bounds.min, Math.min(range.min, bounds.max));
  const max = Math.min(bounds.max, Math.max(range.max, bounds.min));
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

export function clampFiltersToBounds(
  filters: TreeFilters,
  bounds: DataBounds = SLIDER_BOUNDS,
): TreeFilters {
  return {
    ...filters,
    predictedSex: normalizePredictedSex(filters.predictedSex),
    baseDiameter: clampRange(filters.baseDiameter, bounds.baseDiameter),
    stemCount: clampRange(filters.stemCount, bounds.stemCount),
    dbh: clampRange(filters.dbh, bounds.dbh),
    height: clampRange(filters.height, bounds.height),
  };
}

export function createDefaultFilters(bounds: DataBounds = SLIDER_BOUNDS): TreeFilters {
  return {
    sex: { M: true, F: true, J: true, U: true },
    predictedSex: createDefaultPredictedSex(),
    baseDiameter: { ...bounds.baseDiameter },
    stemCount: { ...bounds.stemCount },
    dbh: { ...bounds.dbh },
    height: { ...bounds.height },
  };
}

function dbhFilterPasses(
  dbh: number | null,
  filterRange: { min: number; max: number },
): boolean {
  if (dbh !== null && Number.isFinite(dbh)) {
    return withinRange(dbh, filterRange);
  }

  const epsilon = 0.001;
  return filterRange.min <= epsilon;
}

function withinRange(value: number, range: { min: number; max: number }): boolean {
  return value >= range.min && value <= range.max;
}

function numericFilterPasses(
  value: number | null,
  filterRange: { min: number; max: number },
  boundRange: DataBounds[keyof DataBounds] | undefined,
): boolean {
  if (value !== null && Number.isFinite(value)) {
    return withinRange(value, filterRange);
  }

  if (!boundRange) {
    return false;
  }

  const epsilon = 0.001;
  return (
    filterRange.min <= boundRange.min + epsilon &&
    filterRange.max >= boundRange.max - epsilon
  );
}

function isPredictedSexGroup(sex: SexCategory): sex is PredictedSexGroup {
  return sex === "J" || sex === "U";
}

export function filterTrees(
  trees: TreeFeature[],
  filters: TreeFilters,
  bounds?: DataBounds,
  sexPredictions?: SexPredictionById,
): TreeFeature[] {
  const predictedSex = normalizePredictedSex(filters.predictedSex);

  return trees.filter((tree) => {
    const { properties } = tree;
    const sex = (properties.sex ?? "U") as SexCategory;

    if (!filters.sex[sex]) {
      return false;
    }

    if (sexPredictions && isPredictedSexGroup(sex)) {
      const prediction = sexPredictions.get(properties.id);
      if (prediction) {
        const category = getPredictedSexCategory(
          prediction.sexKnown,
          prediction.probabilityFemale,
        );
        if (category !== null && !predictedSex[sex][category]) {
          return false;
        }
      }
    }

    if (!numericFilterPasses(properties.base_diameter_cm, filters.baseDiameter, bounds?.baseDiameter)) {
      return false;
    }

    const stemCount = parseStemCount(properties.stem_count);
    if (!numericFilterPasses(stemCount, filters.stemCount, bounds?.stemCount)) {
      return false;
    }

    if (!dbhFilterPasses(properties.dbh_cm, filters.dbh)) {
      return false;
    }

    if (!numericFilterPasses(properties.height_m, filters.height, bounds?.height)) {
      return false;
    }

    return true;
  });
}

export function countActiveFilters(
  filters: TreeFilters,
  bounds: DataBounds,
): number {
  let count = 0;
  const epsilon = 0.001;

  if (!SEX_OPTIONS.every(({ value }) => filters.sex[value])) {
    count += 1;
  }

  const predictedSex = normalizePredictedSex(filters.predictedSex);
  const predictedActive = PREDICTED_SEX_GROUPS.some((group) => {
    if (!filters.sex[group]) {
      return false;
    }
    return !PREDICTED_SEX_OPTIONS.every(
      ({ value }) => predictedSex[group][value],
    );
  });
  if (predictedActive) {
    count += 1;
  }

  const rangeKeys = [
    "baseDiameter",
    "stemCount",
    "dbh",
    "height",
  ] as const;

  for (const key of rangeKeys) {
    const filterRange = filters[key];
    const boundRange = bounds[key];
    if (
      filterRange.min > boundRange.min + epsilon ||
      filterRange.max < boundRange.max - epsilon
    ) {
      count += 1;
    }
  }

  return count;
}

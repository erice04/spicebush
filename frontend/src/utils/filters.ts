import type { TreeFeature, TreeFilters, DataBounds, SexCategory } from "../types";

export const SEX_OPTIONS: { value: SexCategory; label: string }[] = [
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "J", label: "Juvenile" },
  { value: "U", label: "Unknown" },
];

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

export function computeDataBounds(_trees?: TreeFeature[]): DataBounds {
  return SLIDER_BOUNDS;
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
    baseDiameter: clampRange(filters.baseDiameter, bounds.baseDiameter),
    stemCount: clampRange(filters.stemCount, bounds.stemCount),
    dbh: clampRange(filters.dbh, bounds.dbh),
    height: clampRange(filters.height, bounds.height),
  };
}

export function createDefaultFilters(bounds: DataBounds = SLIDER_BOUNDS): TreeFilters {
  return {
    sex: { M: true, F: true, J: true, U: true },
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

export function filterTrees(
  trees: TreeFeature[],
  filters: TreeFilters,
  bounds?: DataBounds,
): TreeFeature[] {
  return trees.filter((tree) => {
    const { properties } = tree;
    const sex = (properties.sex ?? "U") as SexCategory;

    if (!filters.sex[sex]) {
      return false;
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

export interface TreeMeasurement {
  observed_ym: string;
  stem_count: string;
  base_diameter_cm: number | null;
  dbh_cm: number | null;
  height_m: number | null;
  sex: string | null;
  notes: string | null;
}

export interface TreeGrowthRates {
  dbh_cm_per_month: number | null;
  base_diameter_cm_per_month: number | null;
  stem_count_per_month: number | null;
  height_m_per_month: number | null;
}

export interface TreeProperties {
  id: number;
  stem_count: string;
  base_diameter_cm: number | null;
  dbh_cm: number | null;
  height_m: number | null;
  sex: string | null;
  notes: string | null;
  observed_ym?: string;
  measurements?: TreeMeasurement[];
  growth?: TreeGrowthRates;
}

export interface TreeFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: TreeProperties;
}

export interface TreeFeatureCollection {
  type: "FeatureCollection";
  features: TreeFeature[];
}

export type BasemapStyle = "terrain" | "aerial" | "satellite";

export type SexCategory = "M" | "F" | "J" | "U";

export type PredictedSexCategory = "M" | "F" | "uncertain";

export type PredictedSexGroup = "J" | "U";

export interface NumericRange {
  min: number;
  max: number;
}

export interface TreeFilters {
  sex: Record<SexCategory, boolean>;
  predictedSex: Record<
    PredictedSexGroup,
    Record<PredictedSexCategory, boolean>
  >;
  baseDiameter: NumericRange;
  stemCount: NumericRange;
  dbh: NumericRange;
  height: NumericRange;
}

export interface DataBounds {
  baseDiameter: NumericRange;
  stemCount: NumericRange;
  dbh: NumericRange;
  height: NumericRange;
}

export interface SelectionState {
  attributeFilters: TreeFilters;
  regionPolygon: GeoJSON.Polygon | null;
  manualExcluded: Set<number>;
}

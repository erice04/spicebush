export interface TreeProperties {
  id: number;
  stem_count: string;
  base_diameter_cm: number | null;
  dbh_cm: number | null;
  height_m: number | null;
  sex: string | null;
  notes: string | null;
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

export type BasemapStyle = "satellite" | "terrain";

export type SexCategory = "M" | "F" | "J" | "U";

export interface NumericRange {
  min: number;
  max: number;
}

export interface TreeFilters {
  sex: Record<SexCategory, boolean>;
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

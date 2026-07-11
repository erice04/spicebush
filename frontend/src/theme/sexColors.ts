import type { SexCategory } from "../types";

/** Shared sex palette for map markers, PCA points, legends, and filters. */
export const SEX_COLORS = {
  male: "#4A7A9E",
  female: "#C97B8C",
  /** Juvenile — muted warm khaki, distinct from adult sexes and unknown. */
  juvenile: "#A8926B",
  /** Unknown or unlabeled — stays visually quiet. */
  unknown: "#8A968A",
  /** PCA uncertain prediction (P≈0.5); distinct from U/J. */
  uncertain: "#8B4A4A",
} as const;

/** Light stroke so markers read clearly on green basemaps. */
export const SEX_MARKER_STROKE = "#F4F7F0";

export function sexFillColor(sex: string | null | undefined): string {
  if (sex === "M") {
    return SEX_COLORS.male;
  }
  if (sex === "F") {
    return SEX_COLORS.female;
  }
  if (sex === "J") {
    return SEX_COLORS.juvenile;
  }
  return SEX_COLORS.unknown;
}

/** Mapbox paint expression: color by feature `sex` property. */
export function sexCircleColorExpression(): [
  "match",
  ["get", "sex"],
  "M",
  string,
  "F",
  string,
  "J",
  string,
  string,
] {
  return [
    "match",
    ["get", "sex"],
    "M",
    SEX_COLORS.male,
    "F",
    SEX_COLORS.female,
    "J",
    SEX_COLORS.juvenile,
    SEX_COLORS.unknown,
  ];
}

export const SEX_LEGEND_ITEMS: {
  key: SexCategory;
  label: string;
  color: string;
}[] = [
  { key: "M", label: "Male", color: SEX_COLORS.male },
  { key: "F", label: "Female", color: SEX_COLORS.female },
  { key: "J", label: "Juvenile", color: SEX_COLORS.juvenile },
  { key: "U", label: "Unknown", color: SEX_COLORS.unknown },
];

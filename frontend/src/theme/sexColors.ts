import type { SexCategory } from "../types";

/** Shared sex palette for map markers, PCA points, legends, and filters. */
export const SEX_COLORS = {
  male: "#4A7A9E",
  /** Female — soft pale pink (rosy, not red). */
  female: "#E4A7B7",
  /** Juvenile — light sunny pastel yellow; pairs with the muted pink/blue. */
  juvenile: "#F2D273",
  /** Unknown or unlabeled — neutral gray (no green cast). */
  unknown: "#B0B0B0",
  /** PCA uncertain prediction (P≈0.5); distinct from U/J. */
  uncertain: "#8B4A4A",
} as const;

/** Map circle fill opacity — PCA solids are mixed to match this look on white. */
const MAP_MARKER_OPACITY = 0.92;

function mixHexWithWhite(hex: string, opacity: number): string {
  const normalized = hex.replace("#", "");
  const value =
    normalized.length === 3
      ? normalized
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : normalized;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  const mix = (channel: number) =>
    Math.round(channel * opacity + 255 * (1 - opacity));
  const toHex = (channel: number) =>
    channel.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
}

/**
 * Solid PCA fills that approximate map markers drawn at {@link MAP_MARKER_OPACITY}
 * over a light chart background (keep solid; do not use transparency in SVG).
 */
export const PCA_SEX_COLORS = {
  male: mixHexWithWhite(SEX_COLORS.male, MAP_MARKER_OPACITY),
  female: mixHexWithWhite(SEX_COLORS.female, MAP_MARKER_OPACITY),
  juvenile: mixHexWithWhite(SEX_COLORS.juvenile, MAP_MARKER_OPACITY),
  unknown: mixHexWithWhite(SEX_COLORS.unknown, MAP_MARKER_OPACITY),
  uncertain: mixHexWithWhite(SEX_COLORS.uncertain, MAP_MARKER_OPACITY),
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

export function pcaSexFillColor(sex: string | null | undefined): string {
  if (sex === "M") {
    return PCA_SEX_COLORS.male;
  }
  if (sex === "F") {
    return PCA_SEX_COLORS.female;
  }
  if (sex === "J") {
    return PCA_SEX_COLORS.juvenile;
  }
  return PCA_SEX_COLORS.unknown;
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

export const PCA_SEX_LEGEND_ITEMS: {
  key: SexCategory;
  label: string;
  color: string;
}[] = [
  { key: "M", label: "Male", color: PCA_SEX_COLORS.male },
  { key: "F", label: "Female", color: PCA_SEX_COLORS.female },
  { key: "J", label: "Juvenile", color: PCA_SEX_COLORS.juvenile },
  { key: "U", label: "Unknown", color: PCA_SEX_COLORS.unknown },
];

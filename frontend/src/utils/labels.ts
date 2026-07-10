import type { SexCategory } from "../types";

const SEX_LABELS: Record<SexCategory, string> = {
  M: "Male",
  F: "Female",
  J: "Juvenile",
  U: "Unknown",
};

export function formatSex(value: string | null): string {
  if (!value) {
    return "—";
  }
  return SEX_LABELS[value as SexCategory] ?? value;
}

export function formatStemCount(value: string): string {
  if (!value) {
    return "—";
  }
  if (value.toUpperCase() === "M") {
    return "Multiple";
  }
  return value;
}

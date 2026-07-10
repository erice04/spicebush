import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type { Polygon } from "geojson";
import type { DataBounds, SelectionState, TreeFeature } from "../types";
import { filterTrees } from "./filters";

export function createDefaultSelection(
  attributeFilters: SelectionState["attributeFilters"],
): SelectionState {
  return {
    attributeFilters,
    regionPolygon: null,
    manualExcluded: new Set(),
  };
}

export function filterByRegion(
  trees: TreeFeature[],
  regionPolygon: Polygon | null,
): TreeFeature[] {
  if (!regionPolygon) {
    return trees;
  }

  return trees.filter((tree) =>
    booleanPointInPolygon(tree.geometry, regionPolygon),
  );
}

/** Trees matching attribute + region filters (shown on map, incl. dimmed manual excludes). */
export function getMapTrees(
  trees: TreeFeature[],
  selection: SelectionState,
  bounds: DataBounds,
): TreeFeature[] {
  const afterAttributes = filterTrees(
    trees,
    selection.attributeFilters,
    bounds,
  );
  return filterByRegion(afterAttributes, selection.regionPolygon);
}

/** Final visible set after manual exclusions. */
export function getVisibleTrees(
  trees: TreeFeature[],
  selection: SelectionState,
  bounds: DataBounds,
): TreeFeature[] {
  const mapTrees = getMapTrees(trees, selection, bounds);

  if (selection.manualExcluded.size === 0) {
    return mapTrees;
  }

  return mapTrees.filter(
    (tree) => !selection.manualExcluded.has(tree.properties.id),
  );
}

export function toggleManualExcluded(
  selection: SelectionState,
  treeId: number,
): SelectionState {
  const manualExcluded = new Set(selection.manualExcluded);
  if (manualExcluded.has(treeId)) {
    manualExcluded.delete(treeId);
  } else {
    manualExcluded.add(treeId);
  }
  return { ...selection, manualExcluded };
}

export function clearManualExcluded(selection: SelectionState): SelectionState {
  return { ...selection, manualExcluded: new Set() };
}

export function countActiveSelectionLayers(
  selection: SelectionState,
  attributeActiveCount: number,
): number {
  let count = attributeActiveCount;
  if (selection.regionPolygon) {
    count += 1;
  }
  if (selection.manualExcluded.size > 0) {
    count += 1;
  }
  return count;
}

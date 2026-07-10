import type { TreeFeature } from "../types";

const EARTH_RADIUS_M = 6_371_000;
const TWO_OPT_MAX_ITERATIONS = 2_000;

/** Site entrance / parking — update when you have exact coordinates. */
export const SITE_ENTRANCE: [number, number] = [-72.916, 41.337];

export type RouteStartMode = "arbitrary" | "click" | "entrance";

export interface RouteOptions {
  startMode: RouteStartMode;
  startTreeId: number | null;
  entranceCoordinates?: [number, number];
}

export interface ComputedRoute {
  orderedIds: number[];
  totalDistanceMeters: number;
  startTreeId: number;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceM(
  a: [number, number],
  b: [number, number],
): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const lat1Rad = toRadians(lat1);
  const lat2Rad = toRadians(lat2);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function buildPointsById(points: TreeFeature[]): Map<number, TreeFeature> {
  return new Map(points.map((point) => [point.properties.id, point]));
}

function resolveStartTreeId(
  points: TreeFeature[],
  options: RouteOptions,
): number {
  const sortedIds = [...points]
    .map((point) => point.properties.id)
    .sort((a, b) => a - b);

  if (options.startMode === "click" && options.startTreeId !== null) {
    if (sortedIds.includes(options.startTreeId)) {
      return options.startTreeId;
    }
  }

  if (options.startMode === "entrance") {
    const entrance = options.entranceCoordinates ?? SITE_ENTRANCE;
    let nearestId = sortedIds[0];
    let nearestDistance = Infinity;

    for (const point of points) {
      const distance = haversineDistanceM(point.geometry.coordinates, entrance);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = point.properties.id;
      }
    }

    return nearestId;
  }

  return sortedIds[0];
}

export function nearestNeighborRoute(
  points: TreeFeature[],
  startTreeId: number,
): number[] {
  if (points.length === 0) {
    return [];
  }

  const byId = buildPointsById(points);
  const unvisited = new Set(byId.keys());
  const route: number[] = [];
  let currentId = startTreeId;

  while (unvisited.size > 0) {
    if (!unvisited.has(currentId)) {
      currentId = [...unvisited].sort((a, b) => a - b)[0];
    }

    route.push(currentId);
    unvisited.delete(currentId);

    if (unvisited.size === 0) {
      break;
    }

    const current = byId.get(currentId)!;
    let nearestId = -1;
    let nearestDistance = Infinity;

    for (const candidateId of unvisited) {
      const candidate = byId.get(candidateId)!;
      const distance = haversineDistanceM(
        current.geometry.coordinates,
        candidate.geometry.coordinates,
      );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = candidateId;
      }
    }

    currentId = nearestId;
  }

  return route;
}

export function routeDistanceMeters(
  orderedIds: number[],
  byId: Map<number, TreeFeature>,
): number {
  if (orderedIds.length < 2) {
    return 0;
  }

  let total = 0;
  for (let index = 1; index < orderedIds.length; index += 1) {
    const previous = byId.get(orderedIds[index - 1])!;
    const current = byId.get(orderedIds[index])!;
    total += haversineDistanceM(
      previous.geometry.coordinates,
      current.geometry.coordinates,
    );
  }

  return total;
}

export function improveRoute2Opt(
  orderedIds: number[],
  points: TreeFeature[],
  maxIterations = TWO_OPT_MAX_ITERATIONS,
): number[] {
  if (orderedIds.length < 4) {
    return orderedIds;
  }

  const byId = buildPointsById(points);
  let best = [...orderedIds];
  let bestDistance = routeDistanceMeters(best, byId);
  let improved = true;
  let iterations = 0;

  while (improved && iterations < maxIterations) {
    improved = false;
    iterations += 1;

    for (let i = 0; i < best.length - 2; i += 1) {
      for (let j = i + 2; j < best.length; j += 1) {
        const candidate = [
          ...best.slice(0, i + 1),
          ...best.slice(i + 1, j + 1).reverse(),
          ...best.slice(j + 1),
        ];
        const candidateDistance = routeDistanceMeters(candidate, byId);

        if (candidateDistance + 1e-6 < bestDistance) {
          best = candidate;
          bestDistance = candidateDistance;
          improved = true;
        }
      }
    }
  }

  return best;
}

export function computeSurveyRoute(
  points: TreeFeature[],
  options: RouteOptions,
): ComputedRoute | null {
  if (points.length === 0) {
    return null;
  }

  const startTreeId = resolveStartTreeId(points, options);
  const initialRoute = nearestNeighborRoute(points, startTreeId);
  const orderedIds = improveRoute2Opt(initialRoute, points);
  const byId = buildPointsById(points);

  return {
    orderedIds,
    totalDistanceMeters: routeDistanceMeters(orderedIds, byId),
    startTreeId,
  };
}

export function formatRouteDistance(meters: number): string {
  return `${Math.round(meters)} m`;
}

export function formatRouteSummary(route: ComputedRoute | null): string | null {
  if (!route || route.orderedIds.length === 0) {
    return null;
  }

  const stopLabel = route.orderedIds.length === 1 ? "stop" : "stops";
  return `Route: ${formatRouteDistance(route.totalDistanceMeters)}, ${route.orderedIds.length} ${stopLabel}`;
}

export function buildRouteGeoJSON(
  route: ComputedRoute | null,
  trees: TreeFeature[],
): {
  line: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  stops: GeoJSON.FeatureCollection<GeoJSON.Point>;
} {
  const emptyLine: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
    type: "FeatureCollection",
    features: [],
  };
  const emptyStops: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: [],
  };

  if (!route || route.orderedIds.length === 0) {
    return { line: emptyLine, stops: emptyStops };
  }

  const byId = buildPointsById(trees);
  const coordinates = route.orderedIds
    .map((id) => byId.get(id)?.geometry.coordinates)
    .filter((coord): coord is [number, number] => coord !== undefined);

  return {
    line: {
      type: "FeatureCollection",
      features:
        coordinates.length >= 2
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: {
                  type: "LineString",
                  coordinates,
                },
              },
            ]
          : [],
    },
    stops: {
      type: "FeatureCollection",
      features: route.orderedIds.flatMap((id, index) => {
        const tree = byId.get(id);
        if (!tree) {
          return [];
        }

        return [
          {
            type: "Feature",
            properties: {
              stop: String(index + 1),
              id,
            },
            geometry: tree.geometry,
          },
        ];
      }),
    },
  };
}

/** Empty route collections for clearing the map layers. */
export const EMPTY_ROUTE_LINE: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
  type: "FeatureCollection",
  features: [],
};

export const EMPTY_ROUTE_STOPS: GeoJSON.FeatureCollection<GeoJSON.Point> = {
  type: "FeatureCollection",
  features: [],
};

function lineSegmentLengths(coordinates: [number, number][]): number[] {
  const lengths: number[] = [];
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    lengths.push(haversineDistanceM(coordinates[i], coordinates[i + 1]));
  }
  return lengths;
}

/** Fraction of total path length (0–1) at each vertex. */
export function routeVertexProgress(
  coordinates: [number, number][],
): number[] {
  if (coordinates.length === 0) {
    return [];
  }
  if (coordinates.length === 1) {
    return [0];
  }

  const lengths = lineSegmentLengths(coordinates);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) {
    return coordinates.map((_, index) =>
      index / Math.max(1, coordinates.length - 1),
    );
  }

  const progress = [0];
  let traveled = 0;
  for (const length of lengths) {
    traveled += length;
    progress.push(traveled / total);
  }
  return progress;
}

/** Partial LineString from the start through `progress` (0–1) along the path. */
export function sliceLineByProgress(
  coordinates: [number, number][],
  progress: number,
): [number, number][] {
  if (coordinates.length === 0) {
    return [];
  }
  if (coordinates.length === 1 || progress <= 0) {
    return [coordinates[0]];
  }
  if (progress >= 1) {
    return coordinates.slice();
  }

  const lengths = lineSegmentLengths(coordinates);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total <= 0) {
    return [coordinates[0]];
  }

  const target = progress * total;
  const sliced: [number, number][] = [coordinates[0]];
  let traveled = 0;

  for (let i = 0; i < lengths.length; i += 1) {
    const segment = lengths[i];
    if (traveled + segment >= target) {
      const t = segment > 0 ? (target - traveled) / segment : 1;
      const [lng0, lat0] = coordinates[i];
      const [lng1, lat1] = coordinates[i + 1];
      sliced.push([lng0 + (lng1 - lng0) * t, lat0 + (lat1 - lat0) * t]);
      return sliced;
    }
    traveled += segment;
    sliced.push(coordinates[i + 1]);
  }

  return coordinates.slice();
}

export function buildPartialRouteGeoJSON(
  fullLine: GeoJSON.FeatureCollection<GeoJSON.LineString>,
  fullStops: GeoJSON.FeatureCollection<GeoJSON.Point>,
  progress: number,
): {
  line: GeoJSON.FeatureCollection<GeoJSON.LineString>;
  stops: GeoJSON.FeatureCollection<GeoJSON.Point>;
} {
  const fullCoords =
    (fullLine.features[0]?.geometry.coordinates as
      | [number, number][]
      | undefined) ?? [];

  if (fullCoords.length < 2) {
    return {
      line: EMPTY_ROUTE_LINE,
      stops:
        progress > 0
          ? fullStops
          : EMPTY_ROUTE_STOPS,
    };
  }

  const clamped = Math.min(1, Math.max(0, progress));
  const sliced = sliceLineByProgress(fullCoords, clamped);
  const vertexProgress = routeVertexProgress(fullCoords);

  return {
    line: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: sliced,
          },
        },
      ],
    },
    stops: {
      type: "FeatureCollection",
      features: fullStops.features.filter((_, index) => {
        const atVertex = vertexProgress[index] ?? 1;
        return atVertex <= clamped + 1e-6;
      }),
    },
  };
}

export function routeTraceDurationMs(stopCount: number): number {
  const segments = Math.max(1, stopCount - 1);
  return Math.min(4200, Math.max(900, 700 + segments * 160));
}

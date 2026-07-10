import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import type { PcaPoint, PcaResult } from "../types/analysis";
import type { TreeFeature } from "../types";
import { formatSex, formatStemCount } from "../utils/labels";
import { isUncertainPrediction } from "../utils/sexPrediction";
import "./PcaBiplot.css";

interface PcaBiplotProps {
  pca: PcaResult;
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number | null) => void;
  layout?: "default" | "popup";
  visibleTreeIds?: number[];
  trees?: TreeFeature[];
}

const MALE_COLOR = "#4a6fa5";
const FEMALE_COLOR = "#e8a8c4";
const UNLABELED_COLOR = "#8a968a";
const UNCERTAIN_COLOR = "#8b1a1a";
const SELECTED_COLOR = "#ffe566";
const SELECTED_STROKE = "#3d3a00";
const HOVER_STROKE = "#2d4a2d";
const KNOWN_RADIUS = 3.5;
const PREDICTED_MARKER_SIZE = 10;
const PREDICTED_MARKER_SIZE_FULL = 11;

const MARGIN = { top: 12, right: 28, bottom: 52, left: 56 };
const POPUP_MARGIN = { top: 8, right: 20, bottom: 36, left: 42 };
const CHART_TITLE = "Morphology PCA";
const POPUP_CHART_REF_WIDTH = 280;

function isPredictedPoint(point: PcaPoint): boolean {
  return !point.sex_known;
}

function pointColor(
  sex: string | null,
  sexKnown: boolean,
  probabilityFemale: number | null,
): string {
  if (sexKnown && sex === "M") {
    return MALE_COLOR;
  }
  if (sexKnown && sex === "F") {
    return FEMALE_COLOR;
  }
  if (probabilityFemale === null) {
    return UNLABELED_COLOR;
  }
  if (isUncertainPrediction(probabilityFemale)) {
    return UNCERTAIN_COLOR;
  }

  return probabilityFemale >= 0.5 ? FEMALE_COLOR : MALE_COLOR;
}

function applyPointStyles(
  point: PcaPoint,
  highlightedTreeId: number | null,
  selectedTreeId: number | null,
  _layout: "default" | "popup" = "default",
) {
  const isHighlighted = point.id === highlightedTreeId;
  const isSelected = point.id === selectedTreeId;
  const fill = isSelected
    ? SELECTED_COLOR
    : pointColor(point.sex, point.sex_known, point.probability_female);
  const stroke = isSelected
    ? SELECTED_STROKE
    : isHighlighted
      ? HOVER_STROKE
      : "#f4f7f0";
  const strokeWidth = isHighlighted || isSelected ? 2 : 1;

  return { fill, stroke, strokeWidth, isHighlighted, isSelected };
}

function predictedMarkerOutline(
  layout: "default" | "popup",
  isHighlighted: boolean,
  isSelected: boolean,
  fill: string,
): { stroke: string; strokeWidth: number } | null {
  if (isHighlighted || isSelected) {
    return {
      stroke: SELECTED_STROKE,
      strokeWidth: isHighlighted ? 1.75 : 1.35,
    };
  }

  // Pluses get a light same-color stroke so the mark stays readable.
  if (layout === "default" || layout === "popup") {
    return {
      stroke: fill,
      strokeWidth: 0.7,
    };
  }

  return null;
}

function renderPointMark(
  group: d3.Selection<SVGGElement, PcaPoint, d3.BaseType, unknown>,
  point: PcaPoint,
  highlightedTreeId: number | null,
  selectedTreeId: number | null,
  layout: "default" | "popup" = "default",
) {
  const { fill, stroke, strokeWidth, isHighlighted, isSelected } =
    applyPointStyles(
      point,
      highlightedTreeId,
      selectedTreeId,
      layout,
    );

  if (!isPredictedPoint(point)) {
    group
      .selectAll("circle")
      .data([point])
      .join("circle")
      .attr("r", KNOWN_RADIUS)
      .attr("fill", fill)
      .attr("stroke", stroke)
      .attr("stroke-width", strokeWidth);
    group.selectAll("text").remove();
    return;
  }

  group.selectAll("circle").remove();
  const textOutline = predictedMarkerOutline(
    layout,
    isHighlighted,
    isSelected,
    fill,
  );
  const markerSize =
    layout === "default" ? PREDICTED_MARKER_SIZE_FULL : PREDICTED_MARKER_SIZE;

  group
    .selectAll("text")
    .data([point])
    .join("text")
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("font-size", markerSize)
    .attr("font-weight", 700)
    .attr("fill", fill)
    .attr("stroke", textOutline?.stroke ?? "none")
    .attr("stroke-width", textOutline?.strokeWidth ?? 0)
    .attr("paint-order", textOutline ? "stroke fill" : null)
    .text("+");
}

function raiseActivePoints(
  points: d3.Selection<SVGGElement, PcaPoint, d3.BaseType, unknown>,
  highlightedTreeId: number | null,
  selectedTreeId: number | null,
) {
  if (highlightedTreeId !== null && highlightedTreeId !== selectedTreeId) {
    points.filter((point) => point.id === highlightedTreeId).raise();
  }
  if (selectedTreeId !== null) {
    points.filter((point) => point.id === selectedTreeId).raise();
  }
}

function formatMeasurement(
  value: number | null,
  unit: string,
  digits = 1,
): string {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  return `${value.toFixed(digits)} ${unit}`;
}

function predictionConfidence(probabilityFemale: number): number {
  return probabilityFemale >= 0.5
    ? probabilityFemale
    : 1 - probabilityFemale;
}

export default function PcaBiplot({
  pca,
  highlightedTreeId,
  selectedTreeId,
  onHoverTree,
  onSelectTree,
  layout = "default",
  visibleTreeIds,
  trees = [],
}: PcaBiplotProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const biplotRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const handlersRef = useRef({ onHoverTree, onSelectTree });
  const plotClipId = useId().replace(/:/g, "");
  const [dimensions, setDimensions] = useState({ width: 640, height: 480 });
  handlersRef.current = { onHoverTree, onSelectTree };

  const plotPoints = useMemo(() => {
    if (layout !== "popup" || !visibleTreeIds) {
      return pca.points;
    }

    const visible = new Set(visibleTreeIds);
    return pca.points.filter((point) => visible.has(point.id));
  }, [layout, pca.points, visibleTreeIds]);

  const selectedDetail = useMemo(() => {
    if (layout === "popup" || selectedTreeId === null) {
      return null;
    }

    const point = pca.points.find((entry) => entry.id === selectedTreeId);
    const tree = trees.find(
      (entry) => entry.properties.id === selectedTreeId,
    );
    if (!point || !tree) {
      return null;
    }

    return { point, tree };
  }, [layout, pca.points, selectedTreeId, trees]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const syncUiScale = (width: number) => {
      const biplot = biplotRef.current;
      if (!biplot || layout !== "popup" || width <= 0) {
        return;
      }

      biplot.style.setProperty(
        "--pca-ui-scale",
        String(Math.min(1, Math.max(0.65, width / POPUP_CHART_REF_WIDTH))),
      );
    };

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0) {
        const nextHeight = height > 0 ? height : width * (4 / 5);
        setDimensions((previous) => {
          if (previous.width === width && previous.height === nextHeight) {
            return previous;
          }
          return { width, height: nextHeight };
        });
        syncUiScale(width);
      }
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      biplotRef.current?.style.removeProperty("--pca-ui-scale");
    };
  }, [layout]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) {
      return;
    }

    const { width, height } = dimensions;
    const margin = layout === "popup" ? POPUP_MARGIN : MARGIN;
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    if (innerWidth <= 0 || innerHeight <= 0) {
      return;
    }

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const root = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    root
      .append("rect")
      .attr("class", "pca-biplot__zoom-surface")
      .attr("width", innerWidth)
      .attr("height", innerHeight)
      .attr("fill", "transparent")
      .on("click", (event) => {
        event.stopPropagation();
        handlersRef.current.onSelectTree(null);
      });

    svg
      .append("defs")
      .append("clipPath")
      .attr("id", plotClipId)
      .append("rect")
      .attr("width", innerWidth)
      .attr("height", innerHeight);

    const pc1Values = plotPoints.map((point) => point.pc1);
    const pc2Values = plotPoints.map((point) => point.pc2);

    const xExtent = (
      plotPoints.length > 0
        ? d3.extent(pc1Values)
        : [-1, 1]
    ) as [number, number];
    const yExtent = (
      plotPoints.length > 0
        ? d3.extent(pc2Values)
        : [-1, 1]
    ) as [number, number];
    const xPad = (xExtent[1] - xExtent[0]) * 0.12 || 0.5;
    const yPad = (yExtent[1] - yExtent[0]) * 0.12 || 0.5;

    const xScale = d3
      .scaleLinear()
      .domain([xExtent[0] - xPad, xExtent[1] + xPad])
      .range([0, innerWidth]);

    const yScale = d3
      .scaleLinear()
      .domain([yExtent[0] - yPad, yExtent[1] + yPad])
      .range([innerHeight, 0]);

    const xAxisGroup = root
      .append("g")
      .attr("class", "pca-biplot__axis-x")
      .attr("transform", `translate(0,${innerHeight})`);

    const yAxisGroup = root.append("g").attr("class", "pca-biplot__axis-y");

    const pc1Percent = (pca.explained_variance_ratio[0] * 100).toFixed(0);
    const pc2Percent = (pca.explained_variance_ratio[1] * 100).toFixed(0);

    root
      .append("text")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + (layout === "popup" ? 30 : 40))
      .attr("text-anchor", "middle")
      .attr("class", "pca-biplot__axis-label")
      .text(`PC1 (${pc1Percent}%)`);

    root
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", layout === "popup" ? -34 : -42)
      .attr("text-anchor", "middle")
      .attr("class", "pca-biplot__axis-label")
      .text(`PC2 (${pc2Percent}%)`);

    const pointsLayer = root
      .append("g")
      .attr("class", "pca-biplot__points")
      .attr("clip-path", `url(#${plotClipId})`);

    const pointGroups = pointsLayer
      .selectAll<SVGGElement, PcaPoint>("g.pca-biplot__point")
      .data(plotPoints, (point) => point.id)
      .join("g")
      .attr("class", "pca-biplot__point")
      .attr("data-tree-id", (point) => point.id)
      .style("cursor", "pointer")
      .on("mouseenter", (_event, point) => {
        handlersRef.current.onHoverTree(point.id);
      })
      .on("mouseleave", () => {
        handlersRef.current.onHoverTree(null);
      })
      .on("click", (event, point) => {
        event.stopPropagation();
        handlersRef.current.onSelectTree(point.id);
      });

    pointGroups.each(function (point) {
      renderPointMark(d3.select(this), point, null, null, layout);
    });

    const updatePlot = (transform: d3.ZoomTransform) => {
      const zx = transform.rescaleX(xScale);
      const zy = transform.rescaleY(yScale);

      xAxisGroup.call(
        d3.axisBottom(zx).ticks(6).tickSizeOuter(0),
      );
      yAxisGroup.call(
        d3.axisLeft(zy).ticks(6).tickSizeOuter(0),
      );

      pointGroups.attr(
        "transform",
        (point) => `translate(${zx(point.pc1)},${zy(point.pc2)})`,
      );
    };

    const zoom = d3
      .zoom<SVGGElement, unknown>()
      .scaleExtent([1, 10])
      .extent([
        [0, 0],
        [innerWidth, innerHeight],
      ])
      .filter((event) => {
        if (event.type === "wheel" || event.type === "dblclick") {
          return true;
        }
        if (event.type === "mousedown" || event.type === "touchstart") {
          return !(event.target as Element).closest(".pca-biplot__point");
        }
        return false;
      })
      .on("start", () => {
        d3.select(containerRef.current).classed("pca-biplot__chart--active", true);
      })
      .on("zoom", (event) => {
        updatePlot(event.transform);
      })
      .on("end", () => {
        d3.select(containerRef.current).classed("pca-biplot__chart--active", false);
      });

    root.call(zoom).on("dblclick.zoom", (event) => {
      event.preventDefault();
      root.transition().duration(200).call(zoom.transform, d3.zoomIdentity);
    });

    const chartNode = containerRef.current;
    const wheelHandler = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const pointer = d3.pointer(event, root.node());
      root.call(
        zoom.scaleBy,
        Math.pow(2, -event.deltaY * 0.002),
        pointer,
      );
    };

    chartNode?.addEventListener("wheel", wheelHandler, { passive: false });

    updatePlot(d3.zoomIdentity);

    return () => {
      root.on(".zoom", null);
      chartNode?.removeEventListener("wheel", wheelHandler);
    };
  }, [dimensions, layout, plotClipId, plotPoints]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) {
      return;
    }

    const points = svg.selectAll<SVGGElement, PcaPoint>("g.pca-biplot__point");

    points.each(function (point) {
      renderPointMark(
        d3.select(this),
        point,
        highlightedTreeId,
        selectedTreeId,
        layout,
      );
    });

    raiseActivePoints(points, highlightedTreeId, selectedTreeId);
  }, [highlightedTreeId, selectedTreeId, layout]);

  const knownLegendItems = (
    <>
      <span className="pca-biplot__legend-item">
        <span className="pca-biplot__legend-symbol" aria-hidden="true">
          <span className="pca-biplot__swatch" style={{ background: FEMALE_COLOR }} />
        </span>
        <span className="pca-biplot__legend-label">Female (F)</span>
      </span>
      <span className="pca-biplot__legend-item">
        <span className="pca-biplot__legend-symbol" aria-hidden="true">
          <span className="pca-biplot__swatch" style={{ background: MALE_COLOR }} />
        </span>
        <span className="pca-biplot__legend-label">Male (M)</span>
      </span>
    </>
  );

  const predictedLegendItems = (
    <>
      <span className="pca-biplot__legend-item">
        <span className="pca-biplot__legend-symbol" aria-hidden="true">
          <span
            className="pca-biplot__marker pca-biplot__marker--plus"
            style={{ color: FEMALE_COLOR }}
          >
            +
          </span>
        </span>
        <span className="pca-biplot__legend-label">Predicted female (U/J)</span>
      </span>
      <span className="pca-biplot__legend-item">
        <span className="pca-biplot__legend-symbol" aria-hidden="true">
          <span
            className="pca-biplot__marker pca-biplot__marker--plus"
            style={{ color: MALE_COLOR }}
          >
            +
          </span>
        </span>
        <span className="pca-biplot__legend-label">Predicted male (U/J)</span>
      </span>
    </>
  );

  const uncertainLegendItem = (
    <span className="pca-biplot__legend-item">
      <span className="pca-biplot__legend-symbol" aria-hidden="true">
        <span
          className="pca-biplot__marker pca-biplot__marker--plus"
          style={{ color: UNCERTAIN_COLOR }}
        >
          +
        </span>
      </span>
      <span className="pca-biplot__legend-label">Uncertain (P≈0.5)</span>
    </span>
  );

  const legendGrid = (
    <div className="pca-biplot__legend-grid">
      {knownLegendItems}
      <span
        className="pca-biplot__legend-item pca-biplot__legend-item--spacer"
        aria-hidden="true"
      />
      {predictedLegendItems}
      {uncertainLegendItem}
    </div>
  );

  const zoomHint = (
    <p className="pca-biplot__legend-hint">
      Scroll on chart to zoom, drag to pan, double-click to reset
    </p>
  );

  return (
    <div
      ref={biplotRef}
      className={`pca-biplot${layout === "popup" ? " pca-biplot--popup" : ""}`}
    >
      {layout === "popup" ? (
        <div className="pca-biplot__intro">
          <h3 className="pca-biplot__heading">{CHART_TITLE}</h3>
        </div>
      ) : (
        <h3 className="pca-biplot__heading">{CHART_TITLE}</h3>
      )}
      <div ref={containerRef} className="pca-biplot__chart">
        <svg
          ref={svgRef}
          className="pca-biplot__svg"
          role="img"
          aria-label="PCA scatter plot of tree morphology"
        />
        {selectedDetail && (
          <aside
            className="pca-biplot__point-card"
            aria-label={`Tree ${selectedDetail.point.id} details`}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="pca-biplot__point-card-header">
              <strong>ID #{selectedDetail.point.id}</strong>
              <button
                type="button"
                className="pca-biplot__point-card-close"
                onClick={() => onSelectTree(null)}
                aria-label="Dismiss point details"
              >
                ×
              </button>
            </div>
            <dl className="pca-biplot__point-card-metrics">
              <div>
                <dt>DBH</dt>
                <dd>
                  {formatMeasurement(
                    selectedDetail.tree.properties.dbh_cm,
                    "cm",
                  )}
                </dd>
              </div>
              <div>
                <dt>Base diameter</dt>
                <dd>
                  {formatMeasurement(
                    selectedDetail.tree.properties.base_diameter_cm,
                    "cm",
                  )}
                </dd>
              </div>
              <div>
                <dt>Stem count</dt>
                <dd>
                  {formatStemCount(selectedDetail.tree.properties.stem_count)}
                </dd>
              </div>
              <div>
                <dt>Height</dt>
                <dd>
                  {formatMeasurement(
                    selectedDetail.tree.properties.height_m,
                    "m",
                  )}
                </dd>
              </div>
              {selectedDetail.point.sex_known ? (
                <div>
                  <dt>Sex</dt>
                  <dd>{formatSex(selectedDetail.point.sex)}</dd>
                </div>
              ) : selectedDetail.point.probability_female !== null ? (
                <div>
                  <dt>Model</dt>
                  <dd>
                    Predicted{" "}
                    {selectedDetail.point.probability_female >= 0.5
                      ? "F"
                      : "M"}{" "}
                    {(
                      predictionConfidence(
                        selectedDetail.point.probability_female,
                      ) * 100
                    ).toFixed(0)}
                    %
                  </dd>
                </div>
              ) : null}
            </dl>
          </aside>
        )}
      </div>
      <div className="pca-biplot__legend" aria-label="Chart legend">
        {legendGrid}
      </div>
      {zoomHint}
    </div>
  );
}

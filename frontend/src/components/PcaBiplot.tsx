import { useEffect, useRef } from "react";
import * as d3 from "d3";
import type { PcaResult } from "../types/analysis";
import "./PcaBiplot.css";

interface PcaBiplotProps {
  pca: PcaResult;
  highlightedTreeId: number | null;
  selectedTreeId: number | null;
  onHoverTree: (treeId: number | null) => void;
  onSelectTree: (treeId: number) => void;
}

const MALE_COLOR = "#4a6fa5";
const FEMALE_COLOR = "#c45c8a";

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
    return "#8a968a";
  }

  return d3.interpolateRgb(MALE_COLOR, FEMALE_COLOR)(probabilityFemale);
}

export default function PcaBiplot({
  pca,
  highlightedTreeId,
  selectedTreeId,
  onHoverTree,
  onSelectTree,
}: PcaBiplotProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const handlersRef = useRef({ onHoverTree, onSelectTree });
  handlersRef.current = { onHoverTree, onSelectTree };

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) {
      return;
    }

    const width = 360;
    const height = 300;
    const margin = { top: 24, right: 24, bottom: 42, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    const root = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const pc1Values = pca.points.map((point) => point.pc1);
    const pc2Values = pca.points.map((point) => point.pc2);
    const loadingPc1 = pca.loadings.map((loading) => loading.pc1);
    const loadingPc2 = pca.loadings.map((loading) => loading.pc2);

    const xExtent = d3.extent([...pc1Values, ...loadingPc1]) as [number, number];
    const yExtent = d3.extent([...pc2Values, ...loadingPc2]) as [number, number];
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

    root
      .append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(xScale)
          .ticks(5)
          .tickSizeOuter(0),
      );

    root.append("g").call(
      d3
        .axisLeft(yScale)
        .ticks(5)
        .tickSizeOuter(0),
    );

    root
      .append("text")
      .attr("x", innerWidth / 2)
      .attr("y", innerHeight + 34)
      .attr("text-anchor", "middle")
      .attr("class", "pca-biplot__axis-label")
      .text(
        `PC1 (${(pca.explained_variance_ratio[0] * 100).toFixed(1)}%)`,
      );

    root
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -innerHeight / 2)
      .attr("y", -36)
      .attr("text-anchor", "middle")
      .attr("class", "pca-biplot__axis-label")
      .text(
        `PC2 (${(pca.explained_variance_ratio[1] * 100).toFixed(1)}%)`,
      );

    const loadingMagnitude = Math.max(
      ...pca.loadings.map((loading) =>
        Math.hypot(loading.pc1, loading.pc2),
      ),
      0.001,
    );
    const pointSpan = Math.max(
      xExtent[1] - xExtent[0],
      yExtent[1] - yExtent[0],
      0.001,
    );
    const arrowScale = (pointSpan * 0.42) / loadingMagnitude;

    const arrowLayer = root.append("g").attr("class", "pca-biplot__arrows");

    pca.loadings.forEach((loading) => {
      const x1 = xScale(0);
      const y1 = yScale(0);
      const x2 = xScale(loading.pc1 * arrowScale);
      const y2 = yScale(loading.pc2 * arrowScale);

      arrowLayer
        .append("line")
        .attr("x1", x1)
        .attr("y1", y1)
        .attr("x2", x2)
        .attr("y2", y2)
        .attr("class", "pca-biplot__arrow");

      arrowLayer
        .append("text")
        .attr("x", x2)
        .attr("y", y2)
        .attr("dx", loading.pc1 >= 0 ? 6 : -6)
        .attr("dy", loading.pc2 >= 0 ? -6 : 10)
        .attr("text-anchor", loading.pc1 >= 0 ? "start" : "end")
        .attr("class", "pca-biplot__arrow-label")
        .text(loading.label);
    });

    const pointsLayer = root.append("g").attr("class", "pca-biplot__points");

    pointsLayer
      .selectAll("circle")
      .data(pca.points, (point) => (point as { id: number }).id)
      .join("circle")
      .attr("cx", (point) => xScale(point.pc1))
      .attr("cy", (point) => yScale(point.pc2))
      .attr("r", 5)
      .attr("fill", (point) =>
        pointColor(point.sex, point.sex_known, point.probability_female),
      )
      .attr("stroke", "#f4f7f0")
      .attr("stroke-width", 1.2)
      .attr("data-tree-id", (point) => point.id)
      .style("cursor", "pointer")
      .on("mouseenter", (_event, point) => {
        handlersRef.current.onHoverTree(point.id);
      })
      .on("mouseleave", () => {
        handlersRef.current.onHoverTree(null);
      })
      .on("click", (_event, point) => {
        handlersRef.current.onSelectTree(point.id);
      });
  }, [pca]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    if (!svgRef.current) {
      return;
    }

    svg.selectAll<SVGCircleElement, unknown>("circle").each(function () {
      const circle = d3.select(this);
      const treeId = Number(circle.attr("data-tree-id"));
      const isHighlighted = treeId === highlightedTreeId;
      const isSelected = treeId === selectedTreeId;

      circle
        .attr("r", isHighlighted || isSelected ? 7 : 5)
        .attr("stroke", isHighlighted || isSelected ? "#2d4a2d" : "#f4f7f0")
        .attr("stroke-width", isHighlighted || isSelected ? 2.2 : 1.2);
    });
  }, [highlightedTreeId, selectedTreeId]);

  return (
    <div className="pca-biplot">
      <svg ref={svgRef} className="pca-biplot__svg" role="img" aria-label="PCA biplot" />
      <div className="pca-biplot__legend">
        <span className="pca-biplot__legend-item">
          <span className="pca-biplot__swatch" style={{ background: FEMALE_COLOR }} />
          Female (known)
        </span>
        <span className="pca-biplot__legend-item">
          <span className="pca-biplot__swatch" style={{ background: MALE_COLOR }} />
          Male (known)
        </span>
        <span className="pca-biplot__legend-item pca-biplot__legend-item--gradient">
          <span className="pca-biplot__swatch pca-biplot__swatch--gradient" />
          Predicted (blue = male, pink = female)
        </span>
      </div>
    </div>
  );
}

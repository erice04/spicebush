import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BasemapStyle } from "../types";
import { SEX_LEGEND_ITEMS } from "../theme/sexColors";
import { useCloseAnimation } from "../hooks/useCloseAnimation";
import "./MapLayersControl.css";

interface MapLayersControlProps {
  basemap: BasemapStyle;
  densityHeatmap: boolean;
  showTreePoints: boolean;
  colorBySex: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBasemapChange: (basemap: BasemapStyle) => void;
  onDensityChange: (enabled: boolean) => void;
  onShowTreePointsChange: (enabled: boolean) => void;
  onColorBySexChange: (enabled: boolean) => void;
}

export default function MapLayersControl({
  basemap,
  densityHeatmap,
  showTreePoints,
  colorBySex,
  open,
  onOpenChange,
  onBasemapChange,
  onDensityChange,
  onShowTreePointsChange,
  onColorBySexChange,
}: MapLayersControlProps) {
  const tabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [overlayHost, setOverlayHost] = useState<Element | null>(null);
  const [present, setPresent] = useState(open);
  const { closing, beginClose } = useCloseAnimation(220);

  useLayoutEffect(() => {
    setOverlayHost(tabRef.current?.closest(".map-top-controls") ?? null);
  }, []);

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present || closing) {
      return;
    }
    beginClose(() => setPresent(false));
  }, [open, present, closing, beginClose]);

  useEffect(() => {
    if (!present) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [present, onOpenChange]);

  const dock =
    present && overlayHost
      ? createPortal(
          <aside
            ref={panelRef}
            id="map-layers-dock"
            className={`map-layers-dock sb-dock-panel${
              closing ? " map-layers-dock--closing" : ""
            }`}
            aria-label="Map layers"
          >
            <div className="map-layers-dock__header sb-dock-panel__header">
              <div className="map-layers-dock__title-row sb-dock-panel__title-row">
                <svg
                  className="map-layers-dock__title-icon sb-dock-panel__title-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                >
                  <path
                    d="M7 1.4 1.8 4.1 7 6.8l5.2-2.7L7 1.4Zm-4.7 4.7L7 8.7l4.7-2.6v2.5L7 11.2l-4.7-2.6V6.1Zm0 3.3L7 12.1l4.7-2.7v1.4L7 13.5l-4.7-2.7V9.4Z"
                    fill="currentColor"
                  />
                </svg>
                <h2 className="map-layers-dock__title sb-dock-panel__title">Layers</h2>
              </div>
              <button
                type="button"
                className="map-layers-dock__collapse sb-dock-panel__close"
                onClick={() => onOpenChange(false)}
                aria-label="Collapse layers panel"
              >
                ×
              </button>
            </div>

            <div className="map-layers-dock__body sb-dock-panel__body">
              <section className="map-layers-dock__card">
                <h3 className="map-layers-dock__section-label">Basemap</h3>
                <div
                  className="map-layers-dock__segmented map-layers-dock__segmented--triple"
                  role="group"
                  aria-label="Basemap style"
                >
                  <button
                    type="button"
                    className={`map-layers-dock__segment${basemap === "terrain" ? " map-layers-dock__segment--active" : ""}`}
                    aria-pressed={basemap === "terrain"}
                    onClick={() => onBasemapChange("terrain")}
                  >
                    Default
                  </button>
                  <button
                    type="button"
                    className={`map-layers-dock__segment${basemap === "satellite" ? " map-layers-dock__segment--active" : ""}`}
                    aria-pressed={basemap === "satellite"}
                    onClick={() => onBasemapChange("satellite")}
                  >
                    Summer
                  </button>
                  <button
                    type="button"
                    className={`map-layers-dock__segment${basemap === "aerial" ? " map-layers-dock__segment--active" : ""}`}
                    aria-pressed={basemap === "aerial"}
                    onClick={() => onBasemapChange("aerial")}
                  >
                    Winter
                  </button>
                </div>
              </section>

              <section className="map-layers-dock__card">
                <label className="map-layers-dock__toggle">
                  <input
                    type="checkbox"
                    checked={showTreePoints}
                    onChange={(event) =>
                      onShowTreePointsChange(event.target.checked)
                    }
                  />
                  <span
                    className="map-layers-dock__toggle-ui"
                    aria-hidden="true"
                  />
                  <span className="map-layers-dock__card-title">
                    Survey points
                  </span>
                </label>
              </section>

              <section className="map-layers-dock__card">
                <label className="map-layers-dock__toggle">
                  <input
                    type="checkbox"
                    checked={densityHeatmap}
                    onChange={(event) => onDensityChange(event.target.checked)}
                  />
                  <span
                    className="map-layers-dock__toggle-ui"
                    aria-hidden="true"
                  />
                  <span className="map-layers-dock__card-title">
                    Density heatmap
                  </span>
                </label>
              </section>

              <section className="map-layers-dock__card map-layers-dock__card--last">
                <label className="map-layers-dock__toggle">
                  <input
                    type="checkbox"
                    checked={colorBySex}
                    onChange={(event) =>
                      onColorBySexChange(event.target.checked)
                    }
                  />
                  <span
                    className="map-layers-dock__toggle-ui"
                    aria-hidden="true"
                  />
                  <span className="map-layers-dock__card-title">
                    Color by sex
                  </span>
                </label>
                {colorBySex && (
                  <div
                    className="map-layers-dock__legend"
                    aria-label="Sex legend"
                  >
                    {SEX_LEGEND_ITEMS.map((item) => (
                      <div
                        key={item.key}
                        className="map-layers-dock__legend-item"
                      >
                        <span
                          className="map-layers-dock__legend-swatch"
                          style={{ background: item.color }}
                          aria-hidden="true"
                        />
                        <span className="map-layers-dock__legend-label">
                          {item.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </aside>,
          overlayHost,
        )
      : null;

  return (
    <>
      <button
        ref={tabRef}
        type="button"
        className={`map-layers-control__rail-btn${open ? " map-layers-control__rail-btn--active" : ""}`}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="map-layers-dock"
      >
        <svg
          className="map-layers-control__trigger-icon"
          width="14"
          height="14"
          viewBox="0 0 14 14"
          aria-hidden="true"
        >
          <path
            d="M7 1.4 1.8 4.1 7 6.8l5.2-2.7L7 1.4Zm-4.7 4.7L7 8.7l4.7-2.6v2.5L7 11.2l-4.7-2.6V6.1Zm0 3.3L7 12.1l4.7-2.7v1.4L7 13.5l-4.7-2.7V9.4Z"
            fill="currentColor"
          />
        </svg>
        <span>Layers</span>
      </button>
      {dock}
    </>
  );
}

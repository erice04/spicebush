/// <reference types="vite/client" />
/// <reference types="geojson" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
  /** Optional custom Mapbox Studio style for the Topo (terrain) basemap. */
  readonly VITE_MAPBOX_STYLE_TERRAIN?: string;
  /** Optional custom style for Spring aerial (skips CT ECO 3″ ortho overlay). */
  readonly VITE_MAPBOX_STYLE_AERIAL?: string;
  /** Optional custom style for Summer aerial (skips CT NAIP 2023 overlay). */
  readonly VITE_MAPBOX_STYLE_SATELLITE?: string;
  readonly VITE_CF_ANALYTICS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}

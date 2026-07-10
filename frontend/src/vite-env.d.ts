/// <reference types="vite/client" />
/// <reference types="geojson" />

interface ImportMetaEnv {
  readonly VITE_MAPBOX_TOKEN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}

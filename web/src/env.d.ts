/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the house server, e.g. https://api.musehouse.app (unset = same origin). */
  readonly VITE_HOUSE_URL?: string;
  /** Muse House X account handle for the "Follow on X" button, e.g. musehouse. */
  readonly VITE_X_HANDLE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

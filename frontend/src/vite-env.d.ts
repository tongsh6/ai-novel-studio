/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket endpoint，默认 ws://localhost:4000/socket */
  readonly VITE_WS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

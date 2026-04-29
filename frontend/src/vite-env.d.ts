/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** HTTP API endpoint，未配置时使用同源 */
  readonly VITE_API_ENDPOINT?: string;
  /** WebSocket endpoint，未配置时使用同源 /socket */
  readonly VITE_WS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

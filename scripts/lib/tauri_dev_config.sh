#!/usr/bin/env bash
#
# Runtime Tauri dev config overlay.
#
# Keep launchers from mutating frontend/src-tauri/tauri.conf.json while Tauri is
# watching src-tauri. A watched config rewrite can trigger a rebuild and kill the
# long-running beforeDevCommand, which surfaces as exit 143.

write_tauri_dev_config() {
  local output_path="$1"
  local vite_port="$2"
  local phoenix_port="$3"
  local before_dev_command="$4"

  node --input-type=module - "$output_path" "$vite_port" "$phoenix_port" "$before_dev_command" <<'NODE'
import fs from "node:fs";

const [outputPath, vitePort, phoenixPort, beforeDevCommand] = process.argv.slice(2);
const connectSrc = [
  `http://localhost:${phoenixPort}`,
  `http://127.0.0.1:${phoenixPort}`,
  `ws://localhost:${phoenixPort}`,
  `ws://127.0.0.1:${phoenixPort}`,
].join(" ");

const overlay = {
  build: {
    devUrl: `http://127.0.0.1:${vitePort}`,
    beforeDevCommand,
  },
  app: {
    security: {
      csp: `default-src 'self'; connect-src 'self' ${connectSrc}`,
    },
  },
};

fs.writeFileSync(outputPath, `${JSON.stringify(overlay, null, 2)}\n`);
NODE
}

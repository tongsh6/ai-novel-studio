import { defineConfig } from "vite";

// `frontend/slice-verify/*.test.mjs` 是外部验收脚本的自测（纯 Node helper/校验器），
// 与主前端 `pnpm test`（src/**/*.test.{ts,tsx}）分离：这里不启动浏览器/后端/原生窗口，
// 也不把外部 driver 自测混进产品测试的整体环境。由 `pnpm test:slice-verify` 驱动。
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ["*.test.mjs"] },
});

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "src-tauri"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommendedTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ---- 代码质量规则（AGENTS.md § 前端约束）----

      // 禁止 console.log（用项目日志设施替代）
      "no-console": ["warn", { allow: ["warn", "error"] }],

      // 禁止未使用变量（_ 前缀允许）
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // ---- 验收 harness（slice-verify）.mjs：仅正确性规则，不做风格检查 ----
  {
    files: ["slice-verify/**/*.mjs"],
    extends: [js.configs.recommended],
    languageOptions: {
      // driver 本体运行在 Node（Playwright），page.evaluate/waitForFunction 回调
      // 运行在页面里，同一文件两种执行环境，两套 globals 都要给。
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);

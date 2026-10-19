import { defineConfig } from "tsup";

// 全部依賴打包成單一 ESM 檔案：Railway / Docker 執行時不需要 node_modules。
// banner 補上 require，讓被打包進來的 CJS 套件可以動態 require Node 內建模組。
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".mjs" }),
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
});

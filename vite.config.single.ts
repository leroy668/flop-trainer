import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 单文件打包专用配置：
 * - 关闭代码分割，产出单一 IIFE，避免 file:// 下 ES module 加载被拦截
 * - 关闭 modulePreload，方便随后手动内联
 */
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist-single",
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: {
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "app.js",
        assetFileNames: "app.[ext]",
      },
    },
  },
});

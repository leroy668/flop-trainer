/**
 * 单文件打包：
 *   node scripts/build-single.mjs
 *
 * 先用 vite.config.single.ts 构建出 IIFE 形式的 app.js + app.css，
 * 再把它们内联进 index.html，产出一个双击即可运行、无需网络的 HTML。
 */
import { build } from "vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist-single");
const outputFile = path.join(rootDir, "flop-trainer.html");

function warn(message) {
  console.warn(`[build-single] ${message}`);
}

await build({
  configFile: path.join(rootDir, "vite.config.single.ts"),
  logLevel: "info",
});

const htmlPath = path.join(distDir, "index.html");
if (!fs.existsSync(htmlPath)) {
  throw new Error(`构建产物不存在：${htmlPath}`);
}

const entries = fs.readdirSync(distDir);
const jsFile = entries.find((file) => file.endsWith(".js"));
const cssFile = entries.find((file) => file.endsWith(".css"));

if (!jsFile) {
  throw new Error("未找到构建出的 JS 文件");
}

let html = fs.readFileSync(htmlPath, "utf8");

// 移除 modulepreload 之类的预加载链接。
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, "");

// 内联 CSS。
if (cssFile) {
  const css = fs.readFileSync(path.join(distDir, cssFile), "utf8");
  const cssTag = `<style>\n${css}\n</style>`;
  if (/<link[^>]*rel="stylesheet"[^>]*>/.test(html)) {
    html = html.replace(/<link[^>]*rel="stylesheet"[^>]*>/, () => cssTag);
  } else {
    html = html.replace("</head>", () => `${cssTag}\n</head>`);
  }
} else {
  warn("没有找到 CSS 文件，跳过内联。");
}

// 内联 JS，并替换成经典 script（IIFE），确保 file:// 双击可用。
// 经典内联 script 不会像 type="module" 那样自动 defer，
// 因此必须把它放到 </body> 之前，等 #root 存在后再执行。
let js = fs.readFileSync(path.join(distDir, jsFile), "utf8");
js = js.replace(/<\/script/gi, "<\\/script");

const scriptTag = `<script>\n${js}\n</script>`;
const scriptPattern = /<script[^>]*src="[^"]*"[^>]*><\/script>\s*/;
if (scriptPattern.test(html)) {
  html = html.replace(scriptPattern, () => "");
} else {
  warn("没有找到外链 script 标签，仍会插入到 </body> 前。");
}
html = html.replace("</body>", () => `${scriptTag}\n</body>`);

fs.writeFileSync(outputFile, html, "utf8");

// 同时把内联后的版本写回 dist-single，方便预览。
fs.writeFileSync(htmlPath, html, "utf8");

const sizeKb = (Buffer.byteLength(html, "utf8") / 1024).toFixed(1);
console.log(`\n[build-single] 已生成单文件：${outputFile}`);
console.log(`[build-single] 体积：${sizeKb} KB（无任何外部依赖，双击即可运行）`);

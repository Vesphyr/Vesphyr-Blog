// Copies the generated Zhuque font @font-face declarations into a single static
// stylesheet served from /css/font-faces.css. This keeps the (large) @font-face
// rules OUT of the bundled, render-blocking core CSS and lets the browser load them
// asynchronously. Re-run automatically as part of `pnpm build`.
//
// 输出目录刻意放在 /css/ 而不是 /fonts/：/fonts/* 在 _headers 里是 immutable 一年，
// 而这个文件名不带内容 hash，合并规则会产生两个冲突的 Cache-Control 头。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src/styles");
const outDir = path.join(root, "public/css");
const outFile = path.join(outDir, "font-faces.css");

const sources = [
  "generated-zhuque-ui-font.css",
  "generated-zhuque-font.css",
];

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  let combined = "";
  for (const name of sources) {
    const p = path.join(srcDir, name);
    const css = await fs.readFile(p, "utf-8");
    combined += `/* === ${name} === */\n${css}\n`;
  }
  await fs.writeFile(outFile, combined, "utf-8");
  const faceCount = (combined.match(/@font-face/g) || []).length;
  console.log(
    `copy-font-css: wrote ${outFile} (${combined.length} bytes, ${faceCount} @font-face)`,
  );
}

await main();

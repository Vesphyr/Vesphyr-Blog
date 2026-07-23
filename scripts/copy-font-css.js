// Copies the generated Zhuque font @font-face declarations into a single static
// stylesheet served from /fonts/font-faces.css. This keeps the (large) @font-face
// rules OUT of the bundled, render-blocking core CSS and lets the browser load them
// asynchronously. Re-run automatically as part of `pnpm build`.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "src/styles");
const outDir = path.join(root, "public/fonts");
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

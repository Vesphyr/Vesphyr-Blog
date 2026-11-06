import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "node-html-parser";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const CORE_CSS = new Set([
  "main",
  "MainGridLayout",
  "transition",
]);
const REMOVABLE_CSS = new Set([
  "vendor-katex",
  "vendor-fancybox",
  "fancybox-custom",
  // Redundant font @font-face chunks. All @font-face rules are served as a single
  // async stylesheet from /css/font-faces.css (see scripts/copy-font-css.js), so
  // these auto-emitted duplicates must not be linked (browser would fetch ~250KB
  // of redundant font CSS). Removing the links avoids the download; the files are
  // harmless dead assets in /assets/.
  "local-fonts",
  "generated-zhuque-font",
  "generated-zhuque-ui-font",
]);
const HOMEPAGE_UNUSED_CSS = new Set([
  "Cnc",
  "markdown",
  "markdown-extend",
  "expressive-code",
  "PostDetailLayout",
  "post-detail-layout",
  "floating-toc",
  "post-navigation",
]);
function cssPrefix(filename) {
  return filename.replace(/\.css$/, "").replace(/\.[A-Za-z0-9_-]+$/, "");
}
async function buildCssManifest() {
  const assetsDir = path.join(distDir, "assets");
  const files = new Set();
  try {
    const assetFiles = await fs.readdir(assetsDir);
    for (const file of assetFiles) {
      if (file.endsWith(".css")) {
        files.add(file);
      }
    }
  } catch {}
  return files;
}

const cssRuleCache = new Map();

async function cssRuleSet(filename) {
  if (cssRuleCache.has(filename)) return cssRuleCache.get(filename);
  let set = null;
  try {
    const css = await fs.readFile(path.join(distDir, "assets", filename), "utf-8");
    set = new Set(
      (css.match(/(?:@[^{}]+\{[^{}]*\}|[^{}]+\{[^{}]*\})/g) || []).map((rule) =>
        rule.trim(),
      ),
    );
  } catch {
    set = null;
  }
  cssRuleCache.set(filename, set);
  return set;
}

/**
 * 找到「规则集被同页另一个样式表完全覆盖」的样式表。
 *
 * Astro/Vite 拆分 CSS 时，页面级产物（如 MainGridLayout.*.css）会逐字复制一份
 * 全局样式，于是这类页面同时链接两份内容重叠的 CSS，白下一个 90KB 的文件。
 * 这里按规则文本做严格包含判断：只有 B 的每一条规则都原样出现在 A 中，才认为
 * B 在本页是冗余的（级联顺序无关，因为声明完全一致）。判断不出包含关系时不做
 * 任何改动，属于安全的空操作。
 */
async function findRedundantCss(filenames) {
  const redundant = new Set();
  if (filenames.length < 2) return redundant;
  const sets = new Map();
  for (const name of filenames) sets.set(name, await cssRuleSet(name));
  for (const outer of filenames) {
    const outerSet = sets.get(outer);
    if (!outerSet || outerSet.size === 0) continue;
    for (const inner of filenames) {
      if (inner === outer) continue;
      const innerSet = sets.get(inner);
      if (!innerSet || innerSet.size === 0) continue;
      if (outerSet.size <= innerSet.size) continue;
      let covers = true;
      for (const rule of innerSet) {
        if (!outerSet.has(rule)) {
          covers = false;
          break;
        }
      }
      if (covers) redundant.add(inner);
    }
  }
  // 保险：不能把所有样式表都判成冗余。
  if (redundant.size >= filenames.length) return new Set();
  return redundant;
}
function classifyCss(filename) {
  const prefix = cssPrefix(filename);
  if (REMOVABLE_CSS.has(prefix)) return "remove";
  if (CORE_CSS.has(prefix)) return "core";
  return "async";
}
function canonicalHref(href, cssManifest) {
  const filename = path.posix.basename(href);
  if (!cssManifest.has(filename)) return null;
  return `/assets/${filename}`;
}
function isCssLink(link) {
  const rel = link.getAttribute("rel");
  return (
    (rel === "stylesheet" && link.getAttribute("href")?.endsWith(".css")) ||
    (rel === "preload" && link.getAttribute("as") === "style")
  );
}
async function optimizeHtmlFile(htmlPath, cssManifest) {
  let html;
  try {
    html = await fs.readFile(htmlPath, "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const root = parse(html);
  const head = root.querySelector("head");
  if (!head) return;
  const relativeHtmlPath = path.relative(distDir, htmlPath).replace(/\\/g, "/");
  const isHomepage = relativeHtmlPath === "index.html";
  let modified = false;
  const toRemove = [];
  const toModify = [];
  const allLinks = head.querySelectorAll("link");
  const cssLinks = allLinks.filter(isCssLink);
  const linkedCssNames = [
    ...new Set(
      cssLinks
        .map((link) => path.posix.basename(link.getAttribute("href") || ""))
        .filter((name) => name && cssManifest.has(name)),
    ),
  ];
  const redundantCss = await findRedundantCss(linkedCssNames);
  for (const link of cssLinks) {
    const href = link.getAttribute("href");
    if (!href) continue;
    const filename = path.posix.basename(href);
    const prefix = cssPrefix(filename);
    if (isHomepage && HOMEPAGE_UNUSED_CSS.has(prefix)) {
      toRemove.push(link);
      modified = true;
      continue;
    }
    if (redundantCss.has(filename)) {
      toRemove.push(link);
      modified = true;
      continue;
    }
    const classification = classifyCss(filename);
    if (classification === "remove") {
      toRemove.push(link);
      modified = true;
      continue;
    }
    const canHref = canonicalHref(href, cssManifest);
    if (!canHref) continue;
    if (classification === "core") {
      if (
        link.getAttribute("rel") !== "stylesheet" ||
        link.getAttribute("href") !== canHref
      ) {
        toModify.push({ link, rel: "stylesheet", href: canHref });
        modified = true;
      }
    } else {
      if (
        link.getAttribute("rel") !== "preload" ||
        link.getAttribute("href") !== canHref ||
        !link.getAttribute("onload")
      ) {
        toModify.push({
          link,
          rel: "preload",
          href: canHref,
          as: "style",
          onload: "this.onload=null;this.rel='stylesheet'",
        });
        modified = true;
      }
    }
  }
  for (const link of toRemove) {
    link.remove();
  }
  for (const { link, rel, href, as, onload } of toModify) {
    link.setAttribute("rel", rel);
    link.setAttribute("href", href);
    if (as) link.setAttribute("as", as);
    else link.removeAttribute("as");
    if (onload) link.setAttribute("onload", onload);
    else link.removeAttribute("onload");
  }
  if (modified) {
    await fs.writeFile(htmlPath, root.toString(), "utf-8");
    console.log(`Optimized: ${path.relative(rootDir, htmlPath)}`);
  }
}
async function removeDuplicateCss(cssManifest) {
  const astroDir = path.join(distDir, "_astro");
  let removed = 0;
  try {
    const files = await fs.readdir(astroDir);
    for (const file of files) {
      if (!file.endsWith(".css")) continue;
      if (cssManifest.has(file)) {
        await fs.unlink(path.join(astroDir, file));
        removed++;
        console.log(`Removed duplicate: _astro/${file}`);
      }
    }
  } catch {}
  if (removed > 0) {
    console.log(`Removed ${removed} duplicate CSS file(s) from /_astro/`);
  }
}
async function repairKatexCssAssetPaths() {
  const assetsDir = path.join(distDir, "assets");
  try {
    const files = await fs.readdir(assetsDir);
    for (const file of files) {
      if (!file.startsWith("vendor-katex") || !file.endsWith(".css")) {
        continue;
      }
      const cssPath = path.join(assetsDir, file);
      const css = await fs.readFile(cssPath, "utf-8");
      const fixedCss = css.replace(
        /url\((['"]?)\/assets\/(KaTeX_[^)'"\\]+)\1\)/g,
        (_match, quote, assetName) =>
          `url(${quote}/_astro/${assetName}${quote})`,
      );
      if (fixedCss !== css) {
        await fs.writeFile(cssPath, fixedCss, "utf-8");
        console.log(`Repaired KaTeX font paths: assets/${file}`);
      }
    }
  } catch {}
}
async function findHtmlFiles(dir) {
  const files = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findHtmlFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }
  return files;
}
async function optimizeAll() {
  const cssManifest = await buildCssManifest();
  console.log(`Found ${cssManifest.size} CSS files in /assets/`);
  const htmlFiles = await findHtmlFiles(distDir);
  console.log(`Processing ${htmlFiles.length} HTML files...`);
  for (const file of htmlFiles) {
    await optimizeHtmlFile(file, cssManifest);
  }
  await removeDuplicateCss(cssManifest);
  await repairKatexCssAssetPaths();
}
await optimizeAll();

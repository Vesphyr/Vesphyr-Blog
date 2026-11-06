// Post-build: tighten CSP script-src from 'unsafe-inline' to exact SHA-256 hashes.
//
// Scans dist/**/*.html for inline <script> blocks and inline event-handler
// attributes (on*="..."), hashes their exact (entity-decoded) content, and
// rewrites the CSP header in dist/_headers:
//
//   script-src 'self' 'unsafe-inline'            (public/_headers, fallback)
//     -> script-src 'self' 'sha256-...' ...      (dist/_headers, deployed)
//     +  script-src-attr 'unsafe-hashes' 'sha256-...' ...
//
// New inline scripts added to pages are picked up automatically on the next
// build; anything NOT hashed is blocked by the browser. Note: once hashes are
// present, CSP2+ browsers ignore 'unsafe-inline', so the deployed policy is
// strictly allowlisted.
//
// Runs last in the build chain (after optimize-render-blocking.js), because it
// must hash the final HTML. Fails the build loudly if the CSP line is missing.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "..", "dist");
const headersFile = path.join(distDir, "_headers");

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const EVENT_HANDLER_RE = /\s(on[a-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

function sha256Csp(content) {
  return `'sha256-${crypto.createHash("sha256").update(content, "utf8").digest("base64")}'`;
}

// Attribute values are HTML-entity-encoded in source but executed decoded;
// CSP hashes must be computed over the decoded value.
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith(".html")) yield p;
  }
}

const scriptHashes = new Set();
const attrHashes = new Set();
let htmlCount = 0;

for await (const file of walk(distDir)) {
  htmlCount++;
  const html = await fs.readFile(file, "utf8");
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    scriptHashes.add(sha256Csp(m[1]));
  }
  for (const m of html.matchAll(EVENT_HANDLER_RE)) {
    attrHashes.add(sha256Csp(decodeEntities(m[2] ?? m[3] ?? "")));
  }
}

const headers = await fs.readFile(headersFile, "utf8");
if (!headers.includes("Content-Security-Policy:")) {
  throw new Error("csp-script-hashes: no Content-Security-Policy header found in dist/_headers");
}
if (!headers.includes("script-src 'self' 'unsafe-inline'")) {
  throw new Error(
    "csp-script-hashes: expected \"script-src 'self' 'unsafe-inline'\" placeholder in dist/_headers",
  );
}

const scriptSrc = ["script-src 'self'", ...[...scriptHashes].sort()].join(" ");
const scriptSrcAttr =
  attrHashes.size > 0
    ? ` script-src-attr 'unsafe-hashes' ${[...attrHashes].sort().join(" ")};`
    : "";

const updated = headers.replace(
  "script-src 'self' 'unsafe-inline';",
  `${scriptSrc};${scriptSrcAttr}`,
);
await fs.writeFile(headersFile, updated, "utf8");

console.log(
  `csp-script-hashes: scanned ${htmlCount} html files -> ` +
    `${scriptHashes.size} inline script hashes, ${attrHashes.size} handler hashes`,
);

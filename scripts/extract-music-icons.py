"""从 @iconify-json/material-symbols 提取 MusicPlayer 用到的图标，生成
src/components/widget/music-icons.ts（离线注册，避免运行时请求 api.iconify.design）。
用法：python scripts/extract-music-icons.py
"""
import json, os

NEEDED = [
    "album-outline", "block", "close", "error", "graphic-eq", "music-note",
    "pause", "play-arrow", "queue-music", "repeat", "repeat-one", "shuffle",
    "skip-next", "skip-previous", "visibility-off", "progress-activity",
]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ms = json.load(open(os.path.join(ROOT, "node_modules/@iconify-json/material-symbols/icons.json")))
missing = [n for n in NEEDED if n not in ms["icons"]]
if missing:
    raise SystemExit(f"icons missing from package: {missing}")
col = {"prefix": "material-symbols", "icons": {n: ms["icons"][n] for n in NEEDED}}
for k in ("width", "height"):
    if k in ms:
        col[k] = ms[k]

ts = (
    "// 本文件由 scripts/extract-music-icons.py 生成，请勿手改。\n"
    "import { addCollection } from \"@iconify/svelte\";\n\n"
    f"addCollection({json.dumps(col, separators=(',', ':'))} as Parameters<typeof addCollection>[0]);\n"
)
out = os.path.join(ROOT, "src/components/widget/music-icons.ts")
open(out, "w", encoding="utf-8").write(ts)
print(f"written {out} ({len(ts)} bytes, {len(NEEDED)} icons)")

#!/usr/bin/env python3
"""按全站实际用字重新生成「Zhuque Fangsong UI」子集字体。

背景：public/assets/fonts/ZhuqueFangsong-Regular-UI.woff2 原本按「约 2000 个
常用字」切片，体积 403KB，并被 Layout.astro 以 fetchpriority="high" 预加载。
但站点实际用字远少于 2000（正文长尾字符本就由 185 个 unicode-range 分片兜底），
于是每次访问都在为一个"大概率用不到"的大子集付出带宽。

本脚本在构建早期运行：
  1. 扫描 src/ 与 functions/ 下所有文本源（.md/.astro/.ts/.svelte/.js/.mjs/.css/.json），
     解析 \\uXXXX 转义后收集全部唯一字符；
  2. 以 fonts/ZhuqueFangsong-Regular.ttf 为源，subset 出只含这些字符的 woff2；
  3. 用产物 cmap 重新生成 src/styles/generated-zhuque-ui-font.css 的 unicode-range，
     保证范围与字形严格一致——将来新增内容里出现子集外的字，浏览器会自动落到
     ZhuqueFangsong 分片，不会出现豆腐块。

依赖：fonttools + brotli（CI 中由 workflow 预先 pip install）。
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE_TTF = ROOT / "fonts" / "ZhuqueFangsong-Regular.ttf"
TARGET_WOFF2 = ROOT / "public" / "assets" / "fonts" / "ZhuqueFangsong-Regular-UI.woff2"
TARGET_CSS = ROOT / "src" / "styles" / "generated-zhuque-ui-font.css"

SCAN_DIRS = [ROOT / "src", ROOT / "functions"]
SCAN_SUFFIXES = {".md", ".astro", ".ts", ".svelte", ".js", ".mjs", ".css", ".json"}

ESCAPE_RE = re.compile(r"\\u([0-9a-fA-F]{4})")


def collect_text() -> set[str]:
    chars: set[str] = set()
    # ASCII 可打印区始终保留：数字、字母、标点是 UI 的兜底。
    chars.update(chr(c) for c in range(0x20, 0x7F))
    files = [
        p
        for scan_dir in SCAN_DIRS
        for p in scan_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SCAN_SUFFIXES
    ]
    for p in files:
        raw = p.read_text(encoding="utf-8", errors="ignore")
        # 源码里的 \uXXXX 字面量（如 config.ts 的 keywords）也要还原成真实字符。
        raw = ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), raw)
        chars.update(raw)
    # 去掉控制字符与替换符。
    chars = {c for c in chars if ord(c) >= 0x20 and c != "\ufffd"}
    return chars


def format_unicode_range(codepoints: set[int]) -> str:
    points = sorted(codepoints)
    parts: list[str] = []
    run_start = prev = points[0]
    for cp in points[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        parts.append(f"U+{run_start:X}" if run_start == prev else f"U+{run_start:X}-{prev:X}")
        run_start = prev = cp
    parts.append(f"U+{run_start:X}" if run_start == prev else f"U+{run_start:X}-{prev:X}")
    return ", ".join(parts)


def read_cmap(font_path: Path) -> set[int]:
    from fontTools.ttLib import TTFont

    font = TTFont(str(font_path))
    codepoints: set[int] = set()
    for table in font["cmap"].tables:
        if table.isUnicode():
            codepoints.update(table.cmap.keys())
    font.close()
    return codepoints


def main() -> int:
    if not SOURCE_TTF.exists():
        print(f"subset-ui-font: source not found: {SOURCE_TTF}", file=sys.stderr)
        return 1

    chars = collect_text()
    text = "".join(sorted(chars))
    char_file = ROOT / ".font-subset-chars.txt"
    char_file.write_text(text, encoding="utf-8")

    TARGET_WOFF2.parent.mkdir(parents=True, exist_ok=True)
    old_size = TARGET_WOFF2.stat().st_size if TARGET_WOFF2.exists() else 0

    subprocess.run(
        [
            sys.executable,
            "-m",
            "fontTools.subset",
            str(SOURCE_TTF),
            f"--text-file={char_file}",
            "--flavor=woff2",
            f"--output-file={TARGET_WOFF2}",
            "--drop-tables+=DSIG",
            "--no-hinting",
            "--desubroutinize",
        ],
        check=True,
    )
    char_file.unlink(missing_ok=True)

    codepoints = read_cmap(TARGET_WOFF2)
    css = (
        "@font-face {\n"
        '  font-family: "Zhuque Fangsong UI";\n'
        '  src: url("/assets/fonts/ZhuqueFangsong-Regular-UI.woff2") format("woff2");\n'
        "  font-weight: 400;\n"
        "  font-style: normal;\n"
        "  font-display: swap;\n"
        "  /* 由 scripts/subset-ui-font.py 按全站实际用字生成，\n"
        "     范围与字形一一对应；范围外的字符走 ZhuqueFangsong 分片。 */\n"
        f"  unicode-range: {format_unicode_range(codepoints)};\n"
        "}\n"
    )
    TARGET_CSS.write_text(css, encoding="utf-8", newline="\n")

    new_size = TARGET_WOFF2.stat().st_size
    print(
        f"subset-ui-font: {len(chars)} chars -> {len(codepoints)} glyphs, "
        f"{old_size / 1024:.0f}KB -> {new_size / 1024:.0f}KB "
        f"({(1 - new_size / old_size) * 100:.0f}% smaller)" if old_size else
        f"subset-ui-font: {len(chars)} chars -> {len(codepoints)} glyphs, {new_size / 1024:.0f}KB"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

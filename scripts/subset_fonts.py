#!/usr/bin/env python3
"""Subset the bundled OFL fonts to kana + ASCII + common symbols for fast web loading.

One-off asset generation (NOT an app build step). Requires fontTools:
    python3 -m venv .venv && .venv/bin/pip install fonttools
    .venv/bin/python scripts/subset_fonts.py

Reads  fonts/src/<name>.ttf   (full originals, kept in the repo)
Writes fonts/<name>.ttf       (subset actually served by the app)

OFL note: fonts that declare a Reserved Font Name may not use that name in a
Modified Version — such subsets get " Subset" appended to their internal names.
UI labels in js/font.js are independent of the internal names.
"""
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "fonts", "src")
DST = os.path.join(ROOT, "fonts")

# hiragana, katakana (incl. halfwidth-free forms and iteration marks), ASCII,
# and symbols people actually put on charms
UNICODES = ",".join([
    "U+0020-007E",            # ASCII
    "U+3041-3096", "U+309B-309E",  # hiragana + voicing marks + iteration
    "U+30A0-30FA", "U+30FC-30FE",  # katakana + ー + iteration
    "U+3001-3002", "U+300C-300F", "U+3005",  # 、。「」『』々
    "U+FF01", "U+FF1F", "U+FF06", "U+FF0B", "U+FF0D", "U+FF5E",  # ！？＆＋－〜
    "U+2665", "U+2661", "U+2605", "U+2606", "U+266A", "U+25CB", "U+25CF",  # ♥♡★☆♪〇●
    "U+00D7", "U+30FB",       # ×・
])

# fonts whose OFL header declares a Reserved Font Name (checked in fonts/licenses/;
# only Titan One does — "with Reserved Font Name Titan")
RFN = {"TitanOne-Regular.ttf"}


def rename_internal(path: str) -> None:
    font = TTFont(path)
    name = font["name"]
    for nid in (1, 3, 4, 6, 16):
        for rec in name.names:
            if rec.nameID == nid:
                s = rec.toUnicode()
                if "Subset" not in s:
                    rec.string = s + " Subset"
    font.save(path)


def main() -> None:
    if not os.path.isdir(SRC):
        sys.exit(f"missing {SRC} — move the full originals to fonts/src/ first")
    for fn in sorted(os.listdir(SRC)):
        if not fn.endswith(".ttf"):
            continue
        src, dst = os.path.join(SRC, fn), os.path.join(DST, fn)
        subset.main([
            src,
            f"--unicodes={UNICODES}",
            "--layout-features=*",
            "--name-IDs=0,1,2,3,4,6,13,14,16,17",
            "--drop-tables+=DSIG",
            f"--output-file={dst}",
        ])
        if fn in RFN:
            rename_internal(dst)
        a, b = os.path.getsize(src), os.path.getsize(dst)
        print(f"{fn}: {a//1024}KB -> {b//1024}KB")


if __name__ == "__main__":
    main()

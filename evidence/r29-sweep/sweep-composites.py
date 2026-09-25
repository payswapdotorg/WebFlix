#!/usr/bin/env python3
"""R29 PRODUCTION SWEEP — SIDE-BY-SIDE COMPOSITES (the r28-sweep vs-* pattern).
Corpus left / production right, 2880x934 (a 34px dark label strip + two
1440x900 panes). Corpus: docs/parity-lab/reference/screenshots/*.png.
Usage: python3 evidence/r29-sweep/sweep-composites.py
"""
from PIL import Image, ImageDraw, ImageFont
import os

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SWEEP = os.path.join(REPO, "evidence", "r29-sweep")
CORPUS = os.path.join(REPO, "docs", "parity-lab", "reference", "screenshots")

HEADER_BG = (16, 16, 16)
HEADER_FG = (240, 240, 240)

def load_font(size: int):
    for path in [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

FONT = load_font(15)

def composite(name: str, corpus_path: str, prod_path: str, left_label: str, right_label: str):
    corpus = Image.open(corpus_path).convert("RGB")
    prod = Image.open(prod_path).convert("RGB")
    assert corpus.size == (1440, 900), f"{corpus_path}: {corpus.size}"
    assert prod.size == (1440, 900), f"{prod_path}: {prod.size}"
    out = Image.new("RGB", (2880, 934), HEADER_BG)
    out.paste(corpus, (0, 34))
    out.paste(prod, (1440, 34))
    d = ImageDraw.Draw(out)
    d.text((10, 8), left_label, fill=HEADER_FG, font=FONT)
    d.text((1450, 8), right_label, fill=HEADER_FG, font=FONT)
    d.line([(1440, 0), (1440, 934)], fill=(60, 60, 60), width=1)
    dest = os.path.join(SWEEP, name)
    out.save(dest)
    print(f"{name}: {out.size} <- {os.path.relpath(corpus_path, REPO)} | {os.path.relpath(prod_path, REPO)}")

PROD = "webflix-steel.vercel.app · main @ 1a3b594 · R29 sweep"

composite("vs-home.light.png",
          os.path.join(CORPUS, "yt-home-1440.png"),
          os.path.join(SWEEP, "home.light.png"),
          "CORPUS — YouTube home feed (yt-home-1440.png)",
          f"PRODUCTION — WebFlix home light ({PROD})")

composite("vs-search.light.png",
          os.path.join(CORPUS, "yt-search-1440.png"),
          os.path.join(SWEEP, "search-results.light.png"),
          "CORPUS — YouTube search (yt-search-1440.png)",
          f"PRODUCTION — WebFlix search light ({PROD})")

composite("vs-search.dark.png",
          os.path.join(CORPUS, "yt-search-dark-1440.png"),
          os.path.join(SWEEP, "search.dark.png"),
          "CORPUS — YouTube search dark (yt-search-dark-1440.png)",
          f"PRODUCTION — WebFlix search dark ({PROD})")

composite("vs-player.light.png",
          os.path.join(CORPUS, "yt-watch-1440.png"),
          os.path.join(SWEEP, "player.light.png"),
          "CORPUS — YouTube watch (yt-watch-1440.png)",
          f"PRODUCTION — WebFlix /player light ({PROD})")

composite("vs-player.dark.png",
          os.path.join(CORPUS, "yt-watch-1440.png"),
          os.path.join(SWEEP, "player.dark.png"),
          "CORPUS — YouTube watch (yt-watch-1440.png)",
          f"PRODUCTION — WebFlix /player dark ({PROD})")

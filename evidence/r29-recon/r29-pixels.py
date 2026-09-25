#!/usr/bin/env python3
"""R29-C pixel-field survey — same method as R28 (3px-grid sample, 8-bit
buckets). Classifies the raised-gray share of a 1440x900 home capture.
Usage: python3 r29-pixels.py <png> [<png> ...]"""
import sys
from PIL import Image
from collections import Counter

def survey(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    c = Counter()
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, g, b = im.getpixel((x, y))
            # quantize to 8-bit buckets
            c[(r // 8 * 8, g // 8 * 8, b // 8 * 8)] += 1
    total = sum(c.values())
    # classify (bucket-precise: #ffffff field quantizes to bucket 248; the
    # corpus raised-light #f2f2f2 quantizes to bucket 240 — adjacent buckets,
    # so the boundary is: >=246 = white field, 216-245 = raised light family)
    near_black = 0   # #0f0f0f-family field (dark mode)
    near_white = 0   # #ffffff-family field (light mode)
    raised_dark = 0  # #272727-family
    raised_light = 0 # #f2f2f2-family
    colorful = 0
    for (r, g, b), n in c.items():
        lum = (r + g + b) / 3
        if lum <= 19:
            near_black += n
        elif lum >= 246:
            near_white += n
        elif 20 <= lum <= 70 and abs(r - g) <= 12 and abs(g - b) <= 12:
            raised_dark += n
        elif 216 <= lum <= 245 and abs(r - g) <= 12 and abs(g - b) <= 12:
            raised_light += n
        else:
            colorful += n
    top = ", ".join(f"#{r:02x}{g:02x}{b:02x} {100*n/total:.1f}%" for (r, g, b), n in c.most_common(4))
    dark_mode = near_black > near_white
    print(f"== {path} ({w}x{h}, {total} samples) ==")
    print(f"  near-black field: {100*near_black/total:.1f}%  near-white: {100*near_white/total:.1f}%")
    print(f"  raised dark-gray (#272727-family): {100*raised_dark/total:.1f}%")
    print(f"  raised light-gray (#f2f2f2-family): {100*raised_light/total:.1f}%")
    print(f"  colorful (artwork/text/other): {100*(colorful)/total:.1f}%")
    print(f"  top buckets: {top}")
    if dark_mode:
        print(f"  >> raised-gray total (dark field): {100*(raised_dark+raised_light)/total:.1f}%  (YouTube reference <5%)")
    else:
        print(f"  >> raised-gray total (light field): {100*(raised_light+raised_dark)/total:.1f}%  (YouTube reference 4.1%)")

for p in sys.argv[1:]:
    survey(p)

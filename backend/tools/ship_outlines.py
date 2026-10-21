"""Builds frontend/src/screens/shop/outlines.json: ship outlines traced from blueprint drawings.

The Elite Dangerous Wiki keeps blueprint sheets of 35 ships (`Bp-<ship>.png` and a few named
otherwise, drawn by elite-dangerous-blog.co.uk in 2016-2023): the rear view top left, the side
view beside it (nose right), the top view under the rear one and the bottom view beside it (nose
down), white lines on blue. Only the outlines are taken from them, not the drawings: the white
lines are thresholded (the sheet's grid and the yellow labels left out), closed, filled from
outside, and each view's silhouette is traced into a polygon. The top and rear views are made
symmetric and kept as halves; long straight lines inside the hull (not hatching) become panels.

Ships without a sheet can be traced from screenshots of the game's ship schematics (light lines
on dark grey: the top view on the left, the side view on the right, both nose left; no rear
view), saved as `<journal symbol>.png` in the `--screenshots` folder. The screenshots stay out
of the repository: only the outlines are kept. A sheet wins over a screenshot.

Coordinates are fractions of the ship's length, width and height (the card scales them by the
dimensions in sketches.ts): the top view [s, y] from the nose, y >= 0; the side view [s, z] with
z from the top down; the rear view [y, z], y >= 0. `source` is "sheet" or "game".

    uv run --group tools python tools/ship_outlines.py [--cache <folder>] [--screenshots <folder>]
"""

from __future__ import annotations

import argparse
import json
import tempfile
import urllib.request
from pathlib import Path

import cv2
import numpy as np

OUT = (
    Path(__file__).resolve().parents[2] / "frontend" / "src" / "screens" / "shop" / "outlines.json"
)
WIKI = "https://static.wikia.nocookie.net/elite-dangerous/images/"
HEADERS = {
    # The image host answers 403 without a browser's agent and the wiki as the referrer.
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0",
    "Referer": "https://elite-dangerous.fandom.com/",
}
# Journal ship symbol -> the sheet's path on the wiki's image host.
SHEETS = {
    "anaconda": "6/67/Bp-anaconda.png",
    "asp": "8/82/Bp-asp-explorer.png",
    "asp_scout": "1/17/Bp-asp-scout.png",
    "belugaliner": "7/73/Bp-beluga.png",
    "cobramkiii": "5/50/Bp-cobra-mk-3.png",
    "cutter": "2/2d/Bp-imperial-cutter.png",
    "diamondback": "3/3f/Bp-diamondback-scout.png",
    "diamondbackxl": "7/78/Bp-diamondback-explorer.png",
    "empire_courier": "4/41/Bp-imperial-courier.png",
    "empire_eagle": "f/fd/Bp-imperial-eagle.png",
    "empire_trader": "1/1a/Bp-imperial-clipper.png",
    "federation_dropship": "1/12/Bp-federal-dropship.png",
    "federation_dropship_mkii": "a/a2/Bp-federal-assault-ship.png",
    "federation_gunship": "2/28/Bp-federal-gunship.png",
    "ferdelance": "d/d3/Bp-fer-de-lance.png",
    "independant_trader": "4/4f/Bp-keelback.png",
    "orca": "5/59/Bp-orca.png",
    "python": "f/f8/Bp-python.png",
    "type6": "a/a4/Bp-type6.png",
    "type7": "d/d1/Bp-type7.png",
    "type9": "4/41/Bp-type9.png",
    "viper": "f/f6/Bp-viper-mk-3.png",
    "viper_mkiv": "8/8f/Bp-viper-mk-4.png",
    "vulture": "6/68/Bp-vulture.png",
    # The same series, uploaded under other names (some drawn later: 2018-2023).
    "adder": "6/6e/Blueprint-adder.png",
    "dolphin": "c/ce/Saud_Kruger_Dolphin_Blueprint_.jpg",
    "eagle": "0/06/Blueprint-eagle.png",
    "federation_corvette": "9/9a/Federal_Corvette_Blueprint.png",
    "hauler": "5/5e/Blueprint-hauler.png",
    "krait_light": "0/0c/Krait_Phantom_Ship_Blueprint.png",
    "krait_mkii": "3/3c/Krait_MkII_Blueprint.png",
    "mamba": "6/63/Mamba-blueprint.png",
    "sidewinder": "4/45/Blueprint-sidewinder.png",
    "type9_military": "7/7f/Type-10-Defender-Blueprint.png",
    "typex_2": "0/02/Crusader_Blueprint.png",
}
SHEET_WIDTH = 1920
SIMPLIFY_PX = 1.2

Point = tuple[float, float]


def sheet(symbol: str, cache: Path) -> np.ndarray:
    path = cache / f"{symbol}.webp"
    if not path.exists():
        request = urllib.request.Request(
            WIKI + SHEETS[symbol] + "/revision/latest", headers=HEADERS
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            path.write_bytes(response.read())
    img = cv2.imread(str(path))
    if img is None:
        raise ValueError(f"{symbol}: cannot read {path}")
    if img.shape[1] != SHEET_WIDTH:
        height = round(img.shape[0] * SHEET_WIDTH / img.shape[1])
        img = cv2.resize(img, (SHEET_WIDTH, height), interpolation=cv2.INTER_AREA)
    return img


def line_mask(img: np.ndarray) -> np.ndarray:
    """The white and pale cyan lines: not the blue paper, the watermark or the yellow labels."""
    b, g, r = (img[:, :, i].astype(int) for i in range(3))
    mask = ((r > 50) & (g > 120) & (b > 170)).astype(np.uint8) * 255
    # The sheet's grid: rows and columns lit across most of the sheet.
    for y in np.where((mask > 0).mean(axis=1) > 0.4)[0]:
        mask[max(0, y - 1) : y + 2] = 0
    for x in np.where((mask > 0).mean(axis=0) > 0.4)[0]:
        mask[:, max(0, x - 1) : x + 2] = 0
    return mask


def silhouettes(mask: np.ndarray, close: int = 5) -> np.ndarray:
    """Everything the lines enclose: closed by `close` px, filled from the sheet's corner."""
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * close + 1, 2 * close + 1))
    flood = cv2.dilate(mask, kernel)
    h, w = flood.shape
    cv2.floodFill(flood, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 128)
    return cv2.erode(np.where(flood == 128, 0, 255).astype(np.uint8), kernel)


def views(sil: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, int]]:
    """The four drawings: two rows, the upper one starting within 60 px of the highest drawing."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(sil)
    top_of = lambda i: stats[i, cv2.CC_STAT_TOP]  # noqa: E731
    left_of = lambda i: stats[i, cv2.CC_STAT_LEFT]  # noqa: E731
    big = [
        i
        for i in range(1, n)
        if stats[i, cv2.CC_STAT_AREA] > 5000 and 200 < top_of(i) < 540 and left_of(i) < 1000
    ]
    first = min(top_of(i) for i in big)
    upper = sorted((i for i in big if top_of(i) < first + 60), key=left_of)
    lower = sorted((i for i in big if top_of(i) >= first + 60), key=left_of)
    if len(upper) < 2 or len(lower) < 2:
        raise ValueError("the sheet's layout is not the usual one")
    return labels, stats, {"rear": upper[0], "side": upper[1], "top": lower[0]}


def crop(
    labels: np.ndarray, stats: np.ndarray, i: int, smooth: int = 7
) -> tuple[np.ndarray, tuple[int, int]]:
    """One drawing's silhouette, cropped to it, without thin strokes stuck to it (label leaders)."""
    x, y, w, h = stats[i, :4]
    pad = 2
    m = (labels[y - pad : y + h + pad, x - pad : x + w + pad] == i).astype(np.uint8) * 255
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (smooth, smooth))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel)
    ys, xs = np.nonzero(m)
    origin = (int(x - pad + xs.min()), int(y - pad + ys.min()))
    return m[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1], origin


def symmetric(m: np.ndarray) -> np.ndarray:
    """Mirror-symmetric about the vertical centre line: both halves must agree."""
    return cv2.bitwise_and(m, cv2.flip(m, 1))


def half_outline(m: np.ndarray) -> list[Point]:
    """A symmetric silhouette's right half, from the centre line at one end to the other."""
    c = m.shape[1] // 2
    half = m.copy()
    half[:, :c] = 0
    contours, _ = cv2.findContours(half, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnt = max(contours, key=cv2.contourArea).reshape(-1, 2)
    on_axis = cnt[:, 0] <= c + 1
    # Cut the closed contour at its longest run along the centre line.
    n = len(cnt)
    best, best_end, run = 0, 0, 0
    for k in range(2 * n):
        run = run + 1 if on_axis[k % n] else 0
        if run > best:
            best, best_end = run, k % n
    path = np.roll(cnt, -(best_end + 1), axis=0)[: n - best + 1]
    path = np.vstack([[c, path[0, 1]], path, [c, path[-1, 1]]]).astype(np.float32)
    simple = cv2.approxPolyDP(path.reshape(-1, 1, 2), SIMPLIFY_PX, False).reshape(-1, 2)
    return [(float(u - c), float(v)) for u, v in simple]


def outline(m: np.ndarray) -> list[Point]:
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    simple = cv2.approxPolyDP(max(contours, key=cv2.contourArea), SIMPLIFY_PX, True)
    return [(float(u), float(v)) for u, v in simple.reshape(-1, 2)]


def panel_lines(
    lines: np.ndarray, m: np.ndarray, origin: tuple[int, int], min_len: int
) -> list[tuple[float, float, float, float]]:
    """Long straight lines inside the hull: not its outline, not hatching, one per double stroke."""
    x0, y0 = origin
    h, w = m.shape
    inner = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    sub = lines[y0 : y0 + h, x0 : x0 + w].copy()
    sub[inner == 0] = 0
    found = cv2.HoughLinesP(
        sub, 1, np.pi / 360, threshold=int(min_len * 0.35), minLineLength=min_len, maxLineGap=12
    )
    density = cv2.blur((sub > 0).astype(np.float32), (25, 25))

    def busy(g: tuple[float, float, float, float]) -> bool:
        ts = np.linspace(0.1, 0.9, 17)
        xs = np.clip((g[0] + ts * (g[2] - g[0])).astype(int), 0, w - 1)
        ys = np.clip((g[1] + ts * (g[3] - g[1])).astype(int), 0, h - 1)
        return float(density[ys, xs].mean()) > 0.15

    segments = [] if found is None else [tuple(float(c) for c in f) for f in found.reshape(-1, 4)]
    segments = sorted(
        (g for g in segments if not busy(g)), key=lambda g: -np.hypot(g[2] - g[0], g[3] - g[1])
    )
    kept: list[tuple[float, float, float, float]] = []
    for g in segments:
        d = np.array([g[2] - g[0], g[3] - g[1]])
        d /= np.linalg.norm(d)
        mid = np.array([(g[0] + g[2]) / 2, (g[1] + g[3]) / 2])
        for o in kept:
            e = np.array([o[2] - o[0], o[3] - o[1]])
            length = np.linalg.norm(e)
            e /= length
            off = mid - np.array([o[0], o[1]])
            if (
                abs(d @ e) > 0.99
                and abs(off[0] * e[1] - off[1] * e[0]) < 7
                and -10 < off @ e < length + 10
            ):
                break
        else:
            kept.append(g)
    return kept


def r4(x: float) -> float:
    return round(x, 4)


def top_half(top_m: np.ndarray) -> list[list[float]]:
    """A symmetric top view, nose down: [s, y] from the nose, s growing upwards."""
    th, tw = top_m.shape
    top = [[r4((th - 1 - y) / th), r4(u / tw)] for u, y in half_outline(top_m)]
    return top[::-1] if top[0][0] > top[-1][0] else top


def side_outline(side_m: np.ndarray) -> list[list[float]]:
    """A side view, nose right: [s, z], s growing leftwards from the right edge, z down."""
    sh, sw = side_m.shape
    return [[r4((sw - 1 - u) / sw), r4(z / sh)] for u, z in outline(side_m)]


def trace_sheet(img: np.ndarray) -> dict[str, object]:
    lines = line_mask(img)
    labels, stats, v = views(silhouettes(lines))

    top_m, top_o = crop(labels, stats, v["top"])
    top_m = symmetric(top_m)
    th, tw = top_m.shape
    top_lines = []
    for x1, y1, x2, y2 in panel_lines(lines, top_m, top_o, int(0.16 * max(th, tw))):
        a = [(th - 1 - y1) / th, (x1 - tw / 2) / tw]
        b = [(th - 1 - y2) / th, (x2 - tw / 2) / tw]
        # Kept on the right half (the card mirrors them); lines across the centre are dropped.
        if a[1] >= -0.005 and b[1] >= -0.005:
            top_lines.append([[r4(a[0]), r4(abs(a[1]))], [r4(b[0]), r4(abs(b[1]))]])

    side_m, side_o = crop(labels, stats, v["side"])
    sh, sw = side_m.shape
    side_lines = [
        [[r4((sw - 1 - x1) / sw), r4(y1 / sh)], [r4((sw - 1 - x2) / sw), r4(y2 / sh)]]
        for x1, y1, x2, y2 in panel_lines(lines, side_m, side_o, int(0.16 * sw))
    ]

    rear_m, _ = crop(labels, stats, v["rear"])
    rear_m = symmetric(rear_m)
    rh, rw = rear_m.shape
    rear = [[r4(u / rw), r4(z / rh)] for u, z in half_outline(rear_m)]
    if rear[0][1] > rear[-1][1]:
        rear.reverse()
    return {
        "source": "sheet",
        "top": top_half(top_m),
        "topLines": top_lines,
        "side": side_outline(side_m),
        "sideLines": side_lines,
        "rear": rear,
    }


def trace_game(img: np.ndarray) -> dict[str, object]:
    """A screenshot of the game's schematic: the two largest drawings, top view left, side right."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    close = max(2, round(img.shape[1] / 400))
    sil = silhouettes((gray > 70).astype(np.uint8) * 255, close)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(sil)
    if n < 3:
        raise ValueError("no two drawings found")
    big = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])[:2]
    top_i, side_i = sorted(big, key=lambda i: stats[i, cv2.CC_STAT_LEFT])
    # Turned like a sheet's views: the top view nose down, the side view nose right.
    top_m = crop(labels, stats, top_i, 2 * close - 1)[0]
    top_m = symmetric(cv2.rotate(top_m, cv2.ROTATE_90_COUNTERCLOCKWISE))
    side_m = cv2.flip(crop(labels, stats, side_i, 2 * close - 1)[0], 1)
    return {
        "source": "game",
        "top": top_half(top_m),
        "topLines": [],
        "side": side_outline(side_m),
        "sideLines": [],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--cache", type=Path, default=Path(tempfile.gettempdir()) / "edk-ship-sheets"
    )
    parser.add_argument("--screenshots", type=Path, help="<symbol>.png schematics from the game")
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    traced = {symbol: trace_sheet(sheet(symbol, args.cache)) for symbol in sorted(SHEETS)}
    for shot in sorted(args.screenshots.glob("*.png")) if args.screenshots else []:
        symbol = shot.stem.lower()
        if symbol not in traced:
            traced[symbol] = trace_game(cv2.imread(str(shot)))
    traced = dict(sorted(traced.items()))
    OUT.write_text(json.dumps(traced, separators=(",", ":")) + "\n", encoding="utf-8")
    game = [s for s, t in traced.items() if t["source"] == "game"]
    print(f"{len(traced)} ships ({len(game)} from the game: {', '.join(game) or 'none'}) -> {OUT}")


if __name__ == "__main__":
    main()

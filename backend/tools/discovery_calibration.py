"""Measures how well the discovery chance (app.discovery) predicts first discoveries, from EDDN.

When someone uploads a plotted route (EDDN navroute/1), the systems on it are looked up in
Spansh and EDSM right away, as the app does with your own route: that is the prediction. Later
journal Scan events of arrival stars (any uploader) carry WasDiscovered: the outcome. Every
arrival-star scan also counts for the base rates (by distance, star class, mass code).

    uv run python tools/discovery_calibration.py collect --hours 4
    uv run python tools/discovery_calibration.py report [--neighbours]

`collect` appends to JSON-lines files and can be stopped (or lose power) and started again: it
goes on until the hours are reached, counting the time already collected from the records
themselves (no state file to lose). Data lives in <data dir>/calibration (next to data.db). It
downloads the whole EDDN feed (~20 KiB/s) and asks Spansh / EDSM about every route uploaded
(about one request every few seconds).
"""

from __future__ import annotations

import argparse
import contextlib
import json
import math
import queue
import re
import sys
import threading
import time
import urllib.request
import zlib
from collections import defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import default_data_dir  # noqa: E402
from app.discovery import SYSTEMS_SEARCH, chance, edsm_lookup, spansh_lookup  # noqa: E402
from app.eddn import RELAY  # noqa: E402
from app.enrich import USER_AGENT  # noqa: E402
from app.navroute import star_kind  # noqa: E402

SOL = (0.0, 0.0, 0.0)
COLONIA = (-9530.5, -910.28125, 19808.125)
PROCEDURAL = re.compile(r"^.+? [A-Z][A-Z]-[A-Z] (?P<mass>[a-h])(?:\d+-)?\d+$")
LOOKUP_PAUSE_S = 1.5  # between route lookups
EDSM_PAUSE_S = 1.0  # between EDSM batches
QUEUE_MAX = 6  # routes waiting for a lookup; more are dropped (counted)
GAP_S = 120  # longer without a record: the collector was not running
FILES = ("routes", "lookups", "scans")


def default_out() -> Path:
    return default_data_dir() / "calibration"


# --------------------------------------------------------------------------- collect


def collected_seconds(out: Path) -> float:
    """Time spent collecting so far: the records' timestamps, without the gaps between runs."""
    times = sorted(
        r["t"]
        for name in FILES
        for r in read_jsonl(out / f"{name}.jsonl")
        if isinstance(r.get("t"), int | float)
    )
    return sum(b - a for a, b in zip(times, times[1:], strict=False) if b - a < GAP_S)


def open_for_append(path: Path):  # noqa: ANN201
    """Append after the last complete line (a power loss can leave one cut short)."""
    if path.exists() and path.stat().st_size > 0:
        with path.open("rb") as f:
            f.seek(-1, 2)
            if f.read(1) != b"\n":
                with path.open("ab") as g:
                    g.write(b"\n")
    return path.open("a", encoding="utf-8")


class Collector:
    def __init__(self, out: Path, seconds: float) -> None:
        out.mkdir(parents=True, exist_ok=True)
        self.out = out
        self.goal = seconds
        self.files = {n: open_for_append(out / f"{n}.jsonl") for n in FILES}
        self.counts = dict.fromkeys((*FILES, "dropped"), 0)  # this run
        self.lock = threading.Lock()
        self.work: queue.Queue[tuple[str, list[tuple[int, str]]]] = queue.Queue(maxsize=QUEUE_MAX)
        self.run = f"{int(time.time())}"
        self.routes = 0

    def write(self, name: str, record: dict[str, Any]) -> None:
        with self.lock:
            f = self.files[name]
            f.write(json.dumps(record) + "\n")
            f.flush()
            self.counts[name] += 1

    def lookup_worker(self) -> None:
        while True:
            rid, systems = self.work.get()
            systems = systems[:100]
            t = time.time()
            try:
                spansh = spansh_lookup([a for a, _ in systems])
            except Exception as exc:  # noqa: BLE001 - keep collecting
                print("spansh failed:", exc, flush=True)
                spansh = {}
            ask = [n for a, n in systems if spansh.get(a) not in (2, 3)]
            edsm: dict[str, int] = {}
            for start in range(0, len(ask), 50):
                try:
                    edsm.update(edsm_lookup(ask[start : start + 50]))
                except Exception as exc:  # noqa: BLE001
                    print("edsm failed:", exc, flush=True)
                    break
                time.sleep(EDSM_PAUSE_S)
            for a, n in systems:
                self.write(
                    "lookups",
                    {
                        "rid": rid,
                        "t": t,
                        "a": a,
                        "n": n,
                        "sp": spansh.get(a),
                        "ed": edsm.get(n.lower()),
                    },
                )
            time.sleep(LOOKUP_PAUSE_S)

    def handle(self, data: dict[str, Any]) -> None:
        schema = str(data.get("$schemaRef", ""))
        msg = data.get("message") or {}
        now = time.time()
        if "navroute" in schema:
            route = [
                (
                    int(r["SystemAddress"]),
                    str(r["StarSystem"]),
                    r.get("StarPos"),
                    r.get("StarClass"),
                )
                for r in msg.get("Route") or []
                if isinstance(r, dict)
                and r.get("SystemAddress") is not None
                and r.get("StarSystem")
            ]
            if len(route) < 3:
                return
            self.routes += 1
            rid = f"{self.run}:{self.routes}"
            self.write("routes", {"rid": rid, "t": now, "route": route})
            try:
                self.work.put_nowait((rid, [(a, n) for a, n, _, _ in route[1:]]))
            except queue.Full:
                self.counts["dropped"] += 1
        elif schema.endswith("journal/1") and msg.get("event") == "Scan":
            if (
                msg.get("DistanceFromArrivalLS") == 0
                and "StarType" in msg
                and "WasDiscovered" in msg
            ):
                self.write(
                    "scans",
                    {
                        "t": now,
                        "a": msg.get("SystemAddress"),
                        "n": msg.get("StarSystem"),
                        "pos": msg.get("StarPos"),
                        "cls": msg.get("StarType"),
                        "was": msg.get("WasDiscovered"),
                    },
                )

    def collect(self) -> None:
        import zmq

        done = collected_seconds(self.out)
        if done >= self.goal:
            print(f"already collected {done / 3600:.2f} h of {self.goal / 3600:.2f} h", flush=True)
            return
        print(
            f"collecting into {self.out}: {done / 3600:.2f} h done of {self.goal / 3600:.2f} h",
            flush=True,
        )
        threading.Thread(target=self.lookup_worker, name="lookups", daemon=True).start()
        sock = zmq.Context.instance().socket(zmq.SUB)
        sock.setsockopt(zmq.SUBSCRIBE, b"")
        sock.setsockopt(zmq.LINGER, 0)
        sock.connect(RELAY)
        last = time.monotonic()
        last_report = last
        while done < self.goal:
            if sock.poll(1000, zmq.POLLIN):
                with contextlib.suppress(zlib.error, ValueError):
                    self.handle(json.loads(zlib.decompress(sock.recv())))
            now = time.monotonic()
            done += now - last
            last = now
            if now - last_report >= 60:
                last_report = now
                with self.lock:
                    counts = dict(self.counts)
                print(time.strftime("%H:%M:%S"), f"{done / 3600:.2f} h", counts, flush=True)
        print("done", flush=True)


# --------------------------------------------------------------------------- report


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    out = []
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        with contextlib.suppress(ValueError):  # a line cut short by a power loss
            out.append(json.loads(line))
    return out


def mass_code(name: str | None) -> str:
    m = PROCEDURAL.match(name or "")
    return m["mass"] if m else "named"


def band(d: float | None, limits: Iterable[int]) -> str:
    if d is None:
        return "?"
    for lim in limits:
        if d < lim:
            return f"<{lim}"
    return "more"


DIST_BANDS = (1000, 2000, 3000, 5000, 10000, 20000, 70000)


def bands(limits: Iterable[int]) -> list[str]:
    """The labels of `band`, in order."""
    return [f"<{lim}" for lim in limits] + ["more", "?"]


def star_group(c: str | None) -> str:
    c = c or ""
    if c == "N":
        return "neutron"
    if c.startswith("D"):
        return "white dwarf"
    if c in ("H", "SupermassiveBlackHole"):
        return "black hole"
    if c in ("L", "T", "Y"):
        return "brown dwarf"
    if c[:1] in ("O", "B", "A"):
        return "OBA"
    if c[:1] in ("F", "G", "K"):
        return "FGK"
    if c[:1] == "M":
        return "M"
    return "other"


def table(
    title: str, rows: list[dict[str, Any]], key: Callable[[dict[str, Any]], Any], order=None
) -> None:
    groups: dict[Any, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        g = groups[key(r)]
        g[0] += 1
        g[1] += int(r["first"])
    print(f"\n{title}")
    for k in order or sorted(groups, key=str):
        if k in groups:
            n, f = groups[k]
            print(f"  {k!s:>28}  n={n:5d}  first={f:5d}  {f / n:6.1%}")


def neighbours(pos: tuple[float, float, float], radius: float) -> int | None:
    payload = {
        "reference_coords": {"x": pos[0], "y": pos[1], "z": pos[2]},
        "size": 1,
        "page": 0,
        "filters": {"distance": {"min": "0", "max": str(radius)}},
    }
    req = urllib.request.Request(
        SYSTEMS_SEARCH,
        data=json.dumps(payload).encode("utf-8"),
        headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310
            return json.loads(resp.read()).get("count")
    except Exception:  # noqa: BLE001
        return None


def report(out: Path, with_neighbours: bool) -> None:
    routes, lookups, scans = (read_jsonl(out / f"{n}.jsonl") for n in FILES)
    print(
        f"{out}: {collected_seconds(out) / 3600:.2f} h, {len(routes)} routes, "
        f"{len(lookups)} lookups, {len(scans)} scans"
    )

    # Base rates: every system's first arrival-star scan.
    first_scan: dict[int, dict[str, Any]] = {}
    for s in scans:
        if s.get("a") is not None and s.get("pos") and s["a"] not in first_scan:
            first_scan[s["a"]] = s
    base = [
        {
            "first": not s["was"],
            "mass": mass_code(s["n"]),
            "star": star_group(s["cls"]),
            "sol": math.dist(s["pos"], SOL),
            "colonia": math.dist(s["pos"], COLONIA),
        }
        for s in first_scan.values()
    ]
    print(
        f"\n== Base rates: {len(base)} systems, {sum(r['first'] for r in base)} first discoveries"
    )
    table(
        "by distance from Sol (ly)", base, lambda r: band(r["sol"], DIST_BANDS), bands(DIST_BANDS)
    )
    table("by star", base, lambda r: r["star"])
    table(
        "by mass code, far from the bubble and Colonia",
        [r for r in base if r["sol"] > 3000 and r["colonia"] > 1000],
        lambda r: r["mass"],
    )

    # Predictions (the first lookup of each system) against outcomes (a scan after it).
    where: dict[int, tuple[Any, Any]] = {}
    for r in routes:
        for a, _n, p, c in r["route"]:
            if p and len(p) == 3:
                where[a] = (tuple(p), c)
    asked: dict[int, dict[str, Any]] = {}
    for lk in lookups:
        asked.setdefault(lk["a"], lk)
    cal = []
    seen: set[int] = set()
    for s in scans:
        lk = asked.get(s.get("a"))
        if lk is None or s["t"] <= lk["t"] or s["a"] in seen:
            continue
        seen.add(s["a"])
        pos, cls = where.get(s["a"], (None, None))
        c = chance(lk["sp"], lk["ed"], pos, star_kind(cls) if cls else None)
        cal.append(
            {
                "first": not s["was"],
                "p": c.probability,
                "state": c.state,
                "reasons": " + ".join(c.reasons),
                "mass": mass_code(s["n"]),
                "star": star_group(s["cls"]),
                "sol": math.dist(pos, SOL) if pos else None,
                "colonia": math.dist(pos, COLONIA) if pos else None,
                "pos": pos,
            }
        )
    print(f"\n== Predictions against outcomes: {len(cal)} systems")
    table(
        "by state", cal, lambda r: r["state"], ["scanned", "bodies", "seen", "unknown", "pending"]
    )
    table("by reasons", cal, lambda r: r["reasons"])
    grey = [r for r in cal if r["state"] in ("seen", "unknown")]
    table(
        "seen / unknown: by distance from Sol (ly)",
        grey,
        lambda r: band(r["sol"], DIST_BANDS),
        bands(DIST_BANDS),
    )
    table(
        "seen / unknown: by distance from Colonia (ly)",
        grey,
        lambda r: band(r["colonia"], (500, 1000, 2000, 5000)),
        bands((500, 1000, 2000, 5000)),
    )
    table("seen / unknown: by star", grey, lambda r: r["star"])
    table("seen / unknown: by mass code", grey, lambda r: r["mass"])
    if cal:
        brier = sum(((r["p"] or 0) - r["first"]) ** 2 for r in cal) / len(cal)
        expected = sum(r["p"] or 0 for r in cal)
        print(
            f"\ncurrent model: {expected:.1f} first discoveries expected, "
            f"{sum(r['first'] for r in cal)} found, Brier {brier:.4f}"
        )
    if with_neighbours and grey:
        for r in grey:
            r["n25"] = neighbours(r["pos"], 25) if r["pos"] else None
            time.sleep(0.5)
        table(
            "seen / unknown: systems Spansh knows within 25 ly",
            grey,
            lambda r: band(r["n25"], (5, 20, 50, 100, 200, 500, 1000, 10001)),
            bands((5, 20, 50, 100, 200, 500, 1000, 10001)),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect", help="listen to EDDN until the hours are collected (resumable)")
    c.add_argument("--hours", type=float, default=4.0, help="total, across runs (default 4)")
    c.add_argument("--out", type=Path, default=default_out())
    r = sub.add_parser("report", help="tables of what was collected")
    r.add_argument("--out", type=Path, default=default_out())
    r.add_argument(
        "--neighbours", action="store_true", help="also ask Spansh how crowded each place is"
    )
    args = parser.parse_args()
    if args.cmd == "collect":
        Collector(args.out, args.hours * 3600).collect()
    else:
        report(args.out, args.neighbours)


if __name__ == "__main__":
    main()

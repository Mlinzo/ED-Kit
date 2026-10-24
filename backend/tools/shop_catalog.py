"""Builds app/data/shop.json: the ships and modules the Shop tab can look for.

Ships and modules come from EDCD FDevIDs (`shipyard.csv`, `outfitting.csv`), the tables EDMC
and Spansh name them by. Left out: suits and on-foot gear, ship armour (each ship's own, sold
wherever the ship is serviced), and modules Spansh has at no station at all (Guardian modules,
removed scanners...): asked one by one, a minute or so. A ship no station sells is kept,
marked `unsold`: a new ship comes out for ARX first (a gone one is `removed` in FDevIDs).
Ship-launched vessels (`LAUNCHED`) are added by hand while no source lists them. The starter
kit's `_free` copies of modules are left out too. A module is listed under the name Spansh uses
(they differ for one fighter hangar), with its variants (class, rating, mount, missile
guidance) by journal symbol.

Prices and characteristics come from EDSY's data (https://edsy.org/eddb.js; EDSY by taleden,
CC BY-NC 4.0; the game data in it is Frontier's): a ship's base price, speeds, shields, armour,
hull mass, hardness, mass lock, crew seats, slots and whether a fighter hangar fits; a module's
price, mass, power draw, integrity and the figures of its kind (`STAT_KEYS`). EDSY's file is
JavaScript: Node reads it.

    uv run python tools/shop_catalog.py
"""

from __future__ import annotations

import csv
import io
import json
import subprocess
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FDEVIDS = "https://raw.githubusercontent.com/EDCD/FDevIDs/master/"
EDSY = "https://edsy.org/eddb.js"
SPANSH = "https://spansh.co.uk/api/stations/search"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "shop.json"
HEADERS = {"User-Agent": "EDExplorerKit-tools", "Content-Type": "application/json"}
CATEGORIES = {
    "standard": "core",
    "internal": "optional",
    "hardpoint": "hardpoint",
    "utility": "utility",
}
# Big stations whose outfitting gives Spansh's module names (Sol and Colonia areas).
NAME_SAMPLES = ("Sol", "Colonia")
STARPORTS = ["Coriolis Starport", "Orbis Starport", "Ocellus Starport"]
# Ship-launched vessels: carried by a hangar module, not bought at a shipyard. The Nomad
# (Operations update, 2026-06-30, ARX early access) is in neither FDevIDs nor EDSY and its
# journal symbol is not published: a symbol of our own, dropped once a source lists the name.
LAUNCHED = [
    {"symbol": "nomad", "name": "Nomad", "hangars": ["Vessel Hangar", "Mk II Vessel Hangar"]},
]
TECH_BROKER = (
    "GUARDIAN",
    "METAHULL",
    "CAUSTIC",
    "FLECHETTE",
    "PLASMASHOCK",
    "STABILISER",
    "CORROSION",
)


# Module figures kept, in the order a card lists them (EDSY attribute names).
STAT_KEYS = (
    "fsdoptmass", "maxfuel", "jumpbst", "fuelcap", "emgcylife", "pwrcap", "heateff",
    "wepcap", "wepchg", "engcap", "engchg", "syscap", "syschg", "maxrng",
    "engoptmass", "engoptmul", "genoptmass", "genmaxmass", "genoptmul", "shieldbst",
    "kinres", "thmres", "expres", "hullrnf", "dmgprot", "shieldrnfps", "scbdur", "spinup",
    "dps", "damage", "maximumrng", "rof", "ammoclip", "ammomax", "distdraw", "thmload",
    "afmrepcap", "maxlimpet", "lpactrng", "cargocap", "scooprate", "cabincap", "bins",
    "vslots", "scanrng", "hsdur",
)  # fmt: skip
PADS = {1: "S", 2: "M", 3: "L"}


def edsy() -> dict[str, Any]:
    """EDSY's ships and modules (its file is a script: Node evaluates it)."""
    req = urllib.request.Request(EDSY, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        source = resp.read().decode("utf-8-sig")
    script = (
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "const e=new Function(s+';return eddb;')();"
        "process.stdout.write(JSON.stringify({ship:e.ship,module:e.module},"
        "(k,v)=>typeof v==='number'&&!isFinite(v)?null:v))})"
    )
    out = subprocess.run(
        ["node", "-e", script], input=source, capture_output=True, text=True, encoding="utf-8",
        check=True, shell=False,
    )  # fmt: skip
    return json.loads(out.stdout)


def ship_stats(e: dict[str, Any], hangar: set[str]) -> dict[str, Any]:
    slots = e["slots"]
    return {
        "pad": PADS.get(e.get("class")),
        "price": e.get("retail"),
        "speed": e.get("topspd"),
        "boost": e.get("bstspd"),
        "shields": e.get("shields"),
        "armour": e.get("armour"),
        "mass": e.get("mass"),
        "hardness": e.get("hardness"),
        "masslock": e.get("masslock"),
        "crew": e.get("crew"),
        # EDSY's components start with the bulkheads (size 1 as a placeholder): left out.
        "core": slots["component"][1:],
        "internal": slots["internal"],
        "military": slots.get("military") or [],
        "hardpoints": [n for n in slots["hardpoint"] if n > 0],
        "utility": sum(1 for n in slots["hardpoint"] + slots["utility"] if n == 0),
        "fighter_bay": str(e["id"]) in hangar,
    }


def module_stats(e: dict[str, Any]) -> dict[str, Any]:
    return {
        "price": e.get("cost"),
        "mass": e.get("mass", 0),
        "power": e.get("pwrdraw", 0),
        "integrity": e.get("integ"),
        "stats": {k: e[k] for k in STAT_KEYS if isinstance(e.get(k), int | float)},
    }


def _get(path: str) -> list[dict[str, str]]:
    req = urllib.request.Request(FDEVIDS + path, headers={"User-Agent": HEADERS["User-Agent"]})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))


def _search(filters: dict[str, Any], size: int = 1, reference: str = "Sol") -> dict[str, Any]:
    body = {"filters": filters, "sort": [{"distance": {"direction": "asc"}}], "size": size}
    body["reference_system"] = reference
    req = urllib.request.Request(SPANSH, data=json.dumps(body).encode(), headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def spansh_names() -> dict[str, str]:
    """Module symbol (lower case) -> the name Spansh gives it."""
    names: dict[str, str] = {}
    for reference in NAME_SAMPLES:
        data = _search({"type": {"value": STARPORTS}}, size=15, reference=reference)
        for station in data.get("results") or []:
            for m in station.get("modules") or []:
                names[str(m["ed_symbol"]).lower()] = str(m["name"])
    return names


def unlock_of(entitlement: str) -> str | None:
    if entitlement.startswith("ELITE_SPECIFIC_V_POWER"):
        return "powerplay"
    if any(word in entitlement for word in TECH_BROKER):
        return "techbroker"
    return None


def build() -> dict[str, Any]:
    names = spansh_names()
    data = edsy()
    edsy_ships = {str(e["fdname"]).lower(): e for e in data["ship"].values() if e.get("fdname")}
    edsy_modules = {str(e["fdname"]).lower(): e for e in data["module"].values() if e.get("fdname")}
    # The ships a fighter hangar fits: EDSY lists them in each hangar's `reserved` (ship ids).
    hangar = {
        ship_id
        for e in data["module"].values()
        if e.get("mtype") == "ifh" and not e.get("hidden")
        for ship_id in e.get("reserved") or {}
    }
    ships = [
        {"symbol": r["symbol"].lower(), "name": r["name"]}
        | (
            {"stats": ship_stats(edsy_ships[r["symbol"].lower()], hangar)}
            if r["symbol"].lower() in edsy_ships
            else {}
        )
        for r in _get("shipyard.csv")
        if r["entitlement"] != "removed"
    ]
    # Ships newer than FDevIDs (EDSY lists them first).
    listed = {s["symbol"] for s in ships}
    newer = [
        {"symbol": symbol, "name": e["name"], "stats": ship_stats(e, hangar)}
        for symbol, e in edsy_ships.items()
        if symbol not in listed and e.get("stype") == "sh" and e.get("slots")
    ]
    ships += newer
    modules: dict[str, dict[str, Any]] = {}
    for r in _get("outfitting.csv"):
        category = CATEGORIES.get(r["category"])
        symbol = r["symbol"].lower()
        if category is None or r["ship"] or r["entitlement"] in ("removed", "?"):
            continue  # suits, armour, gone from the game
        if symbol.endswith("_free"):
            continue  # the starter kit's copies of a module: never sold
        name = names.get(symbol, r["name"])
        found = edsy_modules.get(symbol)
        item = modules.setdefault(
            name,
            {"name": name, "category": category, "type": None, "unlock": None, "variants": []},
        )
        item["unlock"] = item["unlock"] or unlock_of(r["entitlement"])
        item["type"] = item["type"] or (found or {}).get("mtype")
        item["variants"].append(
            {
                "symbol": symbol,
                "class": int(r["class"]),
                "rating": r["rating"],
                "mount": r["mount"] or None,
                "guidance": r["guidance"] or None,
            }
            | (module_stats(found) if found else {})
        )

    def sold(kind: str, name: str) -> bool:
        return int(_search({kind: [{"name": {"value": [name]}}]}).get("count") or 0) > 0

    with ThreadPoolExecutor(4) as pool:
        ship_sold = list(pool.map(lambda s: sold("ships", s["name"]), ships))
        module_sold = list(pool.map(lambda n: sold("modules", n), modules))
    for s, ok in zip(ships, ship_sold, strict=True):
        if not ok:
            s["unsold"] = True
    dropped = [n for n, ok in zip(modules, module_sold, strict=True) if not ok]
    order = {"core": 0, "optional": 1, "hardpoint": 2, "utility": 3}
    kept = [m for m, ok in zip(modules.values(), module_sold, strict=True) if ok]
    ship_names = {s["name"].lower() for s in ships}
    sold_modules = {m["name"] for m in kept}
    ships += [
        v | {"hangars": [h for h in v["hangars"] if h in sold_modules], "unsold": True}
        for v in LAUNCHED
        if v["name"].lower() not in ship_names
    ]
    for m in kept:
        m["variants"].sort(
            key=lambda v: (v["class"], v["rating"], v["mount"] or "", v["guidance"] or "")
        )
    return {
        "source": (
            f"EDCD FDevIDs ({FDEVIDS}), Spansh station search, EDSY ({EDSY}, taleden, "
            f"CC BY-NC 4.0); {datetime.now(UTC):%Y-%m-%d}"
        ),
        "dropped": sorted(dropped),
        "ships": sorted(ships, key=lambda s: s["name"]),
        "modules": sorted(kept, key=lambda m: (order[m["category"]], m["name"])),
    }


def main() -> None:
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    variants = sum(len(m["variants"]) for m in data["modules"])
    no_stats = [s["name"] for s in data["ships"] if "stats" not in s]
    no_stats += [v["symbol"] for m in data["modules"] for v in m["variants"] if "price" not in v]
    print("without EDSY figures:", ", ".join(no_stats) or "none")
    print(
        f"{OUT}: {len(data['ships'])} ships, {len(data['modules'])} modules ({variants} variants)"
    )
    print("unsold:", ", ".join(s["name"] for s in data["ships"] if s.get("unsold")) or "none")
    print("dropped:", ", ".join(data["dropped"]))


if __name__ == "__main__":
    main()

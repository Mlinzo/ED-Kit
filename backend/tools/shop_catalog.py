"""Builds app/data/shop.json: the ships, modules, commodities and materials the Shop tab can
look for.

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

Commodities come from FDevIDs too (`commodity.csv`, `rare_commodity.csv`, the names Spansh's
markets use), kept when Spansh has a market with some in stock: mission and salvage cargo is
never sold. `--commodities` rebuilds only them, keeping the rest as it is.

Materials come from FDevIDs `material.csv` (type, grade, the group material traders go by;
Guardian and Thargoid ones have none: traders do not take them), with where each comes from:
the "Known Sources" list of its page on the Elite Dangerous Wiki (CC BY-SA), one line a source,
read as wikitext through the wiki's MediaWiki API (50 pages a request).
A raw element also gets the share of it that counts as much (`rich`): the 80th percentile of its
share on landable bodies near Sol, the Pleiades, Colonia and in the core (Spansh body search),
what the Shop's planet search asks for. `--materials` rebuilds only them.

    uv run python tools/shop_catalog.py [--commodities | --materials]
"""

from __future__ import annotations

import csv
import io
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FDEVIDS = "https://raw.githubusercontent.com/EDCD/FDevIDs/master/"
EDSY = "https://edsy.org/eddb.js"
SPANSH = "https://spansh.co.uk/api/stations/search"
SPANSH_BODIES = "https://spansh.co.uk/api/bodies/search"
WIKI_API = "https://elite-dangerous.fandom.com/api.php"
WIKI_BATCH = 50  # pages per API request (the MediaWiki limit for anonymous users)
# Where raw elements' shares are sampled: the bubble, the Pleiades, Colonia, toward the core.
RICH_SAMPLES = ("Sol", "Merope", "Colonia", "Synuefe EN-H d11-96")
RICH_QUANTILE = 0.8
TYPES = {"Raw": "raw", "Manufactured": "manufactured", "Encoded": "encoded"}
# The groups of manufactured and encoded materials as the game and the wiki list them.
GROUP_ORDER = [
    "Chemical", "Thermic", "Heat", "Conductive", "Mechanical Components", "Capacitors",
    "Shielding", "Composite", "Crystals", "Alloys",
    "Emission Data", "Wake Scans", "Shield Data", "Encryption Files", "Data Archives",
    "Encoded Firmware",
]  # fmt: skip
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


IN_STOCK = {"value": [1, 10**9], "comparison": "<=>"}


def commodities() -> list[dict[str, Any]]:
    """The commodities some market has in stock, by category then name; rare ones marked."""
    rows = [(r, False) for r in _get("commodity.csv")]
    rows += [(r, True) for r in _get("rare_commodity.csv")]

    def in_stock(name: str) -> bool:
        found = _search({"market": [{"name": name, "supply": IN_STOCK}]})
        return int(found.get("count") or 0) > 0

    with ThreadPoolExecutor(4) as pool:
        sold = list(pool.map(lambda row: in_stock(row[0]["name"]), rows))
    kept = [
        {"symbol": r["symbol"].lower(), "name": r["name"], "category": r["category"]}
        | ({"rare": True} if rare else {})
        for (r, rare), ok in zip(rows, sold, strict=True)
        if ok
    ]
    # The rare ones by name: the app lists them apart, whatever their category.
    return sorted(
        kept,
        key=lambda c: (c.get("rare", False), "" if c.get("rare") else c["category"], c["name"]),
    )


def _plain(wikitext: str) -> str:
    """A wikitext line as text: links by their label, templates and references dropped."""
    text = re.sub(r"<ref[^>]*?/>|<ref.*?</ref>", "", wikitext)
    text = re.sub(r"\{\{[^{}]*\}\}", "", text)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    text = re.sub(r"'{2,}", "", text)
    return " ".join(text.split()).replace("( ", "(").replace(" )", ")").rstrip(":")


# A sentence of the game's description that says where a material is found.
HOW_FOUND = re.compile(
    r"\b(collected|found|obtained|salvaged|scan\w*|recovered|retrieved|min(ed|ing)|harvested)\b",
    re.I,
)


def known_sources(wikitext: str) -> list[str]:
    """The "Known Sources" list of a page: one line per item, an item's own list after it
    ("Surface Prospecting: Outcrop, Metallic Meteorite"). Without one, the first sentence of the
    game's own description (the page's quote) that says where it is found."""
    found = re.search(r"^==+\s*Known Sources\s*==+\s*$(.*?)(?=^==|\Z)", wikitext, re.M | re.S)
    items: list[list[str]] = []
    for line in found.group(1).splitlines() if found else []:
        bullet = re.match(r"^(\*+)\s*(.*)$", line)
        if not bullet:
            continue
        text = _plain(bullet.group(2))
        if not text:
            continue
        if len(bullet.group(1)) == 1 or not items:
            items.append([text])
        else:
            items[-1].append(text)
    if not items:
        quote = re.search(r"\{\{quote\|(.*?)(?:\}\}|\|)", wikitext, re.I | re.S)
        text = _plain(re.sub(r"<br\s*/?>", " ", quote.group(1))) if quote else ""
        sentences = re.findall(r"[^.]+\.", text)
        return [x.strip() for x in sentences if HOW_FOUND.search(x)][:1]
    return [f"{i[0]}: {', '.join(i[1:])}" if len(i) > 1 else i[0] for i in items]


def wiki_sources(names: list[str]) -> dict[str, list[str]]:
    """Name -> where the material comes from, by its wiki page (none when the page has no such
    list), `WIKI_BATCH` pages a request."""
    out: dict[str, list[str]] = {}
    for at in range(0, len(names), WIKI_BATCH):
        batch = names[at : at + WIKI_BATCH]
        query = {
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "format": "json",
            "formatversion": "2",
            "redirects": "1",
            "titles": "|".join(batch),
        }
        req = urllib.request.Request(
            f"{WIKI_API}?{urllib.parse.urlencode(query)}",
            headers={"User-Agent": HEADERS["User-Agent"]},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))["query"]
        # Each asked name to the page it ends at (normalised, then redirected).
        final = {name: name for name in batch}
        for step in ("normalized", "redirects"):
            moved = {m["from"]: m["to"] for m in data.get(step) or []}
            final = {name: moved.get(title, title) for name, title in final.items()}
        pages = {
            page["title"]: page["revisions"][0]["slots"]["main"]["content"]
            for page in data.get("pages") or []
            if page.get("revisions")
        }
        for name, title in final.items():
            out[name] = known_sources(pages.get(title, ""))
    return out


def rich_shares() -> dict[str, float]:
    """Raw element -> the share (percent) that counts as much: `RICH_QUANTILE` of its shares on
    landable bodies around `RICH_SAMPLES`."""
    shares: dict[str, list[float]] = {}
    for reference in RICH_SAMPLES:
        body = {
            "filters": {"is_landable": {"value": True}},
            "sort": [{"distance": {"direction": "asc"}}],
            "size": 500,
            "reference_system": reference,
        }
        req = urllib.request.Request(SPANSH_BODIES, data=json.dumps(body).encode(), headers=HEADERS)
        with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
            data = json.loads(resp.read().decode("utf-8"))
        for b in data.get("results") or []:
            for m in b.get("materials") or []:
                shares.setdefault(str(m["name"]), []).append(float(m["share"]))
    return {
        name: round(sorted(values)[int(len(values) * RICH_QUANTILE)], 2)
        for name, values in shares.items()
        if len(values) >= 20
    }


def materials() -> list[dict[str, Any]]:
    """Every material by type, group, grade: where it comes from, and a raw one's rich share."""
    rows = _get("material.csv")
    for r in rows:
        r["name"] = r["name"].strip()  # "Untypical Shield Scans "
    rich = rich_shares()
    by_name = wiki_sources([r["name"] for r in rows])
    sources = [by_name[r["name"]] for r in rows]
    out = []
    for r, found in zip(rows, sources, strict=True):
        item: dict[str, Any] = {
            "symbol": r["symbol"].lower(),
            "name": r["name"],
            "type": TYPES[r["type"]],
            "grade": int(r["rarity"]),
            "group": None if r["category"] == "None" else r["category"],
            "sources": found,
        }
        if item["type"] == "raw" and r["name"] in rich:
            item["rich"] = rich[r["name"]]
        out.append(item)
    return sorted(out, key=material_order)


def material_order(m: dict[str, Any]) -> tuple[Any, ...]:
    """By type, then group in the game's order (raw ones by number; no group last), grade, name."""
    group = m["group"]
    return (
        list(TYPES.values()).index(m["type"]),
        group is None,
        GROUP_ORDER.index(group) if group in GROUP_ORDER else 0,
        group or "",
        m["grade"],
        m["name"],
    )


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
        "commodities": commodities(),
        "materials": materials(),
    }


def main() -> None:
    if "--commodities" in sys.argv[1:]:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        data["commodities"] = commodities()
        OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        rare = sum(1 for c in data["commodities"] if c.get("rare"))
        print(f"{OUT}: {len(data['commodities'])} commodities ({rare} rare)")
        return
    if "--materials" in sys.argv[1:]:
        data = json.loads(OUT.read_text(encoding="utf-8"))
        data["materials"] = materials()
        OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        bare = [m["name"] for m in data["materials"] if not m["sources"]]
        raw = [m for m in data["materials"] if m["type"] == "raw"]
        print(f"{OUT}: {len(data['materials'])} materials")
        print("without wiki sources:", ", ".join(bare) or "none")
        print("rich shares:", ", ".join(f"{m['name']} {m.get('rich')}" for m in raw))
        return
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    variants = sum(len(m["variants"]) for m in data["modules"])
    no_stats = [s["name"] for s in data["ships"] if "stats" not in s]
    no_stats += [v["symbol"] for m in data["modules"] for v in m["variants"] if "price" not in v]
    print("without EDSY figures:", ", ".join(no_stats) or "none")
    print(
        f"{OUT}: {len(data['ships'])} ships, {len(data['modules'])} modules ({variants} variants),"
        f" {len(data['commodities'])} commodities"
    )
    print("unsold:", ", ".join(s["name"] for s in data["ships"] if s.get("unsold")) or "none")
    print("dropped:", ", ".join(data["dropped"]))


if __name__ == "__main__":
    main()

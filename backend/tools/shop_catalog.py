"""Builds app/data/shop.json: the ships and modules the Shop tab can look for.

Ships and modules come from EDCD FDevIDs (`shipyard.csv`, `outfitting.csv`), the tables EDMC
and Spansh name them by. Left out: suits and on-foot gear, ship armour (each ship's own, sold
wherever the ship is serviced), and anything Spansh has at no station at all (Guardian modules,
removed scanners...): asked one by one, a minute or so. A module is listed under the name
Spansh uses (they differ for one fighter hangar), with its variants (class, rating, mount,
missile guidance) by journal symbol.

    uv run python tools/shop_catalog.py
"""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FDEVIDS = "https://raw.githubusercontent.com/EDCD/FDevIDs/master/"
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
TECH_BROKER = (
    "GUARDIAN",
    "METAHULL",
    "CAUSTIC",
    "FLECHETTE",
    "PLASMASHOCK",
    "STABILISER",
    "CORROSION",
)


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
    ships = [
        {"symbol": r["symbol"].lower(), "name": r["name"]}
        for r in _get("shipyard.csv")
        if r["entitlement"] != "removed"
    ]
    modules: dict[str, dict[str, Any]] = {}
    for r in _get("outfitting.csv"):
        category = CATEGORIES.get(r["category"])
        if category is None or r["ship"] or r["entitlement"] in ("removed", "?"):
            continue  # suits, armour, gone from the game
        symbol = r["symbol"].lower()
        name = names.get(symbol, r["name"])
        item = modules.setdefault(
            name, {"name": name, "category": category, "unlock": None, "variants": []}
        )
        item["unlock"] = item["unlock"] or unlock_of(r["entitlement"])
        item["variants"].append(
            {
                "symbol": symbol,
                "class": int(r["class"]),
                "rating": r["rating"],
                "mount": r["mount"] or None,
                "guidance": r["guidance"] or None,
            }
        )

    def sold(kind: str, name: str) -> bool:
        return int(_search({kind: [{"name": {"value": [name]}}]}).get("count") or 0) > 0

    with ThreadPoolExecutor(4) as pool:
        ship_sold = list(pool.map(lambda s: sold("ships", s["name"]), ships))
        module_sold = list(pool.map(lambda n: sold("modules", n), modules))
    dropped = [s["name"] for s, ok in zip(ships, ship_sold, strict=True) if not ok]
    dropped += [n for n, ok in zip(modules, module_sold, strict=True) if not ok]
    order = {"core": 0, "optional": 1, "hardpoint": 2, "utility": 3}
    kept = [m for m, ok in zip(modules.values(), module_sold, strict=True) if ok]
    for m in kept:
        m["variants"].sort(
            key=lambda v: (v["class"], v["rating"], v["mount"] or "", v["guidance"] or "")
        )
    return {
        "source": f"EDCD FDevIDs ({FDEVIDS}), Spansh station search; {datetime.now(UTC):%Y-%m-%d}",
        "dropped": sorted(dropped),
        "ships": sorted(
            (s for s, ok in zip(ships, ship_sold, strict=True) if ok), key=lambda s: s["name"]
        ),
        "modules": sorted(kept, key=lambda m: (order[m["category"]], m["name"])),
    }


def main() -> None:
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    variants = sum(len(m["variants"]) for m in data["modules"])
    print(
        f"{OUT}: {len(data['ships'])} ships, {len(data['modules'])} modules ({variants} variants)"
    )
    print("dropped:", ", ".join(data["dropped"]))


if __name__ == "__main__":
    main()

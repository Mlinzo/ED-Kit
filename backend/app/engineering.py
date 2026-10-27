"""Engineering goals (the Shop tab): what you want engineers to do — a kind of module, a blueprint,
the grade to reach from the one the module has, an experimental effect, how many such modules —
and the materials it takes against your stock.

Recipes: app/data/engineering.json (tools/engineering_catalog.py, from EDSY). A grade takes as
many rolls as its number at an engineer's top access level (Elite Dangerous Wiki, Engineers:
progress per roll 100 / 50 / 34 / 25 / 20 % for grades 1 to 5 at level 5; lower levels take
more), so the recipe of grade g counts g times, for every grade above the one the module has up
to the goal; an experimental effect once; all of it times the number of modules.

Stock: the journal's latest Materials event (written at each login: the whole inventory) and
what came and went after it (`DELTAS`), read from the events table when asked; each material
capped at its grade's storage (300 for grade 1 down to 100 for grade 5).

Your ship (`fitted`): the engineering on the current ship's modules, from the latest Loadout and
the rolls at engineers after it (the game writes no Loadout after a roll), so that a new goal
starts from the grade the module has.

Goals are yours (`engineering_goals`), never rebuilt from the journal.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any

from app.schemas import (
    BodyMaterialView,
    EngineeringBlueprintView,
    EngineeringCatalogView,
    EngineeringExperimentalView,
    EngineeringFittedView,
    EngineeringGoalView,
    EngineeringKindView,
    EngineeringMaterialView,
    EngineeringNeedView,
    EngineeringView,
)
from app.ships import latest_loadout

DATA = Path(__file__).parent / "data" / "engineering.json"
SHOP = DATA.with_name("shop.json")
CAPACITY = {1: 300, 2: 250, 3: 200, 4: 150, 5: 100}  # materials of each grade you can hold
MAX_COUNT = 99

SCHEMA = """
-- Your engineering goals (app.engineering): module = a kind of module (EDSY's key, e.g. cfsd),
-- blueprint and experimental = EDSY's keys; grade_from: what the module has now (0: none).
CREATE TABLE IF NOT EXISTS engineering_goals(
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  blueprint TEXT NOT NULL,
  grade_from INTEGER NOT NULL DEFAULT 0,
  grade_to INTEGER NOT NULL,
  experimental TEXT,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
) STRICT;
"""

# Journal events that change the stock after a Materials event, and how (a sign per list).
DELTAS = (
    "MaterialCollected",
    "MaterialDiscarded",
    "MaterialTrade",
    "EngineerCraft",
    "Synthesis",
    "TechnologyBroker",
    "MissionCompleted",
    "EngineerContribution",
    "ScientificResearch",
)


@cache
def _catalog() -> dict[str, Any]:
    return json.loads(DATA.read_text(encoding="utf-8"))


@cache
def _grades() -> dict[str, int]:
    """Material symbol -> grade (the Shop's catalog, then the ones only EDSY knows)."""
    grades = {m["symbol"]: m["grade"] for m in json.loads(SHOP.read_text("utf-8"))["materials"]}
    for symbol, m in _catalog()["extra_materials"].items():
        grades.setdefault(symbol, m["grade"])
    return grades


@cache
def _names() -> dict[str, str]:
    """Material symbol -> name (the Shop's catalog, then the ones only EDSY knows)."""
    names = {m["symbol"]: m["name"] for m in json.loads(SHOP.read_text("utf-8"))["materials"]}
    for symbol, m in _catalog()["extra_materials"].items():
        names.setdefault(symbol, m["name"])
    return names


def body_materials(materials: dict[str, float]) -> list[BodyMaterialView]:
    """A planet's elements (journal symbols or Spansh's names), the most first."""
    names, grades = _names(), _grades()
    out = [
        BodyMaterialView(
            symbol=(symbol := name.lower()),
            name=names.get(symbol, name.capitalize()),
            percent=round(percent, 2),
            grade=grades.get(symbol),
        )
        for name, percent in materials.items()
    ]
    return sorted(out, key=lambda m: -m.percent)


def catalog_view() -> EngineeringCatalogView:
    data = _catalog()
    return EngineeringCatalogView(
        modules=[EngineeringKindView(**k) for k in data["modules"]],
        blueprints={k: EngineeringBlueprintView(**b) for k, b in data["blueprints"].items()},
        experimentals={
            k: EngineeringExperimentalView(**x) for k, x in data["experimentals"].items()
        },
        extra_materials={
            k: EngineeringMaterialView(**m) for k, m in data["extra_materials"].items()
        },
    )


# --------------------------------------------------------------------------- your stock


def _items(ev: dict[str, Any], key: str) -> list[tuple[str, int]]:
    """(symbol, count) of a list of {Name, Count} (or Quantity) in an event."""
    out = []
    for item in ev.get(key) or []:
        if isinstance(item, dict) and item.get("Name"):
            count = item.get("Count", item.get("Quantity", 0))
            out.append((str(item["Name"]).lower(), int(count or 0)))
    return out


def _delta(ev: dict[str, Any]) -> list[tuple[str, int]]:
    """What an event adds to (positive) or takes from (negative) the stock."""
    name = ev.get("event")
    if name == "MaterialCollected":
        return [(str(ev.get("Name", "")).lower(), int(ev.get("Count") or 0))]
    if name in ("MaterialDiscarded", "ScientificResearch"):
        return [(str(ev.get("Name", "")).lower(), -int(ev.get("Count") or 0))]
    if name == "MaterialTrade":
        paid, got = ev.get("Paid") or {}, ev.get("Received") or {}
        return [
            (str(paid.get("Material", "")).lower(), -int(paid.get("Quantity") or 0)),
            (str(got.get("Material", "")).lower(), int(got.get("Quantity") or 0)),
        ]
    if name == "EngineerCraft":
        return [(s, -n) for s, n in _items(ev, "Ingredients")]
    if name in ("Synthesis", "TechnologyBroker"):
        return [(s, -n) for s, n in _items(ev, "Materials")]
    if name == "MissionCompleted":
        return _items(ev, "MaterialsReward")
    if name == "EngineerContribution" and ev.get("Type") == "Materials":
        return [(str(ev.get("Material", "")).lower(), -int(ev.get("Quantity") or 0))]
    return []


def stock(conn: sqlite3.Connection) -> tuple[dict[str, int], str | None]:
    """Your materials by symbol, and when the journal last listed them all (None: never, so
    nothing is known)."""
    row = conn.execute(
        "SELECT id, ts, raw FROM events WHERE event = 'Materials' ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if row is None:
        return {}, None
    base = json.loads(row["raw"])
    have: Counter[str] = Counter()
    for kind in ("Raw", "Manufactured", "Encoded"):
        for symbol, count in _items(base, kind):
            have[symbol] += count
    marks = ", ".join("?" * len(DELTAS))
    grades = _grades()
    for (raw,) in conn.execute(
        f"SELECT raw FROM events WHERE id > ? AND event IN ({marks}) ORDER BY id",  # noqa: S608
        (row["id"], *DELTAS),
    ):
        for symbol, change in _delta(json.loads(raw)):
            if symbol:
                cap = CAPACITY.get(grades.get(symbol, 1), 300)
                have[symbol] = max(0, min(cap, have[symbol] + change))
    return {s: n for s, n in have.items() if n > 0}, row["ts"]


# --------------------------------------------------------------------------- your ship


@cache
def _module_kinds() -> dict[str, str]:
    """Module symbol (journal, lower case) -> its kind (EDSY's key), from the Shop's catalog."""
    return {
        v["symbol"]: m["type"]
        for m in json.loads(SHOP.read_text("utf-8"))["modules"]
        if m.get("type")
        for v in m["variants"]
    }


@cache
def _blueprint_keys() -> dict[tuple[str, str], str]:
    """(kind, the journal's blueprint name, lower case) -> EDSY's key: some sensors share a name."""
    data = _catalog()
    return {
        (kind["key"], symbol): key
        for kind in data["modules"]
        for key in kind["blueprints"]
        if (symbol := data["blueprints"][key].get("symbol"))
    }


def fitted(conn: sqlite3.Connection) -> list[EngineeringFittedView]:
    """The modules of your current ship that engineers work on, with their blueprint and grade."""
    loadout = latest_loadout(conn)
    if loadout is None:
        return []
    loadout_id, ship = loadout
    # Slot -> (module symbol, blueprint name, grade)
    slots: dict[str, tuple[str, str, int]] = {}
    for m in ship.get("Modules") or []:
        if isinstance(m, dict) and m.get("Slot") and m.get("Item"):
            done = m.get("Engineering") or {}
            slots[m["Slot"]] = (
                str(m["Item"]).lower(),
                str(done.get("BlueprintName") or "").lower(),
                int(done.get("Level") or 0),
            )
    for (raw,) in conn.execute(
        "SELECT raw FROM events WHERE id > ? AND event = 'EngineerCraft' ORDER BY id", (loadout_id,)
    ):
        ev = json.loads(raw)
        if ev.get("Slot") and ev.get("Module") and ev.get("BlueprintName"):
            slots[ev["Slot"]] = (
                str(ev["Module"]).lower(),
                str(ev["BlueprintName"]).lower(),
                int(ev.get("Level") or 0),
            )
    kinds, keys = _module_kinds(), _blueprint_keys()
    engineered = {k["key"] for k in _catalog()["modules"]}
    out = []
    for item, blueprint, grade in slots.values():
        kind = kinds.get(item)
        if kind not in engineered:
            continue
        key = keys.get((kind, blueprint))
        out.append(EngineeringFittedView(module=kind, blueprint=key, grade=grade if key else 0))
    return out


# --------------------------------------------------------------------------- your goals


def _check(
    module: str, blueprint: str, grade_from: int, grade_to: int, experimental: str | None
) -> None:
    """Raises ValueError unless the goal fits the catalog."""
    data = _catalog()
    kind = next((k for k in data["modules"] if k["key"] == module), None)
    if kind is None:
        raise ValueError("unknown module kind")
    if blueprint not in kind["blueprints"]:
        raise ValueError("no such blueprint for this module")
    top = len(data["blueprints"][blueprint]["grades"])
    if not 0 <= grade_from <= grade_to <= top:
        raise ValueError("grades out of range")
    if experimental is not None and experimental not in kind["experimentals"]:
        raise ValueError("no such experimental effect for this module")
    if grade_from == grade_to and experimental is None:
        raise ValueError("nothing to engineer")


def add(
    conn: sqlite3.Connection,
    module: str,
    blueprint: str,
    grade_from: int,
    grade_to: int,
    experimental: str | None,
    count: int,
) -> int:
    _check(module, blueprint, grade_from, grade_to, experimental)
    cur = conn.execute(
        "INSERT INTO engineering_goals(module, blueprint, grade_from, grade_to, experimental, "
        "count, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)",
        (
            module,
            blueprint,
            grade_from,
            grade_to,
            experimental,
            max(1, min(MAX_COUNT, count)),
            datetime.now(UTC).isoformat(timespec="seconds"),
        ),
    )
    return int(cur.lastrowid or 0)


def update(
    conn: sqlite3.Connection,
    goal_id: int,
    module: str,
    blueprint: str,
    grade_from: int,
    grade_to: int,
    experimental: str | None,
    count: int,
) -> bool:
    _check(module, blueprint, grade_from, grade_to, experimental)
    cur = conn.execute(
        "UPDATE engineering_goals SET module = ?, blueprint = ?, grade_from = ?, grade_to = ?, "
        "experimental = ?, count = ? WHERE id = ?",
        (
            module,
            blueprint,
            grade_from,
            grade_to,
            experimental,
            max(1, min(MAX_COUNT, count)),
            goal_id,
        ),
    )
    return cur.rowcount > 0


def delete(conn: sqlite3.Connection, goal_id: int) -> bool:
    return conn.execute("DELETE FROM engineering_goals WHERE id = ?", (goal_id,)).rowcount > 0


def _goals(conn: sqlite3.Connection) -> list[EngineeringGoalView]:
    data = _catalog()
    kinds = {k["key"] for k in data["modules"]}
    return [
        EngineeringGoalView(
            id=r["id"],
            module=r["module"],
            blueprint=r["blueprint"],
            grade_from=r["grade_from"],
            grade_to=r["grade_to"],
            experimental=r["experimental"],
            count=r["count"],
        )
        for r in conn.execute("SELECT * FROM engineering_goals ORDER BY id")
        # A goal the catalog no longer knows (an app update dropped it) is kept, not shown.
        if r["module"] in kinds and r["blueprint"] in data["blueprints"]
    ]


def needs(goals: list[EngineeringGoalView]) -> Counter[str]:
    """Material symbol -> how many the goals take in all."""
    data = _catalog()
    total: Counter[str] = Counter()
    for goal in goals:
        grades = data["blueprints"][goal.blueprint]["grades"]
        for grade in range(goal.grade_from + 1, goal.grade_to + 1):
            for symbol, n in grades[grade - 1].items():
                total[symbol] += n * grade * goal.count  # `grade` rolls at the top access level
        effect = data["experimentals"].get(goal.experimental or "")
        if effect is not None:
            for symbol, n in effect["materials"].items():
                total[symbol] += n * goal.count
    return total


def engineering_view(conn: sqlite3.Connection) -> EngineeringView:
    goals = _goals(conn)
    have, listed_at = stock(conn)
    return EngineeringView(
        goals=goals,
        needs=[
            EngineeringNeedView(symbol=symbol, need=n, have=have.get(symbol, 0))
            for symbol, n in sorted(needs(goals).items())
        ],
        stock=have,
        stock_at=listed_at,
        fitted=fitted(conn),
    )

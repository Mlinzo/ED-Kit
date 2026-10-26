"""Visited systems for the History tab: where you have been and what you did there."""

from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field

from app import bookmarks, exobio
from app.facts import facts_from_json
from app.schemas import HistoryEntry, HistoryStar, HistoryView
from app.stats import NOTABLE_PLANETS, notable_star
from app.values import estimate_body_value
from app.views import cmdr_state, star_subtype

# Most remarkable first. Common finds (rings, landable with atmosphere) are left out.
NOTABLE_ORDER = (
    "elw",
    "black_hole",
    "neutron",
    "ww",
    "aw",
    "wolf_rayet",
    "gg_water_life",
    "gg_ammonia_life",
    "carbon",
    "white_dwarf",
    "giant",
    "blue_star",
    "terraformable",
)
_RANK = {key: i for i, key in enumerate(NOTABLE_ORDER)}


@dataclass(slots=True)
class _Tally:
    scanned: int = 0
    mapped: int = 0
    first_discoveries: int = 0
    first_mapped: int = 0
    first_footfalls: int = 0
    species: int = 0
    value: int = 0
    unsold: int = 0
    lost: int = 0
    notable: set[str] = field(default_factory=set)
    star: HistoryStar | None = None
    star_distance: float = math.inf  # the arrival star is the one at 0 Ls

    def add(self, value: int, sale: str) -> None:
        """Count earned or pending value; data lost on death is kept apart."""
        if sale == "lost":
            self.lost += value
            return
        self.value += value
        if sale == "unsold":
            self.unsold += value


def history_view(conn: sqlite3.Connection, fid: str | None) -> HistoryView:
    state = cmdr_state(conn, fid)
    odyssey = bool(state["odyssey"]) if state else True
    tallies: dict[int, _Tally] = defaultdict(_Tally)

    for row in conn.execute(
        "SELECT bc.system_address, bc.mapped_at, bc.efficient, bc.carto, bc.footfall_at, b.facts "
        "FROM body_cmdr bc JOIN bodies b "
        "ON b.system_address = bc.system_address AND b.body_id = bc.body_id WHERE bc.fid = ?",
        (fid,),
    ):
        t = tallies[row["system_address"]]
        facts = facts_from_json(row["facts"])
        mapped = bool(row["mapped_at"])
        t.scanned += 1
        t.mapped += mapped
        t.first_discoveries += facts.was_discovered is False
        t.first_mapped += mapped and facts.was_mapped is False
        t.first_footfalls += row["footfall_at"] is not None
        value = estimate_body_value(
            facts, odyssey=odyssey, efficient=not mapped or bool(row["efficient"])
        )
        t.add(value.dss if mapped and facts.kind == "planet" else value.fss, row["carto"])
        if facts.kind == "star":
            key = notable_star(facts.star_type)
            distance = facts.distance_ls if facts.distance_ls is not None else math.inf
            if t.star is None or distance < t.star_distance:
                t.star_distance = distance
                t.star = HistoryStar(
                    star_type=facts.star_type,
                    star_subclass=facts.star_subclass,
                    luminosity=facts.luminosity,
                    subtype=star_subtype(facts),
                )
        else:
            key = NOTABLE_PLANETS.get(facts.planet_class or "")
            if facts.terraform_state in ("Terraformable", "Terraforming"):
                t.notable.add("terraformable")
        if key in _RANK:
            t.notable.add(key)

    for scan in conn.execute(
        "SELECT system_address, species, value, bonus, sale FROM organic_scans "
        "WHERE fid = ? AND status = 'analysed'",
        (fid,),
    ):
        t = tallies[scan["system_address"]]
        t.species += 1
        value = scan["value"]
        if value is None:
            species = exobio.get_species(scan["species"])
            value = species.base_value if species else 0
        t.add(value + (scan["bonus"] or 0), scan["sale"])

    bio = {
        r["system_address"]: r["n"]
        for r in conn.execute(
            "SELECT system_address, SUM(count) AS n FROM body_signals WHERE kind = 'bio' "
            "GROUP BY system_address"
        )
    }

    marked = bookmarks.of_systems(conn)
    inner = bookmarks.inner_counts(conn)
    systems: list[HistoryEntry] = []
    for row in conn.execute(
        "SELECT v.system_address AS address, s.name, COUNT(*) AS visits, "
        "MIN(v.ts) AS first_at, MAX(v.ts) AS last_at, MAX(v.id) AS last_id, "
        "s.body_count, s.all_found, e.body_count AS ext_count "
        "FROM visits v JOIN systems s ON s.address = v.system_address "
        "LEFT JOIN ext_systems e ON e.address = v.system_address "
        "WHERE v.fid = ? GROUP BY v.system_address ORDER BY last_id DESC",
        (fid,),
    ):
        t = tallies.get(row["address"]) or _Tally()
        systems.append(
            HistoryEntry(
                address=str(row["address"]),
                name=row["name"],
                first_visit_at=row["first_at"],
                last_visit_at=row["last_at"],
                visits=row["visits"],
                main_star=t.star,
                body_count=row["body_count"] if row["body_count"] is not None else row["ext_count"],
                all_bodies_found=bool(row["all_found"]),
                bodies_scanned=t.scanned,
                bodies_mapped=t.mapped,
                bio_signals=bio.get(row["address"], 0),
                species_analysed=t.species,
                first_discoveries=t.first_discoveries,
                first_mapped=t.first_mapped,
                first_footfalls=t.first_footfalls,
                value=t.value,
                unsold_value=t.unsold,
                lost_value=t.lost,
                notable=sorted(t.notable, key=_RANK.__getitem__),
                bookmark=bookmarks.view(marked[row["address"]])
                if row["address"] in marked
                else None,
                inner_bookmarks=inner.get(row["address"], 0),
            )
        )

    current = state["system_address"] if state else None
    return HistoryView(
        current_address=str(current) if current is not None else None, systems=systems
    )

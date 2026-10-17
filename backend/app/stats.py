"""All-time statistics for the Stats tab."""

from __future__ import annotations

import json
import math
import sqlite3
from collections import defaultdict
from typing import Any

from app import exobio
from app.exobio import catalog as exobio_catalog
from app.facts import facts_from_json
from app.schemas import (
    DayStats,
    DeathView,
    FirstEntry,
    GenusProgress,
    KillerView,
    NamedValue,
    StatCount,
    StatsView,
)
from app.values import estimate_body_value
from app.views import cmdr_name, cmdr_state, short_name, star_subtype

NOTABLE_PLANETS = {
    "Earthlike body": "elw",
    "Water world": "ww",
    "Ammonia world": "aw",
    "Gas giant with water based life": "gg_water_life",
    "Gas giant with ammonia based life": "gg_ammonia_life",
}


def notable_star(star_type: str | None) -> str | None:
    code = star_type or ""
    if code == "N":
        return "neutron"
    if code in ("H", "SupermassiveBlackHole"):
        return "black_hole"
    if code.startswith("D"):
        return "white_dwarf"
    if code.startswith("W"):
        return "wolf_rayet"
    if code.startswith("C") or code in ("MS", "S"):
        return "carbon"
    if "Giant" in code:
        return "giant"
    if code in ("O", "B"):
        return "blue_star"
    return None


def _one(conn: sqlite3.Connection, sql: str, *args: Any) -> sqlite3.Row:
    return conn.execute(sql, args).fetchone()


def stats_view(conn: sqlite3.Connection, fid: str | None) -> StatsView:
    state = cmdr_state(conn, fid)
    odyssey = bool(state["odyssey"]) if state else True
    days: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    # ---------------------------------------------------------------- travel
    travel = _one(
        conn,
        "SELECT COUNT(*) AS n, COALESCE(SUM(distance_ly), 0) AS ly FROM jumps WHERE fid = ?",
        fid,
    )
    # Visits also count the system you started in and carrier jumps.
    systems_visited = _one(
        conn, "SELECT COUNT(DISTINCT system_address) AS n FROM visits WHERE fid = ?", fid
    )["n"]
    longest = _one(
        conn,
        "SELECT j.distance_ly, j.ts, s.name FROM jumps j "
        "LEFT JOIN systems s ON s.address = j.system_address "
        "WHERE j.fid = ? ORDER BY j.distance_ly DESC LIMIT 1",
        fid,
    )
    visited = "address IN (SELECT system_address FROM visits WHERE fid = ?)"
    farthest = _one(
        conn,
        f"SELECT name, x, y, z FROM systems WHERE x IS NOT NULL AND {visited} "
        "ORDER BY x * x + y * y + z * z DESC LIMIT 1",
        fid,
    )
    honked = _one(
        conn, f"SELECT COUNT(*) AS n FROM systems WHERE body_count IS NOT NULL AND {visited}", fid
    )
    fully = _one(conn, f"SELECT COUNT(*) AS n FROM systems WHERE all_found = 1 AND {visited}", fid)
    for r in conn.execute("SELECT ts, distance_ly FROM jumps WHERE fid = ?", (fid,)):
        days[r["ts"][:10]]["jumps"] += 1
        days[r["ts"][:10]]["distance_ly"] += r["distance_ly"]

    # ---------------------------------------------------------------- scanning
    counts: dict[str, int] = defaultdict(int)
    stars = planets = first_disc = mapped = first_mapped = efficient = 0
    valuable: list[NamedValue] = []
    for row in conn.execute(
        "SELECT bc.scanned_at, bc.mapped_at, bc.efficient, bc.carto, b.facts "
        "FROM body_cmdr bc "
        "JOIN bodies b ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
        "WHERE bc.fid = ?",
        (fid,),
    ):
        facts = facts_from_json(row["facts"])
        if facts.kind == "star":
            stars += 1
            key = notable_star(facts.star_type)
        else:
            planets += 1
            key = NOTABLE_PLANETS.get(facts.planet_class or "")
            if facts.terraform_state in ("Terraformable", "Terraforming"):
                counts["terraformable"] += 1
            if facts.has_rings:
                counts["ringed"] += 1
            if facts.landable and facts.has_atmosphere:
                counts["landable_atmo"] += 1
        if key:
            counts[key] += 1
        if facts.was_discovered is False:
            first_disc += 1
        if row["mapped_at"]:
            mapped += 1
            efficient += row["efficient"]
            if facts.was_mapped is False:
                first_mapped += 1
        value = estimate_body_value(
            facts, odyssey=odyssey, efficient=not row["mapped_at"] or bool(row["efficient"])
        )
        valuable.append(
            NamedValue(
                name=facts.name,
                detail=star_subtype(facts) if facts.kind == "star" else facts.planet_class,
                value=value.dss if row["mapped_at"] and facts.kind == "planet" else value.fss,
                at=row["scanned_at"],
            )
        )
        if row["scanned_at"]:
            days[row["scanned_at"][:10]]["bodies_scanned"] += 1
    valuable.sort(key=lambda v: -v.value)

    # ---------------------------------------------------------------- exobiology
    analysed = conn.execute(
        "SELECT o.genus, o.species, o.species_name, o.value, o.bonus, o.first_footfall, o.sale, "
        "o.updated_at, b.name AS body FROM organic_scans o "
        "LEFT JOIN bodies b ON b.system_address = o.system_address AND b.body_id = o.body_id "
        "WHERE o.fid = ? AND o.status = 'analysed'",
        (fid,),
    ).fetchall()
    found_by_genus: dict[str, set[str]] = defaultdict(set)
    top_species: list[NamedValue] = []
    for scan in analysed:
        species = exobio.get_species(scan["species"])
        genus = species.genus if species else scan["genus"]
        found_by_genus[genus].add(species.species if species else scan["species"])
        base = scan["value"]
        if base is None:
            base = species.base_value if species else 0
        total = base + (scan["bonus"] or 0)
        name = species.species_name if species else (scan["species_name"] or scan["species"])
        top_species.append(
            NamedValue(name=name, detail=scan["body"], value=total, at=scan["updated_at"])
        )
        days[scan["updated_at"][:10]]["species_analysed"] += 1
    top_species.sort(key=lambda v: -v.value)
    genus_progress = sorted(
        (
            GenusProgress(
                genus=info.genus_name,
                found=len(found_by_genus.get(symbol, ())),
                total=len(exobio_catalog.SPECIES_BY_GENUS.get(symbol, ())),
            )
            for symbol, info in exobio_catalog.GENERA.items()
        ),
        key=lambda g: (-g.found / max(g.total, 1), g.genus),
    )

    # ---------------------------------------------------------------- money
    earnings = {
        r["kind"]: r["total"]
        for r in conn.execute(
            "SELECT kind, SUM(total) AS total FROM sales WHERE fid = ? GROUP BY kind", (fid,)
        )
    }
    biggest = _one(
        conn, "SELECT kind, total, ts FROM sales WHERE fid = ? ORDER BY total DESC LIMIT 1", fid
    )
    for r in conn.execute("SELECT ts, kind, total FROM sales WHERE fid = ?", (fid,)):
        days[r["ts"][:10]]["earnings"] += r["total"]
        days[r["ts"][:10]][f"earnings_{r['kind']}"] += r["total"]

    death_history = [
        DeathView(
            at=r["ts"],
            system=r["system"],
            body=r["body_name"],
            context=r["context"],
            killers=[KillerView(**k) for k in json.loads(r["killers"])],
            lost_bio_count=r["lost_bio_count"],
            lost_bio_value=r["lost_bio_value"],
            lost_carto_bodies=r["lost_carto_bodies"],
            lost_carto_value=r["lost_carto_value"],
            rebuy_option=r["rebuy_option"],
            rebuy_cost=r["rebuy_cost"],
        )
        for r in conn.execute(
            "SELECT d.*, s.name AS system FROM deaths d "
            "LEFT JOIN systems s ON s.address = d.system_address "
            "WHERE d.fid = ? ORDER BY d.id DESC",
            (fid,),
        )
    ]

    firsts: list[FirstEntry] = []
    state_of = {"sold": "sold", "unsold": "pending", "lost": "lost"}
    for row in conn.execute(
        "SELECT bc.scanned_at, bc.mapped_at, bc.carto, bc.footfall_at, b.facts, s.name AS system "
        "FROM body_cmdr bc "
        "JOIN bodies b ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
        "LEFT JOIN systems s ON s.address = bc.system_address "
        "WHERE bc.fid = ? AND (bc.footfall_at IS NOT NULL "
        "OR json_extract(b.facts, '$.was_discovered') = 0 "
        "OR (bc.mapped_at IS NOT NULL AND json_extract(b.facts, '$.was_mapped') = 0)) "
        "ORDER BY COALESCE(bc.scanned_at, bc.footfall_at) DESC LIMIT 500",
        (fid,),
    ):
        facts = facts_from_json(row["facts"])
        carto = state_of.get(row["carto"], "pending")
        firsts.append(
            FirstEntry(
                system=row["system"],
                body=facts.name,
                short_name=short_name(facts.name, row["system"] or ""),
                subtype=(
                    star_subtype(facts) if facts.kind == "star" else (facts.planet_class or "?")
                ),
                at=row["scanned_at"],
                discovered=carto if facts.was_discovered is False else None,
                mapped=carto if row["mapped_at"] and facts.was_mapped is False else None,
                footfall_at=row["footfall_at"],
            )
        )
    first_counts = {
        row["carto"]: row
        for row in conn.execute(
            "SELECT bc.carto, "
            "SUM(json_extract(b.facts, '$.was_discovered') = 0) AS disc, "
            "SUM(bc.mapped_at IS NOT NULL AND json_extract(b.facts, '$.was_mapped') = 0) AS mapped "
            "FROM body_cmdr bc JOIN bodies b "
            "ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
            "WHERE bc.fid = ? GROUP BY bc.carto",
            (fid,),
        )
    }

    def first_count(carto: str, column: str) -> int:
        row = first_counts.get(carto)
        return int(row[column] or 0) if row else 0

    footfalls = _one(
        conn, "SELECT COUNT(*) AS n FROM body_cmdr WHERE fid = ? AND footfall_at IS NOT NULL", fid
    )

    return StatsView(
        commander=cmdr_name(conn, fid),
        since=_one(conn, "SELECT MIN(ts) AS ts FROM events WHERE ts != ''")["ts"],
        days_active=_one(conn, "SELECT COUNT(DISTINCT substr(ts, 1, 10)) AS n FROM events")["n"],
        jumps=travel["n"],
        distance_ly=round(travel["ly"], 2),
        systems_visited=systems_visited,
        longest_jump=(
            NamedValue(
                name=longest["name"] or "?",
                detail=None,
                value=round(longest["distance_ly"], 2),
                at=longest["ts"],
            )
            if longest
            else None
        ),
        farthest_from_sol=(
            NamedValue(
                name=farthest["name"],
                detail=None,
                value=round(math.dist((farthest["x"], farthest["y"], farthest["z"]), (0, 0, 0)), 2),
                at=None,
            )
            if farthest
            else None
        ),
        systems_honked=honked["n"],
        systems_fully_scanned=fully["n"],
        bodies_scanned=stars + planets,
        stars_scanned=stars,
        planets_scanned=planets,
        first_discoveries=first_disc,
        bodies_mapped=mapped,
        first_mapped=first_mapped,
        efficient_maps=efficient,
        notable=[
            StatCount(key=k, count=v) for k, v in sorted(counts.items(), key=lambda kv: -kv[1])
        ],
        most_valuable_bodies=valuable[:5],
        species_analysed=len(analysed),
        unique_species=sum(len(v) for v in found_by_genus.values()),
        species_total=len(exobio_catalog.SPECIES),
        genera_found=sum(1 for v in found_by_genus.values() if v),
        genera_total=len(exobio_catalog.GENERA),
        first_footfalls=sum(1 for s in analysed if s["first_footfall"]),
        codex_new_entries=_one(
            conn,
            "SELECT COUNT(*) AS n FROM events WHERE event = 'CodexEntry' "
            "AND json_extract(raw, '$.IsNewEntry') = 1",
        )["n"],
        genus_progress=genus_progress,
        most_valuable_species=top_species[:5],
        earnings_carto=earnings.get("carto", 0),
        earnings_bio=earnings.get("bio", 0),
        biggest_sale=(
            NamedValue(name=biggest["kind"], detail=None, value=biggest["total"], at=biggest["ts"])
            if biggest
            else None
        ),
        deaths=len(death_history),
        value_lost=sum(d.lost_bio_value + d.lost_carto_value for d in death_history),
        death_history=death_history,
        first_discoveries_sold=first_count("sold", "disc"),
        first_discoveries_pending=first_count("unsold", "disc"),
        first_discoveries_lost=first_count("lost", "disc"),
        first_mapped_sold=first_count("sold", "mapped"),
        first_mapped_pending=first_count("unsold", "mapped"),
        first_mapped_lost=first_count("lost", "mapped"),
        first_footfalls_total=footfalls["n"],
        firsts=firsts,
        timeline=[
            DayStats(
                date=day,
                jumps=int(d["jumps"]),
                distance_ly=round(d["distance_ly"], 2),
                bodies_scanned=int(d["bodies_scanned"]),
                species_analysed=int(d["species_analysed"]),
                earnings=int(d["earnings"]),
                earnings_carto=int(d["earnings_carto"]),
                earnings_bio=int(d["earnings_bio"]),
            )
            for day, d in sorted(days.items())
        ],
    )

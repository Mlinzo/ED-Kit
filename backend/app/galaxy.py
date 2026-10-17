"""Your travels on the galaxy map: every visited system, the path flown in arrival order,
where you died, and the routes ahead (planned and plotted in the game).

Built from the stored journal events (visits, scans, sales, deaths), so it survives deleted
journal files. What each system earned comes from the history (app.history).
"""

from __future__ import annotations

import json
import math
import sqlite3

from app.history import history_view
from app.schemas import (
    GalaxyDeathView,
    GalaxySystemView,
    GalaxyView,
    NamedValue,
    RoutePoint,
)
from app.views import cmdr_name, cmdr_state


def galaxy_view(
    conn: sqlite3.Connection,
    fid: str | None,
    route: list[RoutePoint],
    plotted: list[RoutePoint],
) -> GalaxyView:
    entries = {int(e.address): e for e in history_view(conn, fid).systems}
    coords = {
        r["address"]: (r["x"], r["y"], r["z"])
        for r in conn.execute(
            "SELECT s.address, s.x, s.y, s.z FROM systems s WHERE s.x IS NOT NULL AND EXISTS "
            "(SELECT 1 FROM visits v WHERE v.fid = ? AND v.system_address = s.address)",
            (fid,),
        )
    }

    systems: list[GalaxySystemView] = []
    index: dict[int, int] = {}
    # Oldest first: the list reads like the travels (and the path's indices grow with time).
    for address, e in sorted(entries.items(), key=lambda kv: kv[1].first_visit_at):
        xyz = coords.get(address)
        if xyz is None:
            continue
        index[address] = len(systems)
        systems.append(
            GalaxySystemView(
                address=e.address,
                name=e.name,
                x=xyz[0],
                y=xyz[1],
                z=xyz[2],
                visits=e.visits,
                first_visit_at=e.first_visit_at,
                last_visit_at=e.last_visit_at,
                value=e.value,
                unsold_value=e.unsold_value,
                firsts=e.first_discoveries + e.first_mapped + e.first_footfalls,
                species=e.species_analysed,
                star_type=e.main_star.star_type if e.main_star else None,
                notable=e.notable,
            )
        )

    path: list[list[int]] = []
    previous: int | None = None
    for row in conn.execute(
        "SELECT system_address, how FROM visits WHERE fid = ? ORDER BY id", (fid,)
    ):
        i = index.get(row["system_address"])
        if i is None:
            previous = None
            continue
        if previous is None or row["how"] == "location":
            path.append([i])
        elif i != previous:
            path[-1].append(i)
        previous = i
    path = [run for run in path if len(run) > 1]

    deaths = [
        GalaxyDeathView(
            at=r["ts"],
            system=index.get(r["system_address"]) if r["system_address"] is not None else None,
            name=r["name"],
            lost_value=r["lost_bio_value"] + r["lost_carto_value"],
            killers=[k["name"] for k in json.loads(r["killers"]) if k.get("name")],
        )
        for r in conn.execute(
            "SELECT d.*, s.name FROM deaths d LEFT JOIN systems s ON s.address = d.system_address "
            "WHERE d.fid = ? ORDER BY d.id",
            (fid,),
        )
    ]

    state = cmdr_state(conn, fid)
    here = state["system_address"] if state else None
    distance = conn.execute(
        "SELECT COALESCE(SUM(distance_ly), 0) FROM jumps WHERE fid = ?", (fid,)
    ).fetchone()[0]
    farthest = max(systems, key=lambda s: math.hypot(s.x, s.y, s.z), default=None)
    return GalaxyView(
        commander=cmdr_name(conn, fid),
        systems=systems,
        path=path,
        current=index.get(here) if here is not None else None,
        deaths=deaths,
        route=route,
        plotted=plotted,
        distance_ly=round(float(distance), 2),
        farthest_from_sol=NamedValue(
            name=farthest.name,
            detail=None,
            value=round(math.hypot(farthest.x, farthest.y, farthest.z), 2),
            at=farthest.first_visit_at,
        )
        if farthest
        else None,
    )

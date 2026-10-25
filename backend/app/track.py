"""Your path on planet surfaces: positions from Status.json, recorded while the app runs (the
journal keeps no path), a point every few metres (`surface_track`).

A stretch (`seg`) is one unbroken piece: a new one starts after you leave the surface (or fly
high), on another body, for another commander, or when the app starts again.
"""

from __future__ import annotations

import math
import sqlite3
from datetime import UTC, datetime
from typing import Literal

from app.schemas import LiveStatus

# Metres moved before the next point: on foot, in the SRV, in the ship.
STEP_M = {"foot": 5.0, "srv": 20.0, "ship": 50.0}
# A ship flying higher draws no path: that ground track is not the way you went.
MAX_SHIP_ALTITUDE_M = 5_000.0
RADIUS_FALLBACK_M = 1_000_000.0  # Status.json gives the radius with the position; just in case

Recorded = Literal["new", "more"]


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float, radius_m: float) -> float:
    """Great-circle distance (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (
        math.sin((p2 - p1) / 2) ** 2
        + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    )
    return 2 * radius_m * math.asin(min(1.0, math.sqrt(a)))


class Recorder:
    """Writes the stretch you are on; one per service, used by its writer thread only."""

    def __init__(self) -> None:
        self._last: tuple[str, str, int, float, float] | None = None  # fid, body, seg, lat, lon

    def add(self, conn: sqlite3.Connection, fid: str | None, status: LiveStatus) -> Recorded | None:
        """Records where you are when you moved far enough: "new" for the first point of a
        stretch, "more" for the next ones; None when nothing was written."""
        how = "foot" if status.on_foot else "srv" if status.in_srv else "ship"
        high = how == "ship" and not status.landed and (status.altitude or 0) > MAX_SHIP_ALTITUDE_M
        lat, lon, body = status.lat, status.lon, status.body_name
        if fid is None or not status.has_lat_long or lat is None or lon is None or not body or high:
            self._last = None
            return None
        last = self._last
        same = last is not None and last[0] == fid and last[1] == body
        if last is not None and same:
            radius = status.planet_radius_m or RADIUS_FALLBACK_M
            if distance_m(last[3], last[4], lat, lon, radius) < STEP_M[how]:
                return None
            seg = last[2]
        else:
            top = conn.execute("SELECT MAX(seg) FROM surface_track").fetchone()[0]
            seg = (top or 0) + 1
        conn.execute(
            "INSERT INTO surface_track(fid, body_name, seg, ts, lat, lon) VALUES(?, ?, ?, ?, ?, ?)",
            (fid, body, seg, status.timestamp or datetime.now(UTC).isoformat(), lat, lon),
        )
        self._last = (fid, body, seg, lat, lon)
        return "more" if same else "new"


def stretches(
    conn: sqlite3.Connection, fid: str, body_name: str
) -> list[list[tuple[float, float]]]:
    """Your path on a body: its stretches of (lat, lon), oldest first."""
    by_seg: dict[int, list[tuple[float, float]]] = {}
    rows = conn.execute(
        "SELECT seg, lat, lon FROM surface_track WHERE fid = ? AND body_name = ? ORDER BY id",
        (fid, body_name),
    )
    for r in rows:
        by_seg.setdefault(r["seg"], []).append((r["lat"], r["lon"]))
    return list(by_seg.values())

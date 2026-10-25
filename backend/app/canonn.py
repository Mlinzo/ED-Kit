"""Other players' finds on planet surfaces, from Canonn, for the planet globe.

Canonn's EDMC plugin sends its users' bio samples and codex finds with their coordinates; the
per-system query (`getSystemPoi`) answers them for every body of a system, without commander
names or dates. On 34 of 34 bodies the user landed on near the Pleiades there were 1 to 194
points (checked 2026-10-25); deep space has far fewer.

Rules (as in app.enrich):
- Lookups run on a worker thread; results are written by the ingest thread.
- A system is looked up when its planet is shown on the globe, not on every jump. Requests reveal
  that system to Canonn; `--offline` disables them.
"""

from __future__ import annotations

import json
import logging
import queue
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from app.enrich import USER_AGENT

log = logging.getLogger(__name__)

SYSTEM_POI = (
    "https://us-central1-canonn-api-236217.cloudfunctions.net/query/getSystemPoi?system={name}"
)
TIMEOUT_S = 30
FRESH_FOR = timedelta(hours=24)
RETRY_FAILED_AFTER = timedelta(hours=1)

# ok: points from the cache (maybe none); loading: asked, no answer yet; failed: Canonn did not
# answer (asked again later); off: no lookups (--offline) and nothing cached.
State = Literal["ok", "loading", "failed", "off"]


def _coord(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if -180.0 <= number <= 180.0 else None


def parse_points(data: Any) -> list[dict[str, Any]]:
    """Points of the `ScanOrganic` and `codex` lists, the same place and find only once."""
    points: list[dict[str, Any]] = []
    seen: set[tuple[str, str, float, float]] = set()
    if not isinstance(data, dict):
        return points
    for key in ("ScanOrganic", "codex"):
        for item in data.get(key) or []:
            if not isinstance(item, dict):
                continue
            body, name = item.get("body"), item.get("english_name")
            lat, lon = _coord(item.get("latitude")), _coord(item.get("longitude"))
            if not body or not name or lat is None or lon is None or abs(lat) > 90:
                continue
            place = (str(body), str(name), round(lat, 5), round(lon, 5))
            if place in seen:
                continue
            seen.add(place)
            points.append(
                {
                    "body": str(body),
                    "name": str(name),
                    "category": str(item.get("hud_category") or ""),
                    "lat": lat,
                    "lon": lon,
                }
            )
    return points


def fetch_points(name: str) -> list[dict[str, Any]] | None:
    """Every point Canonn knows in a system; None when it did not answer. Never raises."""
    url = SYSTEM_POI.format(name=urllib.parse.quote(name))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
            return parse_points(json.loads(response.read().decode("utf-8")))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        log.info("canonn lookup failed for %s: %s", name, exc)
        return None


@dataclass
class Lookup:
    address: int
    points: list[dict[str, Any]] | None  # None: failed


class Fetcher:
    """Looks systems up one at a time on a background thread."""

    def __init__(self) -> None:
        self._requests: queue.Queue[tuple[int, str]] = queue.Queue()
        self.results: queue.Queue[Lookup] = queue.Queue()
        self._pending: set[int] = set()
        self._thread = threading.Thread(target=self._run, name="canonn", daemon=True)
        self._thread.start()

    def request(self, address: int, name: str) -> None:
        if address not in self._pending:
            self._pending.add(address)
            self._requests.put((address, name))

    def _run(self) -> None:
        while True:
            address, name = self._requests.get()
            try:
                self.results.put(Lookup(address, fetch_points(name)))
            except Exception:  # noqa: BLE001 - never kill the worker
                log.exception("canonn lookup failed for %s", address)
                self.results.put(Lookup(address, None))

    def drain(self) -> list[Lookup]:
        out = []
        while True:
            try:
                lookup = self.results.get_nowait()
            except queue.Empty:
                return out
            self._pending.discard(lookup.address)
            out.append(lookup)


# --------------------------------------------------------------------------- storage


def needs_fetch(conn: sqlite3.Connection, address: int, now: datetime | None = None) -> bool:
    row = conn.execute(
        "SELECT fetched_at, ok FROM ext_surface WHERE system_address = ?", (address,)
    ).fetchone()
    if row is None:
        return True
    now = now or datetime.now(UTC)
    fetched = datetime.fromisoformat(row["fetched_at"])
    return now - fetched > (FRESH_FOR if row["ok"] else RETRY_FAILED_AFTER)


def store(conn: sqlite3.Connection, lookup: Lookup) -> None:
    """Keep the answer; a failed lookup keeps the points of an older one."""
    now = datetime.now(UTC).isoformat(timespec="seconds")
    if lookup.points is None:
        conn.execute(
            "INSERT INTO ext_surface(system_address, fetched_at, ok, points) VALUES(?, ?, 0, '[]') "
            "ON CONFLICT(system_address) DO UPDATE SET fetched_at = excluded.fetched_at, "
            "ok = CASE WHEN points = '[]' THEN 0 ELSE ok END",
            (lookup.address, now),
        )
        return
    conn.execute(
        "INSERT INTO ext_surface(system_address, fetched_at, ok, points) VALUES(?, ?, 1, ?) "
        "ON CONFLICT(system_address) DO UPDATE SET fetched_at = excluded.fetched_at, ok = 1, "
        "points = excluded.points",
        (lookup.address, now, json.dumps(lookup.points, separators=(",", ":"))),
    )


def body_points(
    conn: sqlite3.Connection, address: int, names: tuple[str, ...], *, online: bool
) -> tuple[State, str | None, list[dict[str, Any]]]:
    """(state, when fetched, points) for one body; Canonn names it short ("3 c") or in full."""
    row = conn.execute(
        "SELECT fetched_at, ok, points FROM ext_surface WHERE system_address = ?", (address,)
    ).fetchone()
    if row is None:
        return ("loading" if online else "off"), None, []
    points = [p for p in json.loads(row["points"]) if p.get("body") in names]
    if row["ok"]:
        return "ok", row["fetched_at"], points
    return ("loading" if online and needs_fetch(conn, address) else "failed"), row["fetched_at"], []

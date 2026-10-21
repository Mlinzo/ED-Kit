"""Spansh search API (bodies and systems) for the route planner, cached in SQLite.

Searches reveal the area you plan to fly to the operator; `--offline` disables them.
"""

from __future__ import annotations

import gzip
import json
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from app import db
from app.enrich import USER_AGENT

BODIES_SEARCH = "https://spansh.co.uk/api/bodies/search"
SYSTEMS_SEARCH = "https://spansh.co.uk/api/systems/search"
STATIONS_SEARCH = "https://spansh.co.uk/api/stations/search"
TIMEOUT_S = 15
PAGE_SIZE = 500
MAX_WINDOW = 10_000  # Spansh does not page past the first 10 000 results
CACHE_MAX_AGE = timedelta(days=7)
CACHE_DROP_AFTER = timedelta(days=30)
PERMITS_MAX_AGE = timedelta(days=30)  # the permit-locked systems hardly ever change

# Body fields the planner reads; the rest is dropped before caching (a full page is ~1.5 MB).
BODY_FIELDS = (
    "id64",
    "name",
    "subtype",
    "terraforming_state",
    "distance",
    "distance_to_arrival",
    "estimated_scan_value",
    "estimated_mapping_value",
    "system_id64",
    "system_name",
    "system_x",
    "system_y",
    "system_z",
    # exobiology predictions (app.routebio)
    "signals",
    "genuses",
    "is_landable",
    "atmosphere",
    "atmosphere_composition",
    "gravity",
    "surface_temperature",
    "surface_pressure",
    "volcanism_type",
    "parents",
    "system_region",
    "materials",  # the colour of some species (codex variants)
)
# Bumped when BODY_FIELDS change: cached pages without the new fields are fetched again.
PAGE_FORMAT = 2

# Reference of a search: {"reference_system": name} | {"reference_coords": {x, y, z}}
# | {"reference_route": {"source": name, "destination": name}} (then `distance` is the
# distance from the line between them).
Reference = dict[str, Any]


class SpanshError(Exception):
    """A search failed: network, server error, or an unexpected answer."""


class SpanshRejected(SpanshError):
    """HTTP 400: Spansh does not know a reference system (our queries are otherwise fixed)."""


def _post(url: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/json",
            # Answers shrink ~10x (a station carries its whole market).
            "Accept-Encoding": "gzip",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:  # noqa: S310
            raw = response.read()
            if response.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            data = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 400:
            raise SpanshRejected("invalid request") from exc
        raise SpanshError(f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise SpanshError(str(exc)) from exc
    if not isinstance(data, dict) or data.get("error"):
        raise SpanshError(str(data.get("error") if isinstance(data, dict) else "bad response"))
    return data


def stations(
    service: str, coords: tuple[float, float, float], size: int, types: list[str] | None = None
) -> list[dict[str, Any]]:
    """The stations offering a service (Spansh's name, e.g. "Vista Genomics"), of the given
    types (Spansh's names) if any, nearest to `coords` first, with the fields app.selling reads."""
    found = station_search({"services": [{"name": {"value": [service]}}]}, coords, size, types)
    return [{k: r.get(k) for k in STATION_FIELDS} | {"services": _service_names(r)} for r in found]


def station_search(
    filters: dict[str, Any],
    coords: tuple[float, float, float],
    size: int,
    types: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Stations matching `filters` (Spansh's form), of the given types if any, nearest to
    `coords` first, as Spansh sends them (with the whole market, shipyard and outfitting)."""
    x, y, z = coords
    if types:
        filters = filters | {"type": {"value": types}}
    data = _post(
        STATIONS_SEARCH,
        {
            "filters": filters,
            "sort": [{"distance": {"direction": "asc"}}],
            "size": size,
            "page": 0,
            "reference_coords": {"x": x, "y": y, "z": z},
        },
    )
    return [r for r in data.get("results") or [] if isinstance(r, dict)]


def _service_names(station: dict[str, Any]) -> list[str]:
    return [
        str(s["name"])
        for s in station.get("services") or []
        if isinstance(s, dict) and s.get("name")
    ]


# Station fields app.selling reads (a station also carries its whole market: dropped).
STATION_FIELDS = (
    "name",
    "type",
    "market_id",
    "system_id64",
    "system_name",
    "system_x",
    "system_y",
    "system_z",
    "distance_to_arrival",
    "small_pads",
    "medium_pads",
    "large_pads",
    "updated_at",
    "carrier_docking_access",  # All | Squadron | Friends | Squadron Friends | None; often missing
)


class SpanshSearch:
    """The two searches the planner needs (a fake replaces it in tests)."""

    def bodies(self, filters: dict[str, Any], reference: Reference, page: int) -> dict[str, Any]:
        """One page of bodies, nearest to the reference first: {count, results, reference}."""
        data = _post(
            BODIES_SEARCH,
            {
                "filters": filters,
                "sort": [{"distance": {"direction": "asc"}}],
                "size": PAGE_SIZE,
                "page": page,
                **reference,
            },
        )
        return {
            "count": data.get("count"),
            "reference": data.get("reference"),
            "results": [
                {k: r.get(k) for k in BODY_FIELDS}
                for r in data.get("results") or []
                if isinstance(r, dict)
            ],
        }

    def systems(self, ids: list[int]) -> dict[int, dict[str, Any]]:
        """Population and permit of systems by id64 (at most PAGE_SIZE per call)."""
        if not ids:
            return {}
        data = _post(
            SYSTEMS_SEARCH,
            {"filters": {"id64": {"value": [str(i) for i in ids]}}, "size": len(ids), "page": 0},
        )
        return {
            int(r["id64"]): {
                "population": r.get("population"),
                "needs_permit": r.get("needs_permit"),
            }
            for r in data.get("results") or []
            if isinstance(r, dict) and "id64" in r
        }

    def permit_locked(self) -> set[int]:
        """Every permit-locked system (~2 700): a few pages fetched in parallel."""

        def page(n: int) -> dict[str, Any]:
            return _post(
                SYSTEMS_SEARCH,
                {"filters": {"needs_permit": {"value": True}}, "size": PAGE_SIZE, "page": n},
            )

        first = page(0)
        pages = [first]
        count = min(int(first.get("count") or 0), MAX_WINDOW)
        rest = range(1, -(-count // PAGE_SIZE))
        if rest:
            with ThreadPoolExecutor(len(rest)) as pool:
                pages += list(pool.map(page, rest))
        return {
            int(r["id64"])
            for data in pages
            for r in data.get("results") or []
            if isinstance(r, dict) and "id64" in r
        }


def _now() -> datetime:
    return datetime.now(UTC)


class CachedSearch(SpanshSearch):
    """Spansh searches remembered in SQLite: body pages by request, systems by id64, and the
    permit-locked systems.

    `oldest` is the fetch time of the oldest data a plan used (shown as "Spansh data from").
    Thread-safe (the planner searches in parallel); network calls run outside the lock.
    """

    def __init__(self, db_path: Path, *, refresh: bool = False) -> None:
        self._conn = db.connect(db_path)
        self._lock = threading.Lock()
        self.refresh = refresh
        self.oldest: datetime | None = None
        self.requests = 0
        with self._lock:
            limit = (_now() - CACHE_DROP_AFTER).isoformat(timespec="seconds")
            self._conn.execute("DELETE FROM spansh_pages WHERE fetched_at < ?", (limit,))
            self._conn.execute("DELETE FROM spansh_systems WHERE fetched_at < ?", (limit,))

    def close(self) -> None:
        self._conn.close()

    def _used(self, fetched_at: datetime) -> None:
        if self.oldest is None or fetched_at < self.oldest:
            self.oldest = fetched_at

    def _fresh(self, fetched_at: str) -> datetime | None:
        when = datetime.fromisoformat(fetched_at)
        return when if not self.refresh and _now() - when <= CACHE_MAX_AGE else None

    def bodies(self, filters: dict[str, Any], reference: Reference, page: int) -> dict[str, Any]:
        key = json.dumps(
            [PAGE_FORMAT, filters, reference, page], sort_keys=True, separators=(",", ":")
        )
        with self._lock:
            row = self._conn.execute(
                "SELECT fetched_at, data FROM spansh_pages WHERE key = ?", (key,)
            ).fetchone()
            when = self._fresh(row["fetched_at"]) if row else None
            if when is not None:
                self._used(when)
                return json.loads(row["data"])
        data = super().bodies(filters, reference, page)
        now = _now()
        with self._lock:
            self.requests += 1
            self._used(now)
            self._conn.execute(
                "INSERT OR REPLACE INTO spansh_pages(key, fetched_at, data) VALUES(?, ?, ?)",
                (key, now.isoformat(timespec="seconds"), json.dumps(data, separators=(",", ":"))),
            )
        return data

    def cached_systems(self, ids: list[int]) -> tuple[dict[int, dict[str, Any]], list[int]]:
        """(known systems, ids still to fetch)."""
        known: dict[int, dict[str, Any]] = {}
        with self._lock:
            for start in range(0, len(ids), 900):  # SQLite parameter limit
                chunk = ids[start : start + 900]
                marks = ",".join("?" * len(chunk))
                for row in self._conn.execute(
                    f"SELECT * FROM spansh_systems WHERE id64 IN ({marks})", chunk
                ):
                    when = self._fresh(row["fetched_at"])
                    if when is None:
                        continue
                    self._used(when)
                    known[row["id64"]] = {
                        "population": row["population"],
                        "needs_permit": bool(row["needs_permit"]),
                    }
        return known, [i for i in ids if i not in known]

    def systems(self, ids: list[int]) -> dict[int, dict[str, Any]]:
        known, missing = self.cached_systems(ids)
        if not missing:
            return known
        fetched = super().systems(missing)
        now = _now()
        stamp = now.isoformat(timespec="seconds")
        with self._lock:
            self.requests += 1
            self._used(now)
            self._conn.executemany(
                "INSERT OR REPLACE INTO spansh_systems(id64, fetched_at, population, needs_permit) "
                "VALUES(?, ?, ?, ?)",
                [
                    (i, stamp, info.get("population"), int(bool(info.get("needs_permit"))))
                    for i, info in fetched.items()
                ],
            )
        return {**known, **fetched}

    def permit_locked(self) -> set[int]:
        with self._lock:
            stamp = db.get_meta(self._conn, "spansh_permits_at")
            if stamp and _now() - datetime.fromisoformat(stamp) <= PERMITS_MAX_AGE:
                return {r[0] for r in self._conn.execute("SELECT id64 FROM spansh_permits")}
        ids = super().permit_locked()
        with self._lock:
            self.requests += 1
            self._conn.execute("BEGIN IMMEDIATE")
            self._conn.execute("DELETE FROM spansh_permits")
            self._conn.executemany(
                "INSERT INTO spansh_permits(id64) VALUES(?)", [(i,) for i in ids]
            )
            db.set_meta(self._conn, "spansh_permits_at", _now().isoformat(timespec="seconds"))
            self._conn.execute("COMMIT")
        return ids

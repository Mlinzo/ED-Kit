"""How likely a system is still undiscovered, from what the community databases know of it.

Spansh and EDSM learn systems from other commanders' tools (EDDN). A known arrival star
means somebody has been there (its scan is uploaded on arrival). A system known without any
body was most likely only seen in somebody's plotted route (EDDN NavRoute), so it may still
be untouched; one in no database at all, more so. Never a certainty: commanders who run no
such tool upload nothing, which matters most near the bubble, where everybody flies.

Lookups run on a worker thread (Spansh first, EDSM for what Spansh does not know scanned),
cached in the `discovery` table for a day.
"""

from __future__ import annotations

import json
import logging
import math
import queue
import sqlite3
import threading
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Literal

from app import db
from app.enrich import USER_AGENT
from app.spansh import SYSTEMS_SEARCH

log = logging.getLogger(__name__)

EDSM_SYSTEMS = "https://www.edsm.net/api-v1/systems"
TIMEOUT_S = 20
FRESH_FOR = timedelta(hours=24)
RETRY_FAILED_AFTER = timedelta(minutes=30)
SPANSH_BATCH = 100
EDSM_BATCH = 50

# What the databases know (the `discovery` table's codes).
SPANSH_NONE, SPANSH_SYSTEM, SPANSH_BODIES, SPANSH_STAR = 0, 1, 2, 3
EDSM_NONE, EDSM_SYSTEM, EDSM_STAR = 0, 1, 2

State = Literal["scanned", "bodies", "seen", "unknown", "pending"]

# Busy places: a system missing from the databases there says less.
BUSY = (((0.0, 0.0, 0.0), 1000.0), ((-9530.5, -910.28125, 19808.125), 500.0))  # bubble, Colonia


@dataclass(frozen=True, slots=True)
class Chance:
    """That nobody has discovered the system yet (None until the databases were asked)."""

    probability: float | None
    state: State
    reasons: tuple[str, ...]


def chance(
    spansh: int | None,
    edsm: int | None,
    position: tuple[float, float, float] | None,
    star_kind: str | None,
) -> Chance:
    """A rough probability with the reasons behind it (codes the UI explains)."""
    if spansh is None and edsm is None:
        return Chance(None, "pending", ())
    if spansh == SPANSH_STAR or edsm == EDSM_STAR:
        return Chance(0.02, "scanned", ("scanned",))
    if spansh == SPANSH_BODIES:
        return Chance(0.05, "bodies", ("bodies_known",))
    reasons: list[str]
    if spansh == SPANSH_SYSTEM or edsm == EDSM_SYSTEM:
        p, state, reasons = 0.6, "seen", ["seen_in_routes"]
    else:
        p, state, reasons = 0.9, "unknown", ["not_in_databases"]
    if position is not None and any(math.dist(position, c) < r for c, r in BUSY):
        p *= 0.5
        reasons.append("busy_area")
    if star_kind in ("neutron", "white_dwarf", "black_hole"):
        # Targets of neutron highways and sightseeing: more traffic than their neighbours.
        p *= 0.75
        reasons.append("popular_star")
    return Chance(round(p, 2), state, tuple(reasons))


# --------------------------------------------------------------------------- network


def _request(url: str, data: bytes | None = None) -> Any:
    headers = {"User-Agent": USER_AGENT}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def spansh_lookup(ids: list[int]) -> dict[int, int]:
    """Spansh's knowledge of each system (SPANSH_* codes); raises on a failed request."""
    payload = {"filters": {"id64": {"value": [str(i) for i in ids]}}, "size": len(ids), "page": 0}
    data = _request(SYSTEMS_SEARCH, json.dumps(payload).encode("utf-8"))
    results = data.get("results") if isinstance(data, dict) else None
    out = dict.fromkeys(ids, SPANSH_NONE)
    for r in results or []:
        if not isinstance(r, dict) or "id64" not in r:
            continue
        bodies = [b for b in r.get("bodies") or [] if isinstance(b, dict)]
        if any(b.get("is_main_star") for b in bodies):
            out[int(r["id64"])] = SPANSH_STAR
        elif bodies:
            out[int(r["id64"])] = SPANSH_BODIES
        else:
            out[int(r["id64"])] = SPANSH_SYSTEM
    return out


def edsm_lookup(names: list[str]) -> dict[str, int]:
    """EDSM's knowledge of each system by name (EDSM_* codes); raises on a failed request."""
    query = urllib.parse.urlencode(
        [("systemName[]", n) for n in names] + [("showId", 1), ("showPrimaryStar", 1)]
    )
    data = _request(f"{EDSM_SYSTEMS}?{query}")
    out = dict.fromkeys((n.lower() for n in names), EDSM_NONE)
    for r in data if isinstance(data, list) else []:
        if isinstance(r, dict) and r.get("name"):
            out[str(r["name"]).lower()] = EDSM_STAR if r.get("primaryStar") else EDSM_SYSTEM
    return out


# --------------------------------------------------------------------------- cache


def cached(conn: sqlite3.Connection, ids: Iterable[int]) -> dict[int, sqlite3.Row]:
    ids = list(ids)
    out: dict[int, sqlite3.Row] = {}
    for start in range(0, len(ids), 900):  # SQLite parameter limit
        chunk = ids[start : start + 900]
        marks = ",".join("?" * len(chunk))
        for row in conn.execute(f"SELECT * FROM discovery WHERE id64 IN ({marks})", chunk):
            out[row["id64"]] = row
    return out


def stale(row: sqlite3.Row | None, now: datetime) -> bool:
    if row is None:
        return True
    age = now - datetime.fromisoformat(row["fetched_at"])
    failed = row["spansh"] is None and row["edsm"] is None
    return age > (RETRY_FAILED_AFTER if failed else FRESH_FOR)


class DiscoveryChecker:
    """Asks the databases about systems on a worker thread and caches the answers; calls
    `on_change` after each batch. Requests for systems already known (or in flight) are
    dropped."""

    def __init__(
        self,
        db_path: Path,
        on_change: Callable[[], None],
        spansh: Callable[[list[int]], dict[int, int]] = spansh_lookup,
        edsm: Callable[[list[str]], dict[str, int]] = edsm_lookup,
    ) -> None:
        self.db_path = db_path
        self.on_change = on_change
        self.spansh = spansh
        self.edsm = edsm
        self._queue: queue.Queue[list[tuple[int, str]]] = queue.Queue()
        self._lock = threading.Lock()
        self._pending: set[int] = set()
        self._thread = threading.Thread(target=self._run, name="discovery", daemon=True)
        self._thread.start()

    @property
    def busy(self) -> bool:
        with self._lock:
            return bool(self._pending)

    def request(self, conn: sqlite3.Connection, systems: Iterable[tuple[int, str]]) -> None:
        """Look up the systems not cached (or cached too long ago)."""
        systems = list(systems)
        known = cached(conn, (i for i, _ in systems))
        now = datetime.now(UTC)
        with self._lock:
            wanted = [
                (i, n) for i, n in systems if i not in self._pending and stale(known.get(i), now)
            ]
            self._pending.update(i for i, _ in wanted)
        if wanted:
            self._queue.put(wanted)

    def _run(self) -> None:
        while True:
            batch = self._queue.get()
            try:
                self._check(batch)
            except Exception:  # noqa: BLE001 - never kill the worker
                log.exception("discovery lookup failed")
            finally:
                with self._lock:
                    self._pending.difference_update(i for i, _ in batch)
                self.on_change()

    def _check(self, systems: list[tuple[int, str]]) -> None:
        conn = db.connect(self.db_path)
        try:
            for start in range(0, len(systems), SPANSH_BATCH):
                self._check_batch(conn, systems[start : start + SPANSH_BATCH])
                self.on_change()
        finally:
            conn.close()

    def _check_batch(self, conn: sqlite3.Connection, systems: list[tuple[int, str]]) -> None:
        spansh: dict[int, int] = {}
        try:
            spansh = self.spansh([i for i, _ in systems])
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            log.info("spansh discovery lookup failed: %s", exc)
        # EDSM for what Spansh has not seen scanned (or could not tell).
        ask = [n for i, n in systems if spansh.get(i) not in (SPANSH_STAR, SPANSH_BODIES)]
        edsm: dict[str, int] = {}
        for start in range(0, len(ask), EDSM_BATCH):
            try:
                edsm.update(self.edsm(ask[start : start + EDSM_BATCH]))
            except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
                log.info("edsm discovery lookup failed: %s", exc)
                break
        stamp = datetime.now(UTC).isoformat(timespec="seconds")
        conn.executemany(
            "INSERT OR REPLACE INTO discovery(id64, fetched_at, spansh, edsm) VALUES(?, ?, ?, ?)",
            [(i, stamp, spansh.get(i), edsm.get(n.lower())) for i, n in systems],
        )

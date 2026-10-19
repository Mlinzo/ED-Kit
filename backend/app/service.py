"""Ingest thread (the only SQLite writer) and the SSE event bus."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from queue import Empty, SimpleQueue
from typing import Any

from app import db, enrich, game, projector, usersettings
from app.config import Settings
from app.journal import (
    JournalDirectory,
    JournalFile,
    JournalLine,
    count_journals,
    read_new_lines,
)
from app.navroute import NavRouteReader
from app.projector import Projector
from app.schemas import IngestState, LiveStatus
from app.status import StatusReader

log = logging.getLogger(__name__)

BATCH_LINES = 2000
LIVE_EVENT_MAX_AGE_S = 120  # newer events may use the current Status.json position
GAME_CHECK_S = 5.0  # how often the process list is read
FUEL_STEP_T = 0.5  # a fuel level change this big (scooping, jumping) refreshes the forecast
# Views built from nearly everything the journal-derived ones are: refreshed with any of them.
DERIVED_TOPICS = frozenset({"stats", "history", "route", "navroute", "galaxy", "sell"})
# Not from the journal: they never make the journal-derived views stale.
OWN_TOPICS = frozenset({"surface", "live"})


def _parse_ts(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


class EventBus:
    """Fans out messages from the ingest thread to SSE subscribers on the asyncio loop."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue[tuple[str, Any]]] = set()

    def attach(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self) -> asyncio.Queue[tuple[str, Any]]:
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue(maxsize=256)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[tuple[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, kind: str, data: Any) -> None:
        if self._loop is None or self._loop.is_closed():
            return
        with contextlib.suppress(RuntimeError):  # loop shutting down
            self._loop.call_soon_threadsafe(self._fanout, kind, data)

    def _fanout(self, kind: str, data: Any) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait((kind, data))
            except asyncio.QueueFull:
                # Slow client: drop it; the browser reconnects and refetches everything.
                self._subscribers.discard(queue)


class IngestService(threading.Thread):
    def __init__(self, settings: Settings, bus: EventBus) -> None:
        super().__init__(name="ingest", daemon=True)
        self.settings = settings
        self.bus = bus
        self.seq = 0
        self.live = LiveStatus()
        self.journal_dir = settings.journal_dir  # the folder read now; the app can change it
        self._dir_requests: SimpleQueue[Path] = SimpleQueue()  # from the API, for the thread
        self.ingest = IngestState(
            backfill_done=False,
            files_total=0,
            files_done=0,
            events=0,
            journal_dir=str(settings.journal_dir),
            journal_dir_found=settings.journal_dir.is_dir(),
            journal_files=count_journals(settings.journal_dir),
            journal_dir_fixed=settings.journal_dir_fixed,
            journal_dir_default=str(settings.journal_dir),
        )
        self.enricher = enrich.Enricher() if settings.online else None
        self._enrich_checked: int | None = None  # last system looked up
        self._enrich_wanted: SimpleQueue[int] = SimpleQueue()  # opened in the UI
        self.navroute = NavRouteReader(settings.journal_dir / "NavRoute.json")
        self._last_event: str | None = None  # the latest journal event (game running fallback)
        self.ready = threading.Event()
        self._halt = threading.Event()
        self._rebuild = False

    # ------------------------------------------------------------------ control

    def request_rebuild(self) -> None:
        self._rebuild = True

    def stop(self) -> None:
        self._halt.set()

    def set_journal_dir(self, path: Path) -> None:
        """Reads the journal from another folder (from the API; the ingest thread switches)."""
        self._show_dir(path)
        self._dir_requests.put(path)
        self.bus.publish("ingest", self.ingest)

    def _show_dir(self, path: Path) -> None:
        self.journal_dir = path
        self.ingest.journal_dir = str(path)
        self.ingest.journal_dir_found = path.is_dir()
        self.ingest.journal_files = count_journals(path)

    # ------------------------------------------------------------------ thread

    def run(self) -> None:
        try:
            self._run()
        except Exception:
            log.exception("ingest thread crashed")
            raise

    def _run(self) -> None:
        conn = db.connect(self.settings.db_path)
        db.init_schema(conn)
        chosen = None if self.settings.journal_dir_fixed else usersettings.load_journal_dir(conn)
        if chosen is not None:
            self._show_dir(chosen)
            self.navroute = NavRouteReader(chosen / "NavRoute.json")
        log.info("journal dir: %s", self.journal_dir)
        if self._rebuild or db.get_meta(conn, "projector_version") != str(projector.VERSION):
            self._replay(conn)
        self.projector = Projector(conn, position=self._position_for)
        self.ingest.events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        last = conn.execute("SELECT event FROM events ORDER BY id DESC LIMIT 1").fetchone()
        self._last_event = last["event"] if last else None
        threading.Thread(target=self._watch_game, name="game", daemon=True).start()
        self.ready.set()

        directory = JournalDirectory(self.journal_dir, conn)
        status_reader = StatusReader(self.journal_dir / "Status.json")

        files = directory.discover()
        self._backfill(conn, files)
        last_rescan = time.monotonic()

        if self.navroute.poll():
            self._invalidate({"navroute", "galaxy"})
        while not self._halt.is_set():
            switched = self._switch_dir(conn)
            if switched:
                directory, status_reader = switched
                files = directory.discover()
                self._backfill(conn, files)
                last_rescan = time.monotonic()
            self._poll_status(status_reader)
            if self.navroute.poll():
                self._invalidate({"navroute", "galaxy"})
            if time.monotonic() - last_rescan >= self.settings.rescan_interval:
                files = directory.discover()
                last_rescan = time.monotonic()
                found = (self.journal_dir.is_dir(), len(files))
                if found != (self.ingest.journal_dir_found, self.ingest.journal_files):
                    self.ingest.journal_dir_found, self.ingest.journal_files = found
                    self.bus.publish("ingest", self.ingest)
                # Drain older files first (a new session file may have just appeared).
                for file in files[:-1]:
                    self._ingest_file(conn, file)
            if files:
                self._ingest_file(conn, files[-1])
            self._enrich(conn)
            self._halt.wait(self.settings.poll_interval)
        conn.close()

    def _switch_dir(self, conn: Any) -> tuple[JournalDirectory, StatusReader] | None:
        """Readers for the folder last asked for, if the API asked for one."""
        path = None
        with contextlib.suppress(Empty):
            while True:
                path = self._dir_requests.get_nowait()
        if path is None:
            return None
        log.info("journal dir: %s", path)
        self._show_dir(path)
        self.navroute = NavRouteReader(path / "NavRoute.json")
        self.live = LiveStatus()
        self.bus.publish("status", self.live)
        self._invalidate({"navroute", "galaxy", "surface"})
        return JournalDirectory(path, conn), StatusReader(path / "Status.json")

    # ------------------------------------------------------------------ ingest

    def _replay(self, conn: Any) -> None:
        """Rebuild projections from stored events (projector logic changed)."""
        log.info("rebuilding projections from stored events")
        db.reset_projections(conn)
        db.set_meta(conn, "active_fid", None)
        replayer = Projector(conn)  # stored sample positions are re-read by event id
        last_id = 0
        while True:
            rows = conn.execute(
                "SELECT id, raw FROM events WHERE id > ? ORDER BY id LIMIT ?",
                (last_id, BATCH_LINES),
            ).fetchall()
            if not rows:
                break
            conn.execute("BEGIN IMMEDIATE")
            for row in rows:
                self._apply(replayer, json.loads(row["raw"]), row["id"])
            conn.execute("COMMIT")
            last_id = rows[-1]["id"]
        db.set_meta(conn, "projector_version", projector.VERSION)
        self._rebuild = False

    def _backfill(self, conn: Any, files: list[JournalFile]) -> None:
        self.ingest.files_total = len(files)
        self.ingest.files_done = 0
        self.ingest.backfill_done = False
        self.bus.publish("ingest", self.ingest)
        started = time.monotonic()
        for file in files:
            if self._halt.is_set():
                return
            self._ingest_file(conn, file, publish=False)
            self.ingest.files_done += 1
            self.bus.publish("ingest", self.ingest)
        self.ingest.backfill_done = True
        log.info(
            "backfill: %d files, %d events in %.1fs",
            len(files),
            self.ingest.events,
            time.monotonic() - started,
        )
        self.bus.publish("ingest", self.ingest)
        self._invalidate(projector.ALL_TOPICS)

    def _ingest_file(self, conn: Any, file: JournalFile, publish: bool = True) -> None:
        if file.legacy:
            return
        result = read_new_lines(file)
        if result.byte_offset == file.byte_offset:
            return
        topics: set[str] = set()
        lines = result.lines
        for start in range(0, max(len(lines), 1), BATCH_LINES):
            batch = lines[start : start + BATCH_LINES]
            last = start + BATCH_LINES >= len(lines)
            conn.execute("BEGIN IMMEDIATE")
            try:
                topics |= self._store(conn, file, batch)
                if last:
                    conn.execute(
                        "UPDATE journal_files SET byte_offset = ?, line_no = ? WHERE id = ?",
                        (result.byte_offset, result.line_no, file.id),
                    )
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                log.exception("failed to ingest %s", file.name)
                return
        file.byte_offset, file.line_no = result.byte_offset, result.line_no
        if publish and topics:
            self._invalidate(topics)

    def _store(self, conn: Any, file: JournalFile, lines: list[JournalLine]) -> set[str]:
        topics: set[str] = set()
        for line in lines:
            name = str(line.event.get("event"))
            self._last_event = name
            if name in projector.SKIP_EVENTS:
                continue
            cur = conn.execute(
                "INSERT OR IGNORE INTO events(file_id, line_no, ts, event, raw) "
                "VALUES(?, ?, ?, ?, ?)",
                (file.id, line.line_no, str(line.event.get("timestamp", "")), name, line.raw),
            )
            if cur.rowcount == 0:
                continue  # already ingested
            self.ingest.events += 1
            topics |= self._apply(self.projector, line.event, int(cur.lastrowid))
        return topics

    @staticmethod
    def _apply(proj: Projector, ev: dict[str, Any], event_id: int) -> frozenset[str]:
        conn = proj.conn
        conn.execute("SAVEPOINT ev")
        try:
            topics = proj.apply(ev, event_id)
        except Exception:
            conn.execute("ROLLBACK TO ev")
            conn.execute("RELEASE ev")
            log.exception("projector failed on %s (event id %s)", ev.get("event"), event_id)
            return frozenset()
        conn.execute("RELEASE ev")
        return topics

    # ------------------------------------------------------------------ community data

    def _enrich(self, conn: Any) -> None:
        """Store finished lookups; request one when the commander enters a new system."""
        if self.enricher is None or not self.ingest.backfill_done:
            return
        for system in self.enricher.drain():
            conn.execute("BEGIN IMMEDIATE")
            try:
                enrich.store(conn, system)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                log.exception("failed to store community data for %s", system.address)
                continue
            if system.source is not None:
                log.info(
                    "community data: %d bodies for %s from %s",
                    len(system.bodies),
                    system.address,
                    system.source,
                )
            # Found or not: a system you have not been to stops waiting for it.
            self._invalidate({"system", "surface"})
        while True:
            try:
                wanted = self._enrich_wanted.get_nowait()
            except Empty:
                break
            if enrich.needs_fetch(conn, wanted):
                self.enricher.request(wanted)
        fid = self.projector.fid
        if not fid:
            return
        row = conn.execute("SELECT system_address FROM cmdr_state WHERE fid = ?", (fid,)).fetchone()
        address = row["system_address"] if row else None
        if address is None or address == self._enrich_checked:
            return
        self._enrich_checked = address
        if enrich.needs_fetch(conn, address):
            self.enricher.request(address)

    # ------------------------------------------------------------------ live status

    def _watch_game(self) -> None:
        """Whether the game runs, pushed with the ingest state when it changes."""
        while not self._halt.is_set():
            running = game.game_running(game.process_running(), self._last_event)
            if running != self.ingest.game_running:
                self.ingest.game_running = running
                self.bus.publish("ingest", self.ingest)
            self._halt.wait(GAME_CHECK_S)

    def _poll_status(self, reader: StatusReader) -> None:
        status = reader.poll()
        if status is None:
            return
        previous = self.live
        self.live = status
        self.bus.publish("status", status)
        if (
            previous.has_lat_long != status.has_lat_long
            or previous.body_name != status.body_name
            or previous.on_foot != status.on_foot
        ):
            self._invalidate({"surface"})
        if (previous.fuel_main is None) != (status.fuel_main is None) or (
            previous.fuel_main is not None
            and status.fuel_main is not None
            and abs(previous.fuel_main - status.fuel_main) >= FUEL_STEP_T
        ):
            self._invalidate({"navroute"})

    def _position_for(self, ts: str) -> tuple[float, float] | None:
        """Current position, but only for events happening now (not during backfill)."""
        if not self.ingest.backfill_done:
            return None
        live = self.live
        if not live.has_lat_long or live.lat is None or live.lon is None:
            return None
        event_time = _parse_ts(ts)
        if event_time is None:
            return None
        if abs((datetime.now(UTC) - event_time).total_seconds()) > LIVE_EVENT_MAX_AGE_S:
            return None
        return live.lat, live.lon

    def want_community_data(self, address: int) -> None:
        """Look up community data for a system opened by address (any thread)."""
        if self.enricher is not None:
            self._enrich_wanted.put(address)

    def invalidate(self, topics: set[str]) -> None:
        """Ask every browser to refetch these views (callable from any thread)."""
        self._invalidate(topics)

    def _invalidate(self, topics: set[str] | frozenset[str]) -> None:
        self.seq += 1
        journal = set(topics) - OWN_TOPICS - DERIVED_TOPICS
        topics = set(topics) | (DERIVED_TOPICS if journal else set())
        self.bus.publish("invalidate", {"seq": self.seq, "topics": sorted(topics)})

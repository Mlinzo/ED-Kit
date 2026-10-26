"""Ingest thread (the only SQLite writer) and the SSE event bus."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import sqlite3
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from queue import Empty, SimpleQueue
from typing import Any

from app import canonn, datadir, db, enrich, game, projector, track, usersettings
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
SIZES_EVERY_S = 30.0  # how often the database and journal sizes are measured
SIZE_STEP = 1_000_000  # a change this big (bytes) is pushed to the browsers
FUEL_STEP_T = 0.5  # a fuel change this big (scooping, jumping): new forecast and jump range
TRACK_SHOW_S = 5.0  # the globe gets the path you go along at most this often
# Views built from nearly everything the journal-derived ones are: refreshed with any of them.
DERIVED_TOPICS = frozenset(
    {"stats", "history", "sessions", "route", "navroute", "galaxy", "sell", "shop", "bookmarks"}
)
# Not from the journal: they never make the journal-derived views stale.
OWN_TOPICS = frozenset({"surface", "live"})


def _str(path: Path | None) -> str | None:
    return None if path is None else str(path)


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
            data_dir=str(settings.data_dir),
            data_dir_default=str(settings.data_home),
            data_dir_fixed=settings.data_dir_fixed,
            data_dir_pending=None
            if settings.data_dir_fixed
            else _str(datadir.pending_move(settings.data_home)),
            large_db_bytes=datadir.LARGE_DB_BYTES,
            low_free_bytes=datadir.LOW_FREE_BYTES,
        )
        self._sizes_at = 0.0  # monotonic time of the last size check
        self._track = track.Recorder()
        self._track_shown = 0.0  # monotonic time the globe last got new path points
        self._recheck = threading.Event()  # the API changed something a held read waits on
        self.enricher = enrich.Enricher() if settings.online else None
        self._enrich_checked: int | None = None  # last system looked up
        self._enrich_wanted: SimpleQueue[int] = SimpleQueue()  # opened in the UI
        self.canonn = canonn.Fetcher() if settings.online else None
        self._finds_wanted: SimpleQueue[tuple[int, str]] = SimpleQueue()  # planet globes shown
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

    def set_data_pending(self, path: Path | None) -> None:
        """The folder the database moves to at the next start (from the API), or None."""
        self.ingest.data_dir_pending = _str(path)
        self.bus.publish("ingest", self.ingest)

    def keep_big_data(self) -> None:
        """\"Keep it here\" (from the API, already stored in meta): a held read goes on."""
        self.ingest.big_data_ok = True
        self._recheck.set()
        self.bus.publish("ingest", self.ingest)

    def _hold_reason(self, conn: Any, files: list[JournalFile]) -> str | None:
        """Whether reading `files` must wait: the database would not fit on its drive, or would
        grow big in the standard folder before the user said where to keep it."""
        unread = 0
        for file in files:
            with contextlib.suppress(OSError):
                unread += max(0, file.path.stat().st_size - file.byte_offset)
        growth = int(unread * datadir.DB_PER_JOURNAL_BYTE)
        self.ingest.hold_bytes = growth
        free = datadir.free_bytes(self.settings.data_dir)
        if free is not None and growth + datadir.SPARE_BYTES > free:
            return "space"
        if (
            growth >= datadir.LARGE_DB_BYTES
            and not self.settings.data_dir_fixed
            and self.settings.data_dir == self.settings.data_home
            and db.get_meta(conn, datadir.BIG_DATA_OK) != "1"
        ):
            return "large"
        return None

    def _held(self, conn: Any, files: list[JournalFile]) -> bool:
        """Checks the hold before a read (again while it waits), publishing any change."""
        reason = self._hold_reason(conn, files)
        if reason != self.ingest.hold:
            if reason:
                log.info(
                    "journal read waits: %s (%.0f MB to read)", reason, self.ingest.hold_bytes / 1e6
                )
                self.ingest.backfill_done = False
            self.ingest.hold = reason  # type: ignore[assignment]
            self._measure(publish=False)
            self.bus.publish("ingest", self.ingest)
        return reason is not None

    def _measure(self, publish: bool = True) -> None:
        """Database and journal sizes, and the free space where the database is."""
        self._sizes_at = time.monotonic()
        db_size = datadir.db_bytes(self.settings.data_dir)
        journal_size = datadir.journal_bytes(self.journal_dir)
        free = datadir.free_bytes(self.settings.data_dir)
        i = self.ingest
        free_moved = (free is None) != (i.free_bytes is None) or (
            free is not None
            and i.free_bytes is not None
            and abs(free - i.free_bytes) >= 100 * SIZE_STEP
        )
        changed = (
            abs(db_size - i.db_bytes) >= SIZE_STEP
            or abs(journal_size - i.journal_bytes) >= SIZE_STEP
            or free_moved
        )
        i.db_bytes, i.journal_bytes, i.free_bytes = db_size, journal_size, free
        if changed and publish:
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
        self._tidy(conn)
        self._measure(publish=False)
        self.projector = Projector(conn, position=self._position_for)
        self.ingest.events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        last = conn.execute("SELECT event FROM events ORDER BY id DESC LIMIT 1").fetchone()
        self._last_event = last["event"] if last else None
        threading.Thread(target=self._watch_game, name="game", daemon=True).start()
        self.ready.set()

        directory = JournalDirectory(self.journal_dir, conn)
        status_reader = StatusReader(self.journal_dir / "Status.json")

        files = directory.discover()
        self.ingest.big_data_ok = db.get_meta(conn, datadir.BIG_DATA_OK) == "1"
        # The first read of a folder waits while the database would not fit or grow big.
        waiting = self._held(conn, files)
        if not waiting:
            self._backfill(conn, files)
        last_rescan = time.monotonic()

        if self.navroute.poll():
            self._invalidate({"navroute", "galaxy", "sell"})
        while not self._halt.is_set():
            switched = self._switch_dir(conn)
            if switched:
                directory, status_reader = switched
                files = directory.discover()
                waiting = self._held(conn, files)
                if not waiting:
                    self._backfill(conn, files)
                last_rescan = time.monotonic()
            if waiting and (
                self._recheck.is_set()
                or time.monotonic() - last_rescan >= self.settings.rescan_interval
            ):
                self._recheck.clear()
                last_rescan = time.monotonic()
                files = directory.discover()
                waiting = self._held(conn, files)
                if not waiting:
                    self._backfill(conn, files)
            self._poll_status(conn, status_reader)
            if self.navroute.poll():
                self._invalidate({"navroute", "galaxy", "sell"})
            if not waiting and time.monotonic() - last_rescan >= self.settings.rescan_interval:
                files = directory.discover()
                last_rescan = time.monotonic()
                found = (self.journal_dir.is_dir(), len(files))
                if found != (self.ingest.journal_dir_found, self.ingest.journal_files):
                    self.ingest.journal_dir_found, self.ingest.journal_files = found
                    self.bus.publish("ingest", self.ingest)
                # Drain older files first (a new session file may have just appeared).
                for file in files[:-1]:
                    self._ingest_file(conn, file)
            if files and not waiting:
                self._ingest_file(conn, files[-1])
            if time.monotonic() - self._sizes_at >= SIZES_EVERY_S:
                self._measure()
            self._enrich(conn)
            self._surface_finds(conn)
            self._halt.wait(self.settings.poll_interval)
        conn.close()

    def _tidy(self, conn: Any) -> None:
        """At start, before anything else opens the database: drop community bodies not looked
        up for a month and give the freed pages back to the disk."""
        try:
            fid = db.get_meta(conn, "active_fid")
            row = conn.execute(
                "SELECT system_address FROM cmdr_state WHERE fid = ?", (fid,)
            ).fetchone()
            conn.execute("BEGIN IMMEDIATE")
            dropped = enrich.prune(conn, row["system_address"] if row else None)
            conn.execute("COMMIT")
            before = datadir.db_bytes(self.settings.data_dir)
            db.compact(conn)
            after = datadir.db_bytes(self.settings.data_dir)
            log.info(
                "tidy: community bodies of %d systems dropped, database %.1f -> %.1f MB",
                dropped,
                before / 1e6,
                after / 1e6,
            )
        except sqlite3.Error:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            log.exception("tidying the database failed")

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
        self._invalidate({"navroute", "galaxy", "sell", "surface"})
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
        self._measure(publish=False)
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

    def _surface_finds(self, conn: Any) -> None:
        """Store Canonn's answers; ask for the systems the globe waits for."""
        if self.canonn is None:
            return
        for lookup in self.canonn.drain():
            conn.execute("BEGIN IMMEDIATE")
            try:
                canonn.store(conn, lookup)
                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                log.exception("failed to store canonn finds for %s", lookup.address)
                continue
            log.info(
                "canonn: %s points for %s",
                "no" if lookup.points is None else len(lookup.points),
                lookup.address,
            )
            self._invalidate({"surface"})
        while True:
            try:
                address, name = self._finds_wanted.get_nowait()
            except Empty:
                break
            if canonn.needs_fetch(conn, address):
                self.canonn.request(address, name)

    # ------------------------------------------------------------------ live status

    def _watch_game(self) -> None:
        """Whether the game runs, pushed with the ingest state when it changes."""
        while not self._halt.is_set():
            running = game.game_running(game.process_running(), self._last_event)
            if running != self.ingest.game_running:
                self.ingest.game_running = running
                self.bus.publish("ingest", self.ingest)
            self._halt.wait(GAME_CHECK_S)

    def _poll_status(self, conn: Any, reader: StatusReader) -> None:
        status = reader.poll()
        if status is None:
            return
        previous = self.live
        self.live = status
        self.bus.publish("status", status)
        if self.ingest.backfill_done:
            recorded = self._track.add(conn, self.projector.fid, status)
            if recorded == "new" or (
                recorded == "more" and time.monotonic() - self._track_shown >= TRACK_SHOW_S
            ):
                self._track_shown = time.monotonic()
                self._invalidate({"surface"})
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
            self._invalidate({"navroute", "route"})

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

    def want_surface_finds(self, address: int, name: str) -> None:
        """Look up other players' finds of a system whose planet the globe shows (any thread)."""
        if self.canonn is not None:
            self._finds_wanted.put((address, name))

    def invalidate(self, topics: set[str]) -> None:
        """Ask every browser to refetch these views (callable from any thread)."""
        self._invalidate(topics)

    def _invalidate(self, topics: set[str] | frozenset[str]) -> None:
        self.seq += 1
        journal = set(topics) - OWN_TOPICS - DERIVED_TOPICS
        topics = set(topics) | (DERIVED_TOPICS if journal else set())
        self.bus.publish("invalidate", {"seq": self.seq, "topics": sorted(topics)})

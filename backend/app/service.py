"""Ingest thread (the only SQLite writer) and the SSE event bus."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import threading
import time
from datetime import UTC, datetime
from typing import Any

from app import db, enrich, projector
from app.config import Settings
from app.journal import JournalDirectory, JournalFile, JournalLine, read_new_lines
from app.projector import Projector
from app.schemas import IngestState, LiveStatus
from app.status import StatusReader

log = logging.getLogger(__name__)

BATCH_LINES = 2000
LIVE_EVENT_MAX_AGE_S = 120  # newer events may use the current Status.json position


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
        self.ingest = IngestState(
            backfill_done=False,
            files_total=0,
            files_done=0,
            events=0,
            journal_dir=str(settings.journal_dir),
            journal_dir_found=settings.journal_dir.is_dir(),
        )
        self.enricher = enrich.Enricher() if settings.online else None
        self._enrich_checked: int | None = None  # last system looked up
        self.ready = threading.Event()
        self._halt = threading.Event()
        self._rebuild = False

    # ------------------------------------------------------------------ control

    def request_rebuild(self) -> None:
        self._rebuild = True

    def stop(self) -> None:
        self._halt.set()

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
        if self._rebuild or db.get_meta(conn, "projector_version") != str(projector.VERSION):
            self._replay(conn)
        self.projector = Projector(conn, position=self._position_for)
        self.ingest.events = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        self.ready.set()

        directory = JournalDirectory(self.settings.journal_dir, conn)
        status_reader = StatusReader(self.settings.journal_dir / "Status.json")

        files = directory.discover()
        self._backfill(conn, files)
        last_rescan = time.monotonic()

        while not self._halt.is_set():
            self._poll_status(status_reader)
            if time.monotonic() - last_rescan >= self.settings.rescan_interval:
                files = directory.discover()
                last_rescan = time.monotonic()
                self.ingest.journal_dir_found = self.settings.journal_dir.is_dir()
                # Drain older files first (a new session file may have just appeared).
                for file in files[:-1]:
                    self._ingest_file(conn, file)
            if files:
                self._ingest_file(conn, files[-1])
            self._enrich(conn)
            self._halt.wait(self.settings.poll_interval)
        conn.close()

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
                self._invalidate({"system", "surface"})
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

    def invalidate(self, topics: set[str]) -> None:
        """Ask every browser to refetch these views (callable from any thread)."""
        self._invalidate(topics)

    def _invalidate(self, topics: set[str] | frozenset[str]) -> None:
        self.seq += 1
        # All-time statistics depend on nearly everything the other views do.
        topics = set(topics) | ({"stats"} if topics - {"surface"} else set())
        self.bus.publish("invalidate", {"seq": self.seq, "topics": sorted(topics)})

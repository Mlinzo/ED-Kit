from __future__ import annotations

import argparse
import asyncio
import json
import logging
import socket
import sqlite3
import threading
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import __version__, db, history, routes, stats, usersettings, views
from app.config import Settings
from app.schemas import (
    HighlightSettings,
    HistoryView,
    IngestState,
    LiveStatus,
    RouteRequest,
    RouteStopUpdate,
    RouteView,
    SessionView,
    StatsView,
    SurfaceView,
    SystemView,
)
from app.service import EventBus, IngestService

log = logging.getLogger("app")

SSE_PING_S = 15


def _sse(kind: str, data: Any) -> str:
    if isinstance(data, BaseModel):
        data = data.model_dump(by_alias=True, mode="json")
    return f"event: {kind}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def create_app(settings: Settings | None = None, *, rebuild: bool = False) -> FastAPI:
    settings = settings or Settings()
    bus = EventBus()
    service = IngestService(settings, bus)
    planner = routes.RoutePlanner(
        settings.db_path, settings.online, lambda: service.invalidate({"route"})
    )
    if rebuild:
        service.request_rebuild()
    local = threading.local()

    def read_conn() -> sqlite3.Connection:
        """One read-only connection per worker thread (WAL readers never block the writer)."""
        conn = getattr(local, "conn", None)
        if conn is None:
            conn = db.connect(settings.db_path, readonly=True)
            local.conn = conn
        return conn

    def active_fid(conn: sqlite3.Connection) -> str | None:
        return db.get_meta(conn, "active_fid")

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        bus.attach(asyncio.get_running_loop())
        service.start()
        await asyncio.to_thread(service.ready.wait, 60)
        yield
        service.stop()

    app = FastAPI(title="ED Explorer Kit", version=__version__, lifespan=lifespan)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/view/system", response_model=SystemView, response_model_by_alias=True)
    def view_system(address: int | None = None) -> SystemView:
        """The current system, or a visited one by its SystemAddress."""
        conn = read_conn()
        if address is not None:
            service.want_community_data(address)
        return views.system_view(conn, active_fid(conn), address)

    @app.get("/api/view/surface", response_model=SurfaceView, response_model_by_alias=True)
    def view_surface() -> SurfaceView:
        conn = read_conn()
        return views.surface_view(conn, active_fid(conn), service.live)

    @app.get("/api/view/session", response_model=SessionView, response_model_by_alias=True)
    def view_session() -> SessionView:
        conn = read_conn()
        return views.session_view(conn, active_fid(conn))

    @app.get("/api/view/stats", response_model=StatsView, response_model_by_alias=True)
    def view_stats() -> StatsView:
        conn = read_conn()
        return stats.stats_view(conn, active_fid(conn))

    @app.get("/api/view/history", response_model=HistoryView, response_model_by_alias=True)
    def view_history() -> HistoryView:
        conn = read_conn()
        return history.history_view(conn, active_fid(conn))

    @app.get("/api/view/route", response_model=RouteView, response_model_by_alias=True)
    def view_route() -> RouteView:
        conn = read_conn()
        return routes.route_view(conn, active_fid(conn), planner)

    @app.post("/api/route", status_code=202, response_model=RouteView, response_model_by_alias=True)
    def plan_route(body: RouteRequest) -> RouteView:
        """Plan a new route on a worker thread; progress arrives as `route` invalidations."""
        if not planner.online:
            raise HTTPException(409, "offline: route planning needs Spansh")
        planner.start(body)
        return view_route()

    @app.delete("/api/route", status_code=204)
    def clear_route() -> None:
        conn = db.connect(settings.db_path)
        try:
            routes.clear(conn)
        finally:
            conn.close()
        service.invalidate({"route"})

    @app.put("/api/route/stops/{seq}", status_code=204)
    def update_stop(seq: int, body: RouteStopUpdate) -> None:
        """Skip / unskip a stop, or move it (the route is renumbered)."""
        conn = db.connect(settings.db_path)
        try:
            found = True
            if body.skipped is not None:
                found = routes.set_skipped(conn, seq, body.skipped)
            if found and body.position is not None:
                found = routes.move_stop(conn, seq, body.position)
        finally:
            conn.close()
        if not found:
            raise HTTPException(404, "no such stop")
        service.invalidate({"route"})

    @app.delete("/api/route/stops/{seq}", status_code=204)
    def delete_stop(seq: int) -> None:
        conn = db.connect(settings.db_path)
        try:
            found = routes.remove_stop(conn, seq)
        finally:
            conn.close()
        if not found:
            raise HTTPException(404, "no such stop")
        service.invalidate({"route"})

    @app.get("/api/settings", response_model=HighlightSettings, response_model_by_alias=True)
    def get_settings() -> HighlightSettings:
        return usersettings.load(read_conn())

    @app.put("/api/settings", response_model=HighlightSettings, response_model_by_alias=True)
    def put_settings(body: HighlightSettings) -> HighlightSettings:
        conn = db.connect(settings.db_path)
        try:
            saved = usersettings.save(conn, body)
        finally:
            conn.close()
        service.invalidate({"system", "surface"})
        return saved

    @app.get("/api/status", response_model=LiveStatus, response_model_by_alias=True)
    def status() -> LiveStatus:
        return service.live

    @app.get("/api/ingest", response_model=IngestState, response_model_by_alias=True)
    def ingest() -> IngestState:
        return service.ingest

    @app.get("/api/stream")
    async def stream() -> StreamingResponse:
        queue = bus.subscribe()

        async def events() -> AsyncIterator[str]:
            try:
                yield "retry: 2000\n\n"
                yield _sse("hello", {"seq": service.seq})
                yield _sse("ingest", service.ingest)
                yield _sse("status", service.live)
                while True:
                    try:
                        kind, data = await asyncio.wait_for(queue.get(), timeout=SSE_PING_S)
                    except TimeoutError:
                        # A named event (not an SSE comment) so the browser can detect dead links.
                        yield _sse("ping", {})
                        continue
                    yield _sse(kind, data)
            finally:
                bus.unsubscribe(queue)

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    if settings.static_dir is not None:
        app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="web")
    else:

        @app.get("/")
        def no_frontend() -> dict[str, str]:
            return {"detail": "Frontend not built. Run `npm run build` in frontend/."}

    app.state.settings = settings
    app.state.service = service
    return app


def _lan_addresses() -> Iterator[str]:
    seen: set[str] = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packets are sent for UDP connect
            seen.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            seen.add(str(info[4][0]))
    except OSError:
        pass
    yield from sorted(a for a in seen if not a.startswith("127."))


def run() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="ED Explorer Kit backend")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--lan", action="store_true", help="allow access from phone/tablet on LAN")
    parser.add_argument("--journal-dir", help="Elite Dangerous journal folder")
    parser.add_argument("--data-dir", help="where data.db is stored")
    parser.add_argument("--rebuild", action="store_true", help="rebuild projections from events")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="do not fetch community body data (Spansh/EDSM) for the current system",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = Settings(port=args.port, lan=args.lan, online=not args.offline)
    if args.journal_dir:
        settings.journal_dir = Path(args.journal_dir)
    if args.data_dir:
        settings.data_dir = Path(args.data_dir)

    log.info("journal dir: %s", settings.journal_dir)
    log.info("database:    %s", settings.db_path)
    log.info("open:        http://127.0.0.1:%d", settings.port)
    log.info("community:   %s", "Spansh/EDSM lookups on" if settings.online else "offline")
    if settings.lan:
        for address in _lan_addresses():
            log.info("on LAN:      http://%s:%d", address, settings.port)

    uvicorn.run(
        create_app(settings, rebuild=args.rebuild),
        host=settings.host,
        port=settings.port,
        log_level="warning",
        timeout_graceful_shutdown=2,
    )


if __name__ == "__main__":
    run()

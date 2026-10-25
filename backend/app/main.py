from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import logging
import socket
import sqlite3
import sys
import threading
import time
import urllib.request
import webbrowser
from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response
from starlette.types import Scope

from app import (
    __version__,
    db,
    discovery,
    eddn,
    fuel,
    galaxy,
    history,
    navroute,
    neutron,
    notes,
    regionmap,
    routes,
    selling,
    sessions,
    shop,
    stats,
    usersettings,
    views,
)
from app.config import Settings, parse_dir
from app.schemas import (
    GalaxyView,
    HighlightSettings,
    HistoryView,
    IngestState,
    JournalDirRequest,
    LiveStatus,
    LiveView,
    NavRouteView,
    NetworkInfo,
    NeutronRequest,
    NoteRequest,
    RoutePoint,
    RouteRequest,
    RouteStopUpdate,
    RouteView,
    SellView,
    SessionsView,
    SessionView,
    ShopCatalogView,
    ShopView,
    StatsView,
    SurfaceView,
    SystemView,
)
from app.service import EventBus, IngestService

log = logging.getLogger("app")

SSE_PING_S = 15


class PageFiles(StaticFiles):
    """The built frontend. A page's own path (/galaxy, /system/123) gets index.html: the app
    routes in the browser, so a reload or a bookmark lands on the right page."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        parts = path.replace("\\", "/").split("/")  # an OS path (backslashes on Windows)
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or parts[0] == "api" or "." in parts[-1]:
                raise
            response = await super().get_response("index.html", scope)
        # Bundles carry a content hash and never change; everything else (the page) is
        # revalidated, so a new build or a new release shows up on the next load.
        immutable = parts[0] == "assets"
        response.headers["Cache-Control"] = (
            "public, max-age=31536000, immutable" if immutable else "no-cache"
        )
        return response


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
    neutrons = neutron.NeutronPlanner(settings.db_path, lambda: service.invalidate({"route"}))
    checker = (
        discovery.DiscoveryChecker(
            settings.db_path, lambda: service.invalidate({"navroute", "route"})
        )
        if settings.online
        else None
    )
    live = eddn.LiveListener(lambda: service.invalidate({"live"})) if settings.online else None
    sellers = (
        selling.SellFinder(settings.db_path, lambda: service.invalidate({"sell"}))
        if settings.online
        else None
    )
    shops = shop.ShopFinder(settings.db_path) if settings.online else None
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
        """The current system, or any other by its SystemAddress (yours, or from Spansh/EDSM)."""
        conn = read_conn()
        if address is not None:
            service.want_community_data(address)
        online = service.enricher is not None
        return views.system_view(conn, active_fid(conn), address, online=online)

    @app.get("/api/view/surface", response_model=SurfaceView, response_model_by_alias=True)
    def view_surface() -> SurfaceView:
        conn = read_conn()
        return views.surface_view(
            conn,
            active_fid(conn),
            service.live,
            online=service.canonn is not None,
            want_finds=service.want_surface_finds,
        )

    @app.get("/api/view/session", response_model=SessionView, response_model_by_alias=True)
    def view_session() -> SessionView:
        conn = read_conn()
        return views.session_view(conn, active_fid(conn))

    @app.get("/api/view/sessions", response_model=SessionsView, response_model_by_alias=True)
    def view_sessions() -> SessionsView:
        conn = read_conn()
        return sessions.sessions_view(conn, active_fid(conn))

    @app.get("/api/view/sell", response_model=SellView, response_model_by_alias=True)
    def view_sell(carriers: bool = False) -> SellView:
        """Where to sell data near you (asks Spansh when you moved away from the last search)."""
        conn = read_conn()
        fid = active_fid(conn)
        return selling.sell_view(
            conn, fid, views.cmdr_state(conn, fid), sellers, carriers, service.navroute.current
        )

    @app.get("/api/shop/catalog", response_model=ShopCatalogView, response_model_by_alias=True)
    def shop_catalog(request: Request) -> Response:
        """The ships and modules the Shop tab can look for, with prices and figures (gzipped
        when the browser takes it: the rest of the API is not, the event stream must not be)."""
        raw, packed = shop.catalog_json()
        if "gzip" in request.headers.get("accept-encoding", ""):
            return Response(
                packed,
                media_type="application/json",
                headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
            )
        return Response(raw, media_type="application/json", headers={"Vary": "Accept-Encoding"})

    @app.get("/api/view/shop", response_model=ShopView, response_model_by_alias=True)
    def view_shop(item: str | None = None, carriers: bool = False) -> ShopView:
        """The nearest stations selling a ship or module (journal symbol), asked from Spansh."""
        conn = read_conn()
        return shop.shop_view(conn, views.cmdr_state(conn, active_fid(conn)), shops, item, carriers)

    @app.get("/api/view/stats", response_model=StatsView, response_model_by_alias=True)
    def view_stats() -> StatsView:
        conn = read_conn()
        return stats.stats_view(conn, active_fid(conn))

    @app.get("/api/view/history", response_model=HistoryView, response_model_by_alias=True)
    def view_history() -> HistoryView:
        conn = read_conn()
        return history.history_view(conn, active_fid(conn))

    def live_fuel() -> float | None:
        return service.live.fuel_main if service.live.in_ship else None

    @app.get("/api/view/route", response_model=RouteView, response_model_by_alias=True)
    def view_route() -> RouteView:
        conn = read_conn()
        return routes.route_view(conn, active_fid(conn), planner, neutrons, live_fuel(), checker)

    def plotted_view(conn: sqlite3.Connection) -> NavRouteView:
        return navroute.navroute_view(
            conn, active_fid(conn), service.navroute.current, live_fuel(), checker
        )

    @app.get("/api/view/navroute", response_model=NavRouteView, response_model_by_alias=True)
    def view_navroute() -> NavRouteView:
        return plotted_view(read_conn())

    @app.get("/api/view/galaxy", response_model=GalaxyView, response_model_by_alias=True)
    def view_galaxy() -> GalaxyView:
        conn = read_conn()
        fid = active_fid(conn)
        route = routes.route_view(conn, fid, planner)
        remaining = [
            RoutePoint(name=s.name, x=s.x, y=s.y, z=s.z)
            for s in route.stops
            if not s.done and not s.skipped and (route.next_seq is None or s.seq >= route.next_seq)
        ]
        plotted = plotted_view(conn)
        ahead = [
            RoutePoint(name=h.name, x=h.x, y=h.y, z=h.z)
            for h in plotted.hops
            if h.status != "passed"
        ]
        return galaxy.galaxy_view(conn, fid, remaining, ahead, online=service.enricher is not None)

    @app.get("/api/view/live", response_model=LiveView, response_model_by_alias=True)
    def view_live() -> LiveView:
        """Other players right now (EDDN); asking keeps the listener connected."""
        return live.view() if live is not None else eddn.offline_view()

    @app.get("/api/regions")
    def region_map() -> Response:
        """The codex region grid for the galaxy map's region layer (fixed: cached a day)."""
        return Response(
            regionmap.map_json(),
            media_type="application/json",
            headers={"Cache-Control": "public, max-age=86400"},
        )

    @app.post("/api/route/neutron", status_code=202)
    def plan_neutron(body: NeutronRequest) -> None:
        """Spansh neutron route from where you are to the route's next stop (worker thread)."""
        if not planner.online:
            raise HTTPException(409, "offline: neutron routes need Spansh")
        conn = read_conn()
        fid = active_fid(conn)
        route = routes.route_view(conn, fid, planner)
        stop = next((s for s in route.stops if s.seq == route.next_seq), None)
        if stop is None or route.current_system is None:
            raise HTTPException(409, "no next stop, or your position is unknown")
        state = views.cmdr_state(conn, fid)
        if not route.jump_range_full_ly:
            raise HTTPException(409, "jump range unknown")
        neutrons.start(
            neutron.NeutronRequest(
                source=route.current_system,
                destination=stop.name,
                destination_address=int(stop.address),
                range_ly=route.jump_range_full_ly,
                efficiency=body.efficiency,
                multiplier=fuel.supercharge_multiplier(state["fsd_item"] if state else None),
            )
        )

    @app.delete("/api/route/neutron", status_code=204)
    def clear_neutron() -> None:
        neutrons.forget()
        conn = db.connect(settings.db_path)
        try:
            neutron.clear(conn)
        finally:
            conn.close()
        service.invalidate({"route"})

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

    @app.put("/api/notes", status_code=204)
    def put_note(body: NoteRequest) -> None:
        """Your note on a system or one of its bodies; empty text deletes it."""
        try:
            address = int(body.system_address)
        except ValueError as exc:
            raise HTTPException(422, "systemAddress is not a number") from exc
        xyz = (body.x, body.y, body.z)
        pos = None if None in xyz else (float(body.x or 0), float(body.y or 0), float(body.z or 0))
        conn = db.connect(settings.db_path)
        try:
            notes.save(
                conn,
                address,
                notes.SYSTEM if body.body_id is None else body.body_id,
                body.text,
                system_name=body.system_name,
                body_name=body.body_name,
                pos=pos,
            )
        finally:
            conn.close()
        service.invalidate({"system", "navroute", "history", "galaxy"})

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

    @app.get("/api/network", response_model=NetworkInfo, response_model_by_alias=True)
    def network(request: Request) -> NetworkInfo:
        return NetworkInfo(
            lan=not _is_loopback(settings.host),
            urls=_phone_urls(settings),
            this_pc=_from_this_pc(request),
        )

    @app.put("/api/journal-dir", response_model=IngestState, response_model_by_alias=True)
    def put_journal_dir(body: JournalDirRequest, request: Request) -> IngestState:
        """Reads the journal from another folder; no path: the default one. 409 when the
        folder was set at launch, 403 from another device (a path from the network could
        point the app at someone's share), 422 when it does not exist."""
        if settings.journal_dir_fixed:
            raise HTTPException(409, "fixed")
        if not _from_this_pc(request):
            raise HTTPException(403, "this_pc_only")
        chosen = parse_dir(body.path) if body.path and body.path.strip() else None
        if chosen is not None and not chosen.is_dir():
            raise HTTPException(422, "not_found")
        conn = db.connect(settings.db_path)
        try:
            usersettings.save_journal_dir(conn, chosen)
        finally:
            conn.close()
        service.set_journal_dir(chosen or settings.journal_dir)
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
        app.mount("/", PageFiles(directory=settings.static_dir, html=True), name="web")
    else:

        @app.get("/")
        def no_frontend() -> dict[str, str]:
            return {"detail": "Frontend not built. Run `npm run build` in frontend/."}

    app.state.settings = settings
    app.state.service = service
    return app


def _lan_addresses() -> Iterator[str]:
    """This PC's IPv4 addresses: the one of the default route first (the Wi-Fi or the cable,
    not a VPN or a virtual adapter as a rule), then the others."""
    primary: str | None = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packets are sent for UDP connect
            primary = s.getsockname()[0]
    except OSError:
        pass
    others: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            others.add(str(info[4][0]))
    except OSError:
        pass
    usable = [a for a in [primary, *sorted(others - {primary})] if a and _reachable(a)]
    yield from usable


def _reachable(address: str) -> bool:
    """Whether another device could reach the PC at this address (not loopback, not a
    link-local 169.254 one Windows gives an adapter without a network)."""
    ip = ipaddress.ip_address(address)
    return not (ip.is_loopback or ip.is_link_local or ip.is_unspecified)


def _is_loopback(host: str | None) -> bool:
    if host == "localhost":
        return True
    try:
        return host is not None and ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def _phone_urls(settings: Settings) -> list[str]:
    """Where other devices open the page; none when only this PC can (--local)."""
    host = settings.host
    if _is_loopback(host):
        return []
    addresses = list(_lan_addresses()) if host == "0.0.0.0" else [host]
    return [f"http://{address}:{settings.port}" for address in addresses]


def _from_this_pc(request: Request) -> bool:
    """The request comes from the PC the app runs on: over loopback, or from one of its own
    addresses (its browser opened the network address)."""
    client = request.client.host if request.client else None
    return _is_loopback(client) or client in set(_lan_addresses())


def _already_running(port: int) -> bool:
    """Whether ED Explorer Kit already answers on this port (the .exe started a second time)."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as resp:
            return json.load(resp).get("status") == "ok"
    except (OSError, ValueError):
        return False


def _open_browser_when_up(url: str, port: int) -> None:
    """Open the page once the server accepts connections (it binds after the first ingest)."""

    def wait() -> None:
        for _ in range(600):
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                    break
            except OSError:
                time.sleep(0.2)
        else:
            return
        webbrowser.open(url)

    threading.Thread(target=wait, name="open-browser", daemon=True).start()


def run() -> None:
    import uvicorn

    frozen = getattr(sys, "frozen", False)
    parser = argparse.ArgumentParser(description="ED Explorer Kit backend")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--local", action="store_true", help="only this PC: no access from phones on the network"
    )
    parser.add_argument("--host", help="listen address, e.g. 0.0.0.0 in Docker (overrides --local)")
    parser.add_argument(
        "--no-browser", action="store_true", help="do not open the browser (the .exe opens it)"
    )
    parser.add_argument("--journal-dir", help="Elite Dangerous journal folder")
    parser.add_argument("--data-dir", help="where data.db is stored")
    parser.add_argument("--rebuild", action="store_true", help="rebuild projections from events")
    parser.add_argument(
        "--offline",
        action="store_true",
        help="no Spansh/EDSM requests and no EDDN (route planning and live players off)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
    )
    settings = Settings(port=args.port, lan=not args.local, bind=args.host, online=not args.offline)
    if args.journal_dir:
        settings.journal_dir = Path(args.journal_dir)
        settings.journal_dir_fixed = True
    if args.data_dir:
        settings.data_dir = Path(args.data_dir)

    url = f"http://127.0.0.1:{settings.port}"
    open_browser = frozen and not args.no_browser
    if open_browser and _already_running(settings.port):
        log.info("already running, opening %s", url)
        webbrowser.open(url)
        return

    log.info("database:    %s", settings.db_path)
    log.info("open:        %s", url)
    log.info("community:   %s", "Spansh/EDSM lookups on" if settings.online else "offline")
    # Docker (--host) listens on the container's addresses: no use to a phone.
    phone_urls = [] if settings.bind else _phone_urls(settings)
    for phone_url in phone_urls:
        log.info("on phone:    %s (same Wi-Fi; the QR code is in Settings)", phone_url)
    if phone_urls:
        log.info("firewall:    if Windows asks, allow private networks for the phone to connect")
    if frozen:
        log.info("close this window to stop ED Explorer Kit")
    if open_browser:
        _open_browser_when_up(url, settings.port)

    uvicorn.run(
        create_app(settings, rebuild=args.rebuild),
        host=settings.host,
        port=settings.port,
        log_level="warning",
        timeout_graceful_shutdown=2,
    )


def main() -> None:
    """Entry point. The .exe keeps its console window open after a failure so it can be read."""
    try:
        run()
    except (Exception, SystemExit) as exc:
        if not getattr(sys, "frozen", False) or (isinstance(exc, SystemExit) and not exc.code):
            raise
        if not isinstance(exc, SystemExit):
            log.exception("ED Explorer Kit stopped")
        input("Press Enter to close this window...")
        sys.exit(1)


if __name__ == "__main__":
    main()

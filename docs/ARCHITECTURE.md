# ED Explorer Kit — architecture

Local companion app for Elite Dangerous explorers (exobiology + mapping).
A Python backend runs on the player's PC, reads the game journal, stores it in SQLite
and serves a React UI that works on a second monitor or a phone on the LAN.

```
Journal dir ──poll 250 ms──► JournalReader (byte offsets, complete lines only)
   └► one SQLite tx: INSERT events → Projector.apply(event) → projection upserts → COMMIT
          └► SSE "invalidate {topics}" ──► browser refetches /api/view/{topic}
Status.json ──poll──► LiveStatus (memory only) ──► SSE "status"
NavRoute.json ──poll──► PlottedRoute (memory only) ──► SSE "invalidate {navroute, galaxy}"
```

## Backend (`backend/`, Python 3.12, uv, FastAPI)

| Module | Role |
|---|---|
| `app/config.py` | Paths (journal dir, data dir), port, LAN flag |
| `app/db.py` | SQLite connection, pragmas, schema |
| `app/journal.py` | Journal file discovery, ordering by Fileheader time, tailing by byte offset |
| `app/status.py` | Status.json reader and flag decoding |
| `app/projector.py` | Applies journal events to projection tables (single writer) |
| `app/views.py` | Builds `SystemView` (current or any visited system) / `SurfaceView` / `SessionView` from SQLite; body interest/progress, orbit tree data |
| `app/stats.py` | All-time `StatsView` (incl. death history, first discoveries/maps/footfalls) |
| `app/history.py` | `HistoryView`: visited systems (`visits` table) with what you did there |
| `app/routeplan.py` | Route planning: system value = mapping payouts (Road to Riches kinds) + biology (bodies with bio signals); Spansh body searches, permit / population / value filters, stop order (nearest neighbour + 2-opt, or along a line) |
| `app/routebio.py` | Exobiology value of Spansh bodies for routes: facts conversion, genus names, species-based (min, max) estimate |
| `app/spansh.py` | Spansh search client with a SQLite cache (body pages 7 days, systems 7 days, permit list 30 days) |
| `app/routes.py` | The route: worker-thread builder, storage (`route*` tables), `RouteView` with journal progress |
| `app/fuel.py` | Fuel per jump of the current drive, learnt from its own `FSDJump`s (`fuel = k · (distance · mass)^power`, power by FSD size) |
| `app/navroute.py` | The route plotted in the game (`NavRoute.json`): fuel forecast hop by hop (scooping at KGBFOAM stars), neutron stars / white dwarfs ahead, warnings, discovery chances |
| `app/discovery.py` | How likely a system is undiscovered: Spansh, then EDSM (worker thread, `discovery` cache table, 24 h) |
| `app/neutron.py` | Spansh neutron plotter for the hop to the route's next stop (worker thread, `neutron_plan` table), progress from visits |
| `app/galaxy.py` | `GalaxyView`: visited systems with coordinates, the path in arrival order (broken at respawns), deaths, routes ahead |
| `app/enrich.py` | Community body data (Spansh, then EDSM) for the current system, cached in `ext_*` tables |
| `app/usersettings.py` | Highlight thresholds (`settings` table, `GET/PUT /api/settings`) |
| `app/facts.py` | Journal `Scan` → `BodyFacts`, JSON codec, `SystemFacts` loading |
| `app/game.py` | Whether the game is running (process list on Windows, else the journal's last `Shutdown`), pushed with the ingest state |
| `app/service.py` | Ingest thread, backfill, SSE fan-out |
| `app/main.py` | FastAPI app: REST views, SSE stream, static frontend |
| `app/models.py` | Domain dataclasses (`BodyFacts`, `SystemFacts`, `Species`, ...) |
| `app/schemas.py` | Pydantic view models (camelCase JSON) |
| `app/exobio/` | Species catalog (values, colony ranges) and prediction rules |
| `app/values.py` | Cartographic value estimates (FSS / DSS) |

Rules:
- Journal files are the source of truth. Projection tables can be dropped and rebuilt.
- Body identity is `(SystemAddress, BodyID)`; `id64 = SystemAddress | (BodyID << 55)`.
- Order by event insertion order, never by timestamp (1-second resolution).
- Only the ingest thread writes journal-derived data (settings and route edits are short writes from the API; the route builder writes its own tables).
- The journal always wins over community data; community bodies are labelled with their source.
- 64-bit ids go to the frontend as strings.
- No code copied from GPL projects (EDMC-BioScan, EDMC-Canonn): facts are re-derived.

## Frontend (`frontend/`, Vite + React + TypeScript + Tailwind v4)

- Contract: `frontend/src/api/types.ts` mirrors `backend/app/schemas.py`.
- Pages have paths (`src/lib/router.ts`): `/system`, `/system/<SystemAddress>` (a system from the history), `/surface`, `/route`, `/session`, `/history`, `/galaxy`, `/stats`; `/` opens the tab used last. Clicks push the path, automatic switches (sampling → Surface) replace it. The backend serves `index.html` for these paths (`PageFiles` in `app/main.py`); the query (`?mock=1`) is kept.
- `GET /api/view/system|surface|session|stats|history|navroute|galaxy`, `GET /api/status`, `GET /api/ingest`, `GET/PUT /api/settings`.
- `GET /api/view/system?address=<SystemAddress>`: a system from the history (also requests its community data).
- Route: `GET /api/view/route`, `POST /api/route` (plan, 202; 409 with `--offline`), `DELETE /api/route`, `PUT /api/route/stops/{seq}` (`skipped` and/or `position`: skip, move), `DELETE /api/route/stops/{seq}` (remove), `POST /api/route/neutron` (Spansh neutron route to the next stop, 202; 409 with `--offline`), `DELETE /api/route/neutron`.
- `GET /api/stream` (SSE): `hello`, `invalidate`, `status`, `ingest`, `ping`.
- `src/map/`: 3D orbit map (react-three-fiber); `src/map/visuals/`: procedural planet/star rendering.
- `src/screens/route/map/`: 3D route map (lazy chunk). Galactic coordinates scaled to a fixed scene radius, z flipped (top view: core up, +x right); stops are screen-space dots picked on screen, labels placed without overlap.
- `src/screens/galaxy/map/`: 3D galaxy map (lazy chunk), 100 ly per scene unit, Sol at the origin; reuses the route map's camera, markers and labels. The galaxy behind is a procedural sketch (`backdrop.ts`), not game imagery.
- The orbit tree comes from each body's `parents` chain (`Star` / `Planet` / `Null` = barycentre / `Ring`) plus `barycentres`; radii are not to scale.
- Dark, modern, glanceable UI. Languages: English (default), Ukrainian, Russian — chosen in Settings, stored per browser;
  switching reloads the page. `src/i18n/ru.ts` is the original dictionary and defines the shape (`Strings`); `en.ts`
  and `uk.ts` follow it, checked by `dictionaries.test.ts`. Game names (systems, bodies, species, planet and star
  classes) stay in English in every language.

## Running (dev)

```
cd backend;  uv run python -m app.main     # http://127.0.0.1:8765
cd frontend; npm run dev                   # http://localhost:5173 (proxies /api)
```

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
| `app/config.py` | Paths (journal dir, data dir, built frontend: `frontend/dist`, or `web/` inside the exe), port, listen address |
| `app/db.py` | SQLite connection, pragmas, schema |
| `app/journal.py` | Journal file discovery, ordering by Fileheader time, tailing by byte offset |
| `app/status.py` | Status.json reader and flag decoding |
| `app/projector.py` | Applies journal events to projection tables (single writer) |
| `app/views.py` | Builds `SystemView` (current, visited, or never visited: community data alone, with a `lookup` state) / `SurfaceView` / `SessionView` from SQLite; body interest/progress, orbit tree data |
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
| `app/galaxy.py` | `GalaxyView`: visited systems with coordinates, the path in arrival order (broken at respawns), deaths, routes ahead, codex regions visited |
| `app/engineers.py` | The 38 engineers (25 ship, 13 suit and weapon; bases checked against EDSM on 2026-10-18) and your standing from `EngineerProgress` (`engineers` table) |
| `app/eddn.py` | Other players right now: the EDDN relay (ZeroMQ, zlib JSON) on a worker thread, only while `GET /api/view/live` is being asked for (hangs up 2 min after); a message with `StarPos` is a sign someone is in that system (arrived, scanned, codex, docked); the relay gives every uploader a new id every 3 minutes, so: dots for the last 5 min (each id where seen last: a player who moved across a change of ids has two), players counted per 3-minute stretch between changes (detected when every id heard in the last 30 s is new) and shown for the last full one; two ids sending the same events (not arrivals) twice are one player; ids live in memory only (7 min) |
| `app/regionmap.py` | Codex region of any coordinates: 2048×2048 run-length grid over the galactic plane (`app/data/regionmap.json`, EliteDangerousRegionMap, MIT); the system's region until a `CodexEntry` names it; `GET /api/regions` for the map |
| `app/enrich.py` | Community body data (Spansh, then EDSM) for the current system and any system opened by address, with its name and position (a system you have not been to gets a page from it alone), cached in `ext_*` tables |
| `app/usersettings.py` | Highlight thresholds (`settings` table, `GET/PUT /api/settings`) |
| `app/facts.py` | Journal `Scan` → `BodyFacts`, JSON codec, `SystemFacts` loading |
| `app/game.py` | Whether the game is running (process list on Windows, else the journal's last `Shutdown`), pushed with the ingest state |
| `app/service.py` | Ingest thread, backfill, SSE fan-out |
| `app/main.py` | FastAPI app: REST views, SSE stream, static frontend; CLI (`run`), exe niceties (opens the browser, a second start just opens the page) |
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
- `GET /api/view/system|surface|session|stats|history|navroute|galaxy`, `GET /api/status`, `GET /api/ingest`, `GET/PUT /api/settings`, `GET /api/regions` (the region grid, fixed, cached a day), `GET /api/view/live` (EDDN; the `live` topic is invalidated every 15 s while new signs come in; the client asks at least every 45 s to keep the listener on).
- `GET /api/view/system?address=<SystemAddress>`: any system (also requests its community data): one from the history, or one you have not been to, from Spansh / EDSM alone (`lookup`: `pending` while asked, `missing` when they know no bodies, `offline` with `--offline`).
- Route: `GET /api/view/route`, `POST /api/route` (plan, 202; 409 with `--offline`), `DELETE /api/route`, `PUT /api/route/stops/{seq}` (`skipped` and/or `position`: skip, move), `DELETE /api/route/stops/{seq}` (remove), `POST /api/route/neutron` (Spansh neutron route to the next stop, 202; 409 with `--offline`), `DELETE /api/route/neutron`.
- `GET /api/stream` (SSE): `hello`, `invalidate`, `status`, `ingest`, `ping`.
- `src/map/`: 3D orbit map (react-three-fiber); `src/map/visuals/`: procedural planet/star rendering.
- `src/screens/route/map/`: 3D route map (lazy chunk). Galactic coordinates scaled to a fixed scene radius, z flipped (top view: core up, +x right); stops are screen-space dots picked on screen, labels placed without overlap.
- `src/screens/galaxy/map/`: 3D galaxy map (lazy chunk), 100 ly per scene unit, Sol at the origin; reuses the route map's camera, markers and labels. The galaxy behind is a procedural sketch (`backdrop.ts`), not game imagery. Codex regions (`regionLayer.tsx`): one quad on the galactic plane with the grid as an R8 texture; the shader draws a border where a pixel's on-screen neighbour lies in another region (crisp at any zoom) and tints visited regions; names sit at each region's point farthest from its border (`regions.ts`). Other players (`live.ts`, `liveLayer.tsx`): violet dots sized by players, fading with age; the layer is off by default (it makes the server download the whole EDDN feed). Engineers (`engineers.ts`, `engineerLayer.tsx`): orange rings, filled once unlocked. Hover cards sit beside their point (`LabelBox.beside`) in a layer above the legend; the dot nearest the pointer wins, yours on a tie. A click pins the card (`PickStore.selected`; a second click, empty space or Esc lets go): copy the system name, and open the system in a new browser tab (`/system/<address>`; one you have not been to only when Spansh / EDSM are asked: `GalaxyView.online`).
- The orbit tree comes from each body's `parents` chain (`Star` / `Planet` / `Null` = barycentre / `Ring`) plus `barycentres`; radii are not to scale.
- Layouts must hold on phones (360 px and up) in every language, not only on the desktop: let text wrap below `sm:` instead of `shrink-0`/`nowrap`, give grids an explicit `grid-cols-1`, put wide tables in a `relative overflow-x-auto` box. The 7-tab bottom bar uses `t.tabs.short` labels.
- Dark, modern, glanceable UI. Languages: English (default), Ukrainian, Russian — chosen in Settings, stored per browser;
  switching reloads the page. `src/i18n/ru.ts` is the original dictionary and defines the shape (`Strings`); `en.ts`
  and `uk.ts` follow it, checked by `dictionaries.test.ts`. Game names (systems, bodies, species, planet and star
  classes) stay in English in every language.

## Running (dev)

```
cd backend;  uv run python -m app.main     # http://127.0.0.1:8765
cd frontend; npm run dev                   # http://localhost:5173 (proxies /api)
```

## Packaging

- **exe** (`packaging/`): PyInstaller one-file `EDExplorerKit.exe` with `frontend/dist` inside as `web/`
  (`ed-explorer-kit.spec`, built by `build-exe.ps1`; PyInstaller is the `build` dependency group).
  A console window shows the log; closing it stops the app.
- **Release** (`.github/workflows/release.yml`): a `v*` tag matching `app.__version__` runs the tests,
  builds the exe on Windows and publishes it as a GitHub release (`gh release create`).
- **Docker** (`Dockerfile`, `docker-compose.yml`): Node stage builds the UI, Python stage runs
  `python -m app.main --host 0.0.0.0`; journals mounted read-only at `/journals`, database in the
  `/data` volume (`EDEK_JOURNAL_DIR`, `EDEK_DATA_DIR`). Journal polling works through Docker Desktop
  bind mounts (no file-change notifications needed). The game process is not visible from the
  container, so "game running" falls back to the journal.

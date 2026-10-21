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
| `app/config.py` | Paths (journal dir, data dir, built frontend: `frontend/dist`, or `web/` inside the exe), port, listen address; `journal_dir_fixed` when the journal folder is set at launch (`--journal-dir`, `EDEK_JOURNAL_DIR`: Docker); `parse_dir` cleans a pasted folder (quotes, `%VARS%`, `~`) |
| `app/db.py` | SQLite connection, pragmas, schema |
| `app/journal.py` | Journal file discovery, ordering by Fileheader time, tailing by byte offset. Files are known by name (`journal_files`), so a moved folder is not read twice; discovery returns only the files present in the folder (events of files read from another folder stay) |
| `app/status.py` | Status.json reader and flag decoding |
| `app/projector.py` | Applies journal events to projection tables (single writer) |
| `app/views.py` | Builds `SystemView` (current, visited, or never visited: community data alone, with a `lookup` state) / `SurfaceView` / `SessionView` from SQLite; body interest/progress, orbit tree data; the session's last sale and docking (station) and `growth`: unsold data when you left each system since the last sale |
| `app/stats.py` | All-time `StatsView` (incl. death history, first discoveries/maps/footfalls) |
| `app/sessions.py` | `SessionsView`: past game sessions. A session is one game run, from the first `LoadGame` to `Shutdown` (or the run's last event after a crash): every launch starts a journal file (`Fileheader` part 1; parts 2+ continue it), so going back to the main menu stays in the session, another commander's `LoadGame` starts a new one. What a session earned is the data gathered in it, sold or not, found by timestamp: bodies by `scanned_at` (the DSS share by `mapped_at`), species by analysis time; data lost on a death since is counted apart, where it was gathered. New codex entries are the game's `IsNewEntry` (it matched the first occurrence in every case of the player's journals) |
| `app/history.py` | `HistoryView`: visited systems (`visits` table) with what you did there |
| `app/routeplan.py` | Route planning: system value = mapping payouts (Road to Riches kinds) + biology (bodies with bio signals); or, goal "codex", new codex entries (biology only; each entry counts once per route: stops taken nearest first, or greedily along a line, each worth what the stops before it do not cover; an entry on several bodies of a stop counts as on at least one); Spansh body searches, permit / population / value filters, stop order (nearest neighbour + 2-opt, or along a line) |
| `app/routebio.py` | Exobiology value of Spansh bodies for routes: facts conversion (incl. materials), genus names, species-based (min, max) estimate, and the codex entries each body may give with their chances (a genus confirmed by DSS or deduced 1, a predicted one 0.5 shared among the open signals; candidate species and colours share equally) |
| `app/codex.py` | Your codex: entries by colour variant and by species, with regions; `predicted_status`: a predicted species' state and the share of its likely colours you have not logged in the region |
| `app/spansh.py` | Spansh search client with a SQLite cache (body pages 7 days, systems 7 days, permit list 30 days); asks for gzip (a station carries its whole market); `stations()`: stations offering a service, nearest first; `station_search()`: any station filter, answers as Spansh sends them |
| `app/selling.py` | Where to sell (`SellView`, `GET /api/view/sell[?carriers=true]`): Spansh station searches on a worker thread, per service (Universal Cartographics, Vista Genomics) stations and fleet carriers apart (carriers outnumber stations and would crowd them out), the latest kept in `sell_search` and reused within 20 ly or a tenth of the way to the nearest station found (6 h); plus the stations you docked at (`docks`, also offline). Per system the best station buying both kinds, else the best of each; filtered by the pad your ship needs. Carriers only on request (a switch, per browser): closed to the public (Spansh `carrier_docking_access`) or not seen for 30 days never; when hidden, the nearest one nearer than every station is named as a hint |
| `app/ships.py` | Ships by journal symbol: name and landing pad size (EDCD coriolis-data, 2026-10-19) |
| `app/routes.py` | The route: worker-thread builder, storage (`route*` tables), `RouteView` with journal progress. Goal `transit` ("Get there"): Spansh's neutron route (`app.neutron.plot`), its waypoints as the stops with their jumps and supercharge flag (`route_stops.jumps`, `neutron`); a waypoint is passed once you arrive there, or further on, after the route was made |
| `app/fuel.py` | Fuel per jump of the current drive, learnt from its own `FSDJump`s (`fuel = k · (distance · mass)^power`, power by FSD size); the jump range at the mass aboard, scaled from `MaxJumpRange` (max fuel per jump from the curve, Guardian booster added flat) |
| `app/navroute.py` | The route plotted in the game (`NavRoute.json`): fuel forecast hop by hop (scooping at KGBFOAM stars), neutron stars / white dwarfs ahead, warnings, discovery chances |
| `app/shop.py` | The Shop tab (`ShopView`, `GET /api/view/shop[?item=<journal symbol>&carriers=true]`, catalog at `GET /api/shop/catalog`): with no item the nearest stations with a shipyard or outfitting and how many ships / modules Spansh knows they sell; with one, the stations selling exactly it (Spansh filters modules by name, class and rating but ignores the mount, so the symbol is checked here), with price and the date of the shipyard / outfitting report. Stations and carriers asked apart and picked as in `selling` (pad, carriers on request, the nearest hidden one as a hint). Told, not filtered: the navy rank a ship needs (journal `Rank` / `Promotion`), Powerplay or technology-broker unlocks, permit-locked systems. Answers kept in memory per item (1 h, within 20 ly); the catalog is `app/data/shop.json`, with EDSY's prices and figures (a ship's base price, performance and slots, a module's figures by kind), served gzipped by the catalog endpoint only (the event stream must not be compressed) |
| `app/discovery.py` | How likely a system is undiscovered: Spansh, then EDSM (worker thread, `discovery` cache table, 24 h); the chances by database state and distance from Sol / Colonia are measured against EDDN (4 h, 2681 systems; the star kind and the mass code turned out not to matter) (`tools/discovery_calibration.py`, numbers in the module docstring) |
| `app/neutron.py` | Spansh neutron plotter for the hop to the route's next stop (worker thread, `neutron_plan` table), progress from visits |
| `app/galaxy.py` | `GalaxyView`: visited systems with coordinates, the path in arrival order (broken at respawns), deaths, routes ahead, codex regions visited |
| `app/engineers.py` | The 38 engineers (25 ship, 13 suit and weapon; bases checked against EDSM on 2026-10-18) and your standing from `EngineerProgress` (`engineers` table) |
| `app/eddn.py` | Other players right now: the EDDN relay (ZeroMQ, zlib JSON) on a worker thread, only while `GET /api/view/live` is being asked for (hangs up 2 min after); a message with `StarPos` is a sign someone is in that system (arrived, scanned, codex, docked); the relay gives every uploader a new id every 3 minutes, so: dots for the last 5 min (each id where seen last: a player who moved across a change of ids has two), players counted per 3-minute stretch between changes (detected when every id heard in the last 30 s is new) and shown for the last full one; two ids sending the same events (not arrivals) twice are one player; ids live in memory only (7 min) |
| `app/regionmap.py` | Codex region of any coordinates: 2048×2048 run-length grid over the galactic plane (`app/data/regionmap.json`, EliteDangerousRegionMap, MIT); the system's region until a `CodexEntry` names it; `GET /api/regions` for the map |
| `app/enrich.py` | Community body data (Spansh, then EDSM) for the current system and any system opened by address, with its name and position (a system you have not been to gets a page from it alone), cached in `ext_*` tables |
| `app/usersettings.py` | Highlight thresholds (`settings` table, `GET/PUT /api/settings`) and the journal folder chosen in the app (`journal_dir` row; ignored when the folder is set at launch) |
| `app/notes.py` | Your notes on systems and bodies (`notes` table: typed in the UI, not journal data, never rebuilt; body_id -1 is the system's own); a note keeps the system's name and position, from the UI or from your journal / community data, so systems you have not been to show it too |
| `app/facts.py` | Journal `Scan` → `BodyFacts`, JSON codec, `SystemFacts` loading |
| `app/game.py` | Whether the game is running (process list on Windows, else the journal's last `Shutdown`), pushed with the ingest state |
| `app/service.py` | Ingest thread, backfill, SSE fan-out. `set_journal_dir` (from `PUT /api/journal-dir`) queues a folder; the thread swaps the journal, Status.json and NavRoute.json readers and backfills the new folder. `IngestState` carries the folder, whether it exists, how many journal files it has (published when that changes: the game creating its folder), whether it is fixed, and the default |
| `app/main.py` | FastAPI app: REST views, SSE stream, static frontend; CLI (`run`), exe niceties (opens the browser, a second start just opens the page). Listens on all interfaces by default (`--local`: loopback only) and logs the phone address; `_from_this_pc` tells the PC (loopback or one of its own addresses) from other devices |
| `app/models.py` | Domain dataclasses (`BodyFacts`, `SystemFacts`, `Species`, ...) |
| `app/schemas.py` | Pydantic view models (camelCase JSON) |
| `app/exobio/` | Species catalog (values, colony ranges) and prediction rules; `deduced_genera`: the genera surely there before DSS (as many possible as there are signals; measured on Spansh, numbers in its docstring); `variants.py`: the codex colour of a species on a body (the parent star's class for 64 species, a material for 26; group-B materials can tie, then every one present is a candidate), data in `app/data/codex_variants.json` |
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
- `GET /api/view/system|surface|session|sessions|sell|stats|history|navroute|galaxy`, `GET /api/status`, `GET /api/ingest`, `GET/PUT /api/settings`, `PUT /api/journal-dir` (`path`, null: the default folder; 422 `not_found`, 409 when set at launch, 403 from another device: a path from the network could point the app at someone's share), `GET /api/network` (`lan`, `urls`: the page on this PC's addresses, the default route's first; `thisPc`), `GET /api/regions` (the region grid, fixed, cached a day), `GET /api/view/live` (EDDN; the `live` topic is invalidated every 15 s while new signs come in; the client asks at least every 45 s to keep the listener on).
- `GET /api/view/system?address=<SystemAddress>`: any system (also requests its community data): one from the history, or one you have not been to, from Spansh / EDSM alone (`lookup`: `pending` while asked, `missing` when they know no bodies, `offline` with `--offline`).
- Route: `GET /api/view/route`, `POST /api/route` (plan, 202; 409 with `--offline`), `DELETE /api/route`, `PUT /api/route/stops/{seq}` (`skipped` and/or `position`: skip, move), `DELETE /api/route/stops/{seq}` (remove), `POST /api/route/neutron` (Spansh neutron route to the next stop, 202; 409 with `--offline`), `DELETE /api/route/neutron`.
- `PUT /api/notes` (`systemAddress`, `bodyId` or null, `text`; empty text deletes; optional `systemName`, `bodyName`, `x/y/z`): the views carry the notes (`SystemView.note`, `BodyView.note`, `NavHopView.note`, `HistoryEntry.note` + `bodyNotes`, `GalaxyView.notes`).
- `GET /api/stream` (SSE): `hello`, `invalidate`, `status`, `ingest`, `ping`.
- `src/map/`: 3D orbit map (react-three-fiber); `src/map/visuals/`: procedural planet/star rendering.
- The route plotted in the game (`src/screens/route/PlottedRoute.tsx`, the System tab's `PlottedStrip`): only what needs attention is shown — fuel and next-jump star warnings, systems ahead likely undiscovered (chance ≥ 50 %), those with your notes — else one calm line; the jump list is folded (the game lists the jumps too). The System tab's strip shows only with a warning or a likely first discovery.
- `src/screens/route/map/`: 3D route map (lazy chunk). Galactic coordinates scaled to a fixed scene radius, z flipped (top view: core up, +x right); stops are screen-space dots picked on screen, labels placed without overlap.
- `src/screens/galaxy/map/`: 3D galaxy map (lazy chunk), 100 ly per scene unit, Sol at the origin; reuses the route map's camera, markers and labels. The galaxy behind is a procedural sketch (`backdrop.ts`), not game imagery. Codex regions (`regionLayer.tsx`): one quad on the galactic plane with the grid as an R8 texture; the shader draws a border where a pixel's on-screen neighbour lies in another region (crisp at any zoom) and tints visited regions; names sit at each region's point farthest from its border (`regions.ts`). Other players (`live.ts`, `liveLayer.tsx`): violet dots sized by players, fading with age; the layer is off by default (it makes the server download the whole EDDN feed). Engineers (`engineers.ts`, `engineerLayer.tsx`): orange rings, filled once unlocked. Hover cards sit beside their point (`LabelBox.beside`) in a layer above the legend; the dot nearest the pointer wins, yours on a tie. A click pins the card (`PickStore.selected`; a second click, empty space or Esc lets go): copy the system name, and open the system in a new browser tab (`/system/<address>`; one you have not been to only when Spansh / EDSM are asked: `GalaxyView.online`). Notes: a pale yellow ring around your systems that have one, a ringed dot for the others; the pinned card edits the note. Cards live in drei `<Html>` roots, which do not carry React context: the note saver (`useSaveNote`) is handed down from `GalaxyMapCanvas`.
- `src/guide/`: the guide for new explorers. `topics.ts` holds the topic order, sections, the five-step loop and the outside sources (the same in every language); the texts are `t.guide` (`src/i18n/guide.ru.ts`, `.en.ts`, `.uk.ts`, part of the dictionaries). `GuideProvider` (around `App`) renders `GuideDialog` (a panel on the right, full screen on a phone; the app is inert behind it); `HelpTip` is the "?" next to a term (`useGuide().open(topic)`), `GuideButton` the book in the top bar. Facts in the texts were checked against the linked sources on 2026-10-19: change a number only with a source.
- `src/screens/shop/`: the Shop tab. `catalog.ts` finds ships and modules by words (word starts, initials such as FSD or MC, a few player names such as DBX; "5A", a class or a mount narrow the variant) and picks a module's variant (class, then mount, then rating, then guidance; another class keeps the mount). On a phone the lists fold and choosing one scrolls to the card. `ItemCard.tsx`: the ship card (blueprint `ShipSketch.tsx`: top view, side view under it, rear view beside that, in metres; `sketches.ts` takes the outlines traced from blueprint sheets in `outlines.json` for 35 ships (or from the game's schematics, without a rear view) and keeps its hand-drawn shapes, without a rear view, for the rest; base price, performance, slots, the navy rank against yours) and the module card (an icon by EDSY module type, figures formatted by `stats.ts`); arrows flip through ships (by price, the default, by name or by pad size; the ship list beside the card follows the same order and shows each pad and price; the type buttons above it, from `roles.ts` (the wiki's ship types), narrow both) or the modules of a group, and the results are asked for once the flipping settles (450 ms).
- `src/screens/session/PastSessions.tsx` (+ `sessionList.ts`): past sessions at the bottom of the Session tab, sortable by any column (a first click sorts biggest or newest first, a second reverses it; ties go newest first, sessions without a pace last), a row opens what the session was made of. The latest session with no `Shutdown` is "Now" while the game runs (else it crashed) and its time counts up to now; "Per hour" is left out under 10 minutes.
- `src/settings/`: the settings dialog (`SettingsProvider` around `App`, `useSettings().open('journal')` from the top bar's journal strip): language, "On your phone" (`PhoneAccess.tsx`: a QR code of the address, drawn by `components/QrCode.tsx` with `uqr`, and firewall tips; only on the PC itself, opened at it with `open('phone')` from the welcome card), journal folder (`JournalFolder.tsx`, read-only on other devices), support. The highlight thresholds sit next to the bodies they highlight, on the System tab (`HighlightControl.tsx`: a panel without a backdrop, saved 400 ms after the last change).
- First run: `components/Welcome.tsx` on the System tab until closed (`edk.welcome` in localStorage): what the app does with the journal, and the guide's five steps. The top bar's strip says when the journal folder is missing or has no journal files yet (start the game, or choose the folder). No guided tour (decided 2026-10-19).
- `src/components/Note.tsx` (+ `notes.ts`): a note shown and edited in place (Ctrl+Enter saves, Esc cancels); `NoteEditor` takes the saver as a prop where there is no data store.
- The orbit tree comes from each body's `parents` chain (`Star` / `Planet` / `Null` = barycentre / `Ring`) plus `barycentres`; radii are not to scale.
- Layouts must hold on phones (360 px and up) in every language, not only on the desktop: let text wrap below `sm:` instead of `shrink-0`/`nowrap`, give grids an explicit `grid-cols-1`, put wide tables in a `relative overflow-x-auto` box. The 7-tab bottom bar uses `t.tabs.short` labels.
- Dark, modern, glanceable UI. Languages: English (default), Ukrainian, Russian — chosen in Settings, stored per browser;
  switching reloads the page. `src/i18n/ru.ts` is the original dictionary and defines the shape (`Strings`); `en.ts`
  and `uk.ts` follow it, checked by `dictionaries.test.ts`. Game names (systems, bodies, species, planet and star
  classes) stay in English in every language.

## Tools

- `backend/tools/codex_variants.py`: rebuilds `app/data/codex_variants.json` (the colour variants of Odyssey species) from Canonn's codex reference.
- `backend/tools/ship_outlines.py` (`uv run --group tools`, OpenCV): rebuilds `frontend/src/screens/shop/outlines.json` from the wiki's blueprint sheets (35 ships): the white lines thresholded, filled, each view's silhouette traced; top and rear views symmetric halves; fractions of the ship's dimensions. `--screenshots <folder>` adds ships from `<symbol>.png` screenshots of the game's schematics (top and side views; the screenshots stay out of the repository); on a Cobra Mk III both ways agree to 0.98 / 0.95 IoU.
- `backend/tools/shop_catalog.py`: rebuilds `app/data/shop.json` (the Shop tab's ships and modules) from EDCD FDevIDs, under Spansh's names, leaving out suits, armour, the starter kit's `_free` copies and whatever Spansh has at no station; a ship's `fighter_bay` comes from the ships EDSY lists in its fighter hangars' `reserved`; a ship EDSY has and FDevIDs does not yet (the Anaconda Mk II, out for ARX on 2026-10-20) stays even when no station sells it, marked `unsold`; prices and figures from EDSY's `eddb.js` (evaluated by Node).
- `backend/tools/discovery_calibration.py`: measures the discovery chance against EDDN. `collect --hours N` stores what Spansh / EDSM knew of each uploaded route's systems and the later arrival-star scans (`WasDiscovered`), in `<data dir>/calibration/*.jsonl`; it resumes after a stop or a power loss (the time collected is counted from the records). `report [--neighbours]` prints first-discovery rates by database state, distance, star class and mass code, and the model's Brier score.

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

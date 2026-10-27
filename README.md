# ED Explorer Kit

**English** · [Русский](README.ru.md)

A companion app for Elite Dangerous explorers: exobiology and mapping with a clean,
glanceable interface for a second monitor. It reads the game journal on your PC and
shows everything in your browser.

![ED Explorer Kit: the System tab with the orbit map, bodies with bio signals and the selected planet](docs/screenshot-system.png)

- **System**: bodies ranked by value, bio signals, predicted species, whether a body is worth mapping.
- **Surface**: a sampling radar showing where to take the next sample and how far you still have to go.
- **Route**: systems worth visiting for high-value mapping (Road to Riches) and biology, around a point or along a line (Spansh data). Shown as a list or a 3D map, and stops tick off by themselves as you fly. Also covers the route you plotted in the galaxy map: fuel and where to scoop, neutron stars and white dwarfs ahead, and the chance a system is still undiscovered. Neutron routes come from Spansh.
- **Session**: how much unsold data you are carrying right now.
- **History**: every system you visited: what you scanned, found and sold, how long you stayed and what it brought per hour.
- **Shop**: the nearest shipyards and outfitting as soon as you open it, where to buy a ship, a module or a commodity, and where to get a material (the nearest material traders of its kind, landable planets rich in a raw element, where else it comes from): by name or from the lists, with prices, how much a market had in stock, the navy rank a ship needs and how old the station's data is (Spansh data). Flip through every ship and module, ships by type (combat, exploration, freight...) and price: a ship's blueprint sketch, base price, performance, slots and whether a fighter hangar fits; a module's figures for each class and rating (EDSY data). Engineering goals (a module, a blueprint, the grade to reach; several at once) add up the materials they take against your stock from the journal; what is still short is highlighted on planets (System and Surface tabs).
- **Galaxy**: all your journeys on a 3D galaxy map: path, earnings, first discoveries, deaths, and the codex regions you have been to, the engineers with your progress. On request, other players right now (from EDDN, no names).
- **Stats**: all-time numbers and records, shared as one picture (with or without your commander name).

<p>
  <img src="docs/screenshot-surface.png" width="49%" alt="The Surface tab: the sampling radar with the samples taken, the colony range and the distance still to go, other species on the body">
  <img src="docs/screenshot-route.png" width="49%" alt="The Route tab: the route plotted in the game with systems likely nobody has discovered yet, the current stop with its bodies worth a visit, and the progress">
</p>
<p>
  <img src="docs/screenshot-session.png" width="49%" alt="The Session tab: unsold data at risk, split into exobiology and mapping, and what happened since the last sale">
  <img src="docs/screenshot-shop.png" width="49%" alt="The Shop tab: the Diamondback Explorer with its blueprint sketch, base price, performance and slots">
</p>
<p>
  <img src="docs/screenshot-galaxy.gif" width="49%" alt="The Galaxy tab turning slowly around your travels: the path with earnings and deaths, other players right now (EDDN) as violet dots, engineers as orange rings">
  <img src="docs/screenshot-stats.png" width="49%" alt="The Stats tab: all-time earnings split into mapping and exobiology, travel numbers and daily activity">
</p>

The same page on your phone, over Wi-Fi:

<p>
  <img src="docs/screenshot-phone-system.png" width="32%" alt="The System tab on a phone: the next route stop, the system's values and the orbit map">
  <img src="docs/screenshot-phone-surface.png" width="32%" alt="The sampling radar on a phone: the distance to the nearest sample and where to go">
  <img src="docs/screenshot-phone-stats.png" width="32%" alt="The Stats tab on a phone: all-time earnings and travel numbers">
</p>

The interface is in English, Ukrainian or Russian; switch it in Settings.

## Quick start (Windows)

1. Download **[EDExplorerKit.exe](../../releases/latest/download/EDExplorerKit.exe)** from the [latest release](../../releases/latest).
2. Run it. Your browser opens **http://127.0.0.1:8765** by itself.
3. Play. The page updates live while the game runs.

Close the black console window to stop the app. Running the exe again while it is already
running just opens the page.

**On your phone or tablet**: on the PC, open **Settings → On your phone** (or the button on the
welcome card) and scan the QR code with the phone, which has to be on the same Wi-Fi. On the first
start Windows asks about the firewall: allow private networks.

> Windows may show "Windows protected your PC" because the exe is not code-signed.
> Click **More info → Run anyway**. If you would rather not trust a downloaded exe, use
> Docker or run from source (below): both build from this repository's code.

If your journal is not in the standard place (`Saved Games\Frontier Developments\Elite Dangerous`),
the page says so: choose the folder in **Settings → Journal folder**.

On first start the app reads your whole journal history, which takes from a few seconds
to a minute.

## Run with Docker

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/). In the repository folder:

```powershell
docker compose up -d --build
```

Open **http://127.0.0.1:8765**. Stop it with `docker compose down`.

The journal folder `%USERPROFILE%\Saved Games\Frontier Developments\Elite Dangerous`
is mounted read-only. If yours is elsewhere (for example, Saved Games moved to OneDrive),
set `ED_JOURNAL_DIR` first:

```powershell
$env:ED_JOURNAL_DIR = "D:\OneDrive\Saved Games\Frontier Developments\Elite Dangerous"
docker compose up -d --build
```

The database is kept in the `data` Docker volume between restarts. To open the page from
other devices on your network, change the port line in `docker-compose.yml` to
`"8765:8765"`. In a container the app can't see the game process, so "game running"
in the header is judged from the journal.

## Run from source

Requires [uv](https://docs.astral.sh/uv/) and [Node.js](https://nodejs.org/) 22 or newer.
Clone or download this repository, then in its folder (PowerShell):

```powershell
.\start.ps1            # builds the UI, then serves http://127.0.0.1:8765, and to your phone on the same Wi-Fi
.\start.ps1 -Local     # this PC only
.\start.ps1 -SkipBuild # start without rebuilding the UI
```

If PowerShell says running scripts is disabled, start it as
`powershell -ExecutionPolicy Bypass -File .\start.ps1`.

Or step by step:

```powershell
cd frontend; npm install; npm run build; cd ..
cd backend;  uv run python -m app.main
```

## Options

Pass them to the exe (`EDExplorerKit.exe --offline`, or in a shortcut's target) or to
`uv run python -m app.main`.

| Option | What it does |
|---|---|
| `--local` | This PC only: no access from your phone or other devices on the network |
| `--offline` | No requests to Spansh/EDSM and no EDDN (route planning and live players are then off) |
| `--port 8765` | Use another port |
| `--journal-dir PATH` | Journal folder, if not in the standard place (or choose it in Settings; set here, Settings cannot change it) |
| `--data-dir PATH` | Where `data.db` is stored (or move it in Settings; set here, Settings cannot change it) |
| `--rebuild` | Rebuild the database from the stored journal events |
| `--no-browser` | Don't open the browser on start (the exe opens it by default) |

## Your data

- The app reads the game journal (`Saved Games\Frontier Developments\Elite Dangerous`) and never writes to it.
- Devices on your network (your phone) can open the page; the journal folder can only be changed on the PC itself. `--local` keeps the page to this PC.
- The database lives in `%LOCALAPPDATA%\EDExplorerKit\data.db` unless you move it (Settings → Data folder; it moves the next time the app starts). It takes a little more room than your journals. Before it reads a long journal history the app checks the drive: when the database would not fit, or would grow past 500 MB, the read waits until you choose where to keep it. Deleting it is safe while the journals are there: it is rebuilt from them on the next start. It also stores the journal events themselves, so after losing the journals (reinstall, new PC) your history survives only in this file. Keep a copy.
- Only these requests go online: community data for the current system, route search, neutron routes, checks of the plotted route's systems, stations near you (where to sell, the Shop) (Spansh and EDSM), and other players' finds on the planet the Surface globe shows (Canonn). While the "players now" layer of the galaxy map is on, the app also listens to the [EDDN](https://github.com/EDCD/EDDN) relay: it only receives (about 20 KiB/s at busy times, the whole feed) and sends nothing; it hangs up a couple of minutes after the layer is closed. `--offline` turns them all off.

## Development

```powershell
cd backend;  uv run python -m app.main          # API on :8765
cd frontend; npm run dev                        # UI on :5173, proxies /api to the backend
cd frontend; npm run dev -- --open "/?mock=1"   # UI on mock data, no backend needed
cd backend;  uv run pytest -q
cd frontend; npm test
```

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).

### Releasing

1. Bump the version in `backend/app/__init__.py` and `backend/pyproject.toml`.
2. Tag and push: `git tag v0.1.0; git push origin v0.1.0`.
3. The [Release workflow](.github/workflows/release.yml) tests the code, builds `EDExplorerKit.exe`
   and publishes it as a GitHub release.

To build the exe locally: `.\packaging\build-exe.ps1` produces `dist\EDExplorerKit.exe`.

## Credits

Community data: [Spansh](https://spansh.co.uk/) and [EDSM](https://www.edsm.net/).
Exobiology rules are derived from [Canonn](https://canonn.science/) research data
(details in [backend/app/exobio/SOURCES.md](backend/app/exobio/SOURCES.md)).
Other players: [EDDN](https://github.com/EDCD/EDDN), the Elite Dangerous Data Network.
Ship and module names: [EDCD FDevIDs](https://github.com/EDCD/FDevIDs). Ship and module prices and figures:
[EDSY](https://edsy.org) by taleden (CC BY-NC 4.0). Ship outlines: traced from the blueprint sheets by [elite-dangerous-blog.co.uk](https://www.elite-dangerous-blog.co.uk) on the Elite Dangerous Wiki (35 ships); the others are fan art drawn for this app, not Frontier's art.
Codex region map: [EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap)
by Ben Peddell (MIT, [backend/app/data/regionmap-LICENSE](backend/app/data/regionmap-LICENSE)).

ED Explorer Kit is a fan-made tool, not affiliated with or endorsed by Frontier Developments.
Elite Dangerous is a trademark of Frontier Developments plc.

## Support

ED Explorer Kit is free. If it helps you on your journeys, you can support its development on
[Patreon](https://www.patreon.com/mlinzo).

## Contact

Questions, ideas or bug reports: [mlinzo.dev@gmail.com](mailto:mlinzo.dev@gmail.com).

## License

[MIT](LICENSE)

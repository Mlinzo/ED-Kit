# Roadmap

Decisions as of 2026-10-17. The order under "Doing" is a list, not a priority.

## Doing

### Flight safety: what is left
- Refuelling stops in our own route planner: not needed for now. The game plots the jumps between
  stops, and the fuel forecast for the route plotted in the game covers it. Come back to it if that
  turns out not to be enough.

### Guide for new explorers: what is left
- Check texts about game mechanics against sources: mechanics change, and a wrong guide for a
  newcomer is worse than none. Re-check the guide after big game updates.

### Release
- Delete the `v0.1.0` release (2026-10-17; the repository is private for now) with its tag, and
  release again once the app is in decent shape (decided 2026-10-19). On 2026-10-20 origin had no
  tags left, but the local `v0.1.0` still points at the 2026-10-17 commit: `git tag -d v0.1.0`
  before tagging again, and delete a leftover draft release in the web UI (Releases). The version
  stays 0.1.0: nobody outside has seen it. Make the repository public before announcing it (the
  post links to `releases/latest`).

## Deferred
- Rank progress (Explorer, Exobiologist).
- Ship condition: module wear, AFMU ammo, FSD damage from neutron boosts.
- Materials for FSD injection synthesis (jumponium).
- Named players on the galaxy map and a "come get me" beacon (a Discord player's idea): only those
  who opted in are visible, either through public EDSM profiles from a list of names or through our
  own server with authorization. Off by default: a live position is what gankers look for.
- Discovery chance from the share of known systems nearby (Spansh counts them cheaply): in the
  2026-10-19 measurement almost all the "grey" systems were in empty areas, so there was nothing to
  check it on.

## Not doing
- Sound and browser notifications.
- A warning on entering a new codex region (decided 2026-10-19).
- The mass code (a–h) from the system name in the discovery chance: the EDDN measurement on
  2026-10-19 found no signal beyond what the databases know and the star class.
- Distances to Sol, Colonia, Sag A*, Beagle Point as a separate line, and a custom goal with a
  progress percentage (decided 2026-10-19): they change no decision in flight. Landmarks with their
  distance are quick buttons in the "Get there" route goal.
- Fresh fleet carrier positions from EDDN for "Where to sell", and a 24-hour heat map of players
  (decided 2026-10-19): both need EDDN received all the time (~75 MB/h at peak hours), and the server
  listens to it only while the "Players now" layer is open.
- Filling the gaps before the app was installed from the EDSM flight log (decided 2026-10-19): it
  needs the player's API key.
- A guided tour on first launch (decided 2026-10-19): players skip such tours, they annoy in every
  new browser and go stale with each change of the interface. A welcome card and clear empty states
  instead.

## Done
- Share the stats (2026-10-22): "Share" on the Stats tab takes the whole tab, as it is on the
  screen, into one long PNG (twice the screen's pixels where the canvas allows it), with the
  commander name or without it (remembered per browser); "?" tips and show-more buttons stay out.
  Download, copy to the clipboard, or send through the system's share sheet where the browser
  allows (a secure page: the PC itself); on a phone over the LAN the picture is held to save it.
  A drawn 16:9 card with the galaxy and your travels was tried first and dropped: the tab as it
  is was wanted.
- First footfalls by the bonus's rule (2026-10-22): stepping out counts as your first footfall
  only where nobody has mapped the planet or walked on it, outside populated systems
  (`exobio.untouched`, shared with the ×5 bonus). `WasFootfalled: false` alone counted HR 1172
  A 8 a and A 8 d, where others had landed and logged every species (and had mapped both).
- Shop catalog cards (2026-10-21): choosing a ship opens its card: a blueprint sketch (top, side
  and rear views in true scale, dimension lines; 35 ships traced from the wiki's blueprint sheets
  by `tools/ship_outlines.py`, which also reads screenshots of the game's schematics; the other 13
  hand-drawn for the app as fan art from the wiki's
  pictures and dimensions, without a rear view; the Anaconda Mk II, out for ARX only since
  2026-10-20 and missing from FDevIDs, is listed from EDSY with "no station sells it yet" and no
  drawing), the maker, the base price, speed and boost, shields and armour,
  hull mass, hardness, mass lock, crew seats, the core, optional and military slots and the
  hardpoints by size, and the navy rank against yours. A module card shows an icon by kind, the
  price, mass, power draw, integrity and its own figures (an FSD's optimal mass and fuel per jump,
  a weapon's DPS, range and ammo...). Arrows flip through the ships (by price by default, or by
  name or pad size; the ship list follows the same order with each pad and price, and type
  buttons above it (combat, multipurpose, exploration, freight, passengers, mining, from the wiki)
  narrow both; the card names the ship's types and whether a fighter hangar fits) or a group's
  modules; "where to buy" follows below. Prices and figures from EDSY (CC BY-NC 4.0).
  The starter kit's `_free` modules left the catalog (a variant could pick one and find nothing).
  The Surface tab names the colour of the species being sampled.
- Shop tab (2026-10-21): on opening, the nearest shipyards and outfitting with how many ships and
  modules Spansh knows each sells; choose a ship or a module by words ("fsd 5a", "dbx", "mc
  gimballed") or from the lists (ships; core, optional, hardpoints, utility), and a module's class,
  mount, rating and missile guidance are buttons. The nearest stations selling exactly that, with
  price, the date of the station's report (old ones marked; Spansh had shipyards from 2021), "Route
  here", the pad your ship needs; carriers on request as in "Where to sell". Told, not filtered:
  the navy rank a ship needs against yours (journal), modules unlocked through Powerplay or a
  technology broker, permit-locked systems. The catalog (48 ships, 136 modules) comes from EDCD
  FDevIDs under Spansh's names, minus what no station sells (`tools/shop_catalog.py`). Eight tabs:
  the top bar shows short names between xl and 2xl, the phone bar is tighter.
- The ×5 bonus only on planets nobody mapped (2026-10-21): besides no recorded footfall and no
  population, `WasMapped` must be false (`exobio.bonus_likely`): whoever samples a planet nearly
  always maps it first, and the first map is recorded reliably, unlike the footfall (HR 1172 A 8 a
  and A 8 d: no footfall recorded, both mapped, every species logged by others). Routes never
  counted the bonus.
- The ×5 exobiology bonus as "likely" (2026-10-21): the game pays it per species for "First
  Logged" (nobody handed that species in from that body before you), and the app can only guess it
  from "nobody landed here" in an unpopulated system. The guess failed on HR 1172 A 8 a: no footfall
  recorded, yet another commander had logged its species. The species line now says "×5 bonus
  likely" and tells how to check in the game (system map → Organic Information, "First logged by").
  `ScanOrganic.WasLogged: true` rules the bonus out for that species on that body (its value, the
  body total, unsold and at-risk sums), marked "already handed in". `false` proves nothing: the game
  only writes the real value once the bio details were opened on the system map (Frontier issue
  81891), so a species analysed before that keeps the bonus until the sale brings the real figure.
  Not done: Canonn's per-system scans, which would flag such planets before landing (the only two
  such bodies in the player's history are both in HR 1172).
- Phone access by default (2026-10-20): the app listens on the network unless started with
  `--local` (before, `--lan` opted in), so a newcomer's phone on the same Wi-Fi opens it with no
  flags. Settings → "On your phone" (shown on the PC only) has a QR code of the address (the default
  route's address first, the others below) and what to check when the phone does not get through:
  the same Wi-Fi, the Windows firewall (allow private networks; after Cancel, "Allow an app through
  firewall"), the network marked private. The welcome card has a button to it, the console prints
  the address. The journal folder can only be changed from the PC itself (403 from another device: a
  path sent over the network could point the app at someone's share); a phone shows it read-only.
  Docker is unchanged: its port stays on 127.0.0.1, and the container cannot know the PC's address.
- Past sessions (2026-10-20): at the bottom of the Session tab, one row per game run (from loading
  the commander to quitting; the main menu and another game mode stay in the same session, a crash
  ends it at its last event): when, how long, jumps, bodies, species, new codex entries, earned and
  per hour, sorted by any column. Earned is the data gathered in the session, sold or not (mapping
  estimate and analysed species), not what was sold then; data lost on a death since shows as a red
  mark, in the session that gathered it. A row opens the details: systems, distance, mapped bodies,
  firsts, mapping and exobiology apart, deaths and the new codex entries by name. The session going
  on is marked "Now" and counts up live. On the player's journals: 24 sessions, 52 h; the codex count
  (the game's IsNewEntry) agreed with the first occurrence of each entry in all 61 CodexEntry events.
- "New colour" codex mark (2026-10-19): a colour not logged in this region of a species that
  is logged here (in another colour) is marked "New colour" (outlined), not "New to Codex";
  the hints no longer say colours are ignored. Checked against the game: on every biological
  CodexEntry in the player's journals (27) the app's mark agreed with the game's IsNewEntry.
  Colours around Y dwarfs fixed: a body orbiting a Y brown dwarf takes the colour of the next
  star up (Canonn biostats: Y dwarfs give their own colour in 1 % of 66,566 samples, T and L
  dwarfs in 87 % and 96 %). Before, the app predicted Indigo for Stratum Cucumisis on HIP 16896
  7 c/e/f (moons of a Y dwarf orbiting an F star) where the game gives Emerald, so a species
  already logged looked new; the player's star-coloured samples now match 25 of 25 (18 before).
- Jump range with the fuel aboard (2026-10-19): the journal's MaxJumpRange (34.90 ly in the game's
  brackets) is the range with fuel for just one jump; the app counted the jumps to the next stop
  with it and wrote "1 jump" where the game plotted two with a full 112 t tank (27.4 ly). The
  range now follows the mass of the fuel and cargo aboard (EDSY's formula, the drive's max fuel
  per jump from its own fuel curve; a Guardian FSD booster adds its flat share): the jumps from
  here use the fuel aboard, the hops between stops and the Spansh neutron and transit routes a
  full tank. The Route tab's Progress card shows the range with the maximum, and a stop just out
  of reach says how much fuel at most makes it one jump (only with fuel to spare for another
  full jump on arrival). The guide's fuel scoop topic says fuel weighs like cargo.
- Genera deduced before DSS (2026-10-19): when the genera that can grow on a planet are as many as
  its biological signals, all of them are there. The System tab marks their species "Genus deduced"
  (certain, as after a DSS: the codex mark is solid, the "DSS needed" hint goes), and codex routes
  count them fully instead of at half weight. Measured first on 18,000 Spansh bodies from 12 parts
  of the galaxy, 6977 of them with DSS genera: the rule applied to 2250 and was wrong once (a
  pre-Odyssey organism, Crystalline Shards, where a Bacterium was expected); in your own journals 4
  of 4. Counting the pre-Odyssey genera too would never be wrong but would apply to 482 bodies only
  (their rules are loose), so it is not done. Spansh's genus name "Tubers" (Sinuous Tubers, 131
  bodies) is now recognised in routes.
- First run (2026-10-19): a welcome card on the System tab until closed — the app reads the journal
  on this computer and sends it nowhere, the tabs fill in by themselves — with a button to the
  guide's five steps. The journal folder is chosen in Settings (paste a path; quotes from "Copy as
  path" and %VARS% are fine), read at once without a restart and kept; "back to the standard
  folder"; a folder set at launch (`--journal-dir`, Docker) is only shown. The top bar says when the
  folder is missing or has no journal files yet (start the game, or choose the folder). On a fresh
  install the System tab says to start the game instead of "you have not been here". The highlight
  thresholds moved from Settings to the System tab, next to the bodies: a button with the current
  values ("DSS ≥500k · Bio ≥2M") opens a panel without a backdrop, and the map changes behind it.
- Guide for new explorers (2026-10-19): the game explained, not only the app. A book in the top bar
  opens the guide (a panel on the right, full screen on a phone): exploring in five steps, then 16
  topics in five sections (scanning a system, credits, exobiology, travel, where the data comes
  from), each with a one-line summary, the details, what the app does about it and links to the
  sources (Elite Dangerous Wiki, Canonn, Spansh, Frontier forums, EDSM, EDDN). Search by words. A
  "?" next to terms on the tabs opens the guide at its topic: system scan tiles, body details
  (values, biology, discovery, footfall, codex, community data), sampling, at risk, where to sell,
  the route goal, the plotted route, the neutron route, codex regions, firsts. Facts were checked on
  2026-10-19 against the wiki, Canonn data and what the app's payout model was validated on.
- "Get there" (2026-10-19): the third route goal (the "Goal" switch, formerly "What we look for").
  Spansh's neutron route to a system: its waypoints are the route stops (jumps to each, where to
  supercharge the FSD), ticked off by the journal, the next one shown on the System tab. Quick
  "Where to" buttons with distances: the nearest place to sell, Sol, Colonia, Sag A*, Beagle Point;
  in "Where to sell" every place has a "Route here" button.
- "Plotted in game" revised (2026-10-19): at the top only what needs attention: fuel, a dangerous
  star on the next jump, systems ahead that are likely undiscovered (by name), and systems with your
  notes; otherwise a single "Nothing special ahead" line. The jump table is collapsed. The line on
  the System tab shows only with a warning or a likely first discovery.
- At risk and where to sell (2026-10-19): on the Session tab, how the sum at risk built up system by
  system since the last sale (a chart), the last sale and the last docking at a station, and "Where
  to sell": the nearest systems with Universal Cartographics and Vista Genomics stations (Spansh)
  and the stations you docked at (works offline too). Per system the station buying both kinds of
  data, otherwise the best one for each; the pad your ship needs is taken into account. Carriers
  behind a switch (off by default: they move away and the owner may close docking): those closed to
  the public or not seen for 30 days are never shown, the rest are marked "open to all" / "access
  unknown" with when they were seen; a hint when a carrier is nearer than every station. A note
  that the current system's cartographic data cannot be sold in it.
- Codex route and the codex by colour (2026-10-19): the route form's "What we look for: Credits /
  Codex". Codex means bodies with biology where species missing from your codex for that region
  are expected, colours included: in the game each colour of a species is its own entry (the colour
  comes from the parent star for 64 species, from the body's materials for 26). Genera not confirmed
  by DSS count at half weight, an entry counts once per route; what you log in the game drops out
  of the route. The System tab also counts the codex by colour and shows the species' colour.
- Discovery chance measured (2026-10-19): the model's numbers come from EDDN: the routes players
  plotted, what Spansh and EDSM knew about those systems at upload time, and the scans on arrival.
  "Only in routes" far from the bubble is 90 % (was 60 %: such rows appear from the very route
  uploaded, even your own), the correction near the bubble is stronger and wider (×0.1 within
  1000 ly, ×0.3 within 3000, ×0.75 within 10,000). Checked on 2.5 h left out of the fit (1907
  systems): 460 first discoveries expected, 434 seen. The numbers were then refined on all 4 h: a
  known star is 2 % (was 3 %), the correction for neutron stars and white dwarfs is gone (far from
  the bubble they are first as often as their neighbours: 97 % of 29). Forecast error (Brier):
  guesses 0.050 → 0.043 on all 4 h.
- Notes (2026-10-19): your own text for a system and for a body. Shown and edited on the System tab
  (a body's in its card, an icon in the list), in the route plotted in the game (a line under the
  system), on the galaxy map (a ring on your systems, a separate mark on those you have not been
  to; edited in the pinned card), in History (the text in the row, a "With notes" filter). Stored
  apart from the journal, never rebuilt.
- A system you have not been to (2026-10-19): the System tab opens any system by address (from a
  card on the galaxy map: engineers, players) with Spansh and EDSM data: bodies, value, orbit map;
  marked "You have not been here". With `--offline`, only those already fetched.
- Engineers on the galaxy map (2026-10-18): all 38 (25 ship, 13 on-foot), bases checked against
  EDSM; your progress from the journal (`EngineerProgress`): unlocked with rank, invited, known.
  Card: base, system, distance from you. The layer is toggled with a button.
- Players now (2026-10-18): the "Players now (EDDN)" layer on the galaxy map, off by default.
  Systems where someone was in the last 5 minutes (arrived, scanned, logged to the codex, docked),
  size by number of players, brightness by freshness; the card says how we know. No names. EDDN
  gives every player a new ID every 3 minutes (against tracking), so players are counted over the
  last full 3 minutes (~450–750 of ~6000 on Steam: only those running EDMC and the like are seen),
  and a player who moved may show as two dots; the game mode (Open/Solo) is not sent through EDDN.
  Two IDs sending the same events (two programs of one player) count as one. The server listens to
  EDDN only while the layer is open (the whole stream is ~20 KiB/s); `--offline` turns it off.
- Codex regions (2026-10-18): the EliteDangerousRegionMap region map (MIT) gives the region of any
  system by its coordinates, not only after a codex entry (regional species predictions and the
  "new to the region" mark work right on arrival). On the Galaxy tab: region borders and names on
  the map, visited ones highlighted, a "Regions" figure, a list of regions with their systems and
  codex entries; a click shows the region on the map.
- Long-flight safety (2026-10-17): the route plotted in the game (`NavRoute.json`) on the Route tab
  and as a strip on the System tab: fuel jump by jump (your own FSD's fuel curve learnt from the
  journal, ~0.01 % accuracy), where to refuel, stretches with no scoopable star, neutron stars and
  white dwarfs ahead. Spansh's neutron route to the next stop of our own route (the first one too),
  with progress from the journal.
- Discovery chance (2026-10-17): for the systems of the route plotted in the game, Spansh, then
  EDSM: whether the main star is known, whether there are bodies, or whether the system is seen
  only in other players' routes; corrections for the bubble and Colonia. After arrival, from your
  own scan: whether you were first. Our own route's systems come from Spansh and are always known,
  so they are not checked.
- Galaxy (2026-10-17): a tab with a 3D map: every visited system (colour by earnings and firsts),
  the path in arrival order, broken where you did not fly (respawn), deaths and losses, unsold data,
  our route and the route plotted in the game, landmarks, our own sketch of the galaxy behind. A
  click pins the system card (2026-10-19): copy the name or open the system in a new tab.
- Localization (2026-10-17): English by default, Ukrainian, Russian; a switch in the settings.
  Names from the game stay in English. Russian stays as the third language (decided 2026-10-19).

## Open questions
- A separate interface for miners (a Discord player's request, 2026-10-17): places in the galaxy,
  places on planets, refinery output in tonnes per hour. The journal has it (`ProspectedAsteroid`,
  `AsteroidCracked`, `MiningRefined`). First find out which tools he uses.

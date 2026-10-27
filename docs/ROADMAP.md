# Roadmap

Decisions as of 2026-10-17. The order under "Doing" is a list, not a priority.

The aim (2026-10-28): everything a player now does on other sites can be done in this app. A tool
from another site is not copied whole: only what is most useful in it comes over.

## Doing

### Mining statistics (2026-10-28)
On the Mining tab, a "Your mining" block. All of it comes from the journal, which the database
already keeps in full, so earlier mining counts too.
- The current run, live: tonnes refined per commodity (`MiningRefined`, one event per tonne),
  tonnes per hour, limpets used per tonne (`LaunchDrone` by type), asteroids prospected and their
  content (`ProspectedAsteroid`: Low/Medium/High, motherlodes), cores cracked (`AsteroidCracked`),
  minutes left until the hold is full (`Cargo` against the Loadout's cargo capacity).
- Past runs: ring, date, duration, tonnes, tonnes per hour, limpets per tonne, to compare rings.
- Earnings: `MarketSell` of mined commodities, credits and credits per hour. A sale does not say
  the goods were mined: take mineable commodities with `AvgPricePaid` 0; bought goods of the same
  kind in the hold blur the numbers.
- Lifetime: the game's own counters from `Statistics` (`Mining_Profits`, `Quantity_Mined`), which
  cover the time before the journals but change only at login.
- Not in the journal: which ring a refined tonne came from (take your location at that moment),
  which asteroid gave it, fragments left behind.

### High Grade Emissions finder (2026-10-28)
What is useful in edgalaxy.net/hge, in the app, so that the player does not need that site: systems
where other players saw High Grade Emissions since the last BGS tick, grouped by the grade 5
materials they give (Imperial Shielding; Core Dynamics & Proprietary Composites; Proto Alloys &
Heat Radiators; Military Grade Alloys & Supercapacitors; Pharmaceutical Isolators; Improvised
Components), how many signals and how long ago, plus what we add: distance from you, nearest
first, and the player's own HGE scans from the journal (`FSSSignalDiscovered`).
- Source: EDDN `fsssignaldiscovered/1` keeps USS signals with `USSType`, `SpawningState`,
  `SpawningFaction` (`TimeRemaining` is dropped). The app hears EDDN only while it runs, and today
  only while the "Players now" layer is open, so a full list since the tick needs the listener on
  whenever the app runs (filtered to this schema), or another source. To settle before building.
- The site's tip goes along: signals not there on arrival come back after a jump out and back in.

### Flight safety: what is left
- Refuelling stops in our own route planner: not needed for now. The game plots the jumps between
  stops, and the fuel forecast for the route plotted in the game covers it. Come back to it if that
  turns out not to be enough.

### Guide for new explorers: what is left
- Check texts about game mechanics against sources: mechanics change, and a wrong guide for a
  newcomer is worse than none. Re-check the guide after big game updates.

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
- Mining tab (2026-10-27), after EDTools' Miner's Tool: choose one of 14 commodities worth mining
  (the 13 with ring hotspots, and Osmium); the nearest rings with its hotspots (how many,
  highlighted from two up as they may overlap, the ring type, the body's reserves, the other
  hotspots there, the nearest buyer listed), the markets within 500 ly paying the most for it
  (price, demand, how old the market data is, pads for your ship; ordered by price, distance or
  demand; fleet carriers on request, the best-paying one named while hidden: carriers' buy orders
  often pay far more), and the shortest trip from you to a ring, then to its buyer. Spansh data,
  kept an hour. At the edge of the bubble: Platinum rings 4-16 ly away, buyers up to
  333,030 cr/t. Ten tabs: the phone bar's cells take the width their label needs from 360 px (a
  pixel smaller below 390 px), and the top bar shows tab names from 1440 px and the commander's
  name from 1600 px. Then filters, asked of Spansh so they reach past the first answers: rings by
  the body's reserves (any of the five levels) and distance from the arrival star; markets by
  least demand (your hold from the latest Loadout, or 1,000-10,000 t), how fresh the prices are
  (a day to a month) and distance from the star. A ring reads "ABC 1 · ring A": "ABC 1 A Ring"
  read as a body "ABC 1 A" to fly to. The lists became compact two-line rows (the distance or the
  price in a column on the left, a route icon on the right; twelve rows fit a second monitor where
  five did), and the per-ring "sell at" line went: buyers far away made it the same on every ring.
- Systems the game knew in advance (2026-10-27): in most populated systems the honk finds every
  body known at once (Progress 1.0) and the journal gets no Scan, not even the arrival star's, nor
  FSSAllBodiesFound, so "Bodies found" read 0/31 while the game's FSS showed 31/31. A system
  honked to 100 % with nothing ever scanned there now shows every body found, "Known in advance",
  and its FSS scan at 0, "Nothing to sell" (no Scan, no data to sell; the stars' FSS value left
  the DSS total too, the planets' map value stays). In the journals every first honk came after
  the arrival star's own scan (5-6 s after the jump, 115 of 115), so the rule waits for nothing;
  it marks 7 of 180 visited systems, all populated (Deciat, FK Aquarii, LFT 42...). The bodies'
  own FSS values and the History tab's count are as before.
- Engineering goals start from your ship (2026-10-27): a new goal, or another module or
  blueprint in the form, takes its "now" grade from such a module on your current ship (the
  latest Loadout and the rolls at engineers after it; 0 when it has another blueprint or none,
  the lowest of several; the SCO frame shift drive counts as one); a line under the goals says
  rolls are counted as at access level 5 and a lower level takes more.
- Your path on the globe, checked on real play (2026-10-27): the first two days recorded 1,412
  points in 15 stretches on 6 planets, about 1 h 50 min near the ground and 100 km of path, in
  210 KB with the index (150 bytes a point, about 110 KB an hour: you stand still while sampling).
  That is 1 % of the database, so old stretches are not thinned. A stretch starts when you come
  below 5 km after supercruise (its first seconds are fast flight, points up to 1.4 km apart), on
  a relog, or after flying high; it is also split where Status.json briefly loses the position
  (launching the SRV), on the same spot, so the line goes on unbroken.
- Biology still to earn (2026-10-27): on the System tab a planet's bio figure (list, map card,
  body card and its total) drops each species you have analysed there, at its value with the
  bonus, down to 0; the order by value keeps the whole worth, so planets do not move while you
  sample. The Surface tab no longer hands you back to the tab you were on when a species is done:
  the next one is often on the same planet.
- Time spent (2026-10-27): how long you stayed in each system and at each planet (from the
  approach to leaving, landings included), every visit together, and what the stay brought per
  hour (the estimate of your scans and analysed species; stays under 10 minutes get none). The
  journal tells when things happened, not when you were away: each gap between two events goes to
  where you were, a silence over 30 minutes is taken for AFK and not counted, nor is the launcher,
  the main menu or quitting. On the History tab (two columns, and an order by time or by pace), in
  the System tab's header and on a planet's card; where you are now it counts on while the game
  runs. On the author's journals: 65 h in 178 systems; a crash on 2026-10-21 left almost 4 h until
  the next launch that a plain "approach to leaving" count put on one planet.
- Engineering goals and planet materials (2026-10-27): in the Shop, goals for engineers (a kind of
  module, a blueprint, the grade it has and the one to reach, an experimental effect, how many
  modules), several at once; the materials they take are added up (EDSY's recipes; a grade takes
  as many rolls as its number, as at an engineer's top access level) against your stock from the
  journal (the Materials list at each login, then what you collected, traded, spent and were
  given): have / need, what is short first; a material's name opens it in the Shop (traders,
  planets rich in it). Each planet's elements (your scan or Spansh) show on the System tab's body
  card and on the Surface tab, the ones your goals still miss highlighted.
- Materials in the Shop (2026-10-26): materials are never sold, so choosing one (by name or from
  the lists: raw, manufactured, encoded, and Guardian & Thargoid apart, a row per trader group by
  grade) shows the nearest material traders of its type and, for a raw element, the nearest
  landable bodies rich in it (Spansh: at least the share 4 in 5 landable bodies stay under, e.g.
  Arsenic 2.51 %, Polonium 0.59 %), with share, gravity and distance from the arrival star. The
  card tells type, grade and trader group, where the material comes from (the "Known Sources" of
  its Elite Dangerous Wiki page, for 126 of 137) and links the page. Guardian and Thargoid
  materials are taken by no trader: the card says so.
- Commodities in the Shop (2026-10-26): find a commodity by name or by market category (rare ones
  apart) and see the nearest stations whose market had it in stock, with the price a tonne in full,
  the tonnes in stock and how old the report is. Spansh's station search filters on the name and
  some stock; the catalog (379 commodities, 139 rare) is those some market has. Carriers on
  request, as for ships: near the Pleiades the nearest Titanium was on carriers seen a year before.
  Near the Pleiades only carriers had Painite in stock: then the hint names the nearest carrier.
- Bookmarks (2026-10-26): bookmark a system, a body, a station or a spot on a planet, with a tag
  (mining, biology, geology, station & trade, scenic view, other) and your comment; the notes
  became bookmarks with their text as the comment. Where: the System tab (the system, a body, the
  spots on a body, the bookmarked stations), the route plotted in the game, Where to sell and the
  Shop (a station), the globe (tap the ground or a mark, or "Bookmark where I am"; each spot an icon
  of its tag) and the new Bookmarks tab: everything in one list, with search, kind and tag filters,
  newest or nearest first (light years, or metres on the planet you are on), and bookmark where you
  are in one tap (your system, the body you are at, your spot, the station you are docked at).
  Shown in the history ("Bookmarked" filter) and on the galaxy map (a ring in the system's tag
  colour). Private: kept in your database only.
- The first release removed (2026-10-26): the `v0.1.0` tag deleted from origin; v0.2.0 and v0.2.1
  are the releases, and the repository is public.
- Bacterium Tela or Cerbrus in a thin water atmosphere (checked 2026-10-26, nothing to change):
  HIP 19036 3 a gave Tela and 3 b and 3 c Cerbrus, on near twins (rocky, no volcanism,
  0.044–0.048 g, 419–428 K, moons of the same planet). Of the 600 thin-water bodies with biology
  nearest to HIP 19036 on Spansh, other players' finds name the Bacterium on 379: 169 Tela and 210
  Cerbrus, with the same gravity, temperature, pressure, mass, orbit and materials (no measure
  tells them apart better than chance: AUC 0.47–0.53), and 35 systems have both. So the card
  stays "one of two species". Tela's colour comes from a group-B material: each of these bodies
  had two, the larger share won 79 times and the smaller 88, with no fixed order between the
  materials, so every one present stays a candidate. Both HIP 19036 cards came out Green by
  chance: Tela's Tungsten and Cerbrus's K star.
- Chance of each candidate species (2026-10-26): in "one of two species" each candidate shows its
  chance ("49%  Tela", "51%  Cerbrus"), from how often Canonn logged each of them on planets
  with this atmosphere and of this body type. Checked on 1,139 genera where other players' finds
  name the species: it comes true about as often as it says (shown 40–50 %: right 45 % of the
  time; 80–90 %: 94 %), better than equal shares overall and for Bacterium most of all; for
  Clypeus, Stratum and Concha, where the atmosphere does not tell the species apart, it stays
  close to even. Codex routes weigh the candidates the same way since 2026-10-26 (they shared a
  genus equally before).
- Mining locations (2026-10-26): the FSS's "Planetary Mining Location" signals (the most common
  signal in the user's journals: 477 against 143 biological) have their own count instead of
  "other": a "Mining N" badge in the body list, a row under the body's signals and a reason chip;
  Spansh's counts too. Where on the surface the game does not say (no coordinates).
- Database size (2026-10-25). Measured: two weeks of play gave 38 MB (60 % the route planner's
  Spansh cache, 9 MB the journal copy, 3.3 MB community bodies); the journals copied 20 times
  (169 MB, about 1500 hours) gave 200 MB, read in 7.8 s, projections rebuilt in 3.6 s, views in
  0.23 s or less: the database grows with the journals (0.11 MB per hour played; 5000 hours:
  about 650 MB). Now Spansh pages are stored compressed (6.7 times smaller), community bodies not
  looked up for 30 days are dropped, and freed pages go back to the disk at every start (old
  databases are rewritten once). The database can move to another folder in Settings (at the next
  start, copied and checked). Before reading journals the app weighs what the database will take
  against the free space on its drive, and against 500 MB in the standard folder: the read waits
  until the user chooses a folder (or "keep it here"); later it warns below 1 GB free and once the
  database passes 500 MB.
- Planet globe on the Surface tab (2026-10-25): a 3D globe of the planet you are at, with your
  samples (where the app recorded them), your codex finds, landings and take-offs (plane icons,
  side by side when on one spot) and settlements (from the journal, so old journals count too),
  your ship (landed, recalled or dismissed), you with your heading, and other players' finds from
  Canonn (on 34 of 34 planets the user landed on near the Pleiades: 1–194 points each). Every layer says where its data comes from; a tap on a mark gives
  distance and heading from you. The surface is drawn by the app (the game shares no terrain).
  While you sample, a Radar | Planet switch. The system map opens zoomed to the planet you are on.
  Zoom goes down to 500 m over the ground (samples a few hundred metres apart stand apart), with
  made-up surface detail close up; on the ground the globe opens (or turns, as you land) about
  4 km over you. Your path is drawn as you go: the app records it from Status.json while it runs
  (the journal keeps none). On another body than the run in progress, the tab shows the body you
  are at.
- Your ship on the system map (2026-10-25): the map marks the body the game last put you at
  (the arrival star after a jump, a planet you approach, drop at or land on) with pulsing rings,
  and with a still dashed ring, "Last known position", once you fly off. In supercruise a dashed
  line runs from there to the body targeted in the game ("Target in the game"). The game reports
  no position between bodies, so the ship does not move along the line.
- One of several species (2026-10-25): when DSS confirms a genus and the rules leave several of
  its species, the species list shows them as one row, "Tussock — one of two species", with each
  candidate under it; one bio signal is one genus, so only one of them grows there. Such a genus
  counts as "maybe new" to the codex unless every candidate is new. Colours on bodies orbiting a
  barycentre of stars ("AB 1 d") come from its heaviest star, A (25 of 25 species checked on
  Canonn, 10 systems), instead of being unknown.
- ARX ships and the Nomad in the Shop (2026-10-24): every ship no station sells for credits
  stays in the catalog with a note that new ships come out for ARX first (the Anaconda Mk II and
  the Nomad now). The Nomad, a ship-launched vessel in no data source, is added by hand; its card
  opens the Vessel Hangar and Mk II Vessel Hangar that carry it. Module searches ask Spansh only
  for priced modules (the free copies an ARX purchase adds crowded the answer: 7 of 40 stations
  found for a 6D Vessel Hangar sold the real one) and under the old name of a renamed module
  (Fighter Hangar).
- Places you cannot dock at (2026-10-24), in the Shop and "Where to sell": a Powerplay
  Stronghold Carrier is listed only to the pledges of its Power (it sells nearly every module,
  so it led most searches, but turns everybody else away and fires at a rival's pledges); your
  pledge comes from the journal's latest Powerplay event. Megaships Spansh has not heard of for a
  year are left out: the rescue and military ships of the Thargoid war are gone but still in its
  data (half the megaships near the Pleiades). "Where to sell" marks permit-locked systems as the
  Shop does.
- Firsts route (2026-10-22): the route form's fourth goal, "Firsts", plans a route through
  systems nobody has likely discovered yet, around a point or along a line. Spansh knows only
  what somebody uploaded, so the stops are systems it knows only from other players' plotted
  routes (no star, no body: 88 % first far out), and numbers missing in a boxel's numbering: a
  generated name's id64 holds its boxel and its number there, numbered from 0 with no holes
  (checked around Colonia: 448 known systems in 112 boxels, no hole), so if "Froalt MC-S
  b31-49" is known, numbers 0 to 48 exist, and those in no database were never uploaded (96 %
  first far out). The name is exact (the galaxy map finds it by its full name), the position
  only the boxel's centre ("≈" before distances, the card says how far off it may be): one per
  boxel, boxels up to 40 ly, none from a boxel with a catalogue star (near Sol they leave holes:
  names that do not exist). Along a line the stops are a full tank's jump apart, so every jump
  can land in a first. Each stop shows its chance (Spansh and EDSM asked again in the
  background); once you have been there, whether your arrival scan was the first; the progress
  card counts your firsts and those expected ahead. Near the bubble the route comes
  out empty with a hint to start farther out: around the Pleiades and Beagle Point every boxel
  read was complete. Measured live: 50 stops in 1.4-6 s far out, a 22,000 ly line in ~10 s
  (Spansh reads the 3,000 known systems nearest to the line, so a long one can have long hops).
- Minimum value of one species in routes (2026-10-22): besides the biology a planet is worth in
  total, the route form takes the least a single species there must be worth (base value, no
  ×5 bonus; 0, the default: any): a planet counts only if the dearest species that may grow on
  it (DSS genera when known, else the predicted ones) reaches it, so planets with only cheap
  species are left out. Since 2026-10-26 their values count only the species worth that much
  too: a genus whose cheapest candidate is below the minimum may give nothing, so it adds 0 to
  the low end; one whose dearest is below it adds nothing at all.
- Routes do not bring you back, and follow you on (2026-10-22): new routes leave out systems
  where you analysed any species (with "skip finished", on by default): a 50-stop route took
  the player back to Pleiades Sector GW-W c1-15 for the 8 species left after 14 analysed there.
  A stop you leave unfinished and fly past (arriving at a later stop since the route was made)
  counts as skipped, and the next stop follows you; back there, it is the next one again.
- Share the stats (2026-10-22): "Share" on the Stats tab takes the whole tab, as it is on the
  screen, into one long PNG (twice the screen's pixels where the canvas allows it), with the
  commander name or without it (remembered per browser); "?" tips and show-more buttons stay out.
  Download, copy to the clipboard, or send through the system's share sheet where the browser
  allows (a secure page: the PC itself); on a phone over the LAN the picture is held to save it.
  A drawn 16:9 card with the galaxy and your travels was tried first and dropped: the tab as it
  is was wanted. Since 2026-10-26 the picture carries the app's mark and name, small, in its
  bottom right corner (only in the picture, not on the page).
- Where to sell: the next jump first (2026-10-22): the next system of the route plotted in the
  game is asked about on its own (Spansh, the stations of that system) and, when you can sell
  there, it leads the list as "Next jump" (after the system you are in, when that one buys data),
  wherever the nearest station is: it is on the way. Since 2026-10-26 the whole route ahead is
  checked, not only the next jump: one Spansh search per service and kind for up to 100 systems
  ahead (by id64), each system kept 6 h; the first place to sell on the route leads, marked "On
  your route, jump N" ("Next jump" for the next). Asked again only while no place is known ahead
  of the systems not yet answered for and they are within 50 jumps, so a route through empty
  space costs one search per 50 jumps, not one per jump.
- Route tab fixes (2026-10-22): while you are at the next stop and it is not done yet, its card
  also names the stop after it ("Then:", with the copy button and the distance), so the last
  system can be copied from the second to last. "Refresh data" is gone: it rebuilt the route from
  scratch with the same settings, dropping the stops skipped, moved or removed (a new route is
  made with the form; `POST /api/route` still takes `refresh` to bypass the Spansh cache).
- First footfalls by the bonus's rule (2026-10-22): stepping out counts as your first footfall
  only where nobody has mapped the planet or walked on it, outside populated systems
  (`exobio.untouched`, shared with the ×5 bonus). `WasFootfalled: false` alone counted HR 1172
  A 8 a and A 8 d, where others had landed and logged every species (and had mapped both). The
  System tab's body card follows the same rule since 2026-10-26: a planet others mapped says
  "already mapped: someone has likely landed" instead of a green "no footfall yet".
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
- Keeping fewer journal events in the database (2026-10-25): `StoredModules` alone is 29 % of the
  copied lines and the app reads none of them; zlib per row gives only 2.3 times. Left as is so
  that later features can use the whole history; the journals stay on disk too.
- More for miners (a Discord player's request, 2026-10-17): places in the galaxy are on the Mining
  tab (2026-10-27); places on planets are bookmarks; refinery output in tonnes per hour is part of
  "Mining statistics" under Doing (2026-10-28).

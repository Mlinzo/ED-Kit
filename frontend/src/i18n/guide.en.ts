// The guide in English. The shape follows guide.ru.ts; facts were checked against the sources in
// guide/topics.ts, so change a number only with a source.
import type { Strings } from '.'

export const guideEn: Strings['guide'] = {
  title: 'Guide',
  open: 'Guide: the game and the app explained',
  close: 'Close the guide',
  about: (term: string) => `Guide: ${term}`,
  search: 'Search the guide',
  searchPlaceholder: 'DSS, honk, colony range…',
  nothingFound: 'Nothing found',
  sectionsLabel: 'Guide sections',
  intro: 'How exploration works in Elite Dangerous, in short.',
  loopTitle: 'Exploring in five steps',
  loop: [
    'Jump to a system and use the discovery scanner (honk): it shows how many bodies the system has.',
    'Open the FSS and find the bodies: each one pays, and you see which are valuable and which have biology.',
    'Map the valuable planets with the DSS: a map pays several times more.',
    'Land on planets with biological signals and take samples of each species.',
    'Sell the data at Universal Cartographics and Vista Genomics: unsold data is lost if you die.',
  ],
  inApp: 'In the app',
  sources: 'Read more',
  checked: 'The texts were checked against the sources under each topic in October 2026 (game 4.4). Mechanics change with game updates.',
  sections: {
    scan: 'Scanning a system',
    money: 'Credits',
    bio: 'Exobiology',
    travel: 'Travel',
    data: 'Where the data comes from',
  },
  topics: {
    honk: {
      title: 'Discovery scanner (honk)',
      short: 'Every ship has one: hold the trigger for a few seconds and the system’s body count appears.',
      body: [
        'Players call it the honk, after its sound. It is built into every ship: put it in a fire group and hold the trigger until it charges (about 5 seconds). It works in supercruise and in normal space.',
        'The honk tells how many bodies the system has, but not what they are: that is the FSS’s job. The star you arrive at is scanned by itself, and so is any body you fly close to.',
      ],
      inApp: 'The System tab shows “Bodies found”: how many you have scanned out of the count the honk gave. In a system the game knows in advance (most populated ones) every body is known from the start: the tile says “Known in advance”, and the FSS scan is worth nothing there.',
    },
    fss: {
      title: 'FSS: Full Spectrum System Scanner',
      short: 'A built-in scanner for supercruise: tune the frequency, zoom in on the signals, and learn what the bodies are.',
      body: [
        'In supercruise, switch to analysis mode and open the FSS. Bodies show as signals on the frequency band: tune to them and zoom in on each one to identify it.',
        'Every body you identify pays. The FSS tells the body’s class, whether it is terraformable, and how many biological and geological signals a planet has — this is where you decide what to map and where to land.',
      ],
      inApp: 'The System tab fills in as you scan: what each body is worth and what deserves a closer look.',
    },
    dss: {
      title: 'DSS: Detailed Surface Scanner',
      short: 'A module that fires probes at a planet to map it: a map pays several times more than the FSS scan.',
      body: [
        'The DSS is an optional internal module: buy it in a station’s outfitting. Fly close to a planet in supercruise, switch to analysis mode, and fire probes so that their splashes cover the surface.',
        'A mapped planet usually pays 4–6 times as much as its FSS scan, and more if you are the first to map it. Use no more probes than the target the game shows and you get another 25% (efficiency bonus). The map also shows which genera of life grow on the planet, and where.',
        'Map what pays well: Earth-like, water and ammonia worlds, terraformable planets. Cheap rocky and icy bodies are not worth the time.',
      ],
      inApp: 'The System tab highlights the bodies worth mapping; the threshold is in the settings.',
    },
    firsts: {
      title: 'First discovered, first mapped',
      short: 'Your name on a body for every player to see, and more credits — but only if you are the first to sell the data.',
      body: [
        'A body nobody scanned before you gets a “First discovered by” tag with your name and pays noticeably more. Whoever maps a planet first gets “First mapped by”. Landing first in an unpopulated system gives “First footfall” (see Exobiology).',
        'The tag goes to whoever sells the data first, not whoever scanned first. If someone sells before you, or you die before selling, the tag is not yours.',
        'Around the bubble (populated space) and along popular routes almost everything has been discovered. Further from them, most systems have never been visited.',
      ],
      inApp: 'The Route tab’s “Firsts” goal plans a route through systems nobody has likely discovered yet. For the route plotted in the game, the tab estimates which systems ahead are likely undiscovered; the System tab shows who discovered and mapped each body.',
    },
    valuable: {
      title: 'Valuable planets',
      short: 'Earth-like, water and ammonia worlds and terraformable planets pay the most; ordinary rock and ice pay little.',
      body: [
        'The payout depends on the planet’s class and mass, whether it is terraformable, and whether you mapped it. Materials and the orbit make no difference.',
        'Earth-like worlds (ELW), water worlds (WW) and ammonia worlds (AW) pay the most, then terraformable high metal content and rocky planets. A mapped Earth-like is worth millions, an ordinary icy moon a few thousand.',
      ],
      inApp: 'The System tab highlights bodies worth more than the threshold in the settings.',
    },
    riches: {
      title: 'Road to Riches',
      short: 'A route through systems with valuable planets that someone has already found: fly, scan, map, earn.',
      body: [
        'The community databases know which systems have Earth-likes, water worlds and terraformable planets. A planner picks a chain of such systems near you; at each stop you scan and map only what pays well.',
        'Other players discovered these planets, so there is no first discovery bonus, but the base payout is the same and you know in advance that the trip pays. A good way to earn your first exploration ship and rank.',
      ],
      inApp: 'The Route tab builds such routes (Goal: Credits) from Spansh data and ticks the stops off as you scan.',
    },
    sell: {
      title: 'Selling data',
      short: 'Exploration data sells at Universal Cartographics, exobiology at Vista Genomics.',
      body: [
        'Universal Cartographics is among the services of most stations. Vista Genomics is a vendor on a station’s concourse, so not every station has one. Fleet carriers may have both, but a carrier moves on, its owner can close docking, and it keeps a 25% fee on exploration data sales.',
        'Data from the system you are in cannot be sold there: sell it in another system. You do not have to sell everything at once, but the sooner you sell, the less you lose if you die.',
      ],
      inApp: 'The Session tab lists the nearest places to sell (stations from Spansh and the ones you docked at) for your ship’s landing pad size.',
    },
    death: {
      title: 'Death and unsold data',
      short: 'When your ship is destroyed, all unsold exploration data and samples are lost — sometimes weeks of work.',
      body: [
        'When the ship is destroyed you keep credits, ships, materials and ranks, pay the insurance (rebuy), and lose everything unsold: exploration data, exobiology samples and codex vouchers. Dying on foot costs the samples too.',
        'Common causes far from help: running out of fuel (call the Fuel Rats), overheating while scooping, a bad landing or a fall, a neutron star’s jet. Sell your data now and then, and keep enough credits for the rebuy.',
      ],
      inApp: 'What you would lose is always in the header (in amber); the Session tab shows how it built up since the last sale.',
    },
    bio: {
      title: 'Biological signals, genus and species',
      short: 'The FSS shows how many biological signals a planet has: one signal is one genus, and one species of it grows there.',
      body: [
        'A genus (Bacterium, Stratum, Osseus…) is a family; a species (Stratum Tectonicas) is what you sample and get paid for. One signal means one genus on the planet, and only one species of it.',
        'A DSS map shows which genera the planet has. Which species, you find out on the surface, but the atmosphere, temperature, gravity and star narrow it down to a few candidates.',
        'Values differ a lot: from about 1 to 20 million credits per species (without the first footfall bonus).',
      ],
      inApp: 'The System tab predicts the species on each body with their value; after the DSS the confirmed genera replace the guesses. When only as many genera can grow on a planet as it has signals, they are all there: the tab says "Genus deduced" without waiting for the DSS.',
    },
    sampling: {
      title: 'Taking samples',
      short: 'On foot, with the Genetic Sampler: three samples of one species, each far enough from the others.',
      body: [
        'Land and disembark in the Artemis suit: it is the only suit with a Genetic Sampler. A species is complete after three samples from three different plants, each outside the colony range of the others.',
        'The sampler holds one species at a time: sample another species before the third sample and the samples you had are lost. The sampler’s scan pulse highlights plants within 750 m: green ones are not sampled yet, blue ones are.',
        'A species pays once per planet: once it is analysed, the sampler marks its other plants there “Unavailable”. The same species on another planet pays in full again.',
      ],
      inApp: 'The Surface tab opens by itself when you start sampling: where your samples were and how far you still have to walk.',
    },
    colony: {
      title: 'Colony range',
      short: 'The minimum distance between samples of one species: from 100 m to 1 km, depending on the genus.',
      body: [
        'Plants of one species growing next to each other are clones: a new sample only counts beyond the colony range from the earlier ones. Bacterium, Stratum and Fonticulua: 500 m; Osseus and Tubus: 800 m; Electricae: 1000 m; many others 100–300 m.',
        'The game shows the distance to earlier samples on the compass at the top of the screen, and the range in the codex entry.',
      ],
      inApp: 'The Surface tab draws your samples with their colony circles and tells how much further to go.',
    },
    footfall: {
      title: 'First footfall and the ×5 bonus',
      short: 'Vista Genomics pays five times as much for a species nobody handed in from that planet before you.',
      body: [
        'Be the first to step out (on foot or in an SRV) on a planet in an unpopulated system and the system map shows “First footfall” with your name. The tag itself pays nothing.',
        'The money comes at Vista Genomics: a species nobody handed in from that planet before you pays its value plus a bonus four times as large — five times in total. If you landed first, the bonus is almost certainly yours.',
        'It is not a guarantee: now and then the species of a planet nobody landed on were handed in all the same. To check, after the first sample open the system map → Organic Information: “First logged by” names whoever handed the species in first.',
        'Populated systems have no first footfall, and their planets give no bonus.',
      ],
      inApp: 'The System tab counts the bonus only on planets nobody has mapped or walked on, outside populated systems: whoever samples a planet nearly always maps it first, and the first map is recorded reliably, unlike the footfall. Once you have looked at the planet’s bio details on the system map, the next sample also tells the app whether the species was handed in before, and the bonus goes away if it was. Routes never count the bonus.',
    },
    codex: {
      title: 'Codex and regions',
      short: 'The game’s encyclopedia of everything you found, kept separately for each of the 42 galactic regions.',
      body: [
        'Scanning a species, a type of star or a phenomenon logs it in your Codex. Every region counts separately: a species logged near the bubble is new again in another region. Each colour of a species is an entry of its own, and the colour depends on the parent star or on the planet’s materials.',
        'Your first find of a kind in a region gives a codex voucher worth 50,000 Cr. Until you cash it in, it is lost if you die, like other unsold data.',
      ],
      inApp: 'The System tab marks species new to your Codex in the current region; the Galaxy tab shows the region borders; the Route tab plans routes for new entries (Goal: Codex).',
    },
    scoop: {
      title: 'Fuel scoop and KGBFOAM',
      short: 'A fuel scoop refuels the ship from stars of classes K, G, B, F, O, A and M: “KGBFOAM”.',
      body: [
        'Far from stations, fuel only comes from stars, through a fuel scoop module. It works with main sequence stars O, B, A, F, G, K and M; brown dwarfs, white dwarfs, neutron stars and black holes give no fuel.',
        'Scooping heats the ship: watch the temperature, especially at hot white and blue stars. Do not set off on a long trip without a scoop, and refuel early: the next scoopable star may be several jumps away.',
        'Fuel weighs like cargo, and a heavier ship jumps shorter. The game’s maximum jump range (the number in brackets in the galaxy map) is with fuel for just one jump; with a full tank it is lower. With a scoop aboard, extra fuel tanks are rarely worth their weight.',
      ],
      inApp: 'For the route plotted in the game, the Route tab forecasts fuel jump by jump and warns where you must refuel; it also shows your jump range with the fuel aboard.',
    },
    neutron: {
      title: 'Neutron stars and white dwarfs',
      short: 'Fly through a neutron star’s jet and the next jump goes four times as far; a white dwarf gives one and a half.',
      body: [
        'Neutron stars and white dwarfs have two cone-shaped jets. Flying through a jet in supercruise with a fuel scoop fitted supercharges the FSD for one jump: ×4 at a neutron star and ×1.5 at a white dwarf (×6 and ×3 with an FSD Mk II SCO).',
        'Each supercharge damages the FSD a little, and dropping out of supercruise inside a jet is almost always fatal. Bring an AFMU on long trips to repair the drive. These stars give no fuel.',
        'A neutron route, a chain of neutron stars towards your goal, covers thousands of light years in a fraction of the usual jumps.',
      ],
      inApp: 'The Route tab plots neutron routes with Spansh (Goal: Get there) and ticks off the waypoints as you jump.',
    },
    community: {
      title: 'Spansh, EDSM, EDDN and Canonn',
      short: 'Community databases built from what players’ tools upload: other players’ scans, marked in violet here.',
      body: [
        'Tools like EDMC and EDDiscovery read the game journal and send scans to EDDN, a shared data stream. Spansh and EDSM collect it into searchable databases of systems, bodies and stations.',
        'They only know what players with such tools uploaded: a system missing from them may have been visited by someone without the tools. The data can be out of date, too.',
        'Canonn is a research group of players. Its EDMC plugin sends players’ finds (samples, codex entries) with their coordinates on the planet.',
      ],
      inApp: 'This app reads the game journal on your computer and sends it nowhere. It asks Spansh and EDSM about bodies, routes and stations, and Canonn about other players’ finds on the planet the globe shows; their data is marked in violet. Started with --offline, it works without them.',
    },
  },
}

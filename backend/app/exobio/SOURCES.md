# Exobiology data: sources and method

Checked on 2026-10-16 against game version 4.4.1.1 (the player's journals).

## Catalog: symbols, names, values, colony ranges (`catalog.py`)

| Fact | Source |
|---|---|
| Codex species symbols, English names, base values (`reward`) | Canonn codex reference API, `https://us-central1-canonn-api-236217.cloudfunctions.net/query/codex/ref` (118 genetic-sampler species, 90 Odyssey + Radicoida + 27 legacy) |
| Genus symbols (`$Codex_Ent_Bacterial_Genus_Name;` is "Bacterium", `..._Shrubs_...` is "Frutexa", legacy `$Codex_Ent_Brancae_Name;` etc.) | Player journals (`SAASignalsFound.Genuses`, `ScanOrganic`), cross-checked with EDMC-BioScan's genus keys |
| Values cross-check | Elite Dangerous Wiki, Vista Genomics price list (cites Canonn's price list): https://elite-dangerous.fandom.com/wiki/Vista_Genomics. Player journal `SellOrganicData` 2026-10-15: Bacterium Aurasus `Value` 1,000,000, Bacterium Cerbrus `Value` 1,689,800, both `Bonus` 0 |
| Colony ranges per genus, including legacy organisms (100 m) | Elite Dangerous Wiki, Genetic Sampler: https://elite-dangerous.fandom.com/wiki/Genetic_Sampler |
| Radicoida Unica: only in HIP 87621, value 119,037 (CG price 952,296 = 8x), colony range unpublished | https://elite-dangerous.fandom.com/wiki/Radicoida, https://canonn.science/codex/radicoida/, GalNet "Genetic Study of Radicoida Unica Released": https://www.elitedangerous.com/news/galnet/genetic-study-radicoida-unica-released |
| First-footfall bonus: total payout x5; `SellOrganicData.Bonus` = 4 x `Value`; not paid in populated systems | Frontier forum guides: https://forums.frontier.co.uk/threads/an-easy-guide-to-elite-dangerous-exobiology.613194, https://forums.frontier.co.uk/threads/marxs-guide-to-exobiology.583445/ ; cross-checked with EDMC-BioScan's payout logic (bonus = 4 x value, x5 total, unpopulated systems only) |

## Prediction rules (`rules.py`, `regions.py`)

Primary source: Canonn per-variant observation statistics,
`https://us-central1-canonn-api-236217.cloudfunctions.net/query/biostats`
(1,052 codex entries; for each colour variant: counts by atmosphere type, body type,
volcanism, parent ("local") and main ("primary") star class; gravity, temperature and
pressure histograms; codex regions where it was logged).

How the rules were derived:

- Atmosphere, body type and volcanism sets keep categories holding at least 0.2% of a
  species' samples (the rest are data-entry noise). "No volcanism" is required when
  at least 99.5% of samples have none.
- Numeric ranges come from per-variant histograms trimmed of 0.2% tails. Where bins are
  coarse (outliers widen them), boundaries were set from variants with fine histograms
  and from documented community thresholds, e.g. the CO2 temperature ladders of
  Aleoida (175/180/190/197 K) and Tussock (145/155/160/170/175/180/190/197 K).
- Per-atmosphere sub-conditions for multi-atmosphere species (Bacterium Tela, Scopulum,
  Omentum, Verrata, Fumerola, Osseus Discus, Stratum, ...) follow community-documented
  ranges, checked against the Canonn marginals.
- Parent star classes: for species whose colour depends on the star, the set of
  classes that have a codex colour variant (not applied to Frutexa except
  Metallicum/Sponsae, Fonticulua Fluctus, Tussock Propagito/Virgam, Tubus Rosarium,
  Stratum Araneamus). The rare classes O, W and Ae are always allowed. A class without
  a variant is still allowed when Canonn logged >= 1% of a species' samples around it
  (Tussock / neutron star, Tubus / Y dwarf), and gives "possible" (`rare_parent_stars`)
  at >= 0.1% and >= 10 samples (Cactoida / K, Clypeus / T, Concha / M, Osseus / M and L,
  Frutexa / T, K, Y). Below 0.1% the class is treated as noise and the species dropped
  (Aleoida around G: <= 0.05%, Stratum around A/B/G/N: <= 0.07%).
- "No volcanism" (`NO_VOLC`) only where Canonn shows < 0.1% of samples on volcanic
  bodies; at >= 0.1% (and >= 5 samples) volcanism gives "possible" (`NO_VOLC_SOFT`):
  Aleoida Spica/Laminiae, Bacterium Volu, Cactoida Lapis/Peperatis, Fonticulua
  Segmentatus/Upupam/Lapida, Fungoida Setisis, Frutexa Flabellum/Flammasis, Stratum
  Excutitus/Paleas/Laminamus/Limaxus/Tectonicas (0.52%, 1,142 samples), Tussock Catena.
- Electricae Pluma: main star A / B / neutron / white dwarf / Ae / black hole / O
  (Canonn `primaryStars`: N 46%, D 31%, A 14%, black hole 8%). The parent ("local")
  star is not the constraint: 17% of Pluma samples orbit M stars.
- Regions: the codex regions where a species was logged. Arm-limited species match the
  community arm groups exactly (Orion-Cygnus, Sagittarius-Carina, Scutum-Centaurus,
  Perseus, Outer). Species missing from only a few remote regions with few samples
  (Concha Biconcavis, Fonticulua Fluctus, Bacterium Nebulus) are not region-limited.
- Clypeus Speculumi: at least ~2,000 ls from the arrival star (Canonn distance minimum
  2,073 ls). Recepta: SulphurDioxide >= ~1% of the atmosphere.

Cross-check against the Canonn data: for 108 of 118 species the rules cover >= 97% of
the observed samples on every marginal (atmosphere, body, volcanism, gravity,
temperature, pressure). The other 10 fall short on temperature or pressure only, where
coarse histogram bins blur the boundary; variants with fine bins confirm the boundaries
(e.g. Tussock Ventusa 155-160 K, Ignis 161-170 K, Caputus 181-190 K).

Community rule set read only to cross-check facts (no code or data copied):
EDMC-BioScan (GPL-2.0), https://github.com/Silarn/EDMC-BioScan (its rules are in turn
based on Canonn data and community spreadsheets). EDMC-Canonn (GPL-3.0) and ExploData
(GPL) were not used.

## Independent review (2026-10-16)

Re-checked against three sources that do not depend on each other's numbers:

- Catalog: all 118 symbol / name / value entries match the Canonn codex reference;
  114 symbol / name pairs match EDMC-BioScan's species tables (read only); all 96 value
  rows of the wiki Vista Genomics table match; all 21 genus colony ranges match the wiki
  Genetic Sampler table (https://elite-dangerous.fandom.com/wiki/Genetic_Sampler). The
  one disagreement: BioScan lists Concha Biconcavis at 16,777,215 (the old 24-bit codex
  display cap); Canonn sales data and the wiki give 19,010,800, which is kept.
- Rules vs BioScan's rule sets: synthetic bodies at the edges of every BioScan rule set
  (12,825 cases) are all predicted, except where Canonn's observed ranges are narrower
  than BioScan's (Concha Renibus water gravity, Frutexa Fera gravity, thin-water
  temperatures, which Canonn shows only at 390-455 K).
- Rules vs Canonn marginals: every species covers >= 99.9% of its samples on atmosphere,
  body x volcanism and star class (remaining misses are <= 9 samples per species, noise
  level), and no histogram bin lies wholly outside the numeric ranges for > 0.1% of
  samples. Added for this: Stratum Frigus on thin oxygen (9 samples, 0.3%; bounds from
  its sister species Cucumisis).
- Wiki Stratum page (https://elite-dangerous.fandom.com/wiki/Stratum): the colour table
  has no colour for O/B/A/G stars, matching the "no Stratum around A/B/G" rule. The
  player's journals agree: four HMC CO2/SO2 bodies around G stars inside Tectonicas'
  ranges (Col 285 Sector TT-H c10-4 A 6/7/8, HIP 46631 A 6) had only Bacterium.

## Colour variants (`variants.py`, `app/data/codex_variants.json`)

Checked 2026-10-19.

| Fact | Source |
|---|---|
| Each colour of an Odyssey species is its own codex entry, per region: `$Codex_Ent_<Species>_<code>_Name;` | Canonn codex reference (above): 789 Odyssey biology entries, 90 species with colours; the player's journal `CodexEntry` names (e.g. Bacterium Vesicula logged as Yttrium, Ruthenium and Tellurium in one region) |
| 64 species take their colour from a star class (O B A F G K M L T Y TTS Ae W D N), 26 from a material in one of two groups: A = antimony, polonium, ruthenium, technetium, tellurium, yttrium; B = cadmium, mercury, molybdenum, niobium, tin, tungsten | Canonn codex reference: the variant codes per species (`tools/codex_variants.py`) |
| The star is the body's parent star, not the system's main star: the parent star has the variant's class in 97 % of samples (median over 431 star variants with 50+ samples); the main star far less (Aleoida Arcus - Lime: parent L 202/206, main 3/211) | Canonn biostats `histograms.local_stars` / `primary_stars` |
| Group A never share a body: every group-A variant's samples have its own material and none of the other five | Canonn biostats `histograms.materials` |
| Group B often do (14-27 % of a variant's samples hold each other group-B material), and neither a fixed order nor the largest share decides: a player's Fungoida Setisis was Tin on a body with molybdenum 1.24 %, tin 1.13 %. Every group-B material present is a candidate, at equal chance | Canonn biostats; the player's journal |

## Known limitations

- The region comes from the region map by coordinates (app.regionmap) when no
  `CodexEntry` named it yet.
- Group-B colours (see above) cannot be told apart when a body holds several of those
  materials.
- Not checkable from the journal, so capped at "possible": nebula proximity
  (Electricae Radialem, Bark Mounds). Not modelled: Guardian-site proximity (brain
  trees), tuber zones, anemone star colours.
- Circumbinary bodies without a `Star` entry in `Parents` cannot be star-checked.
- Rules describe where a species can grow, not whether life is present: the bio signal
  count from FSS/DSS should gate what the UI shows.

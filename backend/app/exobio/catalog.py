"""Static catalog of genetic-sampler species: codex symbols, names, values, colony ranges.

Symbols are exactly what the journal writes in `ScanOrganic`, `SellOrganicData` and
`SAASignalsFound.Genuses`. Note that genus symbols do not always match the English name
(`$Codex_Ent_Bacterial_Genus_Name;` is "Bacterium", `$Codex_Ent_Shrubs_Genus_Name;` is
"Frutexa"), and that the pre-Odyssey ("legacy") organisms reuse a species-like symbol
as their genus (`$Codex_Ent_Sphere_Name;` is both the Anemone genus and the species
Luteolum Anemone).

Base values are Vista Genomics payouts without the first-footfall bonus. Sources and
cross-checks are listed in SOURCES.md.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import Species


@dataclass(slots=True, frozen=True)
class GenusInfo:
    genus: str  # codex symbol, e.g. "$Codex_Ent_Stratum_Genus_Name;"
    genus_name: str  # English name, e.g. "Stratum"
    colony_range_m: int
    min_value: int  # cheapest species base value
    max_value: int  # most expensive species base value


# genus key -> (codex genus symbol, English name, clonal colony range in metres)
_GENERA: dict[str, tuple[str, str, int]] = {
    "Aleoids": ("$Codex_Ent_Aleoids_Genus_Name;", "Aleoida", 150),
    "Bacterial": ("$Codex_Ent_Bacterial_Genus_Name;", "Bacterium", 500),
    "Cactoid": ("$Codex_Ent_Cactoid_Genus_Name;", "Cactoida", 300),
    "Clypeus": ("$Codex_Ent_Clypeus_Genus_Name;", "Clypeus", 150),
    "Conchas": ("$Codex_Ent_Conchas_Genus_Name;", "Concha", 150),
    "Electricae": ("$Codex_Ent_Electricae_Genus_Name;", "Electricae", 1000),
    "Fonticulus": ("$Codex_Ent_Fonticulus_Genus_Name;", "Fonticulua", 500),
    "Fumerolas": ("$Codex_Ent_Fumerolas_Genus_Name;", "Fumerola", 100),
    "Fungoids": ("$Codex_Ent_Fungoids_Genus_Name;", "Fungoida", 300),
    "Osseus": ("$Codex_Ent_Osseus_Genus_Name;", "Osseus", 800),
    "Recepta": ("$Codex_Ent_Recepta_Genus_Name;", "Recepta", 150),
    "Shrubs": ("$Codex_Ent_Shrubs_Genus_Name;", "Frutexa", 150),
    "Stratum": ("$Codex_Ent_Stratum_Genus_Name;", "Stratum", 500),
    "Tubus": ("$Codex_Ent_Tubus_Genus_Name;", "Tubus", 800),
    "Tussocks": ("$Codex_Ent_Tussocks_Genus_Name;", "Tussock", 200),
    # Unique to the HIP 87621 system. Colony range is not published yet (the wiki
    # lists "?"); 100 m is the smallest range of any genus, used as a placeholder.
    "Radicoida": ("$Codex_Ent_Ingensradices_Genus_Name;", "Radicoida", 100),
    # Legacy (Horizons-era) organisms, sampleable with the genetic sampler since Odyssey.
    "Vents": ("$Codex_Ent_Vents_Name;", "Amphora Plant", 100),
    "Sphere": ("$Codex_Ent_Sphere_Name;", "Anemone", 100),
    "Cone": ("$Codex_Ent_Cone_Name;", "Bark Mound", 100),
    "Brancae": ("$Codex_Ent_Brancae_Name;", "Brain Tree", 100),
    "Ground_Struct_Ice": ("$Codex_Ent_Ground_Struct_Ice_Name;", "Crystalline Shards", 100),
    "Tube": ("$Codex_Ent_Tube_Name;", "Sinuous Tubers", 100),
}

LEGACY_GENERA: frozenset[str] = frozenset(
    _GENERA[k][0] for k in ("Vents", "Sphere", "Cone", "Brancae", "Ground_Struct_Ice", "Tube")
)

# species code -> (genus key, English name, base value in credits).
# The codex species symbol is "$Codex_Ent_<code>_Name;".
_SPECIES: dict[str, tuple[str, str, int]] = {
    # Aleoida
    "Aleoids_01": ("Aleoids", "Aleoida Arcus", 7_252_500),
    "Aleoids_02": ("Aleoids", "Aleoida Coronamus", 6_284_600),
    "Aleoids_03": ("Aleoids", "Aleoida Spica", 3_385_200),
    "Aleoids_04": ("Aleoids", "Aleoida Laminiae", 3_385_200),
    "Aleoids_05": ("Aleoids", "Aleoida Gravis", 12_934_900),
    # Bacterium
    "Bacterial_01": ("Bacterial", "Bacterium Aurasus", 1_000_000),
    "Bacterial_02": ("Bacterial", "Bacterium Nebulus", 5_289_900),
    "Bacterial_03": ("Bacterial", "Bacterium Scopulum", 4_934_500),
    "Bacterial_04": ("Bacterial", "Bacterium Acies", 1_000_000),
    "Bacterial_05": ("Bacterial", "Bacterium Vesicula", 1_000_000),
    "Bacterial_06": ("Bacterial", "Bacterium Alcyoneum", 1_658_500),
    "Bacterial_07": ("Bacterial", "Bacterium Tela", 1_949_000),
    "Bacterial_08": ("Bacterial", "Bacterium Informem", 8_418_000),
    "Bacterial_09": ("Bacterial", "Bacterium Volu", 7_774_700),
    "Bacterial_10": ("Bacterial", "Bacterium Bullaris", 1_152_500),
    "Bacterial_11": ("Bacterial", "Bacterium Omentum", 4_638_900),
    "Bacterial_12": ("Bacterial", "Bacterium Cerbrus", 1_689_800),
    "Bacterial_13": ("Bacterial", "Bacterium Verrata", 3_897_000),
    # Cactoida
    "Cactoid_01": ("Cactoid", "Cactoida Cortexum", 3_667_600),
    "Cactoid_02": ("Cactoid", "Cactoida Lapis", 2_483_600),
    "Cactoid_03": ("Cactoid", "Cactoida Vermis", 16_202_800),
    "Cactoid_04": ("Cactoid", "Cactoida Pullulanta", 3_667_600),
    "Cactoid_05": ("Cactoid", "Cactoida Peperatis", 2_483_600),
    # Clypeus
    "Clypeus_01": ("Clypeus", "Clypeus Lacrimam", 8_418_000),
    "Clypeus_02": ("Clypeus", "Clypeus Margaritus", 11_873_200),
    "Clypeus_03": ("Clypeus", "Clypeus Speculumi", 16_202_800),
    # Concha
    "Conchas_01": ("Conchas", "Concha Renibus", 4_572_400),
    "Conchas_02": ("Conchas", "Concha Aureolas", 7_774_700),
    "Conchas_03": ("Conchas", "Concha Labiata", 2_352_400),
    "Conchas_04": ("Conchas", "Concha Biconcavis", 19_010_800),
    # Electricae
    "Electricae_01": ("Electricae", "Electricae Pluma", 6_284_600),
    "Electricae_02": ("Electricae", "Electricae Radialem", 6_284_600),
    # Fonticulua
    "Fonticulus_01": ("Fonticulus", "Fonticulua Segmentatus", 19_010_800),
    "Fonticulus_02": ("Fonticulus", "Fonticulua Campestris", 1_000_000),
    "Fonticulus_03": ("Fonticulus", "Fonticulua Upupam", 5_727_600),
    "Fonticulus_04": ("Fonticulus", "Fonticulua Lapida", 3_111_000),
    "Fonticulus_05": ("Fonticulus", "Fonticulua Fluctus", 20_000_000),
    "Fonticulus_06": ("Fonticulus", "Fonticulua Digitos", 1_804_100),
    # Fumerola
    "Fumerolas_01": ("Fumerolas", "Fumerola Carbosis", 6_284_600),
    "Fumerolas_02": ("Fumerolas", "Fumerola Extremus", 16_202_800),
    "Fumerolas_03": ("Fumerolas", "Fumerola Nitris", 7_500_900),
    "Fumerolas_04": ("Fumerolas", "Fumerola Aquatis", 6_284_600),
    # Fungoida
    "Fungoids_01": ("Fungoids", "Fungoida Setisis", 1_670_100),
    "Fungoids_02": ("Fungoids", "Fungoida Stabitis", 2_680_300),
    "Fungoids_03": ("Fungoids", "Fungoida Bullarum", 3_703_200),
    "Fungoids_04": ("Fungoids", "Fungoida Gelata", 3_330_300),
    # Osseus
    "Osseus_01": ("Osseus", "Osseus Fractus", 4_027_800),
    "Osseus_02": ("Osseus", "Osseus Discus", 12_934_900),
    "Osseus_03": ("Osseus", "Osseus Spiralis", 2_404_700),
    "Osseus_04": ("Osseus", "Osseus Pumice", 3_156_300),
    "Osseus_05": ("Osseus", "Osseus Cornibus", 1_483_000),
    "Osseus_06": ("Osseus", "Osseus Pellebantus", 9_739_000),
    # Recepta
    "Recepta_01": ("Recepta", "Recepta Umbrux", 12_934_900),
    "Recepta_02": ("Recepta", "Recepta Deltahedronix", 16_202_800),
    "Recepta_03": ("Recepta", "Recepta Conditivus", 14_313_700),
    # Frutexa (codex genus "Shrubs")
    "Shrubs_01": ("Shrubs", "Frutexa Flabellum", 1_808_900),
    "Shrubs_02": ("Shrubs", "Frutexa Acus", 7_774_700),
    "Shrubs_03": ("Shrubs", "Frutexa Metallicum", 1_632_500),
    "Shrubs_04": ("Shrubs", "Frutexa Flammasis", 10_326_000),
    "Shrubs_05": ("Shrubs", "Frutexa Fera", 1_632_500),
    "Shrubs_06": ("Shrubs", "Frutexa Sponsae", 5_988_000),
    "Shrubs_07": ("Shrubs", "Frutexa Collum", 1_639_800),
    # Stratum
    "Stratum_01": ("Stratum", "Stratum Excutitus", 2_448_900),
    "Stratum_02": ("Stratum", "Stratum Paleas", 1_362_000),
    "Stratum_03": ("Stratum", "Stratum Laminamus", 2_788_300),
    "Stratum_04": ("Stratum", "Stratum Araneamus", 2_448_900),
    "Stratum_05": ("Stratum", "Stratum Limaxus", 1_362_000),
    "Stratum_06": ("Stratum", "Stratum Cucumisis", 16_202_800),
    "Stratum_07": ("Stratum", "Stratum Tectonicas", 19_010_800),
    "Stratum_08": ("Stratum", "Stratum Frigus", 2_637_500),
    # Tubus
    "Tubus_01": ("Tubus", "Tubus Conifer", 2_415_500),
    "Tubus_02": ("Tubus", "Tubus Sororibus", 5_727_600),
    "Tubus_03": ("Tubus", "Tubus Cavas", 11_873_200),
    "Tubus_04": ("Tubus", "Tubus Rosarium", 2_637_500),
    "Tubus_05": ("Tubus", "Tubus Compagibus", 7_774_700),
    # Tussock
    "Tussocks_01": ("Tussocks", "Tussock Pennata", 5_853_800),
    "Tussocks_02": ("Tussocks", "Tussock Ventusa", 3_227_700),
    "Tussocks_03": ("Tussocks", "Tussock Ignis", 1_849_000),
    "Tussocks_04": ("Tussocks", "Tussock Cultro", 1_766_600),
    "Tussocks_05": ("Tussocks", "Tussock Catena", 1_766_600),
    "Tussocks_06": ("Tussocks", "Tussock Pennatis", 1_000_000),
    "Tussocks_07": ("Tussocks", "Tussock Serrati", 4_447_100),
    "Tussocks_08": ("Tussocks", "Tussock Albata", 3_252_500),
    "Tussocks_09": ("Tussocks", "Tussock Propagito", 1_000_000),
    "Tussocks_10": ("Tussocks", "Tussock Divisa", 1_766_600),
    "Tussocks_11": ("Tussocks", "Tussock Caputus", 3_472_400),
    "Tussocks_12": ("Tussocks", "Tussock Triticum", 7_774_700),
    "Tussocks_13": ("Tussocks", "Tussock Stigmasis", 19_010_800),
    "Tussocks_14": ("Tussocks", "Tussock Virgam", 14_313_700),
    "Tussocks_15": ("Tussocks", "Tussock Capillum", 7_025_800),
    # Radicoida
    "Ingensradices_Unicus": ("Radicoida", "Radicoida Unica", 119_037),
    # Legacy organisms
    "Vents": ("Vents", "Amphora Plant", 1_628_800),
    "Sphere": ("Sphere", "Luteolum Anemone", 1_499_900),
    "SphereABCD_01": ("Sphere", "Croceum Anemone", 1_499_900),
    "SphereABCD_02": ("Sphere", "Puniceum Anemone", 1_499_900),
    "SphereABCD_03": ("Sphere", "Roseum Anemone", 1_499_900),
    "SphereEFGH": ("Sphere", "Blatteum Bioluminescent Anemone", 1_499_900),
    "SphereEFGH_01": ("Sphere", "Rubeum Bioluminescent Anemone", 1_499_900),
    "SphereEFGH_02": ("Sphere", "Prasinum Bioluminescent Anemone", 1_499_900),
    "SphereEFGH_03": ("Sphere", "Roseum Bioluminescent Anemone", 1_499_900),
    "Cone": ("Cone", "Bark Mounds", 1_471_900),
    "Seed": ("Brancae", "Roseum Brain Tree", 1_593_700),
    "SeedABCD_01": ("Brancae", "Gypseeum Brain Tree", 1_593_700),
    "SeedABCD_02": ("Brancae", "Ostrinum Brain Tree", 1_593_700),
    "SeedABCD_03": ("Brancae", "Viride Brain Tree", 1_593_700),
    "SeedEFGH": ("Brancae", "Lividum Brain Tree", 1_593_700),
    "SeedEFGH_01": ("Brancae", "Aureum Brain Tree", 1_593_700),
    "SeedEFGH_02": ("Brancae", "Puniceum Brain Tree", 1_593_700),
    "SeedEFGH_03": ("Brancae", "Lindigoticum Brain Tree", 1_593_700),
    "Ground_Struct_Ice": ("Ground_Struct_Ice", "Crystalline Shards", 1_628_800),
    "Tube": ("Tube", "Roseum Sinuous Tubers", 1_514_500),
    "TubeABCD_01": ("Tube", "Prasinum Sinuous Tubers", 1_514_500),
    "TubeABCD_02": ("Tube", "Albidum Sinuous Tubers", 1_514_500),
    "TubeABCD_03": ("Tube", "Caeruleum Sinuous Tubers", 1_514_500),
    "TubeEFGH": ("Tube", "Blatteum Sinuous Tubers", 1_514_500),
    "TubeEFGH_01": ("Tube", "Lindigoticum Sinuous Tubers", 1_514_500),
    "TubeEFGH_02": ("Tube", "Violaceum Sinuous Tubers", 1_514_500),
    "TubeEFGH_03": ("Tube", "Viride Sinuous Tubers", 1_514_500),
}


def species_symbol(code: str) -> str:
    return f"$Codex_Ent_{code}_Name;"


SPECIES: dict[str, Species] = {}
SPECIES_BY_CODE: dict[str, Species] = {}
GENERA: dict[str, GenusInfo] = {}
SPECIES_BY_GENUS: dict[str, tuple[Species, ...]] = {}


def _build() -> None:
    by_genus: dict[str, list[Species]] = {}
    for code, (genus_key, name, value) in _SPECIES.items():
        genus_symbol, genus_name, colony = _GENERA[genus_key]
        sp = Species(
            species=species_symbol(code),
            species_name=name,
            genus=genus_symbol,
            genus_name=genus_name,
            base_value=value,
            colony_range_m=colony,
        )
        SPECIES[sp.species] = sp
        SPECIES_BY_CODE[code] = sp
        by_genus.setdefault(genus_symbol, []).append(sp)
    for genus_symbol, genus_name, colony in _GENERA.values():
        members = by_genus[genus_symbol]
        GENERA[genus_symbol] = GenusInfo(
            genus=genus_symbol,
            genus_name=genus_name,
            colony_range_m=colony,
            min_value=min(s.base_value for s in members),
            max_value=max(s.base_value for s in members),
        )
        SPECIES_BY_GENUS[genus_symbol] = tuple(members)


_build()

_SPECIES_LOWER = {k.lower(): v for k, v in SPECIES.items()}
_GENERA_LOWER = {k.lower(): v for k, v in GENERA.items()}
# Variant symbols add a colour code before "_Name;": "$Codex_Ent_Bacterial_01_G_Name;".
_VARIANT_RE = re.compile(r"^(\$codex_ent_.+_\d+)_[a-z]+_name;$")


def lookup_species(symbol: str | None) -> Species | None:
    """Species by codex species symbol; variant symbols resolve to their species."""
    if not symbol:
        return None
    sp = SPECIES.get(symbol)
    if sp is not None:
        return sp
    low = symbol.strip().lower()
    sp = _SPECIES_LOWER.get(low)
    if sp is not None:
        return sp
    match = _VARIANT_RE.match(low)
    return _SPECIES_LOWER.get(match.group(1) + "_name;") if match else None


def lookup_genus(symbol: str | None) -> GenusInfo | None:
    if not symbol:
        return None
    return GENERA.get(symbol) or _GENERA_LOWER.get(symbol.strip().lower())

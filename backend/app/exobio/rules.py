"""Prediction rule table: where each genetic-sampler species grows.

One entry per species code (catalog key). Each entry lists alternative conditions
(usually one per atmosphere type) and species-wide constraints. Values are community
facts re-derived for this project, primarily from Canonn's per-variant observation
statistics (atmosphere/body/volcanism shares, gravity/temperature/pressure ranges,
parent star classes, codex regions) and cross-checked against published community rule
sets and wiki pages. See SOURCES.md for the list.

Conventions:
- Gravity in g, temperature in K, pressure in atm, ranges are inclusive (lo, hi);
  None leaves that end open.
- Atmosphere and body names are journal `AtmosphereType` / `PlanetClass` values.
- `NO_VOLC` = must have no volcanism (Canonn: < 0.1% of samples on volcanic bodies).
  `NO_VOLC_SOFT` = no volcanism expected, but >= 0.1% of samples (and >= 5) were logged
  on volcanic bodies, so a volcanic body gives "possible" instead of dropping the species.
- Star sets: classes with codex colour variants for star-coloured species. Rare classes
  (O, W, Ae) are always allowed, since a missing variant there more likely means "not
  logged yet". Classes without a variant are added when Canonn logged >= 1% of a
  species' samples around them (Tussock / N, Tubus / Y), and become `*_RARE` ("possible"
  instead of dropped) at >= 0.1% and >= 10 samples. Below that the class is noise-level
  (e.g. Aleoida and Stratum around G: <= 0.07%) and the species is dropped.
"""

from __future__ import annotations

from app.exobio.engine import VOLC_RARE, Condition, Range, SpeciesRule
from app.exobio.regions import (
    ALL_REGIONS,
    ORION_CYGNUS,
    ORION_CYGNUS_CORE,
    OUTER,
    PERSEUS,
    PERSEUS_CORE,
    SAGITTARIUS_CARINA,
    SAGITTARIUS_CARINA_CORE,
    SCUTUM_CENTAURUS,
    SCUTUM_CENTAURUS_CORE,
    regions,
)

# --- vocabulary --------------------------------------------------------------------------

CO2, CO2R = "CarbonDioxide", "CarbonDioxideRich"
SO2 = "SulphurDioxide"
NH3 = "Ammonia"
AR, ARR = "Argon", "ArgonRich"
NE, NER = "Neon", "NeonRich"
N2 = "Nitrogen"
O2 = "Oxygen"
CH4, CH4R = "Methane", "MethaneRich"
HE = "Helium"
H2O, H2OR = "Water", "WaterRich"

R = "Rocky body"
HMC = "High metal content body"
I = "Icy body"  # noqa: E741 - journal planet class
RI = "Rocky ice body"
MR = "Metal rich body"
SOLID = (R, HMC, I, RI, MR)

NO_VOLC = ("none",)
NO_VOLC_SOFT = ("none", VOLC_RARE)
ANY_VOLC = ("any",)  # some volcanism required
NONE_OR_WATER = ("none", "water")
HOT_VOLC = ("silicate", "metallic", "rocky")  # silicate vapour geysers, metallic/rocky magma
CARBON_VOLC = ("carbon dioxide", "methane")  # CO2 geysers, methane magma
NITROGEN_VOLC = ("nitrogen", "ammonia")  # nitrogen / ammonia magma
WATER_VOLC = ("water",)  # water geysers / water magma

G_LOW = 0.276  # ceiling of the low-gravity genera
G_HIGH = 0.62  # ceiling of Bacterium / Stratum Tectonicas and friends

_RARE_STARS = ("O", "W", "Ae")


def stars(spec: str) -> frozenset[str]:
    return frozenset(spec.split()) | frozenset(_RARE_STARS)


def c(
    atm: str | tuple[str, ...] | None,
    bodies: str | tuple[str, ...] | None = None,
    g: Range = (None, None),
    t: Range = (None, None),
    p: Range = (None, None),
    volc: tuple[str, ...] | None = None,
    so2: float | None = None,
    dist: float | None = None,
) -> Condition:
    def fs(v: str | tuple[str, ...] | None) -> frozenset[str] | None:
        if v is None:
            return None
        return frozenset((v,) if isinstance(v, str) else v)

    return Condition(
        atmospheres=fs(atm),
        bodies=fs(bodies),
        gravity_g=g,
        temperature_k=t,
        pressure_atm=p,
        volcanism=fs(volc),
        min_so2_percent=so2,
        min_distance_ls=dist,
    )


def rule(*conds: Condition, **kw) -> SpeciesRule:
    return SpeciesRule(conditions=tuple(conds), **kw)


# --- star and region sets ----------------------------------------------------------------------

ALEOIDA_STARS = stars("B A F K M L T Y TTS D N")  # no G (<= 0.05% of samples)
CACTOIDA_STARS = stars("A F G M L T Y TTS D N")  # no B
CACTOIDA_RARE = frozenset({"K"})  # 0.05-0.21% of samples, no variant
CLYPEUS_STARS = stars("B A F G K M L Y D N")  # no TTS
CLYPEUS_RARE = frozenset({"T"})  # Lacrimam 0.32%, Margaritus 0.60%
SPECULUMI_STARS = stars("B A F G K M N")
CONCHA_STARS = stars("B A F G K L Y D N")  # no T, TTS
CONCHA_RARE = frozenset({"M"})  # Aureolas 0.35%, Labiata 0.29%
OSSEUS_STARS = stars("A F G K T Y TTS")  # no B, D, N
OSSEUS_RARE = frozenset({"M", "L"})  # 0.10-0.27% each
STRATUM_STARS = stars("F K M L T Y TTS D")  # no A, B, G, N (<= 0.07% each)
TUBUS_STARS = stars("B A F G K M L T TTS D N Y")  # Y: no variant, yet up to 2.2%
TUSSOCK_STARS = stars("F G K M L T Y D N")  # N: no variant, yet up to 2.2%; no A, B, TTS
FRUTEXA_STARS = stars("B F G M L TTS D N")  # no A (Metallicum, Sponsae only)
FRUTEXA_RARE = frozenset({"T", "K", "Y"})  # Metallicum T 0.67%, Sponsae K 0.43%, Y 0.36%
# System main star (Canonn `primaryStars`: N 46%, D 31%, A 14%, black hole 8%, Ae, B, O).
PLUMA_PRIMARY = frozenset({"A", "B", "N", "D", "Ae", "H", "O"})

_GC_ODIN = regions("Galactic Centre", "Odin's Hold")
SPICA_REGIONS = (ALL_REGIONS - (ORION_CYGNUS | SAGITTARIUS_CARINA)) | _GC_ODIN
TUSSOCK_TEMPERATE = (
    (SAGITTARIUS_CARINA_CORE - regions("Inner Scutum-Centaurus Arm"))
    | PERSEUS_CORE
    | ORION_CYGNUS_CORE
)
BRAIN_TREE_REGIONS = regions(
    "Empyrean Straits",
    "Inner Orion Spur",
    "Inner Scutum-Centaurus Arm",
    "Norma Expanse",
    "Outer Orion Spur",
    "Temple",
)
TUBER_REGIONS = regions(
    "Arcadian Stream",
    "Empyrean Straits",
    "Galactic Centre",
    "Hawking's Gap",
    "Inner Orion Spur",
    "Inner Orion-Perseus Conflux",
    "Inner Scutum-Centaurus Arm",
    "Izanami",
    "Norma Arm",
    "Norma Expanse",
    "Odin's Hold",
    "Ryker's Hope",
    "Trojan Belt",
)
ANEMONE_REGIONS = regions(
    "Inner Orion Spur",
    "Inner Orion-Perseus Conflux",
    "Izanami",
    "Newton's Vault",
    "Orion-Cygnus Arm",
    "Outer Arm",
    "Outer Orion-Perseus Conflux",
    "Perseus Arm",
    "Temple",
    "The Conduit",
    "Vulcan Gate",
)
SHARD_REGIONS = regions(
    "Acheron",
    "Achilles's Altar",
    "Aquila's Halo",
    "Errant Marches",
    "Formorian Frontier",
    "Hieronymus Delta",
    "Kepler's Crest",
    "Lyra's Song",
    "Mare Somnia",
    "Outer Arm",
    "Outer Scutum-Centaurus Arm",
    "Sagittarius-Carina Arm",
    "Sanguineous Rim",
    "Tenebrae",
    "The Abyss",
    "The Conduit",
    "The Formidine Rift",
    "The Void",
    "Xibalba",
)
AMPHORA_REGIONS = regions(
    "Dryman's Point", "Hawking's Gap", "Mare Somnia", "Norma Expanse", "Sagittarius-Carina Arm"
)

# --- the table ---------------------------------------------------------------------------

RULES: dict[str, SpeciesRule] = {
    # ---------------- Aleoida: rocky/HMC, thin CO2 or NH3, <= 0.276 g, no volcanism
    "Aleoids_01": rule(  # Arcus
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(175, 180), p=(0.016, None), volc=NO_VOLC),
        parent_stars=ALEOIDA_STARS,
    ),
    "Aleoids_02": rule(  # Coronamus
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(180, 190), p=(0.025, None), volc=NO_VOLC),
        parent_stars=ALEOIDA_STARS,
    ),
    "Aleoids_03": rule(  # Spica
        c(NH3, (R, HMC), g=(0.04, G_LOW), t=(165, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=ALEOIDA_STARS,
        regions=SPICA_REGIONS,
    ),
    "Aleoids_04": rule(  # Laminiae
        c(NH3, (R, HMC), g=(0.04, G_LOW), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=ALEOIDA_STARS,
        regions=ORION_CYGNUS | SAGITTARIUS_CARINA,
    ),
    "Aleoids_05": rule(  # Gravis
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(190, 197), p=(0.054, None), volc=NO_VOLC),
        parent_stars=ALEOIDA_STARS,
    ),
    # ---------------- Bacterium: the atmosphere type mostly decides the species
    "Bacterial_01": rule(  # Aurasus
        c(CO2, (R, HMC, RI), g=(0.038, G_HIGH), t=(130, 405)),
    ),
    "Bacterial_02": rule(  # Nebulus
        c(HE, I, g=(0.39, 0.55), t=(20, 21), p=(0.064, None)),
        c(HE, RI, g=(0.39, 0.7), t=(20, 21), p=(0.064, None)),
    ),
    "Bacterial_03": rule(  # Scopulum: needs CO2 geysers or methane magma
        c((NE, NER), (I, RI), g=(0.025, G_HIGH), t=(20, 65), volc=CARBON_VOLC),
        c(CH4, I, g=(0.025, 0.05), t=(84, 110), p=(0.03, None), volc=("methane",)),
        c(AR, (I, RI), g=(0.15, 0.26), t=(56, 150), volc=CARBON_VOLC),
        c(HE, I, g=(0.45, 0.55), t=(20, 21), volc=("methane",)),
        c(N2, (I, RI), g=(0.2, 0.3), t=(60, 70), volc=CARBON_VOLC),
        c(O2, (I, RI), g=(0.27, 0.4), t=(150, 220), p=(0.01, None), volc=CARBON_VOLC),
    ),
    "Bacterial_04": rule(  # Acies
        c(NE, (I, RI), g=(0.255, G_HIGH), t=(20, 70)),
    ),
    "Bacterial_05": rule(  # Vesicula
        c(AR, SOLID, g=(0.026, 0.51), t=(45, 250)),
    ),
    "Bacterial_06": rule(  # Alcyoneum
        c(NH3, (R, HMC, RI), g=(0.038, 0.38), t=(150, 178), p=(None, 0.0145)),
    ),
    "Bacterial_07": rule(  # Tela: the generalist; mostly needs volcanism unless hot
        c(SO2, SOLID, g=(0.18, G_HIGH), t=(148, 550), volc=ANY_VOLC),
        c(SO2, SOLID, g=(0.18, G_HIGH), t=(300, 550), volc=NO_VOLC),
        c(SO2, (R, HMC), g=(0.5, 0.56), t=(500, 650)),
        c(H2O, (R, HMC), g=(0.038, 0.065), volc=NO_VOLC),
        c(CO2, SOLID, g=(0.45, G_HIGH), t=(300, None), p=(0.006, None), volc=NO_VOLC),
        c((CO2, CO2R), SOLID, g=(0.025, G_HIGH), t=(167, None), p=(0.006, None), volc=ANY_VOLC),
        c((NE, NER), (I, RI), g=(0.27, G_HIGH), t=(20, 95), volc=ANY_VOLC),
        c(AR, (I, RI, HMC), g=(0.045, 0.45), t=(50, None), volc=ANY_VOLC),
        c(ARR, SOLID, g=(0.24, 0.45), t=(50, 150), p=(None, 0.05), volc=ANY_VOLC),
        c(NH3, SOLID, g=(0.025, 0.23), t=(165, 177), volc=ANY_VOLC),
        c(CH4, (I, R, HMC), g=(0.026, 0.126), t=(80, 109), volc=ANY_VOLC),
        c(HE, I, g=(0.025, G_HIGH), t=(20, 21), volc=ANY_VOLC),
        c(N2, SOLID, g=(0.21, 0.35), t=(55, 80), volc=ANY_VOLC),
        c(O2, SOLID, g=(0.23, 0.5), t=(150, 240), volc=ANY_VOLC),
        c(H2OR, (I, RI), g=(0.31, 0.45), t=(190, 330), volc=ANY_VOLC),
    ),
    "Bacterial_08": rule(  # Informem
        c(N2, (I, HMC, RI, R), g=(0.038, G_HIGH), t=(42, 152), volc=NO_VOLC),
    ),
    "Bacterial_09": rule(  # Volu
        c(O2, SOLID, g=(0.23, G_HIGH), t=(143, 246), p=(0.012, None), volc=NO_VOLC_SOFT),
    ),
    "Bacterial_10": rule(  # Bullaris
        c(CH4, SOLID, g=(0.024, G_HIGH), t=(64, 114)),
        c(CH4R, (R, HMC), g=(0.44, 0.6), t=(74, 141), volc=NO_VOLC),
    ),
    "Bacterial_11": rule(  # Omentum: needs nitrogen or ammonia magma, icy bodies
        c((NE, NER), I, g=(0.026, G_HIGH), t=(20, 93), volc=NITROGEN_VOLC),
        c(AR, I, g=(0.026, 0.45), t=(50, 150), volc=NITROGEN_VOLC),
        c(ARR, I, g=(0.23, 0.45), t=(80, 90), volc=NITROGEN_VOLC),
        c(CH4, I, g=(0.026, 0.046), t=(84, 108), volc=NITROGEN_VOLC),
        c(HE, I, g=(0.4, 0.51), t=(20, 21), volc=NITROGEN_VOLC),
        c(N2, I, g=(0.2, 0.26), t=(60, 80), volc=NITROGEN_VOLC),
        c(H2OR, I, g=(0.38, 0.45), t=(190, 330), volc=NITROGEN_VOLC),
    ),
    "Bacterial_12": rule(  # Cerbrus
        c(SO2, (R, HMC, RI), g=(0.038, G_HIGH), t=(130, 515)),
        c(H2O, (R, HMC), g=(0.038, 0.065), volc=NONE_OR_WATER),
        c(H2OR, RI, g=(0.4, 0.5), t=(190, 330), volc=NO_VOLC),
    ),
    "Bacterial_13": rule(  # Verrata: needs water volcanism
        c((NE, NER), (I, RI), g=(0.29, G_HIGH), t=(20, 65), volc=WATER_VOLC),
        c(AR, (I, RI), g=(0.165, 0.33), t=(57, 145), volc=WATER_VOLC),
        c(ARR, I, g=(0.04, 0.08), t=(80, 90), volc=WATER_VOLC),
        c(HE, I, g=(0.49, 0.53), t=(20, 21), volc=WATER_VOLC),
        c(NH3, (R, RI, I), g=(0.03, 0.09), t=(160, 180), volc=WATER_VOLC),
        c(O2, (I, RI), g=(0.24, 0.35), t=(154, 220), volc=WATER_VOLC),
        c(N2, I, g=(0.2, 0.25), t=(60, 80), volc=WATER_VOLC),
        c(H2O, R, g=(0.038, 0.055), volc=WATER_VOLC),
        c((CO2, CO2R), (I, RI), g=(0.25, 0.32), t=(167, 240), volc=WATER_VOLC),
    ),
    # ---------------- Cactoida: rocky/HMC, <= 0.276 g, regional by galactic arm
    "Cactoid_01": rule(  # Cortexum
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(180, 197), p=(0.025, None), volc=NO_VOLC),
        parent_stars=CACTOIDA_STARS,
        rare_parent_stars=CACTOIDA_RARE,
        regions=ORION_CYGNUS | regions("Inner Scutum-Centaurus Arm"),
    ),
    "Cactoid_02": rule(  # Lapis
        c(NH3, (R, HMC), g=(0.04, G_LOW), t=(160, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=CACTOIDA_STARS,
        rare_parent_stars=CACTOIDA_RARE,
        regions=SAGITTARIUS_CARINA,
    ),
    "Cactoid_03": rule(  # Vermis
        c(H2O, (R, HMC), g=(0.038, G_LOW), t=(160, 450), volc=NONE_OR_WATER),
        c(SO2, R, g=(0.26, G_LOW), t=(160, 210), p=(None, 0.005), volc=NO_VOLC),
        parent_stars=CACTOIDA_STARS,
        rare_parent_stars=CACTOIDA_RARE,
    ),
    "Cactoid_04": rule(  # Pullulanta
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(180, 197), p=(0.024, None), volc=NO_VOLC),
        parent_stars=CACTOIDA_STARS,
        rare_parent_stars=CACTOIDA_RARE,
        regions=PERSEUS,
    ),
    "Cactoid_05": rule(  # Peperatis
        c(NH3, (R, HMC), g=(0.04, G_LOW), t=(160, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=CACTOIDA_STARS,
        rare_parent_stars=CACTOIDA_RARE,
        regions=SCUTUM_CENTAURUS,
    ),
    # ---------------- Clypeus: warm CO2 (>= 190 K) or water atmospheres, <= 0.276 g
    "Clypeus_01": rule(  # Lacrimam (rocky)
        c(CO2, R, g=(0.038, G_LOW), t=(190, None), p=(0.05, None), volc=NO_VOLC),
        c(H2O, R, g=(0.038, G_LOW), volc=NONE_OR_WATER),
        parent_stars=CLYPEUS_STARS,
        rare_parent_stars=CLYPEUS_RARE,
    ),
    "Clypeus_02": rule(  # Margaritus (HMC)
        c(CO2, HMC, g=(0.04, G_LOW), t=(190, 197), p=(0.05, None), volc=NO_VOLC),
        c(H2O, HMC, g=(0.04, G_LOW), volc=NO_VOLC),
        parent_stars=CLYPEUS_STARS,
        rare_parent_stars=CLYPEUS_RARE,
    ),
    "Clypeus_03": rule(  # Speculumi (rocky, > 2000 ls from the arrival star)
        c(CO2, R, g=(0.038, G_LOW), t=(190, 197), p=(0.054, None), volc=NO_VOLC, dist=2000),
        c(H2O, R, g=(0.038, G_LOW), volc=NONE_OR_WATER, dist=2000),
        parent_stars=SPECULUMI_STARS,
    ),
    # ---------------- Concha
    "Conchas_01": rule(  # Renibus
        c(CO2, (R, HMC), g=(0.038, G_LOW), t=(180, None), p=(0.025, None), volc=NO_VOLC),
        c(H2O, (R, HMC), g=(0.038, G_LOW), volc=NONE_OR_WATER),
        c(
            CH4,
            (R, HMC),
            g=(0.038, 0.15),
            t=(77, 100),
            p=(0.01, None),
            volc=("silicate", "metallic"),
        ),
        c(NH3, (R, HMC), g=(0.038, 0.05), t=(175, 177), volc=("silicate", "metallic")),
    ),
    "Conchas_02": rule(  # Aureolas
        c(NH3, (R, HMC), g=(0.038, G_LOW), t=(152, 178), p=(None, 0.0145)),
        parent_stars=CONCHA_STARS,
        rare_parent_stars=CONCHA_RARE,
    ),
    "Conchas_03": rule(  # Labiata
        c(CO2, (R, HMC), g=(0.038, G_LOW), t=(148, 200), volc=NO_VOLC),
        parent_stars=CONCHA_STARS,
        rare_parent_stars=CONCHA_RARE,
    ),
    "Conchas_04": rule(  # Biconcavis
        c(N2, (R, HMC), g=(0.052, G_LOW), t=(42, 53), p=(None, 0.0095), volc=NO_VOLC),
    ),
    # ---------------- Electricae: icy bodies, argon/neon atmospheres
    "Electricae_01": rule(  # Pluma: system main star A / neutron / white dwarf / Ae
        c((AR, ARR), I, g=(0.025, G_LOW), t=(50, 150)),
        c((NE, NER), I, g=(0.025, G_LOW), t=(20, 70)),
        primary_stars=PLUMA_PRIMARY,
    ),
    "Electricae_02": rule(  # Radialem: within a nebula (not checkable from the journal)
        c((AR, ARR), I, g=(0.025, G_LOW), t=(40, 150)),
        c((NE, NER), I, g=(0.025, G_LOW), t=(20, 70)),
        unverifiable="nebula",
    ),
    # ---------------- Fonticulua: icy bodies
    "Fonticulus_01": rule(  # Segmentatus
        c((NE, NER), I, g=(0.25, G_LOW), t=(50, 75), volc=NO_VOLC_SOFT),
    ),
    "Fonticulus_02": rule(  # Campestris
        c(AR, (I, RI), g=(0.026, G_LOW), t=(45, 152)),
    ),
    "Fonticulus_03": rule(  # Upupam
        c(ARR, (I, RI), g=(0.2, G_LOW), t=(60, 125), p=(0.016, None), volc=NO_VOLC_SOFT),
    ),
    "Fonticulus_04": rule(  # Lapida
        c(N2, (I, RI), g=(0.18, 0.281), t=(50, 83), volc=NO_VOLC_SOFT),
    ),
    "Fonticulus_05": rule(  # Fluctus
        c(O2, I, g=(0.23, G_LOW), t=(143, 200), p=(0.012, None)),
    ),
    "Fonticulus_06": rule(  # Digitos
        c(CH4, (I, RI), g=(0.025, 0.07), t=(83, 109), p=(0.027, None)),
    ),
    # ---------------- Fumerola: the volcanism type decides the species
    "Fumerolas_01": rule(  # Carbosis: CO2 geysers / methane magma
        c(CH4, (I, RI), g=(0.025, 0.05), t=(84, 110), volc=("methane",)),
        c(AR, (I, RI), g=(0.16, G_LOW), t=(57, 150), volc=CARBON_VOLC),
        c(SO2, (I, RI), g=(0.18, G_LOW), t=(149, 275), volc=CARBON_VOLC),
        c(N2, (I, RI), g=(0.2, G_LOW), t=(57, 70), volc=CARBON_VOLC),
        c(NE, (I, RI), g=(0.25, G_LOW), t=(39, 60), volc=CARBON_VOLC),
        c(O2, (I, RI), g=(0.25, G_LOW), t=(160, 180), volc=("carbon dioxide",)),
        c((NH3, ARR, CO2R), (I, RI), g=(None, G_LOW), volc=("carbon dioxide",)),
    ),
    "Fumerolas_02": rule(  # Extremus: silicate geysers / metallic or rocky magma
        c(CH4, (R, RI, HMC), g=(0.025, 0.13), t=(77, 109), p=(0.01, None), volc=HOT_VOLC),
        c(NH3, (R, RI, HMC), g=(0.036, 0.09), t=(160, 177), volc=HOT_VOLC),
        c(SO2, (R, RI, HMC), g=(0.036, G_LOW), t=(54, 212), volc=HOT_VOLC),
        c(AR, (R, RI, HMC), g=(0.06, G_LOW), t=(50, 121), volc=HOT_VOLC),
        c(CO2, HMC, g=(0.05, G_LOW), t=(500, None), volc=HOT_VOLC),
    ),
    "Fumerolas_03": rule(  # Nitris: nitrogen / ammonia magma
        c(NE, I, g=(0.026, G_LOW), t=(30, 129), volc=NITROGEN_VOLC),
        c((AR, ARR, NER), I, g=(0.026, G_LOW), t=(50, 141), volc=NITROGEN_VOLC),
        c(CH4, I, g=(0.025, 0.1), t=(83, 109), volc=NITROGEN_VOLC),
        c(N2, I, g=(0.2, G_LOW), t=(60, 81), volc=NITROGEN_VOLC),
        c(SO2, I, g=(0.2, G_LOW), t=(160, 250), volc=NITROGEN_VOLC),
        c(O2, I, g=(None, G_LOW), t=(150, None), volc=NITROGEN_VOLC),
    ),
    "Fumerolas_04": rule(  # Aquatis: water geysers / water magma
        c((AR, ARR), (I, RI), g=(0.16, G_LOW), t=(57, 150), volc=WATER_VOLC),
        c(SO2, (I, RI, R), g=(0.18, G_LOW), t=(150, 270), volc=WATER_VOLC),
        c(NH3, (I, RI, R), g=(0.028, G_LOW), t=(160, 177), volc=WATER_VOLC),
        c(N2, I, g=(0.19, 0.25), t=(56, 80), volc=WATER_VOLC),
        c(H2O, R, g=(0.038, 0.065), volc=WATER_VOLC),
        c(O2, I, g=(0.23, G_LOW), t=(153, 190), volc=WATER_VOLC),
        c(CH4, (R, I), g=(0.025, G_LOW), t=(80, 100), volc=WATER_VOLC),
        c(NE, I, g=(0.25, G_LOW), t=(20, 60), volc=WATER_VOLC),
        c(CO2, I, g=(0.25, G_LOW), t=(160, 180), volc=WATER_VOLC),
    ),
    # ---------------- Fungoida
    "Fungoids_01": rule(  # Setisis
        c(NH3, (R, HMC, RI), g=(0.033, G_LOW), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        c(CH4, (R, HMC, RI), g=(0.033, G_LOW), t=(67, 109), volc=NO_VOLC_SOFT),
    ),
    "Fungoids_02": rule(  # Stabitis
        c(CO2, (R, HMC), g=(0.039, G_LOW), t=(180, None), p=(0.025, None), volc=NO_VOLC),
        c(H2O, (R, HMC), g=(0.038, 0.065), volc=NO_VOLC),
        c(CH4, R, g=(0.04, 0.13), t=(78, 109), p=(0.012, None), volc=("major silicate",)),
        c(NH3, (R, RI), g=(0.04, 0.05), t=(172, 177), volc=("silicate",)),
        c(AR, RI, g=(0.2, 0.23), t=(60, 90), volc=("silicate", "rocky")),
        c(ARR, I, g=(0.3, 0.5), t=(60, 90)),
        regions=ORION_CYGNUS,
    ),
    "Fungoids_03": rule(  # Bullarum
        c(AR, (RI, R, HMC), g=(0.058, G_LOW), t=(50, 133), volc=NO_VOLC),
        c(N2, (RI, R, HMC), g=(0.15, G_LOW), t=(50, 70), volc=NO_VOLC),
    ),
    "Fungoids_04": rule(  # Gelata
        c(CO2, (R, HMC), g=(0.037, G_LOW), t=(180, None), p=(0.01, None), volc=NO_VOLC),
        c(H2O, (R, HMC), g=(0.037, 0.065), volc=NO_VOLC),
        c(
            CH4,
            (R, HMC),
            g=(0.044, 0.125),
            t=(80, 110),
            p=(0.01, None),
            volc=("major silicate", "major metallic"),
        ),
        c(
            (AR, NH3),
            (R, RI, HMC),
            g=(0.04, G_LOW),
            t=(160, 180),
            volc=("major silicate", "major rocky"),
        ),
        regions=ALL_REGIONS - ORION_CYGNUS_CORE,
    ),
    # ---------------- Osseus
    "Osseus_01": rule(  # Fractus
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(180, 190), p=(0.025, None), volc=NO_VOLC),
        parent_stars=OSSEUS_STARS,
        rare_parent_stars=OSSEUS_RARE,
        regions=ALL_REGIONS - PERSEUS,
    ),
    "Osseus_02": rule(  # Discus
        c(H2O, (R, HMC), g=(0.033, 0.1)),
        c(CH4, R, g=(0.033, 0.13), t=(80, 110), p=(0.012, None), volc=ANY_VOLC),
        c(NH3, (R, RI, HMC), g=(0.04, 0.09), t=(160, 177), volc=ANY_VOLC),
        c(AR, RI, g=(0.2, G_LOW), t=(65, 120), volc=ANY_VOLC),
        c(CO2, HMC, g=(0.026, G_LOW), t=(500, None), volc=ANY_VOLC),
    ),
    "Osseus_03": rule(  # Spiralis
        c(NH3, (R, HMC, RI), g=(0.038, G_LOW), t=(160, 177.5), p=(None, 0.0145), volc=NO_VOLC),
        parent_stars=OSSEUS_STARS,
        rare_parent_stars=OSSEUS_RARE,
    ),
    "Osseus_04": rule(  # Pumice
        c(AR, (RI, R, HMC), g=(0.032, G_LOW), t=(42, 135), volc=NONE_OR_WATER),
        c(CH4, (RI, R, HMC), g=(0.032, G_LOW), t=(67, 109)),
        c(N2, (RI, R, HMC), g=(0.032, G_LOW), t=(42, 71), volc=NO_VOLC),
        c(ARR, RI, g=(0.032, G_LOW), t=(60, 81), p=(0.03, None), volc=NO_VOLC),
    ),
    "Osseus_05": rule(  # Cornibus
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(180, 197), p=(0.025, None), volc=NO_VOLC),
        parent_stars=OSSEUS_STARS,
        rare_parent_stars=OSSEUS_RARE,
        regions=PERSEUS,
    ),
    "Osseus_06": rule(  # Pellebantus
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(191, 197), p=(0.057, None), volc=NO_VOLC),
        parent_stars=OSSEUS_STARS,
        rare_parent_stars=OSSEUS_RARE,
        regions=ALL_REGIONS - PERSEUS,
    ),
    # ---------------- Recepta: need SO2 in the atmosphere mix (>= ~1%)
    "Recepta_01": rule(  # Umbrux
        c(SO2, SOLID, g=(0.04, G_LOW), t=(132, 273), so2=1.0),
        c(CO2, SOLID, g=(0.04, G_LOW), t=(150, 200), so2=1.0),
        c(O2, I, g=(0.23, G_LOW), t=(154, 175), p=(0.01, None), volc=NONE_OR_WATER, so2=1.0),
    ),
    "Recepta_02": rule(  # Deltahedronix
        c(SO2, SOLID, g=(0.04, G_LOW), t=(132, 272), so2=1.0),
        c(CO2, SOLID, g=(0.04, G_LOW), t=(150, 195), volc=NONE_OR_WATER, so2=1.0),
    ),
    "Recepta_03": rule(  # Conditivus
        c(SO2, SOLID, g=(0.04, G_LOW), t=(132, 275), so2=1.0),
        c((CO2, CO2R), SOLID, g=(0.04, G_LOW), t=(150, 195), volc=NO_VOLC, so2=1.0),
        c(O2, I, g=(0.23, G_LOW), t=(154, 175), p=(0.01, None), volc=NONE_OR_WATER, so2=1.0),
    ),
    # ---------------- Frutexa (codex "Shrubs")
    "Shrubs_01": rule(  # Flabellum
        c(NH3, R, g=(0.038, G_LOW), t=(147, 178), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        regions=ALL_REGIONS - (SCUTUM_CENTAURUS - regions("Galactic Centre")),
    ),
    "Shrubs_02": rule(  # Acus
        c(CO2, R, g=(0.038, 0.242), t=(146, 197), volc=NO_VOLC),
        regions=ORION_CYGNUS,
    ),
    "Shrubs_03": rule(  # Metallicum
        c(NH3, HMC, g=(0.038, G_LOW), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC),
        c(CO2, HMC, g=(0.038, G_LOW), t=(146, 197), p=(0.002, None), volc=NO_VOLC),
        c(CH4, HMC, g=(0.05, 0.1), t=(100, 300)),
        c(H2O, HMC, g=(0.038, 0.07), t=(None, 400), volc=NO_VOLC),
        parent_stars=FRUTEXA_STARS,
        rare_parent_stars=FRUTEXA_RARE,
    ),
    "Shrubs_04": rule(  # Flammasis
        c(NH3, R, g=(0.038, G_LOW), t=(152, 179), p=(None, 0.016), volc=NO_VOLC_SOFT),
        regions=SCUTUM_CENTAURUS,
    ),
    "Shrubs_05": rule(  # Fera
        c(CO2, R, g=(0.038, 0.24), t=(146, 197), p=(0.0025, None), volc=NO_VOLC),
        regions=OUTER,
    ),
    "Shrubs_06": rule(  # Sponsae
        c(H2O, R, g=(0.038, 0.056), t=(390, 455), volc=NONE_OR_WATER),
        parent_stars=FRUTEXA_STARS,
        rare_parent_stars=FRUTEXA_RARE,
    ),
    "Shrubs_07": rule(  # Collum
        c(SO2, (R, HMC), g=(0.04, G_LOW), t=(132, 215), p=(None, 0.011)),
    ),
    # ---------------- Stratum: no star of class A/B/G/N (except Araneamus)
    "Stratum_01": rule(  # Excutitus
        c(CO2, R, g=(0.04, 0.48), t=(165, 190), p=(0.0035, None), volc=NO_VOLC_SOFT),
        c(SO2, R, g=(0.27, 0.4), t=(165, 190), volc=NO_VOLC_SOFT),
        parent_stars=STRATUM_STARS,
        regions=ORION_CYGNUS,
    ),
    "Stratum_02": rule(  # Paleas
        c(CO2, R, g=(0.038, 0.59), t=(160, 450), volc=NO_VOLC_SOFT),
        c(NH3, R, g=(0.038, 0.35), t=(160, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        c(H2O, R, g=(0.038, 0.056), volc=NO_VOLC_SOFT),
        c(O2, R, g=(0.39, 0.6), t=(165, 250), p=(0.022, None), volc=NO_VOLC_SOFT),
        c(CO2R, R, g=(0.43, 0.59), t=(185, 260), p=(0.015, None), volc=NO_VOLC_SOFT),
        parent_stars=STRATUM_STARS,
    ),
    "Stratum_03": rule(  # Laminamus
        c(NH3, R, g=(0.038, 0.35), t=(160, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=STRATUM_STARS,
        regions=ORION_CYGNUS,
    ),
    "Stratum_04": rule(  # Araneamus (single colour variant; no star constraint)
        c(SO2, R, g=(0.26, 0.57), t=(165, 373)),
    ),
    "Stratum_05": rule(  # Limaxus
        c(CO2, R, g=(0.03, 0.4), t=(165, 190), volc=NO_VOLC_SOFT),
        c(SO2, R, g=(0.27, 0.4), t=(165, 190), volc=NO_VOLC_SOFT),
        parent_stars=STRATUM_STARS,
        regions=SCUTUM_CENTAURUS_CORE,
    ),
    "Stratum_06": rule(  # Cucumisis
        c(CO2, R, g=(0.04, 0.6), t=(190, 372), volc=NO_VOLC),
        c(SO2, R, g=(0.26, 0.59), t=(190, 373)),
        c(CO2R, R, g=(0.44, 0.56), t=(210, 246), p=(0.01, None), volc=NO_VOLC),
        c(O2, R, g=(0.4, 0.6), t=(200, 250), p=(0.01, None)),
        parent_stars=STRATUM_STARS,
        regions=SAGITTARIUS_CARINA,
    ),
    "Stratum_07": rule(  # Tectonicas (HMC only)
        c(CO2, HMC, g=(0.045, G_HIGH), t=(160, 450), volc=NO_VOLC_SOFT),
        c(SO2, HMC, g=(0.29, G_HIGH), t=(160, 450), volc=NO_VOLC_SOFT),
        c(NH3, HMC, g=(0.045, 0.38), t=(160, 177), volc=NO_VOLC_SOFT),
        c(CO2R, HMC, g=(0.035, G_HIGH), t=(160, 260), volc=NO_VOLC_SOFT),
        c(O2, HMC, g=(0.4, 0.52), t=(160, 246), volc=NO_VOLC_SOFT),
        c(H2O, HMC, g=(0.045, 0.065), volc=NO_VOLC_SOFT),
        c((AR, ARR), HMC, g=(0.48, 0.54), t=(167, 199), volc=NO_VOLC_SOFT),
        parent_stars=STRATUM_STARS,
    ),
    "Stratum_08": rule(  # Frigus
        c(CO2, R, g=(0.043, 0.56), t=(190, 372), volc=NO_VOLC),
        c(SO2, R, g=(0.29, 0.56), t=(190, 372)),
        c(CO2R, R, g=(0.45, 0.56), t=(200, 250), p=(0.01, None), volc=NO_VOLC),
        # 0.3% of Canonn samples (9) are on thin-oxygen bodies; bounds mirror the
        # sister species Cucumisis (same 190+ K niche, Sagittarius-Carina instead).
        c(O2, R, g=(0.4, 0.6), t=(190, 250), p=(0.01, None)),
        parent_stars=STRATUM_STARS,
        regions=PERSEUS_CORE,
    ),
    # ---------------- Tubus: rocky/HMC, <= 0.153 g
    "Tubus_01": rule(  # Conifer
        c(CO2, R, g=(0.04, 0.153), t=(160, 197), p=(0.003, None), volc=NO_VOLC),
        parent_stars=TUBUS_STARS,
        regions=PERSEUS,
    ),
    "Tubus_02": rule(  # Sororibus
        c(CO2, HMC, g=(0.045, 0.153), t=(160, 196), volc=NO_VOLC),
        c(NH3, HMC, g=(0.045, 0.153), t=(160, 177), p=(None, 0.0145), volc=NO_VOLC),
        parent_stars=TUBUS_STARS,
    ),
    "Tubus_03": rule(  # Cavas
        c(CO2, R, g=(0.04, 0.153), t=(160, 197), p=(0.003, None), volc=NO_VOLC),
        parent_stars=TUBUS_STARS,
        regions=SCUTUM_CENTAURUS,
    ),
    "Tubus_04": rule(  # Rosarium
        c(NH3, R, g=(0.038, 0.164), t=(160, 177), p=(None, 0.0145)),
    ),
    "Tubus_05": rule(  # Compagibus
        c(CO2, R, g=(0.04, 0.16), t=(155, 198), p=(0.001, None), volc=NO_VOLC),
        parent_stars=TUBUS_STARS,
        regions=SAGITTARIUS_CARINA,
    ),
    # ---------------- Tussock: CO2 species form a temperature ladder 145..197 K
    "Tussocks_01": rule(  # Pennata
        c(CO2, (R, HMC), g=(0.038, 0.09), t=(145, 155), p=(0.0028, 0.0115), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_02": rule(  # Ventusa
        c(CO2, (R, HMC), g=(0.038, 0.13), t=(154, 161), p=(0.0018, 0.025), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_03": rule(  # Ignis
        c(CO2, (R, HMC), g=(0.038, 0.2), t=(160, 171), p=(0.0011, 0.053), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_04": rule(  # Cultro
        c(NH3, (R, HMC), g=(0.038, 0.28), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=ORION_CYGNUS,
    ),
    "Tussocks_05": rule(  # Catena
        c(NH3, (R, HMC), g=(0.038, G_LOW), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC_SOFT),
        parent_stars=TUSSOCK_STARS,
        regions=SCUTUM_CENTAURUS_CORE,
    ),
    "Tussocks_06": rule(  # Pennatis
        c(CO2, (R, HMC), g=(0.038, G_LOW), t=(146, 197), p=(0.0027, None), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=OUTER | regions("Inner Orion Spur"),
    ),
    "Tussocks_07": rule(  # Serrati
        c(CO2, (R, HMC), g=(0.042, 0.23), t=(170, 175), p=(0.006, 0.071), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_08": rule(  # Albata
        c(CO2, (R, HMC), g=(0.041, G_LOW), t=(174, 180.5), p=(0.016, None), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_09": rule(  # Propagito
        c(CO2, (R, HMC), g=(0.038, G_LOW), t=(145, 198), p=(0.0029, None), volc=NO_VOLC),
        regions=SCUTUM_CENTAURUS,
    ),
    "Tussocks_10": rule(  # Divisa
        c(NH3, (R, HMC), g=(0.04, G_LOW), t=(152, 177), p=(None, 0.0145), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=PERSEUS_CORE,
    ),
    "Tussocks_11": rule(  # Caputus
        c(CO2, (R, HMC), g=(0.041, G_LOW), t=(180, 190.5), p=(0.0245, None), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_12": rule(  # Triticum
        c(CO2, (R, HMC), g=(0.04, G_LOW), t=(190.5, 197), p=(0.057, None), volc=NO_VOLC),
        parent_stars=TUSSOCK_STARS,
        regions=TUSSOCK_TEMPERATE,
    ),
    "Tussocks_13": rule(  # Stigmasis
        c(SO2, (R, HMC), g=(0.04, G_LOW), t=(132, 180), p=(None, 0.017)),
        parent_stars=TUSSOCK_STARS,
    ),
    "Tussocks_14": rule(  # Virgam
        c(H2O, (R, HMC), g=(0.038, 0.065), t=(390, 450), volc=NONE_OR_WATER),
    ),
    "Tussocks_15": rule(  # Capillum
        c(AR, RI, g=(0.22, G_LOW), t=(80, 129)),
        c(CH4, (R, RI), g=(0.032, G_LOW), t=(80, 110)),
        parent_stars=TUSSOCK_STARS,
    ),
    # ---------------- Radicoida: only in HIP 87621
    "Ingensradices_Unicus": rule(
        c((CO2, SO2), (R, HMC), t=(400, 750)),
        systems=frozenset({"hip 87621"}),
    ),
    # ---------------- Legacy organisms (predicted only once DSS confirms the genus)
    "Vents": rule(  # Amphora Plant
        c(None, MR, t=(950, 1770), volc=HOT_VOLC),
        regions=AMPHORA_REGIONS,
        legacy=True,
    ),
    "Sphere": rule(  # Luteolum Anemone
        c(None, R, t=(200, 500), volc=HOT_VOLC),
        regions=ANEMONE_REGIONS,
        legacy=True,
    ),
    "SphereABCD_01": rule(  # Croceum Anemone
        c(None, R, t=(200, 440), volc=HOT_VOLC),
        regions=ANEMONE_REGIONS,
        legacy=True,
    ),
    "SphereABCD_02": rule(  # Puniceum Anemone
        c(None, I),
        regions=ANEMONE_REGIONS,
        legacy=True,
    ),
    "SphereABCD_03": rule(  # Roseum Anemone
        c(None, R, t=(200, 440), volc=HOT_VOLC),
        regions=ANEMONE_REGIONS,
        legacy=True,
    ),
    "SphereEFGH": rule(  # Blatteum Bioluminescent Anemone
        c(None, (HMC, MR), volc=HOT_VOLC),
        regions=ANEMONE_REGIONS,
        legacy=True,
    ),
    "SphereEFGH_01": rule(  # Rubeum Bioluminescent Anemone
        c(None, (HMC, MR), volc=HOT_VOLC),
        legacy=True,
    ),
    "SphereEFGH_02": rule(  # Prasinum Bioluminescent Anemone
        c(None, (MR, R, HMC)),
        legacy=True,
    ),
    "SphereEFGH_03": rule(  # Roseum Bioluminescent Anemone
        c(None, (HMC, MR), volc=HOT_VOLC),
        legacy=True,
    ),
    "Cone": rule(  # Bark Mounds: volcanic bodies near a nebula centre
        c(None, (R, HMC, I, RI), volc=ANY_VOLC),
        unverifiable="nebula",
        legacy=True,
    ),
    "Seed": rule(  # Roseum Brain Tree
        c(None, (R, HMC, I, RI), t=(115, None), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedABCD_01": rule(  # Gypseeum Brain Tree
        c(None, R, g=(None, 0.42), t=(170, 330), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedABCD_02": rule(  # Ostrinum Brain Tree
        c(None, (HMC, MR), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedABCD_03": rule(  # Viride Brain Tree
        c(None, RI, g=(None, 0.4), t=(100, 255), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedEFGH": rule(  # Lividum Brain Tree
        c(None, R, g=(None, 0.47), t=(230, None), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedEFGH_01": rule(  # Aureum Brain Tree
        c(None, (HMC, R), t=(300, None), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedEFGH_02": rule(  # Puniceum Brain Tree
        c(None, (HMC, MR), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "SeedEFGH_03": rule(  # Lindigoticum Brain Tree
        c(None, (HMC, R), t=(300, 500), volc=ANY_VOLC),
        regions=BRAIN_TREE_REGIONS,
        legacy=True,
    ),
    "Ground_Struct_Ice": rule(  # Crystalline Shards: cold bodies, minor volcanism
        c(None, (I, R, HMC, RI), t=(None, 273), volc=("minor",)),
        regions=SHARD_REGIONS,
        legacy=True,
    ),
    **{
        code: rule(  # Sinuous Tubers: major rocky magma / silicate vapour geysers
            c(None, (R, HMC), t=(200, 500), volc=HOT_VOLC),
            regions=TUBER_REGIONS,
            legacy=True,
        )
        for code in (
            "Tube",
            "TubeABCD_01",
            "TubeABCD_02",
            "TubeABCD_03",
            "TubeEFGH",
            "TubeEFGH_01",
            "TubeEFGH_02",
            "TubeEFGH_03",
        )
    },
}

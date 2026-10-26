"""Builds the JSON views served to the frontend from the projection tables."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable, Iterable

from app import bookmarks, enrich, exobio, usersettings
from app.codex import CodexIndex, codex_index, colour_status, predicted_status
from app.exobio.odds import chances
from app.exobio.variants import colour_of, variants
from app.facts import body_id64, facts_from_json, load_community_system, load_system
from app.globe import globe_view
from app.models import BodyFacts, SystemFacts
from app.schemas import (
    ActiveScanView,
    BarycentreView,
    BodyView,
    BodyVisual,
    CommunityLookup,
    GlobeView,
    HighlightSettings,
    Interest,
    LiveStatus,
    OrbitView,
    ParentRef,
    RingView,
    RiskPoint,
    SamplePoint,
    SessionView,
    SignalsView,
    SpeciesView,
    SurfaceView,
    SystemRef,
    SystemTotals,
    SystemView,
)
from app.values import estimate_body_value

DEFAULT_COLONY_RANGE_M = 100

# As the game names the classes ("F (White) Star", "G (White-Yellow) Star", ...).
STAR_NAMES = {
    "O": "blue-white star",
    "B": "blue-white star",
    "A": "blue-white star",
    "F": "white star",
    "G": "white-yellow star",
    "K": "yellow-orange star",
    "M": "red dwarf",
    "L": "brown dwarf",
    "T": "brown dwarf",
    "Y": "brown dwarf",
    "TTS": "T Tauri star",
    "AeBe": "Herbig Ae/Be star",
    "N": "neutron star",
    "H": "black hole",
    "SupermassiveBlackHole": "supermassive black hole",
    "X": "exotic star",
    "MS": "MS-type star",
    "S": "S-type star",
}


def star_subtype(facts: BodyFacts) -> str:
    code = facts.star_type or "?"
    if code.startswith("D"):
        name = "white dwarf"
    elif code.startswith("W"):
        name = "Wolf-Rayet star"
    elif code.startswith("C"):
        name = "carbon star"
    else:
        name = STAR_NAMES.get(code, "star")
    if "Giant" in code:
        return code.replace("_", " ")
    designation = f"{code}{facts.star_subclass if facts.star_subclass is not None else ''}"
    if facts.luminosity:
        designation += f" {facts.luminosity}"
    return f"{designation} · {name}"


def short_name(name: str, system_name: str) -> str:
    prefix = f"{system_name} "
    return name[len(prefix) :] if name.startswith(prefix) else name


def cmdr_name(conn: sqlite3.Connection, fid: str | None) -> str | None:
    if not fid:
        return None
    row = conn.execute("SELECT name FROM commanders WHERE fid = ?", (fid,)).fetchone()
    return row["name"] if row else None


def cmdr_state(conn: sqlite3.Connection, fid: str | None) -> sqlite3.Row | None:
    if not fid:
        return None
    return conn.execute("SELECT * FROM cmdr_state WHERE fid = ?", (fid,)).fetchone()


def _bonus_multiplier(facts: BodyFacts, system: SystemFacts) -> int:
    """x5 where the bonus is likely (`exobio.bonus_likely`), else 1."""
    return exobio.FIRST_FOOTFALL_MULTIPLIER if exobio.bonus_likely(facts, system.populated) else 1


def _species_names(symbol: str, fallback_name: str | None) -> tuple[str, str, int, int]:
    """(genus name, species name, base value, colony range) for a species symbol."""
    species = exobio.get_species(symbol)
    if species is not None:
        return species.genus_name, species.species_name, species.base_value, species.colony_range_m
    name = fallback_name or symbol
    return name.split(" ", 1)[0], name, 0, DEFAULT_COLONY_RANGE_M


def _genus_name(symbol: str) -> str:
    info = exobio.get_genus(symbol)
    if info is not None:
        return info.genus_name
    # "$Codex_Ent_Stratum_Genus_Name;" -> "Stratum"
    return symbol.removeprefix("$Codex_Ent_").removesuffix("_Genus_Name;").replace("_", " ")


def _build_species(
    facts: BodyFacts,
    system: SystemFacts,
    genuses: set[str],
    scans: Iterable[sqlite3.Row],
    bio_signals: int,
    codex: CodexIndex,
) -> tuple[list[SpeciesView], int, int, int, int]:
    """Species list for a body, (min, max) estimated bio value incl. bonus, and how many
    certain / uncertain species would be new codex entries."""
    multiplier = _bonus_multiplier(facts, system)
    views: list[SpeciesView] = []
    seen_genera: set[str] = set()
    confirmed_values: list[int] = []

    # One entry per species: an analysed scan beats a later re-sampling of the same species.
    best: dict[str, sqlite3.Row] = {}
    for scan in scans:
        kept = best.get(scan["species"])
        if kept is None or kept["status"] != "analysed":
            best[scan["species"]] = scan

    for scan in best.values():
        genus_name, species_name, base, colony = _species_names(
            scan["species"], scan["species_name"]
        )
        value = scan["value"] if scan["value"] is not None else base
        catalog = exobio.get_species(scan["species"])
        symbol = catalog.species if catalog else scan["species"]
        seen_genera.add(catalog.genus if catalog else scan["genus"])
        ruled_out = multiplier > 1 and bool(scan["was_logged"])
        bonus_value = value if ruled_out else value * multiplier
        confirmed_values.append(bonus_value)
        views.append(
            SpeciesView(
                genus=genus_name,
                species=species_name,
                value=value,
                bonus_value=bonus_value,
                bonus_ruled_out=ruled_out,
                colony_range_m=colony,
                status="analysed" if scan["status"] == "analysed" else "sampling",
                samples=scan["samples"],
                certain=True,
                # The journal names the colour: that codex entry exactly.
                codex=colour_status(
                    codex,
                    scan["variant"],
                    symbol,
                    system.region,
                    before=scan["started_at"] if scan["status"] == "sampling" else None,
                ),
                colour=colour_of(scan["variant"]),
            )
        )

    # Genus -> (min, max) base value of species still possible on this body.
    ranges: dict[str, tuple[int, int]] = {}
    if bio_signals > 0 or genuses:
        predictions = exobio.predict(facts, system, genuses or None)
        ranges = exobio.genus_ranges(predictions, genuses, skip=seen_genera)
        # Before DSS: sure when the genera that can grow here fill every signal.
        deduced = set() if genuses else exobio.deduced_genera(predictions, bio_signals, seen_genera)
        # Several species left of one genus: only one of them grows here.
        candidates: dict[str, list[str]] = {}
        for p in predictions:
            if p.species.genus not in seen_genera:
                candidates.setdefault(p.species.genus, []).append(p.species.species)
        odds: dict[str, float] = {}
        for members in candidates.values():
            if len(members) > 1:
                odds.update(chances(members, facts) or {})
        for p in sorted(predictions, key=lambda p: -p.species.base_value):
            sp = p.species
            if sp.genus in seen_genera:
                continue
            found = variants(sp.species, facts, system)
            status, _ = predicted_status(codex, sp.species, found, system.region)
            colours = [v.colour for v in found or () if v.colour]
            views.append(
                SpeciesView(
                    genus=sp.genus_name,
                    species=sp.species_name,
                    value=sp.base_value,
                    bonus_value=sp.base_value * multiplier,
                    colony_range_m=sp.colony_range_m,
                    status="predicted",
                    samples=0,
                    certain=sp.genus in genuses or sp.genus in deduced,
                    deduced=sp.genus in deduced,
                    codex=status,
                    colour=" / ".join(colours) or None,
                    chance=odds.get(sp.species),
                )
            )

    remaining = max(max(bio_signals, len(genuses)) - len(seen_genera), 0)
    still_low, still_high = exobio.range_total(ranges, remaining)
    confirmed = sum(confirmed_values)
    order = {"sampling": 0, "analysed": 1, "predicted": 2}
    views.sort(key=lambda v: (order[v.status], not v.certain, -v.value))
    # Count genera, not candidate species: one bio signal is one genus on the body. A sure genus
    # is surely new only when none of its candidates is in the codex already.
    by_genus: dict[str, list[SpeciesView]] = {}
    for v in views:
        by_genus.setdefault(v.genus, []).append(v)
    certain_new = {
        g for g, vs in by_genus.items() if all(v.certain and v.codex != "logged" for v in vs)
    }
    maybe_new = {g for g, vs in by_genus.items() if any(v.codex != "logged" for v in vs)}
    maybe_new -= certain_new
    open_slots = max(max(bio_signals, len(genuses)) - len(certain_new), 0)
    codex_new = len(certain_new)
    codex_maybe = min(len(maybe_new), open_slots)
    low, high = confirmed + still_low * multiplier, confirmed + still_high * multiplier
    return views, low, high, codex_new, codex_maybe


def _body_view(
    conn: sqlite3.Connection,
    system: SystemFacts,
    facts: BodyFacts,
    fid: str | None,
    odyssey: bool,
    codex: CodexIndex | None = None,
    highlight: HighlightSettings | None = None,
) -> BodyView:
    key = (system.address, facts.body_id)
    signal_rows = conn.execute(
        "SELECT kind, count FROM body_signals WHERE system_address = ? AND body_id = ?", key
    ).fetchall()
    genuses = {
        r["genus"]
        for r in conn.execute(
            "SELECT genus FROM body_genuses WHERE system_address = ? AND body_id = ?", key
        )
    }
    counts = {r["kind"]: r["count"] for r in signal_rows}
    signals_source = "journal" if counts else None
    genuses_source = "journal" if genuses else None
    if not counts or not genuses:
        # Your own FSS/DSS results win; community data fills what the journal lacks.
        ext = conn.execute(
            "SELECT e.signals, e.genuses, s.source FROM ext_bodies e "
            "JOIN ext_systems s ON s.address = e.system_address "
            "WHERE e.system_address = ? AND e.body_id = ?",
            key,
        ).fetchone()
        if ext is not None:
            ext_counts, ext_genuses = json.loads(ext["signals"]), set(json.loads(ext["genuses"]))
            if not counts and ext_counts:
                counts, signals_source = ext_counts, ext["source"]
            if not genuses and ext_genuses:
                genuses, genuses_source = ext_genuses, ext["source"]
    signals = SignalsView(**counts)
    scans = conn.execute(
        "SELECT * FROM organic_scans WHERE system_address = ? AND body_id = ? AND fid = ? "
        "AND status IN ('sampling', 'analysed') ORDER BY id",
        (*key, fid),
    ).fetchall()
    cmdr_body = conn.execute(
        "SELECT mapped_at, efficient, footfall_at FROM body_cmdr "
        "WHERE fid = ? AND system_address = ? AND body_id = ?",
        (fid, *key),
    ).fetchone()
    mapped_by_me = bool(cmdr_body and cmdr_body["mapped_at"])
    # Once mapped, the efficiency bonus is a fact rather than an assumption.
    efficient = not mapped_by_me or bool(cmdr_body["efficient"])

    species, bio_min, bio_max, codex_new, codex_maybe = _build_species(
        facts, system, genuses, scans, signals.bio, codex if codex is not None else {}
    )
    value = estimate_body_value(facts, odyssey=odyssey, efficient=efficient)
    highlight = highlight or usersettings.DEFAULTS
    worth_mapping = facts.kind == "planet" and not mapped_by_me and value.dss >= highlight.dss_min
    parent_id = next((body_id for kind, body_id in facts.parents if kind != "Null"), None)
    best_carto = value.dss if facts.kind == "planet" else value.fss
    bio_done = sum(1 for sp in species if sp.status == "analysed")
    interest, reasons, done = _interest(
        facts, signals, bio_done, mapped_by_me, worth_mapping, value.dss, bio_max, highlight
    )

    source = facts.source if facts.source in ("spansh", "edsm") else "journal"
    return BodyView(
        id64=str(body_id64(system.address, facts.body_id)),
        body_id=facts.body_id,
        name=facts.name,
        short_name=short_name(facts.name, system.name),
        kind=facts.kind,
        source=source,
        source_at=facts.epoch,
        source_url=(
            f"https://spansh.co.uk/body/{body_id64(system.address, facts.body_id)}"
            if source == "spansh"
            else None
        ),
        signals_source=signals_source,
        genuses_source=genuses_source,
        subtype=star_subtype(facts) if facts.kind == "star" else (facts.planet_class or "?"),
        parent_id=parent_id,
        distance_ls=facts.distance_ls,
        landable=facts.landable,
        terraformable=facts.terraformable,
        atmosphere=facts.atmosphere or None,
        gravity_g=facts.gravity_g,
        temperature_k=facts.surface_temperature,
        radius_km=None if facts.radius_m is None else facts.radius_m / 1000,
        was_discovered=facts.was_discovered,
        was_mapped=facts.was_mapped,
        was_footfalled=facts.was_footfalled,
        mapped_by_me=mapped_by_me,
        footfall_by_me=bool(cmdr_body and cmdr_body["footfall_at"]),
        footfall_claimable=(
            facts.landable and facts.was_footfalled is False and not system.populated
        ),
        signals=signals,
        genuses=sorted(_genus_name(g) for g in genuses),
        species=species,
        fss_value=value.fss,
        dss_value=value.dss,
        worth_mapping=worth_mapping,
        bio_value_min=bio_min,
        bio_value_max=bio_max,
        total_value=best_carto + bio_max,
        bio_done=bio_done,
        codex_new=codex_new,
        codex_maybe=codex_maybe,
        interest=interest,
        reasons=reasons,
        done=done,
        parents=_parent_refs(facts.parents),
        orbit=_orbit(facts),
        visual=_visual(facts),
    )


HIGH_VALUE_CLASSES = {"Earthlike body": "elw", "Water world": "ww", "Ammonia world": "aw"}
# Reasons that make a body worth a label on its own. Geological signals do not: they are
# materials, worth nothing to exploration (still shown as a badge in the body details).
NOTABLE_REASONS = {"first_discovery", "landable_atmo"}
PARENT_KINDS = ("Star", "Planet", "Null", "Ring")


def _is_rare_star(star_type: str | None) -> bool:
    code = star_type or ""
    return (
        code in ("N", "H", "SupermassiveBlackHole", "O", "AeBe", "X")
        or code.startswith(("D", "W", "C"))
        or "Giant" in code
    )


def _interest(
    facts: BodyFacts,
    signals: SignalsView,
    bio_done: int,
    mapped_by_me: bool,
    worth_mapping: bool,
    dss_value: int,
    bio_max: int,
    highlight: HighlightSettings,
) -> tuple[Interest, list[str], bool]:
    """Map brightness, reason codes, and whether everything worth doing here is done.

    Only bodies above the user's thresholds count as tasks (bright on the map)."""
    reasons: list[str] = []
    tasks: list[bool] = []  # one entry per thing worth doing: True when done
    if signals.bio > 0:
        reasons.append("bio")
        if bio_max >= highlight.bio_min or bio_done > 0:
            tasks.append(bio_done >= signals.bio)
    if worth_mapping:
        reasons.append("map")
    special = HIGH_VALUE_CLASSES.get(facts.planet_class or "")
    if special:
        reasons.append(special)
    elif facts.terraformable and facts.terraform_state != "Terraformed":
        reasons.append("terraformable")
    if facts.kind == "planet" and (dss_value >= highlight.dss_min or mapped_by_me):
        tasks.append(mapped_by_me)
    rare_star = facts.kind == "star" and _is_rare_star(facts.star_type)
    if rare_star:
        reasons.append("rare_star")
    if facts.was_discovered is False:
        reasons.append("first_discovery")
    if facts.landable and facts.has_atmosphere:
        reasons.append("landable_atmo")
    if signals.geo > 0:
        reasons.append("geo")
    if signals.mining > 0:
        reasons.append("mining")
    if facts.has_rings:
        reasons.append("rings")

    done = bool(tasks) and all(tasks)
    if (tasks and not done) or rare_star:
        interest: Interest = "high"
    elif done or NOTABLE_REASONS & set(reasons) or facts.kind == "star":
        interest = "medium"
    else:
        interest = "low"
    return interest, reasons, done


def _parent_refs(parents: list[tuple[str, int]]) -> list[ParentRef]:
    return [ParentRef(kind=k, body_id=v) for k, v in parents if k in PARENT_KINDS]


def _orbit_from(values: dict[str, object] | BodyFacts) -> OrbitView | None:
    get = values.get if isinstance(values, dict) else lambda k: getattr(values, k, None)
    if get("semi_major_axis_m") is None:
        return None
    return OrbitView(
        epoch=get("epoch"),
        semi_major_axis_m=get("semi_major_axis_m"),
        eccentricity=get("eccentricity"),
        inclination_deg=get("orbital_inclination"),
        periapsis_deg=get("periapsis"),
        ascending_node_deg=get("ascending_node"),
        mean_anomaly_deg=get("mean_anomaly"),
        period_s=get("orbital_period_s"),
    )


def _orbit(facts: BodyFacts) -> OrbitView | None:
    return _orbit_from(facts)


def _visual(facts: BodyFacts) -> BodyVisual:
    return BodyVisual(
        planet_class=facts.planet_class,
        star_type=facts.star_type,
        star_subclass=facts.star_subclass,
        luminosity=facts.luminosity,
        atmosphere_type=facts.atmosphere_type,
        terraform_state=facts.terraform_state,
        volcanism=facts.volcanism,
        temperature_k=facts.surface_temperature,
        surface_pressure_atm=facts.pressure_atm,
        atmosphere_composition=facts.atmosphere_composition,
        mass_em=facts.mass_em,
        radius_m=facts.radius_m,
        stellar_mass=facts.stellar_mass,
        axial_tilt_rad=facts.axial_tilt,
        rotation_period_s=facts.rotation_period_s,
        tidal_lock=facts.tidal_lock,
        composition=facts.composition,
        rings=[
            RingView(
                name=r.get("name"),
                ring_class=r.get("ring_class"),
                inner_m=r.get("inner_m"),
                outer_m=r.get("outer_m"),
            )
            for r in facts.rings
        ],
    )


def _barycentres(conn: sqlite3.Connection, system: SystemFacts) -> list[BarycentreView]:
    """Barycentres from ScanBaryCentre plus any referenced in body parent chains."""
    chains: dict[int, list[tuple[str, int]]] = {}
    for facts in system.bodies.values():
        for i, (kind, body_id) in enumerate(facts.parents):
            if kind == "Null" and body_id not in chains:
                chains[body_id] = facts.parents[i + 1 :]
    orbits = {
        r["body_id"]: json.loads(r["orbit"])
        for r in conn.execute(
            "SELECT body_id, orbit FROM ext_barycentres WHERE system_address = ?",
            (system.address,),
        )
    }
    orbits.update(
        (r["body_id"], json.loads(r["orbit"]))
        for r in conn.execute(
            "SELECT body_id, orbit FROM barycentres WHERE system_address = ?", (system.address,)
        )
    )
    return [
        BarycentreView(
            body_id=body_id,
            parents=_parent_refs(chains.get(body_id, [])),
            orbit=_orbit_from(orbits[body_id]) if body_id in orbits else None,
        )
        for body_id in sorted(chains.keys() | orbits.keys())
    ]


def _system_ref(conn: sqlite3.Connection, address: int | None) -> SystemRef | None:
    if address is None:
        return None
    row = conn.execute("SELECT name FROM systems WHERE address = ?", (address,)).fetchone()
    return SystemRef(address=str(address), name=row["name"]) if row else None


def _neighbour(
    conn: sqlite3.Connection, fid: str | None, last_visit_id: int, *, before: bool
) -> SystemRef | None:
    """The system visited last just before (or after) the given visit, by last visit."""
    row = conn.execute(
        "WITH last AS (SELECT system_address, MAX(id) AS id FROM visits WHERE fid = ? "
        "GROUP BY system_address) "
        "SELECT s.address, s.name FROM last l JOIN systems s ON s.address = l.system_address "
        f"WHERE l.id {'<' if before else '>'} ? ORDER BY l.id {'DESC' if before else 'ASC'} "
        "LIMIT 1",
        (fid, last_visit_id),
    ).fetchone()
    return SystemRef(address=str(row["address"]), name=row["name"]) if row else None


def _empty_system(current: SystemRef | None = None) -> SystemView:
    return SystemView(
        address=None,
        name=None,
        star_pos=None,
        body_count=None,
        scanned_count=0,
        all_bodies_found=False,
        is_current=False,
        current_system=current,
        current_body_id=None,
        visits=0,
        first_visit_at=None,
        last_visit_at=None,
        prev_system=None,
        next_system=None,
        bodies=[],
        barycentres=[],
        totals=SystemTotals(fss=0, dss=0, bio_min=0, bio_max=0),
    )


def _lookup(conn: sqlite3.Connection, address: int, online: bool) -> CommunityLookup | None:
    """Where the community data of a system you have not been to stands (None: it is in)."""
    row = conn.execute("SELECT ok FROM ext_systems WHERE address = ?", (address,)).fetchone()
    if row is None or enrich.bodies_dropped(conn, address):  # dropped: asked again on opening
        return "pending" if online else "offline"
    return None if row["ok"] else "missing"


def system_view(
    conn: sqlite3.Connection, fid: str | None, address: int | None = None, *, online: bool = True
) -> SystemView:
    """The commander's current system, or any other system by address: one from the history,
    or one you have never been to (community data alone; `online`: Spansh/EDSM are asked)."""
    state = cmdr_state(conn, fid)
    current_address = state["system_address"] if state else None
    current = _system_ref(conn, current_address)
    if address is None:
        address = current_address
    if address is None:
        return _empty_system(current)
    system = load_system(conn, address)
    lookup: CommunityLookup | None = None
    if system is None:
        if address == current_address:
            return _empty_system(current)
        lookup = _lookup(conn, address, online)
        system = load_community_system(conn, address)
        if system is None:
            marks = bookmarks.in_system(conn, address)
            return _empty_system(current).model_copy(
                update={
                    "address": str(address),
                    "lookup": lookup,
                    "bookmark": marks.system,
                    "stations": marks.stations,
                }
            )
        if system.bodies:
            lookup = None  # bodies from an earlier lookup stand, whatever the last one said
    is_current = address == current_address
    mine = conn.execute(
        "SELECT body_count, all_found FROM systems WHERE address = ?", (system.address,)
    ).fetchone()
    ext = conn.execute(
        "SELECT body_count FROM ext_systems WHERE address = ?", (system.address,)
    ).fetchone()
    body_count = mine["body_count"] if mine else None
    if body_count is None and ext is not None:
        body_count = ext["body_count"]
    visits = conn.execute(
        "SELECT COUNT(*) AS n, MIN(ts) AS first_at, MAX(ts) AS last_at, MAX(id) AS last_id "
        "FROM visits WHERE fid = ? AND system_address = ?",
        (fid, system.address),
    ).fetchone()
    last_id = visits["last_id"]
    odyssey = bool(state["odyssey"]) if state else True
    codex = codex_index(conn, fid)
    highlight = usersettings.load(conn)
    marks = bookmarks.in_system(conn, system.address)
    bodies = [
        _body_view(conn, system, f, fid, odyssey, codex, highlight).model_copy(
            update={
                "bookmark": marks.bodies.get(f.body_id),
                "places": marks.places.get(f.body_id, []),
            }
        )
        for f in system.bodies.values()
    ]
    bodies.sort(key=lambda b: (-b.total_value, b.distance_ls or 0.0))
    return SystemView(
        address=str(system.address),
        name=system.name,
        star_pos=system.star_pos,
        body_count=body_count,
        scanned_count=sum(1 for b in bodies if b.source == "journal"),
        all_bodies_found=bool(mine and mine["all_found"]),
        lookup=lookup,
        bookmark=marks.system,
        stations=marks.stations,
        is_current=is_current,
        current_system=current,
        current_body_id=state["body_id"] if is_current else None,
        ship_body_id=state["ship_body_id"] if is_current else None,
        ship_near=bool(state["ship_near"]) if is_current else False,
        visits=visits["n"],
        first_visit_at=visits["first_at"],
        last_visit_at=visits["last_at"],
        prev_system=_neighbour(conn, fid, last_id, before=True) if last_id else None,
        next_system=_neighbour(conn, fid, last_id, before=False) if last_id else None,
        bodies=bodies,
        barycentres=_barycentres(conn, system),
        totals=SystemTotals(
            fss=sum(b.fss_value for b in bodies),
            dss=sum(b.dss_value if b.kind == "planet" else b.fss_value for b in bodies),
            bio_min=sum(b.bio_value_min for b in bodies),
            bio_max=sum(b.bio_value_max for b in bodies),
        ),
    )


def _body_id_named(
    conn: sqlite3.Connection, system_address: int, name: str, default: int | None
) -> int | None:
    row = conn.execute(
        "SELECT body_id FROM bodies WHERE system_address = ? AND name = ?",
        (system_address, name),
    ).fetchone()
    return row["body_id"] if row else default


def surface_view(
    conn: sqlite3.Connection,
    fid: str | None,
    live: LiveStatus | None,
    *,
    online: bool = False,
    want_finds: Callable[[int, str], None] | None = None,
) -> SurfaceView:
    """The body you sample on, its globe and the sampling run in progress; the body you are at
    instead (no run) when Status.json puts you near another one, or when nothing is sampled.
    `want_finds(address, system name)` is called when the globe waits for Canonn's points."""
    state = cmdr_state(conn, fid)
    if state is None or fid is None:
        return SurfaceView(body=None, active_scan=None)

    active = conn.execute(
        "SELECT * FROM organic_scans WHERE fid = ? AND status = 'sampling' "
        "ORDER BY id DESC LIMIT 1",
        (fid,),
    ).fetchone()

    system_address, body_id = state["system_address"], state["body_id"]
    here = live.body_name if live is not None and live.has_lat_long else None
    if active is not None and here:
        scan_body = conn.execute(
            "SELECT name FROM bodies WHERE system_address = ? AND body_id = ?",
            (active["system_address"], active["body_id"]),
        ).fetchone()
        if scan_body is not None and scan_body["name"] != here:
            # At another body: that one is shown; the run is back when you return to its body.
            active = None
            if system_address is not None:
                body_id = _body_id_named(conn, system_address, here, body_id)
    if active is not None:
        system_address, body_id = active["system_address"], active["body_id"]
    elif body_id is None and live is not None and live.body_name and system_address is not None:
        body_id = _body_id_named(conn, system_address, live.body_name, None)

    body: BodyView | None = None
    globe: GlobeView | None = None
    multiplier = 1
    region: str | None = None
    codex = codex_index(conn, fid)
    if system_address is not None and body_id is not None:
        system = load_system(conn, system_address)
        if system is not None:
            region = system.region
        if system is not None and body_id in system.bodies:
            facts = system.bodies[body_id]
            body = _body_view(
                conn, system, facts, fid, bool(state["odyssey"]), codex, usersettings.load(conn)
            )
            multiplier = _bonus_multiplier(facts, system)
            globe = globe_view(
                conn, fid, system, facts, live, state["system_address"], online=online
            )
            if globe is not None and globe.community_state == "loading" and want_finds:
                want_finds(system.address, system.name)

    active_view: ActiveScanView | None = None
    if active is not None:
        genus_name, species_name, base, colony = _species_names(
            active["species"], active["species_name"]
        )
        points = [
            SamplePoint(n=r["n"], lat=r["lat"], lon=r["lon"])
            for r in conn.execute(
                "SELECT n, lat, lon FROM organic_samples WHERE scan_id = ? ORDER BY n",
                (active["id"],),
            )
        ]
        ruled_out = multiplier > 1 and bool(active["was_logged"])
        active_view = ActiveScanView(
            genus=genus_name,
            species=species_name,
            value=base,
            bonus_value=base if ruled_out else base * multiplier,
            bonus_ruled_out=ruled_out,
            colony_range_m=colony,
            codex=colour_status(
                codex, active["variant"], active["species"], region, before=active["started_at"]
            ),
            samples=active["samples"],
            points=points,
            colour=colour_of(active["variant"]),
        )
    return SurfaceView(body=body, active_scan=active_view, globe=globe)


def session_view(conn: sqlite3.Connection, fid: str | None) -> SessionView:
    state = cmdr_state(conn, fid)
    odyssey = bool(state["odyssey"]) if state else True
    # (when, exploration data, organic data): what each unsold item added, for the growth line
    added: list[tuple[str, int, int]] = []

    bio_count, bio_value = 0, 0
    for scan in conn.execute(
        "SELECT species, value, bonus, updated_at FROM organic_scans "
        "WHERE fid = ? AND status = 'analysed' AND sale = 'unsold'",
        (fid,),
    ):
        species = exobio.get_species(scan["species"])
        value = (
            scan["value"] if scan["value"] is not None else (species.base_value if species else 0)
        )
        bio_count += 1
        bio_value += value + (scan["bonus"] or 0)
        added.append((scan["updated_at"] or "", 0, value + (scan["bonus"] or 0)))

    carto_bodies, carto_value, systems = 0, 0, set()
    for row in conn.execute(
        "SELECT bc.system_address, bc.scanned_at, bc.mapped_at, bc.efficient, b.facts "
        "FROM body_cmdr bc "
        "JOIN bodies b ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
        "WHERE bc.fid = ? AND bc.carto = 'unsold'",
        (fid,),
    ):
        facts = facts_from_json(row["facts"])
        efficient = not row["mapped_at"] or bool(row["efficient"])
        value = estimate_body_value(facts, odyssey=odyssey, efficient=efficient)
        mapped = bool(row["mapped_at"]) and facts.kind == "planet"
        carto_bodies += 1
        carto_value += value.dss if mapped else value.fss
        systems.add(row["system_address"])
        scanned = row["scanned_at"] or row["mapped_at"] or ""
        added.append((scanned, value.fss, 0))
        if mapped:
            added.append((row["mapped_at"], value.dss - value.fss, 0))

    last_sale = conn.execute(
        "SELECT sa.ts, sa.station, s.name AS system_name FROM sales sa "
        "LEFT JOIN systems s ON s.address = sa.system_address "
        "WHERE sa.fid = ? ORDER BY sa.id DESC LIMIT 1",
        (fid,),
    ).fetchone()
    last_sale_at = last_sale["ts"] if last_sale else None
    jumps = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(distance_ly), 0) AS ly FROM jumps "
        "WHERE fid = ? AND ts > COALESCE(?, '')",
        (fid, last_sale_at),
    ).fetchone()
    docked = conn.execute(
        "SELECT d.ts, d.station, s.name AS system_name FROM docks d "
        "LEFT JOIN systems s ON s.address = d.system_address "
        "WHERE d.fid = ? ORDER BY d.id DESC LIMIT 1",
        (fid,),
    ).fetchone()

    return SessionView(
        commander=cmdr_name(conn, fid),
        unsold_bio_count=bio_count,
        unsold_bio_value=bio_value,
        unsold_carto_bodies=carto_bodies,
        unsold_carto_systems=len(systems),
        unsold_carto_value=carto_value,
        at_risk_value=bio_value + carto_value,
        jumps=jumps["n"],
        distance_ly=round(jumps["ly"], 2),
        last_sale_at=last_sale_at,
        last_sale_station=last_sale["station"] if last_sale else None,
        last_sale_system=last_sale["system_name"] if last_sale else None,
        last_docked_at=docked["ts"] if docked else None,
        last_docked_station=docked["station"] if docked else None,
        last_docked_system=docked["system_name"] if docked else None,
        growth=_growth(conn, fid, last_sale, added),
    )


GROWTH_POINTS = 300  # at most; long stretches keep every n-th system and the last


def _growth(
    conn: sqlite3.Connection,
    fid: str | None,
    last_sale: sqlite3.Row | None,
    added: list[tuple[str, int, int]],
) -> list[RiskPoint]:
    """Unsold data when you left each system since the last sale: the first point is what the
    sale left unsold, the last one is now."""
    since = last_sale["ts"] if last_sale else None
    stops: list[tuple[str, str | None]] = []
    if since is not None:
        stops.append((since, last_sale["system_name"]))
    stops += [
        (r["ts"], r["name"])
        for r in conn.execute(
            "SELECT v.ts, s.name FROM visits v LEFT JOIN systems s ON s.address = v.system_address "
            "WHERE v.fid = ? AND v.ts > COALESCE(?, '') ORDER BY v.id",
            (fid, since),
        )
    ]
    if not stops:
        return []
    added.sort()
    points: list[RiskPoint] = []
    carto = bio = 0
    i = 0
    for n, (at, name) in enumerate(stops):
        # What was added before you arrived in the next system (everything, for the last one).
        until = stops[n + 1][0] if n + 1 < len(stops) else None
        while i < len(added) and (until is None or added[i][0] < until):
            carto += added[i][1]
            bio += added[i][2]
            i += 1
        points.append(RiskPoint(at=at, system_name=name, carto=carto, bio=bio))
    if len(points) > GROWTH_POINTS:
        step = -(-len(points) // GROWTH_POINTS)
        points = points[:-1:step] + points[-1:]
    return points

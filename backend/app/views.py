"""Builds the JSON views served to the frontend from the projection tables."""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from collections.abc import Iterable

from app import exobio, notes, usersettings
from app.facts import body_id64, facts_from_json, load_community_system, load_system
from app.models import BodyFacts, SystemFacts
from app.schemas import (
    ActiveScanView,
    BarycentreView,
    BodyView,
    BodyVisual,
    CodexStatus,
    CommunityLookup,
    HighlightSettings,
    Interest,
    LiveStatus,
    OrbitView,
    ParentRef,
    RingView,
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


def _footfall_multiplier(facts: BodyFacts, system: SystemFacts) -> int:
    """First-footfall bonus applies on untouched bodies in unpopulated systems."""
    if facts.was_footfalled is False and not system.populated:
        return exobio.FIRST_FOOTFALL_MULTIPLIER
    return 1


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


# species symbol -> [(region, timestamp)] of your codex entries for it
CodexIndex = dict[str, list[tuple[str | None, str]]]


def codex_index(conn: sqlite3.Connection, fid: str | None) -> CodexIndex:
    index: CodexIndex = defaultdict(list)
    for row in conn.execute(
        "SELECT species, region, ts FROM codex_entries WHERE fid = ? AND species IS NOT NULL",
        (fid,),
    ):
        index[row["species"]].append((row["region"], row["ts"]))
    return index


def codex_status(
    index: CodexIndex, species: str, region: str | None, before: str | None = None
) -> CodexStatus:
    """Codex state of a species. `before`: ignore entries written from that moment on
    (the game logs the entry at the first sample, so an ongoing scan still counts as new)."""
    regions = {r for r, ts in index.get(species, ()) if before is None or ts < before}
    if not regions:
        return "new"
    if region is None or region in regions:
        return "logged"  # with the region unknown, any record counts
    return "new_region"


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
    multiplier = _footfall_multiplier(facts, system)
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
        confirmed_values.append(value)
        views.append(
            SpeciesView(
                genus=genus_name,
                species=species_name,
                value=value,
                bonus_value=value * multiplier,
                colony_range_m=colony,
                status="analysed" if scan["status"] == "analysed" else "sampling",
                samples=scan["samples"],
                certain=True,
                codex=codex_status(
                    codex,
                    symbol,
                    system.region,
                    before=scan["started_at"] if scan["status"] == "sampling" else None,
                ),
            )
        )

    # Genus -> (min, max) base value of species still possible on this body.
    ranges: dict[str, tuple[int, int]] = {}
    if bio_signals > 0 or genuses:
        predictions = exobio.predict(facts, system, genuses or None)
        ranges = exobio.genus_ranges(predictions, genuses, skip=seen_genera)
        for p in sorted(predictions, key=lambda p: -p.species.base_value):
            sp = p.species
            if sp.genus in seen_genera:
                continue
            views.append(
                SpeciesView(
                    genus=sp.genus_name,
                    species=sp.species_name,
                    value=sp.base_value,
                    bonus_value=sp.base_value * multiplier,
                    colony_range_m=sp.colony_range_m,
                    status="predicted",
                    samples=0,
                    certain=sp.genus in genuses,
                    codex=codex_status(codex, sp.species, system.region),
                )
            )

    remaining = max(max(bio_signals, len(genuses)) - len(seen_genera), 0)
    still_low, still_high = exobio.range_total(ranges, remaining)
    confirmed = sum(confirmed_values)
    order = {"sampling": 0, "analysed": 1, "predicted": 2}
    views.sort(key=lambda v: (order[v.status], not v.certain, -v.value))
    # Count genera, not candidate species: one bio signal is one genus on the body.
    certain_new = {v.genus for v in views if v.codex != "logged" and v.certain}
    maybe_new = {v.genus for v in views if v.codex != "logged" and not v.certain} - certain_new
    open_slots = max(max(bio_signals, len(genuses)) - len(certain_new), 0)
    codex_new = len(certain_new)
    codex_maybe = min(len(maybe_new), open_slots)
    low, high = (confirmed + still_low) * multiplier, (confirmed + still_high) * multiplier
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
    if row is None:
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
            note = notes.of_system(conn, address).get(notes.SYSTEM)
            return _empty_system(current).model_copy(
                update={"address": str(address), "lookup": lookup, "note": note}
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
    noted = notes.of_system(conn, system.address)
    bodies = [
        _body_view(conn, system, f, fid, odyssey, codex, highlight).model_copy(
            update={"note": noted.get(f.body_id)}
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
        note=noted.get(notes.SYSTEM),
        is_current=is_current,
        current_system=current,
        current_body_id=state["body_id"] if is_current else None,
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


def surface_view(conn: sqlite3.Connection, fid: str | None, live: LiveStatus | None) -> SurfaceView:
    state = cmdr_state(conn, fid)
    if state is None:
        return SurfaceView(body=None, active_scan=None)

    active = conn.execute(
        "SELECT * FROM organic_scans WHERE fid = ? AND status = 'sampling' "
        "ORDER BY id DESC LIMIT 1",
        (fid,),
    ).fetchone()

    system_address, body_id = state["system_address"], state["body_id"]
    if active is not None:
        system_address, body_id = active["system_address"], active["body_id"]
    elif body_id is None and live is not None and live.body_name and system_address is not None:
        row = conn.execute(
            "SELECT body_id FROM bodies WHERE system_address = ? AND name = ?",
            (system_address, live.body_name),
        ).fetchone()
        body_id = row["body_id"] if row else None

    body: BodyView | None = None
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
            multiplier = _footfall_multiplier(facts, system)

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
        active_view = ActiveScanView(
            genus=genus_name,
            species=species_name,
            value=base,
            bonus_value=base * multiplier,
            colony_range_m=colony,
            codex=codex_status(codex, active["species"], region, before=active["started_at"]),
            samples=active["samples"],
            points=points,
        )
    return SurfaceView(body=body, active_scan=active_view)


def session_view(conn: sqlite3.Connection, fid: str | None) -> SessionView:
    state = cmdr_state(conn, fid)
    odyssey = bool(state["odyssey"]) if state else True

    bio_count, bio_value = 0, 0
    for scan in conn.execute(
        "SELECT species, value, bonus FROM organic_scans "
        "WHERE fid = ? AND status = 'analysed' AND sale = 'unsold'",
        (fid,),
    ):
        species = exobio.get_species(scan["species"])
        value = (
            scan["value"] if scan["value"] is not None else (species.base_value if species else 0)
        )
        bio_count += 1
        bio_value += value + (scan["bonus"] or 0)

    carto_bodies, carto_value, systems = 0, 0, set()
    for row in conn.execute(
        "SELECT bc.system_address, bc.mapped_at, bc.efficient, b.facts FROM body_cmdr bc "
        "JOIN bodies b ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
        "WHERE bc.fid = ? AND bc.carto = 'unsold'",
        (fid,),
    ):
        facts = facts_from_json(row["facts"])
        efficient = not row["mapped_at"] or bool(row["efficient"])
        value = estimate_body_value(facts, odyssey=odyssey, efficient=efficient)
        carto_bodies += 1
        carto_value += value.dss if row["mapped_at"] and facts.kind == "planet" else value.fss
        systems.add(row["system_address"])

    last_sale = conn.execute("SELECT MAX(ts) AS ts FROM sales WHERE fid = ?", (fid,)).fetchone()
    last_sale_at = last_sale["ts"] if last_sale else None
    jumps = conn.execute(
        "SELECT COUNT(*) AS n, COALESCE(SUM(distance_ly), 0) AS ly FROM jumps "
        "WHERE fid = ? AND ts > COALESCE(?, '')",
        (fid, last_sale_at),
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
    )

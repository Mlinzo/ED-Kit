from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app import db
from app.codex import codex_index, codex_status, colour_status, predicted_status
from app.exobio.variants import colour_of, variants
from app.models import BodyFacts, SystemFacts

ALEOIDA = "$Codex_Ent_Aleoids_01_Name;"  # colour by star
CUCUMISIS = "$Codex_Ent_Stratum_06_Name;"  # colour by star, Y dwarfs included in the table
VESICULA = "$Codex_Ent_Bacterial_05_Name;"  # by a group-A material
SETISIS = "$Codex_Ent_Fungoids_02_Name;"  # by a group-B material
LEGACY = "$Codex_Ent_Sphere_Name;"  # no colours
INNER = "$Codex_RegionName_18;"
OTHER = "$Codex_RegionName_7;"


def body(star: str | None = "F", **materials: float) -> tuple[BodyFacts, SystemFacts]:
    system = SystemFacts(address=1, name="S")
    if star is not None:
        system.bodies[0] = BodyFacts(
            system_address=1, body_id=0, name="S", kind="star", star_type=star
        )
    planet = BodyFacts(
        system_address=1,
        body_id=3,
        name="S 1",
        kind="planet",
        parents=[("Planet", 2), ("Star", 0)],
        materials=materials,
    )
    system.bodies[3] = planet
    return planet, system


def test_colour_by_parent_star() -> None:
    found = variants(ALEOIDA, *body("F"))
    assert found is not None and [(v.symbol, v.colour, v.weight) for v in found] == [
        ("$Codex_Ent_Aleoids_01_F_Name;", "Teal", 1.0)
    ]
    assert variants(ALEOIDA, *body("K_OrangeGiant"))[0].colour == "Turquoise"  # type: ignore[index]
    assert variants(ALEOIDA, *body("DA"))[0].symbol.endswith("_D_Name;")  # type: ignore[index]
    assert variants(ALEOIDA, *body(None)) is None  # parent star unknown
    assert variants(ALEOIDA, *body("O")) is None  # no Aleoida Arcus colour for O stars


def dwarf_moon(
    dwarf: str, main: str | None, via_star: bool = True
) -> tuple[BodyFacts, SystemFacts]:
    """A body orbiting a brown dwarf, which orbits the main star (or a barycentre with it)."""
    system = SystemFacts(address=1, name="S")
    if main is not None:
        system.bodies[0] = BodyFacts(
            system_address=1, body_id=0, name="S", kind="star", star_type=main
        )
    system.bodies[28] = BodyFacts(
        system_address=1, body_id=28, name="S 7", kind="star", star_type=dwarf, distance_ls=1790.0
    )
    up = [("Star", 28), ("Star", 0)] if via_star else [("Star", 28), ("Null", 1)]
    moon = BodyFacts(system_address=1, body_id=30, name="S 7 b", kind="planet", parents=up)
    system.bodies[30] = moon
    return moon, system


def test_a_y_dwarf_does_not_colour_its_moons() -> None:
    # HIP 16896 7 b: a Y dwarf orbiting an F star; the game logged Emerald (F), not Indigo (Y).
    found = variants(CUCUMISIS, *dwarf_moon("Y", "F"))
    assert found is not None and [v.colour for v in found] == ["Emerald"]
    assert variants(CUCUMISIS, *dwarf_moon("Y", "F", via_star=False))[0].colour == "Emerald"  # type: ignore[index]
    assert variants(CUCUMISIS, *dwarf_moon("Y", None)) is None  # the main star unknown
    # T and L dwarfs do colour (Canonn: 87 % and 96 % of the samples around them).
    assert variants(CUCUMISIS, *dwarf_moon("T", "F"))[0].colour == "Grey"  # type: ignore[index]
    assert variants(CUCUMISIS, *dwarf_moon("L", "F"))[0].colour == "Turquoise"  # type: ignore[index]


def test_colour_by_material() -> None:
    found = variants(VESICULA, *body(iron=20.0, tellurium=0.9, cadmium=1.2))
    assert found is not None and [(v.colour, v.weight) for v in found] == [("Red", 1.0)]
    assert variants(VESICULA, *body(iron=20.0)) is None  # materials unknown or none of its group
    # Group B: several can be on one body, and nothing tells which one colours it.
    both = variants(SETISIS, *body(tin=1.1, molybdenum=1.2, Iron=20.0))
    assert both is not None and sorted((v.colour, v.weight) for v in both) == [
        ("Magenta", 0.5),
        ("Orange", 0.5),
    ]


def test_organisms_without_colours() -> None:
    assert [(v.symbol, v.colour, v.weight) for v in variants(LEGACY, *body()) or []] == [
        (LEGACY, None, 1.0)
    ]
    assert colour_of("$Codex_Ent_Bacterial_05_Yttrium_Name;") == "Lime"
    assert colour_of(LEGACY) is None and colour_of(None) is None


@pytest.fixture
def conn(tmp_path: Path) -> sqlite3.Connection:
    c = db.connect(tmp_path / "t.db")
    db.init_schema(c)
    return c


def log(conn: sqlite3.Connection, name: str, species: str, region: str, ts: str) -> None:
    conn.execute(
        "INSERT INTO codex_entries(fid, ts, entry_id, name, species, category, region) "
        "VALUES('F1', ?, 1, ?, ?, 'bio', ?)",
        (ts, name, species, region),
    )


def test_codex_by_colour(conn: sqlite3.Connection) -> None:
    log(conn, "$Codex_Ent_Aleoids_01_F_Name;", ALEOIDA, INNER, "2026-10-19T10:00:00Z")
    log(conn, "$Codex_Ent_Fungoids_02_Tin_Name;", SETISIS, INNER, "2026-10-19T10:05:00Z")
    index = codex_index(conn, "F1")
    # Any colour still counts for the species.
    assert codex_status(index, ALEOIDA, INNER) == "logged"
    teal = variants(ALEOIDA, *body("F"))
    assert predicted_status(index, ALEOIDA, teal, INNER) == ("logged", 0.0)
    assert predicted_status(index, ALEOIDA, teal, OTHER) == ("new_region", 1.0)
    turquoise = variants(ALEOIDA, *body("K"))
    # A new colour of a species logged here: a new entry, told apart from a new species.
    assert predicted_status(index, ALEOIDA, turquoise, INNER) == ("new_colour", 1.0)
    assert predicted_status(index, ALEOIDA, turquoise, OTHER) == ("new_region", 1.0)
    # Colour unknown: by species, as before.
    assert predicted_status(index, ALEOIDA, None, INNER) == ("logged", 0.0)
    # Tin logged, molybdenum not: half a new entry.
    tin_or_mo = variants(SETISIS, *body(tin=1.1, molybdenum=1.2))
    assert predicted_status(index, SETISIS, tin_or_mo, INNER) == ("new_colour", 0.5)


def test_colour_status_of_a_sample(conn: sqlite3.Connection) -> None:
    teal, turquoise = "$Codex_Ent_Aleoids_01_F_Name;", "$Codex_Ent_Aleoids_01_K_Name;"
    log(conn, teal, ALEOIDA, INNER, "2026-10-19T10:00:00Z")
    index = codex_index(conn, "F1")
    assert colour_status(index, teal, ALEOIDA, INNER) == "logged"
    assert colour_status(index, turquoise, ALEOIDA, INNER) == "new_colour"
    assert colour_status(index, turquoise, ALEOIDA, OTHER) == "new_region"
    assert colour_status(index, None, ALEOIDA, INNER) == "logged"  # the colour unknown
    assert colour_status(index, turquoise, SETISIS, INNER) == "new"
    # The entry written at the first sample of an ongoing scan does not count yet.
    assert colour_status(index, teal, ALEOIDA, INNER, before="2026-10-19T10:00:00Z") == "new"

from __future__ import annotations

import sqlite3
from typing import Any

import pytest

from app import engineering
from app.projector import Projector
from app.schemas import EngineeringGoalView
from tests.test_projector import conn, feed, proj  # noqa: F401 - fixtures

TS = "2026-10-26T17:00:00Z"


def ev(event: str, **fields: Any) -> dict[str, Any]:
    return {"timestamp": TS, "event": event, **fields}


def goal(
    blueprint: str = "cfsd_ir", start: int = 0, end: int = 2, effect: str | None = None, n: int = 1
) -> EngineeringGoalView:
    return EngineeringGoalView(
        id=1,
        module="cfsd",
        blueprint=blueprint,
        grade_from=start,
        grade_to=end,
        experimental=effect,
        count=n,
    )


def test_recipes_as_the_journal_spends_them() -> None:
    # The user's EngineerCraft for Increased Range, grade 3: phosphorus, chemical processors and
    # strange wake solutions, one of each.
    catalog = engineering.catalog_view()
    assert catalog.blueprints["cfsd_ir"].grades[2] == {
        "phosphorus": 1,
        "chemicalprocessors": 1,
        "wakesolutions": 1,
    }
    kinds = {k.key: k for k in catalog.modules}
    assert "cfsd_ir" in kinds["cfsd"].blueprints and kinds["cfsd"].experimentals
    assert catalog.modules[0].key == "cbh"  # core modules first


def test_needs_count_a_grade_as_many_rolls_as_its_number() -> None:
    # Grade 1 once, grade 2 twice.
    need = engineering.needs([goal(end=2)])
    assert need == {"disruptedwakeechoes": 3, "chemicalprocessors": 2}
    # From grade 2 on: only grade 3, three rolls; two such modules.
    need = engineering.needs([goal(start=2, end=3, n=2)])
    assert need == {"phosphorus": 6, "chemicalprocessors": 6, "wakesolutions": 6}
    # An experimental effect once per module, with nothing else when the grade is reached.
    effect = engineering.catalog_view().experimentals["cfsdx_mm"]
    need = engineering.needs([goal(start=5, end=5, effect="cfsdx_mm", n=3)])
    assert need == {k: 3 * v for k, v in effect.materials.items()}
    # Several goals add up.
    assert engineering.needs([goal(end=1), goal(end=1)]) == {"disruptedwakeechoes": 2}


def test_goals_are_checked_against_the_catalog(conn: sqlite3.Connection) -> None:  # noqa: F811
    with pytest.raises(ValueError, match="module"):
        engineering.add(conn, "nope", "cfsd_ir", 0, 5, None, 1)
    with pytest.raises(ValueError, match="blueprint"):
        engineering.add(conn, "cfsd", "wpn_oc", 0, 5, None, 1)
    with pytest.raises(ValueError, match="grades"):
        engineering.add(conn, "cfsd", "cfsd_ir", 3, 2, None, 1)
    with pytest.raises(ValueError, match="nothing"):
        engineering.add(conn, "cfsd", "cfsd_ir", 5, 5, None, 1)
    goal_id = engineering.add(conn, "cfsd", "cfsd_ir", 0, 5, "cfsdx_mm", 500)
    [saved] = engineering.engineering_view(conn).goals
    assert (saved.id, saved.grade_to, saved.experimental, saved.count) == (
        goal_id,
        5,
        "cfsdx_mm",
        99,
    )
    assert engineering.update(conn, goal_id, "cfsd", "cfsd_ir", 4, 5, None, 1)
    assert engineering.engineering_view(conn).goals[0].grade_from == 4
    assert engineering.delete(conn, goal_id) and not engineering.delete(conn, goal_id)


def test_stock_from_the_journal(conn: sqlite3.Connection, proj: Projector) -> None:  # noqa: F811
    assert engineering.stock(conn) == ({}, None)  # never listed: nothing known
    feed(
        conn,
        proj,
        [
            ev("MaterialCollected", Category="Raw", Name="iron", Count=3),  # before the list
            ev(
                "Materials",
                Raw=[{"Name": "phosphorus", "Count": 4}, {"Name": "iron", "Count": 299}],
                Manufactured=[{"Name": "chemicalprocessors", "Count": 2}],
                Encoded=[{"Name": "wakesolutions", "Name_Localised": "x", "Count": 1}],
            ),
            ev("MaterialCollected", Category="Raw", Name="Iron", Count=3),  # capped at 300
            ev(
                "EngineerCraft",
                Ingredients=[
                    {"Name": "phosphorus", "Count": 1},
                    {"Name": "chemicalprocessors", "Count": 1},
                    {"Name": "wakesolutions", "Count": 1},
                ],
            ),
            ev(
                "MaterialTrade",
                Paid={"Material": "iron", "Category": "Raw", "Quantity": 6},
                Received={"Material": "arsenic", "Quantity": 1},
            ),
            ev("MissionCompleted", MaterialsReward=[{"Name": "polonium", "Count": 2}]),
            ev("EngineerContribution", Type="Materials", Material="phosphorus", Quantity=1),
            ev("EngineerContribution", Type="Commodity", Commodity="gold", Quantity=5),
        ],
    )
    have, at = engineering.stock(conn)
    assert at == TS
    assert have == {
        "phosphorus": 2,
        "iron": 294,
        "chemicalprocessors": 1,
        "arsenic": 1,
        "polonium": 2,
    }  # wake solutions used up: gone from the list


def test_view_needs_against_stock(conn: sqlite3.Connection, proj: Projector) -> None:  # noqa: F811
    feed(conn, proj, [ev("Materials", Raw=[], Manufactured=[], Encoded=[
        {"Name": "disruptedwakeechoes", "Count": 2},
    ])])  # fmt: skip
    engineering.add(conn, "cfsd", "cfsd_ir", 0, 2, None, 1)
    view = engineering.engineering_view(conn)
    by_symbol = {n.symbol: (n.need, n.have) for n in view.needs}
    assert by_symbol == {"disruptedwakeechoes": (3, 2), "chemicalprocessors": (2, 0)}
    assert view.stock == {"disruptedwakeechoes": 2} and view.stock_at == TS


def test_material_events_refresh_the_engineering_view(
    conn: sqlite3.Connection,  # noqa: F811
    proj: Projector,  # noqa: F811
) -> None:
    assert proj.apply(ev("MaterialCollected", Name="iron", Count=1), 1) == {"engineering"}
    assert proj.apply(ev("Materials", Raw=[]), 2) == {"engineering"}


def test_planet_materials_by_symbol_the_most_first() -> None:
    # The journal names elements by symbol, Spansh by name: one way out.
    got = engineering.body_materials({"Iron": 20.1, "arsenic": 2.5, "polonium": 0.61})
    assert [(m.symbol, m.name, m.grade, m.percent) for m in got] == [
        ("iron", "Iron", 1, 20.1),
        ("arsenic", "Arsenic", 2, 2.5),
        ("polonium", "Polonium", 4, 0.61),
    ]

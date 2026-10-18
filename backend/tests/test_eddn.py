from __future__ import annotations

import json
import threading
import time
import zlib
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app import eddn
from app.config import Settings
from app.main import create_app

NOW = 1_800_000_000.0


def raw(
    event: str,
    *,
    schema: str = "journal/1",
    address: int = 10,
    name: str = "Sol",
    pos: Any = (0.0, 0.0, 0.0),
    uploader: str = "u1",
    sent: str = "2026-10-18T18:00:00Z",
    received: str = "2026-10-18T18:00:02Z",
    **message: Any,
) -> bytes:
    body = {
        "$schemaRef": f"https://eddn.edcd.io/schemas/{schema}",
        "header": {"uploaderID": uploader, "gatewayTimestamp": received},
        "message": {
            "event": event,
            "timestamp": sent,
            "StarSystem": name,
            "SystemAddress": address,
            "StarPos": list(pos) if pos is not None else None,
            **message,
        },
    }
    return zlib.compress(json.dumps(body).encode())


def test_parse_kinds() -> None:
    assert eddn.parse(raw("FSDJump"), NOW).kind == "arrived"  # type: ignore[union-attr]
    assert eddn.parse(raw("CarrierJump"), NOW).kind == "arrived"  # type: ignore[union-attr]
    assert eddn.parse(raw("Scan"), NOW).kind == "scan"  # type: ignore[union-attr]
    assert eddn.parse(raw("Docked"), NOW).kind == "docked"  # type: ignore[union-attr]
    sign = eddn.parse(
        raw("CodexEntry", schema="codexentry/1", Name="$Codex_Ent_Stratum_07_L_Name;"), NOW
    )
    assert sign is not None and sign.kind == "codex" and sign.codex == "Stratum Tectonicas"
    sign = eddn.parse(raw("CodexEntry", schema="codexentry/1", Name="$Codex_Ent_K_Type_Name;"), NOW)
    assert sign is not None and sign.codex == "K Type"
    assert eddn.codex_name("$Codex_Ent_Gas_Vents_SilicateVapourGeysers_Name;") == (
        "Gas Vents Silicate Vapour Geysers"
    )
    sign = eddn.parse(
        raw(
            "FSSSignalDiscovered",
            schema="fsssignaldiscovered/1",
            signals=[
                {"SignalName": "MORNING STAR JZZ-7QX", "SignalType": "FleetCarrier"},
                {"SignalName": "Payette Hub", "SignalType": "StationONeilOrbis"},
            ],
        ),
        NOW,
    )
    assert sign is not None and sign.kind == "scan" and sign.carriers == ("MORNING STAR JZZ-7QX",)


def test_parse_drops_what_says_nothing_about_now() -> None:
    assert eddn.parse(raw("FSDJump", pos=None), NOW) is None  # a market, a route: no position
    assert eddn.parse(raw("FSDJump", schema="journal/1/test"), NOW) is None
    backlog = raw("FSDJump", sent="2026-10-18T17:00:00Z", received="2026-10-18T18:00:00Z")
    assert eddn.parse(backlog, NOW) is None
    assert eddn.parse(b"not zlib", NOW) is None


CODEX = {"schema": "codexentry/1", "Name": "$Codex_Ent_K_Type_Name;"}


def test_traffic_by_system() -> None:
    traffic = eddn.Traffic()
    for at, uploader, event, extra in [
        (NOW - 100, "a", "FSDJump", {}),
        (NOW - 90, "a", "Scan", {}),
        (NOW - 80, "b", "FSDJump", {}),
        (NOW - 70, "b", "CodexEntry", CODEX),
    ]:
        sign = eddn.parse(raw(event, uploader=uploader, **extra), at)
        assert sign is not None
        traffic.add(sign)
    achenar = raw("FSDJump", address=20, name="Achenar", pos=(67.5, -119.5, 24.8))
    other = eddn.parse(achenar, NOW - 60)
    assert other is not None
    traffic.add(other)
    old = eddn.parse(raw("FSDJump", address=30, name="Old"), NOW - eddn.WINDOW_S - 1)
    assert old is not None
    traffic.signs.appendleft(old)

    systems, players = traffic.systems(NOW)
    assert [s.name for s in systems] == ["Achenar", "Sol"]  # the latest first; Old has expired
    sol = systems[1]
    assert (sol.players, sol.arrived, sol.scans, sol.codex) == (2, 2, 1, ["K Type"])
    assert sol.age_s == 70
    assert players == 3  # a, b and u1 (Achenar)
    assert traffic.span(NOW) == 100  # the oldest kept: a's jump


def feed(traffic: eddn.Traffic, *messages: tuple[float, bytes]) -> None:
    for at, message in messages:
        sign = eddn.parse(message, at)
        assert sign is not None
        traffic.add(sign)


def test_a_player_shows_where_seen_last() -> None:
    traffic = eddn.Traffic()
    feed(
        traffic,
        (NOW - 250, raw("FSDJump", uploader="a", sent="2026-10-18T18:00:00Z")),
        (NOW - 230, raw("Scan", uploader="a", sent="2026-10-18T18:00:20Z", BodyID=1)),
        (
            NOW - 150,
            raw("FSDJump", uploader="a", address=20, name="Achenar", sent="2026-10-18T18:01:40Z"),
        ),
    )
    systems, players = traffic.systems(NOW)
    assert [(s.name, s.players, s.scans) for s in systems] == [("Achenar", 1, 0)]  # not Sol too
    assert players == 1


def test_two_tools_of_one_player_count_once() -> None:
    traffic = eddn.Traffic()
    scans = [raw("Scan", sent=f"2026-10-18T18:00:{i:02}Z", BodyID=i) for i in range(1, 4)]
    for i, scan in enumerate(scans):
        # EDMC and another tool, under different ids, upload the same journal lines.
        feed(traffic, (NOW - 100 + i, scan))
    for i in range(1, 4):
        feed(
            traffic,
            (NOW - 90 + i, raw("Scan", uploader="x", sent=f"2026-10-18T18:00:{i:02}Z", BodyID=i)),
        )
    systems, players = traffic.systems(NOW)
    assert players == 1
    assert [(s.players, s.scans) for s in systems] == [(1, 3)]


def test_a_wing_jumping_together_is_two_players() -> None:
    traffic = eddn.Traffic()
    for uploader in ("a", "b"):
        feed(traffic, (NOW - 10, raw("FSDJump", uploader=uploader)))  # the same second
    systems, players = traffic.systems(NOW)
    assert players == 2 and systems[0].players == 2


class FakeRelay:
    def __init__(self, messages: list[bytes]) -> None:
        self.messages = list(messages)
        self.closed = threading.Event()

    def recv(self, timeout_ms: int) -> bytes | None:
        if self.messages:
            return self.messages.pop(0)
        time.sleep(timeout_ms / 1000 / 50)
        return None

    def close(self) -> None:
        self.closed.set()


def test_listener_connects_while_watched() -> None:
    relay = FakeRelay([raw("FSDJump"), raw("Scan", uploader="u2")])
    changes: list[int] = []
    listener = eddn.LiveListener(lambda: changes.append(1), connect=lambda: relay)
    view = listener.view()  # starts listening
    assert view.available and view.window_min == 5
    deadline = time.time() + 5
    while time.time() < deadline and not (view.state == "live" and view.systems):
        time.sleep(0.02)
        view = listener.view()
    assert view.state == "live" and view.since is not None
    assert [(s.name, s.players) for s in view.systems] == [("Sol", 2)]
    assert view.players == 2 and changes


def test_listener_hangs_up_when_nobody_watches() -> None:
    relay = FakeRelay([])
    clock = [NOW]
    listener = eddn.LiveListener(lambda: None, connect=lambda: relay, clock=lambda: clock[0])
    listener.view()
    deadline = time.time() + 5
    while time.time() < deadline and listener.view().state != "connecting":
        time.sleep(0.02)
    clock[0] += eddn.IDLE_S + 1  # nobody asked since
    assert relay.closed.wait(5)


def test_live_endpoint_offline(tmp_path: Path) -> None:
    settings = Settings(
        journal_dir=tmp_path / "journals", data_dir=tmp_path / "data", static_dir=None, online=False
    )
    with TestClient(create_app(settings)) as client:
        live = client.get("/api/view/live").json()
        assert live["available"] is False and live["systems"] == [] and live["windowMin"] == 5


def test_merged_ids_resolve_to_one_player() -> None:
    traffic = eddn.Traffic()
    traffic._same = {"a": "b", "b": "c"}
    assert traffic.player("a") == "c" and traffic.player("b") == "c" and traffic.player("c") == "c"
    assert traffic._same == {"a": "c", "b": "c"}  # shortened, no loops


def test_ids_change_every_3_minutes_and_players_are_not_counted_twice() -> None:
    """The relay gives everyone a new id every 3 minutes: a and b, then a2 and b2."""
    traffic = eddn.Traffic()
    systems = {"a": (10, "Sol"), "b": (20, "Achenar"), "a2": (30, "Alioth"), "b2": (20, "Achenar")}
    messages = []
    for i, at in enumerate(range(-290, 0, 10)):
        ids = ("a", "b") if at < -120 else ("a2", "b2")
        for uploader in ids:
            address, name = systems[uploader]
            sent = f"2026-10-18T18:{(i * 10) // 60:02}:{(i * 10) % 60:02}Z"
            body = raw("Scan", uploader=uploader, address=address, name=name, sent=sent, BodyID=i)
            messages.append((NOW + at, body))
    feed(traffic, *messages)
    views, players = traffic.systems(NOW)
    assert players == 2  # not 4
    by_name = {v.name: v for v in views}
    assert set(by_name) == {"Sol", "Achenar", "Alioth"}  # a's old dot stays, dimmer
    assert by_name["Achenar"].players == 1  # b, then b2: one player
    assert by_name["Sol"].age_s > by_name["Alioth"].age_s


def test_the_first_change_of_ids_can_come_soon_after_connecting() -> None:
    traffic = eddn.Traffic()
    messages = []
    for i, at in enumerate(range(-200, 0, 5)):
        # Listening for 200 s; the relay changed the ids 40 s after we started.
        uploader = "a" if at < -160 else "a2"
        sent = f"2026-10-18T18:{(i * 5) // 60:02}:{(i * 5) % 60:02}Z"
        messages.append((NOW + at, raw("Scan", uploader=uploader, sent=sent, BodyID=i)))
    feed(traffic, *messages)
    _, players = traffic.systems(NOW)
    assert players == 1


def test_players_are_those_of_the_last_full_3_minutes() -> None:
    """Listening since -400; the ids changed at -350 (three players) and at -170 (two so far)."""
    traffic = eddn.Traffic()
    stretches = [(-400, -355, ["p"]), (-350, -175, ["q1", "q2", "q3"]), (-170, 0, ["r1", "r2"])]
    messages = []
    i = 0
    for start, end, ids in stretches:
        for at in range(start, end, 5):
            for uploader in ids:
                i += 1
                sent = f"2026-10-18T{18 + i // 3600:02}:{(i // 60) % 60:02}:{i % 60:02}Z"
                messages.append((NOW + at, raw("Scan", uploader=uploader, sent=sent, BodyID=i)))
    feed(traffic, *messages)
    views, players = traffic.systems(NOW)
    assert players == 3  # the last full stretch, not the 2 heard so far, nor 3 + 2
    assert traffic.span(NOW) == eddn.WINDOW_S  # the map shows 5 minutes of it

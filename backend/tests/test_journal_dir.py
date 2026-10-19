"""The journal folder chosen in the app: stored, switched on the fly, overridden at launch."""

from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings, parse_dir
from app.main import create_app


def write_journal(folder: Path, stamp: str, commander: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    lines = [
        {"timestamp": f"{stamp}Z", "event": "Fileheader", "part": 1, "gameversion": "4.4.1.1"},
        {"timestamp": f"{stamp}Z", "event": "Commander", "FID": "F1", "Name": commander},
    ]
    name = f"Journal.{stamp.replace(':', '')}.01.log"
    (folder / name).write_text("".join(json.dumps(x) + "\n" for x in lines), encoding="utf-8")


def make_client(tmp_path: Path, **kwargs: object) -> TestClient:
    settings = Settings(
        journal_dir=tmp_path / "standard",
        data_dir=tmp_path / "data",
        static_dir=None,
        online=False,
        **kwargs,  # type: ignore[arg-type]
    )
    return TestClient(create_app(settings))


def wait_ingest(client: TestClient, done: object) -> dict:
    for _ in range(100):
        state = client.get("/api/ingest").json()
        if done(state):  # type: ignore[operator]
            return state
        time.sleep(0.05)
    raise AssertionError(f"ingest never got there: {state}")


def test_parse_dir_cleans_pasted_paths(monkeypatch) -> None:
    monkeypatch.setenv("EDEK_TEST_HOME", "C:/Users/Cmdr")
    assert parse_dir('  "D:\\Games\\Journal"  ') == Path("D:\\Games\\Journal")
    assert parse_dir("%EDEK_TEST_HOME%/Saved Games") == Path("C:/Users/Cmdr/Saved Games")
    assert parse_dir("$EDEK_TEST_HOME/x") == Path("C:/Users/Cmdr/x")


def test_chosen_folder_is_read_kept_and_reset(tmp_path: Path) -> None:
    write_journal(tmp_path / "standard", "2026-10-18T100000", "Alpha")
    write_journal(tmp_path / "moved", "2026-10-19T100000", "Beta")
    write_journal(tmp_path / "moved", "2026-10-19T110000", "Beta")

    with make_client(tmp_path) as client:
        first = wait_ingest(client, lambda s: s["backfillDone"])
        assert first["journalFiles"] == 1 and first["journalDirFixed"] is False
        events = first["events"]

        assert (
            client.put("/api/journal-dir", json={"path": str(tmp_path / "nowhere")}).status_code
            == 422
        )

        switched = client.put("/api/journal-dir", json={"path": f'"{tmp_path / "moved"}"'}).json()
        assert switched["journalDir"] == str(tmp_path / "moved")
        assert switched["journalDirFound"] is True and switched["journalFiles"] == 2
        state = wait_ingest(client, lambda s: s["backfillDone"] and s["filesTotal"] == 2)
        # The new folder's two files are read; the old folder's events stay.
        assert state["events"] == events + 4

    # Restarted: the chosen folder is still the one read.
    with make_client(tmp_path) as client:
        state = wait_ingest(client, lambda s: s["backfillDone"])
        assert state["journalDir"] == str(tmp_path / "moved") and state["filesTotal"] == 2
        reset = client.put("/api/journal-dir", json={"path": None}).json()
        assert reset["journalDir"] == reset["journalDirDefault"] == str(tmp_path / "standard")


def test_folder_set_at_launch_cannot_change(tmp_path: Path) -> None:
    (tmp_path / "other").mkdir()
    with make_client(tmp_path, journal_dir_fixed=True) as client:
        assert client.get("/api/ingest").json()["journalDirFixed"] is True
        response = client.put("/api/journal-dir", json={"path": str(tmp_path / "other")})
        assert response.status_code == 409

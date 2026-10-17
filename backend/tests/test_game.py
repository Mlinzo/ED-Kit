from __future__ import annotations

import subprocess
import sys
from types import SimpleNamespace

import pytest

from app import game


def test_the_process_list_wins_over_the_journal() -> None:
    assert game.game_running(True, "Shutdown") is True
    assert game.game_running(False, "Music") is False
    # No process list: the journal's last event decides.
    assert game.game_running(None, "Shutdown") is False
    assert game.game_running(None, "FSDJump") is True
    assert game.game_running(None, None) is None


@pytest.mark.skipif(sys.platform != "win32", reason="tasklist is Windows only")
def test_the_process_list_is_read(monkeypatch: pytest.MonkeyPatch) -> None:
    answers = {
        "running": b'"EliteDangerous64.exe","1234","Console","1","3,145,728 K"\r\n',
        # Localized "no tasks" message: no image name in it.
        "closed": "ИНФОРМАЦИЯ: Задачи, отвечающие заданным критериям, отсутствуют.\r\n".encode(
            "cp866"
        ),
    }
    for state, stdout in answers.items():
        monkeypatch.setattr(
            game.subprocess,
            "run",
            lambda *a, _out=stdout, **k: SimpleNamespace(returncode=0, stdout=_out),
        )
        assert game.process_running() is (state == "running")

    def fail(*a: object, **k: object) -> None:
        raise subprocess.TimeoutExpired("tasklist", 5)

    monkeypatch.setattr(game.subprocess, "run", fail)
    assert game.process_running() is None

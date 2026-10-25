"""Where data.db lives, chosen in the app, and the move to another folder.

The database cannot change place while the app runs: every worker opens it by path. The choice is
written to `location.json` in the standard folder (%LOCALAPPDATA%\\EDExplorerKit), which never
moves, and the next start copies the database there (SQLite backup, checked), then deletes the
old files. A folder set at launch (--data-dir, EDEK_DATA_DIR) wins and cannot be changed here.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.config import parse_dir

log = logging.getLogger(__name__)

POINTER = "location.json"
DB_NAME = "data.db"
# What a database takes per byte of journal it was read from (measured 2026-10-25: 200 MB from
# 169 MB of journals), for the size expected before the first read is done.
DB_PER_JOURNAL_BYTE = 1.2
# Room to keep free on the new drive besides the database itself.
SPARE_BYTES = 100_000_000
# From this size on (bytes) the app asks before filling the standard folder, and later offers to
# move the database; below LOW_FREE_BYTES free on its drive it warns.
LARGE_DB_BYTES = 500_000_000
LOW_FREE_BYTES = 1_000_000_000
BIG_DATA_OK = "big_data_ok"  # meta key: "keep it in the standard folder" was chosen

Problem = Literal[
    "fixed", "same", "not_dir", "cannot_create", "not_writable", "has_data", "no_space"
]


@dataclass(slots=True)
class Choice:
    data_dir: Path  # where the database is to be
    move_from: Path | None  # where it is now, while the move waits for the next start


def read_choice(base: Path) -> Choice | None:
    try:
        raw = json.loads((base / POINTER).read_text(encoding="utf-8"))
        data_dir = Path(raw["data_dir"])
        move_from = Path(raw["move_from"]) if raw.get("move_from") else None
    except (OSError, ValueError, KeyError, TypeError):
        return None
    return Choice(data_dir, move_from)


def write_choice(base: Path, choice: Choice | None) -> None:
    """Stores the choice; None (or the standard folder with nothing to move) removes it."""
    path = base / POINTER
    if choice is None or (choice.data_dir == base and choice.move_from is None):
        path.unlink(missing_ok=True)
        return
    base.mkdir(parents=True, exist_ok=True)
    data = {"data_dir": str(choice.data_dir), "move_from": str(choice.move_from or "") or None}
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def _files(folder: Path) -> list[Path]:
    return [folder / DB_NAME, folder / f"{DB_NAME}-wal", folder / f"{DB_NAME}-shm"]


def move_database(source: Path, target: Path) -> bool:
    """Copies data.db from `source` to `target` and deletes the old files; True when done.
    Nothing is lost on failure: the old database stays and the new copy is removed."""
    old = source / DB_NAME
    new = target / DB_NAME
    if not old.is_file():
        return True  # nothing to move (a fresh install chose its folder first)
    tmp = target / f"{DB_NAME}.moving"
    try:
        target.mkdir(parents=True, exist_ok=True)
        tmp.unlink(missing_ok=True)
        src = sqlite3.connect(f"file:{old.as_posix()}?mode=ro", uri=True)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
            ok = dst.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        finally:
            dst.close()
            src.close()
        if not ok:
            raise OSError("the copy failed its check")
        os.replace(tmp, new)
    except (OSError, sqlite3.Error) as exc:
        log.error("could not move the database to %s: %s", target, exc)
        tmp.unlink(missing_ok=True)
        return False
    for path in _files(source):
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:  # in use by another copy of the app: it stays, unused
            log.warning("could not delete %s: %s", path, exc)
    log.info("database moved from %s to %s", source, target)
    return True


def resolve(base: Path) -> Path:
    """The data folder to open at start: the one chosen in the app (moving the database there
    first if the move waits), else the standard one."""
    choice = read_choice(base)
    if choice is None:
        return base
    if choice.move_from is not None:
        if move_database(choice.move_from, choice.data_dir):
            write_choice(base, Choice(choice.data_dir, None))
        else:
            write_choice(base, Choice(choice.move_from, None))
            return choice.move_from
    return choice.data_dir


def free_bytes(folder: Path) -> int | None:
    """Free space on the folder's drive (the nearest existing parent)."""
    for candidate in (folder, *folder.parents):
        if candidate.exists():
            try:
                return shutil.disk_usage(candidate).free
            except OSError:
                return None
    return None


def db_bytes(folder: Path) -> int:
    total = 0
    for path in _files(folder)[:2]:
        with contextlib.suppress(OSError):
            total += path.stat().st_size
    return total


def journal_bytes(journal_dir: Path) -> int:
    """All journal files of the folder (what the database will hold a copy of)."""
    try:
        return sum(p.stat().st_size for p in journal_dir.glob("Journal.*.log"))
    except OSError:
        return 0


def plan_move(base: Path, current: Path, text: str) -> tuple[Path | None, Problem | None]:
    """Checks a folder typed by the user and records the move for the next start. The folder
    is created if needed; it must be writable, hold no database already and have the room."""
    target = parse_dir(text)
    if not target.is_absolute():
        return None, "not_dir"
    if target.resolve() == current.resolve():
        return None, "same"
    if target.exists() and not target.is_dir():
        return None, "not_dir"
    try:
        target.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None, "cannot_create"
    probe = target / ".edk-write-test"
    try:
        probe.write_bytes(b"")
        probe.unlink()
    except OSError:
        return None, "not_writable"
    if (target / DB_NAME).exists():
        return None, "has_data"
    free = free_bytes(target)
    if free is not None and free < db_bytes(current) + SPARE_BYTES:
        return None, "no_space"
    write_choice(base, Choice(target, current))
    return target, None


def cancel_move(base: Path, current: Path) -> None:
    write_choice(base, Choice(current, None))


def pending_move(base: Path) -> Path | None:
    choice = read_choice(base)
    return choice.data_dir if choice and choice.move_from is not None else None

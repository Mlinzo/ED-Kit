"""Journal file discovery and tailing.

The game keeps the active journal open for the whole session, and NTFS does not reliably
report appends to watchers, so we poll: re-open the file, seek to the saved byte offset,
read to EOF and consume only complete lines. Offsets are persisted by the caller in the
same transaction as the events they produced.
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# Live Odyssey/Horizons journals only (Alpha/Beta builds are a separate galaxy).
# Covers both the current "Journal.2026-10-16T125906.01.log" and the old
# "Journal.220315152335.01.log" naming.
JOURNAL_PREFIX = "Journal."


def is_journal_name(name: str) -> bool:
    if not (name.startswith(JOURNAL_PREFIX) and name.endswith(".log")):
        return False
    middle = name[len(JOURNAL_PREFIX) : -len(".log")]
    stamp, _, part = middle.rpartition(".")
    return part.isdigit() and len(stamp) >= 12 and stamp.replace("-", "").replace("T", "").isdigit()


@dataclass(slots=True)
class JournalFile:
    id: int
    name: str
    path: Path
    header_ts: str | None
    gameversion: str | None
    byte_offset: int
    line_no: int

    @property
    def legacy(self) -> bool:
        """Horizons 3.x (Legacy galaxy) journals are ignored."""
        if not self.gameversion:
            return False
        major = self.gameversion.split(".", 1)[0]
        return major.isdigit() and int(major) < 4


@dataclass(slots=True)
class JournalLine:
    line_no: int
    event: dict[str, Any]
    raw: str


@dataclass(slots=True)
class ReadResult:
    lines: list[JournalLine]
    byte_offset: int
    line_no: int


def read_header(path: Path) -> dict[str, Any] | None:
    """First journal line if complete. {} when the first line is not a Fileheader."""
    try:
        with path.open("rb") as f:
            first = f.readline(65536)
    except OSError:
        return None
    if not first.endswith(b"\n"):
        return None
    try:
        ev = json.loads(first.decode("utf-8", "replace").lstrip("\x00").strip())
    except ValueError:
        return {}
    if not isinstance(ev, dict) or str(ev.get("event", "")).lower() != "fileheader":
        return {}
    return ev


def read_new_lines(file: JournalFile) -> ReadResult:
    """Complete lines appended since `file.byte_offset`."""
    try:
        with file.path.open("rb") as f:
            f.seek(file.byte_offset)
            data = f.read()
    except OSError as exc:
        log.warning("cannot read %s: %s", file.name, exc)
        return ReadResult([], file.byte_offset, file.line_no)

    end = data.rfind(b"\n")
    if end < 0:
        return ReadResult([], file.byte_offset, file.line_no)

    lines: list[JournalLine] = []
    line_no = file.line_no
    for chunk in data[: end + 1].split(b"\n")[:-1]:
        line_no += 1
        text = chunk.decode("utf-8", "replace").lstrip("\x00").strip()
        if not text:
            continue
        try:
            ev = json.loads(text)
        except ValueError:
            log.warning("bad journal line %s:%d", file.name, line_no)
            continue
        if isinstance(ev, dict) and "event" in ev:
            lines.append(JournalLine(line_no, ev, text))
    return ReadResult(lines, file.byte_offset + end + 1, line_no)


class JournalDirectory:
    """Registers journal files in SQLite and returns them in chronological order."""

    def __init__(self, journal_dir: Path, conn: sqlite3.Connection) -> None:
        self.dir = journal_dir
        self.conn = conn

    def discover(self) -> list[JournalFile]:
        if self.dir.is_dir():
            known = {row[0] for row in self.conn.execute("SELECT name FROM journal_files")}
            with os.scandir(self.dir) as entries:
                for entry in entries:
                    if entry.name in known or not is_journal_name(entry.name):
                        continue
                    header = read_header(Path(entry.path))
                    if header is None:
                        continue  # file just created; retry on the next scan
                    self.conn.execute(
                        "INSERT INTO journal_files(name, header_ts, part, gameversion) "
                        "VALUES(?, ?, ?, ?)",
                        (
                            entry.name,
                            header.get("timestamp"),
                            header.get("part"),
                            header.get("gameversion"),
                        ),
                    )
        rows = self.conn.execute(
            "SELECT id, name, header_ts, gameversion, byte_offset, line_no FROM journal_files"
        ).fetchall()
        files = [
            JournalFile(
                id=r["id"],
                name=r["name"],
                path=self.dir / r["name"],
                header_ts=r["header_ts"],
                gameversion=r["gameversion"],
                byte_offset=r["byte_offset"],
                line_no=r["line_no"],
            )
            for r in rows
        ]
        # Filenames use local time and changed format in 2022: order by header time.
        files.sort(key=lambda f: (f.header_ts or "", f.name))
        return files

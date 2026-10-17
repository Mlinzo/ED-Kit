"""Is the game running? The header shows it next to the server connection.

On Windows the process list says it (EliteDangerous64.exe: Odyssey and Horizons alike; the
launcher alone does not count). Where the list cannot be read, the journal does: a session
ends with a Shutdown event (a crash leaves none, so this fallback may say "running" after it).
"""

from __future__ import annotations

import subprocess
import sys

GAME_EXE = "EliteDangerous64.exe"
TIMEOUT_S = 5


def process_running() -> bool | None:
    """Whether the game process is running; None when the process list cannot be read."""
    if sys.platform != "win32":
        return None
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"IMAGENAME eq {GAME_EXE}", "/NH", "/FO", "CSV"],
            capture_output=True,
            timeout=TIMEOUT_S,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0:
        return None
    # A match lists the image name; "no tasks" is a localized message without it.
    return GAME_EXE.lower().encode() in out.stdout.lower()


def game_running(process: bool | None, last_event: str | None) -> bool | None:
    """The process list when known, else the journal's last event (None: nothing to go by)."""
    if process is not None:
        return process
    if last_event is None:
        return None
    return last_event != "Shutdown"

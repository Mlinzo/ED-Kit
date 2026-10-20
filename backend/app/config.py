from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

APP_DIR_NAME = "EDExplorerKit"
JOURNAL_SUBDIR = Path("Frontier Developments") / "Elite Dangerous"


def _saved_games_dir() -> Path:
    """Windows "Saved Games" known folder; falls back to ~/Saved Games."""
    if sys.platform == "win32":
        try:
            import ctypes
            import uuid
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [
                    ("Data1", wintypes.DWORD),
                    ("Data2", wintypes.WORD),
                    ("Data3", wintypes.WORD),
                    ("Data4", wintypes.BYTE * 8),
                ]

            # FOLDERID_SavedGames
            raw = uuid.UUID("{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}").bytes_le
            guid = GUID.from_buffer_copy(raw)
            path_ptr = ctypes.c_wchar_p()
            shell32 = ctypes.windll.shell32
            status = shell32.SHGetKnownFolderPath(
                ctypes.byref(guid), 0, None, ctypes.byref(path_ptr)
            )
            if status == 0:
                result = Path(path_ptr.value)
                ctypes.windll.ole32.CoTaskMemFree(path_ptr)
                return result
        except Exception:  # noqa: BLE001 - any failure falls back to the default location
            pass
    return Path.home() / "Saved Games"


def standard_journal_dir() -> Path:
    """Where the game writes its journal on this computer."""
    return _saved_games_dir() / JOURNAL_SUBDIR


def default_journal_dir() -> Path:
    env = os.environ.get("EDEK_JOURNAL_DIR")
    return Path(env) if env else standard_journal_dir()


def parse_dir(text: str) -> Path:
    """A folder typed or pasted by the user: Explorer's "Copy as path" quotes, %VARS%, ~."""
    cleaned = text.strip().strip('"').strip("'").strip()
    return Path(os.path.expanduser(os.path.expandvars(cleaned)))


def default_data_dir() -> Path:
    env = os.environ.get("EDEK_DATA_DIR")
    if env:
        return Path(env)
    base = os.environ.get("LOCALAPPDATA")
    return (Path(base) if base else Path.home() / ".local" / "share") / APP_DIR_NAME


def default_static_dir() -> Path | None:
    """Built frontend (frontend/dist) next to the backend, or bundled with a frozen exe."""
    if getattr(sys, "frozen", False):
        candidate = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent)) / "web"
    else:
        candidate = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    return candidate if (candidate / "index.html").is_file() else None


@dataclass(slots=True)
class Settings:
    journal_dir: Path = field(default_factory=default_journal_dir)
    # Set at launch (--journal-dir or EDEK_JOURNAL_DIR): the folder chosen in the app is ignored.
    journal_dir_fixed: bool = field(
        default_factory=lambda: bool(os.environ.get("EDEK_JOURNAL_DIR"))
    )
    data_dir: Path = field(default_factory=default_data_dir)
    static_dir: Path | None = field(default_factory=default_static_dir)
    port: int = 8765
    lan: bool = True  # phones on the same network can open the page (off: --local)
    bind: str | None = None  # explicit listen address (Docker: 0.0.0.0); overrides `lan`
    online: bool = True  # Spansh / EDSM requests and the EDDN listener (off with --offline)
    poll_interval: float = 0.25  # seconds between journal/status reads
    rescan_interval: float = 2.0  # seconds between journal directory listings

    @property
    def host(self) -> str:
        if self.bind:
            return self.bind
        return "0.0.0.0" if self.lan else "127.0.0.1"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "data.db"

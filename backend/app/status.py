"""Status.json reader. The game rewrites the whole file, so reads can be empty or partial:
such reads are ignored and retried on the next poll."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.schemas import LiveStatus

FLAG_DOCKED = 1 << 0
FLAG_LANDED = 1 << 1
FLAG_SUPERCRUISE = 1 << 4
FLAG_HAS_LAT_LONG = 1 << 21
FLAG_IN_MAIN_SHIP = 1 << 24
FLAG_IN_FIGHTER = 1 << 25
FLAG_IN_SRV = 1 << 26

FLAG2_ON_FOOT = 1 << 0


def decode_status(data: dict[str, Any]) -> LiveStatus:
    flags = int(data.get("Flags") or 0)
    flags2 = int(data.get("Flags2") or 0)
    has_lat_long = bool(flags & FLAG_HAS_LAT_LONG) and "Latitude" in data
    fuel = data.get("Fuel") if isinstance(data.get("Fuel"), dict) else {}
    fuel_main = fuel.get("FuelMain")
    target = data.get("Destination") if isinstance(data.get("Destination"), dict) else {}
    target_system, target_body = target.get("System"), target.get("Body")
    return LiveStatus(
        timestamp=data.get("timestamp"),
        flags=flags,
        flags2=flags2,
        docked=bool(flags & FLAG_DOCKED),
        landed=bool(flags & FLAG_LANDED),
        supercruise=bool(flags & FLAG_SUPERCRUISE),
        in_ship=bool(flags & FLAG_IN_MAIN_SHIP),
        in_srv=bool(flags & FLAG_IN_SRV),
        on_foot=bool(flags2 & FLAG2_ON_FOOT),
        has_lat_long=has_lat_long,
        lat=data.get("Latitude") if has_lat_long else None,
        lon=data.get("Longitude") if has_lat_long else None,
        heading=data.get("Heading") if has_lat_long else None,
        altitude=data.get("Altitude") if has_lat_long else None,
        planet_radius_m=data.get("PlanetRadius") if has_lat_long else None,
        body_name=data.get("BodyName"),
        fuel_main=float(fuel_main) if isinstance(fuel_main, int | float) else None,
        destination_system=str(target_system) if isinstance(target_system, int) else None,
        destination_body=target_body if isinstance(target_body, int) else None,
    )


class StatusReader:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._signature: tuple[int, int] | None = None
        self.current: LiveStatus = LiveStatus()

    def poll(self) -> LiveStatus | None:
        """New decoded status if the file changed since the last successful read."""
        try:
            stat = self.path.stat()
            signature = (stat.st_mtime_ns, stat.st_size)
            if signature == self._signature:
                return None
            text = self.path.read_text(encoding="utf-8").strip()
        except OSError:
            return None
        if not text:
            return None
        try:
            data = json.loads(text)
        except ValueError:
            return None
        if not isinstance(data, dict):
            return None
        self._signature = signature
        status = decode_status(data)
        if status == self.current:
            return None
        self.current = status
        return status

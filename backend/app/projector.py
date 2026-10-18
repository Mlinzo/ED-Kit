"""Applies journal events to the projection tables.

Runs on the ingest thread only (single writer), inside the caller's transaction.
`apply()` returns the view topics that the event may have changed.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections.abc import Callable
from typing import Any

from app import exobio
from app.db import get_meta, set_meta
from app.facts import body_facts_from_scan, facts_from_json, facts_to_json, merge_facts
from app.values import estimate_body_value

log = logging.getLogger(__name__)

# Bump whenever projection logic changes: projections are then rebuilt from `events`.
VERSION = 12

ALL_TOPICS = frozenset({"system", "surface", "session"})

# Events never stored or projected (noise, or private chat).
SKIP_EVENTS = frozenset(
    {"Music", "ReceiveText", "SendText", "ShipTargeted", "ReservoirReplenished", "NpcCrewPaidWage"}
)

SIGNAL_KINDS = {
    "$SAA_SignalType_Biological;": "bio",
    "$SAA_SignalType_Geological;": "geo",
    "$SAA_SignalType_Human;": "human",
}

# (event timestamp) -> (lat, lon) of the commander when the event happened, if known live.
PositionProvider = Callable[[str], tuple[float, float] | None]


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def fsd_key(fsd: dict[str, Any] | None, modules: list[dict[str, Any]]) -> str | None:
    """What the fuel a jump burns depends on: the drive, its engineered optimal mass and an
    FSD booster. A new key starts a new fuel curve (app.fuel)."""
    if not fsd or not fsd.get("Item"):
        return None
    optimal = ""
    for mod in (fsd.get("Engineering") or {}).get("Modifiers") or []:
        if isinstance(mod, dict) and mod.get("Label") == "FSDOptimalMass":
            optimal = f"{float(mod.get('Value') or 0):.1f}"
    booster = next(
        (str(m["Item"]).lower() for m in modules if "guardianfsdbooster" in str(m.get("Item", ""))),
        "",
    )
    return f"{str(fsd['Item']).lower()}|{optimal}|{booster}"


class Projector:
    def __init__(self, conn: sqlite3.Connection, position: PositionProvider | None = None) -> None:
        self.conn = conn
        self.position = position
        self.fid: str | None = get_meta(conn, "active_fid")
        self.handlers: dict[str, Callable[[dict[str, Any], int], frozenset[str]]] = {
            "Commander": self._commander,
            "NewCommander": self._commander,
            "LoadGame": self._load_game,
            "Loadout": self._loadout,
            "Location": self._location,
            "FSDJump": self._jump,
            "CarrierJump": self._jump,
            "FuelScoop": self._fuel_scoop,
            "RefuelAll": self._refuel,
            "RefuelPartial": self._refuel,
            "Cargo": self._cargo,
            "FSSDiscoveryScan": self._honk,
            "FSSAllBodiesFound": self._all_found,
            "Scan": self._scan,
            "ScanBaryCentre": self._barycentre,
            "FSSBodySignals": self._signals,
            "SAASignalsFound": self._signals,
            "SAAScanComplete": self._mapped,
            "CodexEntry": self._codex,
            "ApproachBody": self._approach_body,
            "Touchdown": self._approach_body,
            "LeaveBody": self._leave_body,
            "Disembark": self._disembark,
            "Embark": self._embark,
            "LaunchSRV": self._launch_srv,
            "DockSRV": self._dock_srv,
            "ScanOrganic": self._scan_organic,
            "SellOrganicData": self._sell_organic,
            "MultiSellExplorationData": self._sell_carto,
            "SellExplorationData": self._sell_carto,
            "Died": self._died,
            "EngineerProgress": self._engineers,
            "Resurrect": self._resurrect,
        }

    def apply(self, ev: dict[str, Any], event_id: int) -> frozenset[str]:
        handler = self.handlers.get(str(ev.get("event")))
        if handler is None:
            return frozenset()
        return handler(ev, event_id)

    # ------------------------------------------------------------------ helpers

    def _ensure_state(self) -> None:
        if self.fid:
            self.conn.execute("INSERT OR IGNORE INTO cmdr_state(fid) VALUES(?)", (self.fid,))

    def _state(self) -> sqlite3.Row | None:
        if not self.fid:
            return None
        return self.conn.execute("SELECT * FROM cmdr_state WHERE fid = ?", (self.fid,)).fetchone()

    def _update_state(self, **values: Any) -> None:
        if not self.fid:
            return
        self._ensure_state()
        cols = ", ".join(f"{k} = ?" for k in values)
        self.conn.execute(
            f"UPDATE cmdr_state SET {cols} WHERE fid = ?", (*values.values(), self.fid)
        )

    def _upsert_system(self, ev: dict[str, Any]) -> int | None:
        address = ev.get("SystemAddress")
        name = ev.get("StarSystem") or ev.get("SystemName")
        if address is None or not name:
            return None
        pos = ev.get("StarPos") or [None, None, None]
        self.conn.execute(
            "INSERT INTO systems(address, name, x, y, z, population) VALUES(?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(address) DO UPDATE SET name = excluded.name, "
            "x = COALESCE(excluded.x, x), y = COALESCE(excluded.y, y), "
            "z = COALESCE(excluded.z, z), "
            "population = COALESCE(excluded.population, population)",
            (int(address), str(name), pos[0], pos[1], pos[2], ev.get("Population")),
        )
        return int(address)

    def _arrive(self, address: int, ts: Any, how: str) -> None:
        """Record a visit when the commander shows up in another system than before."""
        if not self.fid:
            return
        state = self._state()
        if state is not None and state["system_address"] == address:
            return
        self.conn.execute(
            "INSERT INTO visits(fid, ts, system_address, how) VALUES(?, ?, ?, ?)",
            (self.fid, ts, address, how),
        )

    def _first_footfall(self, system_address: int, body_id: int) -> bool:
        """Whether a first-footfall bonus applies: nobody walked here, system unpopulated."""
        row = self.conn.execute(
            "SELECT b.facts, s.population FROM bodies b "
            "LEFT JOIN systems s ON s.address = b.system_address "
            "WHERE b.system_address = ? AND b.body_id = ?",
            (system_address, body_id),
        ).fetchone()
        if row is None or row["population"]:
            return False
        return facts_from_json(row["facts"]).was_footfalled is False

    # ------------------------------------------------------------------ commander

    def _commander(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        fid = ev.get("FID")
        name = ev.get("Name") or ev.get("Commander")
        if not fid or not name:
            return frozenset()
        self.fid = str(fid)
        set_meta(self.conn, "active_fid", self.fid)
        self.conn.execute(
            "INSERT INTO commanders(fid, name, last_seen) VALUES(?, ?, ?) "
            "ON CONFLICT(fid) DO UPDATE SET name = excluded.name, last_seen = excluded.last_seen",
            (self.fid, str(name), ev.get("timestamp")),
        )
        self._ensure_state()
        return ALL_TOPICS

    def _load_game(self, ev: dict[str, Any], event_id: int) -> frozenset[str]:
        topics = self._commander(ev, event_id)
        if self.fid:
            # On the game menu the commander is not "on foot" anywhere.
            self._update_state(odyssey=1 if ev.get("Odyssey") else 0, on_foot=0, in_srv=0)
        return topics

    def _loadout(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        modules = [m for m in ev.get("Modules") or [] if isinstance(m, dict)]
        fsd = next((m for m in modules if m.get("Slot") == "FrameShiftDrive"), None)
        capacity = (ev.get("FuelCapacity") or {}).get("Main")
        jump_range = ev.get("MaxJumpRange")
        scoop = any(str(m.get("Item", "")).startswith("int_fuelscoop") for m in modules)
        values: dict[str, Any] = {
            "ship_id": ev.get("ShipID"),
            "fsd_item": str(fsd["Item"]).lower() if fsd and fsd.get("Item") else None,
            "fsd_key": fsd_key(fsd, modules),
            "unladen_mass": _number(ev.get("UnladenMass")),
            "fuel_capacity": _number(capacity),
            "has_scoop": int(scoop),
        }
        if isinstance(jump_range, int | float) and jump_range > 0:
            values["jump_range"] = float(jump_range)
        self._update_state(**values)
        return frozenset({"route", "navroute"})

    def _fuel_scoop(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        total = _number(ev.get("Total"))
        if total is None:
            return frozenset()
        self._update_state(fuel_level=total)
        return frozenset({"navroute"})

    def _refuel(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        state = self._state()
        if state is None:
            return frozenset()
        capacity = state["fuel_capacity"]
        if ev.get("event") == "RefuelAll":
            level = capacity
        else:
            level = (state["fuel_level"] or 0.0) + (_number(ev.get("Amount")) or 0.0)
            if capacity is not None:
                level = min(level, capacity)
        if level is None:
            return frozenset()
        self._update_state(fuel_level=level)
        return frozenset({"navroute"})

    def _cargo(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        count = ev.get("Count")
        if ev.get("Vessel", "Ship") != "Ship" or not isinstance(count, int | float):
            return frozenset()
        self._update_state(cargo=float(count))
        return frozenset({"navroute"})

    # ------------------------------------------------------------------ travel

    def _location(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address = self._upsert_system(ev)
        if address is None:
            return frozenset()
        on_planet = ev.get("BodyType") == "Planet"
        self._arrive(address, ev.get("timestamp"), "location")
        self._update_state(
            system_address=address,
            body_id=ev.get("BodyID") if on_planet else None,
            body_name=ev.get("Body") if on_planet else None,
        )
        return ALL_TOPICS

    def _jump(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address = self._upsert_system(ev)
        if address is None:
            return frozenset()
        how = "carrier" if ev.get("event") == "CarrierJump" else "jump"
        self._arrive(address, ev.get("timestamp"), how)
        self._update_state(system_address=address, body_id=None, body_name=None)
        if self.fid and ev.get("event") == "FSDJump":
            self.conn.execute(
                "INSERT INTO jumps(fid, ts, system_address, distance_ly) VALUES(?, ?, ?, ?)",
                (self.fid, ev.get("timestamp"), address, float(ev.get("JumpDist") or 0.0)),
            )
            self._jump_fuel(ev)
        return ALL_TOPICS

    def _jump_fuel(self, ev: dict[str, Any]) -> None:
        """Fuel left after a jump, and what the jump burnt (the drive's fuel curve)."""
        level, used, distance = (
            _number(ev.get("FuelLevel")),
            _number(ev.get("FuelUsed")),
            _number(ev.get("JumpDist")),
        )
        if level is None:
            return
        state = self._state()
        self._update_state(fuel_level=level)
        if state is None or not state["fsd_key"] or state["unladen_mass"] is None:
            return
        if not used or not distance:
            return
        mass = state["unladen_mass"] + level + used + (state["cargo"] or 0.0)
        self.conn.execute(
            "INSERT INTO fuel_jumps(fid, ship_id, fsd_key, distance_ly, fuel_used, mass, boosted) "
            "VALUES(?, ?, ?, ?, ?, ?, ?)",
            (
                self.fid,
                state["ship_id"],
                state["fsd_key"],
                distance,
                used,
                mass,
                int(bool(ev.get("BoostUsed"))),
            ),
        )

    def _approach_body(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if ev.get("BodyID") is None:
            return frozenset()
        self._update_state(body_id=ev.get("BodyID"), body_name=ev.get("Body"))
        return frozenset({"system", "surface"})

    def _leave_body(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        self._update_state(body_id=None, body_name=None)
        return frozenset({"system", "surface"})

    def _disembark(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        self._update_state(on_foot=1, in_srv=0)
        address, body_id = ev.get("SystemAddress"), ev.get("BodyID")
        if ev.get("OnPlanet") and self.fid and address is not None and body_id is not None:
            # First footfall is never available in populated systems, although the journal
            # still says WasFootfalled: false there.
            row = self.conn.execute(
                "SELECT b.facts, s.population FROM bodies b "
                "LEFT JOIN systems s ON s.address = b.system_address "
                "WHERE b.system_address = ? AND b.body_id = ?",
                (address, body_id),
            ).fetchone()
            if (
                row is not None
                and not row["population"]
                and facts_from_json(row["facts"]).was_footfalled is False
            ):
                self.conn.execute(
                    "UPDATE body_cmdr SET footfall_at = COALESCE(footfall_at, ?) "
                    "WHERE fid = ? AND system_address = ? AND body_id = ?",
                    (ev.get("timestamp"), self.fid, address, body_id),
                )
        return frozenset({"surface"})

    def _embark(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        self._update_state(on_foot=0, in_srv=1 if ev.get("SRV") else 0)
        return frozenset({"surface"})

    def _launch_srv(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if ev.get("PlayerControlled", True):
            self._update_state(in_srv=1, on_foot=0)
        return frozenset({"surface"})

    def _dock_srv(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        self._update_state(in_srv=0)
        return frozenset({"surface"})

    # ------------------------------------------------------------------ system scanning

    def _honk(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address = self._upsert_system(ev)
        if address is None:
            return frozenset()
        self.conn.execute(
            "UPDATE systems SET body_count = ?, non_body_count = ? WHERE address = ?",
            (ev.get("BodyCount"), ev.get("NonBodyCount"), address),
        )
        return frozenset({"system"})

    def _all_found(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address = self._upsert_system(ev)
        if address is None:
            return frozenset()
        self.conn.execute("UPDATE systems SET all_found = 1 WHERE address = ?", (address,))
        return frozenset({"system"})

    def _scan(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        facts = body_facts_from_scan(ev)
        if facts is None:
            return frozenset()
        self._upsert_system(ev)
        row = self.conn.execute(
            "SELECT facts FROM bodies WHERE system_address = ? AND body_id = ?",
            (facts.system_address, facts.body_id),
        ).fetchone()
        if row is not None:
            facts = merge_facts(facts_from_json(row["facts"]), facts)
        self.conn.execute(
            "INSERT INTO bodies(system_address, body_id, name, kind, facts) VALUES(?, ?, ?, ?, ?) "
            "ON CONFLICT(system_address, body_id) DO UPDATE SET "
            "name = excluded.name, kind = excluded.kind, facts = excluded.facts",
            (facts.system_address, facts.body_id, facts.name, facts.kind, facts_to_json(facts)),
        )
        if self.fid:
            # A body whose data was lost on death becomes sellable again once re-scanned.
            self.conn.execute(
                "INSERT INTO body_cmdr(fid, system_address, body_id, scanned_at) "
                "VALUES(?, ?, ?, ?) "
                "ON CONFLICT(fid, system_address, body_id) DO UPDATE SET "
                "scanned_at = CASE WHEN carto = 'lost' "
                "THEN excluded.scanned_at ELSE scanned_at END, "
                "carto = CASE WHEN carto = 'lost' THEN 'unsold' ELSE carto END",
                (self.fid, facts.system_address, facts.body_id, ev.get("timestamp")),
            )
        return ALL_TOPICS

    def _barycentre(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address, body_id = ev.get("SystemAddress"), ev.get("BodyID")
        if address is None or body_id is None:
            return frozenset()
        self._upsert_system(ev)
        orbit = {
            "epoch": ev.get("timestamp"),
            "semi_major_axis_m": ev.get("SemiMajorAxis"),
            "eccentricity": ev.get("Eccentricity"),
            "orbital_inclination": ev.get("OrbitalInclination"),
            "periapsis": ev.get("Periapsis"),
            "ascending_node": ev.get("AscendingNode"),
            "mean_anomaly": ev.get("MeanAnomaly"),
            "orbital_period_s": ev.get("OrbitalPeriod"),
        }
        self.conn.execute(
            "INSERT OR REPLACE INTO barycentres(system_address, body_id, orbit) VALUES(?, ?, ?)",
            (address, body_id, json.dumps(orbit)),
        )
        return frozenset({"system"})

    def _signals(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address, body_id = ev.get("SystemAddress"), ev.get("BodyID")
        if address is None or body_id is None:
            return frozenset()
        counts: dict[str, int] = {}
        for signal in ev.get("Signals") or []:
            kind = SIGNAL_KINDS.get(str(signal.get("Type")), "other")
            counts[kind] = counts.get(kind, 0) + int(signal.get("Count") or 0)
        self.conn.execute(
            "DELETE FROM body_signals WHERE system_address = ? AND body_id = ?", (address, body_id)
        )
        self.conn.executemany(
            "INSERT INTO body_signals(system_address, body_id, kind, count) VALUES(?, ?, ?, ?)",
            [(address, body_id, kind, count) for kind, count in counts.items()],
        )
        if ev.get("event") == "SAASignalsFound":
            self.conn.execute(
                "DELETE FROM body_genuses WHERE system_address = ? AND body_id = ?",
                (address, body_id),
            )
            self.conn.executemany(
                "INSERT OR IGNORE INTO body_genuses(system_address, body_id, genus) "
                "VALUES(?, ?, ?)",
                [
                    (address, body_id, str(g["Genus"]))
                    for g in ev.get("Genuses") or []
                    if "Genus" in g
                ],
            )
        return frozenset({"system", "surface"})

    def _mapped(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        address, body_id = ev.get("SystemAddress"), ev.get("BodyID")
        if address is None or body_id is None or not self.fid:
            return frozenset()
        probes, target = ev.get("ProbesUsed"), ev.get("EfficiencyTarget")
        efficient = int(probes is not None and target is not None and probes <= target)
        self.conn.execute(
            "INSERT INTO body_cmdr(fid, system_address, body_id, mapped_at, efficient) "
            "VALUES(?, ?, ?, ?, ?) ON CONFLICT(fid, system_address, body_id) DO UPDATE SET "
            "mapped_at = excluded.mapped_at, efficient = excluded.efficient, "
            "carto = CASE WHEN carto = 'lost' THEN 'unsold' ELSE carto END",
            (self.fid, address, body_id, ev.get("timestamp"), efficient),
        )
        return ALL_TOPICS

    def _codex(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        # The symbol ("$Codex_RegionName_18;") does not depend on the game language.
        region = ev.get("Region")
        address = ev.get("SystemAddress")
        if region and address is not None:
            self.conn.execute(
                "UPDATE systems SET region = ? WHERE address = ?", (str(region), address)
            )
        name = ev.get("Name")
        if not self.fid or not name:
            return frozenset()
        species = exobio.get_species(str(name))
        self.conn.execute(
            "INSERT INTO codex_entries(fid, ts, entry_id, name, species, category, region, "
            "system_address, body_id) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                self.fid,
                ev.get("timestamp"),
                ev.get("EntryID"),
                str(name),
                species.species if species else None,
                ev.get("Category"),
                region,
                address,
                ev.get("BodyID"),
            ),
        )
        return frozenset({"system", "surface"})

    def _engineers(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        # At login, every engineer you know; later, one at a time as you progress.
        entries = ev.get("Engineers") if isinstance(ev.get("Engineers"), list) else [ev]
        if not self.fid:
            return frozenset()
        for e in entries:
            if not isinstance(e, dict) or not e.get("Engineer"):
                continue
            self.conn.execute(
                "INSERT INTO engineers(fid, engineer, engineer_id, progress, rank, at) "
                "VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(fid, engineer) DO UPDATE SET "
                "engineer_id = excluded.engineer_id, progress = excluded.progress, "
                "rank = COALESCE(excluded.rank, engineers.rank), at = excluded.at",
                (
                    self.fid,
                    str(e["Engineer"]),
                    e.get("EngineerID"),
                    e.get("Progress"),
                    e.get("Rank"),
                    ev.get("timestamp"),
                ),
            )
        return frozenset({"galaxy"})

    # ------------------------------------------------------------------ exobiology

    def _scan_organic(self, ev: dict[str, Any], event_id: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        address, body_id = ev.get("SystemAddress"), ev.get("Body")
        species, genus = ev.get("Species"), ev.get("Genus")
        scan_type = ev.get("ScanType")
        if address is None or body_id is None or not species or not genus:
            return frozenset()
        ts = str(ev.get("timestamp"))
        active = self.conn.execute(
            "SELECT * FROM organic_scans WHERE fid = ? AND status = 'sampling' "
            "ORDER BY id DESC LIMIT 1",
            (self.fid,),
        ).fetchone()
        same = (
            active is not None
            and active["species"] == species
            and active["system_address"] == address
            and active["body_id"] == body_id
        )

        if scan_type == "Log" or (not same and scan_type == "Sample"):
            if active is not None:
                # Logging another species discards the unfinished one.
                self.conn.execute(
                    "UPDATE organic_scans SET status = 'abandoned', updated_at = ? WHERE id = ?",
                    (ts, active["id"]),
                )
            samples = 1 if scan_type == "Log" else 2
            scan_id = self._new_organic_scan(ev, samples, ts)
            self._record_sample(scan_id, samples, event_id, ts)
        elif scan_type == "Sample":
            samples = min(active["samples"] + 1, 3)
            self.conn.execute(
                "UPDATE organic_scans SET samples = ?, updated_at = ? WHERE id = ?",
                (samples, ts, active["id"]),
            )
            self._record_sample(active["id"], samples, event_id, ts)
        elif scan_type == "Analyse":
            scan_id = active["id"] if same else self._new_organic_scan(ev, 3, ts)
            row = self.conn.execute(
                "SELECT first_footfall FROM organic_scans WHERE id = ?", (scan_id,)
            ).fetchone()
            catalog = exobio.get_species(str(species))
            value = catalog.base_value if catalog else None
            bonus = (
                value * (exobio.FIRST_FOOTFALL_MULTIPLIER - 1)
                if value is not None and row["first_footfall"]
                else 0
            )
            self.conn.execute(
                "UPDATE organic_scans SET samples = 3, status = 'analysed', sale = 'unsold', "
                "value = ?, bonus = ?, updated_at = ? WHERE id = ?",
                (value, bonus, ts, scan_id),
            )
        return ALL_TOPICS

    def _new_organic_scan(self, ev: dict[str, Any], samples: int, ts: str) -> int:
        address, body_id = int(ev["SystemAddress"]), int(ev["Body"])
        first_footfall = self._first_footfall(address, body_id)
        cur = self.conn.execute(
            "INSERT INTO organic_scans(fid, system_address, body_id, genus, species, species_name, "
            "variant, samples, status, first_footfall, started_at, updated_at) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'sampling', ?, ?, ?)",
            (
                self.fid,
                address,
                body_id,
                str(ev["Genus"]),
                str(ev["Species"]),
                ev.get("Species_Localised"),
                ev.get("Variant"),
                samples,
                int(first_footfall),
                ts,
                ts,
            ),
        )
        return int(cur.lastrowid)

    def _record_sample(self, scan_id: int, n: int, event_id: int, ts: str) -> None:
        pos = self.conn.execute(
            "SELECT lat, lon FROM sample_positions WHERE event_id = ?", (event_id,)
        ).fetchone()
        if pos is not None:
            lat, lon = pos["lat"], pos["lon"]
        else:
            live = self.position(ts) if self.position else None
            if live is None:
                return
            lat, lon = live
            self.conn.execute(
                "INSERT OR REPLACE INTO sample_positions(event_id, lat, lon) VALUES(?, ?, ?)",
                (event_id, lat, lon),
            )
        self.conn.execute(
            "INSERT OR REPLACE INTO organic_samples(scan_id, n, lat, lon) VALUES(?, ?, ?, ?)",
            (scan_id, n, lat, lon),
        )

    # ------------------------------------------------------------------ selling and dying

    def _sell_organic(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        base = bonus = 0
        for item in ev.get("BioData") or []:
            value, item_bonus = int(item.get("Value") or 0), int(item.get("Bonus") or 0)
            base += value
            bonus += item_bonus
            match = self.conn.execute(
                "SELECT id FROM organic_scans WHERE fid = ? AND species = ? "
                "AND status = 'analysed' AND sale = 'unsold' ORDER BY id LIMIT 1",
                (self.fid, item.get("Species")),
            ).fetchone()
            if match is not None:
                self.conn.execute(
                    "UPDATE organic_scans SET sale = 'sold', value = ?, bonus = ? WHERE id = ?",
                    (value, item_bonus, match["id"]),
                )
        self._record_sale("bio", ev, base, bonus, base + bonus)
        return frozenset({"session", "system", "surface"})

    def _sell_carto(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        if ev.get("event") == "MultiSellExplorationData":
            names = [d.get("SystemName") for d in ev.get("Discovered") or []]
        else:
            names = list(ev.get("Systems") or [])
        names = [n for n in names if n]
        if names:
            marks = ",".join("?" * len(names))
            self.conn.execute(
                "UPDATE body_cmdr SET carto = 'sold' WHERE fid = ? AND carto = 'unsold' "
                f"AND system_address IN (SELECT address FROM systems WHERE name IN ({marks}))",
                (self.fid, *names),
            )
        base, bonus = int(ev.get("BaseValue") or 0), int(ev.get("Bonus") or 0)
        self._record_sale("carto", ev, base, bonus, int(ev.get("TotalEarnings") or base + bonus))
        return frozenset({"session", "system"})

    def _record_sale(
        self, kind: str, ev: dict[str, Any], base: int, bonus: int, total: int
    ) -> None:
        self.conn.execute(
            "INSERT INTO sales(fid, kind, ts, base, bonus, total) VALUES(?, ?, ?, ?, ?, ?)",
            (self.fid, kind, ev.get("timestamp"), base, bonus, total),
        )

    def _record_death(self, ev: dict[str, Any], state: sqlite3.Row | None, on_foot: bool) -> None:
        """Death history entry with what was lost (computed before the data is marked lost)."""
        bio_count = bio_value = 0
        for scan in self.conn.execute(
            "SELECT species, value, bonus FROM organic_scans "
            "WHERE fid = ? AND status = 'analysed' AND sale = 'unsold'",
            (self.fid,),
        ):
            value = scan["value"]
            if value is None:
                species = exobio.get_species(scan["species"])
                value = species.base_value if species else 0
            bio_count += 1
            bio_value += value + (scan["bonus"] or 0)
        carto_bodies = carto_value = 0
        if not on_foot:
            for row in self.conn.execute(
                "SELECT bc.mapped_at, bc.efficient, b.facts FROM body_cmdr bc JOIN bodies b "
                "ON b.system_address = bc.system_address AND b.body_id = bc.body_id "
                "WHERE bc.fid = ? AND bc.carto = 'unsold'",
                (self.fid,),
            ):
                facts = facts_from_json(row["facts"])
                value = estimate_body_value(
                    facts,
                    odyssey=bool(state and state["odyssey"]),
                    efficient=not row["mapped_at"] or bool(row["efficient"]),
                )
                carto_bodies += 1
                mapped = row["mapped_at"] and facts.kind == "planet"
                carto_value += value.dss if mapped else value.fss
        killers = [
            {
                "name": k.get("Name_Localised") or k.get("Name"),
                "ship": k.get("Ship"),
                "rank": k.get("Rank"),
            }
            for k in ev.get("Killers") or []
            if isinstance(k, dict)
        ]
        if not killers and (ev.get("KillerName") or ev.get("KillerShip")):
            killers = [
                {
                    "name": ev.get("KillerName_Localised") or ev.get("KillerName"),
                    "ship": ev.get("KillerShip"),
                    "rank": ev.get("KillerRank"),
                }
            ]
        context = "on_foot" if on_foot else ("srv" if state and state["in_srv"] else "ship")
        self.conn.execute(
            "INSERT INTO deaths(fid, ts, system_address, body_name, context, killers, "
            "lost_bio_count, lost_bio_value, lost_carto_bodies, lost_carto_value) "
            "VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                self.fid,
                ev.get("timestamp"),
                state["system_address"] if state else None,
                state["body_name"] if state else None,
                context,
                json.dumps(killers),
                bio_count,
                bio_value,
                carto_bodies,
                carto_value,
            ),
        )

    def _resurrect(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        self.conn.execute(
            "UPDATE deaths SET rebuy_option = ?, rebuy_cost = ? WHERE id = "
            "(SELECT MAX(id) FROM deaths WHERE fid = ?)",
            (ev.get("Option"), ev.get("Cost"), self.fid),
        )
        return frozenset({"session"})

    def _died(self, ev: dict[str, Any], _: int) -> frozenset[str]:
        if not self.fid:
            return frozenset()
        state = self._state()
        on_foot = bool(state and state["on_foot"])
        ts = ev.get("timestamp")
        self._record_death(ev, state, on_foot)
        # Exobiology data is lost on any death (player reports; Frontier does not document it).
        self.conn.execute(
            "UPDATE organic_scans SET sale = 'lost', updated_at = ? "
            "WHERE fid = ? AND status = 'analysed' AND sale = 'unsold'",
            (ts, self.fid),
        )
        self.conn.execute(
            "UPDATE organic_scans SET status = 'abandoned', updated_at = ? "
            "WHERE fid = ? AND status = 'sampling'",
            (ts, self.fid),
        )
        # Cartographic data lives on the ship: it survives an on-foot death.
        # SRV deaths are treated as ship deaths (unverified, pessimistic).
        if not on_foot:
            self.conn.execute(
                "UPDATE body_cmdr SET carto = 'lost', mapped_at = NULL, efficient = 0 "
                "WHERE fid = ? AND carto = 'unsold'",
                (self.fid,),
            )
        self._update_state(on_foot=0, in_srv=0, body_id=None, body_name=None)
        log.info("death at %s: unsold data marked lost (on_foot=%s)", ts, on_foot)
        return ALL_TOPICS

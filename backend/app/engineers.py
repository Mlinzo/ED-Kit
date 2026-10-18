"""Where the engineers are, and how far you are with each.

The list is the game's: 25 ship engineers (Horizons, 5 of them near Colonia) and 13 suit and
weapon engineers (Odyssey, 4 near Colonia). Each base was checked against EDSM's station list
for its system on 2026-10-18; the coordinates and SystemAddress are EDSM's. Your standing comes
from the journal (`EngineerProgress`, projected into the `engineers` table).
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Literal

from app.schemas import GalaxyEngineerView

Kind = Literal["ship", "suit"]


@dataclass(frozen=True, slots=True)
class Engineer:
    name: str  # as the journal writes it
    system: str
    address: int  # SystemAddress
    base: str
    kind: Kind  # ship modules, or suits and weapons on foot
    x: float
    y: float
    z: float


ENGINEERS: tuple[Engineer, ...] = (
    Engineer(
        "Felicity Farseer",
        "Deciat",
        6681123623626,
        "Farseer Inc",
        "ship",
        122.625,
        -0.8125,
        -47.28125,
    ),
    Engineer(
        "Elvira Martuuk",
        "Khun",
        3107241104074,
        "Long Sight Base",
        "ship",
        -171.59375,
        19.96875,
        -56.96875,
    ),
    Engineer(
        "The Dweller", "Wyrd", 5031654888146, "Black Hide", "ship", -11.625, 31.53125, -3.9375
    ),
    Engineer(
        "Liz Ryder",
        "Eurybia",
        1458309141194,
        "Demolition Unlimited",
        "ship",
        51.40625,
        -54.40625,
        -30.5,
    ),
    Engineer(
        "Tod 'The Blaster' McQuinn",
        "Wolf 397",
        3107576681170,
        "Trophy Camp",
        "ship",
        40,
        79.21875,
        -10.40625,
    ),
    Engineer(
        "Juri Ishmaak",
        "Giryak",
        4481899074282,
        "Pater's Memorial",
        "ship",
        14.6875,
        27.65625,
        108.65625,
    ),
    Engineer(
        "Zacariah Nemo",
        "Yoru",
        6131367744226,
        "Nemo Cyber Party Base",
        "ship",
        97.875,
        -86.90625,
        64.125,
    ),
    Engineer(
        "Lei Cheung",
        "Laksak",
        4305444669811,
        "Trader's Rest",
        "ship",
        -21.53125,
        -6.3125,
        116.03125,
    ),
    Engineer(
        "Hera Tani",
        "Kuwemaki",
        1733321102034,
        "The Jet's Hole",
        "ship",
        134.65625,
        -226.90625,
        -7.8125,
    ),
    Engineer(
        "Selene Jean",
        "Kuk",
        24859942069665,
        "Prospector's Rest",
        "ship",
        -21.28125,
        69.09375,
        -16.3125,
    ),
    Engineer(
        "Marco Qwent", "Sirius", 121569805492, "Qwent Research Base", "ship", 6.25, -1.28125, -5.75
    ),
    Engineer(
        "Ram Tah", "Meene", 3790082132323, "Phoenix Base", "ship", 118.78125, -56.4375, -97.1875
    ),
    Engineer(
        "Broo Tarquin",
        "Muang",
        4481966019282,
        "Broo's Legacy",
        "ship",
        17.03125,
        -172.78125,
        -3.46875,
    ),
    Engineer("Colonel Bris Dekker", "Sol", 10477373803, "Dekker's Yard", "ship", 0, 0, 0),
    Engineer(
        "Didi Vatermann", "Leesti", 3932277478114, "Vatermann LLC", "ship", 72.75, 48.75, 68.25
    ),
    Engineer(
        "Professor Palin", "Arque", 113573366131, "Abel Laboratory", "ship", 66.5, 38.0625, 61.125
    ),
    Engineer(
        "Lori Jameson",
        "Shinrarta Dezhra",
        3932277478106,
        "Jameson Base",
        "ship",
        55.71875,
        17.59375,
        27.15625,
    ),
    Engineer(
        "Tiana Fortune", "Achenar", 164098653, "Fortune's Loss", "ship", 67.5, -119.46875, 24.84375
    ),
    Engineer(
        "Bill Turner",
        "Alioth",
        1109989017963,
        "Turner Metallics Inc",
        "ship",
        -33.65625,
        72.46875,
        -20.65625,
    ),
    Engineer(
        "The Sarge", "Beta-3 Tucani", 2827992680811, "The Beach", "ship", 32.25, -55.1875, 23.875
    ),
    Engineer(
        "Etienne Dorn",
        "Los",
        11887629902418,
        "Kraken's Retreat",
        "ship",
        -9509.34375,
        -886.3125,
        19820.125,
    ),
    Engineer(
        "Marsha Hicks",
        "Tir",
        48996147307082,
        "The Watchtower",
        "ship",
        -9532.9375,
        -923.4375,
        19799.125,
    ),
    Engineer(
        "Mel Brandon",
        "Luchtaine",
        66038577537618,
        "The Brig",
        "ship",
        -9523.3125,
        -914.46875,
        19825.90625,
    ),
    Engineer(
        "Petra Olmanova",
        "Asura",
        12274907287851,
        "Sanctuary",
        "ship",
        -9550.28125,
        -916.65625,
        19816.1875,
    ),
    Engineer(
        "Chloe Sedesi",
        "Shenve",
        594676730147,
        "Cinder Dock",
        "ship",
        351.96875,
        -373.46875,
        -711.09375,
    ),
    Engineer(
        "Domino Green", "Orishis", 5068464399785, "The Jackrabbit", "suit", -31, 93.96875, -3.5625
    ),
    Engineer(
        "Hero Ferrari",
        "Siris",
        7269634614689,
        "Nevermore Terrace",
        "suit",
        131.0625,
        -73.59375,
        -11.25,
    ),
    Engineer(
        "Jude Navarro",
        "Aurai",
        7268024067513,
        "Marshall's Drift",
        "suit",
        0.9375,
        -47.8125,
        46.28125,
    ),
    Engineer(
        "Kit Fowler", "Capoya", 2827975936355, "The Last Call", "suit", -60.65625, 82.4375, -45.0625
    ),
    Engineer(
        "Oden Geiger",
        "Candiaei",
        8879744226018,
        "Ankh's Promise",
        "suit",
        -113.5,
        -4.9375,
        66.84375,
    ),
    Engineer(
        "Terra Velasquez",
        "Shou Xing",
        3721329101171,
        "Rascal's Choice",
        "suit",
        -16.28125,
        -44.53125,
        94.375,
    ),
    Engineer(
        "Uma Laszlo", "Xuane", 16065190962585, "Laszlo's Resolve", "suit", 93.875, -9.25, -32.53125
    ),
    Engineer(
        "Wellington Beck",
        "Jolapa",
        2832832893634,
        "Beck Facility",
        "suit",
        100.1875,
        -41.34375,
        -78,
    ),
    Engineer(
        "Yarden Bond",
        "Bayan",
        670686455169,
        "Salamander Bank",
        "suit",
        -19.96875,
        117.625,
        -90.46875,
    ),
    Engineer(
        "Baltanos",
        "Deriso",
        71536135676490,
        "The Divine Apparatus",
        "suit",
        -9520.3125,
        -909.5,
        19808.75,
    ),
    Engineer(
        "Eleanor Bresa",
        "Desy",
        38001031029322,
        "Bresa Modifications",
        "suit",
        -9534.21875,
        -912.21875,
        19792.375,
    ),
    Engineer(
        "Rosa Dayette",
        "Kojeara",
        59166629864010,
        "Rosa's Shop",
        "suit",
        -9513.09375,
        -908.84375,
        19814.28125,
    ),
    Engineer(
        "Yi Shen",
        "Einheriar",
        13736779007129,
        "Eidolon Hold",
        "suit",
        -9557.8125,
        -880.1875,
        19801.5625,
    ),
)

# Journal "Progress" values, in the order a commander goes through them.
PROGRESS = {
    "Known": "known",
    "Invited": "invited",
    "Acquainted": "acquainted",
    "Unlocked": "unlocked",
}


def engineers_view(conn: sqlite3.Connection, fid: str | None) -> list[GalaxyEngineerView]:
    standing = {
        r["engineer"]: r
        for r in conn.execute(
            "SELECT engineer, progress, rank FROM engineers WHERE fid = ?", (fid,)
        )
    }
    views = []
    for e in ENGINEERS:
        row = standing.get(e.name)
        views.append(
            GalaxyEngineerView(
                name=e.name,
                system=e.system,
                address=str(e.address),
                base=e.base,
                kind=e.kind,
                x=e.x,
                y=e.y,
                z=e.z,
                progress=PROGRESS.get(row["progress"]) if row else None,
                rank=row["rank"] if row else None,
            )
        )
    return views

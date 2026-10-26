"""Builds app/data/species_odds.json: how often Canonn logged each species, by atmosphere type
and by body type (app/exobio/odds.py weighs the candidate species of one genus with it).

Canonn's biostats count the codex reports of every entry (each colour of a species is its own
entry), with histograms by atmosphere and body type among others. The colours of a species are
added up; the atmosphere and body names become the journal's (`AtmosphereType`
"CarbonDioxideRich", "" for none; `PlanetClass`).

    uv run python tools/species_odds.py [biostats.json]

Without a file the statistics are downloaded from Canonn (~9.5 MB).
"""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.enrich import PLANET_CLASSES, _atmosphere  # noqa: E402
from app.exobio.catalog import lookup_species  # noqa: E402
from app.exobio.engine import atmosphere_type  # noqa: E402
from app.models import BodyFacts  # noqa: E402

URL = "https://us-central1-canonn-api-236217.cloudfunctions.net/query/biostats"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "species_odds.json"


def load(path: str | None) -> dict:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    req = urllib.request.Request(URL, headers={"User-Agent": "EDExplorerKit-tools"})
    with urllib.request.urlopen(req, timeout=120) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def journal_atmosphere(label: str) -> str:
    """Canonn's "Thin Carbon dioxide-rich" as the journal's "CarbonDioxideRich"."""
    body = BodyFacts(0, 0, "", "planet", atmosphere=_atmosphere({"atmosphereType": label}))
    found = atmosphere_type(body)
    if found is None:
        raise ValueError(f"atmosphere {label!r} not understood")
    return found


def journal_body(label: str) -> str | None:
    """Canonn's "High metal content world" as the journal's "High metal content body"; None
    for a star (a few reports of planet life list one: data-entry noise)."""
    return PLANET_CLASSES.get(label.lower())


def build(stats: dict) -> dict:
    species: dict[str, dict] = {}
    for entry in stats.values():
        # Species the genetic sampler takes (and legacy organisms), not other codex biology.
        found = lookup_species(str(entry.get("fdevname") or ""))
        count = int(entry.get("count") or 0)
        if found is None or count <= 0:
            continue
        item = species.setdefault(found.species, {"n": 0, "atmospheres": {}, "bodies": {}})
        item["n"] += count
        hist = entry.get("histograms") or {}
        for label, n in (hist.get("atmos_types") or {}).items():
            key = journal_atmosphere(label)
            item["atmospheres"][key] = item["atmospheres"].get(key, 0) + int(n)
        for label, n in (hist.get("body_types") or {}).items():
            if (key := journal_body(label)) is not None:
                item["bodies"][key] = item["bodies"].get(key, 0) + int(n)
    for item in species.values():
        item["atmospheres"] = dict(sorted(item["atmospheres"].items()))
        item["bodies"] = dict(sorted(item["bodies"].items()))
    return {
        "source": f"Canonn biostats ({URL}), {datetime.now(UTC):%Y-%m-%d}",
        "species": dict(sorted(species.items())),
    }


def main() -> None:
    data = build(load(sys.argv[1] if len(sys.argv) > 1 else None))
    lines = ",\n".join(
        f"  {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}"
        for k, v in data["species"].items()
    )
    OUT.write_text(
        f'{{\n "source": {json.dumps(data["source"])},\n "species": {{\n{lines}\n }}\n}}\n',
        encoding="utf-8",
    )
    print(f"{OUT}: {len(data['species'])} species")


if __name__ == "__main__":
    main()

"""Builds app/data/codex_variants.json: the codex colour variants of Odyssey species.

Each colour of a species is its own codex entry (per region). Canonn's codex reference lists
them as "$Codex_Ent_<Species>_<code>_Name;" with an English name "<Species> - <Colour>": the
code is a star class (the colour follows the body's parent star) or a material (it follows a
material on the body).

    uv run python tools/codex_variants.py [codex_ref.json]

Without a file the reference is downloaded from Canonn.
"""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

URL = "https://us-central1-canonn-api-236217.cloudfunctions.net/query/codex/ref"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "codex_variants.json"
VARIANT = re.compile(r"^\$Codex_Ent_(?P<species>.+?_\d+)_(?P<code>[A-Za-z]+)_Name;$")
STAR_CODES = {"O", "B", "A", "F", "G", "K", "M", "L", "T", "Y", "TTS", "Ae", "W", "D", "N", "H"}
# Two groups: a body has one material of group A at most; group B materials often come together.
MATERIALS = {
    "a": ["Antimony", "Polonium", "Ruthenium", "Technetium", "Tellurium", "Yttrium"],
    "b": ["Cadmium", "Mercury", "Molybdenum", "Niobium", "Tin", "Tungsten"],
}


def load(path: str | None) -> dict:
    if path:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    req = urllib.request.Request(URL, headers={"User-Agent": "EDExplorerKit-tools"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        return json.loads(resp.read().decode("utf-8"))


def build(ref: dict) -> dict:
    species: dict[str, dict] = {}
    for entry in ref.values():
        if entry.get("hud_category") != "Biology":
            continue
        m = VARIANT.match(str(entry.get("name") or ""))
        if not m:
            continue  # legacy organisms: one entry per species
        symbol = f"$Codex_Ent_{m['species']}_Name;"
        code = m["code"]
        colour = str(entry.get("english_name") or "").rpartition(" - ")[2] or code
        by = "star" if code in STAR_CODES else "material"
        item = species.setdefault(symbol, {"by": by, "colours": {}})
        if item["by"] != by:
            raise ValueError(f"{symbol}: colours by both star and material")
        item["colours"][code] = colour
    for symbol, item in species.items():
        if item["by"] == "material":
            codes = set(item["colours"])
            group = next((g for g, mats in MATERIALS.items() if codes <= set(mats)), None)
            if group is None:
                raise ValueError(f"{symbol}: materials {sorted(codes)} span both groups")
            item["group"] = group
    return {
        "source": f"Canonn codex reference ({URL}), {datetime.now(UTC):%Y-%m-%d}",
        "materials": MATERIALS,
        "species": dict(sorted(species.items())),
    }


def main() -> None:
    data = build(load(sys.argv[1] if len(sys.argv) > 1 else None))
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    by = [s["by"] for s in data["species"].values()]
    print(
        f"{OUT}: {len(by)} species, {by.count('star')} by star, {by.count('material')} by material"
    )


if __name__ == "__main__":
    main()

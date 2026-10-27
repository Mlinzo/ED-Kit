"""Builds app/data/engineering.json: the blueprints and experimental effects engineers apply to
each kind of ship module, with the materials every grade takes (the Shop's engineering goals).

Everything comes from EDSY's data (https://edsy.org/eddb.js; EDSY by taleden, CC BY-NC 4.0; the
game data in it is Frontier's): `mtype` (a kind of module: its blueprints and experimental
effects), `blueprint` (a recipe per grade, and the name the journal gives it: `symbol`, lower
case, the same for some blueprints of different kinds), `expeffect` (one recipe) and `material`
(its journal name; the few FDevIDs lacks, new Thargoid ones, come with EDSY's name, type and
grade). EDSY's file is JavaScript: Node reads it. Kinds are listed core first, then optional,
hardpoints and utility mounts (EDSY's `group`), each by name; a recipe names the materials by
journal symbol, lower case, as the journal's Materials event does.

    uv run python tools/engineering_catalog.py
"""

from __future__ import annotations

import json
import subprocess
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EDSY = "https://edsy.org/eddb.js"
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "engineering.json"
SHOP = OUT.with_name("shop.json")
GROUPS = ("component", "internal", "military", "hardpoint", "utility")


def edsy() -> dict[str, Any]:
    """EDSY's module kinds, blueprints, experimental effects, materials and slot groups."""
    req = urllib.request.Request(EDSY, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310
        source = resp.read().decode("utf-8-sig")
    script = (
        "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{"
        "const e=new Function(s+';return eddb;')();"
        "process.stdout.write(JSON.stringify({mtype:e.mtype,blueprint:e.blueprint,"
        "expeffect:e.expeffect,material:e.material,group:e.group}))})"
    )
    out = subprocess.run(
        ["node", "-e", script], input=source, capture_output=True, text=True, encoding="utf-8",
        check=True, shell=False,
    )  # fmt: skip
    return json.loads(out.stdout)


def build() -> dict[str, Any]:
    data = edsy()
    symbols = {key: str(m["fdname"]).lower() for key, m in data["material"].items()}
    known = {m["symbol"] for m in json.loads(SHOP.read_text(encoding="utf-8"))["materials"]}
    # Materials the Shop's catalog (FDevIDs) does not have yet: their names from EDSY.
    types = {"raw": "raw", "mfc": "manufactured", "enc": "encoded"}
    extra = {
        symbols[key]: {"name": m["name"], "type": types[m["mattype"]], "grade": m["rarity"]}
        for key, m in data["material"].items()
        if symbols[key] not in known
    }

    def recipe(mats: dict[str, int]) -> dict[str, int]:
        return {symbols[key]: int(n) for key, n in mats.items()}

    rank = {}
    for i, name in enumerate(GROUPS):
        group = data["group"].get(name) or []
        # Core slots are a list (one entry per slot), the other groups one entry.
        for slot in group if isinstance(group, list) else [group]:
            for mtype in slot.get("mtypes") or {}:
                rank.setdefault(mtype, i)
    # Blueprints without a recipe (legacy ones EDSY keeps for old builds) are left out.
    crafted = {key for key, b in data["blueprint"].items() if b.get("mats")}
    kinds = [
        {
            "key": key,
            "name": m["name"],
            "blueprints": [b for b in m["blueprints"] if b in crafted],
            "experimentals": m.get("expeffects") or [],
        }
        for key, m in data["mtype"].items()
        if any(b in crafted for b in m.get("blueprints") or [])
    ]
    kinds.sort(key=lambda k: (rank.get(k["key"], len(GROUPS)), k["name"]))
    used_bp = {b for k in kinds for b in k["blueprints"]}
    used_x = {x for k in kinds for x in k["experimentals"]}
    return {
        "source": f"EDSY ({EDSY}, taleden, CC BY-NC 4.0); {datetime.now(UTC):%Y-%m-%d}",
        "extra_materials": dict(sorted(extra.items())),
        "modules": kinds,
        "blueprints": {
            key: {
                "name": b["name"],
                "symbol": str(b["fdname"]).lower() if b.get("fdname") else None,
                "grades": [recipe(g) for g in b["mats"]],
            }
            for key, b in sorted(data["blueprint"].items())
            if key in used_bp
        },
        "experimentals": {
            key: {"name": x["name"], "materials": recipe(x["mats"])}
            for key, x in sorted(data["expeffect"].items())
            if key in used_x
        },
    }


def main() -> None:
    data = build()
    OUT.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(
        f"{OUT}: {len(data['modules'])} module kinds, {len(data['blueprints'])} blueprints,"
        f" {len(data['experimentals'])} experimental effects"
    )
    print("materials not in shop.json:", ", ".join(data["extra_materials"]) or "none")


if __name__ == "__main__":
    main()

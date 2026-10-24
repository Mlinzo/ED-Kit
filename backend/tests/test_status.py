from __future__ import annotations

from app.status import decode_status


def test_destination() -> None:
    # Status.json in supercruise toward a planet (the user's game, 2026-10-24).
    status = decode_status(
        {
            "Flags": 689963032,
            "BodyName": "HIP 19036 3 c",
            "Destination": {"System": 358730338970, "Body": 33, "Name": "HIP 19036 3 c"},
        }
    )
    assert (status.destination_system, status.destination_body) == ("358730338970", 33)
    assert decode_status({"Flags": 0}).destination_system is None

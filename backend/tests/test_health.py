from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        journal_dir=tmp_path / "journals",
        data_dir=tmp_path / "data",
        static_dir=None,
        online=False,
    )
    return TestClient(create_app(settings))


def test_health(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


def test_views_without_journals(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        system = client.get("/api/view/system").json()
        assert system["bodies"] == [] and system["name"] is None
        session = client.get("/api/view/session").json()
        assert session["atRiskValue"] == 0
        surface = client.get("/api/view/surface").json()
        assert surface == {"body": None, "activeScan": None}
        ingest = client.get("/api/ingest").json()
        assert ingest["journalDirFound"] is False


def test_settings_roundtrip(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        defaults = client.get("/api/settings").json()
        assert defaults == {"dssMin": 500_000, "bioMin": 2_000_000}
        saved = client.put("/api/settings", json={"dssMin": 1_000_000, "bioMin": 0}).json()
        assert saved == {"dssMin": 1_000_000, "bioMin": 0}
        assert client.get("/api/settings").json() == saved

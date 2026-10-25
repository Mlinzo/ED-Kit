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
        assert surface == {"body": None, "activeScan": None, "globe": None}
        ingest = client.get("/api/ingest").json()
        assert ingest["journalDirFound"] is False


def test_settings_roundtrip(tmp_path: Path) -> None:
    with make_client(tmp_path) as client:
        defaults = client.get("/api/settings").json()
        assert defaults == {"dssMin": 500_000, "bioMin": 2_000_000}
        saved = client.put("/api/settings", json={"dssMin": 1_000_000, "bioMin": 0}).json()
        assert saved == {"dssMin": 1_000_000, "bioMin": 0}
        assert client.get("/api/settings").json() == saved


def test_pages_get_the_app_and_unknown_files_404(tmp_path: Path) -> None:
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<!doctype html><title>app</title>", encoding="utf-8")
    (web / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    settings = Settings(
        journal_dir=tmp_path / "journals",
        data_dir=tmp_path / "data",
        static_dir=web,
        online=False,
    )
    with TestClient(create_app(settings)) as client:
        for path in ("/", "/galaxy", "/system/2931055102291", "/route/"):
            response = client.get(path)
            assert response.status_code == 200 and "<title>app</title>" in response.text, path
            assert response.headers["cache-control"] == "no-cache", path
        bundle = client.get("/assets/app.js")
        assert bundle.text == "console.log(1)"
        assert "immutable" in bundle.headers["cache-control"]
        assert client.get("/assets/missing.js").status_code == 404
        assert client.get("/api/nothing").status_code == 404


def test_listen_address() -> None:
    assert Settings().host == "0.0.0.0"  # a phone on the same Wi-Fi can open the page
    assert Settings(lan=False).host == "127.0.0.1"  # --local
    assert Settings(bind="0.0.0.0").host == "0.0.0.0"  # Docker: --host 0.0.0.0
    assert Settings(lan=False, bind="192.168.1.5").host == "192.168.1.5"


def test_network_addresses_for_a_phone(tmp_path: Path) -> None:
    def client(lan: bool, peer: str, bind: str | None = None) -> TestClient:
        settings = Settings(
            journal_dir=tmp_path / "journals",
            data_dir=tmp_path / "data",
            static_dir=None,
            online=False,
            lan=lan,
            bind=bind,
            port=8765,
        )
        return TestClient(create_app(settings), client=(peer, 50000))

    with client(True, "127.0.0.1") as pc:
        info = pc.get("/api/network").json()
        assert info["lan"] is True and info["thisPc"] is True
        for url in info["urls"]:  # none on a machine without a network
            assert url.startswith("http://") and url.endswith(":8765")
            assert "//127." not in url and "//169.254." not in url
    with client(True, "192.0.2.7") as phone:
        assert phone.get("/api/network").json()["thisPc"] is False
    with client(False, "127.0.0.1") as local:
        assert local.get("/api/network").json() == {"lan": False, "urls": [], "thisPc": True}
    with client(False, "127.0.0.1", bind="192.168.1.5") as bound:
        assert bound.get("/api/network").json()["urls"] == ["http://192.168.1.5:8765"]

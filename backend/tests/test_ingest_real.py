"""End-to-end ingest over the player's real journal folder (skipped when absent)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app import views
from app.config import Settings, default_journal_dir
from app.service import EventBus, IngestService

JOURNALS = default_journal_dir()

pytestmark = pytest.mark.skipif(
    not any(JOURNALS.glob("Journal.*.log")) if JOURNALS.is_dir() else True,
    reason="no Elite Dangerous journals on this machine",
)


def test_backfill_real_journals(tmp_path: Path) -> None:
    settings = Settings(journal_dir=JOURNALS, data_dir=tmp_path, static_dir=None, online=False)
    service = IngestService(settings, EventBus())
    service.start()
    try:
        assert service.ready.wait(30)
        for _ in range(600):
            if service.ingest.backfill_done:
                break
            service._halt.wait(0.1)
        assert service.ingest.backfill_done
        assert service.ingest.events > 1000
    finally:
        service.stop()
        service.join(10)

    from app import db

    conn = db.connect(settings.db_path, readonly=True)
    fid = db.get_meta(conn, "active_fid")
    assert fid

    system = views.system_view(conn, fid)
    assert system.name
    session = views.session_view(conn, fid)
    assert session.commander
    surface = views.surface_view(conn, fid, None)
    assert surface is not None

    analysed = conn.execute(
        "SELECT COUNT(*) FROM organic_scans WHERE status = 'analysed'"
    ).fetchone()[0]
    assert analysed >= 1
    sold = conn.execute("SELECT COUNT(*) FROM organic_scans WHERE sale = 'sold'").fetchone()[0]
    assert sold >= 1

    # Re-running ingest on the same database must not duplicate events.
    events_before = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    service2 = IngestService(settings, EventBus())
    service2.start()
    try:
        assert service2.ready.wait(30)
        for _ in range(300):
            if service2.ingest.backfill_done:
                break
            service2._halt.wait(0.1)
    finally:
        service2.stop()
        service2.join(10)
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == events_before
    conn.close()

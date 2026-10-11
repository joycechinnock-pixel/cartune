import json

import cartune_orchestrator as co


def _passed_report():
    return {"limits_ok": True, "dyno_log": {"passed": True}}


def _passed_report_no_dyno():
    return {"limits_ok": True, "dyno_log": None}


def _failed_report():
    return {"limits_ok": False}


def test_publish_succeeds_with_a_passed_validation(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")
    spec = {"profile": "Day_Use", "values": {}}

    result = co.CommunityTuneAgent(tmp_path).publish(os_id="12345678", tune_spec=spec, validation_report=_passed_report())

    assert result["published"] is True
    assert co.Path(result["path"]).exists()


def test_publish_succeeds_when_dyno_log_is_none_but_limits_ok(tmp_path, monkeypatch):
    """Day-Use-or-below tunes never need pull data at all — limits_ok alone is enough."""
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")
    spec = {"profile": "Day_Use", "values": {}}

    result = co.CommunityTuneAgent(tmp_path).publish(os_id="12345678", tune_spec=spec, validation_report=_passed_report_no_dyno())

    assert result["published"] is True


def test_publish_refused_when_validation_failed(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")
    spec = {"profile": "Sport", "values": {}}

    result = co.CommunityTuneAgent(tmp_path).publish(os_id="12345678", tune_spec=spec, validation_report=_failed_report())

    assert result["published"] is False
    assert "did not pass" in result["reason"]


def test_publish_refused_when_dyno_log_present_but_failed(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")
    spec = {"profile": "Sport", "values": {}}
    report = {"limits_ok": True, "dyno_log": {"passed": False, "failures": ["knock retard hit 5.0°"]}}

    result = co.CommunityTuneAgent(tmp_path).publish(os_id="12345678", tune_spec=spec, validation_report=report)

    assert result["published"] is False


def test_publish_refused_with_no_os_id(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")

    result = co.CommunityTuneAgent(tmp_path).publish(os_id="", tune_spec={}, validation_report=_passed_report())

    assert result["published"] is False
    assert "no OS-ID" in result["reason"]


def test_list_for_os_id_returns_published_entries(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")
    agent = co.CommunityTuneAgent(tmp_path)
    agent.publish(os_id="12345678", tune_spec={"profile": "Day_Use"}, validation_report=_passed_report())
    agent.publish(os_id="12345678", tune_spec={"profile": "Sport"}, validation_report=_passed_report())

    entries = agent.list_for_os_id("12345678")

    assert len(entries) == 2
    assert {e["profile"] for e in entries} == {"Day_Use", "Sport"}


def test_list_for_os_id_with_no_entries_returns_empty_list(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "COMMUNITY_TUNES_DIR", tmp_path / "community_tunes")

    assert co.CommunityTuneAgent(tmp_path).list_for_os_id("NEVER_PUBLISHED") == []

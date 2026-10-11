from pathlib import Path

import cartune_orchestrator as co


class FakeProc:
    def __init__(self, stdout=""):
        self.stdout = stdout


def test_cached_protocol_is_used_without_any_probing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    co.save_protocol_cache("1G1ZE5ST9HF123456", {"bitrate": 500000, "fd": False, "label": "classic CAN @500k"})

    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd) or FakeProc())

    result = co.autodetect_can(vin_hint="1G1ZE5ST9HF123456")

    assert result == {"bitrate": 500000, "fd": False, "label": "classic CAN @500k"}
    assert calls == [], "cached hit should skip probing entirely"


def test_no_cache_for_auto_vin_always_probes(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    co.save_protocol_cache("SOME_VIN", {"bitrate": 500000, "fd": False, "label": "classic CAN @500k"})

    probed = []

    def fake_run(cmd, **kw):
        probed.append(cmd)
        if cmd[0] == "timeout":
            return FakeProc(stdout="")  # no traffic on any candidate
        return FakeProc()

    monkeypatch.setattr(co, "run", fake_run)

    result = co.autodetect_can(vin_hint="AUTO")

    assert result is None
    assert probed, "AUTO/no VIN should never hit the cache — must actually probe"


def test_probe_stops_at_first_candidate_with_traffic(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    seen_bitrates = []

    def fake_run(cmd, **kw):
        if "bitrate" in cmd:
            seen_bitrates.append(cmd[cmd.index("bitrate") + 1])
        if cmd[0] == "timeout":
            # First candidate (500k classic) "answers"
            return FakeProc(stdout="(candump output)") if seen_bitrates[-1:] == ["500000"] and "fd" not in cmd else FakeProc(stdout="")
        return FakeProc()

    monkeypatch.setattr(co, "run", fake_run)

    result = co.autodetect_can(vin_hint=None)

    assert result is not None
    assert result["label"] == "classic CAN @500k"


def test_no_traffic_on_any_candidate_returns_none(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)

    def fake_run(cmd, **kw):
        if cmd[0] == "timeout":
            return FakeProc(stdout="")
        return FakeProc()

    monkeypatch.setattr(co, "run", fake_run)

    assert co.autodetect_can(vin_hint=None) is None


def test_save_and_load_protocol_cache_round_trip(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    co.save_protocol_cache("VIN123", {"bitrate": 250000, "fd": False, "label": "classic CAN @250k"})

    loaded = co.load_protocol_cache("VIN123")

    assert loaded == {"bitrate": 250000, "fd": False, "label": "classic CAN @250k"}


def test_load_protocol_cache_ignores_auto_and_empty_vin(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert co.load_protocol_cache("AUTO") is None
    assert co.load_protocol_cache("") is None
    assert co.load_protocol_cache(None) is None


def test_load_protocol_cache_missing_file_returns_none(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert co.load_protocol_cache("NEVER_SEEN_VIN") is None

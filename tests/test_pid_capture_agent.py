import json
import threading

import cartune_orchestrator as co


def test_default_read_pids_is_an_honest_placeholder(tmp_path):
    """No real tool wired yet — must return None, never a fabricated sample."""
    assert co.PidCaptureAgent(tmp_path).read_pids() is None


def test_capture_stops_immediately_when_event_already_set(tmp_path, monkeypatch):
    stop = threading.Event()
    stop.set()
    agent = co.PidCaptureAgent(tmp_path)
    calls = []
    monkeypatch.setattr(agent, "read_pids", lambda: calls.append(1))
    monkeypatch.setattr(co.time, "sleep", lambda s: None)

    result = agent.capture_until(stop, poll_hz=1000)

    assert result["samples"] == 0
    assert calls == [], "should never call read_pids once the stop event is already set"
    written = json.loads((tmp_path / "pid_capture.json").read_text())
    assert written == []


def test_capture_collects_samples_until_stop_is_set(tmp_path, monkeypatch):
    stop = threading.Event()
    fixed_samples = [
        {"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0},
        {"rpm": 5000, "knock_retard": 0.2, "afr": 12.8, "coolant_c": 93.0},
    ]
    agent = co.PidCaptureAgent(tmp_path)
    call_count = {"n": 0}

    def fake_read_pids():
        call_count["n"] += 1
        if call_count["n"] > len(fixed_samples):
            stop.set()
            return None
        return fixed_samples[call_count["n"] - 1]

    monkeypatch.setattr(agent, "read_pids", fake_read_pids)
    monkeypatch.setattr(co.time, "sleep", lambda s: None)

    result = agent.capture_until(stop, poll_hz=1000)

    assert result["samples"] == 2
    written = json.loads((tmp_path / "pid_capture.json").read_text())
    assert written == fixed_samples


def test_a_sample_that_read_pids_skips_is_not_written(tmp_path, monkeypatch):
    """A None return (a transient read failure) should be silently skipped,
    not written as a null/placeholder row."""
    stop = threading.Event()
    agent = co.PidCaptureAgent(tmp_path)
    call_count = {"n": 0}

    def fake_read_pids():
        call_count["n"] += 1
        if call_count["n"] == 2:
            return None  # simulated dropped read mid-capture
        if call_count["n"] >= 3:
            stop.set()
            return None
        return {"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0}

    monkeypatch.setattr(agent, "read_pids", fake_read_pids)
    monkeypatch.setattr(co.time, "sleep", lambda s: None)

    result = agent.capture_until(stop, poll_hz=1000)

    assert result["samples"] == 1


def test_captured_output_feeds_directly_into_self_logged_pull_agent(tmp_path, monkeypatch):
    """End-to-end: PidCaptureAgent's output is exactly what SelfLoggedPullAgent
    expects, with no manual reshaping in between."""
    stop = threading.Event()
    agent = co.PidCaptureAgent(tmp_path)
    call_count = {"n": 0}

    def fake_read_pids():
        call_count["n"] += 1
        if call_count["n"] > 1:
            stop.set()
            return None
        return {"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0}

    monkeypatch.setattr(agent, "read_pids", fake_read_pids)
    monkeypatch.setattr(co.time, "sleep", lambda s: None)

    capture_result = agent.capture_until(stop, poll_hz=1000)
    conversion = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=capture_result["pid_log"])

    assert conversion["converted"] is True
    assert conversion["samples"] == 1


class FakeQuantity:
    """Mimics python-obd's pint-quantity response values (`.magnitude`)."""
    def __init__(self, magnitude):
        self.magnitude = magnitude


class FakeResponse:
    def __init__(self, value=None, is_null_flag=False):
        self._value = value
        self._is_null_flag = is_null_flag

    def is_null(self):
        return self._is_null_flag

    @property
    def value(self):
        return self._value


class FakeConnection:
    def __init__(self, responses: dict):
        self.responses = responses

    def query(self, command):
        return self.responses.get(command, FakeResponse(is_null_flag=True))


class FakeCommands:
    RPM = "RPM"
    COOLANT_TEMP = "COOLANT_TEMP"


class FakeObdModule:
    commands = FakeCommands()


def test_read_pids_returns_none_with_no_connection_and_no_custom_reader(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "obd", None)
    agent = co.PidCaptureAgent(tmp_path)

    assert agent.read_pids() is None


def test_read_pids_reads_rpm_and_coolant_via_standard_pids(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({
        fake_obd.commands.RPM: FakeResponse(value=FakeQuantity(4500)),
        fake_obd.commands.COOLANT_TEMP: FakeResponse(value=FakeQuantity(92.0)),
    })
    agent = co.PidCaptureAgent(tmp_path)
    agent._connection = fake_conn

    sample = agent.read_pids()

    assert sample["rpm"] == 4500
    assert sample["coolant_c"] == 92.0


def test_read_pids_merges_custom_pid_reader_for_knock_and_afr(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({
        fake_obd.commands.RPM: FakeResponse(value=FakeQuantity(4500)),
        fake_obd.commands.COOLANT_TEMP: FakeResponse(value=FakeQuantity(92.0)),
    })
    agent = co.PidCaptureAgent(tmp_path, custom_pid_reader=lambda: {"knock_retard": 0.5, "afr": 12.8})
    agent._connection = fake_conn

    sample = agent.read_pids()

    assert sample == {"rpm": 4500, "coolant_c": 92.0, "knock_retard": 0.5, "afr": 12.8}


def test_read_pids_returns_none_when_everything_comes_back_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "obd", None)
    agent = co.PidCaptureAgent(tmp_path, custom_pid_reader=lambda: None)

    assert agent.read_pids() is None


def test_broken_custom_pid_reader_degrades_gracefully_instead_of_crashing(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({
        fake_obd.commands.RPM: FakeResponse(value=FakeQuantity(4500)),
        fake_obd.commands.COOLANT_TEMP: FakeResponse(value=FakeQuantity(92.0)),
    })

    def broken_reader():
        raise RuntimeError("ddt4all call failed")

    agent = co.PidCaptureAgent(tmp_path, custom_pid_reader=broken_reader)
    agent._connection = fake_conn

    sample = agent.read_pids()

    assert sample == {"rpm": 4500, "coolant_c": 92.0}


def test_run_closes_the_connection_even_if_capture_fails(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)

    closed = {"flag": False}

    class FakeConnWithClose(FakeConnection):
        def close(self):
            closed["flag"] = True

    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: FakeConnWithClose({}))
    monkeypatch.setattr("builtins.input", lambda prompt="": (_ for _ in ()).throw(RuntimeError("boom")))

    agent = co.PidCaptureAgent(tmp_path)
    try:
        agent.run(poll_hz=1000)
    except RuntimeError:
        pass

    assert closed["flag"] is True

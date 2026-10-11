import json

import pytest

import cartune_orchestrator as co


@pytest.fixture(autouse=True)
def _real_images(tmp_path):
    """The limits check now requires real, same-size, non-blank images."""
    (tmp_path / "current.bin").write_bytes(bytes(range(256)) * 16)
    (tmp_path / "proposed.bin").write_bytes(bytes(range(256)) * 16)


def _run_validator(tmp_path, backend, monkeypatch, *, tune_spec=None, dyno_log=None, confirm="y"):
    monkeypatch.setattr("builtins.input", lambda prompt="": confirm)
    agent = co.ValidatorAgent(tmp_path, backend)
    return agent.run(
        current_bin=str(tmp_path / "current.bin"),
        proposed_bin=str(tmp_path / "proposed.bin"),
        tune_spec=tune_spec,
        dyno_log=dyno_log,
    )


def test_day_use_or_below_skips_dyno_gate_and_asks_for_confirmation(tmp_path, fake_backend, monkeypatch):
    result = _run_validator(
        tmp_path, fake_backend, monkeypatch,
        tune_spec={"values": {"power_stage": "Stage 1"}},
        confirm="y",
    )
    assert result["approved"] is True
    assert fake_backend.calls, "copilot should have been consulted"


def test_no_tune_spec_defaults_to_stage_1_and_skips_dyno_gate(tmp_path, fake_backend, monkeypatch):
    result = _run_validator(tmp_path, fake_backend, monkeypatch, tune_spec=None, confirm="y")
    assert result["approved"] is True


def test_beyond_day_use_without_dyno_log_is_refused_outright(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    tune_spec = json.loads((mock_data_dir / "sample_tune_spec.json").read_text())
    assert tune_spec["values"]["power_stage"] == "Sport"

    result = _run_validator(tmp_path, fake_backend, monkeypatch, tune_spec=tune_spec, dyno_log=None)

    assert result["approved"] is False
    assert not fake_backend.calls, "should refuse before ever consulting copilot"
    report = json.loads(open(result["report"]).read())
    assert "dyno" in report["reason"].lower()


def test_beyond_day_use_with_failing_dyno_log_is_rejected(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    tune_spec = json.loads((mock_data_dir / "sample_tune_spec.json").read_text())

    result = _run_validator(
        tmp_path, fake_backend, monkeypatch,
        tune_spec=tune_spec, dyno_log=str(mock_data_dir / "sample_dyno_log_FAIL.csv"),
    )

    assert result["approved"] is False
    assert not fake_backend.calls, "should reject before consulting copilot"
    report = json.loads(open(result["report"]).read())
    assert report["dyno_log"]["passed"] is False
    assert report["dyno_log"]["failures"]


def test_beyond_day_use_with_passing_dyno_log_reaches_confirm_gate(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    tune_spec = json.loads((mock_data_dir / "sample_tune_spec.json").read_text())

    result = _run_validator(
        tmp_path, fake_backend, monkeypatch,
        tune_spec=tune_spec, dyno_log=str(mock_data_dir / "sample_dyno_log_PASS.csv"),
        confirm="y",
    )

    assert result["approved"] is True
    assert fake_backend.calls, "passing the dyno gate should still go through copilot review"
    report = json.loads(open(result["report"]).read())
    assert report["dyno_log"]["passed"] is True


def test_human_confirm_gate_can_still_decline(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    tune_spec = json.loads((mock_data_dir / "sample_tune_spec.json").read_text())

    result = _run_validator(
        tmp_path, fake_backend, monkeypatch,
        tune_spec=tune_spec, dyno_log=str(mock_data_dir / "sample_dyno_log_PASS.csv"),
        confirm="n",
    )

    assert result["approved"] is False


def test_beyond_day_use_accepts_pid_log_in_place_of_dyno_log(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    """The core fix: a self-logged pull satisfies the gate exactly like a
    real dyno pull does — no dyno required, same thresholds either way."""
    import json as _json
    tune_spec = _json.loads((mock_data_dir / "sample_tune_spec.json").read_text())
    samples = [
        {"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0},
        {"rpm": 5500, "knock_retard": 0.3, "afr": 12.8, "coolant_c": 94.0},
    ]
    pid_log = tmp_path / "pull.json"
    pid_log.write_text(_json.dumps(samples))

    monkeypatch.setattr("builtins.input", lambda prompt="": "y")
    agent = co.ValidatorAgent(tmp_path, fake_backend)
    result = agent.run(
        current_bin=str(tmp_path / "current.bin"),
        proposed_bin=str(tmp_path / "proposed.bin"),
        tune_spec=tune_spec,
        dyno_log=None,
        pid_log=str(pid_log),
    )

    assert result["approved"] is True


def test_beyond_day_use_with_unconvertible_pid_log_is_refused(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    import json as _json
    tune_spec = _json.loads((mock_data_dir / "sample_tune_spec.json").read_text())
    pid_log = tmp_path / "pull.json"
    pid_log.write_text(_json.dumps([{"rpm": 4000}]))  # missing knock/afr/coolant

    agent = co.ValidatorAgent(tmp_path, fake_backend)
    result = agent.run(
        current_bin=str(tmp_path / "current.bin"),
        proposed_bin=str(tmp_path / "proposed.bin"),
        tune_spec=tune_spec,
        dyno_log=None,
        pid_log=str(pid_log),
    )

    assert result["approved"] is False
    assert not fake_backend.calls


def test_reason_makes_clear_a_dyno_is_not_specifically_required(tmp_path, fake_backend, monkeypatch, mock_data_dir):
    import json as _json
    tune_spec = _json.loads((mock_data_dir / "sample_tune_spec.json").read_text())

    agent = co.ValidatorAgent(tmp_path, fake_backend)
    result = agent.run(
        current_bin=str(tmp_path / "current.bin"),
        proposed_bin=str(tmp_path / "proposed.bin"),
        tune_spec=tune_spec,
        dyno_log=None,
        pid_log=None,
    )

    report = json.loads(open(result["report"]).read())
    assert "isn't required" in report["reason"] or "not required" in report["reason"]
    assert "--pid-log" in report["reason"]


# ---- _check_limits: real checks (previously always returned True) ----

def _limits(tmp_path, spec=None, cur=None, prop=None):
    agent = co.ValidatorAgent(tmp_path, None)
    if cur is not None:
        (tmp_path / "current.bin").write_bytes(cur)
    if prop is not None:
        (tmp_path / "proposed.bin").write_bytes(prop)
    ok = agent._check_limits(str(tmp_path / "current.bin"), str(tmp_path / "proposed.bin"), spec)
    return ok, agent.limit_failures


def test_limits_pass_on_matching_images_and_sane_spec(tmp_path, mock_data_dir):
    spec = json.loads((mock_data_dir / "sample_tune_spec.json").read_text())
    ok, failures = _limits(tmp_path, spec)
    assert ok and failures == []


def test_limits_fail_on_missing_proposed_image(tmp_path):
    (tmp_path / "proposed.bin").unlink()
    ok, failures = _limits(tmp_path)
    assert not ok and any("proposed image not found" in f for f in failures)


def test_limits_fail_on_size_mismatch(tmp_path):
    ok, failures = _limits(tmp_path, prop=b"\x01" * 10)
    assert not ok and any("size mismatch" in f for f in failures)


def test_limits_fail_on_blank_image(tmp_path):
    ok, failures = _limits(tmp_path, prop=b"\xff" * 4096)
    assert not ok and any("blank" in f for f in failures)


def test_limits_fail_on_typo_rev_limiter(tmp_path):
    ok, failures = _limits(tmp_path, {"values": {"rev_limiter_rpm": "66000"}})
    assert not ok and any("rev_limiter_rpm" in f for f in failures)


def test_limits_fail_on_lean_wot_afr(tmp_path):
    ok, failures = _limits(tmp_path, {"values": {"afr_wot": "14.7"}})
    assert not ok and any("afr_wot" in f for f in failures)


def test_limits_fail_on_non_numeric_value(tmp_path):
    ok, failures = _limits(tmp_path, {"values": {"afr_wot": "rich"}})
    assert not ok and any("not a number" in f for f in failures)


def test_limits_fail_when_shift_above_rev_limiter(tmp_path):
    ok, failures = _limits(tmp_path, {"values": {"rev_limiter_rpm": "6000", "shift_wot_rpm": "6500"}})
    assert not ok and any("above rev_limiter_rpm" in f for f in failures)


def test_limits_skip_na_values(tmp_path):
    ok, _ = _limits(tmp_path, {"values": {"launch_rev": "N/A", "afr_wot": "N/A"}})
    assert ok


def test_failed_limits_refuse_before_copilot_or_confirm(tmp_path, fake_backend, monkeypatch):
    def boom(prompt=""):
        raise AssertionError("must not ask for confirmation when limits fail")
    monkeypatch.setattr("builtins.input", boom)
    (tmp_path / "proposed.bin").write_bytes(b"\x00" * 4096)
    result = co.ValidatorAgent(tmp_path, fake_backend).run(
        current_bin=str(tmp_path / "current.bin"), proposed_bin=str(tmp_path / "proposed.bin"),
        tune_spec={"values": {"power_stage": "Stage 1"}},
    )
    assert result["approved"] is False
    assert not fake_backend.calls
    report = json.loads(open(result["report"]).read())
    assert report["limit_failures"]

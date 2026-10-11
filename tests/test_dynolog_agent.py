import json

import cartune_orchestrator as co


def test_pass_log_clears_all_thresholds(tmp_path, mock_data_dir):
    agent = co.DynoLogAgent(tmp_path)
    report = agent.run(log_path=str(mock_data_dir / "sample_dyno_log_PASS.csv"))

    assert report["passed"] is True
    assert report["failures"] == []
    assert report["samples"] == 9
    assert report["worst_knock_deg"] == 0.3
    assert report["leanest_afr"] == 12.9
    assert report["hottest_coolant_c"] == 95.0

    written = json.loads((tmp_path / "dyno_log_report.json").read_text())
    assert written == report


def test_fail_log_trips_every_threshold(tmp_path, mock_data_dir):
    agent = co.DynoLogAgent(tmp_path)
    report = agent.run(log_path=str(mock_data_dir / "sample_dyno_log_FAIL.csv"))

    assert report["passed"] is False
    assert len(report["failures"]) == 3
    assert any("knock retard" in f for f in report["failures"])
    assert any("AFR" in f for f in report["failures"])
    assert any("coolant" in f for f in report["failures"])


def test_custom_thresholds_change_the_gate(tmp_path, mock_data_dir):
    agent = co.DynoLogAgent(tmp_path)
    # The PASS log peaks at 0.3 deg knock — tighten the limit below that and
    # it must fail even though it clears the defaults.
    report = agent.run(
        log_path=str(mock_data_dir / "sample_dyno_log_PASS.csv"),
        knock_limit_deg=0.1,
    )
    assert report["passed"] is False
    assert any("knock retard" in f for f in report["failures"])


def test_missing_required_column_fails_fast(tmp_path):
    bad_log = tmp_path / "no_coolant.csv"
    bad_log.write_text("rpm,knock_retard_deg,afr\n2500,0.0,12.9\n")

    report = co.DynoLogAgent(tmp_path).run(log_path=str(bad_log))

    assert report["passed"] is False
    assert "coolant_c" in report["failures"][0]


def test_column_matching_is_case_insensitive(tmp_path):
    log = tmp_path / "shouty.csv"
    log.write_text("RPM,Knock_Retard_Deg,AFR,Coolant_C\n2500,0.0,12.8,90\n")

    report = co.DynoLogAgent(tmp_path).run(log_path=str(log))

    assert report["passed"] is True
    assert report["samples"] == 1


def test_headers_only_with_zero_rows_fails_instead_of_defaulting_to_pass(tmp_path):
    log = tmp_path / "empty_pull.csv"
    log.write_text("rpm,knock_retard_deg,afr,coolant_c\n")

    report = co.DynoLogAgent(tmp_path).run(log_path=str(log))

    assert report["passed"] is False
    assert "zero data rows" in report["failures"][0]

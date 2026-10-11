import csv
import json

import cartune_orchestrator as co


def test_successful_conversion_writes_matching_csv_schema(tmp_path):
    samples = [
        {"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0},
        {"rpm": 5500, "knock_retard": 0.5, "afr": 12.7, "coolant_c": 94.0},
    ]
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps(samples))

    result = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))

    assert result["converted"] is True
    assert result["samples"] == 2
    with open(result["csv_path"], newline="") as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["rpm"] == "4000"
    assert rows[0]["knock_retard_deg"] == "0.0"
    assert rows[1]["afr"] == "12.7"
    assert rows[1]["coolant_c"] == "94.0"


def test_alias_column_names_are_resolved(tmp_path):
    samples = [{"engine_rpm": 3000, "spark_retard_deg": 1.0, "lambda_afr": 13.0, "ect_c": 90.0}]
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps(samples))

    result = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))

    assert result["converted"] is True
    assert result["resolved_from"] == {
        "rpm": "engine_rpm", "knock_retard_deg": "spark_retard_deg",
        "afr": "lambda_afr", "coolant_c": "ect_c",
    }


def test_missing_required_signal_fails_with_reason(tmp_path):
    samples = [{"rpm": 4000, "afr": 12.9, "coolant_c": 92.0}]  # no knock signal at all
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps(samples))

    result = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))

    assert result["converted"] is False
    assert "knock_retard_deg" in result["reason"]


def test_empty_log_fails_with_reason(tmp_path):
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps([]))

    result = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))

    assert result["converted"] is False
    assert "zero samples" in result["reason"]


def test_report_is_written_to_session_dir(tmp_path):
    samples = [{"rpm": 4000, "knock_retard": 0.0, "afr": 12.9, "coolant_c": 92.0}]
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps(samples))

    result = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))

    written = json.loads((tmp_path / "self_logged_pull_report.json").read_text())
    assert written == result


def test_converted_csv_still_fails_dynolog_thresholds_when_it_should(tmp_path):
    """The whole point: a self-logged pull is checked exactly as strictly
    as a real dyno pull — converting the format doesn't relax anything."""
    samples = [{"rpm": 6000, "knock_retard": 5.0, "afr": 14.5, "coolant_c": 115.0}]  # bad on all three
    log_path = tmp_path / "pull.json"
    log_path.write_text(json.dumps(samples))

    conversion = co.SelfLoggedPullAgent(tmp_path).run(pid_log_path=str(log_path))
    assert conversion["converted"] is True

    dyno_result = co.DynoLogAgent(tmp_path).run(log_path=conversion["csv_path"])
    assert dyno_result["passed"] is False
    assert len(dyno_result["failures"]) == 3

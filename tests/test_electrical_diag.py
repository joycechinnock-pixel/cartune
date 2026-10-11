"""Tests for electrical_diag.py — the Python mirror of mobile/src/diag/electrical.ts.

The shared vectors in mock_data/diag_test_vectors.json are also run by
mobile/scripts/test-diag.js against the TypeScript build, so a threshold
change on one side without the other fails one of the two suites.
"""
import json
import re
import subprocess
import sys

import pytest

import electrical_diag as ed
from conftest import MOCK_DATA, REPO_ROOT

VECTORS = json.loads((MOCK_DATA / "diag_test_vectors.json").read_text())["vectors"]


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


ARG_ALIASES = {"pass": "pass_"}


@pytest.mark.parametrize("vec", VECTORS, ids=[f"{v['fn']}-{i}" for i, v in enumerate(VECTORS)])
def test_shared_vectors(vec):
    fn = ed.TS_NAMES[vec["fn"]]
    kwargs = {ARG_ALIASES.get(snake(k), snake(k)): v for k, v in vec["args"].items()}
    result = fn(**kwargs)
    for key, want in vec["expect"].items():
        got = result[snake(key)]
        if isinstance(want, (int, float)) and not isinstance(want, bool):
            assert got == pytest.approx(want), f"{key}: {got} != {want}"
        else:
            assert got == want
    assert len(result["message"]) > 10


def test_vectors_cover_every_calculator():
    assert {v["fn"] for v in VECTORS} == set(ed.TS_NAMES)


def test_bad_input_raises_instead_of_scoring():
    with pytest.raises(ValueError):
        ed.voltage_drop(float("nan"), "ground")
    with pytest.raises(ValueError):
        ed.voltage_drop(0.1, "not-a-circuit")
    with pytest.raises(ValueError):
        ed.fuse_drop_current(1.0, "ato", "999")
    with pytest.raises(ValueError):
        ed.battery_soc("12.6")


def test_fuse_resistance_decreases_with_rating():
    for fuse_type, table in ed.FUSE_RESISTANCE_MOHM.items():
        ratings = sorted(table, key=float)
        values = [table[r] for r in ratings]
        assert values == sorted(values, reverse=True), fuse_type


def test_fuse_drop_is_ohms_law():
    # 7.7 mV across a 7.7 mΩ (10 A ATO) fuse is exactly 1 A
    assert ed.fuse_drop_current(7.7, "ato", 10)["milliamps"] == pytest.approx(1000)
    assert ed.fuse_drop_current(7.7, "ato", "10.0")["milliamps"] == pytest.approx(1000)


def test_cranking_temperature_table():
    assert ed.cranking_min_voltage(25) == 9.6
    assert ed.cranking_min_voltage(0) == 9.1
    assert ed.cranking_min_voltage(-30) == 8.5
    assert ed.cranking_min_voltage(None) == 9.6


def test_round_half_up_matches_javascript():
    assert ed._round(2.345, 2) == 2.35
    assert ed._round(0.5, 0) == 1


def test_thresholds_match_typescript_source():
    ts = (REPO_ROOT / "mobile" / "src" / "diag" / "electrical.ts").read_text()
    assert "ground: { pass: 0.2, warn: 0.3" in ts and ed.VOLTAGE_DROP["ground"]["pass"] == 0.2
    assert "feed_high_current: { pass: 0.5, warn: 0.7" in ts and ed.VOLTAGE_DROP["feed_high_current"]["pass"] == 0.5
    assert "charging: { min: 13.5, max: 14.7" in ts and (ed.CHARGING["min"], ed.CHARGING["max"]) == (13.5, 14.7)
    assert "parasitic: { limitMa: 50, warnMa: 85 }" in ts and ed.PARASITIC == {"limit_ma": 50, "warn_ma": 85}
    fuses = (REPO_ROOT / "mobile" / "src" / "diag" / "fuses.ts").read_text()
    assert '"10": 7.42' in fuses and ed.FUSE_RESISTANCE_MOHM["mini"]["10"] == 7.42


def _cli(*args):
    return subprocess.run([sys.executable, str(REPO_ROOT / "electrical_diag.py"), *args], capture_output=True, text=True)


def test_cli_exit_codes_and_json():
    r = _cli("--json", "voltage-drop", "--reading", "0.35", "--circuit", "ground")
    assert r.returncode == 2
    assert json.loads(r.stdout)["status"] == "fail"
    assert _cli("battery", "--volts", "12.65").returncode == 0
    assert _cli("charging", "--volts", "13.0", "--smart").returncode == 1
    r = _cli("--json", "can-termination", "--open")
    assert json.loads(r.stdout)["verdict"] == "open"
    r = _cli("fuse-drop", "--millivolts", "1", "--type", "ato", "--rating", "999")
    assert r.returncode == 3 and "no resistance value" in r.stderr


def test_cli_json_flag_accepted_after_subcommand():
    r = _cli("fuse-drop", "--millivolts", "1.0", "--type", "mini", "--rating", "10", "--json")
    assert json.loads(r.stdout)["milliamps"] == 134.8
    assert json.loads(_cli("battery", "--volts", "12.65", "--json").stdout)["soc_pct"] == 100


def test_cli_fuse_table_lists_every_type():
    out = _cli("fuse-table").stdout
    for label in ed.FUSE_TYPE_LABELS.values():
        assert label in out


def test_orchestrator_entry_point_delegates_without_banner():
    r = subprocess.run([sys.executable, str(REPO_ROOT / "cartune_orchestrator.py"), "--electrical-diag", "--json",
                        "parasitic", "--milliamps", "35"], capture_output=True, text=True, cwd=REPO_ROOT)
    assert r.returncode == 0, r.stderr
    data = json.loads(r.stdout)
    assert data["status"] == "pass" and data["days_to50"] == pytest.approx(35.7)

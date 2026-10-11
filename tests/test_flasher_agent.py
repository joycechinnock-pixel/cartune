import json
import sys

import cartune_orchestrator as co

PY = sys.executable


def _image(tmp_path, data=b"CALDATA" * 100):
    p = tmp_path / "proposed.bin"
    p.write_bytes(data)
    return p


def test_no_flash_tool_configured_never_claims_a_write(tmp_path, monkeypatch):
    monkeypatch.delenv("CARTUNE_FLASH_CMD", raising=False)
    r = co.FlasherAgent(tmp_path).run(proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is False and r["verified"] is False
    assert "no flash tool" in r["reason"]
    assert json.loads(open(r["report"]).read())["flashed"] is False


def test_missing_image_is_refused(tmp_path):
    r = co.FlasherAgent(tmp_path, flash_cmd="true {file}").run(proposed_bin=str(tmp_path / "nope.bin"))
    assert r["flashed"] is False and "not found" in r["reason"]


def test_failing_flash_command_reports_not_flashed(tmp_path):
    r = co.FlasherAgent(tmp_path, flash_cmd=f"{PY} -c 'import sys; sys.exit(3)' {{file}}").run(
        proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is False and r["verified"] is False


def test_missing_flash_binary_reports_not_flashed(tmp_path):
    r = co.FlasherAgent(tmp_path, flash_cmd="definitely-not-a-real-flasher {file}").run(
        proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is False


def test_flash_without_readback_is_unverified(tmp_path):
    r = co.FlasherAgent(tmp_path, flash_cmd=f"{PY} -c 'pass' {{file}}").run(proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is True and r["verified"] is False
    assert "UNVERIFIED" in r["reason"]


def test_matching_readback_is_verified(tmp_path):
    img = _image(tmp_path)
    readback = f"{PY} -c 'import shutil,sys; shutil.copy(\"{img}\", sys.argv[1])' {{out}}"
    r = co.FlasherAgent(tmp_path, flash_cmd=f"{PY} -c 'pass' {{file}}", readback_cmd=readback).run(
        proposed_bin=str(img))
    assert r["flashed"] is True and r["verified"] is True
    assert r["sha256"] == r["readback_sha256"]


def test_mismatched_readback_is_not_verified(tmp_path):
    img = _image(tmp_path)
    readback = f"{PY} -c 'import sys; open(sys.argv[1],\"wb\").write(b\"WRONG\")' {{out}}"
    r = co.FlasherAgent(tmp_path, flash_cmd=f"{PY} -c 'pass' {{file}}", readback_cmd=readback).run(
        proposed_bin=str(img))
    assert r["flashed"] is True and r["verified"] is False
    assert "MISMATCH" in r["reason"]


def test_readback_that_writes_nothing_is_not_verified(tmp_path):
    r = co.FlasherAgent(tmp_path, flash_cmd=f"{PY} -c 'pass' {{file}}",
                        readback_cmd=f"{PY} -c 'pass' {{out}}").run(proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is True and r["verified"] is False


def test_env_var_is_used_when_no_arg(tmp_path, monkeypatch):
    monkeypatch.setenv("CARTUNE_FLASH_CMD", f"{PY} -c 'pass' {{file}}")
    monkeypatch.delenv("CARTUNE_READBACK_CMD", raising=False)
    r = co.FlasherAgent(tmp_path).run(proposed_bin=str(_image(tmp_path)))
    assert r["flashed"] is True

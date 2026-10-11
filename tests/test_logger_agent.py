import shutil
import subprocess

import pytest

import cartune_orchestrator as co

needs_git = pytest.mark.skipif(shutil.which("git") is None, reason="git not installed")


def _session(tmp_path):
    s = tmp_path / "session_20260925"
    s.mkdir()
    (s / "validation_report.json").write_text("{}")
    return s


@needs_git
def test_commits_without_any_global_git_identity(tmp_path, monkeypatch):
    home = tmp_path / "emptyhome"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    for v in ("GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"):
        monkeypatch.delenv(v, raising=False)
    r = co.LoggerAgent(_session(tmp_path), repos_root=tmp_path / "repos").run(vin="VIN123")
    assert r["committed"] is True
    log = subprocess.run(["git", "-C", r["repo"], "log", "--oneline"], capture_output=True, text=True)
    assert "CarTune session" in log.stdout


@needs_git
def test_second_run_with_no_changes_reports_nothing_to_commit(tmp_path):
    s = _session(tmp_path)
    agent = co.LoggerAgent(s, repos_root=tmp_path / "repos")
    assert agent.run(vin="VIN123")["committed"] is True
    r = agent.run(vin="VIN123")
    assert r["committed"] is False and "nothing changed" in r["reason"]


def test_missing_git_reports_not_committed_but_still_copies(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "run", lambda cmd, **kw: None)
    r = co.LoggerAgent(_session(tmp_path), repos_root=tmp_path / "repos").run(vin="VIN123")
    assert r["committed"] is False
    assert "validation_report.json" in r["copied"]


def test_no_vin_goes_to_unknown(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "run", lambda cmd, **kw: None)
    r = co.LoggerAgent(_session(tmp_path), repos_root=tmp_path / "repos").run(vin=None)
    assert r["repo"].endswith("unknown")

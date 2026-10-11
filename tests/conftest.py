import json
import shutil
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
MOCK_DATA = REPO_ROOT / "mock_data"

# cartune_orchestrator.py lives at the repo root with no package __init__.py,
# so it has to be importable regardless of where pytest is invoked from.
sys.path.insert(0, str(REPO_ROOT))

import cartune_orchestrator as co  # noqa: E402


@pytest.fixture
def mock_data_dir() -> Path:
    return MOCK_DATA


class FakeCopilotBackend(co.CopilotBackend):
    """Stands in for Ollama/API backends so Validator tests don't need a
    real LLM — just records what it was asked and returns a fixed note."""

    def __init__(self, note: str = "[fake copilot] looks fine"):
        self.note = note
        self.calls = []

    def explain(self, context: dict) -> str:
        self.calls.append(context)
        return self.note


@pytest.fixture
def fake_backend() -> FakeCopilotBackend:
    return FakeCopilotBackend()


@pytest.fixture
def vin_repos_sandbox(tmp_path, monkeypatch) -> Path:
    """Copy mock_data/vin_repos into a scratch dir and chdir into it, so
    TuneHistoryAgent's hardcoded './vin_repos/...' paths resolve against the
    fixtures without ever mutating the checked-in mock_data files."""
    sandbox = tmp_path / "sandbox"
    sandbox.mkdir()
    shutil.copytree(MOCK_DATA / "vin_repos", sandbox / "vin_repos")
    monkeypatch.chdir(sandbox)
    return sandbox


@pytest.fixture
def isolated_cwd(tmp_path, monkeypatch) -> Path:
    """UpdateCheckAgent reads/writes its version cache at the module-level
    relative path `./.cartune_versions.json` (by design — the cache needs to
    persist across separate CLI runs). Chdir into a throwaway tmp_path so
    tests never read or write the real project's cache file."""
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.fixture
def fake_tools_manifest(tmp_path, monkeypatch):
    """Points co.TOOLS_MANIFEST at a scratch file so load_tools_manifest()/
    TuningAgent's manifest lookup never touch the real ~/cartune_tools on
    whatever machine the tests run on. Returns a function that writes the
    given dict as the manifest's contents."""
    manifest_path = tmp_path / "tools_manifest.json"
    monkeypatch.setattr(co, "TOOLS_MANIFEST", manifest_path)

    def _write(contents) -> Path:
        manifest_path.write_text(contents if isinstance(contents, str) else json.dumps(contents))
        return manifest_path

    return _write

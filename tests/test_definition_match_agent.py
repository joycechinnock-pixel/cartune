import json

import cartune_orchestrator as co


def test_no_os_id_returns_unmatched_with_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", tmp_path / "definitions_index.json")

    result = co.DefinitionMatchAgent(tmp_path).run(os_id=None, current_bin="current.bin")

    assert result["matched"] is False
    assert result["os_id"] is None
    assert "no OS-ID" in result["reason"]


def test_os_id_not_in_index_returns_unmatched(tmp_path, monkeypatch):
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text(json.dumps({"OTHER_OS_ID": {"source_tool": "RomRaider"}}))
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is False
    assert result["os_id"] == "12345678"
    assert "not yet indexed" in result["reason"]


def test_os_id_in_index_returns_matched_with_entry_fields(tmp_path, monkeypatch):
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text(json.dumps({
        "12345678": {
            "source_tool": "PCM Hammer",
            "definition_path": "/defs/e38_12345678.xdf",
            "verified": True,
        }
    }))
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is True
    assert result["os_id"] == "12345678"
    assert result["source_tool"] == "PCM Hammer"
    assert result["definition_path"] == "/defs/e38_12345678.xdf"
    assert result["verified"] is True


def test_unverified_match_still_reports_matched_true(tmp_path, monkeypatch):
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text(json.dumps({
        "12345678": {"source_tool": "TunerPro", "definition_path": "/defs/guess.xdf", "verified": False}
    }))
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is True
    assert result["verified"] is False


def test_missing_index_file_treated_as_empty_not_a_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", tmp_path / "does_not_exist.json")

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is False
    assert "not yet indexed" in result["reason"]


def test_malformed_index_file_treated_as_empty_not_a_crash(tmp_path, monkeypatch):
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text("{not valid json")
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is False


def test_result_is_written_to_session_dir(tmp_path, monkeypatch):
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text(json.dumps({
        "12345678": {"source_tool": "PCM Hammer", "definition_path": "/defs/x.xdf", "verified": True}
    }))
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="12345678", current_bin="current.bin")

    written = json.loads((tmp_path / "definition_match.json").read_text())
    assert written == result


def test_the_shipped_index_matches_the_real_barra_os_id(tmp_path, monkeypatch):
    """Sanity check on the actual seed data (not a mock): the one real,
    verified entry in definitions_index.json should resolve correctly."""
    real_index = co.Path(__file__).resolve().parent.parent / "definitions_index.json"
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", real_index)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="HACCKG6", current_bin="current.bin")

    assert result["matched"] is True
    assert result["source_tool"] == "HP Tuners VCM Editor"
    assert result["verified"] is True


def test_the_shipped_index_does_not_match_an_unrelated_os_id(tmp_path, monkeypatch):
    real_index = co.Path(__file__).resolve().parent.parent / "definitions_index.json"
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", real_index)

    result = co.DefinitionMatchAgent(tmp_path).run(os_id="SOME_OTHER_OS_ID", current_bin="current.bin")

    assert result["matched"] is False


def test_agent_accepts_a_string_session_dir_not_just_a_path(tmp_path, monkeypatch):
    """Every real caller passes a Path, but a plain string shouldn't crash
    three calls deep inside outfile() with a cryptic TypeError."""
    index_path = tmp_path / "definitions_index.json"
    index_path.write_text(json.dumps({"12345678": {"source_tool": "PCM Hammer", "verified": True}}))
    monkeypatch.setattr(co, "DEFINITIONS_INDEX", index_path)

    result = co.DefinitionMatchAgent(str(tmp_path)).run(os_id="12345678", current_bin="current.bin")

    assert result["matched"] is True

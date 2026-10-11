import hashlib
import json

import cartune_orchestrator as co

VIN_WITH_HISTORY = "1G1ZE5ST9HF123456"
VIN_SINGLE_ENTRY = "5J8YD4H50NL000789"


def test_list_reads_existing_manifest_in_order(vin_repos_sandbox, tmp_path):
    entries = co.TuneHistoryAgent(tmp_path).list(VIN_WITH_HISTORY)

    assert [e["id"] for e in entries] == [
        "20260715-093000__initial_read_baseline",
        "20260715-101200__Day_Use",
        "20260722-140500__Sport",
    ]


def test_list_unknown_vin_returns_empty(vin_repos_sandbox, tmp_path):
    assert co.TuneHistoryAgent(tmp_path).list("NO_SUCH_VIN") == []


def test_manifest_checksums_match_the_actual_bin_files(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)
    for entry in history.list(VIN_SINGLE_ENTRY):
        bin_path = history.get_bin_path(VIN_SINGLE_ENTRY, entry["id"])
        assert bin_path.exists()
        assert hashlib.sha256(bin_path.read_bytes()).hexdigest()[:16] == entry["sha256"]


def test_get_bin_path_resolves_known_id_and_none_for_unknown(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)

    resolved = history.get_bin_path(VIN_WITH_HISTORY, "20260722-140500__Sport")
    assert resolved is not None
    assert resolved.name == "20260722-140500__Sport.bin"
    assert resolved.exists()

    assert history.get_bin_path(VIN_WITH_HISTORY, "does-not-exist") is None


def test_snapshot_appends_manifest_entry_with_correct_checksum(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)
    source = tmp_path / "current.bin"
    source.write_bytes(b"deterministic-filler-bytes-for-test")
    expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()[:16]

    before = history.list(VIN_WITH_HISTORY)
    entry = history.snapshot(VIN_WITH_HISTORY, str(source), title="My Test Tune!")

    assert entry["sha256"] == expected_sha
    assert entry["title"] == "My Test Tune!"
    assert entry["file"].endswith("__My_Test_Tune_.bin")

    after = history.list(VIN_WITH_HISTORY)
    assert len(after) == len(before) + 1
    assert after[-1] == entry

    saved_bin = history.get_bin_path(VIN_WITH_HISTORY, entry["id"])
    assert saved_bin.read_bytes() == source.read_bytes()


def test_snapshot_of_missing_source_returns_none_and_does_not_touch_manifest(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)
    before = history.list(VIN_WITH_HISTORY)

    result = history.snapshot(VIN_WITH_HISTORY, str(tmp_path / "nope.bin"), title="should not happen")

    assert result is None
    assert history.list(VIN_WITH_HISTORY) == before


def test_snapshot_starts_a_fresh_manifest_for_a_brand_new_vin(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)
    source = tmp_path / "current.bin"
    source.write_bytes(b"new-vehicle-first-read")

    assert history.list("BRAND_NEW_VIN") == []
    entry = history.snapshot("BRAND_NEW_VIN", str(source), title="initial_read_baseline")

    assert history.list("BRAND_NEW_VIN") == [entry]


def test_snapshot_stores_tune_spec_and_get_tune_spec_retrieves_it(vin_repos_sandbox, tmp_path):
    history = co.TuneHistoryAgent(tmp_path)
    source = tmp_path / "current.bin"
    source.write_bytes(b"sport-stage-bytes")
    spec = {"profile": "Sport", "values": {"power_stage": "Sport", "afr_wot": "12.6"}}

    entry = history.snapshot(VIN_WITH_HISTORY, str(source), title="Sport", tune_spec=spec)

    assert entry["tune_spec"] == spec
    assert history.get_tune_spec(VIN_WITH_HISTORY, entry["id"]) == spec


def test_get_tune_spec_returns_none_for_snapshots_that_never_recorded_one(vin_repos_sandbox, tmp_path):
    # The checked-in mock_data fixtures predate the tune_spec field entirely —
    # this must degrade to None, not KeyError, so old snapshots stay revertable.
    history = co.TuneHistoryAgent(tmp_path)
    assert history.get_tune_spec(VIN_WITH_HISTORY, "20260715-093000__initial_read_baseline") is None
    assert history.get_tune_spec(VIN_WITH_HISTORY, "does-not-exist") is None

import cartune_orchestrator as co


def test_load_tools_manifest_returns_empty_dict_when_missing(fake_tools_manifest):
    # fake_tools_manifest points co.TOOLS_MANIFEST at a scratch path but
    # doesn't write anything to it — simulates never having run setup_tools.sh.
    assert co.load_tools_manifest() == {}


def test_load_tools_manifest_returns_empty_dict_on_corrupt_json(fake_tools_manifest):
    fake_tools_manifest("{not valid json")
    assert co.load_tools_manifest() == {}


def test_load_tools_manifest_parses_a_real_manifest(fake_tools_manifest):
    fake_tools_manifest({"linols": {"status": "ok", "run_hint": "cd x && python3 main.py",
                                     "note": "", "repo": "https://github.com/2CRPerformance/LinOLS"}})
    manifest = co.load_tools_manifest()
    assert manifest["linols"]["status"] == "ok"
    assert manifest["linols"]["run_hint"] == "cd x && python3 main.py"


def test_tuning_agent_uses_verified_manifest_launch_command(tmp_path, fake_tools_manifest, monkeypatch):
    fake_tools_manifest({"linols": {"status": "ok", "run_hint": "echo verified-launch",
                                     "note": "", "repo": "x"}})
    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd))

    current_bin = tmp_path / "current.bin"
    current_bin.write_bytes(b"fake-bin")

    result = co.TuningAgent(tmp_path).run(current_bin=str(current_bin), editor="linols")

    assert calls == [["bash", "-c", "echo verified-launch"]]
    assert result["proposed_bin"] == str(tmp_path / "proposed.bin")


def test_tuning_agent_falls_back_to_placeholder_when_no_manifest_entry(tmp_path, fake_tools_manifest, monkeypatch):
    fake_tools_manifest({})  # nothing installed yet
    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd))

    current_bin = tmp_path / "current.bin"
    current_bin.write_bytes(b"fake-bin")

    co.TuningAgent(tmp_path).run(current_bin=str(current_bin), editor="romraider")

    assert calls == [["romraider", "--rom", str(current_bin)]]


def test_tuning_agent_falls_back_when_manifest_status_is_not_ok(tmp_path, fake_tools_manifest, monkeypatch):
    fake_tools_manifest({"linols": {"status": "failed", "run_hint": "", "note": "build failed", "repo": "x"}})
    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd))

    current_bin = tmp_path / "current.bin"
    current_bin.write_bytes(b"fake-bin")

    co.TuningAgent(tmp_path).run(current_bin=str(current_bin), editor="linols")

    # Falls back to the unverified placeholder for "linols" rather than
    # trying to run a tool that's recorded as failed to install.
    assert calls == [["linols", str(current_bin)]]


def test_tuning_agent_survives_a_malformed_ok_entry_missing_run_hint(tmp_path, fake_tools_manifest, monkeypatch):
    # A hand-edited or future-buggy manifest could have status "ok" with no
    # run_hint key at all — this must not raise KeyError.
    fake_tools_manifest({"linols": {"status": "ok"}})
    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd))

    current_bin = tmp_path / "current.bin"
    current_bin.write_bytes(b"fake-bin")

    co.TuningAgent(tmp_path).run(current_bin=str(current_bin), editor="linols")

    assert calls == [["linols", str(current_bin)]]


def test_tuning_agent_warns_and_does_not_crash_on_totally_unknown_editor(tmp_path, fake_tools_manifest, monkeypatch, capsys):
    fake_tools_manifest({})
    calls = []
    monkeypatch.setattr(co, "run", lambda cmd, **kw: calls.append(cmd))

    current_bin = tmp_path / "current.bin"
    current_bin.write_bytes(b"fake-bin")

    result = co.TuningAgent(tmp_path).run(current_bin=str(current_bin), editor="totally-made-up-editor")

    assert calls == []
    assert "no known way to launch" in capsys.readouterr().out
    # Still returns a proposed_bin (best-effort copy) rather than crashing.
    assert result["proposed_bin"] == str(tmp_path / "proposed.bin")

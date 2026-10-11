import json
import urllib.parse

import cartune_orchestrator as co


class FakeGithubResponse:
    def __init__(self, payload: dict):
        self._body = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


def test_github_hits_are_parsed_into_the_expected_shape(tmp_path, monkeypatch):
    payload = {
        "items": [
            {"full_name": "commaai/opendbc", "description": "DBC signal db",
             "stargazers_count": 3000, "html_url": "https://github.com/commaai/opendbc"},
        ]
    }
    calls = []

    def fake_urlopen(req, timeout=10):
        calls.append(req.full_url)
        return FakeGithubResponse(payload)

    monkeypatch.setattr(co.urllib.request, "urlopen", fake_urlopen)

    result = co.VehicleLookupAgent(tmp_path).run(
        make="Holden", model="Commodore SS", year="2010", engine="LS3", pcm_part_number="12633751",
    )

    assert result["github_hits"] == [
        {"name": "commaai/opendbc", "description": "DBC signal db", "stars": 3000,
         "url": "https://github.com/commaai/opendbc"},
    ]
    assert calls, "should have hit the GitHub search API"
    assert calls[0].startswith("https://api.github.com/search/repositories?q=")


def test_manual_search_links_are_built_for_every_prepared_site(tmp_path, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", lambda req, timeout=10: FakeGithubResponse({"items": []}))

    result = co.VehicleLookupAgent(tmp_path).run(make="Holden", model="Commodore SS")

    query = "Holden Commodore SS"
    assert set(result["manual_search_links"]) == set(co.VehicleLookupAgent.PREPARED_SEARCH_SITES)
    for name, template in co.VehicleLookupAgent.PREPARED_SEARCH_SITES.items():
        assert result["manual_search_links"][name] == template.format(q=urllib.parse.quote(query))


def test_vin_provided_flag_reflects_input(tmp_path, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", lambda req, timeout=10: FakeGithubResponse({"items": []}))

    without_vin = co.VehicleLookupAgent(tmp_path).run(make="Ford", model="Falcon")
    assert without_vin["vin_provided"] is False

    with_vin = co.VehicleLookupAgent(tmp_path).run(make="Ford", model="Falcon", vin="6FPBB1234")
    assert with_vin["vin_provided"] is True


def test_empty_query_skips_the_network_call_entirely(tmp_path, monkeypatch):
    called = False

    def fake_urlopen(req, timeout=10):
        nonlocal called
        called = True
        return FakeGithubResponse({"items": []})

    monkeypatch.setattr(co.urllib.request, "urlopen", fake_urlopen)

    result = co.VehicleLookupAgent(tmp_path).run(make="", model="")

    assert result["github_hits"] == []
    assert called is False


def test_network_failure_degrades_to_empty_hits_not_a_crash(tmp_path, monkeypatch):
    def raising_urlopen(req, timeout=10):
        raise OSError("simulated offline / rate limited")

    monkeypatch.setattr(co.urllib.request, "urlopen", raising_urlopen)

    result = co.VehicleLookupAgent(tmp_path).run(make="Holden", model="Commodore SS")

    assert result["github_hits"] == []
    assert result["manual_search_links"], "manual links should still be prepared even if GitHub search fails"


def test_result_is_written_to_session_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", lambda req, timeout=10: FakeGithubResponse({"items": []}))

    result = co.VehicleLookupAgent(tmp_path).run(make="Holden", model="Commodore SS")

    written = json.loads((tmp_path / "vehicle_lookup.json").read_text())
    assert written == result
    assert "is verified against your PCM" in written["warning"]

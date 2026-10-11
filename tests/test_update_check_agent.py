import json

import cartune_orchestrator as co


class FakeGithubResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


def make_commits_urlopen(sha_by_repo: dict, calls: list | None = None):
    """Builds a fake urlopen that returns a one-item commits list whose sha
    depends on which repo's URL was requested — so each of the 15 tools in
    TOOL_REPOS can be given its own scripted 'latest commit'."""
    def fake_urlopen(req, timeout=10):
        url = req.full_url
        if calls is not None:
            calls.append(url)
        for repo, sha in sha_by_repo.items():
            if f"/repos/{repo}/commits" in url:
                return FakeGithubResponse([{"sha": sha}])
        return FakeGithubResponse([])
    return fake_urlopen


def _all_repos_at(sha: str) -> dict:
    return {repo: sha for repo in co.TOOL_REPOS.values()}


def _cache_key(repo: str) -> str:
    """Mirrors UpdateCheckAgent's own cache-key scoping: a repo that's really
    just one subdirectory of a larger monorepo (e.g. cabana living inside
    commaai/openpilot) gets a '#subpath'-qualified key so its cached sha
    can't collide with unrelated activity elsewhere in that repo."""
    subpath = co.TOOL_REPO_SUBPATHS.get(repo)
    return f"{repo}#{subpath}" if subpath else repo


def test_first_run_populates_cache_and_flags_every_tool_as_new(isolated_cwd, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(_all_repos_at("a" * 40)))

    updates = co.UpdateCheckAgent(isolated_cwd).run()

    # Nothing was "seen" before this run, so every tool with a resolvable
    # commit counts as new activity the first time the cache is built.
    assert set(updates.keys()) == set(co.TOOL_REPOS.keys())
    for tool, info in updates.items():
        assert info["previously_seen"] is None
        assert info["latest"] == "a" * 10
        assert info["repo"] == co.TOOL_REPOS[tool]

    cache = json.loads(co.VERSION_CACHE.read_text())
    assert cache == {_cache_key(repo): "a" * 10 for repo in co.TOOL_REPOS.values()}

    report = json.loads((isolated_cwd / "update_report.json").read_text())
    assert report == updates


def test_second_run_with_unchanged_commits_reports_nothing_new(isolated_cwd, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(_all_repos_at("a" * 40)))
    co.UpdateCheckAgent(isolated_cwd).run()

    second = co.UpdateCheckAgent(isolated_cwd).run()

    assert second == {}


def test_a_single_changed_repo_is_reported_alone(isolated_cwd, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(_all_repos_at("a" * 40)))
    co.UpdateCheckAgent(isolated_cwd).run()

    changed_repo = co.TOOL_REPOS["opendbc"]
    shas = _all_repos_at("a" * 40)
    shas[changed_repo] = "b" * 40
    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(shas))

    updates = co.UpdateCheckAgent(isolated_cwd).run()

    assert list(updates.keys()) == ["opendbc"]
    assert updates["opendbc"]["previously_seen"] == "a" * 10
    assert updates["opendbc"]["latest"] == "b" * 10

    cache = json.loads(co.VERSION_CACHE.read_text())
    assert cache[changed_repo] == "b" * 10
    # every other repo's cached sha is untouched by the one change
    for repo, sha in cache.items():
        if repo != changed_repo:
            assert sha == "a" * 10


def test_network_failure_degrades_to_no_updates_not_a_crash(isolated_cwd, monkeypatch):
    def raising_urlopen(req, timeout=10):
        raise OSError("simulated offline / rate limited")

    monkeypatch.setattr(co.urllib.request, "urlopen", raising_urlopen)

    updates = co.UpdateCheckAgent(isolated_cwd).run()

    assert updates == {}
    # a repo whose commit can never be resolved is never recorded as "seen" —
    # next time the network works, it should be treated as new, not silently
    # matched against a null baseline.
    cache = json.loads(co.VERSION_CACHE.read_text())
    assert cache == {}


def test_cabana_commit_lookup_is_scoped_to_the_tools_cabana_subpath(isolated_cwd, monkeypatch):
    # cabana points at the huge commaai/openpilot monorepo (the standalone
    # commaai/cabana repo is archived) — without path-scoping, any unrelated
    # openpilot commit would falsely flag cabana as "updated". This asserts
    # on the actual outgoing request, so a regression that silently dropped
    # the &path= filter would fail this test instead of passing unnoticed.
    calls = []
    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(_all_repos_at("a" * 40), calls=calls))

    co.UpdateCheckAgent(isolated_cwd).run()

    cabana_repo = co.TOOL_REPOS["cabana"]
    cabana_calls = [url for url in calls if f"/repos/{cabana_repo}/commits" in url]
    assert cabana_calls, "expected at least one commits request for the cabana repo"
    assert all("path=tools/cabana" in url for url in cabana_calls), (
        f"cabana's commit lookup must be scoped to the tools/cabana subpath, got: {cabana_calls}"
    )

    # A repo with no subpath override must NOT get a path= filter at all —
    # proves the scoping is opt-in per-repo, not accidentally applied to
    # everything.
    opendbc_repo = co.TOOL_REPOS["opendbc"]
    opendbc_calls = [url for url in calls if f"/repos/{opendbc_repo}/commits" in url]
    assert opendbc_calls, "expected at least one commits request for the opendbc repo"
    assert all("path=" not in url for url in opendbc_calls)


def test_recovers_once_network_comes_back_after_an_earlier_failure(isolated_cwd, monkeypatch):
    monkeypatch.setattr(co.urllib.request, "urlopen", lambda req, timeout=10: (_ for _ in ()).throw(OSError("offline")))
    first = co.UpdateCheckAgent(isolated_cwd).run()
    assert first == {}

    monkeypatch.setattr(co.urllib.request, "urlopen", make_commits_urlopen(_all_repos_at("c" * 40)))
    second = co.UpdateCheckAgent(isolated_cwd).run()

    assert set(second.keys()) == set(co.TOOL_REPOS.keys())
    for info in second.values():
        assert info["previously_seen"] is None
        assert info["latest"] == "c" * 10


def test_digest_reports_no_changes_when_updates_is_empty(isolated_cwd):
    text = co.UpdateCheckAgent(isolated_cwd).digest({})

    assert "No new activity" in text
    assert (isolated_cwd / "update_digest.md").read_text() == text


def test_digest_lists_each_tool_in_plain_english(isolated_cwd):
    updates = {
        "opendbc": {"repo": "commaai/opendbc", "previously_seen": "aaaaaaaaaa", "latest": "bbbbbbbbbb"},
        "LinOLS": {"repo": "2CRPerformance/LinOLS", "previously_seen": None, "latest": "cccccccccc"},
    }

    text = co.UpdateCheckAgent(isolated_cwd).digest(updates)

    assert "2 tool(s)" in text
    assert "LinOLS" in text and "opendbc" in text
    assert "never checked before" in text  # for the previously_seen=None case
    assert "aaaaaaaaaa" in text and "bbbbbbbbbb" in text

#!/usr/bin/env python3
"""
CarTune Orchestrator
=====================
Runnable scaffold for the CarTune OS multi-agent pipeline described in
CarTune-OS-Design.md. Each Agent is a thin subprocess wrapper around a
real open-source tool; swap the `cmd = [...]` lines for whatever CLI
flags your installed version actually uses.

Run:  python3 cartune_orchestrator.py --vin AUTO
"""

import argparse
import json
import os
import subprocess
import shutil
import shlex
import datetime
import sys
import hashlib
import threading
import time
import urllib.request
import urllib.parse
from pathlib import Path
from abc import ABC, abstractmethod

SESSION_ROOT = Path("./cartune_sessions")
VERSION_CACHE = Path("./.cartune_versions.json")

# Where setup_tools.sh installs everything and records what it managed to
# build — same env var, same default, so the two scripts agree without
# either one having to be told about the other's location explicitly.
TOOLS_DIR = Path(os.environ.get("CARTUNE_TOOLS_DIR", str(Path.home() / "cartune_tools")))
TOOLS_MANIFEST = TOOLS_DIR / "tools_manifest.json"

# OS-ID -> known-good XDF/ODX definition, so TuningAgent doesn't need the
# human to already know which definition file matches this exact PCM.
# Ships empty/example-only — populating real entries (from RomRaider's XDF
# repo, TunerPro's library, PCM Hammer's known-OS table) is future work,
# same as TOOL_REPOS above started as a manually-curated list.
DEFINITIONS_INDEX = Path(os.environ.get("CARTUNE_DEFINITIONS_INDEX", "./definitions_index.json"))

# Local staging area for the opt-in community shared-tune repo (see
# CommunityTuneAgent) — tune_spec + validation_report only, never binaries.
COMMUNITY_TUNES_DIR = Path(os.environ.get("CARTUNE_COMMUNITY_DIR", "./community_tunes"))

# Every tool in the CarTune-OS-Design.md inventory that lives on GitHub —
# UpdateCheckAgent polls these; VehicleLookupAgent searches more broadly.
TOOL_REPOS = {
    "BlackFlag ECU": "bad-antics/blackflag-ecu",
    "LinOLS": "2CRPerformance/LinOLS",
    "EcuBus-Pro": "ecubus/EcuBus-Pro",
    "HyperTuner": "hyper-tuner/hypertuner",
    "LibreTune": "RallyPat/LibreTune",
    "Tune-Editor": "TheFlashBold/tune-editor",
    "pyobd": "barracuda-fsh/pyobd",
    "OVMS3": "openvehicles/Open-Vehicle-Monitoring-System-3",
    "OpenVehicleDiag": "rnd-ash/OpenVehicleDiag",
    "ddt4all": "cedricp/ddt4all",
    "odxtools": "mercedes-benz/odxtools",
    "OpenJ2534": "jakka351/OpenJ2534",
    "GenericDiagnosticTool": "jakka351/GenericDiagnosticTool",
    "opendbc": "commaai/opendbc",
    # The standalone commaai/cabana repo is archived — its own README says
    # it's deprecated in favor of the version bundled in commaai/openpilot.
    # UpdateCheckAgent polls commit activity scoped to that subpath (see
    # TOOL_REPO_SUBPATHS) so this doesn't just report "no changes" forever
    # against a dead repo, or conversely spam "new activity" on every
    # unrelated openpilot commit.
    "cabana": "commaai/openpilot",
}

# Repos where only a subdirectory of a much larger monorepo is actually the
# tool in our inventory — UpdateCheckAgent scopes its commit-activity check
# to this path instead of the whole repo.
TOOL_REPO_SUBPATHS = {
    "commaai/openpilot": "tools/cabana",
}


def load_tools_manifest() -> dict:
    """Reads what setup_tools.sh actually managed to install, if it's been
    run. Missing/unreadable manifest just means 'nothing installed yet' —
    never a hard error, since every agent has always worked without it."""
    if not TOOLS_MANIFEST.exists():
        return {}
    try:
        return json.loads(TOOLS_MANIFEST.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


# --------------------------------------------------------------------------
# Session / working directory
# --------------------------------------------------------------------------

def new_session_dir() -> Path:
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    d = SESSION_ROOT / stamp
    d.mkdir(parents=True, exist_ok=True)
    return d


def run(cmd, **kwargs):
    """Thin wrapper so every agent logs exactly what it ran."""
    print(f"  $ {' '.join(cmd)}")
    try:
        return subprocess.run(cmd, check=True, capture_output=True, text=True, **kwargs)
    except FileNotFoundError:
        print(f"  ! '{cmd[0]}' not found on PATH — install it or edit this agent's cmd list.")
        return None
    except subprocess.CalledProcessError as e:
        print(f"  ! {cmd[0]} exited {e.returncode}: {e.stderr[:300]}")
        return None


# --------------------------------------------------------------------------
# 0. Hardware / SocketCAN bring-up
# --------------------------------------------------------------------------

def bring_up_can(iface: str = "can0", bitrate: int = 500000, fd: bool = False):
    print(f"[hardware] bringing up {iface} @ {bitrate}")
    args = ["sudo", "ip", "link", "set", iface, "up", "type", "can", "bitrate", str(bitrate)]
    if fd:
        args += ["dbitrate", "2000000", "fd", "on"]
    run(args)


def bring_down_can(iface: str = "can0"):
    print(f"[hardware] bringing down {iface} — safe to unplug after this")
    run(["sudo", "ip", "link", "set", iface, "down"])


# --------------------------------------------------------------------------
# 0b. python-obd integration — optional. Every OBD-touching agent below
# degrades honestly (returns None) if this isn't installed or no adapter
# answers, the same way every subprocess tool wrapper in this file already
# degrades when a CLI tool is missing.
# --------------------------------------------------------------------------

try:
    import obd  # python-obd — https://python-obd.readthedocs.io
except ImportError:
    obd = None


def _open_obd_connection(portstr: str | None = None):
    """Opens a python-obd connection if the library is installed and an
    adapter answers. Returns None (never raises) otherwise — every caller
    already has a None-safe fallback path."""
    if obd is None:
        return None
    try:
        connection = obd.OBD(portstr) if portstr else obd.OBD()
        return connection if connection.is_connected() else None
    except Exception:
        return None


# --------------------------------------------------------------------------
# 0a. Protocol autodetection — tries known bitrate/FD combos in order so the
# user doesn't need to already know the bus config before plugging in.
# Caches the winner per-VIN once Discovery confirms one, so a repeat visit
# to the same car skips the probe entirely.
# --------------------------------------------------------------------------

PROTOCOL_CANDIDATES = [
    {"bitrate": 500000, "fd": False, "label": "classic CAN @500k"},
    {"bitrate": 500000, "fd": True, "dbitrate": 2000000, "label": "CAN-FD @500k/2M"},
    {"bitrate": 250000, "fd": False, "label": "classic CAN @250k"},
    {"bitrate": 125000, "fd": False, "label": "classic CAN @125k (older platforms)"},
]

# Heavy trucks and machinery (SAE J1939): 29-bit CAN, 250k on the black 9-pin
# Deutsch plug (J1939-13), 500k on the green one (J1939-14). The 250k and 500k
# classic-CAN candidates above already cover both bus speeds; these are the
# module source addresses probed once a J1939 bus is found (same list as
# mobile/src/ecu/ecuProfiles.ts J1939_MODULES).
J1939_MODULES = {
    0x00: "Engine #1", 0x03: "Transmission #1", 0x0B: "Brakes - system controller",
    0x0F: "Engine retarder", 0x17: "Instrument cluster #1", 0x21: "Body controller",
    0x31: "Cab controller - primary", 0x3D: "Exhaust emission controller",
}
J1939_TESTER_SA = 0xF9  # off-board diagnostic-service tool #1


def is_j1939_frame_id(can_id: int) -> bool:
    """True for a 29-bit extended ID (J1939 / UDS-on-J1939 traffic)."""
    return can_id > 0x7FF


def j1939_source_address(can_id: int) -> int:
    """Source address = lowest byte of a J1939 29-bit ID."""
    return can_id & 0xFF


def j1939_pgn(can_id: int) -> int:
    """PGN from a 29-bit J1939 ID (PDU1 format zeroes the destination byte)."""
    pgn = (can_id >> 8) & 0x3FFFF
    if ((pgn >> 8) & 0xFF) < 240:
        pgn &= 0x3FF00
    return pgn


PGN_DM1 = 65226  # active diagnostic trouble codes (J1939-73)


def decode_dm1_dtcs(data: bytes) -> list[dict]:
    """Decode J1939-73 DM1 DTCs (SPN/FMI/occurrence count) from a DM1
    payload: 2 lamp bytes, then 4 bytes per DTC. SPN version 4 layout."""
    out = []
    for i in range(2, len(data) - 3, 4):
        b = data[i:i + 4]
        spn = b[0] | (b[1] << 8) | ((b[2] & 0xE0) << 11)
        fmi = b[2] & 0x1F
        oc = b[3] & 0x7F
        if spn == 0 and fmi == 0:
            continue
        out.append({"spn": spn, "fmi": fmi, "occurrences": oc})
    return out




def _protocol_cache_path(vin: str) -> Path:
    return Path(f"./vin_repos/{vin}/protocol.json")


def load_protocol_cache(vin: str) -> dict | None:
    if not vin or vin == "AUTO":
        return None
    p = _protocol_cache_path(vin)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def save_protocol_cache(vin: str, candidate: dict) -> None:
    if not vin or vin == "AUTO":
        return
    p = _protocol_cache_path(vin)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(candidate, indent=2))


def autodetect_can(iface: str = "can0", listen_seconds: int = 2, vin_hint: str | None = None) -> dict | None:
    """Brings the interface up at each candidate bitrate/FD combo in turn,
    listens briefly for real traffic, and tears down between attempts.
    Returns the winning candidate dict, or None if nothing answered on any
    of them (bad wiring, unplugged adapter, or an unlisted bitrate).

    Checks the per-VIN cache first when a real VIN is already known, so
    a second session on the same car doesn't re-probe."""
    cached = load_protocol_cache(vin_hint) if vin_hint else None
    if cached:
        print(f"[autodetect] using cached protocol for VIN {vin_hint}: {cached.get('label')}")
        return cached

    for candidate in PROTOCOL_CANDIDATES:
        print(f"[autodetect] trying {candidate['label']}")
        bring_down_can(iface)
        args = ["sudo", "ip", "link", "set", iface, "up", "type", "can", "bitrate", str(candidate["bitrate"])]
        if candidate.get("fd"):
            args += ["dbitrate", str(candidate["dbitrate"]), "fd", "on"]
        if run(args) is None:
            continue
        probe = run(["timeout", str(listen_seconds), "candump", iface, "-n", "1"])
        if probe and probe.stdout.strip():
            print(f"  traffic detected on {candidate['label']}")
            return candidate

    print(f"  ! no traffic detected on {iface} at any known bitrate — check wiring/adapter, "
          "or add a new candidate to PROTOCOL_CANDIDATES for this platform")
    return None


def bring_up_can_smart(iface: str, bitrate: int, fd: bool, autodetect: bool, vin_hint: str | None = None) -> dict | None:
    """Single entry point every pipeline branch calls instead of bring_up_can()
    directly — autodetects and returns the winning candidate if --autodetect-
    protocol was passed, otherwise brings the interface up with the given
    fixed params and returns them in the same shape for a consistent caller."""
    if autodetect:
        return autodetect_can(iface, vin_hint=vin_hint)
    bring_up_can(iface, bitrate, fd)
    return {"bitrate": bitrate, "fd": fd, "label": f"manual {bitrate}{' +FD' if fd else ''}"}


# --------------------------------------------------------------------------
# Agents
# --------------------------------------------------------------------------

class Agent(ABC):
    name = "agent"

    def __init__(self, session_dir: Path):
        # Accept a plain string too — every real call site in this file
        # already passes a Path (from new_session_dir()), but coercing
        # here means a caller that doesn't gets a working agent instead
        # of a cryptic TypeError three calls deep inside outfile().
        self.session_dir = Path(session_dir)

    @abstractmethod
    def run(self, **kwargs) -> dict:
        ...

    def outfile(self, name: str) -> Path:
        return self.session_dir / name


class DiscoveryAgent(Agent):
    """ECU topology + VIN. Backed by OpenVehicleDiag / BlackFlag ECU / CaringCaribou."""
    name = "discovery"

    def run(self, iface="can0", **kwargs) -> dict:
        print("[1] Discovery — scanning bus for ECUs + VIN")
        out = self.outfile("ecu_map.json")
        # Example: swap for your installed tool's real CLI, e.g.
        # run(["ovd-cli", "scan", "--iface", iface, "--out", str(out)])
        result = {"vin": None, "ecus": [], "protocol": "ISO15765"}
        out.write_text(json.dumps(result, indent=2))
        return result

    @staticmethod
    def recognized(discovery_result: dict) -> bool:
        """Whether Discovery actually found something to work with."""
        return bool(discovery_result.get("vin") or discovery_result.get("ecus"))


class VehicleLookupAgent(Agent):
    """Fallback for when Discovery finds nothing: take manual vehicle details
    and go find a way in, instead of dead-ending.

    Two honest tiers, because a script can't silently "scrape the whole
    internet" — most sites block that:
      Tier 1 (live, automatic): GitHub's public search API — no key needed,
        works today, returns real results inline.
      Tier 2 (prepared links): sites that don't expose a fetchable API
        (pcmhacking.net, the RomRaider forum, TunerPro's XDF library) get a
        correctly-built search URL instead — you open it yourself.

    Nothing found here is auto-imported or auto-flashed. It's leads to
    review, matched against your own PCM's exact OS ID before use — the
    same PCM Hammer philosophy as the rest of this design.
    """
    name = "vehicle_lookup"

    PREPARED_SEARCH_SITES = {
        "pcmhacking.net forums": "https://pcmhacking.net/forums/search.php?terms={q}",
        "RomRaider forum": "https://www.romraider.com/forum/search.php?terms={q}",
        "TunerPro XDF library": "https://www.google.com/search?q=site:tunerpro.net+xdf+{q}",
        "general web": "https://www.google.com/search?q={q}+ECU+tune+definition+OR+xdf+OR+odx",
    }

    def run(self, make: str, model: str, year: str = "", engine: str = "",
            pcm_part_number: str = "", vin: str = "", **kwargs) -> dict:
        query_terms = " ".join(filter(None, [make, model, year, engine, pcm_part_number]))
        print(f"[vehicle-lookup] Discovery came back empty — searching for: {query_terms!r}")

        github_hits = self._github_search(query_terms)
        search_links = {name: url.format(q=urllib.parse.quote(query_terms))
                         for name, url in self.PREPARED_SEARCH_SITES.items()}

        result = {
            "query": query_terms,
            "vin_provided": bool(vin),
            "github_hits": github_hits,
            "manual_search_links": search_links,
            "warning": ("None of this is verified against your PCM. Read your own calibration "
                        "first (PCM Hammer / OpenVehicleDiag / RomRaider), and only trust a "
                        "definition or tune that matches your exact OS ID — not just your model."),
        }
        self.outfile("vehicle_lookup.json").write_text(json.dumps(result, indent=2))
        print(f"  found {len(github_hits)} GitHub candidate(s); {len(search_links)} manual search link(s) prepared")
        return result

    def _github_search(self, query_terms: str, max_results: int = 8) -> list:
        if not query_terms.strip():
            return []
        q = urllib.parse.quote(f"{query_terms} ecu OR tune OR xdf OR definition OR calibration")
        url = f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page={max_results}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                        "User-Agent": "cartune-orchestrator"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            return [{"name": item["full_name"], "description": item.get("description"),
                     "stars": item["stargazers_count"], "url": item["html_url"]}
                    for item in data.get("items", [])]
        except Exception as e:
            print(f"  ! GitHub search failed (offline, or rate-limited): {e}")
            return []


class UpdateCheckAgent(Agent):
    """Checks GitHub for new activity on every tool already in the inventory
    against what was last seen (cached in .cartune_versions.json), and
    reports only what's genuinely new — not a re-fetch of everything.

    Deliberately does NOT auto-download or auto-apply anything. A software
    release and a calibration file aren't the same kind of "update" — a
    newer tune isn't automatically safer for your specific car. This agent
    tells you a new tool release or definition exists; a human still
    reviews it. Vehicle-specific finds go through VehicleLookupAgent above.
    """
    name = "update_check"

    def run(self, **kwargs) -> dict:
        seen = json.loads(VERSION_CACHE.read_text()) if VERSION_CACHE.exists() else {}
        updates = {}
        for tool, repo in TOOL_REPOS.items():
            subpath = TOOL_REPO_SUBPATHS.get(repo)
            cache_key = f"{repo}#{subpath}" if subpath else repo
            latest = self._latest_commit(repo, subpath)
            if latest and seen.get(cache_key) != latest:
                updates[tool] = {"repo": repo, "previously_seen": seen.get(cache_key), "latest": latest}
            if latest:
                seen[cache_key] = latest

        VERSION_CACHE.write_text(json.dumps(seen, indent=2))
        out = self.outfile("update_report.json")
        out.write_text(json.dumps(updates, indent=2))
        if updates:
            print(f"[update-check] {len(updates)} tool(s) have new activity since last check:")
            for tool, info in updates.items():
                print(f"    {tool}: {info['previously_seen']} -> {info['latest']}  ({info['repo']})")
        else:
            print("[update-check] no changes since last check")
        return updates

    def digest(self, updates: dict) -> str:
        """Plain-English, one-paragraph-per-tool summary instead of a raw
        commit list — meant for a weekly cron run, not a wall of SHAs.
        Deterministic/template-based on purpose: no LLM dependency, so it
        stays testable offline like the rest of this agent."""
        if not updates:
            text = "No new activity across the tool inventory since the last check.\n"
        else:
            lines = [f"{len(updates)} tool(s) have new activity since the last check:\n"]
            for tool, info in sorted(updates.items()):
                prev = info["previously_seen"] or "(never checked before)"
                lines.append(f"- **{tool}** ({info['repo']}): new commits since {prev}, now at {info['latest']}.")
            text = "\n".join(lines) + "\n"
        self.outfile("update_digest.md").write_text(text)
        return text

    def _latest_commit(self, repo: str, subpath: str | None = None) -> str | None:
        url = f"https://api.github.com/repos/{repo}/commits?per_page=1"
        if subpath:
            url += f"&path={urllib.parse.quote(subpath)}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json",
                                                        "User-Agent": "cartune-orchestrator"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode())
            return data[0]["sha"][:10] if data else None
        except Exception:
            return None


class MobileCaptureAgent(Agent):
    """Alternate source for Discovery's VIN/ECU list and Diagnostics' DTCs/live
    data, populated by the mobile companion app over Bluetooth (design doc
    section 11) instead of a live wired bus scan — e.g. you already pulled
    codes and live PIDs at the track with a phone + BLE OBD-II dongle
    (OBDLink CX/MX+ recommended) and don't want to re-run Discovery.

    Deliberately cannot supply `current.bin` — reading the actual calibration
    binary off the PCM needs a J2534/UDS session (PCM Hammer, OpenVehicleDiag),
    not something a BLE OBD-II dongle does. The pipeline still brings up the
    wired CAN link for that read and for the eventual flash; this agent only
    replaces the network-scan/DTC-pull step, never the write path.
    """
    name = "mobile_capture"

    def run(self, capture_path: str, **kwargs) -> dict:
        print(f"[mobile-capture] loading phone-sourced capture from {capture_path}")
        data = json.loads(Path(capture_path).read_text())
        discovery = {
            "vin": data.get("vin"),
            "ecus": data.get("ecus", []),
            "protocol": data.get("protocol", "ISO15765 (via BLE OBD-II)"),
        }
        dtc_out = self.outfile("dtc_report.json")
        dtc_out.write_text(json.dumps(
            {"dtcs": data.get("dtcs", []), "live_data": data.get("live_data", {})}, indent=2
        ))
        diagnostics = {"dtc_report": str(dtc_out), "current_bin": None}
        return {"discovery": discovery, "diagnostics": diagnostics}


class SnifferAgent(Agent):
    """Raw CAN capture + DBC decode. Backed by SavvyCAN / CANgaroo / cabana + opendbc."""
    name = "sniffer"

    def run(self, iface="can0", dbc_path: str | None = None, duration=30, **kwargs) -> dict:
        print(f"[2] Sniffing bus for {duration}s")
        log_path = self.outfile("capture.log")
        # Example: candump from can-utils as the simplest possible capture
        run(["timeout", str(duration), "candump", iface, "-l", "-o", str(log_path.parent)])
        return {"capture_log": str(log_path), "dbc": dbc_path}


class DiagnosticsAgent(Agent):
    """DTCs + live data + current binary read. Backed by pyobd / ddt4all / odxtools / EcuBus-Pro."""
    name = "diagnostics"

    def run(self, **kwargs) -> dict:
        print("[3] Reading DTCs + current ECU binary")
        dtc_out = self.outfile("dtc_report.json")
        bin_out = self.outfile("current.bin")
        report = {"dtcs": [], "live_data": {}}
        dtc_out.write_text(json.dumps(report, indent=2))
        # bin_out would be populated by your J2534/UDS read-memory-by-address call.
        os_id = self._read_calibration_id()
        return {"dtc_report": str(dtc_out), "current_bin": str(bin_out), "os_id": os_id}

    @staticmethod
    def _read_calibration_id() -> str | None:
        """Mode 09 PID 0x04 (Calibration ID) is a standard SAE J1979 PID —
        public, not manufacturer-secret — so this is a real read wherever
        python-obd is installed, an adapter is connected, and the PCM
        answers Mode 09 (python-obd's own docs flag Mode 09 as
        experimental/lightly-tested, so treat a null response here as
        plausible even on a real vehicle, not necessarily a bug). Still
        returns None — never a guess — if any of those aren't true."""
        connection = _open_obd_connection()
        if connection is None:
            return None
        try:
            response = connection.query(obd.commands.CALIBRATION_ID)
            if response.is_null() or response.value is None:
                return None
            return str(response.value).strip()
        except Exception:
            return None
        finally:
            connection.close()


class DefinitionMatchAgent(Agent):
    """Matches the read binary's OS-ID against a local index of known-good
    XDF/ODX definitions (or, for HP Tuners-covered platforms, confirmation
    that the OS-ID is one HP Tuners' own VCM Editor already recognizes
    natively — HP Tuners doesn't use open XDF files, it matches OS-ID/VIN
    against its own database, so a "definition" there is really just
    "yes, open this in VCM Editor," not a file path). So TuningAgent gets
    handed the right file/tool instead of the human having to already know
    it — the same "exact OS ID, not just make/model" matching philosophy
    PCM Hammer and HP Tuners both use (design doc section 3), applied as
    its own pipeline step instead of left entirely to hand-picking a tool.

    Degrades honestly, same pattern as EBCMAgent: no OS-ID, or an OS-ID
    with no index entry, both come back `matched: False` with a `reason`
    — never a guess. The caller falls through to VehicleLookupAgent, same
    as an unrecognized-vehicle Discovery result.
    """
    name = "definition_match"

    def run(self, os_id: str | None = None, current_bin: str | None = None, **kwargs) -> dict:
        print("[definition-match] checking read binary against known definitions")
        if not os_id:
            result = {
                "matched": False,
                "os_id": None,
                "reason": ("no OS-ID was extracted from the read (DiagnosticsAgent's tool "
                           "integration doesn't populate this field yet) — cannot safely "
                           "match a definition without one"),
            }
            self.outfile("definition_match.json").write_text(json.dumps(result, indent=2))
            print(f"  ! {result['reason']}")
            return result

        entry = self._load_index().get(os_id)
        if not entry:
            result = {
                "matched": False,
                "os_id": os_id,
                "reason": f"OS-ID '{os_id}' has no entry in {DEFINITIONS_INDEX} — not yet indexed",
            }
            self.outfile("definition_match.json").write_text(json.dumps(result, indent=2))
            print(f"  ! {result['reason']}")
            return result

        result = {"matched": True, "os_id": os_id, **entry}
        self.outfile("definition_match.json").write_text(json.dumps(result, indent=2))
        flag = "" if entry.get("verified") else "  [unverified — confirm against your own PCM before trusting]"
        target = entry.get("definition_path") or "no local file — matched natively by the source tool itself"
        print(f"  matched OS-ID {os_id} -> {target} ({entry.get('source_tool')}){flag}")
        return result

    @staticmethod
    def _load_index() -> dict:
        """Missing or unreadable index just means 'nothing indexed yet' —
        never a hard error, same convention as load_tools_manifest()."""
        if not DEFINITIONS_INDEX.exists():
            return {}
        try:
            return json.loads(DEFINITIONS_INDEX.read_text())
        except (json.JSONDecodeError, OSError):
            return {}


# --------------------------------------------------------------------------
# Copilot: pluggable backend so it works offline (local LLM) or online (API)
# --------------------------------------------------------------------------

class CopilotBackend(ABC):
    @abstractmethod
    def explain(self, context: dict) -> str:
        ...


class LocalOllamaBackend(CopilotBackend):
    def __init__(self, model="llama3.1"):
        self.model = model

    def explain(self, context: dict) -> str:
        prompt = _copilot_prompt(context)
        result = run(["ollama", "run", self.model, prompt])
        return result.stdout if result else "[copilot offline: ollama not available]"


class ApiBackend(CopilotBackend):
    """Placeholder — wire this to whatever API client you have configured."""

    def explain(self, context: dict) -> str:
        # e.g. call Anthropic/OpenAI SDK here with _copilot_prompt(context)
        return "[copilot: API backend not wired up yet — see ApiBackend.explain()]"


def _copilot_prompt(context: dict) -> str:
    return (
        "You are a cautious automotive tuning copilot. Given this session context, "
        "explain any DTCs/anomalies in plain English and suggest conservative next "
        "steps. Never claim you can flash anything yourself.\n\n"
        f"{json.dumps(context, indent=2)[:6000]}"
    )


class CopilotAgent(Agent):
    name = "copilot"

    def __init__(self, session_dir: Path, backend: CopilotBackend):
        super().__init__(session_dir)
        self.backend = backend

    def run(self, discovery=None, sniffer=None, diagnostics=None, **kwargs) -> dict:
        print("[4] Copilot — summarizing findings")
        context = {"discovery": discovery, "sniffer": sniffer, "diagnostics": diagnostics}
        notes = self.backend.explain(context)
        out = self.outfile("copilot_notes.md")
        out.write_text(f"# Copilot Notes\n\n{notes}\n")
        return {"notes": str(out)}


class TuningAgent(Agent):
    """Human-driven: opens current.bin in whichever map editor you choose.

    If a tune_spec.json (exported from CarTune-Map-Input-Console.html) is
    passed in, its `segments_touched` list tells you which editor is even
    relevant before you open anything — e.g. a spec that only touches Fuel
    Calibration doesn't need a transmission-table-capable tool.
    """
    name = "tuning"

    def run(self, current_bin: str, editor="linols", tune_spec: str | None = None, **kwargs) -> dict:
        spec = None
        if tune_spec and Path(tune_spec).exists():
            spec = json.loads(Path(tune_spec).read_text())
            print(f"[5] Tuning — spec '{spec.get('profile')}' touches: {', '.join(spec.get('segments_touched', []))}")
            shutil.copy(tune_spec, self.outfile("tune_spec.json"))

        print(f"[5] Tuning — opening {current_bin} in {editor} (human edits happen here)")

        # setup_tools.sh knows the *real* launch command for whatever it
        # actually managed to install (e.g. LinOLS isn't a "linols" binary
        # on PATH — it's a cloned script you run as `python3 main.py` from
        # its own directory). Prefer that over the placeholder guesses below
        # when it's available. Manifest entries are read from disk (possibly
        # hand-edited) so a malformed one — status "ok" with no run_hint —
        # falls through to the placeholder branch instead of crashing.
        manifest_entry = load_tools_manifest().get(editor) or {}
        manifest_run_hint = manifest_entry.get("run_hint") if manifest_entry.get("status") == "ok" else None
        if manifest_run_hint:
            print(f"  using verified launch command from setup_tools.sh: {manifest_run_hint}")
            if manifest_entry.get("note"):
                print(f"  note: {manifest_entry['note']}")
            print(f"  (no documented CLI flag to preload a file — load {current_bin} via the app's own file picker)")
            cmd = ["bash", "-c", manifest_run_hint]
        else:
            # Unverified placeholders for tools setup_tools.sh doesn't install
            # yet (or that haven't been run through it on this machine). Swap
            # these for the real CLI once you've verified it against the
            # tool's own docs — see CLAUDE.md.
            editors = {
                "linols": ["linols", current_bin],
                "romraider": ["romraider", "--rom", current_bin],
                "hypertuner": ["hypertuner", "--open", current_bin],
                "tunerpro": ["tunerpro", current_bin],   # Windows/Wine
                "pcmhammer": ["pcmhammer", "read", current_bin],
                # HP Tuners VCM Editor — confirmed real for Ford/GM platforms
                # (verified against an actual .hpt tune: 2006 Ford Barra I6
                # ECM, "Spanish Oak 1024K" hardware, OS-ID HACCKG6). Windows-
                # only, GUI-driven — no documented CLI flag to preload a file,
                # same as LinOLS/TunerPro above, so this binary name is still
                # an unverified guess even though the tool itself is real.
                "hptuners": ["vcmeditor", current_bin],  # Windows/Wine
            }
            cmd = editors.get(editor)

        if cmd:
            run(cmd)
        else:
            # Degrade honestly instead of silently no-op'ing — same principle
            # EBCMAgent applies when it can't safely act.
            print(f"  ! no known way to launch editor '{editor}' — nothing was opened. "
                  "Run setup_tools.sh for this tool, or add it to TuningAgent's editors dict.")
        proposed = self.outfile("proposed.bin")
        if Path(current_bin).exists() and not proposed.exists():
            shutil.copy(current_bin, proposed)  # placeholder until real edit is saved
        return {"proposed_bin": str(proposed), "tune_spec": spec}


class PidCaptureAgent(Agent):
    """Live-PID polling loop for a WOT pull — the missing piece that makes
    --pid-log real instead of requiring hand-built JSON. Polls the four
    signals SelfLoggedPullAgent needs (rpm, knock_retard, afr, coolant_c)
    at a fixed rate between an explicit start and stop trigger (Enter to
    start, Enter again to stop), and writes them straight into the JSON
    shape SelfLoggedPullAgent already reads.

    rpm and coolant_c are REAL reads via python-obd's standard Mode 01
    PIDs (0x0C, 0x05) — public SAE J1979 PIDs, not manufacturer-secret —
    wherever the library's installed and an adapter answers. knock_retard
    and a precise afr are a genuine platform-specific gap: most PCMs don't
    expose them on standard PIDs at all, so pass a `custom_pid_reader`
    callable (zero-arg, returns a dict like {"knock_retard": ..., "afr":
    ...} or None) sourced from ddt4all/EcuBus-Pro/your own tool for this
    exact platform — same "degrade honestly, never fabricate" convention
    as every other agent here. A sample is only kept if at least one real
    value came back; an all-None sample is a dropped read, not a data point.
    """
    name = "pid_capture"

    def __init__(self, session_dir: Path, custom_pid_reader=None):
        super().__init__(session_dir)
        self.custom_pid_reader = custom_pid_reader
        self._connection = None

    def run(self, poll_hz: float = 10.0, **kwargs) -> dict:
        print("[pid-capture] logging rpm/knock_retard/afr/coolant_c for a WOT pull")
        self._connection = _open_obd_connection()
        if self._connection is None:
            print("  ! no python-obd connection — rpm/coolant_c will be None too unless "
                  "a custom_pid_reader is supplying everything (install `obd`, connect an "
                  "adapter, or pass --pid-log a file built some other way)")
        try:
            input("  ready — press Enter to START logging... ")
            stop = threading.Event()
            threading.Thread(target=lambda: (input(), stop.set()), daemon=True).start()
            print("  logging — press Enter to STOP")
            return self.capture_until(stop, poll_hz=poll_hz)
        finally:
            if self._connection is not None:
                self._connection.close()

    def capture_until(self, stop_event: threading.Event, poll_hz: float = 10.0) -> dict:
        """The actual polling loop, kept separate from the Enter-to-start/
        stop wiring in run() so it's directly testable: pass a stop_event
        that's already set (captures nothing) or one a test sets after N
        calls to read_pids(), without ever blocking on real stdin."""
        samples = []
        interval = 1.0 / poll_hz
        while not stop_event.is_set():
            sample = self.read_pids()
            if sample is not None:
                samples.append(sample)
            time.sleep(interval)

        out = self.outfile("pid_capture.json")
        out.write_text(json.dumps(samples, indent=2))
        print(f"  captured {len(samples)} sample(s) -> {out.name}")
        return {"pid_log": str(out), "samples": len(samples)}

    def read_pids(self) -> dict | None:
        """One instantaneous read. rpm/coolant_c come from a real python-obd
        query when a connection is open; knock_retard/afr come from
        custom_pid_reader if one was supplied. Returns None if every field
        came back empty — a dropped/unavailable read, not a fabricated
        zero-signal sample."""
        sample = {"rpm": None, "coolant_c": None}

        if self._connection is not None and obd is not None:
            try:
                rpm_resp = self._connection.query(obd.commands.RPM)
                if not rpm_resp.is_null() and rpm_resp.value is not None:
                    sample["rpm"] = getattr(rpm_resp.value, "magnitude", rpm_resp.value)
            except Exception:
                pass
            try:
                coolant_resp = self._connection.query(obd.commands.COOLANT_TEMP)
                if not coolant_resp.is_null() and coolant_resp.value is not None:
                    sample["coolant_c"] = getattr(coolant_resp.value, "magnitude", coolant_resp.value)
            except Exception:
                pass

        if self.custom_pid_reader is not None:
            try:
                extra = self.custom_pid_reader() or {}
                sample.update(extra)
            except Exception:
                pass  # a broken custom reader shouldn't kill the whole sample

        if all(v is None for v in sample.values()):
            return None
        return sample


class SelfLoggedPullAgent(Agent):
    """Converts a raw live-PID capture (from DiagnosticsAgent / pyobd /
    EcuBus-Pro during a WOT pull) into the same CSV schema DynoLogAgent
    already expects — so the safety gate doesn't require owning or renting
    an actual chassis dyno.

    What DynoLogAgent actually checks — knock retard, AFR, coolant temp —
    is an engine-damage protection, not a dyno-specific measurement, and
    it applies the same way whether the pull happened on a dyno, a closed
    road, a track, or off-road. This agent's only job is making that data
    reachable from a self-logged pull; it does NOT estimate power/torque,
    and it doesn't relax any threshold DynoLogAgent checks — a self-logged
    pull that shows excess knock fails exactly the same as a dyno pull
    that shows excess knock.

    Expects a JSON file: a list of sample dicts, each covering one instant
    during the pull. Column names are matched against common aliases
    (see PID_MAP) since different logging tools name PIDs differently.
    """
    name = "self_logged_pull"

    PID_MAP = {
        "rpm": ["rpm", "engine_rpm"],
        "knock_retard_deg": ["knock_retard", "knock_retard_deg", "spark_retard", "spark_retard_deg"],
        "afr": ["afr", "air_fuel_ratio", "lambda_afr"],
        "coolant_c": ["coolant_c", "coolant_temp_c", "ect_c", "engine_coolant_temp_c"],
    }

    def run(self, pid_log_path: str, **kwargs) -> dict:
        import csv
        print(f"[self-logged-pull] converting {pid_log_path} to the dyno-log CSV schema")
        samples = json.loads(Path(pid_log_path).read_text())

        if not samples:
            result = {"converted": False, "reason": "PID log has zero samples — no pull was actually captured"}
            self.outfile("self_logged_pull_report.json").write_text(json.dumps(result, indent=2))
            print(f"  ! {result['reason']}")
            return result

        available = set(samples[0].keys())
        resolved, missing = {}, []
        for target, aliases in self.PID_MAP.items():
            found = next((a for a in aliases if a in available), None)
            if found:
                resolved[target] = found
            else:
                missing.append(target)

        if missing:
            result = {
                "converted": False,
                "reason": (f"PID log is missing required signal(s): {missing} "
                           f"(have: {sorted(available)}) — this pull can't satisfy the safety gate "
                           "without all four"),
            }
            self.outfile("self_logged_pull_report.json").write_text(json.dumps(result, indent=2))
            print(f"  ! {result['reason']}")
            return result

        out_csv = self.outfile("self_logged_pull.csv")
        with open(out_csv, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(self.PID_MAP.keys()))
            writer.writeheader()
            for row in samples:
                writer.writerow({target: row[src] for target, src in resolved.items()})

        result = {"converted": True, "csv_path": str(out_csv), "samples": len(samples), "resolved_from": resolved}
        self.outfile("self_logged_pull_report.json").write_text(json.dumps(result, indent=2))
        print(f"  wrote {len(samples)} sample(s) -> {out_csv.name}")
        return result


class DynoLogAgent(Agent):
    """Checks a WOT-pull log against safety thresholds — knock, AFR, coolant.

    This is what a static old-vs-new byte diff can never catch: whether the
    engine actually knocked, went lean, or overheated under load. Source-
    agnostic by design: the CSV can come from real dyno software (DynoJet/
    WinPEP, Dynapack, Mainline), a standalone wideband/knock logger, or
    SelfLoggedPullAgent's conversion of a self-logged road/track/off-road
    pull — same schema, same thresholds, same gate either way. Expected
    columns (case-insensitive): rpm, knock_retard_deg, afr, coolant_c.
    """
    name = "dynolog"
    REQUIRED_COLUMNS = ["rpm", "knock_retard_deg", "afr", "coolant_c"]

    def run(self, log_path: str, afr_target: float = 12.8, knock_limit_deg: float = 2.0,
            coolant_limit_c: float = 110.0, **kwargs) -> dict:
        import csv
        print(f"[dynolog] parsing live pull log: {log_path}")
        with open(log_path, newline="") as f:
            reader = csv.DictReader(f)
            headers = [h.strip().lower() for h in (reader.fieldnames or [])]
            missing = [c for c in self.REQUIRED_COLUMNS if c not in headers]
            if missing:
                report = {"passed": False, "failures": [f"log is missing required column(s): {missing}"]}
                self.outfile("dyno_log_report.json").write_text(json.dumps(report, indent=2))
                return report
            rows = [{k.strip().lower(): v for k, v in row.items()} for row in reader]

        if not rows:
            report = {"passed": False, "failures": ["log has the required columns but zero data rows — no pull was actually captured"]}
            self.outfile("dyno_log_report.json").write_text(json.dumps(report, indent=2))
            return report

        worst_knock = max((float(r["knock_retard_deg"]) for r in rows), default=0.0)
        leanest_afr = max((float(r["afr"]) for r in rows), default=0.0)  # higher number = leaner
        hottest_c = max((float(r["coolant_c"]) for r in rows), default=0.0)

        failures = []
        if worst_knock > knock_limit_deg:
            failures.append(f"knock retard hit {worst_knock}°, limit is {knock_limit_deg}°")
        if leanest_afr > afr_target + 0.5:
            failures.append(f"AFR went as lean as {leanest_afr}:1 against a {afr_target}:1 target")
        if hottest_c > coolant_limit_c:
            failures.append(f"coolant hit {hottest_c}°C, limit is {coolant_limit_c}°C")

        report = {
            "passed": len(failures) == 0,
            "samples": len(rows),
            "worst_knock_deg": worst_knock,
            "leanest_afr": leanest_afr,
            "hottest_coolant_c": hottest_c,
            "failures": failures,
        }
        self.outfile("dyno_log_report.json").write_text(json.dumps(report, indent=2))
        if failures:
            print(f"  ! Dyno log FAILED: {failures}")
        return report


class EBCMAgent(Agent):
    """Handles traction/stability fields — these live in the EBCM, a separate
    module from the engine PCM, not something any engine-tuning tool reaches.

    Degrades honestly instead of silently no-op'ing: if no ODX/DBC signal
    definition for the EBCM is supplied, it says so plainly rather than
    pretending the change was applied.
    """
    name = "ebcm"

    def run(self, traction_value: str | None, ebcm_odx: str | None = None,
            discovered_ecus: list | None = None, **kwargs) -> dict:
        if not traction_value:
            return {"attempted": False, "reason": "no traction/stability change requested"}

        print(f"[ebcm] traction/stability change requested: '{traction_value}'")
        result = {"attempted": True, "requested_value": traction_value}

        if discovered_ecus and not any("ebcm" in str(e).lower() for e in discovered_ecus):
            result.update(success=False, reason=(
                "Discovery Agent's network scan did not report an EBCM on this bus — "
                "confirm it responds before assuming this can be reached at all."
            ))
            print(f"  ! {result['reason']}")
            self.outfile("ebcm_result.json").write_text(json.dumps(result, indent=2))
            return result

        if not ebcm_odx:
            result.update(success=False, reason=(
                "No ODX/DBC definition supplied for the EBCM (--ebcm-odx) — cannot safely "
                "map 'traction_threshold' to a real DID/table. Upload one in "
                "CarTune-Map-Input-Console.html to confirm reachability first, or set this "
                "by hand in whatever tool your EBCM vendor actually supports."
            ))
            print(f"  ! {result['reason']}")
            self.outfile("ebcm_result.json").write_text(json.dumps(result, indent=2))
            return result

        # With a real ODX/DBC definition in hand, this opens its own UDS session
        # against the EBCM's diagnostic address (found by Discovery's full-network
        # scan, not just the PCM's) via odxtools/ddt4all/EcuBus-Pro and writes the
        # matching DID/signal. The exact call is left as an integration point since
        # the definition format and DID naming vary per OEM/module.
        # run(["odx-write", "--odx", ebcm_odx, "--did", "TractionThreshold", "--value", traction_value])
        result.update(success=None, reason="ODX/DBC supplied — wire in your odxtools/ddt4all/EcuBus-Pro call here")
        self.outfile("ebcm_result.json").write_text(json.dumps(result, indent=2))
        return result


class ValidatorAgent(Agent):
    """Diff + safety-limit checks + verified WOT-pull gate + second copilot
    pass + human confirm gate.

    The gate below is deliberately about ENGINE-DAMAGE protection (knock,
    lean AFR, overheat), not about a dyno specifically or about road-legal
    status. That data can come from a real chassis dyno (--dyno-log) or a
    self-logged road/track/off-road pull captured from the vehicle's own
    PID stream (--pid-log, converted by SelfLoggedPullAgent) — either way
    it's checked against the exact same thresholds. Nothing here is a
    legal/emissions check, and nothing here is waived for off-road use;
    the physics of detonation and lean-mixture damage don't care where
    the vehicle is driven."""
    name = "validator"

    DAY_USE_OR_BELOW = {"None (baseline)", "ECU remap only", "Stage 1"}

    def __init__(self, session_dir: Path, backend: CopilotBackend):
        super().__init__(session_dir)
        self.backend = backend

    def run(self, current_bin: str, proposed_bin: str, tune_spec: dict | None = None,
            dyno_log: str | None = None, pid_log: str | None = None, **kwargs) -> dict:
        print("[6] Validating proposed map against safety limits")
        limits_ok = self._check_limits(current_bin, proposed_bin, tune_spec)
        if not limits_ok:
            report = {"limits_ok": False, "limit_failures": self.limit_failures,
                      "reason": "safety limits failed: " + "; ".join(self.limit_failures)}
            out = self.outfile("validation_report.json")
            out.write_text(json.dumps(report, indent=2))
            print(f"  ! {report['reason']}")
            return {"approved": False, "report": str(out)}

        power_stage = (tune_spec or {}).get("values", {}).get("power_stage", "Stage 1")
        needs_pull_data = power_stage not in self.DAY_USE_OR_BELOW
        dyno_result = None

        if needs_pull_data:
            pull_log = dyno_log
            if not pull_log and pid_log:
                conversion = SelfLoggedPullAgent(self.session_dir).run(pid_log_path=pid_log)
                if conversion.get("converted"):
                    pull_log = conversion["csv_path"]
                else:
                    report = {
                        "limits_ok": False,
                        "reason": f"--pid-log was provided but couldn't be converted: {conversion.get('reason')}",
                    }
                    out = self.outfile("validation_report.json")
                    out.write_text(json.dumps(report, indent=2))
                    print(f"  ! {report['reason']}")
                    return {"approved": False, "report": str(out)}

            if not pull_log:
                report = {
                    "limits_ok": False,
                    "reason": (
                        f"power stage '{power_stage}' is beyond Day Use — verified WOT-pull data "
                        "(knock retard, AFR, coolant) is required before this is trustworthy. That "
                        "can come from a real dyno session (--dyno-log) OR a self-logged road/track/"
                        "off-road pull from your own PID stream (--pid-log) — a dyno isn't required, "
                        "but one of the two is. Neither was provided."
                    ),
                }
                out = self.outfile("validation_report.json")
                out.write_text(json.dumps(report, indent=2))
                print(f"  ! {report['reason']}")
                return {"approved": False, "report": str(out)}

            afr_target = float((tune_spec or {}).get("values", {}).get("afr_wot", 12.8))
            dyno_result = DynoLogAgent(self.session_dir).run(log_path=pull_log, afr_target=afr_target)
            if not dyno_result["passed"]:
                report = {"limits_ok": False, "dyno_log": dyno_result}
                out = self.outfile("validation_report.json")
                out.write_text(json.dumps(report, indent=2))
                print(f"  ! Pull data failed safety thresholds: {dyno_result['failures']}")
                return {"approved": False, "report": str(out)}

        review = self.backend.explain({
            "action": "review_diff",
            "current_bin": current_bin,
            "proposed_bin": proposed_bin,
            "dyno_result": dyno_result,
        })
        report = {"limits_ok": limits_ok, "dyno_log": dyno_result, "copilot_review": review}
        out = self.outfile("validation_report.json")
        out.write_text(json.dumps(report, indent=2))

        answer = input("  Copilot review above — proceed with flash? [y/N] ").strip().lower()
        return {"approved": answer == "y", "report": str(out)}

    # Hard sanity bounds on the requested values. These are deliberately wide
    # "something is clearly wrong" limits, not a tune recommendation — they
    # exist so a typo (66000 rpm, AFR 1.26) can never reach the ECU.
    SPEC_BOUNDS = {
        "rev_limiter_rpm": (1500.0, 9500.0),
        "shift_wot_rpm": (1500.0, 9500.0),
        "shift_partthrottle_rpm": (1000.0, 9500.0),
        "tcc_lockup_rpm": (600.0, 6000.0),
        "afr_wot": (10.0, 13.8),
        "afr_cruise": (12.5, 17.0),
    }

    def _check_limits(self, current_bin: str, proposed_bin: str,
                      tune_spec: dict | None = None) -> bool:
        """Real checks that don't need a per-PCM XDF: both images exist and
        are readable, are the same size (a calibration edit never changes
        the image size), the proposed image isn't blank/erased, and every
        numeric value in the tune spec sits inside SPEC_BOUNDS. Per-offset
        table checks still need a definition file and are future work — this
        never pretends to do them. Failures are recorded on
        self.limit_failures so the report says exactly why."""
        failures: list[str] = []
        cur, prop = Path(current_bin), Path(proposed_bin)
        if not cur.is_file():
            failures.append(f"current image not found: {cur}")
        if not prop.is_file():
            failures.append(f"proposed image not found: {prop}")
        if not failures:
            cur_b, prop_b = cur.read_bytes(), prop.read_bytes()
            if not prop_b:
                failures.append("proposed image is empty")
            elif len(cur_b) != len(prop_b):
                failures.append(
                    f"size mismatch: current {len(cur_b)} bytes vs proposed {len(prop_b)} bytes"
                )
            elif set(prop_b) <= {0x00} or set(prop_b) <= {0xFF}:
                failures.append("proposed image is blank (all 0x00 or all 0xFF)")

        values = (tune_spec or {}).get("values", {}) or {}
        for key, (lo, hi) in self.SPEC_BOUNDS.items():
            raw = values.get(key)
            if raw in (None, "", "N/A"):
                continue
            try:
                val = float(str(raw).replace("%", "").strip())
            except ValueError:
                failures.append(f"{key}: '{raw}' is not a number")
                continue
            if not (lo <= val <= hi):
                failures.append(f"{key}: {val:g} is outside the sanity range {lo:g}-{hi:g}")
        try:
            rev = float(values.get("rev_limiter_rpm"))
            shift = float(values.get("shift_wot_rpm"))
            if shift > rev:
                failures.append(f"shift_wot_rpm {shift:g} is above rev_limiter_rpm {rev:g}")
        except (TypeError, ValueError):
            pass

        self.limit_failures = failures
        return not failures


class FlasherAgent(Agent):
    """Writes proposed.bin to the ECU through a configured flash command,
    then verifies it by reading back and comparing SHA-256.

    Degrades honestly: with no flash tool configured, it reports
    flashed=False and says why — it never claims a write that didn't
    happen. The command comes from --flash-cmd or CARTUNE_FLASH_CMD, with
    {file} replaced by the image path (e.g. a jakka351 Spanish Oak tool or
    PCM Hammer CLI). An optional readback command ({out} = where to save
    the read) enables verified=True; without one, verified stays False."""
    name = "flasher"

    def __init__(self, session_dir: Path, flash_cmd: str | None = None,
                 readback_cmd: str | None = None):
        super().__init__(session_dir)
        self.flash_cmd = flash_cmd or os.environ.get("CARTUNE_FLASH_CMD")
        self.readback_cmd = readback_cmd or os.environ.get("CARTUNE_READBACK_CMD")

    def _result(self, **fields) -> dict:
        out = self.outfile("flash_result.json")
        out.write_text(json.dumps(fields, indent=2))
        fields["report"] = str(out)
        return fields

    def run(self, proposed_bin: str, **kwargs) -> dict:
        print(f"[7] Flashing {proposed_bin} to ECU")
        image = Path(proposed_bin)
        if not image.is_file():
            print("  ! proposed image missing — nothing written")
            return self._result(flashed=False, verified=False, reason=f"image not found: {image}")
        expected = hashlib.sha256(image.read_bytes()).hexdigest()

        if not self.flash_cmd:
            reason = ("no flash tool configured (set --flash-cmd or CARTUNE_FLASH_CMD) — "
                      "nothing was written to the ECU")
            print(f"  ! {reason}")
            return self._result(flashed=False, verified=False, sha256=expected, reason=reason)

        cmd = shlex.split(self.flash_cmd.replace("{file}", str(image)))
        if run(cmd) is None:
            reason = "flash command failed — treat the ECU state as unknown and re-read before driving"
            print(f"  ! {reason}")
            return self._result(flashed=False, verified=False, sha256=expected, reason=reason)

        if not self.readback_cmd:
            reason = "flash command exited cleanly but no readback tool is configured — write is UNVERIFIED"
            print(f"  ! {reason}")
            return self._result(flashed=True, verified=False, sha256=expected, reason=reason)

        readback = self.outfile("readback.bin")
        rb_cmd = shlex.split(self.readback_cmd.replace("{out}", str(readback)))
        if run(rb_cmd) is None or not readback.is_file():
            reason = "readback failed — write is UNVERIFIED"
            print(f"  ! {reason}")
            return self._result(flashed=True, verified=False, sha256=expected, reason=reason)

        actual = hashlib.sha256(readback.read_bytes()).hexdigest()
        if actual != expected:
            reason = f"readback checksum MISMATCH (expected {expected}, got {actual}) — do not drive"
            print(f"  ! {reason}")
            return self._result(flashed=True, verified=False, sha256=expected,
                                readback_sha256=actual, reason=reason)

        print("  ✓ readback matches what was sent")
        return self._result(flashed=True, verified=True, sha256=expected, readback_sha256=actual)


class LoggerAgent(Agent):
    """Commits the session artifacts to a per-VIN git repo.

    Uses a repo-local identity (-c user.name/-c user.email) so the commit
    works on machines with no global git config, and reports committed=False
    honestly if git is missing or the commit fails — the files are still
    copied either way."""
    name = "logger"

    GIT_IDENTITY = ["-c", "user.name=CarTune OS", "-c", "user.email=cartune@localhost"]

    def __init__(self, session_dir: Path, repos_root: Path | str = "./vin_repos"):
        super().__init__(session_dir)
        self.repos_root = Path(repos_root)

    def run(self, vin: str, **kwargs) -> dict:
        print(f"[8] Saving session for VIN {vin} to git")
        repo = self.repos_root / (vin or "unknown")
        repo.mkdir(parents=True, exist_ok=True)
        copied = []
        for f in self.session_dir.glob("*"):
            if f.is_file():
                shutil.copy(f, repo / f.name)
                copied.append(f.name)

        git = ["git", "-C", str(repo)]
        if run(git + ["init"]) is None:
            return {"repo": str(repo), "copied": copied, "committed": False,
                    "reason": "git init failed or git is not installed — files copied, not committed"}
        if run(git + ["add", "."]) is None:
            return {"repo": str(repo), "copied": copied, "committed": False, "reason": "git add failed"}
        status = run(git + ["status", "--porcelain"])
        if status is not None and not status.stdout.strip():
            return {"repo": str(repo), "copied": copied, "committed": False,
                    "reason": "nothing changed since the last commit"}
        msg = f"CarTune session {self.session_dir.name}"
        if run(git + self.GIT_IDENTITY + ["commit", "-m", msg]) is None:
            return {"repo": str(repo), "copied": copied, "committed": False, "reason": "git commit failed"}
        return {"repo": str(repo), "copied": copied, "committed": True}


class TuneHistoryAgent(Agent):
    """Auto-snapshots every binary that matters so a bad tune is always
    recoverable — no separate 'remember to back this up' step.

    Runs automatically twice per session: once right after the very first
    read (the baseline, before you've touched a single cell), and once
    right before any flash (the outgoing version). Also supports listing
    and reverting across sessions via one shared manifest per VIN.
    """
    name = "tune_history"

    def run(self, vin: str = "", **kwargs) -> dict:
        """Callers use snapshot()/list()/get_bin_path() directly; this just
        satisfies the Agent ABC and gives a sane result if invoked generically."""
        return {"history": self.list(vin)}

    def _repo(self, vin: str) -> Path:
        repo = Path(f"./vin_repos/{vin or 'unknown'}/tune_history")
        repo.mkdir(parents=True, exist_ok=True)
        return repo

    def _manifest_path(self, vin: str) -> Path:
        return self._repo(vin) / "manifest.json"

    def snapshot(self, vin: str, bin_path: str, title: str, tune_spec: dict | None = None) -> dict | None:
        if not Path(bin_path).exists():
            return None
        repo = self._repo(vin)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        safe_title = "".join(c if c.isalnum() else "_" for c in title)[:40] or "untitled"
        dest = repo / f"{stamp}__{safe_title}.bin"
        shutil.copy(bin_path, dest)
        checksum = hashlib.sha256(dest.read_bytes()).hexdigest()[:16]

        manifest_path = self._manifest_path(vin)
        manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
        # Storing tune_spec here (not just the title) is what lets --revert
        # re-apply the *same* safety requirements (e.g. the dyno-log gate)
        # the tune originally needed, instead of forgetting its power stage.
        entry = {"id": dest.stem, "timestamp": stamp, "title": title, "file": dest.name,
                 "sha256": checksum, "tune_spec": tune_spec}
        manifest.append(entry)
        manifest_path.write_text(json.dumps(manifest, indent=2))
        print(f"[tune-history] auto-saved '{title}' -> {dest.name}")
        return entry

    def list(self, vin: str) -> list:
        manifest_path = self._manifest_path(vin)
        return json.loads(manifest_path.read_text()) if manifest_path.exists() else []

    def get_bin_path(self, vin: str, version_id: str) -> Path | None:
        for entry in self.list(vin):
            if entry["id"] == version_id:
                return self._repo(vin) / entry["file"]
        return None

    def get_tune_spec(self, vin: str, version_id: str) -> dict | None:
        """The tune_spec captured alongside a snapshot, if any. Older snapshots
        (recorded before this field existed) legitimately have none — callers
        must treat that as 'power stage unknown', not 'Day Use', so they don't
        silently skip a safety gate the original tune actually needed."""
        for entry in self.list(vin):
            if entry["id"] == version_id:
                return entry.get("tune_spec")
        return None


class CommunityTuneAgent(Agent):
    """Opt-in, local-first shared repo of validated tune_specs keyed by
    OS-ID instead of VIN — so a second owner of the same PCM OS doesn't
    start from zero the way VehicleLookupAgent's candidates do.

    Deliberately stores tune_spec.json + validation_report diffs only,
    never binaries — same boundary VehicleLookupAgent already holds:
    a lead to review, matched against your own PCM's exact OS ID, never
    something auto-imported or auto-flashed.

    Publishing is gated on an actually-passed validation: an unvalidated
    or failed spec can't be published, so this can't become a place bad
    tunes get copy-pasted around. This is a real gate, not a formality —
    same "degrade honestly" pattern as EBCMAgent/DefinitionMatchAgent.

    This scaffold writes to a local directory (COMMUNITY_TUNES_DIR) rather
    than pushing to a real shared git remote — wiring an actual remote
    (and any moderation beyond the pass/fail gate below) is a v2 decision,
    not assumed here.
    """
    name = "community_tune"

    def _repo(self, os_id: str) -> Path:
        repo = COMMUNITY_TUNES_DIR / os_id
        repo.mkdir(parents=True, exist_ok=True)
        return repo

    def publish(self, os_id: str, tune_spec: dict, validation_report: dict) -> dict:
        if not os_id:
            result = {"published": False, "reason": "no OS-ID supplied — can't key this to a specific PCM"}
            self.outfile("community_publish_result.json").write_text(json.dumps(result, indent=2))
            print(f"[community-tune] ! {result['reason']}")
            return result

        limits_ok = validation_report.get("limits_ok")
        dyno_log = validation_report.get("dyno_log")
        passed_gate = bool(limits_ok) and (dyno_log is None or dyno_log.get("passed") is True)
        if not passed_gate:
            result = {
                "published": False,
                "reason": ("validation_report shows this tune did not pass the safety gate "
                           "(limits_ok / pull-data check) — only validated tunes can be shared"),
            }
            self.outfile("community_publish_result.json").write_text(json.dumps(result, indent=2))
            print(f"[community-tune] ! {result['reason']}")
            return result

        repo = self._repo(os_id)
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        title = "".join(c if c.isalnum() else "_" for c in tune_spec.get("profile", "untitled"))[:40]
        dest = repo / f"{stamp}__{title}.json"
        dest.write_text(json.dumps({"tune_spec": tune_spec, "validation_report": validation_report}, indent=2))

        result = {"published": True, "os_id": os_id, "path": str(dest)}
        self.outfile("community_publish_result.json").write_text(json.dumps(result, indent=2))
        print(f"[community-tune] published -> {dest}")
        return result

    def list_for_os_id(self, os_id: str) -> list:
        repo = COMMUNITY_TUNES_DIR / os_id
        if not repo.exists():
            return []
        entries = []
        for f in sorted(repo.glob("*.json")):
            try:
                data = json.loads(f.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            entries.append({"file": f.name, "profile": data.get("tune_spec", {}).get("profile"), "path": str(f)})
        return entries

    def run(self, os_id: str = "", **kwargs) -> dict:
        """Callers use publish()/list_for_os_id() directly; this just
        satisfies the Agent ABC."""
        return {"available": self.list_for_os_id(os_id)}


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------

SAFETY_BANNER = """\
==============================================================================
 CarTune OS writes calibrations directly to your vehicle's ECU.
 A failed or interrupted write can immobilize the vehicle, or in rare
 cases damage the module. Keep the adapter connected and powered until
 a step tells you it's safe to unplug. Community-maintained, NO WARRANTY
 — you are responsible for verifying every value before it's flashed.
 See README.md and LICENSE.
==============================================================================
"""


def main():
    # Electrical diagnostics calculators (voltage drop, battery/charging,
    # parasitic draw, fuse-drop current, CAN termination, sensors). Pure
    # calculators on technician-entered readings — never touches the car or
    # the ECU, so it skips the flashing safety banner and the pipeline below.
    #   python3 cartune_orchestrator.py --electrical-diag battery --volts 12.4
    if len(sys.argv) > 1 and sys.argv[1] == "--electrical-diag":
        import electrical_diag
        return electrical_diag.main(sys.argv[2:])
    print(SAFETY_BANNER)
    parser = argparse.ArgumentParser(description="CarTune multi-agent pipeline")
    parser.add_argument("--iface", default="can0")
    parser.add_argument("--bitrate", type=int, default=500000)
    parser.add_argument("--fd", action="store_true")
    parser.add_argument("--autodetect-protocol", action="store_true", help="Probe known bitrate/FD combos instead of requiring --bitrate/--fd to already be correct; caches the result per-VIN")
    parser.add_argument("--editor", default="linols", choices=["linols", "romraider", "hypertuner", "tunerpro", "pcmhammer", "hptuners"])
    parser.add_argument("--copilot", default="local", choices=["local", "api"])
    parser.add_argument("--tune-spec", default=None, help="tune_spec.json exported from CarTune-Map-Input-Console.html (or authored on the mobile companion app)")
    parser.add_argument("--mobile-capture", default=None, help="mobile_capture.json from the Bluetooth companion app (VIN/ECUs/DTCs/live data) — replaces the live Discovery network scan; a wired CAN link is still required for the binary read + flash")
    parser.add_argument("--flash-cmd", default=None, help="Command that writes the image to the ECU, {file} = image path (or set CARTUNE_FLASH_CMD). Without it, nothing is flashed.")
    parser.add_argument("--readback-cmd", default=None, help="Command that reads the ECU back, {out} = where to save it (or set CARTUNE_READBACK_CMD). Without it, flashes are reported UNVERIFIED.")
    parser.add_argument("--dyno-log", default=None, help="CSV from a real dyno pull (rpm, knock_retard_deg, afr, coolant_c) — required for anything beyond Day Use, unless --pid-log is used instead")
    parser.add_argument("--pid-log", default=None, help="JSON live-PID capture from a self-logged road/track/off-road WOT pull — converted by SelfLoggedPullAgent into the same CSV schema as --dyno-log; a dyno isn't required, but one of the two is, for anything beyond Day Use")
    parser.add_argument("--capture-pull", action="store_true", help="Log a live WOT pull via PidCaptureAgent (Enter to start/stop), then exit — feed the resulting pid_capture.json into --pid-log on your next tuning run")
    parser.add_argument("--poll-hz", type=float, default=10.0, help="Sampling rate for --capture-pull")
    parser.add_argument("--ebcm-odx", default=None, help="ODX/DBC signal definition for the EBCM, if you have one — required to touch traction/stability")
    parser.add_argument("--vin", default="AUTO")

    # Unrecognized-vehicle fallback
    parser.add_argument("--manual-vehicle", action="store_true", help="Discovery failed — search using manually entered details instead")
    parser.add_argument("--make", default="")
    parser.add_argument("--model", default="")
    parser.add_argument("--year", default="")
    parser.add_argument("--engine", default="")
    parser.add_argument("--pcm-part-number", default="")

    # Update check (standalone mode — doesn't touch the car at all)
    parser.add_argument("--check-updates", action="store_true", help="Check GitHub for new activity on the tool inventory, then exit")
    parser.add_argument("--digest", action="store_true", help="With --check-updates: also write a plain-English per-tool summary (update_digest.md) instead of just the raw report — meant for a weekly cron run")
    parser.add_argument("--list-tools", action="store_true", help="Show what setup_tools.sh actually installed on this machine, then exit")

    # Tune history / revert (standalone modes)
    parser.add_argument("--list-history", action="store_true", help="List saved tune snapshots for --vin, then exit")
    parser.add_argument("--revert", default=None, metavar="VERSION_ID", help="Re-flash a previously saved snapshot (still goes through Validator+Flasher)")

    # Community shared-tune repo (opt-in)
    parser.add_argument("--publish-tune", action="store_true", help="After a successful flash, publish this session's tune_spec + validation_report to the local community repo (requires a passed validation — see CommunityTuneAgent)")
    parser.add_argument("--check-community", default=None, metavar="OS_ID", help="List published community tunes for this OS-ID, then exit")
    parser.add_argument("--electrical-diag", nargs=argparse.REMAINDER, metavar="SUBCOMMAND", help="Electrical diagnostics calculators (must be the FIRST argument), e.g. --electrical-diag voltage-drop --reading 0.35 --circuit ground. See electrical_diag.py --help")

    args = parser.parse_args()

    # --- Standalone modes: none of these touch the car -----------------------
    if args.list_tools:
        manifest = load_tools_manifest()
        if not manifest:
            print(f"No manifest found at {TOOLS_MANIFEST} — run ./setup_tools.sh first.")
            return
        for name, entry in sorted(manifest.items()):
            status = entry.get("status")
            marker = {"ok": "[ok]", "skipped": "[--]", "failed": "[!!]"}.get(status, "[??]")
            print(f"  {marker} {name:<24} {entry.get('run_hint') or entry.get('note') or ''}")
            if status == "ok" and entry.get("note"):
                print(f"      note: {entry['note']}")
        return

    if args.check_updates:
        agent = UpdateCheckAgent(new_session_dir())
        updates = agent.run()
        if args.digest:
            print(agent.digest(updates))
        return

    if args.list_history:
        for entry in TuneHistoryAgent(new_session_dir()).list(args.vin):
            print(f"  {entry['id']}  |  {entry['title']}  |  sha256:{entry['sha256']}")
        return

    if args.check_community:
        entries = CommunityTuneAgent(new_session_dir()).list_for_os_id(args.check_community)
        if not entries:
            print(f"No community tunes found for OS-ID {args.check_community}.")
        for entry in entries:
            print(f"  {entry['file']}  |  {entry['profile']}")
        return

    session_dir = new_session_dir()
    print(f"Session: {session_dir}")
    backend = LocalOllamaBackend() if args.copilot == "local" else ApiBackend()
    history = TuneHistoryAgent(session_dir)

    if args.capture_pull:
        bring_up_can_smart(args.iface, args.bitrate, args.fd, args.autodetect_protocol, vin_hint=args.vin)
        try:
            result = PidCaptureAgent(session_dir).run(poll_hz=args.poll_hz)
        finally:
            bring_down_can(args.iface)
        print(f"Saved: {result['pid_log']} — pass this to --pid-log on your tuning run.")
        return

    if args.revert:
        bin_path = history.get_bin_path(args.vin, args.revert)
        if not bin_path:
            print(f"No snapshot '{args.revert}' found for VIN {args.vin} — check --list-history.")
            return
        print(f"Reverting to snapshot {args.revert} ({bin_path.name})")
        proposed = session_dir / "proposed.bin"
        shutil.copy(bin_path, proposed)
        current = session_dir / "current.bin"
        shutil.copy(bin_path, current)  # best-effort baseline for the diff; a real current read is safer if available

        # A revert is still a flash — it needs the ORIGINAL tune's safety
        # requirements (e.g. the dyno-log gate for anything beyond Day Use),
        # not a blank slate that would default to "Stage 1" and skip them.
        original_spec = history.get_tune_spec(args.vin, args.revert)
        if original_spec is None:
            print(f"  ! no tune_spec recorded for snapshot '{args.revert}' — treating its power "
                  "stage as unknown and requiring a dyno log rather than assuming Day Use")
            original_spec = {"values": {"power_stage": "Unknown (no tune_spec recorded for this snapshot)"}}

        bring_up_can(args.iface, args.bitrate, args.fd)
        try:
            validation = ValidatorAgent(session_dir, backend).run(
                current_bin=str(current), proposed_bin=str(proposed), tune_spec=original_spec,
                dyno_log=args.dyno_log, pid_log=args.pid_log,
            )
            if not validation["approved"]:
                print("Revert stopped before flashing.")
                return
            FlasherAgent(session_dir).run(proposed_bin=str(proposed))
            history.snapshot(args.vin, str(proposed), title=f"reverted_to_{args.revert}", tune_spec=original_spec)
            LoggerAgent(session_dir).run(vin=args.vin)
        finally:
            bring_down_can(args.iface)
        print("Revert complete. Safe to unplug.")
        return

    # --- Mobile-capture pipeline: phone+BLE already did Discovery/DTCs -------
    if args.mobile_capture:
        mc = MobileCaptureAgent(session_dir).run(capture_path=args.mobile_capture)
        discovery = mc["discovery"]
        vin = discovery.get("vin") or args.vin
        print(f"[mobile-capture] using phone-sourced VIN/ECU/DTC data for VIN {vin} — skipping live network scan")

        bring_up_can_smart(args.iface, args.bitrate, args.fd, args.autodetect_protocol, vin_hint=vin)
        try:
            # Binary read still requires the wired link — a BLE OBD-II dongle
            # can't pull the raw calibration off the PCM.
            diag_live = DiagnosticsAgent(session_dir).run()
            diagnostics = {**mc["diagnostics"], "current_bin": diag_live["current_bin"], "os_id": diag_live.get("os_id")}

            history.snapshot(vin, diagnostics["current_bin"], title="initial_read_baseline")
            CopilotAgent(session_dir, backend).run(discovery=discovery, sniffer=None, diagnostics=diagnostics)

            definition = DefinitionMatchAgent(session_dir).run(
                os_id=diagnostics.get("os_id"), current_bin=diagnostics["current_bin"]
            )
            if not definition["matched"]:
                print("  no indexed definition for this PCM — checking Vehicle Lookup for candidates")
                VehicleLookupAgent(session_dir).run(
                    make=args.make, model=args.model, year=args.year,
                    engine=args.engine, pcm_part_number=args.pcm_part_number, vin=vin,
                )

            tuning = TuningAgent(session_dir).run(
                current_bin=diagnostics["current_bin"], editor=args.editor, tune_spec=args.tune_spec
            )
            spec = tuning.get("tune_spec") or {}

            validation = ValidatorAgent(session_dir, backend).run(
                current_bin=diagnostics["current_bin"], proposed_bin=tuning["proposed_bin"],
                tune_spec=spec, dyno_log=args.dyno_log, pid_log=args.pid_log,
            )
            if not validation["approved"]:
                print("Stopped before flashing — nothing written to the ECU.")
                return

            if "EBCM (separate module)" in spec.get("segments_touched", []):
                EBCMAgent(session_dir).run(
                    traction_value=spec.get("values", {}).get("traction_threshold"),
                    ebcm_odx=args.ebcm_odx,
                    discovered_ecus=discovery.get("ecus"),
                )

            history.snapshot(vin, tuning["proposed_bin"], title=spec.get("profile", "manual_edit"), tune_spec=spec)
            FlasherAgent(session_dir).run(proposed_bin=tuning["proposed_bin"])
            LoggerAgent(session_dir).run(vin=vin)
            if args.publish_tune:
                validation_report = json.loads(Path(validation["report"]).read_text())
                CommunityTuneAgent(session_dir).publish(
                    os_id=diagnostics.get("os_id"), tune_spec=spec, validation_report=validation_report
                )
        finally:
            bring_down_can(args.iface)
        print("Done. Safe to unplug.")
        return

    # --- Normal plug-in-to-unplug pipeline ------------------------------------
    protocol = bring_up_can_smart(args.iface, args.bitrate, args.fd, args.autodetect_protocol, vin_hint=args.vin)
    if args.autodetect_protocol and protocol is None:
        print("Stopped — autodetect found no traffic on this bus. Check wiring/adapter and try again.")
        return
    try:
        discovery = DiscoveryAgent(session_dir).run(iface=args.iface)

        if not DiscoveryAgent.recognized(discovery):
            print("  ! Discovery found no VIN and no ECUs — this vehicle isn't recognized.")
            if args.manual_vehicle or any([args.make, args.model, args.engine, args.pcm_part_number]):
                VehicleLookupAgent(session_dir).run(
                    make=args.make, model=args.model, year=args.year,
                    engine=args.engine, pcm_part_number=args.pcm_part_number, vin=args.vin,
                )
                print("  see vehicle_lookup.json for candidates — review and re-run once you have a matching tool/definition.")
            else:
                print("  re-run with --manual-vehicle --make ... --model ... --engine ... --pcm-part-number ... to search for a way in.")
            return

        sniffer = SnifferAgent(session_dir).run(iface=args.iface)
        diagnostics = DiagnosticsAgent(session_dir).run()
        vin = discovery.get("vin") or args.vin

        if args.autodetect_protocol and protocol is not None:
            save_protocol_cache(vin, protocol)

        # Auto-snapshot the very first read, before anything is touched.
        history.snapshot(vin, diagnostics["current_bin"], title="initial_read_baseline")

        CopilotAgent(session_dir, backend).run(discovery=discovery, sniffer=sniffer, diagnostics=diagnostics)

        definition = DefinitionMatchAgent(session_dir).run(
            os_id=diagnostics.get("os_id"), current_bin=diagnostics["current_bin"]
        )
        if not definition["matched"]:
            print("  no indexed definition for this PCM — checking Vehicle Lookup for candidates")
            VehicleLookupAgent(session_dir).run(
                make=args.make, model=args.model, year=args.year,
                engine=args.engine, pcm_part_number=args.pcm_part_number, vin=vin,
            )

        tuning = TuningAgent(session_dir).run(
            current_bin=diagnostics["current_bin"], editor=args.editor, tune_spec=args.tune_spec
        )
        spec = tuning.get("tune_spec") or {}

        validation = ValidatorAgent(session_dir, backend).run(
            current_bin=diagnostics["current_bin"], proposed_bin=tuning["proposed_bin"],
            tune_spec=spec, dyno_log=args.dyno_log, pid_log=args.pid_log,
        )
        if not validation["approved"]:
            print("Stopped before flashing — nothing written to the ECU.")
            return

        # EBCM is a separate module/pipeline branch — only triggered if the spec
        # actually touches traction/stability, and handled independently of the
        # engine flash below (it never blocks or is blocked by the engine write).
        if "EBCM (separate module)" in spec.get("segments_touched", []):
            EBCMAgent(session_dir).run(
                traction_value=spec.get("values", {}).get("traction_threshold"),
                ebcm_odx=args.ebcm_odx,
                discovered_ecus=discovery.get("ecus"),
            )

        # Auto-snapshot what's about to be flashed, titled from the spec if we have one.
        history.snapshot(vin, tuning["proposed_bin"], title=spec.get("profile", "manual_edit"), tune_spec=spec)

        flash = FlasherAgent(session_dir, flash_cmd=args.flash_cmd,
                             readback_cmd=args.readback_cmd).run(proposed_bin=tuning["proposed_bin"])
        LoggerAgent(session_dir).run(vin=vin)
        if not flash["flashed"]:
            print("Flash did NOT happen — ECU unchanged. See flash_result.json.")
        elif not flash["verified"]:
            print("Flash ran but is UNVERIFIED — re-read the ECU before driving.")
        if args.publish_tune:
            validation_report = json.loads(Path(validation["report"]).read_text())
            CommunityTuneAgent(session_dir).publish(
                os_id=diagnostics.get("os_id"), tune_spec=spec, validation_report=validation_report
            )
    finally:
        bring_down_can(args.iface)

    print("Done. Safe to unplug.")


if __name__ == "__main__":
    sys.exit(main())

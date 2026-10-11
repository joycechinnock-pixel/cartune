# CarTune v11

**Open the app:** download `CarTune-App.html` and open it in Chrome (double-click, or drag it into a Chrome window). It runs offline in demo mode.

**Admin (demo store):** open `CarTune-Admin.html` in Chrome from the same folder, then create the owner on the one-time setup screen.

**Admin server:** needs Node 20+.
```
node web/build.js            # needs TypeScript: npm i -g typescript (or set CARTUNE_TS)
node server/server.js --port 8787
```
Copy the one-time setup token it prints, then open http://127.0.0.1:8787/admin/?api=http://127.0.0.1:8787 and create the owner. API docs are in `server/API.md`.

Not in this repo: the binary art, font and receiver files (.webp, .woff2, .bin). Both HTML apps already embed all of them.

---

# CarTune OS

An open, free, multi-agent pipeline for reading, tuning, and reflashing a
vehicle's ECU — built by stitching together existing open-source tools
(RomRaider, TunerPro, PCM Hammer, LinOLS, opendbc, ddt4all, and others)
instead of a single closed, paid tool. See `CarTune-OS-Design.md` for the
full architecture and reasoning.

## ⚠️ Read this before you plug anything in

- **This writes directly to your vehicle's ECU.** A failed or interrupted
  write can immobilize the vehicle or, in rare cases, damage the module.
- **No warranty, no liability.** This is community-maintained software —
  see `LICENSE`. You are responsible for verifying every value before it's
  flashed, and for understanding your local laws around emissions and
  road-legal modification.
- **Keep the adapter connected and powered** from the moment a session
  starts until a step explicitly tells you it's safe to unplug.
- **Nothing here bypasses engine-damage protection.** The knock/AFR/coolant
  safety gate for anything beyond Day Use is enforced in code — see
  "Safety gates" below — and isn't something a CLI flag can skip.

## Status

This is a real, tested pipeline scaffold, not a finished product. Every
agent's core logic is unit-tested (`pytest` — see `tests/`), but several
pieces that need real hardware to verify are honest placeholders rather
than guesses. **`CLAUDE.md` has the exact, current list of what's real vs.
stubbed** — read it before assuming a feature works end-to-end on your
specific vehicle.

The short version: reading a standard Calibration ID and RPM/coolant via
`python-obd` is real. Knock retard and precise AFR are genuinely
platform-specific and need a hook you wire up yourself (see
`PidCaptureAgent.custom_pid_reader`). Actual binary reads/writes to the
PCM go through whichever tool the design doc names for your platform
(PCM Hammer, RomRaider, etc.) — install and verify those separately via
`setup_tools.sh`.

## Browser app and electrical diagnostics (new)

**`CarTune-App.html`** is a single-file browser app. Open it in Chrome or Edge, or serve `web/dist/` (see `web/README.md`). It keeps the App Preview look and screens, and adds a real OBD-II connection:
- **Web Serial:** USB ELM327 / OBDLink.
- **Web Bluetooth:** BLE ELM327-type dongles. It tries the FFF0, FFE0, Nordic UART and other common UART services.
- **Demo adapter:** a clearly labelled simulated ELM327, so everything works with no car.

Tabs:
- **Tunes:** Home, tune detail, Pro tables/settings, and Flash, which only simulates in Demo.
- **Live data:** the capture screen, plus `mobile_capture.json` export.
- **Tune spec:** `tune_spec.json` export.
- **Diagnostics:**
  - guided workflow checklist with notes per vehicle
  - scan: stored, pending and permanent codes (modes 03, 07, 0A), freeze frame (02), and clear codes (04) behind a typed confirmation
  - live dashboard with CSV logging
  - battery, cranking, charging and ripple tests, auto-filled from ATRV and PID 0x42
  - voltage-drop wizard
  - parasitic draw, module sleep timer, and fuse-drop → current with an editable fuse table
  - circuit fault decision trees
  - 3-wire sensor checks and meter-vs-scan comparison
  - CAN termination and voltage interpreters
  - safety notes
  - printable HTML and JSON report

The same calculators are available on the command line:

```bash
python3 cartune_orchestrator.py --electrical-diag voltage-drop --reading 0.35 --circuit ground   # FAIL, exit 2
python3 electrical_diag.py fuse-drop --millivolts 1.0 --type mini --rating 10 --json         # ≈134.8 mA
python3 electrical_diag.py can-termination --ohms 120                                        # one terminator missing
```

All thresholds are **general guidelines** and editable in the app. Always check the manufacturer's specification. Fuse resistances are approximate.

**Verified so far:** the parsers against documented ELM327 reply formats and the built-in emulator, the calculators (shared test vectors in Python and JS), and the web UI in headless Chrome in Demo mode.

**Not yet verified on real hardware:** real adapters and cars (Web Serial, Web Bluetooth and the BLE UUIDs).

## Quickstart

```bash
# 1. Install optional runtime dependency (only needed for the real
#    Calibration-ID / rpm / coolant_c reads — everything else is stdlib).
pip install -r requirements.txt

# 2. Install the tool inventory (RomRaider, TunerPro, etc. where available
#    on your platform/OS — see setup_tools.sh for what it can and can't do).
./setup_tools.sh
python3 cartune_orchestrator.py --list-tools

# 3. Dev/test setup
pip install -r requirements-dev.txt
pytest

# 4. A normal session (plug the adapter in first)
python3 cartune_orchestrator.py --vin AUTO --autodetect-protocol
```

## Safety gates

- **Beyond "Day Use"** (Stage 1 or higher), a flash requires verified
  WOT-pull data — knock retard, AFR, coolant — checked against fixed
  thresholds. This can come from a real dyno (`--dyno-log`) **or** a
  self-logged road/track/off-road pull (`--pid-log`, or capture one live
  with `--capture-pull`). A dyno was never actually required by the check
  itself — only the data was.
- **Checksums are blocking, not advisory.** A proposed file with a bad
  checksum, or a write that reads back wrong, halts before/after the
  write — no override flag.
- **A human confirms the diff before every flash.** The pipeline stops and
  asks; nothing writes without an explicit yes.

## Common commands

| Command | What it does |
|---|---|
| `--vin AUTO --autodetect-protocol` | Normal session; probes bitrate/FD instead of requiring it upfront |
| `--capture-pull` | Log a live WOT pull's PIDs; feed the output into `--pid-log` later |
| `--dyno-log FILE.csv` / `--pid-log FILE.json` | Satisfy the pull-data safety gate |
| `--list-history --vin VIN` | List saved tune snapshots for a vehicle |
| `--revert VERSION_ID --vin VIN` | Re-flash a previous snapshot (still goes through Validator) |
| `--check-updates --digest` | Plain-English summary of tool-inventory updates |
| `--publish-tune` | Share this session's *validated* tune to the local community repo |
| `--check-community OS_ID` | List community tunes available for an OS-ID |
| `--manual-vehicle --make ... --model ...` | Fallback when Discovery doesn't recognize the vehicle |
| `--electrical-diag <test> ...` | Electrical calculators (voltage-drop, battery, cranking, charging, ripple, parasitic, fuse-drop, fuse-table, can-termination, can-voltage, sensor, compare). Add `--json`; exit code 0 pass / 1 warn / 2 fail |

Run `python3 cartune_orchestrator.py --help` for the full list.

## Contributing

`tests/` is real and runs offline (no network, no hardware) — `pytest`
before opening a PR. JS logic tests: `cd mobile && node scripts/run-node-tests.js`
(needs TypeScript). Web UI smoke test: `web/tests/smoke_playwright.py`. `CLAUDE.md` documents current conventions (agent
pattern, honest-degradation rule, what's real vs. stub) for anyone —
human or AI-assisted — picking this up.

## License

MIT — see `LICENSE`. That license's warranty disclaimer specifically
covers vehicle/ECU damage; read it.

# CarTune OS — Open-Source Vehicle Tuning & Diagnostic Platform

A single design that runs on either boot path (Live USB or Dual-Boot), wires together every open-source tool you listed plus gaps found via research, and pipes it all through a multi-agent workflow — plug in, scan, sniff, diagnose, tune, validate (with an AI copilot reading everything), flash, save, unplug.

---

## 1. Boot Environment Layer

**Option A — Live USB (start here)**
- Flash Ubuntu 24.04 LTS to a 32GB+ USB 3.0 drive (Rufus on Windows, or balenaEtcher).
- Enable **persistent storage** (a 4–8GB casper-rw partition) so installed tools, DBC files, and git history survive reboots — without touching your Windows install.
- Boot from USB (F2/F12/Esc at power-on) → "Try Ubuntu."
- Runs in RAM + the persistent partition. Zero risk to Windows or factory tuning software.

**Option B — Dual-Boot (once the workflow is proven)**
- Shrink the Windows partition (Disk Management), install Ubuntu alongside via GRUB.
- Better I/O for sustained CAN-FD logging; native persistence for large git repos of binaries.
- Keep Windows for anything with no Linux equivalent (dealer software, some OEM J2534 pass-thru apps, TunerPro's native EXE).

**Common setup, either boot mode:**
```bash
sudo apt update
sudo apt install -y can-utils python3-pip python3-venv git docker.io build-essential
sudo modprobe gs_usb        # CANable / candleLight driver
```

---

## 2. Hardware Interface Layer

| Adapter | Notes | Buy from |
|---|---|---|
| **CANable / candleLight** | Cheapest, mounts as SocketCAN (`gs_usb`) or generic serial | [canable.io](https://canable.io/) |
| **PiCCANTE** (Pi Pico) | DIY, open schematics, good as a second passive tap | [GitHub](https://github.com/Alia5/PICCANTE) |
| **comma.ai panda** *(found in research)* | Open-source CAN/OBD interface, integrates natively with cabana + opendbc | comma.ai shop |
| **CANtact** *(found in research)* | Original "open source car tool," predecessor to CANable | Adafruit / SparkFun |
| **Macchina M2** *(found in research)* | Open multi-bus (CAN/LIN/GMLAN) hacking platform | macchina.cc |

Bring-up once plugged in:
```bash
sudo ip link set can0 up type can bitrate 500000     # classic CAN
# or for CAN-FD data phase:
sudo ip link set can0 up type can bitrate 500000 dbitrate 2000000 fd on
```

---

## 3. Full Open-Source Tool Inventory

### Discovery / Network Mapping / VIN
- **BlackFlag ECU** — scans networks, decodes VIN, manages flash maps. [GitHub](https://github.com/bad-antics/blackflag-ecu)
- **OpenVehicleDiag (OVD)** — Rust, J2534-2 + Linux SocketCAN, auto-maps ECU topology. [GitHub](https://github.com/rnd-ash/OpenVehicleDiag)
- **CaringCaribou** *(new)* — "nmap for CAN bus": ECU discovery, UDS/XCP scanning, fuzzing modules.

### CAN Bus Sniffing / Reverse Engineering
- **SavvyCAN** — raw hex from every module at once; needs a `.DBC` to decode. [Site](https://www.csselectronics.com/pages/can-bus-interface-savvycan)
- **CANgaroo** *(new)* — open-source CAN analyzer, DBC decoding, CAN-FD support.
- **cabana** *(new, comma.ai)* — CAN visualizer + DBC maker. The standalone repo is archived/deprecated by its own README; the maintained version lives at [commaai/openpilot/tools/cabana](https://github.com/commaai/openpilot/tree/master/tools/cabana), which is what `cartune_orchestrator.py`/`setup_tools.sh` track.
- **opendbc** *(new, comma.ai)* — crowdsourced DBC signal database covering hundreds of makes/models — feed this into SavvyCAN, CANgaroo, or cabana. [GitHub](https://github.com/commaai/opendbc)
- **PiCCANTE** — hardware-level passive logging.

### OBD-II / Basic Diagnostics
- **pyobd** — pure Python, ELM protocol, no subscription. [GitHub](https://github.com/barracuda-fsh/pyobd)
- **OVMS3** — EV-specific telemetry (battery cells, modules) via cellular + CAN. [GitHub](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3)

### UDS / ODX Deep Diagnostics
- **EcuBus-Pro** — HIL testing, graphical CAN-FD signals, SOME/IP. [GitHub](https://github.com/ecubus/EcuBus-Pro)
- **ddt4all** — hidden BCM configs (Renault/Nissan origin). [GitHub](https://github.com/cedricp/ddt4all)
- **odxtools** (Mercedes-Benz OSS) — parses ODX/PDX diagnostic databases. [GitHub](https://github.com/mercedes-benz/odxtools)
- **OpenJ2534 / Generic Diagnostic Tool** (jakka351) — DTC/DID parsers, brute-force module discovery. [GenericDiagnosticTool](https://github.com/jakka351/GenericDiagnosticTool) / [OpenJ2534](https://github.com/jakka351/OpenJ2534)
- **python-udsoncan** / **uds** (mdabrowski1990) *(new)* — Python UDS (ISO-14229) libraries; `uds` covers CAN/Ethernet/LIN/FlexRay/K-Line under one API — script your own diagnostic sessions instead of relying only on GUIs.
- **UDSim** *(new)* — UDS ECU simulator/fuzzer; test diagnostic scripts against a fake ECU before touching the real one.
- **NikolaKozina/j2534** *(new)* — Linux-native J2534 driver implementation (the one RomRaider itself uses on Linux).

### ECU Tuning / Map Editing
- **LinOLS** — Python, open WinOLS alternative. [GitHub](https://github.com/2CRPerformance/LinOLS)
- **HyperTuner** — modern dashboard/tuning suite. [GitHub](https://github.com/hyper-tuner/hypertuner)
- **LibreTune** — Rust, motorsport/aftermarket focus. [GitHub](https://github.com/RallyPat/LibreTune)
- **Tune-Editor** — browser-based, 3D matrix visualization. [GitHub](https://github.com/TheFlashBold/tune-editor)
- **RomRaider** — mature, Subaru/BMW-focused, XDF-based. [Forum](https://www.romraider.com/index.php/Documentation/RomRaiderFAQ)
- **TunerPro** (free) — widely supported XDF map editor (Windows-only — run via Wine, or on the Windows side of your dual-boot). [Site](https://www.tunerpro.net/)
- **PCM Hammer** *(new — platform gap)* — open-source read/write tool specifically for GM E38/E67-era PCMs (Vortec/LS engines, including the VE Commodore SS). None of the tools above name GM E38/E67 explicitly; PCM Hammer guarantees the calibration you pull matches your exact OS ID/VIN rather than a generic download. [pcmhammer.org](https://pcmhammer.org/)
- **Universal Patcher** *(new — platform gap)* — binary patcher for known calibration values (e.g. AFM/DOD disable, speed limiter) across supported OS IDs, GM included. A lighter alternative to full XDF table editing in TunerPro when you only need a specific, well-known change.

### Flashing / Write-Back
BlackFlag ECU, RomRaider, TunerPro, PCM Hammer, and OpenJ2534/GenericDiagnosticTool all write back once a J2534 or SocketCAN channel is open. GM E38/E67 calibrations are checksummed **per segment** (OS / System / Fuel / Speed / Engine Diagnostic / Engine Calibration) — the Flasher Agent should write and verify only the segment(s) actually touched, not the whole file.

---

## 4. AI Copilot Layer

**Why:** none of the tools above explain themselves — SavvyCAN gives you raw hex, a DTC is just a numeric code, a map is just a grid of numbers. Reading all of that correctly normally requires knowing the DBC/ODX definitions for your specific vehicle by heart and eyeballing a tune for mistakes. The Copilot exists to close that gap: it does the cross-referencing and pattern-spotting for you and reports back in plain language, so you catch a bad edit or a real fault code before it becomes an expensive mistake — not to replace the tools, and not to make any decision for you.

A dedicated **Copilot Agent** sits alongside the pipeline as an interpreter/advisor — it never touches the ECU directly.

- **Reads:** DBC-decoded CAN traffic (SavvyCAN/cabana/CANgaroo), DTC + live-data (pyobd/ddt4all/odxtools), and the binary map diff (old vs. proposed, from LinOLS/RomRaider/TunerPro/HyperTuner).
- **Understands:** cross-references signal names/DIDs against opendbc + ODX definitions; flags anomalies — a DTC that won't clear, a signal that stalls, a map cell that's a statistical outlier next to its neighbors.
- **Suggests:** plain-English explanation of what a code or signal means, plus conservative tuning notes ("cell at 4000rpm/80kPa is 8% richer than surrounding cells — confirm this was intentional"). Always a suggestion for you to approve — never an auto-write.
- **Backend:** swappable — local LLM (Ollama/llama.cpp on the Linux box, for offline garage/track use) or an API model (e.g., Claude) when you have connectivity. The orchestrator below has a pluggable `CopilotBackend` interface for this.

---

## 5. Multi-Agent Architecture

```
Orchestrator (cartune_orchestrator.py)
   │
   ├─ 1. Discovery Agent    → ecu_map.json          (OpenVehicleDiag / BlackFlag ECU / CaringCaribou)
   ├─ 2. Sniffer Agent      → session.dbc, capture.log   (SavvyCAN / CANgaroo / cabana + opendbc)
   ├─ 3. Diagnostics Agent  → dtc_report.json, current.bin  (pyobd / ddt4all / odxtools / EcuBus-Pro / udsoncan)
   ├─ 4. Copilot Agent      → copilot_notes.md        (reads outputs of 1–3, plain-English findings)
   ├─ 5. Tuning Agent       → proposed.bin, tune_spec.json  (CarTune-Map-Input-Console.html → LinOLS / RomRaider / TunerPro / PCM Hammer / HyperTuner / LibreTune / Tune-Editor — human-driven)
   ├─ 6. Validator Agent    → validation_report.json  (diff + safety limits + 2nd Copilot pass + human confirm gate)
   │      └─ 6a. Dyno Log Agent → dyno_log_report.json  (gate only: required if power_stage > Day Use; knock/AFR/coolant thresholds)
   ├─ 7. EBCM Agent         → ebcm_result.json        (branch only: runs if the spec touches traction/stability; independent of the engine flash)
   ├─ 8. Flasher Agent      → flash writes proposed.bin, verifies checksum
   └─ 9. Logger/Save Agent  → git commit, can0 down, "safe to unplug"
```

Each agent hands off through plain files (JSON/binary) in a per-session working directory — easy to inspect, easy to swap tools without touching the others.

---

## 6. End-to-End Workflow (plug in → unplug)

1. Boot Linux (Live USB or dual-boot).
2. Plug in CANable/panda/PiCCANTE → bring up `can0`.
3. **Discovery Agent** scans, confirms VIN + ECU topology. If it finds nothing, branch to **Vehicle Lookup Agent** (section 7) instead of dead-ending.
4. **Sniffer Agent** captures baseline traffic against opendbc.
5. **Diagnostics Agent** pulls DTCs and reads the current tune binary off the ECU.
6. **Copilot Agent** summarizes findings, flags anything unusual, in plain English.
7. You pick a profile (or hand-edit fields) in **CarTune-Map-Input-Console.html**, which shows every tunable category across the whole toolset at once and which tool(s) actually support each one, then export `tune_spec.json`. You then open the binary in whichever tool the spec says covers the touched segment(s), and apply the values there.
8. **Validator + Copilot** double-check the diff against safety limits (rev limiter, boost, injector duty cycle, AFR bounds) — and, for anything beyond "Day Use," a live dyno-log gate (see below).
9. If the spec touches traction/stability, **EBCM Agent** runs as its own branch — independent of, and never blocking, the engine flash.
10. You confirm → **Flasher Agent** writes the new map, re-reads to verify.
11. **Logger Agent** commits everything (binary, DBC, DTC report, copilot notes, dyno log, EBCM result) to a per-VIN git repo, tears down `can0`.
12. Unplug hardware.

**The two gaps flagged from reviewing a real build sheet (VE SS / GM E38-E67) are now closed, not just flagged:**

- **Live dyno logging is now a real gate, not a static diff.** `ValidatorAgent` reads `tune_spec.json`'s `power_stage`; anything beyond `None / ECU remap only / Stage 1` requires a `--dyno-log` CSV (rpm, knock_retard_deg, afr, coolant_c — whatever your dyno software or a wideband/knock logger exports). A new `DynoLogAgent` parses it and fails the gate on excess knock retard, AFR leaner than target, or coolant over limit — with no log provided, the Validator refuses outright rather than falling back to the byte diff. The Map Input Console mirrors this: pick a profile past Day Use and a warning banner appears before you even export the spec.
- **Traction/stability now has its own agent and its own reachability check, instead of a blanket "not covered."** A new `EBCMAgent` only runs when the spec actually touches `traction_threshold`, checks that Discovery's network scan actually found an EBCM on the bus, and requires an `--ebcm-odx` definition before attempting anything — if none is supplied, it says exactly that instead of silently no-op'ing. The console now lets you **upload your real XDF** (parsed client-side for matching table names) and a **real EBCM ODX/DBC signal list**, so "supported" and "not reachable" are computed against your actual files instead of a static disclaimer. The same live check now applies to the shift/line-pressure/TCC fields too — upload your XDF and each field tells you, for real, whether your specific definition has that table.

---

## 7. Unrecognized Vehicle Fallback

**Trigger:** Discovery Agent comes back empty or partial — no VIN decoded, zero/ambiguous ECUs found. Rather than dead-ending, the pipeline branches to a **Vehicle Lookup Agent** (`--manual-vehicle --make ... --model ... --engine ... --pcm-part-number ...`).

**What it does:**
1. Takes manually entered vehicle details — make, model, year, engine code, known PCM/ECU part number, VIN if you have one even without a live read.
2. Searches on two honest tiers, because "scrape the whole internet automatically" isn't something a script can actually do against most sites:
   - **Tier 1 — live, automatic:** queries GitHub's public search API for your make/model/engine/PCM number against known keywords (`xdf`, `odx`, `dbc`, `ecu`, `tune`, `definition`) — no API key needed, results come back inline, right now.
   - **Tier 2 — prepared search links:** sites that don't expose a fetchable API (pcmhacking.net, the RomRaider forum, TunerPro's XDF library) can't be queried directly from a script — it builds the correct search URL for each instead and hands it to you to open. This is the honest boundary, not a shortcut around it.
3. Nothing found this way is auto-imported or auto-flashed. Every candidate is a lead to review — matched against your own PCM's exact OS ID before it goes near a flash, same as the PCM Hammer philosophy already in section 3.

**Best setup:** run Discovery once per new vehicle before anything else. If it fails, you already have the make/model/engine on hand — the lookup takes seconds and turns a dead end into a shortlist instead of a shrug.

---

## 8. Update / Definition-Feed Agent

**What it checks:** for every tool already in the inventory (BlackFlag ECU, LinOLS, RomRaider, PCM Hammer, etc.), `--check-updates` polls GitHub's commit history and compares against the last commit it saw (cached in `.cartune_versions.json`), surfacing only what's genuinely new since last time — not a full re-fetch every run.

**What it deliberately does not do:** auto-download or auto-apply a "new tune." A calibration file isn't a software update — a newer one isn't automatically safer for your specific car. This agent tells you a tool has new activity; it never imports or flashes anything for you. A definition for your specific vehicle still goes through the same manual-review step as the Vehicle Lookup Agent above.

**Best setup:** run `--check-updates` on a schedule (weekly cron, or just before a tuning session) — it's read-only and doesn't touch the car, so there's no reason not to run it often.

---

## 9. Tune History, Auto-Snapshot & Revert

**Why:** if a tune goes wrong, you need to get back to where you started — reliably, not "I think this was the file."

**How it works:**
1. The moment Diagnostics Agent successfully reads `current.bin` — before a single map cell is touched — `TuneHistoryAgent` auto-snapshots it: `{timestamp}__initial_read_baseline.bin`, logged in a per-VIN `manifest.json` with date, time, an auto-title, and a checksum. This happens every session, automatically, whether or not you end up changing anything.
2. Every time Flasher is about to write a new calibration, that file is snapshotted first too, titled from the `tune_spec.json` profile (e.g. `Day_Use`) or whatever title you pass.
3. To go back: `--list-history --vin <vin>` shows every snapshot; `--revert <version_id>` loads that historical binary as the new `proposed.bin` and sends it through **the same Validator + Flasher gate** as any other change. A revert is still a flash — it doesn't skip the safety checks just because it's going backward.

**Best setup:** treat the VIN as the key, not the session — that's why history lives under `vin_repos/<vin>/tune_history/`, so `--list-history` and `--revert` work across every session you've ever run on that specific car, not just the current one.

---

## 10. What's in the companion files

**`cartune_orchestrator.py`** — a runnable scaffold implementing every agent above as a Python class: subprocess hooks into the real tools, a per-session working directory, a pluggable Copilot backend (local/API), a `DynoLogAgent` gate, an `EBCMAgent` branch, a `VehicleLookupAgent` fallback, an `UpdateCheckAgent`, a `TuneHistoryAgent` with auto-snapshot + revert, and a git-based save step. It's a skeleton for the tool CLIs themselves — you fill in the exact flags for whichever specific tools you install, since several (BlackFlag ECU, HyperTuner, LibreTune) are early-stage. Standalone flags that don't require the car to be plugged in at all: `--check-updates`, `--list-history --vin <vin>`, `--revert <version_id> --vin <vin>`.

**`CarTune-Map-Input-Console.html`** — the answer to "which input options exist, and who can actually set them." A single-file, open-in-any-browser form covering every tunable category (Fuel/Speed/Engine Calibration segments, plus the EBCM-side traction/stability field, clearly flagged as out of scope for engine tools):

- 11 preset profiles transcribed straight from the VE SS build sheet (Factory, Economical, Highway, Comfort, Day Use, Sport, Handling, Holeshot, Race, Burnout, Off-Road) — pick one to load its values, or override any field by hand.
- Every field lists which tools in the inventory can actually write it.
- **Upload your real XDF** to replace the "depends on your definition" guess for Speed Calibration fields (shift schedule, line pressure, TCC lockup) with a live check against your actual file's table names.
- **Upload a real EBCM ODX/DBC signal list** to replace the blanket "not reachable" on traction/stability with a live check for a matching yaw/slip/traction/stability signal.
- A warning banner the moment you pick a profile beyond "Day Use," reminding you a dyno log will be required before the orchestrator will approve a flash.
- A live diff panel against the Factory baseline, grouped by calibration segment.
- A **Vehicle Not Recognized?** panel — enter make/model/year/engine/PCM number, hit search, and it queries GitHub's public API live (right in the browser, no key needed) plus opens prepared search links for pcmhacking.net/RomRaider forum/TunerPro's XDF library, the same two-tier approach as `VehicleLookupAgent` in the script.
- An **Upload & Inspect a File** panel — drop in whatever you already have and it detects the type (extension first, then content signature) and reads it in-browser: `.dbc` gets parsed into actual messages and signals (bit position, factor, unit), `.xdf`/`.odx` get their table and diagnostic-service names extracted, `.csv` gets checked against the exact columns the dyno-log gate needs and flagged ready/not-ready, `.json` gets identified by shape (tune_spec, tune-history manifest, ecu_map, dtc_report, vehicle_lookup) and pretty-printed, and a raw calibration `.bin` gets an honest hex-dump — no tool can generically decode a calibration binary into named cells without the matching XDF/OS-ID, so it doesn't pretend to. Loading a `.dbc` or `.xdf` here feeds the same live capability checks used elsewhere on the page (Speed Calibration fields, EBCM reachability) — one upload, used everywhere it's relevant.
- A **Saved Tunes** tab — click "Connect Tune Library Folder" once (uses the browser's File System Access API, Chrome/Edge/Arc) and point it at the folder holding `vin_repos/`. It then walks every VIN subfolder's `tune_history/manifest.json` itself and lists every saved snapshot across every vehicle you've ever tuned, sorted newest-first, each with a one-click "copy revert command." The folder handle is remembered (IndexedDB) so the next session just needs a quick permission re-grant instead of re-picking the folder — no more hunting through the file browser for a specific `manifest.json`. Firefox/Safari don't support page-level folder access, so a manual single-file `manifest.json` loader is kept underneath as a fallback for those browsers.
- An **Export tune_spec.json** button — that file is what you hand to `cartune_orchestrator.py --tune-spec tune_spec.json [--dyno-log pull.csv] [--ebcm-odx ebcm.json]`.
- The middle column is now tabbed — **Tune Editor / Vehicle Lookup / Upload & Inspect / Saved Tunes** — instead of one long scroll, since the page had grown to four distinct workflows.
- Restyled as a dark tuner-dashboard theme (amber/carbon gauge-cluster look, Rajdhani/Roboto Mono) — purely cosmetic, doesn't change any of the above.

It does not write to a binary itself — it's the missing "what do I want to change, and in what" step that used to be the single unexplained line "open the binary, adjust maps."

---

## 11. Mobile Companion (Bluetooth)

**Why:** the Linux box + wired CAN adapter is the flashing rig, not something you carry to the track or under the hood every time you want a quick DTC check or want to fill out a tune profile away from the car. A phone pairing over Bluetooth to a small hardware dongle covers that gap — as an additional input source into the same pipeline, not a second flashing path.

**Hard boundary, stated up front:** the mobile app never flashes the ECU. It reads diagnostic data and authors/transfers `tune_spec.json`. The write step stays on the wired CANable/panda/PiCCANTE link in section 2, for the same reason the build sheet already gates everything beyond Day Use behind a live dyno log — a flash that dies mid-write over a radio link is how a PCM gets bricked, and GM E38/E67 calibrations are checksummed per segment specifically so a partial write is detectable, not survivable.

### 11.1 Recommended hardware

| Adapter | Why | Notes |
|---|---|---|
| **OBDLink MX+ / CX** | STN2120 chipset — ELM327-compatible PID/DTC/VIN queries *plus* an extended command set for raw CAN frame monitoring, well past what a generic ELM327 clone does. BLE + Bluetooth Classic + USB depending on model. | This is the one to buy first. Documented protocol, works with `pyobd`-style tools and python-OBD over Bluetooth serial. |
| **Generic ELM327 BLE clone** (Vgate iCar Pro BLE4.0, etc.) | Cheapest option, fine for VIN + DTCs + standard PIDs. | No raw CAN access, no manufacturer-specific bus traffic — read-only OBD-II Mode 01-09 only. |
| **BLE-capable CAN interface** | Would in theory feed `SnifferAgent` directly. | Not recommended: essentially doesn't exist as an off-the-shelf product because classic CAN (500kbps) and CAN-FD (up to 2-5Mbps data phase) exceed what BLE can sustain reliably. Wireless CAN interfaces that do exist (Kvaser BlackBird, PCAN WiFi) use WiFi, not Bluetooth, for this reason. |

**Bandwidth reality check:** BLE's practical throughput (roughly tens to low hundreds of kbps even on BLE 5.0) is fine for low-volume request/response traffic — VIN read, DTC pull, a handful of live PIDs — but not for full bus sniffing. `SnifferAgent`'s job (capture *everything* on the bus against opendbc) stays a wired-adapter job. The mobile app's realistic scope is Discovery-lite and Diagnostics-lite, not Sniffer.

### 11.2 What the app actually does

1. **Pair + read** — connects to the OBDLink over BLE, pulls VIN, DTCs, and live PIDs using the same request shape `DiscoveryAgent`/`DiagnosticsAgent` already produce (`ecu_map.json`, `dtc_report.json`).
2. **Author a tune spec** — a mobile counterpart to the profile-picker side of `CarTune-Map-Input-Console.html`: pick a profile, override fields, see the same Day-Use-and-above dyno-log warning banner.
3. **Upload, don't flash** — both artifacts (`mobile_capture.json`, `tune_spec.json`) transfer to whatever machine is running `cartune_orchestrator.py` — local Wi-Fi to a small HTTP endpoint, a QR code, AirDrop/Nearby Share, or literally plugging the phone in as USB storage and copying the file. Any of these is fine because none of them is on the critical path of a flash write.

### 11.3 Pipeline hook

A new **Mobile Capture Agent** sits alongside Discovery/Diagnostics as an alternate source for the same files, not a replacement for the wired path:

```
--mobile-capture mobile_capture.json   # in place of a live Discovery+Diagnostics run
--tune-spec tune_spec.json             # same as today, now optionally authored on the phone
```

If `--mobile-capture` is passed, the orchestrator trusts its `vin`/`dtcs`/`live_data` fields the same way it would trust a live bus read, then proceeds through Copilot → Tuning → Validator → EBCM → Flasher exactly as before — the wired adapter is still what's plugged into the car for discovery/sniffing/flashing; the phone just supplied the diagnostic read remotely, or the human authored the spec somewhere other than the garage.

**What this deliberately does not do:** no BLE write path to the PCM, no "flash from your phone" feature, no bypassing the Validator/dyno-log/EBCM gates just because the input came from a phone instead of the console. Same trust boundary as the Vehicle Lookup and Update Check agents — new leads and new inputs, never new shortcuts around the safety gates.

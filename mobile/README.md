# CarTune Mobile Companion

React Native scaffold for the Bluetooth companion app described in
`CarTune-OS-Design.md` section 11 — pairs to an OBDLink CX/MX+ (or any
ELM327-compatible BLE dongle), reads VIN/DTCs/live PIDs, and authors/exports
`tune_spec.json`. **It never flashes the ECU** — that stays on the wired
CANable/panda link handled by `cartune_orchestrator.py`.

## What's real vs. stub here

Same honesty rule as the orchestrator: don't trust a placeholder as if it
were verified.

- **Real, verified-against-spec:** the ELM327 AT command set (`src/ble/elm327.ts`),
  DTC decoding (SAE J2012 / ISO 15031-6), VIN multi-frame reassembly, the
  Mode 01 PID list, and the `tune_spec.json`/`mobile_capture.json` shapes
  (ported field-for-field from `CarTune-Map-Input-Console.html` and
  `MobileCaptureAgent` respectively).
- **Placeholder, needs one hardware pass:** the BLE service/characteristic
  UUIDs in `src/ble/obdLink.ts` (`OBD_BLE_CONFIG`). Every ELM327-class BLE
  dongle exposes a UART-style GATT service, but the exact UUID varies by
  chipset revision. Call `ObdLinkConnection.discoverAll()` against your real
  OBDLink once, log the result, and hardcode the real UUIDs — don't ship
  against the placeholder.
- **Real, tested with plain node (no RN needed):**
  - `src/ble/obdSession.ts` + `src/ble/elmEmulator.ts`: session and Demo adapter.
  - The robust reply parser in `elm327.ts`: headers on/off, CAN multi-frame, legacy protocols.
  - `src/diag/*`: the electrical-diagnostics calculators, workflow, fault trees, DTC descriptions and report builder.

  Run `npm run test:node` (or `node scripts/run-node-tests.js` with TypeScript available; `CARTUNE_TS=/path/to/typescript` also works). Current result: 4/4 files pass, 337 counted checks.
- **Screens:**
  - `DiagnosticsScreen.tsx` (new): workflow, scan/freeze frame/clear with two-step confirmation, battery (ATRV + PID 0x42 auto-fill), voltage drop, parasitic draw and fuse drop, fault trees, sensors, CAN, safety, report export.
  - `CaptureScreen.tsx` now decodes through `ObdSession`. The old decoders assumed headers off, but `INIT_SEQUENCE` sets `ATH1`.
  - Both screens, and Home auto-detect, share one connection via `src/ble/sharedSession.ts`, with a "Demo car" option.

  These screens were type-checked against React types with stubbed RN modules only. They have **not been run on a device**.
- **Deliberately unimplemented:** OBDLink's extended "ST" command set for
  raw CAN monitor mode (`STN_EXTENDED_COMMANDS_TODO` in `elm327.ts`). Per the
  design doc, bulk CAN sniffing is a wired-adapter job — BLE throughput
  isn't there for it — so this app's scope stays VIN/DTC/live-PID + tune
  spec authoring.

## Setup

```bash
npm install
npx pod-install ios   # iOS only
```

### Permissions

**iOS** (`ios/CarTuneMobile/Info.plist`):
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>CarTune needs Bluetooth to connect to your OBD-II adapter.</string>
```

**Android** (`android/app/src/main/AndroidManifest.xml`) — Android 12+ needs
the new runtime-requestable Bluetooth permissions, not just the old
location-based ones:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
```

## Running

```bash
npm run ios       # or
npm run android
```

## Browser version

`node ../web/build.js` (or `npm run build:web`) builds `../CarTune-App.html`
from the same `src/` logic. It is a runnable browser app with Web Serial, Web
Bluetooth and Demo mode; see `../web/README.md`.

## Handoff to the orchestrator

Both screens export via the OS share sheet (`src/utils/exportFile.ts`) —
AirDrop, Nearby Share, email, cloud drive, whatever gets the file onto the
machine running the orchestrator. Once there:

```bash
python3 cartune_orchestrator.py --mobile-capture mobile_capture.json --tune-spec tune_spec.json
```

## Not built yet

- Native project files (`ios/`, `android/`) — run `npx react-native init` or
  equivalent to generate them, then drop these `src/` files and `App.tsx` in.
- XDF/EBCM-ODX upload-and-parse (the browser console's live capability
  checks) — `buildTuneSpec()` already accepts `xdfTableNames`/`ebcmSignalNames`
  params for this, just no file-picker UI yet.
- Jest/RN component tests (logic tests exist: `npm run test:node`).
- On-device verification of anything BLE (UUIDs, real replies).

# CarTune Flash Receiver Protocol (v1.1)

An open, vendor-neutral command set between the CarTune mobile app and a
receiver wired into the vehicle's OBD-II port. No cross-vendor wireless ECU
flashing standard exists, so this one is published openly: any receiver that
implements the table below works with CarTune — nothing else in the app
depends on a specific vendor.

The phone never talks to the ECU directly. It **stages** the image into the
receiver's own memory, verifies it arrived intact, then tells the receiver to
flash it over the receiver's own wired connection. A dropped radio link
mid-flash can therefore never leave a half-sent image on the ECU.

## Transports

| Transport | Details |
|---|---|
| BLE | Nordic UART Service. Service `6E400001-B5A3-F393-E0A9-E50E24DCCA9E`, app writes to RX `6E400002-…`, receiver notifies on TX `6E400003-…`. |
| Wi-Fi | Plain TCP, port **8890**, receiver's IP (default `192.168.4.1` when the receiver runs its own access point). |

Both carry the same line protocol: UTF-8 ASCII, one command per line,
terminated by `\n`. Every command gets exactly one response line.

## Commands

| Command | Response | Meaning |
|---|---|---|
| `INFO?` | `CARTUNE-RX <version> MAXCHUNK=<bytes>` | Identify. App uses `MAXCHUNK` to size data chunks (default 180 if absent). |
| `PROFILE:SET <base64 json>` | `OK` / `ERR:<reason>` | Select the ECU family before staging: `{"id","proto","bitrate","req","res","sec","writable","emissionsNotice"}`. `sec` names the receiver's security-unlock plug-in. `ERR:NOPLUGIN` if the receiver has no plug-in for that family. |
| `STAGE:BEGIN <size>` | `OK` / `ERR:<reason>` | Clear staging memory, expect `<size>` bytes. |
| `STAGE:DATA <base64>` | `OK` / `ERR:<reason>` | Append one chunk. Sent in order; the app waits for `OK` before the next. |
| `STAGE:END` | `OK` / `ERR:<reason>` | Finish staging. Receiver must reject if received length ≠ `<size>`. |
| `STAGE:SHA256?` | `<64 hex chars>` | SHA-256 of the bytes the receiver would actually flash, read back from its storage. |
| `FLASH:START` | `OK` / `ERR:<reason>` | Begin writing the staged image to the ECU. Returns immediately. |
| `FLASH:STATUS?` | `IDLE` / `WRITING <pct>` / `SUCCESS` / `FAILED:<reason>` | Current flash state. |
| `ABORT` | `OK` | Discard staged data. Must be refused (`ERR:`) while `WRITING`. |

## All manufacturers

Nearly every modern ECU flashes over UDS (ISO 14229) on CAN: session → security
unlock → erase → download → transfer → verify → reset. That sequence lives in
the receiver once. What differs per ECU family (bus speed, CAN IDs, and the
security unlock) is sent with `PROFILE:SET` and handled by a named plug-in.
The family list and each one's current status lives in
`mobile/src/ecu/ecuProfiles.ts`. Adding a manufacturer = adding a profile +
its unlock plug-in; the app and protocol do not change.

Heavy trucks and machinery use `proto: "J1939/CAN"` (29-bit IDs, usually 250k) or
`"J1708"`. When `writable` is `false` the receiver must answer `FLASH:START` with
`ERR:READONLY`. `emissionsNotice` is informational for the receiver: the warning
and user-agreement acceptance happen in the app before staging; the receiver does
not block emissions-system changes.

## Rules that make it safe

1. **Checksum is a hard gate.** The app hashes the file before sending and
   will not enable Flash unless `STAGE:SHA256?` returns the identical value.
   Receivers must hash what is in storage, not a running hash of the stream.
2. **`OK` to `FLASH:START` means "started", not "done".** The app polls
   `FLASH:STATUS?` and only reports success on an explicit `SUCCESS`.
   Receivers must only send `SUCCESS` after verifying the write (e.g. an ECU
   readback matching the staged image).
3. **Anything else is not success.** Timeouts, lost connections and
   unrecognised responses are shown to the user as failed/unknown.

## Building a receiver

Implement the table over either transport and keep rules 1–3. A reference
target is the WiCAN Pro (ESP32-S3, open firmware, BLE + Wi-Fi, microSD, CAN),
paired with an open ECU flash routine such as jakka351's Spanish Oak tool for
Ford Barra PCMs.

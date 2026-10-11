/**
 * ELM327 / STN2120 (OBDLink CX / MX+) command layer.
 *
 * This is the real, documented AT-command protocol used by every ELM327-
 * compatible adapter (SAE J1979 / ISO 15031-5 for the Mode 01/03/09 requests,
 * ELM327 datasheet for the AT command set). Nothing here is guessed — the
 * OBDLink's STN2120 chipset is ELM327-superset-compatible, so this same
 * command set works on it, with the extended STN commands left as a clearly
 * marked follow-on (see bottom of file) since those vary by firmware version
 * and should be verified against OBDLink's ST command docs before relying on
 * them for raw-CAN monitor mode.
 */

// ---------------------------------------------------------------------------
// AT setup commands — sent once per connection, in this order.
// ---------------------------------------------------------------------------
export const INIT_SEQUENCE = [
  "ATZ",   // reset
  "ATE0",  // echo off — otherwise every response is prefixed with the command we sent
  "ATL0",  // linefeeds off — keeps response parsing simple (CR-delimited only)
  "ATS0",  // spaces off
  "ATH1",  // headers ON — needed to tell multi-frame ISO-TP responses (like VIN) apart
  "ATSP0", // auto-select protocol (ISO 15765-4 CAN 11/500 is what E38/E67 uses, but
           // auto-detect is safer across other vehicles the same dongle might see)
];

// ---------------------------------------------------------------------------
// Mode 09 PID 02 — Vehicle Identification Number (multi-frame response)
// ---------------------------------------------------------------------------
export const CMD_VIN = "0902";

/**
 * VIN comes back as a multi-frame ISO-TP response, e.g. (headers-on, no spaces):
 *   014
 *   0:4902013147
 *   1:4D303030303030
 *   2:30303030303030
 * Byte layout: mode echo (49), pid echo (02), a frame-count byte, then ASCII
 * VIN bytes split across frames. We strip the "N:" frame index, strip the
 * "4902" + count-byte header duplicated on frame 0, then concat + hex-decode.
 */
export function decodeVinResponse(rawLines: string[]): string | null {
  const hexPieces: string[] = [];
  for (const line of rawLines) {
    const cleaned = line.replace(/^\d+:/, "").trim(); // drop "0:", "1:", ...
    if (!cleaned || cleaned.startsWith(">")) continue;
    hexPieces.push(cleaned);
  }
  let joined = hexPieces.join("");
  // Strip the mode/pid/count-byte header ("49" + "02" + one count byte = 3 bytes = 6 hex chars)
  const headerIdx = joined.indexOf("4902");
  if (headerIdx === -1) return null;
  joined = joined.slice(headerIdx + 4 + 2); // skip "4902" + one count byte
  const bytes = joined.match(/.{1,2}/g) || [];
  const vin = bytes
    .map((b) => parseInt(b, 16))
    .filter((n) => n > 0)
    .map((n) => String.fromCharCode(n))
    .join("");
  return vin.length >= 11 ? vin : null; // real VINs are 17 chars; allow partial reads to surface as null upstream
}

// ---------------------------------------------------------------------------
// Mode 03 — request stored (confirmed) DTCs
// ---------------------------------------------------------------------------
export const CMD_DTC_STORED = "03";
export const CMD_DTC_PENDING = "07";
export const CMD_DTC_CLEAR = "04"; // destructive — UI must require explicit confirmation before sending this
export const CMD_DTC_PERMANENT = "0A"; // Mode 0A — permanent DTCs (CAN vehicles, 2010+ typically); cannot be cleared by Mode 04

const DTC_CATEGORY = ["P", "C", "B", "U"] as const;

/**
 * Decodes SAE J2012 / ISO 15031-6 two-byte DTC pairs into strings like "P0301".
 *   byte A bits 7-6: category (00=P,01=C,10=B,11=U)
 *   byte A bits 5-4: first digit (0-3)
 *   byte A bits 3-0: second digit (hex)
 *   byte B bits 7-4: third digit (hex)
 *   byte B bits 3-0: fourth digit (hex)
 */
export function decodeDtcPair(byteA: number, byteB: number): string | null {
  if (byteA === 0 && byteB === 0) return null; // "no more DTCs" padding
  const category = DTC_CATEGORY[(byteA >> 6) & 0x03];
  const digit1 = ((byteA >> 4) & 0x03).toString(16);
  const digit2 = (byteA & 0x0f).toString(16);
  const digit3 = ((byteB >> 4) & 0x0f).toString(16);
  const digit4 = (byteB & 0x0f).toString(16);
  return `${category}${digit1}${digit2}${digit3}${digit4}`.toUpperCase();
}

/** Parses a raw Mode 03/07 response ("43 02 01 33 04 21") into DTC strings. */
export function decodeDtcResponse(rawLine: string): string[] {
  const clean = rawLine.replace(/\s+/g, "").replace(/^\d+:/, "");
  const bytes = (clean.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16));
  // First byte is the mode echo + 0x40 (43 for mode 03, 47 for mode 07); second
  // byte on some firmwares is a DTC count — skip both, then walk in pairs.
  const body = bytes.slice(2);
  const dtcs: string[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    const dtc = decodeDtcPair(body[i], body[i + 1]);
    if (dtc) dtcs.push(dtc);
  }
  return dtcs;
}

// ---------------------------------------------------------------------------
// Mode 01 — live PIDs. Keep this list small and well-known; add more only
// against your specific vehicle's supported-PID bitmask (Mode 01 PID 00).
// ---------------------------------------------------------------------------
export const LIVE_PIDS = {
  rpm: { cmd: "010C", label: "Engine RPM", decode: (b: number[]) => ((b[0] * 256 + b[1]) / 4) },
  coolant_c: { cmd: "0105", label: "Coolant temp (C)", decode: (b: number[]) => b[0] - 40 },
  intake_air_c: { cmd: "010F", label: "Intake air temp (C)", decode: (b: number[]) => b[0] - 40 },
  throttle_pct: { cmd: "0111", label: "Throttle position (%)", decode: (b: number[]) => (b[0] * 100) / 255 },
  short_fuel_trim_pct: { cmd: "0106", label: "Short-term fuel trim (%)", decode: (b: number[]) => (b[0] - 128) * (100 / 128) },
  long_fuel_trim_pct: { cmd: "0107", label: "Long-term fuel trim (%)", decode: (b: number[]) => (b[0] - 128) * (100 / 128) },
  // Added for the electrical-diagnostics dashboard. Formulas are the SAE J1979
  // standard scalings; whether a given vehicle supports each one is reported
  // by the Mode 01 PID 00/20/40 bitmasks (see decodeSupportedPids()).
  engine_load_pct: { cmd: "0104", label: "Calculated engine load (%)", decode: (b: number[]) => (b[0] * 100) / 255 },
  map_kpa: { cmd: "010B", label: "Intake manifold pressure (kPa)", decode: (b: number[]) => b[0] },
  speed_kph: { cmd: "010D", label: "Vehicle speed (km/h)", decode: (b: number[]) => b[0] },
  timing_adv_deg: { cmd: "010E", label: "Timing advance (deg)", decode: (b: number[]) => b[0] / 2 - 64 },
  maf_gps: { cmd: "0110", label: "MAF air flow (g/s)", decode: (b: number[]) => (b[0] * 256 + b[1]) / 100 },
  o2_b1s1_v: { cmd: "0114", label: "O2 sensor B1S1 (V)", decode: (b: number[]) => b[0] / 200 },
  fuel_level_pct: { cmd: "012F", label: "Fuel level (%)", decode: (b: number[]) => (b[0] * 100) / 255 },
  baro_kpa: { cmd: "0133", label: "Barometric pressure (kPa)", decode: (b: number[]) => b[0] },
  module_voltage: { cmd: "0142", label: "Control module voltage (V)", decode: (b: number[]) => (b[0] * 256 + b[1]) / 1000 },
} as const;

export type LivePidKey = keyof typeof LIVE_PIDS;

/** Parses "41 0C 1A F8" style Mode 01 responses into the raw data bytes. */
export function decodePidResponseBytes(rawLine: string): number[] {
  const clean = rawLine.replace(/\s+/g, "").replace(/^\d+:/, "");
  const bytes = (clean.match(/.{1,2}/g) || []).map((b) => parseInt(b, 16));
  return bytes.slice(2); // drop mode-echo (41) + pid-echo byte
}

// ---------------------------------------------------------------------------
// Robust response parsing (added with the electrical-diagnostics feature).
//
// INIT_SEQUENCE turns headers ON (ATH1), which changes what the adapter
// prints: an 11-bit CAN reply looks like "7E8 04 41 0C 1A F8" (header, ISO-TP
// PCI byte, data) and multi-frame replies arrive as First/Consecutive frames
// ("7E8 10 14 49 02 01 ..." / "7E8 21 ..."). With headers OFF it looks like
// "41 0C 1A F8", and multi-frame CAN replies use the ELM's "014 / 0: / 1:"
// formatting. The single-line helpers above assume headers-off input, so the
// functions below accept either format (plus 29-bit CAN and the 3-byte
// J1850/ISO 9141/KWP headers) and hand back per-ECU payloads that start at the
// mode-echo byte. Formats follow the ELM327 datasheet and ISO 15765-2; they
// are unit-tested against those documented formats (mobile/scripts/
// test-elm327.js) but have NOT yet been exercised against every real adapter.
// ---------------------------------------------------------------------------

/** Adapter replies that mean "no usable answer". */
export const ELM_ERROR_PATTERNS: RegExp[] = [
  /^NO ?DATA$/, /^UNABLE TO CONNECT$/, /^CAN ERROR$/, /^BUS ERROR$/, /^BUS BUSY$/, /^BUS INIT:? ?\.*ERROR$/,
  /^FB ERROR$/, /^DATA ERROR/, /^BUFFER FULL$/, /^STOPPED$/, /^\?$/, /^ERR\d+$/, /^ACT ALERT$/, /^LV RESET$/,
  /^LP ALERT$/, /^<RX ERROR$/,
];

export interface EcuMessage {
  /** CAN id / legacy header as printed by the adapter, or null when headers are off. */
  header: string | null;
  /** Payload starting at the mode-echo byte (e.g. 0x41 for a Mode 01 reply). */
  bytes: number[];
}

/** Splits raw adapter output into trimmed, upper-cased lines and drops
 * prompts, "SEARCHING...", "BUS INIT: ...OK" and the echoed command. */
export function cleanLines(raw: string | string[], sentCmd?: string): string[] {
  const text = Array.isArray(raw) ? raw.join("\r") : raw;
  const echo = sentCmd ? sentCmd.replace(/\s+/g, "").toUpperCase() : null;
  return text
    .split(/[\r\n]+/)
    .map((l) => l.replace(/>/g, "").trim().toUpperCase())
    .filter((l) => l.length > 0)
    .filter((l) => !/^SEARCHING/.test(l) && !/^BUS INIT:? ?\.*OK$/.test(l))
    .filter((l) => !(echo && l.replace(/\s+/g, "") === echo));
}

/** Returns the adapter error text if the reply is an error, else null. */
export function responseError(raw: string | string[], sentCmd?: string): string | null {
  const lines = cleanLines(raw, sentCmd);
  if (!lines.length) return "NO RESPONSE";
  for (const l of lines) {
    if (ELM_ERROR_PATTERNS.some((re) => re.test(l))) return l;
  }
  return null;
}

function hexBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/**
 * Parses any OBD reply into per-ECU messages.
 * @param headers true = adapter has ATH1, false = ATH0, undefined = auto-detect per line.
 */
export function parseObdMessages(raw: string | string[], sentCmd?: string, headers?: boolean): EcuMessage[] {
  const lines = cleanLines(raw, sentCmd)
    .filter((l) => !ELM_ERROR_PATTERNS.some((re) => re.test(l)))
    .map((l) => l.replace(/\s+/g, ""));
  const out: EcuMessage[] = [];

  // Headers-off CAN multi-frame: "014" byte-count line followed by "0:...", "1:...".
  if (headers !== true && lines.some((l) => /^[0-9A-F]:/.test(l) || /^[0-9A-F]{3}$/.test(l))) {
    let cur: { len: number; bytes: number[] } | null = null;
    const flush = () => { if (cur) { out.push({ header: null, bytes: cur.bytes.slice(0, cur.len || cur.bytes.length) }); cur = null; } };
    for (const l of lines) {
      if (/^[0-9A-F]{3}$/.test(l)) { flush(); cur = { len: parseInt(l, 16), bytes: [] }; continue; }
      const m = /^([0-9A-F]):([0-9A-F]*)$/.exec(l);
      if (m) {
        if (!cur) cur = { len: 0, bytes: [] };
        cur.bytes.push(...hexBytes(m[2]));
        continue;
      }
      if (/^[0-9A-F]+$/.test(l)) { flush(); out.push({ header: null, bytes: hexBytes(l) }); }
    }
    flush();
    return out;
  }

  const pending = new Map<string, { len: number; bytes: number[] }>();
  for (const l of lines) {
    if (!/^[0-9A-F]+$/.test(l)) continue;
    let header: string | null = null;
    let rest = l;
    let isoTp = false;
    let legacy = false;
    const looksCan11 = l.length % 2 === 1 && l.length >= 5;
    const looksCan29 = l.length % 2 === 0 && l.length >= 12 && /^18DA/.test(l);
    const looksLegacy = l.length % 2 === 0 && l.length >= 10 && (/^(48|41|68)6B/.test(l) || /^[8C][0-9A-F]F1/.test(l));
    if (headers !== false && looksCan11) { header = l.slice(0, 3); rest = l.slice(3); isoTp = true; }
    else if (headers !== false && looksCan29) { header = l.slice(0, 8); rest = l.slice(8); isoTp = true; }
    else if (headers !== false && looksLegacy) { header = l.slice(0, 6); rest = l.slice(6, -2); legacy = true; }
    const b = hexBytes(rest);
    if (!isoTp) { out.push({ header: legacy ? header : null, bytes: b }); continue; }
    const pci = b[0] ?? 0;
    const type = pci >> 4;
    if (type === 0) {
      const len = pci & 0x0f;
      out.push({ header, bytes: b.slice(1, 1 + len) });
    } else if (type === 1) {
      const len = ((pci & 0x0f) << 8) | (b[1] ?? 0);
      pending.set(header!, { len, bytes: b.slice(2) });
    } else if (type === 2) {
      const p = pending.get(header!);
      if (p) p.bytes.push(...b.slice(1));
    }
    // Flush any multi-frame message that is now complete.
    for (const [h, p] of pending) {
      if (p.bytes.length >= p.len) { out.push({ header: h, bytes: p.bytes.slice(0, p.len) }); pending.delete(h); }
    }
  }
  // Incomplete multi-frame replies: return what arrived rather than nothing.
  for (const [h, p] of pending) out.push({ header: h, bytes: p.bytes });
  return out;
}

/** First message whose payload starts with the positive-response byte for `mode` (and `pid`, if given). */
export function findResponse(messages: EcuMessage[], mode: number, pid?: number): EcuMessage | undefined {
  return messages.find((m) => m.bytes[0] === 0x40 + mode && (pid === undefined || m.bytes[1] === pid));
}

/** Encodes "P0301" back into the two J2012 bytes (inverse of decodeDtcPair). */
export function encodeDtc(code: string): [number, number] {
  const c = code.trim().toUpperCase();
  if (!/^[PCBU][0-3][0-9A-F]{3}$/.test(c)) throw new Error(`not a DTC: ${code}`);
  const cat = "PCBU".indexOf(c[0]);
  const a = (cat << 6) | (parseInt(c[1], 16) << 4) | parseInt(c[2], 16);
  const b = (parseInt(c[3], 16) << 4) | parseInt(c[4], 16);
  return [a, b];
}

/**
 * Decodes Mode 03 / 07 / 0A replies from every ECU that answered.
 * CAN replies carry a DTC-count byte after the mode echo (odd body length);
 * legacy J1850/ISO 9141/KWP replies carry exactly three pairs (even length).
 */
export function decodeDtcs(raw: string | string[], mode: 3 | 7 | 10, sentCmd?: string, headers?: boolean): string[] {
  const found: string[] = [];
  for (const m of parseObdMessages(raw, sentCmd, headers)) {
    if (m.bytes[0] !== 0x40 + mode) continue;
    let body = m.bytes.slice(1);
    if (body.length % 2 === 1) body = body.slice(1, 1 + 2 * body[0]);
    for (let i = 0; i + 1 < body.length; i += 2) {
      const d = decodeDtcPair(body[i], body[i + 1]);
      if (d && !found.includes(d)) found.push(d);
    }
  }
  return found;
}

/** Mode 01 reply for a given PID → data bytes (after mode + PID echo), or null. */
export function pidDataBytes(raw: string | string[], cmd: string, headers?: boolean): number[] | null {
  const pid = parseInt(cmd.slice(2, 4), 16);
  const m = findResponse(parseObdMessages(raw, cmd, headers), 1, pid);
  return m ? m.bytes.slice(2) : null;
}

/** Decodes a live PID reply to a number (null if unsupported / no data). */
export function decodeLivePid(key: LivePidKey, raw: string | string[], headers?: boolean): number | null {
  const def = LIVE_PIDS[key];
  const b = pidDataBytes(raw, def.cmd, headers);
  if (!b || !b.length) return null;
  const v = def.decode(b);
  return Number.isFinite(v) ? v : null;
}

/** Mode 01 PID 00/20/40/... bitmask → list of supported PID numbers. */
export function decodeSupportedPids(base: number, dataBytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < 32; i++) {
    const byte = dataBytes[i >> 3] ?? 0;
    if (byte & (0x80 >> (i & 7))) out.push(base + i + 1);
  }
  return out;
}

/** Mode 09 PID 02 via the robust parser (falls back to decodeVinResponse). */
export function decodeVinFromResponse(raw: string | string[], headers?: boolean): string | null {
  const msgs = parseObdMessages(raw, CMD_VIN, headers).filter((m) => m.bytes[0] === 0x49 && m.bytes[1] === 0x02);
  let data: number[] = [];
  const full = msgs.find((m) => m.bytes.length > 7);
  if (full) {
    data = full.bytes.slice(3); // CAN: 49 02 <count> + 17 ASCII bytes (first ECU that answered)
  } else if (msgs.length > 1) {
    // Legacy protocols: five messages "49 02 <seq> b1 b2 b3 b4".
    data = msgs.slice().sort((a, b) => a.bytes[2] - b.bytes[2]).flatMap((m) => m.bytes.slice(3));
  }
  const vin = data.filter((n) => n > 0x20 && n < 0x7f).map((n) => String.fromCharCode(n)).join("").replace(/[^A-Z0-9]/g, "");
  if (vin.length >= 17) return vin.slice(-17);
  const lines = Array.isArray(raw) ? raw : cleanLines(raw);
  return decodeVinResponse(lines);
}

export const CMD_CALID = "0904";

/** Mode 09 PID 04 (Calibration IDs: 16 ASCII bytes each, NUL-padded). */
export function decodeCalIds(raw: string | string[], headers?: boolean): string[] {
  const msgs = parseObdMessages(raw, CMD_CALID, headers).filter((m) => m.bytes[0] === 0x49 && m.bytes[1] === 0x04);
  let data: number[] = [];
  if (msgs.length === 1) data = msgs[0].bytes.slice(3);
  else data = msgs.slice().sort((a, b) => a.bytes[2] - b.bytes[2]).flatMap((m) => m.bytes.slice(3));
  const ids: string[] = [];
  for (let i = 0; i < data.length; i += 16) {
    const s = data.slice(i, i + 16).filter((n) => n > 0x20 && n < 0x7f).map((n) => String.fromCharCode(n)).join("").trim();
    if (s) ids.push(s);
  }
  return ids;
}

/** ELM327 "ATRV" (voltage at OBD pin 16) → volts. Adapter accuracy is
 * typically about ±0.1–0.2 V unless calibrated with ATCV. */
export const CMD_READ_VOLTAGE = "ATRV";
export function parseAtrv(raw: string | string[]): number | null {
  for (const l of cleanLines(raw, CMD_READ_VOLTAGE)) {
    const m = /^(\d{1,2}(?:\.\d+)?)\s*V?$/.exec(l);
    if (m) return parseFloat(m[1]);
  }
  return null;
}

/** Mode 02 freeze frame request for a PID (frame 00). */
export function freezeFrameCmd(pidCmd: string, frame = 0): string {
  return "02" + pidCmd.slice(2, 4) + frame.toString(16).padStart(2, "0").toUpperCase();
}

/** Mode 02 reply → data bytes after "42 <pid> <frame>", or null. */
export function freezeFrameBytes(raw: string | string[], cmd: string, headers?: boolean): number[] | null {
  const pid = parseInt(cmd.slice(2, 4), 16);
  const m = findResponse(parseObdMessages(raw, cmd, headers), 2, pid);
  return m ? m.bytes.slice(3) : null;
}

/** Mode 02 PID 02 = the DTC that stored the freeze frame. */
export function decodeFreezeFrameDtc(raw: string | string[], headers?: boolean): string | null {
  const b = freezeFrameBytes(raw, "020200", headers);
  return b && b.length >= 2 ? decodeDtcPair(b[0], b[1]) : null;
}

// ---------------------------------------------------------------------------
// STN extended commands (OBDLink CX/MX+ only) — raw CAN monitor mode.
// Left unimplemented on purpose: the exact ST command set differs between
// OBDLink firmware revisions, and per design doc section 11.1, bulk/raw CAN
// capture is a wired-adapter job (SnifferAgent) anyway — BLE throughput isn't
// there for full bus logging. Verify against OBDLink's ST Command Set doc
// before wiring anything here; don't guess these.
// ---------------------------------------------------------------------------
export const STN_EXTENDED_COMMANDS_TODO = {
  monitorAll: null, // e.g. "STM" family on some firmwares — CONFIRM before use
};

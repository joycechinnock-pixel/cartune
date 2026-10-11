/**
 * ELM327 emulator — a DEMO / TEST adapter, not a real one.
 *
 * Answers the same AT/OBD commands a real ELM327 would, in the documented
 * reply formats (echo, headers on/off, spaces on/off, ISO-TP multi-frame),
 * from a simulated vehicle. It exists so every screen of the app can be used
 * with no car attached, and so the parsers in elm327.ts / obdSession.ts are
 * exercised end-to-end by the node tests. Values are made up; nothing here
 * is read from a vehicle.
 */
import { LIVE_PIDS, encodeDtc } from "./elm327";

export interface DemoVehicle {
  vin: string;
  calId: string;
  stored: string[];
  pending: string[];
  permanent: string[];
  /** DTC that stored freeze frame 00 (defaults to the first stored code). */
  freezeFrameDtc?: string;
}

/** Mirrors mock_data/sample_dtc_report.json (P0171 stored, P0300 pending). */
export const DEFAULT_DEMO_VEHICLE: DemoVehicle = {
  vin: "1G1ZE5ST9HF123456",
  calId: "12612384",
  stored: ["P0171"],
  pending: ["P0300"],
  permanent: ["P0171"],
};

export interface EmulatorOptions {
  /** Injectable clock (ms) so tests are deterministic. */
  now?: () => number;
  /** Engine running? Affects rpm and ATRV (charging ~14.2 V vs resting ~12.5 V). */
  engineRunning?: boolean;
}

const hex2 = (n: number) => (n & 0xff).toString(16).toUpperCase().padStart(2, "0");

export class ElmEmulator {
  echo = true;
  headers = false;
  spaces = true;
  private searched = false;
  private start: number;
  private now: () => number;
  engineRunning: boolean;
  vehicle: DemoVehicle;
  /** Every command received, for tests (e.g. to assert Mode 04 was / wasn't sent). */
  log: string[] = [];
  private crankUntil = 0;
  private crankFrom = 0;

  constructor(vehicle: DemoVehicle = DEFAULT_DEMO_VEHICLE, opts: EmulatorOptions = {}) {
    this.vehicle = { ...vehicle, stored: [...vehicle.stored], pending: [...vehicle.pending], permanent: [...vehicle.permanent] };
    this.now = opts.now ?? (() => Date.now());
    this.start = this.now();
    this.engineRunning = opts.engineRunning ?? true;
  }

  /** Demo only: simulate a ~`ms` crank (voltage dip) starting now, engine then runs. */
  startCrank(ms = 1500): void {
    this.crankFrom = this.now();
    this.crankUntil = this.crankFrom + ms;
    this.engineRunning = true;
  }

  /** Simulated voltage at OBD pin 16 (what ATRV reports). */
  batteryVolts(): number {
    const t = this.now();
    if (t < this.crankUntil) {
      const f = (t - this.crankFrom) / Math.max(1, this.crankUntil - this.crankFrom);
      return 10.1 + Math.abs(Math.sin(f * Math.PI * 6)) * 0.5; // dips to ~10.1 V, starter ripple
    }
    return this.engineRunning ? 14.2 : 12.5;
  }

  /** Simulated sensor state at the current time. */
  state() {
    const t = (this.now() - this.start) / 1000;
    const wobble = (period: number, amp: number) => Math.sin((t / period) * 2 * Math.PI) * amp;
    const run = this.engineRunning;
    const rpm = run ? 780 + wobble(7, 25) + Math.max(0, wobble(23, 900)) : 0;
    return {
      rpm,
      coolant_c: Math.min(90, 40 + t * 0.5),
      intake_air_c: 28 + wobble(60, 2),
      throttle_pct: run ? 14 + Math.max(0, wobble(23, 18)) : 12,
      short_fuel_trim_pct: run ? 3 + wobble(3, 4) : 0,
      long_fuel_trim_pct: run ? 11.7 : 0, // lean trim to match the P0171 demo code
      engine_load_pct: run ? 22 + Math.max(0, wobble(23, 20)) : 0,
      map_kpa: run ? 34 + Math.max(0, wobble(23, 30)) : 101,
      speed_kph: run ? Math.max(0, wobble(23, 40)) : 0,
      timing_adv_deg: run ? 12 + wobble(5, 3) : 0,
      maf_gps: run ? 3.2 + Math.max(0, wobble(23, 9)) : 0,
      o2_b1s1_v: run ? 0.45 + wobble(1.3, 0.4) : 0.45,
      fuel_level_pct: 62,
      baro_kpa: 101,
      module_voltage: this.now() < this.crankUntil ? this.batteryVolts() - 0.1 : run ? 14.18 + wobble(11, 0.06) : 12.52,
    } as Record<string, number>;
  }

  private encodePid(key: string, v: number): number[] {
    switch (key) {
      case "rpm": { const r = Math.round(v * 4); return [r >> 8, r & 0xff]; }
      case "coolant_c": case "intake_air_c": return [Math.round(v + 40)];
      case "throttle_pct": case "engine_load_pct": case "fuel_level_pct": return [Math.round((v * 255) / 100)];
      case "short_fuel_trim_pct": case "long_fuel_trim_pct": return [Math.round(v * 1.28 + 128)];
      case "map_kpa": case "speed_kph": case "baro_kpa": return [Math.round(v)];
      case "timing_adv_deg": return [Math.round((v + 64) * 2)];
      case "maf_gps": { const r = Math.round(v * 100); return [r >> 8, r & 0xff]; }
      case "o2_b1s1_v": return [Math.round(v * 200), 0xff];
      case "module_voltage": { const r = Math.round(v * 1000); return [r >> 8, r & 0xff]; }
      default: return [0];
    }
  }

  private supportedPids(): number[] {
    return Object.values(LIVE_PIDS).map((p) => parseInt(p.cmd.slice(2), 16));
  }

  private bitmap(base: number): number[] {
    const sup = this.supportedPids();
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 32; i++) {
      const pid = base + i + 1;
      const next = i === 31 && sup.some((p) => p > pid);
      if (sup.includes(pid) || next) out[i >> 3] |= 0x80 >> (i & 7);
    }
    return out;
  }

  /** Formats one ECU payload the way the adapter would print it. */
  private frame(payload: number[]): string[] {
    const j = (b: number[]) => b.map(hex2).join(this.spaces ? " " : "");
    if (this.headers) {
      const h = "7E8";
      const sep = this.spaces ? " " : "";
      if (payload.length <= 7) return [h + sep + j([payload.length, ...payload])];
      const lines = [h + sep + j([0x10 | (payload.length >> 8), payload.length & 0xff, ...payload.slice(0, 6)])];
      let seq = 1;
      for (let i = 6; i < payload.length; i += 7, seq++) {
        const chunk = payload.slice(i, i + 7);
        while (chunk.length < 7) chunk.push(0x00);
        lines.push(h + sep + j([0x20 | (seq & 0x0f), ...chunk]));
      }
      return lines;
    }
    if (payload.length <= 7) return [j(payload)];
    const lines = [payload.length.toString(16).toUpperCase().padStart(3, "0")];
    lines.push("0:" + (this.spaces ? " " : "") + j(payload.slice(0, 6)));
    let seq = 1;
    for (let i = 6; i < payload.length; i += 7, seq++) {
      const chunk = payload.slice(i, i + 7);
      while (chunk.length < 7) chunk.push(0x00);
      lines.push((seq & 0x0f).toString(16).toUpperCase() + ":" + (this.spaces ? " " : "") + j(chunk));
    }
    return lines;
  }

  private dtcPayload(mode: number, codes: string[]): number[] {
    const body: number[] = [];
    codes.forEach((c) => body.push(...encodeDtc(c)));
    return [0x40 + mode, codes.length, ...body];
  }

  private obd(cmd: string): string[] {
    const mode = parseInt(cmd.slice(0, 2), 16);
    const pid = cmd.length >= 4 ? parseInt(cmd.slice(2, 4), 16) : -1;
    const st = this.state();
    const keyFor = (p: number) => Object.keys(LIVE_PIDS).find((k) => parseInt((LIVE_PIDS as any)[k].cmd.slice(2), 16) === p);
    switch (mode) {
      case 0x01: {
        if (pid % 0x20 === 0 && pid <= 0x60) return this.frame([0x41, pid, ...this.bitmap(pid)]);
        const k = keyFor(pid);
        if (!k) return ["NO DATA"];
        return this.frame([0x41, pid, ...this.encodePid(k, st[k])]);
      }
      case 0x02: {
        const frameNo = cmd.length >= 6 ? parseInt(cmd.slice(4, 6), 16) : 0;
        const ffDtc = this.vehicle.freezeFrameDtc ?? this.vehicle.stored[0];
        if (frameNo !== 0 || !ffDtc) return ["NO DATA"];
        if (pid === 0x02) return this.frame([0x42, 0x02, 0x00, ...encodeDtc(ffDtc)]);
        const k = keyFor(pid);
        if (!k) return ["NO DATA"];
        // Freeze frame = a fixed warm-idle snapshot.
        const snap: Record<string, number> = { ...st, rpm: 812, coolant_c: 88, speed_kph: 0, long_fuel_trim_pct: 14.8, short_fuel_trim_pct: 6.2, module_voltage: 14.1 };
        return this.frame([0x42, pid, 0x00, ...this.encodePid(k, snap[k])]);
      }
      case 0x03: return this.frame(this.dtcPayload(3, this.vehicle.stored));
      case 0x07: return this.frame(this.dtcPayload(7, this.vehicle.pending));
      case 0x0a: return this.frame(this.dtcPayload(0x0a, this.vehicle.permanent));
      case 0x04:
        // Mode 04 clears stored + pending codes and freeze frame. Permanent
        // codes stay until the monitor re-runs and passes (per SAE J1979).
        this.vehicle.stored = []; this.vehicle.pending = [];
        this.vehicle.freezeFrameDtc = "";
        return this.frame([0x44]);
      case 0x09: {
        const ascii = (s: string, n: number) => { const a = s.split("").map((c) => c.charCodeAt(0)); while (a.length < n) a.push(0); return a.slice(0, n); };
        if (pid === 0x02) return this.frame([0x49, 0x02, 0x01, ...ascii(this.vehicle.vin, 17)]);
        if (pid === 0x04) return this.frame([0x49, 0x04, 0x01, ...ascii(this.vehicle.calId, 16)]);
        return ["NO DATA"];
      }
      default: return ["NO DATA"];
    }
  }

  /** Handles one command; returns the full raw reply text ending in the ">" prompt. */
  handle(rawCmd: string): string {
    const cmd = rawCmd.replace(/\s+/g, "").toUpperCase();
    this.log.push(cmd);
    let body: string[];
    if (cmd.startsWith("AT")) {
      const at = cmd.slice(2);
      if (at === "Z" || at === "WS") { this.echo = true; this.headers = false; this.spaces = true; this.searched = false; body = ["", "ELM327 v1.5"]; }
      else if (at === "I") body = ["ELM327 v1.5"];
      else if (at === "@1") body = ["CarTune DEMO adapter (simulated)"];
      else if (at === "E0") { this.echo = false; body = ["OK"]; }
      else if (at === "E1") { this.echo = true; body = ["OK"]; }
      else if (at === "H0") { this.headers = false; body = ["OK"]; }
      else if (at === "H1") { this.headers = true; body = ["OK"]; }
      else if (at === "S0") { this.spaces = false; body = ["OK"]; }
      else if (at === "S1") { this.spaces = true; body = ["OK"]; }
      else if (at === "RV") body = [this.batteryVolts().toFixed(1) + "V"];
      else if (at === "DP") body = ["AUTO, ISO 15765-4 (CAN 11/500)"];
      else if (/^(L[01]|SP[0-9A-C]|AT[0-2]|ST[0-9A-F]{1,2}|D|CAF[01]|M[01])$/.test(at)) body = ["OK"];
      else body = ["?"];
    } else if (/^[0-9A-F]{2,}$/.test(cmd)) {
      body = this.obd(cmd);
      if (!this.searched) { this.searched = true; body = ["SEARCHING...", ...body]; }
    } else {
      body = ["?"];
    }
    return (this.echo ? rawCmd.trim() + "\r" : "") + body.join("\r") + "\r\r>";
  }
}

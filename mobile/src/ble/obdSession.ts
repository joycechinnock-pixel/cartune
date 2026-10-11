/**
 * Transport-agnostic OBD-II session on top of the ELM327 command layer.
 *
 * Works with anything that can send one command and return the adapter's
 * reply text: the react-native-ble-plx connection (obdLink.ts), the browser
 * app's Web Serial / Web Bluetooth transports, or ElmEmulator (demo mode and
 * tests). Read-only by design except clearDtcs(), which refuses to run
 * without an explicit confirmation flag — the UI must ask the human first.
 * Nothing here reads or writes calibration data.
 */
import {
  INIT_SEQUENCE, CMD_VIN, CMD_CALID, CMD_DTC_STORED, CMD_DTC_PENDING, CMD_DTC_PERMANENT, CMD_DTC_CLEAR,
  CMD_READ_VOLTAGE, LIVE_PIDS, LivePidKey, decodeDtcs, decodeLivePid, decodeVinFromResponse, decodeCalIds,
  parseAtrv, responseError, pidDataBytes, decodeSupportedPids, freezeFrameCmd, freezeFrameBytes,
  decodeFreezeFrameDtc, findResponse, parseObdMessages,
} from "./elm327";

export interface CommandTransport {
  /** Sends one command (without CR) and resolves with the raw reply (lines or text). */
  send(cmd: string, timeoutMs?: number): Promise<string | string[]>;
}

export interface DtcReadResult { stored: string[]; pending: string[]; permanent: string[]; errors: Record<string, string>; }
export interface FreezeFrame { dtc: string | null; values: Partial<Record<LivePidKey, number>>; }

export class ObdSession {
  headers = false;
  adapterId: string | null = null;
  protocol: string | null = null;
  supported: number[] | null = null;
  /** Optional traffic logger (the browser app shows this as the raw adapter log). */
  onTraffic?: (dir: "tx" | "rx", text: string) => void;

  constructor(private transport: CommandTransport) {}

  async raw(cmd: string, timeoutMs = 5000): Promise<string[]> {
    this.onTraffic?.("tx", cmd);
    const r = await this.transport.send(cmd, timeoutMs);
    const lines = (Array.isArray(r) ? r : r.split(/[\r\n]+/)).map((l) => l.trim()).filter((l) => l && l !== ">");
    this.onTraffic?.("rx", lines.join(" | "));
    return lines;
  }

  /** Runs INIT_SEQUENCE (same as the mobile app) and records adapter/protocol info. */
  async init(): Promise<void> {
    for (const cmd of INIT_SEQUENCE) {
      const lines = await this.raw(cmd, cmd === "ATZ" ? 4000 : 3000);
      if (cmd === "ATZ") this.adapterId = lines.find((l) => /ELM|STN|OBD|v\d/i.test(l)) ?? null;
      if (cmd === "ATH1") this.headers = lines.some((l) => /OK/.test(l));
      if (cmd === "ATH0") this.headers = false;
    }
    // First OBD request after ATSP0 triggers the protocol search (can take ~10 s).
    const sup = await this.raw("0100", 15000);
    const d = pidDataBytes(sup, "0100", this.headers);
    this.supported = d ? decodeSupportedPids(0, d) : null;
    if (this.supported && this.supported.includes(0x20)) {
      const d2 = pidDataBytes(await this.raw("0120"), "0120", this.headers);
      if (d2) this.supported.push(...decodeSupportedPids(0x20, d2));
      if (this.supported.includes(0x40)) {
        const d3 = pidDataBytes(await this.raw("0140"), "0140", this.headers);
        if (d3) this.supported.push(...decodeSupportedPids(0x40, d3));
      }
    }
    const dp = await this.raw("ATDP").catch(() => [] as string[]);
    this.protocol = dp.find((l) => !/^ATDP$/i.test(l)) ?? null;
  }

  isSupported(key: LivePidKey): boolean | null {
    if (!this.supported) return null;
    return this.supported.includes(parseInt(LIVE_PIDS[key].cmd.slice(2), 16));
  }

  async readVin(): Promise<string | null> {
    return decodeVinFromResponse(await this.raw(CMD_VIN, 8000), this.headers);
  }

  async readCalIds(): Promise<string[]> {
    const r = await this.raw(CMD_CALID, 8000);
    return responseError(r, CMD_CALID) ? [] : decodeCalIds(r, this.headers);
  }

  async readDtcs(): Promise<DtcReadResult> {
    const out: DtcReadResult = { stored: [], pending: [], permanent: [], errors: {} };
    const modes: [keyof Omit<DtcReadResult, "errors">, string, 3 | 7 | 10][] = [
      ["stored", CMD_DTC_STORED, 3], ["pending", CMD_DTC_PENDING, 7], ["permanent", CMD_DTC_PERMANENT, 10],
    ];
    for (const [k, cmd, mode] of modes) {
      const r = await this.raw(cmd, 8000);
      const err = responseError(r, cmd);
      if (err && err !== "NO DATA") out.errors[k] = err;
      out[k] = decodeDtcs(r, mode, cmd, this.headers);
    }
    return out;
  }

  /** Mode 02 frame 00 for the given PIDs (only those the ECU answers). */
  async readFreezeFrame(keys: LivePidKey[] = Object.keys(LIVE_PIDS) as LivePidKey[]): Promise<FreezeFrame> {
    const dtc = decodeFreezeFrameDtc(await this.raw("020200"), this.headers);
    const values: Partial<Record<LivePidKey, number>> = {};
    if (dtc) {
      for (const k of keys) {
        const cmd = freezeFrameCmd(LIVE_PIDS[k].cmd);
        const b = freezeFrameBytes(await this.raw(cmd), cmd, this.headers);
        if (b && b.length) values[k] = LIVE_PIDS[k].decode(b);
      }
    }
    return { dtc, values };
  }

  /**
   * Mode 04 — clears stored/pending DTCs, freeze frame and readiness monitors.
   * Destructive: callers must pass { confirmed: true } after the human has
   * explicitly agreed in the UI. Returns true only on a positive 0x44 reply.
   */
  async clearDtcs(opts: { confirmed: boolean }): Promise<boolean> {
    if (!opts || opts.confirmed !== true) throw new Error("Clearing codes needs explicit confirmation");
    const r = await this.raw(CMD_DTC_CLEAR, 8000);
    return !!findResponse(parseObdMessages(r, CMD_DTC_CLEAR, this.headers), 4);
  }

  async readPid(key: LivePidKey): Promise<number | null> {
    const r = await this.raw(LIVE_PIDS[key].cmd);
    return decodeLivePid(key, r, this.headers);
  }

  /** Battery voltage two ways: ATRV (adapter measures OBD pin 16) and PID 0x42 (ECU's own reading). */
  async readBatteryVoltage(): Promise<{ atrv: number | null; pid42: number | null }> {
    const atrv = parseAtrv(await this.raw(CMD_READ_VOLTAGE));
    let pid42: number | null = null;
    if (this.isSupported("module_voltage") !== false) pid42 = await this.readPid("module_voltage").catch(() => null);
    return { atrv, pid42 };
  }
}

/** Wraps an ElmEmulator (or anything with handle(cmd) → text) as a CommandTransport. */
export function emulatorTransport(emu: { handle(cmd: string): string }, delayMs = 0): CommandTransport {
  return {
    send: (cmd: string) => new Promise((resolve) => setTimeout(() => resolve(emu.handle(cmd)), delayMs)),
  };
}

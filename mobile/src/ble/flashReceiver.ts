/**
 * Client for the CarTune Flash Receiver Protocol — full spec in
 * CarTune-Flash-Receiver-Protocol.md at the repo root. Any receiver that
 * implements that document works here; this file only speaks the documented
 * command set.
 *
 * Transports:
 *   - BLE: Nordic UART Service (published UUIDs, not guesses).
 *   - Wi-Fi: line-oriented TCP on port 8890.
 * The protocol layer (FlashReceiver) is transport-agnostic and unit-testable.
 */

import { Buffer } from "buffer";
import { sha256Hex } from "../utils/sha256";

export const BLE_UART_CONFIG = {
  serviceUUID: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  rxWriteUUID: "6e400002-b5a3-f393-e0a9-e50e24dcca9e", // app -> receiver
  txNotifyUUID: "6e400003-b5a3-f393-e0a9-e50e24dcca9e", // receiver -> app
};
export const WIFI_DEFAULTS = { host: "192.168.4.1", port: 8890 };
export const DEFAULT_CHUNK = 180;

export type FlashState = "idle" | "writing" | "success" | "failed" | "unknown";
export interface FlashStatus { state: FlashState; percent?: number; reason?: string; }

/** Anything that can send one line and give back one response line. */
export interface LineTransport {
  connect(onStatus?: (m: string) => void): Promise<void>;
  request(line: string, timeoutMs?: number): Promise<string>;
  disconnect(): Promise<void>;
  label: string;
}

/** Shared line buffering: bytes in, whole lines out, one waiter at a time. */
class LineQueue {
  private buf = "";
  private waiter: ((l: string) => void) | null = null;
  private lines: string[] = [];
  push(text: string) {
    this.buf += text;
    let i: number;
    while ((i = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, "").trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(line); }
      else this.lines.push(line);
    }
  }
  next(timeoutMs: number): Promise<string> {
    const queued = this.lines.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = null; reject(new Error("receiver did not respond in time")); }, timeoutMs);
      this.waiter = (l) => { clearTimeout(t); resolve(l); };
    });
  }
  reset() { this.buf = ""; this.lines = []; this.waiter = null; }
}

export class BleUartTransport implements LineTransport {
  label = "Bluetooth";
  private manager: any;
  private device: any = null;
  private q = new LineQueue();
  constructor(private namePrefixes: string[] = ["CarTune", "WiCAN", "CARTUNE"]) {}

  async connect(onStatus?: (m: string) => void) {
    const { BleManager } = require("react-native-ble-plx");
    this.manager = this.manager || new BleManager();
    onStatus?.("Scanning for receiver over Bluetooth…");
    const found: any = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error("No receiver found within 15s — check it's powered and in range."));
      }, 15000);
      this.manager.startDeviceScan([BLE_UART_CONFIG.serviceUUID], null, (err: any, dev: any) => {
        if (err) { clearTimeout(timer); this.manager.stopDeviceScan(); reject(err); return; }
        const name = dev?.name || dev?.localName || "";
        if (dev && (this.namePrefixes.some((p) => name.includes(p)) || name === "")) {
          clearTimeout(timer); this.manager.stopDeviceScan(); resolve(dev);
        }
      });
    });
    onStatus?.(`Connecting to ${found.name || found.id}…`);
    this.device = await found.connect();
    await this.device.discoverAllServicesAndCharacteristics();
    try { await this.device.requestMTU(247); } catch { /* not all platforms allow it */ }
    this.q.reset();
    this.device.monitorCharacteristicForService(
      BLE_UART_CONFIG.serviceUUID, BLE_UART_CONFIG.txNotifyUUID,
      (_e: any, c: any) => { if (c?.value) this.q.push(Buffer.from(c.value, "base64").toString("utf8")); },
    );
  }

  async request(line: string, timeoutMs = 5000) {
    if (!this.device) throw new Error("not connected");
    const payload = Buffer.from(line + "\n", "utf8");
    // BLE writes are limited in size; split long lines into 180-byte writes.
    for (let i = 0; i < payload.length; i += 180) {
      await this.device.writeCharacteristicWithResponseForService(
        BLE_UART_CONFIG.serviceUUID, BLE_UART_CONFIG.rxWriteUUID,
        payload.subarray(i, i + 180).toString("base64"),
      );
    }
    return this.q.next(timeoutMs);
  }

  async disconnect() {
    try { await this.device?.cancelConnection(); } catch { /* already gone */ }
    this.device = null;
  }
}

export class WifiTcpTransport implements LineTransport {
  label = "Wi-Fi";
  private sock: any = null;
  private q = new LineQueue();
  constructor(private host = WIFI_DEFAULTS.host, private port = WIFI_DEFAULTS.port) {}

  async connect(onStatus?: (m: string) => void) {
    const TcpSocket = require("react-native-tcp-socket").default;
    onStatus?.(`Connecting to ${this.host}:${this.port} over Wi-Fi…`);
    this.q.reset();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Wi-Fi connection timed out — is the phone on the receiver's network?")), 8000);
      this.sock = TcpSocket.createConnection({ host: this.host, port: this.port }, () => { clearTimeout(timer); resolve(); });
      this.sock.on("data", (d: any) => this.q.push(typeof d === "string" ? d : Buffer.from(d).toString("utf8")));
      this.sock.on("error", (e: any) => { clearTimeout(timer); reject(e); });
    });
  }

  async request(line: string, timeoutMs = 5000) {
    if (!this.sock) throw new Error("not connected");
    this.sock.write(line + "\n");
    return this.q.next(timeoutMs);
  }

  async disconnect() {
    try { this.sock?.destroy(); } catch { /* already gone */ }
    this.sock = null;
  }
}

/** Protocol layer — the only place that knows the command set. */
export class FlashReceiver {
  maxChunk = DEFAULT_CHUNK;
  constructor(public transport: LineTransport) {}

  private async expectOk(cmd: string, timeoutMs?: number) {
    const r = await this.transport.request(cmd, timeoutMs);
    if (r !== "OK") throw new Error(r.startsWith("ERR:") ? r.slice(4) : `unexpected reply "${r}" to ${cmd.split(" ")[0]}`);
  }

  async connect(onStatus?: (m: string) => void): Promise<string> {
    await this.transport.connect(onStatus);
    const info = await this.transport.request("INFO?");
    if (!info.startsWith("CARTUNE-RX")) {
      await this.transport.disconnect();
      throw new Error(`Device answered "${info}" — not a CarTune-compatible receiver.`);
    }
    const m = info.match(/MAXCHUNK=(\d+)/);
    if (m) this.maxChunk = Math.max(16, Math.min(4096, parseInt(m[1], 10)));
    return info;
  }

  /** Tells the receiver which ECU family it is writing to (bus, IDs, unlock plug-in). */
  async setProfile(profile: object) {
    await this.expectOk(`PROFILE:SET ${Buffer.from(JSON.stringify(profile), "utf8").toString("base64")}`, 10000);
  }

  /** Sends the whole image into receiver staging memory. */
  async stage(bytes: Uint8Array, onProgress?: (pct: number) => void) {
    await this.expectOk(`STAGE:BEGIN ${bytes.length}`);
    for (let off = 0; off < bytes.length; off += this.maxChunk) {
      const chunk = Buffer.from(bytes.subarray(off, off + this.maxChunk)).toString("base64");
      await this.expectOk(`STAGE:DATA ${chunk}`);
      onProgress?.(Math.round(((off + this.maxChunk > bytes.length ? bytes.length : off + this.maxChunk) / bytes.length) * 100));
    }
    await this.expectOk("STAGE:END", 15000);
  }

  async receiverChecksum(): Promise<string> {
    const r = (await this.transport.request("STAGE:SHA256?", 30000)).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(r)) throw new Error(`receiver returned an invalid checksum: "${r}"`);
    return r;
  }

  async startFlash() { await this.expectOk("FLASH:START"); }

  async status(): Promise<FlashStatus> {
    return parseStatus(await this.transport.request("FLASH:STATUS?"));
  }

  /** Polls until SUCCESS or FAILED. A timeout is reported as "unknown", never success. */
  async pollUntilDone(onUpdate: (s: FlashStatus) => void, intervalMs = 1000, maxMs = 15 * 60 * 1000): Promise<FlashStatus> {
    const start = Date.now();
    let misses = 0;
    while (Date.now() - start < maxMs) {
      try {
        const s = await this.status();
        misses = 0;
        onUpdate(s);
        if (s.state === "success" || s.state === "failed") return s;
      } catch (e: any) {
        if (++misses >= 10) return { state: "unknown", reason: `lost contact with receiver: ${e.message}` };
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return { state: "unknown", reason: "no final result within 15 minutes" };
  }

  async abort() { try { await this.transport.request("ABORT"); } catch { /* best effort */ } }
  async disconnect() { await this.transport.disconnect(); }
}

export function parseStatus(r: string): FlashStatus {
  if (r === "IDLE") return { state: "idle" };
  if (r === "SUCCESS") return { state: "success" };
  if (r.startsWith("WRITING")) {
    const pct = parseInt(r.split(" ")[1] ?? "", 10);
    return { state: "writing", percent: Number.isFinite(pct) ? pct : undefined };
  }
  if (r.startsWith("FAILED")) return { state: "failed", reason: r.split(":").slice(1).join(":") || "unspecified" };
  return { state: "unknown", reason: `unrecognised status "${r}"` };
}

export { sha256Hex };

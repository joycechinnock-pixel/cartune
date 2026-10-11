/**
 * BLE transport for an OBDLink CX/MX+ (or ELM327-compatible) dongle, using
 * react-native-ble-plx.
 *
 * IMPORTANT — verify before relying on this: the SERVICE/CHARACTERISTIC UUIDs
 * below are placeholders, not confirmed values. Every ELM327-class BLE dongle
 * exposes a UART-style GATT service, but the exact UUID varies by chipset
 * revision and I don't have the physical OBDLink in front of me to confirm
 * it. The fix is one-time and cheap: call `discoverAll()` below against your
 * real hardware, log `device.services()` / `service.characteristics()`, and
 * paste the real UUIDs in. This mirrors how cartune_orchestrator.py's
 * TuningAgent/FlasherAgent leave real tool CLI flags as placeholders — don't
 * trust this file's UUIDs without that one discovery pass.
 */

import { BleManager, Device, Characteristic } from "react-native-ble-plx";
import { Buffer } from "buffer";
import { INIT_SEQUENCE } from "./elm327";

// PLACEHOLDER — confirm against your OBDLink via discoverAll() before use.
export const OBD_BLE_CONFIG = {
  serviceUUID: "0000fff0-0000-1000-8000-00805f9b34fb", // common generic UART-ish service on many ELM327 BLE clones — CONFIRM for OBDLink specifically
  writeCharacteristicUUID: "0000fff2-0000-1000-8000-00805f9b34fb",
  notifyCharacteristicUUID: "0000fff1-0000-1000-8000-00805f9b34fb",
  namePrefixes: ["OBDLink", "OBDII", "OBD"], // used to filter scan results
};

export class ObdLinkConnection {
  private manager: BleManager;
  private device: Device | null = null;
  private responseBuffer = "";
  private pendingResolve: ((lines: string[]) => void) | null = null;

  constructor() {
    this.manager = new BleManager();
  }

  /** Scans for a device matching OBD_BLE_CONFIG.namePrefixes and connects. */
  async connect(onStatus?: (msg: string) => void): Promise<void> {
    onStatus?.("Scanning for OBD BLE adapter…");
    const device = await new Promise<Device>((resolve, reject) => {
      const sub = this.manager.startDeviceScan(null, null, (error, scannedDevice) => {
        if (error) {
          sub && this.manager.stopDeviceScan();
          reject(error);
          return;
        }
        const name = scannedDevice?.name || scannedDevice?.localName || "";
        if (scannedDevice && OBD_BLE_CONFIG.namePrefixes.some((p) => name.includes(p))) {
          this.manager.stopDeviceScan();
          resolve(scannedDevice);
        }
      });
      // Give up after 15s so the UI doesn't hang forever on an unpaired dongle.
      setTimeout(() => {
        this.manager.stopDeviceScan();
        reject(new Error("No OBD BLE adapter found within 15s — check it's powered and in range."));
      }, 15000);
    });

    onStatus?.(`Found ${device.name || device.id} — connecting…`);
    this.device = await device.connect();
    await this.device.discoverAllServicesAndCharacteristics();

    this.device.monitorCharacteristicForService(
      OBD_BLE_CONFIG.serviceUUID,
      OBD_BLE_CONFIG.notifyCharacteristicUUID,
      (error, characteristic) => this.handleNotification(error, characteristic)
    );

    onStatus?.("Connected — running ELM327 init sequence…");
    for (const cmd of INIT_SEQUENCE) {
      await this.sendCommand(cmd);
    }
    onStatus?.("Ready.");
  }

  /** One-time helper: run this against real hardware and log the result to
   * find the actual service/characteristic UUIDs, then hardcode them above. */
  async discoverAll(): Promise<{ serviceUUID: string; characteristicUUIDs: string[] }[]> {
    if (!this.device) throw new Error("Not connected");
    const services = await this.device.services();
    const out = [];
    for (const service of services) {
      const chars = await service.characteristics();
      out.push({ serviceUUID: service.uuid, characteristicUUIDs: chars.map((c) => c.uuid) });
    }
    return out;
  }

  private handleNotification(error: Error | null, characteristic: Characteristic | null) {
    if (error || !characteristic?.value) return;
    const chunk = Buffer.from(characteristic.value, "base64").toString("ascii");
    this.responseBuffer += chunk;
    if (this.responseBuffer.includes(">")) {
      const lines = this.responseBuffer
        .split(/[\r\n]+/)
        .map((l) => l.trim())
        .filter((l) => l && l !== ">");
      this.responseBuffer = "";
      this.pendingResolve?.(lines);
      this.pendingResolve = null;
    }
  }

  /** Sends a raw AT/OBD command and resolves with the adapter's response lines. */
  async sendCommand(cmd: string, timeoutMs = 5000): Promise<string[]> {
    if (!this.device) throw new Error("Not connected");
    const payload = Buffer.from(cmd + "\r", "ascii").toString("base64");

    const responsePromise = new Promise<string[]>((resolve, reject) => {
      this.pendingResolve = resolve;
      setTimeout(() => {
        if (this.pendingResolve) {
          this.pendingResolve = null;
          reject(new Error(`Command '${cmd}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });

    await this.device.writeCharacteristicWithResponseForService(
      OBD_BLE_CONFIG.serviceUUID,
      OBD_BLE_CONFIG.writeCharacteristicUUID,
      payload
    );

    return responsePromise;
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      await this.device.cancelConnection();
      this.device = null;
    }
  }
}

/* ==========================================================================
 * Adapter transports for the browser app. Each one implements
 *   open() → Promise, send(cmd, timeoutMs) → Promise<string raw reply>, close()
 * and is wrapped by ObdSession (mobile/src/ble/obdSession.ts, bundled above),
 * so the ELM327 command set and all decoding are shared with the mobile app.
 *
 *  - DemoTransport:   ElmEmulator — simulated car, no hardware. Clearly
 *                     labelled DEMO everywhere in the UI.
 *  - SerialTransport: Web Serial (Chrome/Edge desktop) — USB ELM327/OBDLink.
 *  - BleTransport:    Web Bluetooth (Chrome/Edge; Android/desktop) — BLE
 *                     ELM327 dongles exposing a UART-style GATT service.
 * The real transports follow the Web Serial / Web Bluetooth specs and the
 * ELM327 prompt protocol ('>' ends every reply). They have NOT been verified
 * against physical adapters in this build — see README "What still needs
 * real hardware".
 * ======================================================================== */

/** Accumulates adapter output until the ELM '>' prompt, one command at a time. */
class PromptReader {
  constructor() { this.buf = ""; this.waiter = null; }
  push(text) {
    this.buf += text;
    if (this.waiter && this.buf.indexOf(">") >= 0) {
      const i = this.buf.lastIndexOf(">");
      const out = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      const w = this.waiter; this.waiter = null; clearTimeout(w.t); w.resolve(out);
    }
  }
  next(timeoutMs, cmd) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = null; reject(new Error("Adapter did not answer '" + cmd + "' within " + Math.round(timeoutMs / 1000) + " s")); }, timeoutMs);
      this.waiter = { resolve, t };
      if (this.buf.indexOf(">") >= 0) this.push("");
    });
  }
}

/** Serialises commands: ELM327 handles exactly one at a time. */
class CommandQueue {
  constructor() { this.p = Promise.resolve(); }
  run(fn) { const r = this.p.then(fn, fn); this.p = r.catch(() => {}); return r; }
}

class DemoTransport {
  constructor(vehicle, delayMs) {
    this.kind = "demo"; this.label = "Demo adapter (simulated)";
    this.emu = new EM.ElmEmulator(vehicle, {});
    this.delay = delayMs == null ? 25 : delayMs;
  }
  async open() {}
  send(cmd) { return new Promise((res) => setTimeout(() => res(this.emu.handle(cmd)), this.delay)); }
  async close() {}
}

class SerialTransport {
  constructor(baud) { this.kind = "serial"; this.baud = baud || 38400; this.label = "USB serial " + this.baud + " baud"; this.reader = new PromptReader(); this.q = new CommandQueue(); }
  static supported() { return typeof navigator !== "undefined" && "serial" in navigator; }
  async open() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baud, dataBits: 8, stopBits: 1, parity: "none", flowControl: "none" });
    const info = this.port.getInfo ? this.port.getInfo() : {};
    if (info.usbVendorId) this.label += " · USB " + info.usbVendorId.toString(16).padStart(4, "0") + ":" + (info.usbProductId || 0).toString(16).padStart(4, "0");
    this.writer = this.port.writable.getWriter();
    this.enc = new TextEncoder();
    this.closed = false;
    this.loop = (async () => {
      const dec = new TextDecoder();
      while (this.port.readable && !this.closed) {
        this.rd = this.port.readable.getReader();
        try {
          for (;;) { const { value, done } = await this.rd.read(); if (done) break; this.reader.push(dec.decode(value, { stream: true })); }
        } catch (e) { /* device unplugged or closed */ break; } finally { try { this.rd.releaseLock(); } catch (e) {} }
      }
    })();
  }
  send(cmd, timeoutMs) {
    return this.q.run(async () => {
      const p = this.reader.next(timeoutMs || 5000, cmd);
      await this.writer.write(this.enc.encode(cmd + "\r"));
      return p;
    });
  }
  async close() {
    this.closed = true;
    try { await this.rd && this.rd.cancel(); } catch (e) {}
    try { this.writer && this.writer.releaseLock(); } catch (e) {}
    try { await this.port && this.port.close(); } catch (e) {}
  }
}

/* Candidate GATT services seen on ELM327-class BLE dongles. Characteristics
 * are chosen by their properties (notify/indicate vs write), not hardcoded,
 * because they differ between chipset revisions. CONFIRM against your
 * adapter: the discovered UUIDs are shown in the adapter log. */
const BLE_CANDIDATE_SERVICES = [
  "0000fff0-0000-1000-8000-00805f9b34fb", // FFF0 — many ELM327 BLE clones (also the mobile app's placeholder)
  "0000ffe0-0000-1000-8000-00805f9b34fb", // FFE0 — HM-10/CC254x style UART
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART Service
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // seen on some Vgate/vLinker-class adapters
  "000018f0-0000-1000-8000-00805f9b34fb", // 18F0 — some ELM327 BLE clones
];

class BleTransport {
  constructor() { this.kind = "ble"; this.label = "Bluetooth LE"; this.reader = new PromptReader(); this.q = new CommandQueue(); this.discovered = []; }
  static supported() { return typeof navigator !== "undefined" && "bluetooth" in navigator; }
  async open(onLog) {
    this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_CANDIDATE_SERVICES });
    this.label = "BLE " + (this.device.name || this.device.id);
    const server = await this.device.gatt.connect();
    let notifyCh = null, writeCh = null;
    for (const uuid of BLE_CANDIDATE_SERVICES) {
      let svc; try { svc = await server.getPrimaryService(uuid); } catch (e) { continue; }
      const chars = await svc.getCharacteristics();
      this.discovered.push({ service: uuid, characteristics: chars.map((c) => ({ uuid: c.uuid, props: ["read", "write", "writeWithoutResponse", "notify", "indicate"].filter((k) => c.properties[k]) })) });
      const n = chars.find((c) => c.properties.notify || c.properties.indicate);
      const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (n && w) { notifyCh = n; writeCh = w; this.label += " · " + uuid.slice(4, 8).toUpperCase(); break; }
    }
    onLog && onLog("GATT discovery: " + JSON.stringify(this.discovered));
    if (!notifyCh || !writeCh) {
      try { this.device.gatt.disconnect(); } catch (e) {}
      throw new Error("No UART-style service found on this device (tried FFF0, FFE0, Nordic UART, E781…, 18F0). Discovery result is in the adapter log — please report it.");
    }
    this.writeCh = writeCh; this.enc = new TextEncoder();
    const dec = new TextDecoder();
    await notifyCh.startNotifications();
    notifyCh.addEventListener("characteristicvaluechanged", (ev) => this.reader.push(dec.decode(ev.target.value)));
    this.device.addEventListener("gattserverdisconnected", () => { this.lost = true; });
  }
  send(cmd, timeoutMs) {
    return this.q.run(async () => {
      if (this.lost) throw new Error("Bluetooth adapter disconnected");
      const p = this.reader.next(timeoutMs || 5000, cmd);
      const bytes = this.enc.encode(cmd + "\r");
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = bytes.slice(i, i + 20);
        if (this.writeCh.properties.writeWithoutResponse && this.writeCh.writeValueWithoutResponse) await this.writeCh.writeValueWithoutResponse(chunk);
        else await this.writeCh.writeValue(chunk);
      }
      return p;
    });
  }
  async close() { try { this.device && this.device.gatt.connected && this.device.gatt.disconnect(); } catch (e) {} }
}

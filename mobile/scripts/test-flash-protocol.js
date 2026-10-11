const crypto = require("crypto");
const assert = require("assert");
const { sha256Hex } = require("./utils/sha256");
const { FlashReceiver, parseStatus } = require("./ble/flashReceiver");

// SHA-256 vs Node crypto across edge sizes
for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 1024 * 1024 + 7]) {
  const b = crypto.randomBytes(n);
  assert.strictEqual(sha256Hex(new Uint8Array(b)), crypto.createHash("sha256").update(b).digest("hex"), `size ${n}`);
}

// Mock receiver that implements the protocol spec
function mockRx({ corrupt = false, finalStatus = "SUCCESS", info = "CARTUNE-RX 1.0 MAXCHUNK=64" } = {}) {
  let expected = 0, data = [], polls = 0, started = false;
  return {
    label: "mock", async connect() {}, async disconnect() {},
    async request(line) {
      if (line === "INFO?") return info;
      if (line.startsWith("STAGE:BEGIN ")) { expected = +line.split(" ")[1]; data = []; return "OK"; }
      if (line.startsWith("STAGE:DATA ")) { data.push(Buffer.from(line.slice(11), "base64")); return "OK"; }
      if (line === "STAGE:END") return Buffer.concat(data).length === expected ? "OK" : "ERR:length";
      if (line === "STAGE:SHA256?") { const b = Buffer.concat(data); if (corrupt) b[0] ^= 1; return crypto.createHash("sha256").update(b).digest("hex"); }
      if (line === "FLASH:START") { started = true; return "OK"; }
      if (line === "FLASH:STATUS?") { polls++; return polls < 3 ? `WRITING ${polls * 40}` : finalStatus; }
      if (line === "ABORT") return "OK";
      return "ERR:unknown";
    },
  };
}

(async () => {
  const img = new Uint8Array(crypto.randomBytes(1000));
  const local = sha256Hex(img);

  let r = new FlashReceiver(mockRx());
  await r.connect(); assert.strictEqual(r.maxChunk, 64);
  const prog = []; await r.stage(img, (p) => prog.push(p));
  assert.strictEqual(prog[prog.length - 1], 100);
  assert.strictEqual(await r.receiverChecksum(), local);
  await r.startFlash();
  const s = await r.pollUntilDone(() => {}, 1);
  assert.strictEqual(s.state, "success");

  r = new FlashReceiver(mockRx({ corrupt: true }));
  await r.connect(); await r.stage(img);
  assert.notStrictEqual(await r.receiverChecksum(), local, "corruption must be caught");

  r = new FlashReceiver(mockRx({ finalStatus: "FAILED:checksum on ECU" }));
  await r.connect(); await r.stage(img); await r.startFlash();
  const f = await r.pollUntilDone(() => {}, 1);
  assert.strictEqual(f.state, "failed"); assert.strictEqual(f.reason, "checksum on ECU");

  await assert.rejects(new FlashReceiver(mockRx({ info: "ELM327 v1.5" })).connect(), /not a CarTune-compatible/);

  const dead = { label: "x", async connect() {}, async disconnect() {}, async request(l) { if (l === "INFO?") return "CARTUNE-RX 1"; throw new Error("gone"); } };
  r = new FlashReceiver(dead); await r.connect();
  const u = await r.pollUntilDone(() => {}, 1);
  assert.strictEqual(u.state, "unknown");

  assert.deepStrictEqual(parseStatus("WRITING 55"), { state: "writing", percent: 55 });
  assert.strictEqual(parseStatus("banana").state, "unknown");
  console.log("ALL MOBILE PROTOCOL TESTS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });

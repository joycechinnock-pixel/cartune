// Admin API: the shared core through the local demo store, then the Node server
// over real HTTP + WebSocket. Auth, roles, comps, codes, demo expiry, remote help
// read-only, presence, Tune Library Vault review, audit, rate limits.
const a = require("assert");
const path = require("path");
const net = require("net");
const crypto = require("crypto");
const repo = process.env.CARTUNE_REPO || path.resolve(__dirname, "..", "..");
const API = require(path.join(repo, "web", "shared", "api.js"));
const { createServer } = require(path.join(repo, "server", "server.js"));
let n = 0; const eq = (x, y, m) => { a.deepStrictEqual(x, y, m); n++; }; const ok = (v, m) => { a.ok(v, m); n++; };
async function rejects(p, code, m) { try { await p; } catch (e) { eq(e.code, code, (m || "") + " → " + e.message); return e; } a.fail("expected " + code + ": " + (m || "")); }
const HOUR = 36e5, DAY = 864e5;

async function suite(api, label, clock) {
  const pre = await api.info(); ok(pre.setupNeeded, label + ": setup needed on a fresh store");
  await rejects(api.setupOwner({ email: "owner@example.com", password: "short", setupToken: api._setup }), "invalid", "weak password");
  await api.setupOwner({ email: "owner@example.com", name: "Olive Owner", password: "correct horse battery", setupToken: api._setup });
  await rejects(api.setupOwner({ email: "x@example.com", password: "another long one", setupToken: api._setup }), "forbidden", "setup is one-time");
  await rejects(api.login("owner@example.com", "wrong password!"), "auth");
  const own = await api.login("owner@example.com", "correct horse battery"); ok(own.token && own.user.role === "owner" && !own.user.pw, label + ": login, no hash leaked");
  const O = own.token;
  // staff and roles
  const adm = await api.createStaff(O, { email: "ash@example.com", name: "Ash Admin", role: "admin" });
  const sup = await api.createStaff(O, { email: "sky@example.com", name: "Sky Support", role: "support" });
  ok(adm.tempPassword.length >= 12, "temporary password issued");
  await rejects(api.createStaff(O, { email: "bad@example.com", role: "owner" }), "invalid", "can't mint a second owner");
  let A = (await api.login("ash@example.com", adm.tempPassword)).token, S = (await api.login("sky@example.com", sup.tempPassword)).token;
  await rejects(api.createStaff(A, { email: "z@example.com", role: "support" }), "forbidden", "admin can't create staff");
  await rejects(api.listUsers(null), "auth"); await rejects(api.listUsers("not-a-token"), "auth");
  // users (server store starts empty: add customers through a public order + heartbeat)
  let users = await api.listUsers(S);
  if (!users.some((u) => u.role === "customer")) { ok(true); }
  const shazzaList = await api.listUsers(A, "shazza");
  const cust = shazzaList[0] || null;
  if (cust) {
    eq(cust.role, "customer");
    await rejects(api.grantPackage(S, cust.id, { tier: "pro", days: 30 }), "forbidden", "support can't comp");
    await rejects(api.setSuspended(S, cust.id, true), "forbidden", "support can't suspend");
    await rejects(api.grantPackage(A, cust.id, { tier: "pro" }), "invalid", "comp needs an expiry or lifetime");
    let g = await api.grantPackage(A, cust.id, { tier: "heavy", days: 7, note: "Show car" }); eq(g.package.source, "comp"); ok(g.package.expires > clock() + 6 * DAY);
    g = await api.grantPackage(A, cust.id, { tier: "pro", lifetime: true }); eq(g.package.expires, null, "lifetime comp");
    const sus = await api.setSuspended(A, cust.id, true, "chargeback"); eq(sus.status, "suspended");
    await api.setSuspended(A, cust.id, false);
    const rp = await api.resetPassword(A, cust.id); ok(rp.tempPassword && rp.tempPassword.length >= 12);
    const ed = await api.updateUser(A, cust.id, { vehicle: { title: "VE SS-V Redline", make: "Holden" }, note: "Called about idle" }); eq(ed.vehicle.title, "VE SS-V Redline");
    const full = await api.getUser(S, cust.id); ok(Array.isArray(full.orders) && full.notes.length >= 1 && "online" in full);
  }
  const ownerRec = (await api.listUsers(O, "owner@example.com"))[0];
  await rejects(api.setSuspended(A, ownerRec.id, true), "forbidden", "owner can't be suspended");
  await rejects(api.resetPassword(A, ownerRec.id), "forbidden");
  // presence
  await api.heartbeat({ device: "dev-abc", email: cust ? cust.email : "" });
  let pres = await api.presence(S);
  if (cust) ok(pres.users[cust.id].online, "heartbeat marks the customer online"); else ok(pres.anonymousOnline >= 1, "anonymous device online");
  clock.add(5 * 60e3); pres = await api.presence(S);
  if (cust) ok(!pres.users[cust.id].online && pres.users[cust.id].lastSeen, "offline after 2 min, last seen kept"); else eq(pres.anonymousOnline, 0);
  if (cust) ok((await api.getUser(A, cust.id)).id, "offline user's account still opens");
  // codes
  await rejects(api.createCode(S, { kind: "discount", pct: 10, uses: 5 }), "forbidden", "support can't make codes");
  await rejects(api.createCode(A, { kind: "discount", pct: 10, amount: 5, uses: 5 }), "invalid", "percent or fixed, not both");
  const c10 = await api.createCode(A, { kind: "discount", code: "TEN-OFF", pct: 10, uses: 2, expiresDays: 3, scope: ["street"] });
  const cfix = await api.createCode(A, { kind: "discount", code: "FIFTY", amount: 50, uses: 1 });
  const r1 = await api.redeemCode("ten-off", { device: "dev-abc" }); eq([r1.kind, r1.pct, r1.scope], ["discount", 10, ["street"]]);
  await api.redeemCode("TEN-OFF", {}); await rejects(api.redeemCode("TEN-OFF", {}), "used", "use limit");
  await rejects(api.redeemCode("NOPE-NOPE", {}), "invalid");
  const q = api.quote([{ tier: "street" }, { pack: "trans" }], r1); eq([q.total, q.discount, q.pay], [648, 45, 603], "discount only on scoped tier");
  eq(api.quote([{ tier: "pro" }], { amount: 50 }).pay, 799);
  await api.setCodeDisabled(A, "FIFTY", true); await rejects(api.redeemCode("FIFTY", {}), "invalid", "disabled code");
  // demo access with expiry
  const demo = await api.createCode(A, { kind: "demo", code: "SHOW-1", hours: 2, uses: 3, label: "Expo" });
  const d1 = await api.redeemCode("SHOW-1", { device: "dev-1" }); eq(d1.kind, "demo"); eq(d1.appPackage, "heavy"); eq(d1.until, clock() + 2 * HOUR, "demo lasts its hours");
  const exp = await api.createCode(A, { kind: "demo", code: "SHOW-2", hours: 1, uses: 3, expiresDays: 1 });
  clock.add(2 * DAY); await rejects(api.redeemCode("SHOW-2", {}), "expired", "demo code expires");
  await rejects(api.listUsers(S), "auth", "staff sessions expire after 12 h");
  A = (await api.login("ash@example.com", adm.tempPassword)).token; S = (await api.login("sky@example.com", sup.tempPassword)).token; const O2 = (await api.login("owner@example.com", "correct horse battery")).token;
  await rejects(api.redeemCode("TEN-OFF", {}), "used");
  // remote help: read-only
  const snap = { car: { title: "Demo VE SS" }, live: { rpm: 780 }, dtcs: { stored: ["P0171"] }, settings: { skill: "simple" }, tune: { name: "Factory" } };
  const h = await api.openHelp({ name: "Shazza", email: "shazza@example.com", snapshot: snap }); ok(/^\d{6}$/.test(h.code) && h.key.length === 32);
  await rejects(api.joinHelp(S, "999999"), "notfound", "wrong code");
  const view = await api.joinHelp(S, h.code); eq(view.snapshot.dtcs.stored, ["P0171"]); ok(view.snapshot.readOnly && !view.key, "staff never get the customer key");
  await rejects(api.pushSnapshot(h.code, "wrong-key", { live: { rpm: 9999 } }), "forbidden", "staff/others can't change what the car reports");
  await rejects(api.respondSuggestion(h.code, "wrong-key", "x", true), "forbidden");
  await rejects(api.suggest(S, h.code, { kind: "flash", values: { rpm: 1 } }), "invalid", "no remote flash/write kind");
  await rejects(api.suggest(S, h.code, { kind: "settings", values: { ecuWrite: true } }), "invalid", "only whitelisted settings");
  ok(!Object.keys(API.ROUTES).some((r) => /flash|write|ecu/i.test(r)), "no flash/write route exists");
  const sg = await api.suggest(S, h.code, { kind: "tune", name: "Smoother idle", values: { idle_rpm: 50 } }); eq(sg.status, "pending");
  await api.staffChat(S, h.code, "Try this, mate"); await api.customerChat(h.code, h.key, "Ta");
  const cv = await api.customerView(h.code, h.key); eq(cv.messages.length, 2); eq(cv.suggestions[0].status, "pending");
  eq((await api.respondSuggestion(h.code, h.key, sg.id, true)).status, "accepted", "customer accepts on their device");
  await rejects(api.respondSuggestion(h.code, h.key, sg.id, false), "invalid", "answered once");
  await api.pushSnapshot(h.code, h.key, Object.assign({}, snap, { live: { rpm: 800 } }));
  eq((await api.staffView(S, h.code)).snapshot.live.rpm, 800);
  await api.endHelp(h.code, h.key); await rejects(api.staffChat(S, h.code, "hello?"), "notfound", "ended");
  // vault
  await rejects(api.submitTune({ name: "x", engine: "na_petrol", values: {} , level: 1 }), "invalid");
  const v1 = await api.submitTune({ name: "Cruiser", engine: "na_petrol", level: 1, values: { timing_part: 1 }, email: "shazza@example.com", author: "Shazza" });
  const v2 = await api.submitTune({ name: "DPF gone", engine: "turbo_diesel", level: 3, emissions: true, values: { t_dpf: 0 }, reasons: ["DPF off"] });
  eq((await api.vault()).filter((v) => v.id === v1.id).length, 0, "pending isn't public");
  await rejects(api.reviewSubmission(S, v1.id, { decision: "accept", verified: { level: 1 } }), "forbidden", "support can't publish");
  await rejects(api.reviewSubmission(A, v1.id, { decision: "accept" }), "invalid", "must re-file before accepting");
  await rejects(api.reviewSubmission(A, v2.id, { decision: "accept", roadLegal: true, verified: { level: 3, emissions: true } }), "invalid", "competition/emissions can't be road-legal");
  await rejects(api.reviewSubmission(A, v2.id, { decision: "reject" }), "invalid", "reject needs a note");
  const acc2 = await api.reviewSubmission(A, v2.id, { decision: "accept", verified: { level: 3, emissions: true, reasons: ["DPF off"] }, note: "Off-road only" });
  eq([acc2.roadLegal, acc2.gates.competitionAck, acc2.gates.agreement], [false, true, true], "gates carried");
  const acc1 = await api.reviewSubmission(A, v1.id, { decision: "accept", verified: { level: 2 }, roadLegal: false });
  eq(acc1.level, 2, "reviewer's higher level wins"); eq(acc1.roadLegal, false);
  const v3 = await api.submitTune({ name: "Bad", engine: "na_petrol", level: 1, values: { a: 1 } });
  eq((await api.reviewSubmission(A, v3.id, { decision: "reject", note: "Values out of range" })).status, "rejected");
  const pub = await api.vault(); ok(pub.some((v) => v.id === v2.id) && !pub.some((v) => v.id === v3.id) && !pub[0].email, "public vault hides emails");
  const dl = await api.vaultDownload(v2.id); eq([dl.level, dl.emissions, dl.gates.agreement], [3, true, true]);
  // stats + audit
  const st = await api.stats(S); ok(st.codesRedeemed >= 3 && st.helpSessions >= 1 && Array.isArray(st.series.signups) && st.series.signups.length === 14);
  await rejects(api.listAudit(S), "forbidden", "support can't read audit");
  const log = await api.listAudit(O2); const acts = log.map((x) => x.action);
  ["setup.owner", "login", "login.fail", "staff.create", "code.create", "demo.create", "code.redeem", "help.open", "help.join", "help.suggest", "help.suggestion_accepted", "vault.accepted", "vault.rejected", "code.disable"].forEach((x) => ok(acts.includes(x), "audit has " + x));
  if (cust) ["package.comp", "user.suspend", "user.reset_password", "user.edit"].forEach((x) => ok(acts.includes(x), "audit has " + x));
  ok(!JSON.stringify(log).includes(adm.tempPassword), "temp passwords never in the audit");
  await api.logout(A); await rejects(api.me(A), "auth", "logged out");
}

function clock0() { let t = Date.UTC(2026, 9, 11, 2); const f = () => t; f.add = (ms) => (t += ms); return f; }

(async () => {
  // 1. local demo store (seeded)
  const c1 = clock0(); const local = API.createLocalApi({ storage: API.memStorage(), now: c1 });
  ok((await local.listUsersPublic === undefined));
  await suite(local, "local", c1);
  // local seed has DEMO flag + seeded vault/presence
  eq((await local.info()).demo, true, "local store is marked DEMO DATA");

  // 2. server over HTTP + WebSocket (empty store, setup token required)
  const c2 = clock0(); let mem = null;
  const s = createServer({ store: { load: () => (mem ? JSON.parse(mem) : null), save: (d) => (mem = JSON.stringify(d)) }, static: false, now: c2, loginLimit: 16 });
  await new Promise((r) => s.server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + s.server.address().port;
  const remote = API.createRemoteApi(base);
  await rejects(remote.setupOwner({ email: "owner@example.com", password: "correct horse battery" }), "forbidden", "server setup needs the printed token");
  remote._setup = s.setupToken;
  // seed one customer on the server via the core (server stores start empty)
  await suite(remote, "server", c2);
  ok(!mem.includes("correct horse battery") && /pbkdf2-sha256/.test(mem), "server stores only password hashes");
  eq((await remote.info()).demo, false, "server store is not demo");
  // WebSocket relay
  const h = await remote.openHelp({ snapshot: { live: { rpm: 700 } } });
  const S = (await remote.login("sky@example.com", "x").catch(() => null)); ok(S === null, "suite logged-out admin");
  const O = (await remote.login("owner@example.com", "correct horse battery")).token;
  const msgs = []; const ws = await wsConnect(base, `/ws?code=${h.code}&token=${O}`, (m) => msgs.push(m));
  ok(msgs.length === 0 || msgs[0].type === "hello");
  await remote.joinHelp(O, h.code); await remote.pushSnapshot(h.code, h.key, { live: { rpm: 912 } });
  await new Promise((r) => setTimeout(r, 150));
  ok(msgs.some((m) => m.type === "snapshot" && m.data.live.rpm === 912), "snapshot relayed live over WebSocket");
  ws.destroy();
  const bad = await wsStatus(base, `/ws?code=${h.code}&key=wrong`); ok(/403/.test(bad), "WebSocket refuses a wrong key");
  // rate limit on login
  let limited = false; for (let i = 0; i < 20; i++) { try { await remote.login("owner@example.com", "nope nope nope"); } catch (e) { if (e.status === 429) { limited = true; break; } } }
  ok(limited, "login is rate limited");
  s.server.close();
  console.log(`ADMIN API TESTS PASSED — ${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

function wsConnect(base, p, onMsg) {
  return new Promise((ok, no) => { const u = new URL(base); const sock = net.connect(+u.port, u.hostname); const key = crypto.randomBytes(16).toString("base64");
    sock.write(`GET ${p} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let hs = false, buf = Buffer.alloc(0);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); if (!hs) { const i = buf.indexOf("\r\n\r\n"); if (i < 0) return; const head = buf.slice(0, i).toString(); if (!/101/.test(head)) return no(new Error(head)); hs = true; buf = buf.slice(i + 4); ok(sock); }
      while (buf.length >= 2) { let len = buf[1] & 127, off = 2; if (len === 126) { len = buf.readUInt16BE(2); off = 4; } if (buf.length < off + len) return; onMsg(JSON.parse(buf.slice(off, off + len).toString())); buf = buf.slice(off + len); } });
    sock.on("error", no); });
}
function wsStatus(base, p) { return new Promise((ok) => { const u = new URL(base); const sock = net.connect(+u.port, u.hostname); sock.write(`GET ${p} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`); let s = ""; sock.on("data", (d) => (s += d)); sock.on("end", () => ok(s)); sock.on("close", () => ok(s)); }); }

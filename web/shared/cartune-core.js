/* ==========================================================================
 * CarTune admin core — the business rules behind the admin app, used by BOTH
 * backends so they behave the same:
 *   - the local demo store (web/shared/api.js createLocalApi, localStorage), and
 *   - the Node server (server/server.js, JSON file store).
 * Plain ES2018, no dependencies. Hashing and randomness use WebCrypto
 * (globalThis.crypto), which browsers and Node >= 19 both provide.
 *
 * Accounts, licences and prices follow the 30 Sept site (prototype/CarTune.html,
 * "CarTune by DFTC"): licences are per make and paid once; tiers Street / Pro /
 * Commercial / Heavy (Commercial and Heavy are "business mode"); add-on packs;
 * share-link promos (free / % off / trial). The app's vehicle packages
 * (Standard / Commercial / Heavy, ecuProfiles.ts PACKAGES) map from the tier.
 *
 * Remote help is READ-ONLY on the car: the customer's app pushes a snapshot
 * (live data, fault codes, diagnostics, settings, the tune on screen) and staff
 * can only chat and SUGGEST a tune or settings change. A suggestion is applied
 * only when the customer accepts it on their own device, and then only as a
 * saved tune / setting; flashing still goes through the app's own local gates.
 * There is no operation here (or in the server) that writes to an ECU.
 * ======================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CarTuneCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---- catalogue: from prototype/CarTune.html (TIERS, PACKS, PROMO_T). AUD incl. GST, paid once. ---- */
  var TIERS = [
    { id: "street", name: "Street", price: 449, appPackage: "standard", biz: false, blurb: "Cars, utes and 4WDs" },
    { id: "pro", name: "Pro", price: 849, appPackage: "standard", biz: false, blurb: "Everything in Street, fully open" },
    { id: "commercial", name: "Commercial", price: 1690, appPackage: "commercial", biz: true, blurb: "Trucks and prime movers, plus Pro" },
    { id: "heavy", name: "Heavy", price: 2690, appPackage: "heavy", biz: true, blurb: "Trucks, ag and earthmoving, plus Pro" },
  ];
  var PACKS = [
    { id: "launch", name: "Launch, sound and limiter", price: 499, biz: 1490 },
    { id: "emissions", name: "Emissions", price: 349, biz: 890 },
    { id: "trans", name: "Transmission Pro", price: 199, biz: 590 },
    { id: "safety", name: "Safety systems", price: 199, biz: 490 },
  ];
  var EXTRA_MAKE = 0.5;
  var ROLES = ["owner", "admin", "support"];
  var PERMS = {
    owner: ["*"],
    admin: ["users.view", "users.edit", "users.suspend", "users.reset", "help.join", "help.chat", "help.suggest",
      "packages.grant", "codes.manage", "demo.manage", "orders.view", "orders.edit", "catalog.view", "presets.edit", "stats.view", "audit.view"],
    support: ["users.view", "help.join", "help.chat", "help.suggest", "orders.view", "catalog.view", "stats.view"],
  };
  var ORDER_STATUS = ["pre-ordered", "pay link sent", "paid", "shipped", "cancelled", "refund noted"];
  /* settings a helper may suggest (all local app preferences; nothing reaches the ECU) */
  var SETTINGS_KEYS = ["skill", "theme", "fuel", "upgrades", "pkg"];
  var HOUR = 36e5, DAY = 864e5;
  var ONLINE_MS = 2 * 60 * 1000; /* seen within 2 minutes = online */
  var PERM_NAME = { 0: "Factory", 1: "Road", 2: "Sport", 3: "Competition and off-road" };
  var SESSION_TTL = 12 * HOUR, HELP_TTL = 30 * 60 * 1000, PBKDF2_ITER = 120000;

  function err(code, msg) { var e = new Error(msg); e.code = code; return e; }
  function hex(bytes) { return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function C() { var c = (typeof globalThis !== "undefined" && globalThis.crypto) || (typeof self !== "undefined" && self.crypto); if (!c || !c.subtle) throw err("crypto", "WebCrypto is needed (a browser, or Node 19+)"); return c; }
  function randHex(n) { var a = new Uint8Array(n); C().getRandomValues(a); return hex(a); }
  function randCode(len, alphabet) { var a = new Uint8Array(len); C().getRandomValues(a); var s = ""; for (var i = 0; i < len; i++) s += alphabet[a[i] % alphabet.length]; return s; }
  var CODE_ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; /* no I/O/0/1 so codes read aloud cleanly */
  async function pbkdf2(password, saltHex) {
    var enc = new TextEncoder(), salt = new Uint8Array(saltHex.match(/../g).map(function (h) { return parseInt(h, 16); }));
    var key = await C().subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = await C().subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt, iterations: PBKDF2_ITER }, key, 256);
    return hex(new Uint8Array(bits));
  }
  async function hashPassword(pw) { var salt = randHex(16); return { alg: "pbkdf2-sha256", iter: PBKDF2_ITER, salt: salt, hash: await pbkdf2(pw, salt) }; }
  async function checkPassword(pw, rec) { if (!rec || !rec.salt) return false; var h = await pbkdf2(pw, rec.salt); var a = h, b = rec.hash, d = a.length ^ b.length; for (var i = 0; i < a.length && i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
  function clean(u) { if (!u) return u; var o = Object.assign({}, u); delete o.pw; return o; }
  function tierOf(id) { return TIERS.find(function (t) { return t.id === id; }); }
  function emailOk(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || "")); }
  function strongPw(p) { return typeof p === "string" && p.length >= 10; }

  function emptyDb() { return { v: 1, demo: false, users: [], tokens: {}, codes: [], orders: [], help: [], presets: {}, audit: [], redemptions: [], vault: [], devices: {}, setupDone: false }; }

  /* ---- seed (local demo store only; clearly flagged demo:true and shown as DEMO DATA) ---- */
  function seedDemo(db, now) {
    db.demo = true;
    var people = [
      ["Shazza Nguyen", "shazza@example.com", "Holden Commodore SS (VE)", "Holden", "pro", "paid", "gm-e38"],
      ["Dazza Kelly", "dazza@example.com", "Ford Falcon XR6 Turbo (FG)", "Ford", "street", "paid", "ford-bosch"],
      ["Bec Thompson", "bec@example.com", "Toyota HiLux 2.8 (GUN126)", "Toyota", "street", "comp", "denso-diesel"],
      ["Mick O'Brien", "mick@example.com", "Kenworth T610 (X15)", "Kenworth", "commercial", "paid", "cummins-cm2350"],
      ["Jess Walker", "jess@example.com", "Ford Ranger 2.0 Bi-Turbo", "Ford", null, null, null],
      ["Tran Le", "tran@example.com", "Nissan Patrol Y62", "Nissan", "street", "demo", null],
      ["Gazza Smith", "gazza@example.com", "John Deere 8R 410", "John Deere", "heavy", "paid", null],
      ["Kylie Ross", "kylie@example.com", "Holden Commodore VF SS-V", "Holden", "pro", "comp", "gm-e38"],
      ["Wayne Hart", "wayne@example.com", "Mazda BT-50", "Mazda", null, null, null],
      ["Priya Das", "priya@example.com", "Toyota LandCruiser 300", "Toyota", "street", "paid", null],
      ["Brodie Hayes", "brodie@example.com", "Ford Mustang GT", "Ford", "pro", "paid", null],
      ["Sam Ellis", "sam@example.com", "Isuzu D-Max", "Isuzu", null, null, null],
    ];
    people.forEach(function (p, i) {
      var created = now - (40 - i * 3) * DAY;
      var pkg = p[4] ? { tier: p[4], source: p[5], makes: [p[3]], since: created + DAY, expires: p[5] === "comp" ? (i % 2 ? null : now + 60 * DAY) : p[5] === "demo" ? now + 2 * DAY : null, note: p[5] === "comp" ? "Seed comp" : "" } : null;
      db.users.push({ id: "u" + (i + 1), role: "customer", name: p[0], email: p[1], status: i === 8 ? "suspended" : "active", createdAt: created, lastActive: now - (i % 5) * DAY - i * HOUR,
        vehicle: { title: p[2], make: p[3], ecu: p[6] }, package: pkg, notes: [] });
    });
    db.orders = [
      { id: "o1001", userId: "u5", email: "jess@example.com", items: ["Street licence (Ford)", "Launch, sound and limiter pack"], total: 948, status: "pre-ordered", at: now - 9 * DAY, code: "", notes: [] },
      { id: "o1002", userId: "u9", email: "wayne@example.com", items: ["Pro licence (Mazda)"], total: 425, status: "pay link sent", at: now - 6 * DAY, code: "HALFOFF", notes: [] },
      { id: "o1003", userId: "u12", email: "sam@example.com", items: ["WiCAN Pro (MeatPi) unit"], total: 0, status: "pre-ordered", at: now - 3 * DAY, code: "", notes: [] },
      { id: "o1004", userId: "u4", email: "mick@example.com", items: ["Commercial licence (Kenworth)", "Emissions pack (business)"], total: 2580, status: "paid", at: now - 20 * DAY, code: "", notes: [] },
      { id: "o1005", userId: null, email: "fleet@example.com", items: ["Heavy licence (Caterpillar)"], total: 2690, status: "cancelled", at: now - 12 * DAY, code: "", notes: [{ at: now - 11 * DAY, by: "seed", text: "Customer changed their mind before pay link." }] },
    ];
    db.codes = [
      { code: "MATE25", kind: "discount", pct: 25, amount: 0, uses: 50, used: 7, expires: now + 30 * DAY, scope: [], disabled: false, createdAt: now - 10 * DAY, by: "seed" },
      { code: "HALFOFF", kind: "discount", pct: 50, amount: 0, uses: 5, used: 1, expires: now + 14 * DAY, scope: ["street", "pro"], disabled: false, createdAt: now - 8 * DAY, by: "seed" },
      { code: "TRUCKIE100", kind: "discount", pct: 0, amount: 100, uses: 20, used: 2, expires: null, scope: ["commercial", "heavy"], disabled: false, createdAt: now - 7 * DAY, by: "seed" },
      { code: "SHOWROOM", kind: "demo", hours: 48, uses: 25, used: 4, expires: now + 21 * DAY, scope: [], disabled: false, createdAt: now - 5 * DAY, by: "seed", label: "Perth 4WD show stand" },
    ];
    for (var d = 0; d < 14; d++) if (d % 3 !== 1) db.redemptions.push({ at: now - d * DAY - 3 * HOUR, code: d % 2 ? "MATE25" : "SHOWROOM", kind: d % 2 ? "discount" : "demo" });
    db.help = [{ code: "000000", id: "h-seed", status: "ended", createdAt: now - 2 * DAY, endedAt: now - 2 * DAY + 20 * 60e3, customer: { name: "Shazza Nguyen", email: "shazza@example.com" }, snapshot: null, messages: [{ from: "customer", text: "Idle's a bit lumpy after the cam", at: now - 2 * DAY }], suggestions: [], staffId: null, key: "" },
      { code: "000001", id: "h-seed2", status: "ended", createdAt: now - 5 * DAY, endedAt: now - 5 * DAY + 9 * 60e3, customer: { name: "Bec Thompson", email: "bec@example.com" }, snapshot: null, messages: [], suggestions: [], staffId: null, key: "" }];
    /* presence: a few seeded customers "online" (their app sent a heartbeat in the last 2 minutes) */
    ["u1", "u4", "u6", "u11"].forEach(function (id) { var u = db.users.find(function (x) { return x.id === id; }); u.lastSeen = now - 30e3; u.lastActive = u.lastSeen; });
    db.users.forEach(function (u) { if (!u.lastSeen) u.lastSeen = u.lastActive; });
    var V = function (id, uid, name, engine, level, emissions, reasons, status, values, note) { var u = db.users.find(function (x) { return x.id === uid; });
      return { id: id, userId: uid, author: u.name.split(" ")[0] + " " + u.name.split(" ")[1][0] + ".", email: u.email, name: name, engine: engine, vehicle: u.vehicle.title, values: values, level: level, emissions: emissions, reasons: reasons,
        note: note, status: status, submittedAt: now - (7 - id.length) * DAY - Number(id.slice(1)) * HOUR, reviewNotes: status === "pending" ? [] : [{ at: now - 2 * DAY, by: "seed", text: status === "accepted" ? "Checked on the bench. Good daily." : "Knock retard too aggressive for a road tune." }],
        roadLegal: status === "accepted" && level <= 1 && !emissions, downloads: status === "accepted" ? 14 + Number(id.slice(1)) : 0, reviewedAt: status === "pending" ? null : now - 2 * DAY }; };
    db.vault = [
      V("v1", "u1", "VE SS smooth daily", "na_petrol", 1, false, [], "accepted", { timing_part: 1.5, lambda_cruise: 0, idle_rpm: 0, throttle_rate: 10 }, "Sharper throttle, a touch more part-throttle timing. 98 only."),
      V("v2", "u11", "Mustang track day", "na_petrol", 3, false, ["Traction control off", "Rev limit raised"], "accepted", { rev_add: 300, t_tc: 0, launch_rpm: 4200, t_launch: 1 }, "Track only. Logged pulls on 98 at Barbagallo."),
      V("v3", "u3", "HiLux towing", "turbo_diesel", 1, false, [], "pending", { shift_rpm: 200, tcc_lock: -5 }, "Holds gears longer when towing the van."),
      V("v4", "u4", "T610 economy", "turbo_diesel", 2, false, ["Top-speed limiter off"], "pending", { t_speed_lim: 0, shift_rpm: -150 }, "Saves about 2 L/100 on the Great Northern."),
      V("v5", "u6", "Patrol DPF delete", "turbo_diesel", 3, true, ["DPF off", "EGR off"], "pending", { t_dpf: 0, t_egr: 0 }, "Needs the DPF physically removed."),
      V("v6", "u2", "FG turbo boost up", "turbo_petrol", 2, false, ["Knock sensitivity reduced"], "rejected", { knock_sens: 2, boost_add: 4 }, "More boost."),
    ];
    return db;
  }

  /* ======================================================================
   * createCore(adapter, opts)
   *   adapter: { load(): db|null, save(db) }   (sync or async)
   *   opts:    { now(): ms, publish(code, event), seed: bool, lock(fn): runs fn exclusively (cross-tab) }
   * Every method is async. Staff methods take a token first.
   * ==================================================================== */
  function createCore(adapter, opts) {
    opts = opts || {};
    var now = opts.now || function () { return Date.now(); };
    var publish = opts.publish || function () {};
    var queue = Promise.resolve();
    async function load() { var db = await adapter.load(); if (!db) { db = emptyDb(); if (opts.seed) seedDemo(db, now()); await adapter.save(db); } db.vault = db.vault || []; db.devices = db.devices || {}; return db; }
    /* serialise read-modify-write so concurrent calls don't lose updates */
    function tx(fn) { var p = queue.then(function () { return (opts.lock || function (f) { return f(); })(async function () { var db = await load(), r; try { r = await fn(db); } catch (e) { if (e.persist) await adapter.save(db); throw e; } await adapter.save(db); return r; }); }); queue = p.catch(function () {}); return p; }
    function audit(db, actor, action, target, detail) { db.audit.unshift({ at: now(), actor: actor ? actor.email : "system", role: actor ? actor.role : "", action: action, target: target || "", detail: detail || "" }); if (db.audit.length > 5000) db.audit.length = 5000; }
    function staffFor(db, token) {
      var t = token && db.tokens[token];
      if (!t || t.expires < now()) { if (t) delete db.tokens[token]; throw err("auth", "Please sign in again"); }
      var u = db.users.find(function (x) { return x.id === t.userId; });
      if (!u || ROLES.indexOf(u.role) < 0 || u.status !== "active") throw err("auth", "This account can't use admin");
      return u;
    }
    function can(u, perm) { var p = PERMS[u.role] || []; return p.indexOf("*") >= 0 || p.indexOf(perm) >= 0; }
    function need(db, token, perm) { var u = staffFor(db, token); if (perm && !can(u, perm)) throw err("forbidden", "Your role (" + u.role + ") can't do that"); return u; }
    function userById(db, id) { var u = db.users.find(function (x) { return x.id === id; }); if (!u) throw err("notfound", "No such user"); return u; }
    function codeRec(db, code) { return db.codes.find(function (c) { return c.code === String(code || "").trim().toUpperCase(); }); }
    function helpRec(db, code) { var h = db.help.find(function (x) { return x.code === String(code || "").replace(/\D/g, "") && x.status !== "ended"; }); if (h && h.expiresAt < now()) { h.status = "ended"; h.endedAt = now(); } return h && h.status !== "ended" ? h : null; }
    function pkgActive(p) { return !!(p && (!p.expires || p.expires > now())); }
    function helpView(h, forStaff) { var o = JSON.parse(JSON.stringify(h)); delete o.key; if (!forStaff) delete o.staffNotes; return o; }
    function ev(code, type, data) { try { publish(code, { type: type, code: code, at: now(), data: data }); } catch (e) {} }

    var api = {
      catalog: function () { return { tiers: TIERS, packs: PACKS, extraMake: EXTRA_MAKE, roles: ROLES, perms: PERMS, orderStatus: ORDER_STATUS, settingsKeys: SETTINGS_KEYS }; },
      info: function () { return tx(function (db) { return { demo: !!db.demo, setupNeeded: !db.setupDone }; }); },

      /* ---- one-time setup: creates the owner. Refused once an owner exists. ---- */
      setupOwner: function (a) { return tx(async function (db) {
        if (db.setupDone || db.users.some(function (u) { return u.role === "owner"; })) throw err("forbidden", "Setup is already done");
        if (!emailOk(a && a.email)) throw err("invalid", "Enter a valid email");
        if (!strongPw(a.password)) throw err("invalid", "Use a password of at least 10 characters");
        var u = { id: "s" + randHex(4), role: "owner", name: String(a.name || "Owner").slice(0, 80), email: a.email.toLowerCase(), status: "active", createdAt: now(), lastActive: now(), pw: await hashPassword(a.password), notes: [] };
        db.users.push(u); db.setupDone = true; audit(db, u, "setup.owner", u.email, "Owner account created (one-time setup)");
        return clean(u);
      }); },
      login: function (email, password) { return tx(async function (db) {
        var u = db.users.find(function (x) { return x.email === String(email || "").toLowerCase() && ROLES.indexOf(x.role) >= 0; });
        var ok = u && await checkPassword(String(password || ""), u.pw);
        if (!ok) { audit(db, null, "login.fail", String(email || "").slice(0, 120)); var e1 = err("auth", "Wrong email or password"); e1.persist = true; throw e1; }
        if (u.status !== "active") throw err("auth", "This account is suspended");
        var token = randHex(24); db.tokens[token] = { userId: u.id, expires: now() + SESSION_TTL, created: now() };
        Object.keys(db.tokens).forEach(function (k) { if (db.tokens[k].expires < now()) delete db.tokens[k]; });
        u.lastActive = now(); audit(db, u, "login", u.email);
        return { token: token, user: clean(u), perms: PERMS[u.role] };
      }); },
      logout: function (token) { return tx(function (db) { var t = db.tokens[token]; if (t) { var u = db.users.find(function (x) { return x.id === t.userId; }); delete db.tokens[token]; audit(db, u, "logout", u && u.email); } return true; }); },
      me: function (token) { return tx(function (db) { var u = staffFor(db, token); return { user: clean(u), perms: PERMS[u.role] }; }); },

      /* ---- staff accounts (owner only) ---- */
      createStaff: function (token, a) { return tx(async function (db) {
        var me = need(db, token, "staff.manage");
        if (["admin", "support"].indexOf(a.role) < 0) throw err("invalid", "Role must be admin or support");
        if (!emailOk(a.email)) throw err("invalid", "Enter a valid email");
        if (db.users.some(function (u) { return u.email === a.email.toLowerCase(); })) throw err("invalid", "That email already has an account");
        var temp = randCode(12, CODE_ABC.toLowerCase() + CODE_ABC);
        var u = { id: "s" + randHex(4), role: a.role, name: String(a.name || "").slice(0, 80), email: a.email.toLowerCase(), status: "active", createdAt: now(), lastActive: null, pw: await hashPassword(temp), mustChange: true, notes: [] };
        db.users.push(u); audit(db, me, "staff.create", u.email, a.role);
        return { user: clean(u), tempPassword: temp };
      }); },
      changePassword: function (token, oldPw, newPw) { return tx(async function (db) {
        var me = staffFor(db, token);
        if (!await checkPassword(String(oldPw || ""), me.pw)) throw err("auth", "Current password is wrong");
        if (!strongPw(newPw)) throw err("invalid", "Use a password of at least 10 characters");
        me.pw = await hashPassword(newPw); me.mustChange = false; audit(db, me, "password.change", me.email); return true;
      }); },

      /* ---- users and accounts ---- */
      listUsers: function (token, q) { return tx(function (db) {
        need(db, token, "users.view"); q = String(q || "").toLowerCase().trim();
        return db.users.filter(function (u) { if (!q) return true; return [u.name, u.email, u.role, u.vehicle && u.vehicle.title, u.vehicle && u.vehicle.make, u.package && u.package.tier, u.status].join(" ").toLowerCase().indexOf(q) >= 0; })
          .map(function (u) { var c = clean(u); c.packageActive = pkgActive(u.package); c.online = !!(u.lastSeen && now() - u.lastSeen < ONLINE_MS); return c; });
      }); },
      getUser: function (token, id) { return tx(function (db) {
        need(db, token, "users.view"); var u = userById(db, id), c = clean(u); c.packageActive = pkgActive(u.package); c.online = !!(u.lastSeen && now() - u.lastSeen < ONLINE_MS); c.vault = db.vault.filter(function (v) { return v.userId === id; });
        c.orders = db.orders.filter(function (o) { return o.userId === id || o.email === u.email; });
        c.help = db.help.filter(function (h) { return h.customer && h.customer.email === u.email; }).map(function (h) { return { code: h.code, status: h.status, createdAt: h.createdAt }; });
        return c;
      }); },
      updateUser: function (token, id, patch) { return tx(function (db) {
        var me = need(db, token, "users.edit"), u = userById(db, id), changed = [];
        if (ROLES.indexOf(u.role) >= 0 && me.role !== "owner") throw err("forbidden", "Only the owner can edit staff accounts");
        ["name", "email"].forEach(function (k) { if (patch[k] != null && patch[k] !== u[k]) { if (k === "email" && !emailOk(patch.email)) throw err("invalid", "Enter a valid email"); u[k] = k === "email" ? String(patch[k]).toLowerCase() : String(patch[k]).slice(0, 80); changed.push(k); } });
        if (patch.vehicle) { u.vehicle = Object.assign({}, u.vehicle || {}, { title: String(patch.vehicle.title || "").slice(0, 120), make: String(patch.vehicle.make || "").slice(0, 60), ecu: patch.vehicle.ecu || null }); changed.push("vehicle"); }
        if (patch.note) { u.notes = (u.notes || []).concat([{ at: now(), by: me.email, text: String(patch.note).slice(0, 1000) }]); changed.push("note"); }
        audit(db, me, "user.edit", u.email, changed.join(", ")); return clean(u);
      }); },
      setSuspended: function (token, id, suspended, reason) { return tx(function (db) {
        var me = need(db, token, "users.suspend"), u = userById(db, id);
        if (u.role === "owner") throw err("forbidden", "The owner account can't be suspended");
        if (ROLES.indexOf(u.role) >= 0 && me.role !== "owner") throw err("forbidden", "Only the owner can suspend staff");
        u.status = suspended ? "suspended" : "active";
        if (suspended) Object.keys(db.tokens).forEach(function (k) { if (db.tokens[k].userId === u.id) delete db.tokens[k]; });
        audit(db, me, suspended ? "user.suspend" : "user.unsuspend", u.email, reason || ""); return clean(u);
      }); },
      resetPassword: function (token, id) { return tx(async function (db) {
        var me = need(db, token, "users.reset"), u = userById(db, id);
        if (u.role === "owner" && me.id !== u.id) throw err("forbidden", "Only the owner can reset the owner's password");
        if (ROLES.indexOf(u.role) >= 0 && me.role !== "owner") throw err("forbidden", "Only the owner can reset staff passwords");
        var temp = randCode(12, CODE_ABC.toLowerCase() + CODE_ABC); u.pw = await hashPassword(temp); u.mustChange = true;
        Object.keys(db.tokens).forEach(function (k) { if (db.tokens[k].userId === u.id) delete db.tokens[k]; });
        audit(db, me, "user.reset_password", u.email, "temporary password issued (shown once, not stored)");
        return { tempPassword: temp };
      }); },

      /* ---- packages and comps ---- */
      grantPackage: function (token, id, g) { return tx(function (db) {
        var me = need(db, token, "packages.grant"), u = userById(db, id), t = tierOf(g && g.tier);
        if (!t) throw err("invalid", "Pick a package");
        var lifetime = !!g.lifetime, days = Number(g.days);
        if (!lifetime && !(days > 0 && days <= 3650)) throw err("invalid", "Give the comp an expiry (1 to 3650 days) or make it lifetime");
        u.package = { tier: t.id, source: "comp", makes: g.makes && g.makes.length ? g.makes : (u.vehicle && u.vehicle.make ? [u.vehicle.make] : []), packs: (g.packs || []).filter(function (p) { return PACKS.some(function (x) { return x.id === p; }); }), since: now(), expires: lifetime ? null : now() + days * DAY, note: String(g.note || "").slice(0, 300), by: me.email };
        audit(db, me, "package.comp", u.email, t.name + (lifetime ? ", lifetime" : ", " + days + " days") + (g.note ? " — " + g.note : ""));
        return clean(u);
      }); },
      revokePackage: function (token, id, reason) { return tx(function (db) {
        var me = need(db, token, "packages.grant"), u = userById(db, id);
        if (u.package && u.package.source === "paid") throw err("forbidden", "Paid licences aren't revoked here; note a refund on the order instead");
        u.package = null; audit(db, me, "package.revoke", u.email, reason || ""); return clean(u);
      }); },

      /* ---- discount and demo codes ---- */
      listCodes: function (token) { return tx(function (db) { var me = staffFor(db, token); if (!can(me, "codes.manage") && !can(me, "demo.manage")) throw err("forbidden", "Your role can't see codes"); return db.codes.slice().reverse(); }); },
      createCode: function (token, a) { return tx(function (db) {
        var kind = a && a.kind; if (kind !== "discount" && kind !== "demo") throw err("invalid", "kind must be discount or demo");
        var me = need(db, token, kind === "demo" ? "demo.manage" : "codes.manage");
        var code = String(a.code || "").trim().toUpperCase() || (kind === "demo" ? "DEMO-" : "") + randCode(kind === "demo" ? 6 : 8, CODE_ABC);
        if (!/^[A-Z0-9-]{4,32}$/.test(code)) throw err("invalid", "Codes are 4 to 32 letters, numbers or dashes");
        if (codeRec(db, code)) throw err("invalid", "That code already exists");
        var uses = Math.floor(Number(a.uses) || 0); if (!(uses >= 1 && uses <= 100000)) throw err("invalid", "Uses must be 1 or more");
        var expires = a.expiresDays ? now() + Number(a.expiresDays) * DAY : (a.expires || null);
        var scope = (a.scope || []).filter(function (s) { return tierOf(s); });
        var rec = { code: code, kind: kind, uses: uses, used: 0, expires: expires, scope: scope, disabled: false, createdAt: now(), by: me.email, label: String(a.label || "").slice(0, 120) };
        if (kind === "discount") {
          var pct = Number(a.pct) || 0, amount = Number(a.amount) || 0;
          if (!((pct > 0 && pct <= 100 && !amount) || (amount > 0 && !pct))) throw err("invalid", "Give a percent (1-100) or a fixed dollar amount, not both");
          rec.pct = pct; rec.amount = amount;
        } else {
          var hours = Number(a.hours) || 0; if (!(hours > 0 && hours <= 24 * 90)) throw err("invalid", "Demo access lasts 1 hour to 90 days");
          rec.hours = hours; rec.tier = tierOf(a.tier) ? a.tier : "heavy";
        }
        db.codes.push(rec); audit(db, me, kind === "demo" ? "demo.create" : "code.create", code, describeCode(rec)); return rec;
      }); },
      setCodeDisabled: function (token, code, disabled) { return tx(function (db) {
        var c = codeRec(db, code); if (!c) throw err("notfound", "No such code");
        var me = need(db, token, c.kind === "demo" ? "demo.manage" : "codes.manage");
        c.disabled = !!disabled; audit(db, me, disabled ? "code.disable" : "code.enable", c.code); return c;
      }); },
      /* customer side (no staff token): validate + count a redemption */
      redeemCode: function (code, who) { return tx(function (db) {
        var c = codeRec(db, code);
        if (!c || c.disabled) throw err("invalid", "That code isn't valid");
        if (c.expires && c.expires < now()) throw err("expired", "That code has expired");
        if (c.used >= c.uses) throw err("used", "That code has been used up");
        c.used++; db.redemptions.push({ at: now(), code: c.code, kind: c.kind, device: who && who.device ? String(who.device).slice(0, 40) : "" });
        audit(db, null, "code.redeem", c.code, (who && who.device ? "device " + String(who.device).slice(0, 12) : ""));
        if (c.kind === "demo") return { kind: "demo", code: c.code, tier: c.tier || "heavy", appPackage: tierOf(c.tier || "heavy").appPackage, until: now() + c.hours * HOUR, label: c.label || "" };
        return { kind: "discount", code: c.code, pct: c.pct || 0, amount: c.amount || 0, scope: c.scope, expires: c.expires };
      }); },
      quote: function (items, discount) {
        var biz = items.some(function (i) { var t = tierOf(i.tier); return t && t.biz; });
        var lines = items.map(function (i) { var t = tierOf(i.tier); if (t) return { label: t.name + " licence", price: t.price * (i.extraMake ? EXTRA_MAKE : 1), tier: t.id }; var p = PACKS.find(function (x) { return x.id === i.pack; }); return { label: p.name + " pack", price: biz ? p.biz : p.price }; });
        var total = lines.reduce(function (a, l) { return a + l.price; }, 0), off = 0;
        if (discount) { var eligible = lines.filter(function (l) { return !discount.scope || !discount.scope.length || (l.tier && discount.scope.indexOf(l.tier) >= 0); }).reduce(function (a, l) { return a + l.price; }, 0);
          off = discount.pct ? Math.round(eligible * discount.pct / 100) : Math.min(eligible, discount.amount || 0); }
        return { lines: lines, total: total, discount: off, pay: total - off };
      },

      /* ---- pre-orders and shop (no payment processing: status and notes only) ---- */
      createOrder: function (o) { return tx(function (db) {
        if (!emailOk(o && o.email)) throw err("invalid", "Enter a valid email");
        var rec = { id: "o" + (1000 + db.orders.length + 1), userId: null, email: o.email.toLowerCase(), items: (o.items || []).map(String).slice(0, 20), total: Math.max(0, Number(o.total) || 0), status: "pre-ordered", at: now(), code: o.code || "", notes: [] };
        var u = db.users.find(function (x) { return x.email === rec.email; }); if (u) rec.userId = u.id;
        db.orders.push(rec); audit(db, null, "order.create", rec.id, rec.email); return rec;
      }); },
      listOrders: function (token, status) { return tx(function (db) { need(db, token, "orders.view"); return db.orders.filter(function (o) { return !status || o.status === status; }).slice().reverse(); }); },
      updateOrder: function (token, id, patch) { return tx(function (db) {
        var me = need(db, token, "orders.edit"), o = db.orders.find(function (x) { return x.id === id; }); if (!o) throw err("notfound", "No such order");
        if (patch.status) { if (ORDER_STATUS.indexOf(patch.status) < 0) throw err("invalid", "Unknown status"); o.status = patch.status; }
        if (patch.note) o.notes.push({ at: now(), by: me.email, text: String(patch.note).slice(0, 1000) });
        audit(db, me, patch.status === "refund noted" ? "order.refund_note" : "order.update", o.id, (patch.status || "") + (patch.note ? " — " + patch.note : ""));
        return o;
      }); },

      /* ---- presets (overrides on top of the shipped presets; values are tune targets, nothing is written to a car) ---- */
      listPresetOverrides: function (token) { return tx(function (db) { need(db, token, "catalog.view"); return db.presets; }); },
      savePreset: function (token, id, patch) { return tx(function (db) {
        var me = need(db, token, "presets.edit"); if (!/^[a-z0-9_-]{1,40}$/.test(id)) throw err("invalid", "Bad preset id");
        var p = db.presets[id] || {}; if (patch.name != null) p.name = String(patch.name).slice(0, 60); if (patch.feel != null) p.feel = String(patch.feel).slice(0, 300);
        if (patch.hidden != null) p.hidden = !!patch.hidden; if (patch.values) { p.values = {}; Object.keys(patch.values).forEach(function (k) { var v = Number(patch.values[k]); if (isFinite(v)) p.values[k] = v; }); }
        p.updatedAt = now(); p.by = me.email; db.presets[id] = p; audit(db, me, "preset.edit", id, Object.keys(patch).join(", ")); return p;
      }); },
      publicPresets: function () { return tx(function (db) { return db.presets; }); },

      /* ---- remote help ---- */
      /* customer opens a session; gets a 6-digit code to read out and a private key for its own updates */
      openHelp: function (a) { return tx(function (db) {
        a = a || {}; var code;
        do { code = String(100000 + (parseInt(randHex(4), 16) % 900000)); } while (db.help.some(function (h) { return h.code === code && h.status !== "ended"; }));
        var h = { id: "h" + randHex(5), code: code, key: randHex(16), status: "waiting", createdAt: now(), expiresAt: now() + HELP_TTL, customer: { name: String(a.name || "").slice(0, 80), email: String(a.email || "").slice(0, 120), device: String(a.device || "").slice(0, 40) },
          snapshot: sanitizeSnap(a.snapshot), messages: [], suggestions: [], staffId: null, staffName: "" };
        db.help.push(h); audit(db, null, "help.open", code, h.customer.email || "anonymous device"); return { code: code, key: h.key, expiresAt: h.expiresAt };
      }); },
      /* only the customer's device (holder of the key) can update what staff see */
      pushSnapshot: function (code, key, snap) { return tx(function (db) {
        var h = helpRec(db, code); if (!h || h.key !== key) throw err("forbidden", "Only the customer's own app can update this session");
        h.snapshot = sanitizeSnap(snap); h.expiresAt = Math.max(h.expiresAt, now() + 10 * 60e3); ev(h.code, "snapshot", h.snapshot); return true;
      }); },
      customerView: function (code, key) { return tx(function (db) { var h = helpRec(db, code); if (!h || h.key !== key) throw err("forbidden", "Session not found"); return helpView(h, false); }); },
      customerChat: function (code, key, text) { return tx(function (db) {
        var h = helpRec(db, code); if (!h || h.key !== key) throw err("forbidden", "Session not found");
        var m = { from: "customer", text: String(text || "").slice(0, 2000), at: now() }; if (!m.text.trim()) throw err("invalid", "Empty message"); h.messages.push(m); ev(h.code, "chat", m); return m;
      }); },
      respondSuggestion: function (code, key, sid, accept) { return tx(function (db) {
        var h = helpRec(db, code); if (!h || h.key !== key) throw err("forbidden", "Only the customer can accept or decline");
        var s = h.suggestions.find(function (x) { return x.id === sid; }); if (!s) throw err("notfound", "No such suggestion");
        if (s.status !== "pending") throw err("invalid", "Already answered");
        s.status = accept ? "accepted" : "declined"; s.answeredAt = now();
        audit(db, null, "help.suggestion_" + s.status, h.code, s.kind); ev(h.code, "suggestion", s); return s;
      }); },
      endHelp: function (code, key, token) { return tx(function (db) {
        var h = helpRec(db, code); if (!h) return true; var me = null;
        if (token) me = need(db, token, "help.join"); else if (h.key !== key) throw err("forbidden", "Session not found");
        h.status = "ended"; h.endedAt = now(); audit(db, me, "help.end", h.code, me ? "ended by staff" : "ended by customer"); ev(h.code, "end", {}); return true;
      }); },
      listHelp: function (token) { return tx(function (db) { need(db, token, "help.join"); db.help.forEach(function (h) { if (h.status !== "ended" && h.expiresAt < now()) { h.status = "ended"; h.endedAt = now(); } }); return db.help.slice().reverse().map(function (h) { return helpView(h, true); }); }); },
      joinHelp: function (token, code) { return tx(function (db) {
        var me = need(db, token, "help.join"), h = helpRec(db, code); if (!h) { audit(db, me, "help.join_fail", String(code).slice(0, 8)); var e2 = err("notfound", "No live session with that code. Ask the customer to read it again."); e2.persist = true; throw e2; }
        h.status = "joined"; h.staffId = me.id; h.staffName = me.name || me.email; audit(db, me, "help.join", h.code, h.customer.email || ""); ev(h.code, "joined", { staffName: h.staffName }); return helpView(h, true);
      }); },
      staffView: function (token, code) { return tx(function (db) { need(db, token, "help.join"); var h = helpRec(db, code) || db.help.find(function (x) { return x.code === code; }); if (!h) throw err("notfound", "No such session"); return helpView(h, true); }); },
      staffChat: function (token, code, text) { return tx(function (db) {
        var me = need(db, token, "help.chat"), h = helpRec(db, code); if (!h) throw err("notfound", "Session ended");
        var m = { from: "staff", name: me.name || me.email, text: String(text || "").slice(0, 2000), at: now() }; if (!m.text.trim()) throw err("invalid", "Empty message"); h.messages.push(m); ev(h.code, "chat", m); return m;
      }); },
      /* a suggestion only: {kind:"tune", name, values:{key:number}} or {kind:"settings", values:{skill|theme|fuel|upgrades|pkg}} */
      suggest: function (token, code, s) { return tx(function (db) {
        var me = need(db, token, "help.suggest"), h = helpRec(db, code); if (!h) throw err("notfound", "Session ended");
        if (!s || (s.kind !== "tune" && s.kind !== "settings")) throw err("invalid", "Only a tune or settings suggestion can be sent. Nothing is ever written to the car remotely.");
        var vals = {};
        Object.keys(s.values || {}).forEach(function (k) {
          if (s.kind === "tune") { var v = Number(s.values[k]); if (!/^[a-z0-9_]{1,40}$/.test(k) || !isFinite(v)) throw err("invalid", "Tune values must be numbers"); vals[k] = v; }
          else { if (SETTINGS_KEYS.indexOf(k) < 0) throw err("invalid", "Can't suggest the setting " + k); vals[k] = s.values[k]; }
        });
        if (!Object.keys(vals).length) throw err("invalid", "Nothing to suggest");
        var rec = { id: "g" + randHex(4), kind: s.kind, name: String(s.name || (s.kind === "tune" ? "Suggested tune" : "Suggested settings")).slice(0, 60), note: String(s.note || "").slice(0, 600), values: vals, from: me.name || me.email, at: now(), status: "pending" };
        h.suggestions.push(rec); audit(db, me, "help.suggest", h.code, rec.kind + ": " + rec.name); ev(h.code, "suggestion", rec); return rec;
      }); },

      /* ---- presence: the customer app sends a heartbeat about once a minute while open ---- */
      heartbeat: function (who) { return tx(function (db) {
        who = who || {}; var dev = String(who.device || "").slice(0, 40), t = now();
        var u = who.email ? db.users.find(function (x) { return x.email === String(who.email).toLowerCase() && x.role === "customer"; }) : null;
        if (!u && dev) u = db.users.find(function (x) { return x.device === dev; });
        if (u) { u.lastSeen = t; u.lastActive = t; if (dev) u.device = dev; }
        if (dev) db.devices[dev] = { lastSeen: t, userId: u ? u.id : null, car: String(who.car || "").slice(0, 120) };
        return { online: true, linked: !!u };
      }); },
      presence: function (token) { return tx(function (db) {
        need(db, token, "users.view"); var t = now(), on = {};
        db.users.forEach(function (u) { on[u.id] = { online: !!(u.lastSeen && t - u.lastSeen < ONLINE_MS), lastSeen: u.lastSeen || null }; });
        var anon = Object.keys(db.devices).filter(function (d) { return !db.devices[d].userId && t - db.devices[d].lastSeen < ONLINE_MS; }).length;
        return { users: on, anonymousOnline: anon, onlineMs: ONLINE_MS };
      }); },

      /* ---- Tune Library Vault: customers submit, staff review, accepted tunes go public ----
       * level = the app's filing level (FL.fileTune: 0 Factory, 1 Road, 2 Sport, 3 Competition and off-road).
       * A reviewer re-files the tune (admin app runs the same filing rules) and the higher level wins.
       * Emissions-off or Competition tunes keep their gates and warnings and are never published as road-legal. */
      submitTune: function (t) { return tx(function (db) {
        t = t || {}; var name = String(t.name || "").trim().slice(0, 60); if (!name) throw err("invalid", "Give your tune a name");
        var lvl = Math.floor(Number(t.level)); if (!(lvl >= 0 && lvl <= 3)) throw err("invalid", "Tune level missing");
        var vals = {}; Object.keys(t.values || {}).forEach(function (k) { var v = Number(t.values[k]); if (/^[a-z0-9_]{1,40}$/.test(k) && isFinite(v)) vals[k] = v; });
        if (!Object.keys(vals).length) throw err("invalid", "The tune has no values");
        if (["na_petrol", "turbo_petrol", "turbo_diesel"].indexOf(t.engine) < 0) throw err("invalid", "Unknown engine type");
        var u = t.email ? db.users.find(function (x) { return x.email === String(t.email).toLowerCase(); }) : null;
        var rec = { id: "v" + randHex(4), userId: u ? u.id : null, author: String(t.author || (u && u.name) || "Anonymous").slice(0, 60), email: String(t.email || "").slice(0, 120), name: name, engine: t.engine, vehicle: String(t.vehicle || "").slice(0, 120),
          values: vals, level: lvl, emissions: !!t.emissions, reasons: (t.reasons || []).map(String).slice(0, 20), note: String(t.note || "").slice(0, 600), status: "pending", submittedAt: now(), reviewNotes: [], roadLegal: false, downloads: 0, reviewedAt: null };
        db.vault.push(rec); audit(db, null, "vault.submit", rec.id, rec.name + " (" + PERM_NAME[lvl] + ")"); return rec;
      }); },
      listSubmissions: function (token, status) { return tx(function (db) {
        need(db, token, "catalog.view"); var t = now();
        return db.vault.filter(function (v) { return !status || v.status === status; }).slice().reverse().map(function (v) { var o = Object.assign({}, v), u = v.userId && db.users.find(function (x) { return x.id === v.userId; });
          o.authorOnline = !!(u && u.lastSeen && t - u.lastSeen < ONLINE_MS); o.authorLastSeen = u ? u.lastSeen || null : null; return o; });
      }); },
      reviewSubmission: function (token, id, r) { return tx(function (db) {
        var me = need(db, token, "presets.edit"), v = db.vault.find(function (x) { return x.id === id; }); if (!v) throw err("notfound", "No such submission");
        r = r || {}; if (r.note) v.reviewNotes.push({ at: now(), by: me.email, text: String(r.note).slice(0, 1000) });
        if (r.decision === "note") { audit(db, me, "vault.note", v.id, r.note || ""); return v; }
        if (r.decision !== "accept" && r.decision !== "reject") throw err("invalid", "decision must be accept, reject or note");
        if (r.decision === "reject" && !r.note) throw err("invalid", "Say why it's rejected so the author can fix it");
        if (r.decision === "accept") {
          if (!r.verified || !(Number(r.verified.level) >= 0)) throw err("invalid", "Re-file the tune before accepting (the level must be checked)");
          v.level = Math.max(v.level, Math.floor(Number(r.verified.level))); v.emissions = v.emissions || !!r.verified.emissions;
          if (r.verified.reasons) v.reasons = r.verified.reasons.map(String).slice(0, 20);
          var roadOk = v.level <= 1 && !v.emissions;
          if (r.roadLegal && !roadOk) throw err("invalid", "A " + PERM_NAME[v.level] + (v.emissions ? ", emissions-off" : "") + " tune can't be published as road-legal");
          v.roadLegal = roadOk && r.roadLegal !== false;
          v.gates = { competitionAck: v.level >= 3, agreement: v.emissions, pullLog: v.level >= 2 };
        }
        v.status = r.decision === "accept" ? "accepted" : "rejected"; v.reviewedAt = now(); v.reviewer = me.email;
        audit(db, me, "vault." + v.status, v.id, v.name + " — " + PERM_NAME[v.level] + (v.emissions ? ", emissions" : "") + (r.note ? " — " + r.note : "")); return v;
      }); },
      /* public: the browsable vault (accepted only) */
      vault: function () { return tx(function (db) { return db.vault.filter(function (v) { return v.status === "accepted"; }).map(function (v) { var o = Object.assign({}, v); delete o.email; delete o.reviewNotes; o.levelName = PERM_NAME[v.level]; return o; }).reverse(); }); },
      vaultDownload: function (id) { return tx(function (db) { var v = db.vault.find(function (x) { return x.id === id && x.status === "accepted"; }); if (!v) throw err("notfound", "Not in the vault"); v.downloads++; return { id: v.id, name: v.name, engine: v.engine, values: v.values, level: v.level, emissions: v.emissions, reasons: v.reasons, roadLegal: v.roadLegal, gates: v.gates || { competitionAck: v.level >= 3, agreement: v.emissions, pullLog: v.level >= 2 } }; }); },

      /* ---- stats and audit ---- */
      stats: function (token) { return tx(function (db) {
        need(db, token, "stats.view"); var t = now(), cust = db.users.filter(function (u) { return u.role === "customer"; });
        var byTier = {}; TIERS.forEach(function (x) { byTier[x.id] = 0; }); var bySource = { paid: 0, comp: 0, demo: 0 };
        cust.forEach(function (u) { if (pkgActive(u.package)) { byTier[u.package.tier] = (byTier[u.package.tier] || 0) + 1; bySource[u.package.source] = (bySource[u.package.source] || 0) + 1; } });
        function series(list, field) { var out = []; for (var d = 13; d >= 0; d--) { var a = t - (d + 1) * DAY, b = t - d * DAY; out.push(list.filter(function (x) { return x[field] > a && x[field] <= b; }).length); } return out; }
        return { demo: !!db.demo, users: cust.length, active7: cust.filter(function (u) { return u.lastActive && u.lastActive > t - 7 * DAY; }).length, suspended: cust.filter(function (u) { return u.status === "suspended"; }).length,
          staff: db.users.filter(function (u) { return ROLES.indexOf(u.role) >= 0; }).length, byTier: byTier, bySource: bySource,
          codesRedeemed: db.redemptions.length, online: cust.filter(function (u) { return u.lastSeen && t - u.lastSeen < ONLINE_MS; }).length, vaultPending: db.vault.filter(function (v) { return v.status === "pending"; }).length, vaultPublic: db.vault.filter(function (v) { return v.status === "accepted"; }).length, liveHelp: db.help.filter(function (h) { return h.status !== "ended" && h.expiresAt > t; }).length, helpSessions: db.help.length,
          preorders: db.orders.filter(function (o) { return o.status === "pre-ordered" || o.status === "pay link sent"; }).length, orders: db.orders.length,
          preorderValue: db.orders.filter(function (o) { return o.status === "pre-ordered" || o.status === "pay link sent"; }).reduce(function (a, o) { return a + o.total; }, 0),
          series: { signups: series(cust, "createdAt"), redemptions: series(db.redemptions, "at"), help: series(db.help, "createdAt"), orders: series(db.orders, "at") } };
      }); },
      listAudit: function (token, q) { return tx(function (db) { need(db, token, "audit.view"); q = String(q || "").toLowerCase(); return db.audit.filter(function (a) { return !q || (a.actor + " " + a.action + " " + a.target + " " + a.detail).toLowerCase().indexOf(q) >= 0; }).slice(0, 500); }); },
    };
    return api;
  }
  function sanitizeSnap(s) {
    if (!s || typeof s !== "object") return null;
    var str = JSON.stringify(s); if (str.length > 60000) throw err("invalid", "Snapshot too large");
    var o = JSON.parse(str); o.readOnly = true; return o;
  }
  function describeCode(c) {
    if (c.kind === "demo") return (c.label ? c.label + ": " : "") + c.hours + " h full demo, " + c.uses + " uses";
    return (c.pct ? c.pct + "% off" : "$" + c.amount + " off") + ", " + c.uses + " uses" + (c.scope && c.scope.length ? ", " + c.scope.join("/") : ", any package");
  }
  return { createCore: createCore, emptyDb: emptyDb, seedDemo: seedDemo, TIERS: TIERS, PACKS: PACKS, ROLES: ROLES, PERMS: PERMS, ORDER_STATUS: ORDER_STATUS, SETTINGS_KEYS: SETTINGS_KEYS, PERM_NAME: PERM_NAME, ONLINE_MS: ONLINE_MS, describeCode: describeCode, hashPassword: hashPassword, checkPassword: checkPassword };
});

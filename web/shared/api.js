/* ==========================================================================
 * CarTune API layer — one interface, two implementations.
 *
 *   CarTuneAPI.create()                  picks the backend: ?api=<url> or
 *                                        localStorage "cartune:apiBase", else local
 *   CarTuneAPI.createLocalApi(opts)      DEMO DATA: localStorage + seed data,
 *                                        works offline, tabs on the same origin
 *                                        share it (admin + customer app)
 *   CarTuneAPI.createRemoteApi(baseUrl)  the REST + WebSocket server (server/)
 *
 * Both expose the same async methods (see ROUTES; the names match
 * web/shared/cartune-core.js) plus:
 *   api.kind                             "local" | "remote"
 *   api.subscribe(code, auth, onEvent)   live remote-help events; returns unsubscribe
 *
 * ROUTES is also the REST contract: server/server.js serves exactly this table
 * (documented in server/API.md). Arg names: "token" travels as
 * "Authorization: Bearer", ":name" in the path, GET extras in the query
 * string, everything else as a JSON body {name: value}.
 * ======================================================================== */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./cartune-core.js"));
  else root.CarTuneAPI = factory(root.CarTuneCore);
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";
  var ROUTES = {
    info: ["GET", "/api/info", []],
    setupOwner: ["POST", "/api/setup", ["body"]],
    login: ["POST", "/api/auth/login", ["email", "password"]],
    logout: ["POST", "/api/auth/logout", ["token"]],
    me: ["GET", "/api/auth/me", ["token"]],
    changePassword: ["POST", "/api/auth/password", ["token", "oldPassword", "newPassword"]],
    createStaff: ["POST", "/api/staff", ["token", "body"]],
    listUsers: ["GET", "/api/users", ["token", "q"]],
    getUser: ["GET", "/api/users/:id", ["token", "id"]],
    updateUser: ["PATCH", "/api/users/:id", ["token", "id", "body"]],
    setSuspended: ["POST", "/api/users/:id/suspend", ["token", "id", "suspended", "reason"]],
    resetPassword: ["POST", "/api/users/:id/reset-password", ["token", "id"]],
    grantPackage: ["POST", "/api/users/:id/package", ["token", "id", "body"]],
    revokePackage: ["POST", "/api/users/:id/package/revoke", ["token", "id", "reason"]],
    presence: ["GET", "/api/presence", ["token"]],
    heartbeat: ["POST", "/api/presence", ["who"]],
    listCodes: ["GET", "/api/codes", ["token"]],
    createCode: ["POST", "/api/codes", ["token", "body"]],
    setCodeDisabled: ["POST", "/api/codes/:code/disabled", ["token", "code", "disabled"]],
    redeemCode: ["POST", "/api/redeem", ["code", "who"]],
    createOrder: ["POST", "/api/orders", ["body"]],
    listOrders: ["GET", "/api/orders", ["token", "status"]],
    updateOrder: ["PATCH", "/api/orders/:id", ["token", "id", "body"]],
    listPresetOverrides: ["GET", "/api/presets", ["token"]],
    savePreset: ["PUT", "/api/presets/:id", ["token", "id", "body"]],
    publicPresets: ["GET", "/api/public/presets", []],
    openHelp: ["POST", "/api/help", ["body"]],
    pushSnapshot: ["POST", "/api/help/:code/snapshot", ["code", "key", "snapshot"]],
    customerView: ["GET", "/api/help/:code/customer", ["code", "key"]],
    customerChat: ["POST", "/api/help/:code/customer-chat", ["code", "key", "text"]],
    respondSuggestion: ["POST", "/api/help/:code/suggestions/:sid", ["code", "key", "sid", "accept"]],
    endHelp: ["POST", "/api/help/:code/end", ["code", "key", "token"]],
    listHelp: ["GET", "/api/help", ["token"]],
    joinHelp: ["POST", "/api/help/:code/join", ["token", "code"]],
    staffView: ["GET", "/api/help/:code", ["token", "code"]],
    staffChat: ["POST", "/api/help/:code/chat", ["token", "code", "text"]],
    suggest: ["POST", "/api/help/:code/suggest", ["token", "code", "suggestion"]],
    submitTune: ["POST", "/api/vault/submissions", ["tune"]],
    listSubmissions: ["GET", "/api/vault/submissions", ["token", "status"]],
    reviewSubmission: ["POST", "/api/vault/submissions/:id/review", ["token", "id", "review"]],
    vault: ["GET", "/api/vault", []],
    vaultDownload: ["POST", "/api/vault/:id/download", ["id"]],
    stats: ["GET", "/api/stats", ["token"]],
    listAudit: ["GET", "/api/audit", ["token", "q"]],
  };
  var DB_KEY = "cartune-admin:db";

  function memStorage() { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }

  /* ---- local demo store ---- */
  function createLocalApi(opts) {
    opts = opts || {};
    var storage = opts.storage || (typeof localStorage !== "undefined" ? localStorage : memStorage());
    var listeners = [], bc = null;
    try { if (typeof BroadcastChannel !== "undefined") { bc = new BroadcastChannel("cartune-api"); bc.onmessage = function (e) { fire(e.data.code, e.data.ev); }; } } catch (e) {}
    function fire(code, ev) { listeners.slice().forEach(function (l) { if (l.code === code) try { l.cb(ev); } catch (e) {} }); }
    /* Two tabs (admin desk + customer app) share the store. In a browser it lives in IndexedDB (consistent across
       tabs) and every read-modify-write runs under a Web Lock, so one tab never overwrites the other's change.
       Without IndexedDB (Node tests, old browsers) it falls back to the given storage, merging record by record. */
    var useIdb = !opts.storage && typeof indexedDB !== "undefined";
    var lock = (!opts.storage && typeof navigator !== "undefined" && navigator.locks) ? function (f) { return navigator.locks.request("cartune-admin-db", f); } : null;
    var base = null, idb = null;
    function db_() { if (!idb) idb = new Promise(function (ok, no) { var r = indexedDB.open("cartune-admin", 1); r.onupgradeneeded = function () { r.result.createObjectStore("kv"); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); return idb; }
    function idbGet() { return db_().then(function (d) { return new Promise(function (ok, no) { var q = d.transaction("kv").objectStore("kv").get(DB_KEY); q.onsuccess = function () { ok(q.result || null); }; q.onerror = function () { no(q.error); }; }); }); }
    function idbPut(v) { return db_().then(function (d) { return new Promise(function (ok, no) { var t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, DB_KEY); t.oncomplete = function () { ok(); }; t.onerror = function () { no(t.error); }; }); }); }
    var adapter = useIdb ? {
      load: function () { return idbGet().then(function (s) { if (!s) { var old = null; try { old = localStorage.getItem(DB_KEY); } catch (e) {} s = old; } base = s; return s ? JSON.parse(s) : null; }); },
      save: function (db) { return (lock ? Promise.resolve(null) : idbGet()).then(function (now) { var out = (now && base && now !== base) ? mergeDb(JSON.parse(base), db, JSON.parse(now)) : db; var j = JSON.stringify(out); base = j; return idbPut(j); }); },
    } : {
      load: function () { var s = storage.getItem(DB_KEY); base = s; return s ? JSON.parse(s) : null; },
      save: function (db) { var now = storage.getItem(DB_KEY); var out = (now && base && now !== base) ? mergeDb(JSON.parse(base), db, JSON.parse(now)) : db; var j = JSON.stringify(out); storage.setItem(DB_KEY, j); base = j; },
    };
    var core = Core.createCore(adapter, { seed: opts.seed !== false, now: opts.now, lock: lock || undefined, publish: function (code, ev) { fire(code, ev); if (bc) try { bc.postMessage({ code: code, ev: ev }); } catch (e) {} } });
    var api = { kind: "local", label: "DEMO DATA (this browser only)" };
    Object.keys(ROUTES).forEach(function (m) { api[m] = core[m]; });
    api.catalog = core.catalog; api.quote = core.quote;
    api.subscribe = function (code, auth, cb) { var l = { code: String(code), cb: cb }; listeners.push(l); return function () { listeners = listeners.filter(function (x) { return x !== l; }); }; };
    api.resetDemo = function () { if (useIdb) return idbPut(""); storage.removeItem(DB_KEY); };
    return api;
  }

  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function keyOf(r) { return r && (r.id || r.code || (r.at + "|" + r.action + "|" + r.target)); }
  function mergeHelp(b, m, t) {
    var o = Object.assign({}, t);
    ["snapshot", "status", "staffId", "staffName", "expiresAt", "endedAt"].forEach(function (k) { if (!same(m[k], b && b[k])) o[k] = m[k]; });
    if (o.status !== "ended" && (m.status === "ended" || t.status === "ended")) o.status = "ended";
    var seen = {}; o.messages = t.messages.concat(m.messages).filter(function (x) { var k = x.at + "|" + x.from + "|" + x.text; if (seen[k]) return false; seen[k] = 1; return true; }).sort(function (x, y) { return x.at - y.at; });
    var sg = {}; t.suggestions.concat(m.suggestions).forEach(function (x) { var c = sg[x.id]; if (!c || (c.status === "pending" && x.status !== "pending")) sg[x.id] = x; });
    o.suggestions = Object.keys(sg).map(function (k) { return sg[k]; }).sort(function (x, y) { return x.at - y.at; });
    return o;
  }
  function mergeList(name, b, m, t) {
    var bm = {}, tm = {}, out = [], done = {};
    (b || []).forEach(function (r) { bm[keyOf(r)] = r; }); (t || []).forEach(function (r) { tm[keyOf(r)] = r; });
    (m || []).forEach(function (r) { var k = keyOf(r); done[k] = 1; var br = bm[k], tr = tm[k];
      if (!tr) { if (!br) out.push(r); return; } /* new here, or deleted there */
      if (same(r, br)) out.push(tr); else if (same(tr, br)) out.push(r); else out.push(name === "help" ? mergeHelp(br, r, tr) : r); });
    (t || []).forEach(function (r) { var k = keyOf(r); if (!done[k] && !bm[k]) out.push(r); });
    if (name === "audit") out.sort(function (x, y) { return y.at - x.at; });
    return out;
  }
  function mergeMap(b, m, t) { var o = Object.assign({}, t || {}); Object.keys(m || {}).forEach(function (k) { if (!same(m[k], b && b[k])) o[k] = m[k]; }); Object.keys(b || {}).forEach(function (k) { if (!(k in (m || {}))) delete o[k]; }); return o; }
  function mergeDb(b, m, t) {
    var o = {}; Object.keys(Object.assign({}, t, m)).forEach(function (k) {
      if (Array.isArray(m[k])) o[k] = mergeList(k, b[k], m[k], t[k]);
      else if (m[k] && typeof m[k] === "object") o[k] = mergeMap(b[k], m[k], t[k]);
      else o[k] = same(m[k], b[k]) ? t[k] : m[k]; });
    return o;
  }

  /* ---- remote server ---- */
  function createRemoteApi(base, opts) {
    opts = opts || {}; base = String(base).replace(/\/+$/, "");
    var f = opts.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    var api = { kind: "remote", label: base };
    Object.keys(ROUTES).forEach(function (m) {
      var r = ROUTES[m];
      api[m] = async function () {
        var args = arguments, path = r[1], q = [], body = {}, headers = { "Content-Type": "application/json" };
        r[2].forEach(function (name, i) { var v = args[i]; if (v === undefined) return;
          if (name === "token") { if (v) headers.Authorization = "Bearer " + v; }
          else if (path.indexOf(":" + name) >= 0) path = path.replace(":" + name, encodeURIComponent(v));
          else if (r[0] === "GET") q.push(encodeURIComponent(name) + "=" + encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : v));
          else body[name] = v; });
        var res = await f(base + path + (q.length ? "?" + q.join("&") : ""), { method: r[0], headers: headers, body: r[0] === "GET" ? undefined : JSON.stringify(body) });
        var j = null; try { j = await res.json(); } catch (e) {}
        if (!res.ok) { var e = new Error((j && j.error) || "Server error " + res.status); e.code = j && j.code; e.status = res.status; throw e; }
        return j ? j.result : null;
      };
    });
    var cat = null; api.catalog = function () { return cat || { tiers: Core.TIERS, packs: Core.PACKS, roles: Core.ROLES, perms: Core.PERMS, orderStatus: Core.ORDER_STATUS, settingsKeys: Core.SETTINGS_KEYS }; };
    api.quote = Core.createCore({ load: function () { return Core.emptyDb(); }, save: function () {} }).quote;
    api.subscribe = function (code, auth, cb) {
      var WS = opts.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : null); if (!WS) return function () {};
      var url = base.replace(/^http/, "ws") + "/ws?code=" + encodeURIComponent(code) + "&" + (auth && auth.token ? "token=" + encodeURIComponent(auth.token) : "key=" + encodeURIComponent((auth && auth.key) || ""));
      var ws, closed = false, retry = 0;
      (function open() { ws = new WS(url); ws.onmessage = function (e) { try { cb(JSON.parse(e.data)); } catch (x) {} }; ws.onopen = function () { retry = 0; };
        ws.onclose = function () { if (!closed && retry < 6) setTimeout(open, 1000 * Math.pow(2, retry++)); }; })();
      return function () { closed = true; try { ws.close(); } catch (e) {} };
    };
    return api;
  }

  function create(opts) {
    var base = null;
    try { base = new URLSearchParams(location.search).get("api"); if (base) localStorage.setItem("cartune:apiBase", base); else base = localStorage.getItem("cartune:apiBase"); } catch (e) {}
    if (base === "local") { try { localStorage.removeItem("cartune:apiBase"); } catch (e) {} base = null; }
    return base ? createRemoteApi(base, opts) : createLocalApi(opts);
  }
  return { ROUTES: ROUTES, DB_KEY: DB_KEY, create: create, createLocalApi: createLocalApi, createRemoteApi: createRemoteApi, memStorage: memStorage, mergeDb: mergeDb, Core: Core };
});

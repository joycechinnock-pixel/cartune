/* ==========================================================================
 * Customer side of CarTune support (v11): Get help, Redeem a code, and the
 * Tune Library Vault. Talks to web/shared/api.js (the local demo store unless
 * the app was opened with ?api=https://your-server).
 *
 * Remote help is read-only on the car: this app sends a snapshot of what is on
 * screen (live data, fault codes, saved diagnostics, settings, the tune) and
 * shows the helper's chat and suggestions. A suggestion changes nothing until
 * the customer taps Accept here; an accepted tune is saved as one of their
 * tunes (filed at its permission level) and is flashed only through the normal
 * Flash sheet and its gates. A showcase/demo pass unlocks every package in
 * demo mode; the browser still has no real ECU write path.
 * ======================================================================== */
var SUP = { api: null, help: null, unsub: null, timer: null, beat: null };
try { SUP.api = CarTuneAPI.create(); } catch (e) { SUP.api = null; }
function deviceId() { var d = store.get("device", null); if (!d) { d = "d-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); store.set("device", d); } return d; }
function showcase() { var s = store.get("showcase", null); return s && s.until > Date.now() ? s : null; }
function applyShowcase() {
  var s = store.get("showcase", null);
  if (s && s.until > Date.now()) { if (S.pkg !== s.appPackage) { if (!store.get("pkgBeforeShowcase", null)) store.set("pkgBeforeShowcase", S.pkg); S.pkg = s.appPackage; } }
  else if (s) { var was = store.get("pkgBeforeShowcase", null); if (was) { S.pkg = was; store.set("pkg", was); } store.set("pkgBeforeShowcase", null); store.set("showcase", null); toast("Your showcase pass has ended"); }
}
function supportRow() {
  var el = $("helpRow"); if (!el) return; var sc = showcase(), dc = store.get("discount", null);
  el.innerHTML = (sc ? '<div class="banner showcase"><b>Showcase pass</b> · every package unlocked in demo mode until ' + esc(new Date(sc.until).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" })) + '. The car is simulated: nothing is ever flashed for real.</div>' : "") +
    (dc ? '<p class="why" style="text-align:center"><b>' + esc(dc.code) + '</b>: ' + (dc.pct ? dc.pct + "% off" : "$" + dc.amount + " off") + ' your next order is saved on this device.</p>' : "") +
    '<div class="chips" style="justify-content:center"><button class="chip" id="getHelpBtn">' + (SUP.help ? "Help session " + esc(SUP.help.code) : "Get help") + '</button><button class="chip" id="redeemBtn">Redeem a code</button><button class="chip" id="vaultBtn">Tune Vault</button></div>';
  $("getHelpBtn").onclick = openHelpSheet; $("redeemBtn").onclick = openRedeem; $("vaultBtn").onclick = openVault;
}
function noApi() { if (SUP.api) return false; toast("Support isn't available in this browser"); return true; }

/* ---- redeem ---- */
function openRedeem(prefill) {
  if (noApi()) return;
  openSheet('<h2>Redeem a code</h2><p class="lbl">A discount code takes money off your next order. A demo or showcase code unlocks the whole app in demo mode for a while, no payment needed.</p>' +
    '<div class="field"><label for="rdCode">Code</label><input id="rdCode" autocomplete="off" autocapitalize="characters" value="' + esc(typeof prefill === "string" ? prefill : "") + '"></div><p class="why" id="rdOut" aria-live="polite"></p>' +
    '<div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="cancel">Close</button><button class="primary" id="rdGo" style="flex:1">Redeem</button></div>');
  $("cancel").onclick = closeSheet;
  $("rdGo").onclick = function () { redeem($("rdCode").value, true); };
  $("rdCode").onkeydown = function (e) { if (e.key === "Enter") redeem($("rdCode").value, true); };
}
async function redeem(code, inSheet) {
  code = String(code || "").trim(); if (!code) return;
  try {
    var r = await SUP.api.redeemCode(code, { device: deviceId() });
    if (r.kind === "demo") { store.set("showcase", { code: r.code, until: r.until, appPackage: r.appPackage, label: r.label }); applyShowcase(); if (S.mode !== "demo") connectDemo(); msg("Showcase pass on: everything unlocked in demo mode until " + new Date(r.until).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit" }) + ". The car is simulated; nothing is flashed for real."); }
    else { store.set("discount", r); msg(r.code + " saved: " + (r.pct ? r.pct + "% off" : "$" + r.amount + " off") + " your next order" + (r.scope && r.scope.length ? " (" + r.scope.join(", ") + " licences)" : "") + "."); }
    render();
  } catch (e) { msg(e.message || "That code didn't work"); }
  function msg(t) { if (inSheet && $("rdOut")) $("rdOut").textContent = t; else toast(t); }
}

/* ---- get help ---- */
function helpSnapshot() {
  var L = S.live || {}, last = L.last || {}, live = {}, labels = {};
  Object.keys(last).forEach(function (k) { var v = last[k]; if (typeof v === "number") { live[k] = +v.toFixed(2); labels[k] = O.LIVE_PIDS[k] ? O.LIVE_PIDS[k].label : k; } });
  var ds = null; try { ds = getSession(); } catch (e) {}
  var dtcs = ds && ds.dtcs ? ds.dtcs : S.mode === "demo" ? DEMO_DTCS : null;
  var t = curTune(), vals = tuneValues(), st = R.stockValues(S.car.engine), changed = {};
  Object.keys(vals).forEach(function (k) { if (vals[k] !== st[k]) changed[k] = vals[k]; });
  var lvl = FL.fileTune(S.car.engine, vals).level;
  return { at: Date.now(), car: { title: S.car.title, engine: S.car.engine, ecu: S.car.ecu || "not confirmed", vin: S.car.vin || "—", mode: S.mode === "demo" ? "demo (simulated car)" : S.mode, connected: connected() },
    live: live, liveLabels: labels, dtcs: dtcs, diag: ds ? (ds.tests || []).slice(-12).map(function (x) { return { label: x.label, status: x.status, message: x.message }; }) : [],
    settings: { skill: S.skill, theme: document.documentElement.getAttribute("data-theme") || "auto", fuel: S.fuel, pkg: S.pkg, upgrades: S.upgrades, showcase: !!showcase() },
    tune: { name: t.name, level: lvl, onCar: tuneName(S.onCar), changed: changed } };
}
async function openHelpSheet() {
  if (noApi()) return;
  if (!SUP.help) {
    openSheet('<h2>Get help</h2><p class="lbl">A CarTune helper can see what this app shows (live data, fault codes, saved tests, settings and your tune) while the session is open. They can chat and suggest changes. <b>They can\u2019t change or flash your car.</b> You accept or decline anything they suggest.</p>' +
      '<div class="field"><label for="hpName">Your name (optional)</label><input id="hpName" autocomplete="name" value="' + esc(store.get("acctName", "")) + '"></div><div class="field"><label for="hpEmail">Account email (optional)</label><input id="hpEmail" type="email" autocomplete="email" value="' + esc(store.get("acctEmail", "")) + '"></div>' +
      '<div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="hpGo" style="flex:1">Start and show my code</button></div>');
    $("cancel").onclick = closeSheet;
    $("hpGo").onclick = async function () {
      var n = $("hpName").value.trim(), em = $("hpEmail").value.trim(); store.set("acctName", n); store.set("acctEmail", em);
      try { var r = await SUP.api.openHelp({ name: n, email: em, device: deviceId(), snapshot: helpSnapshot() }); SUP.help = { code: r.code, key: r.key, view: null }; startHelpSync(); renderHelpSheet(); supportRow(); }
      catch (e) { toast(e.message); }
    };
    return;
  }
  renderHelpSheet();
}
/* read-only Mode 01 reads of the live-data keys so the helper sees current values (skipped while the Live log is running) */
var helpReading = false;
async function readLiveForHelp() {
  var L = S.live; if (!L || L.running || !connected() || helpReading) return; helpReading = true;
  try { for (var i = 0; i < L.keys.length; i++) { var v = null; try { v = await S.obd.readPid(L.keys[i]); } catch (e) {} if (v != null) L.last[L.keys[i]] = v; } } finally { helpReading = false; }
}
function startHelpSync() {
  var h = SUP.help;
  SUP.unsub = SUP.api.subscribe(h.code, { key: h.key }, function () { pullHelp(); });
  var sync = async function () { if (!SUP.help) return clearInterval(SUP.timer); await readLiveForHelp(); if (SUP.help) SUP.api.pushSnapshot(h.code, h.key, helpSnapshot()).catch(function () {}); pullHelp(); };
  clearInterval(SUP.timer); SUP.timer = setInterval(sync, 5000); sync();
}
async function pullHelp() {
  var h = SUP.help; if (!h) return; var prev = h.view;
  try { h.view = await SUP.api.customerView(h.code, h.key); } catch (e) { stopHelp("The help session has ended"); return; }
  var pend = h.view.suggestions.filter(function (s) { return s.status === "pending"; });
  var changed = !prev || prev.messages.length !== h.view.messages.length || prev.status !== h.view.status || JSON.stringify(prev.suggestions.map(function (s) { return s.status; })) !== JSON.stringify(h.view.suggestions.map(function (s) { return s.status; }));
  if (changed && $("scrim").classList.contains("open") && $("hpCode")) { var typing = $("hpMsg") && document.activeElement === $("hpMsg") ? $("hpMsg").value : null; renderHelpSheet(); if (typing !== null) { $("hpMsg").value = typing; $("hpMsg").focus(); } }
  else if (changed && pend.length && !$("scrim").classList.contains("open")) { toast("Your helper sent a suggestion. Tap the help button to see it."); }
  supportRow();
}
function stopHelp(t) { if (SUP.unsub) SUP.unsub(); SUP.unsub = null; clearInterval(SUP.timer); SUP.help = null; if ($("hpCode")) closeSheet(); if (t) toast(t); supportRow(); }
function renderHelpSheet() {
  var h = SUP.help, v = h.view || { messages: [], suggestions: [], status: "waiting" };
  var code = h.code.slice(0, 3) + " " + h.code.slice(3);
  openSheet('<h2>Get help</h2><p class="lbl">Read this code to your helper:</p><p id="hpCode" class="mono" style="font-size:2.6rem;font-weight:700;letter-spacing:.18em;margin:4px 0">' + esc(code) + '</p>' +
    '<p class="why">' + (v.status === "joined" ? "<b>" + esc(v.staffName || "A helper") + "</b> is looking at your app (read-only). They can\u2019t change or flash your car." : "Waiting for a helper to join. The code works for 30 minutes.") + '</p>' +
    v.suggestions.map(function (s) {
      var desc = Object.keys(s.values).map(function (k) { var d = R.SETTINGS.find(function (x) { return x.id === k; }) || R.TOGGLES.find(function (x) { return x.id === k; }); return (d ? d.name : k) + ": " + (typeof s.values[k] === "object" ? JSON.stringify(s.values[k]) : s.values[k]); }).join(" · ");
      var lvl = s.kind === "tune" ? FL.fileTune(S.car.engine, Object.assign({}, R.stockValues(S.car.engine), s.values)).level : null;
      return '<div class="panel suggestion" data-sid="' + s.id + '"><b>' + esc(s.name) + '</b> <span class="lbl">from ' + esc(s.from) + '</span>' + (lvl != null ? ' <span class="perm perm' + lvl + '">' + esc(FL.PERM_NAME[lvl]) + "</span>" : "") +
        (s.note ? '<p class="why" style="margin:6px 0">' + esc(s.note) + "</p>" : "") + '<p class="why mono" style="margin:6px 0;font-size:.85rem;word-break:break-word">' + esc(desc) + "</p>" +
        (s.status === "pending" ? (s.kind === "tune" ? '<p class="why" style="margin:6px 0">Accepting saves this as one of your tunes. It is not flashed: you can look at it first, and flashing still needs every usual check.</p>' : '<p class="why" style="margin:6px 0">Accepting changes these app settings on this device only.</p>') +
          '<div style="display:flex;gap:10px"><button class="ghost sgNo" data-sid="' + s.id + '">Decline</button><button class="primary sgYes" data-sid="' + s.id + '" style="flex:1">Accept</button></div>' : '<p class="lbl">' + (s.status === "accepted" ? "Accepted" : "Declined") + "</p>") + "</div>";
    }).join("") +
    '<div class="panel" style="padding:10px"><div id="hpChat" style="max-height:200px;overflow:auto">' + (v.messages.map(function (m) { return '<p style="margin:4px 0"><b>' + esc(m.from === "staff" ? m.name || "Helper" : "You") + ":</b> " + esc(m.text) + "</p>"; }).join("") || '<p class="lbl">No messages yet.</p>') + '</div><div style="display:flex;gap:8px;margin-top:8px"><input id="hpMsg" placeholder="Message your helper" aria-label="Message your helper" style="flex:1"><button class="primary" id="hpSend">Send</button></div></div>' +
    '<div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="hpEnd">End session</button><button class="primary" id="cancel" style="flex:1">Keep open, hide</button></div>');
  var c = $("hpChat"); c.scrollTop = c.scrollHeight;
  $("cancel").onclick = closeSheet;
  $("hpEnd").onclick = async function () { try { await SUP.api.endHelp(h.code, h.key); } catch (e) {} stopHelp("Help session ended"); };
  var send = async function () { var t = $("hpMsg").value.trim(); if (!t) return; try { await SUP.api.customerChat(h.code, h.key, t); $("hpMsg").value = ""; pullHelp(); } catch (e) { toast(e.message); } };
  $("hpSend").onclick = send; $("hpMsg").onkeydown = function (e) { if (e.key === "Enter") send(); };
  document.querySelectorAll(".sgYes,.sgNo").forEach(function (b) { b.onclick = function () { answer(b.dataset.sid, b.classList.contains("sgYes")); }; });
}
async function answer(sid, yes) {
  var h = SUP.help, s = h.view.suggestions.find(function (x) { return x.id === sid; }); if (!s) return;
  try { await SUP.api.respondSuggestion(h.code, h.key, sid, yes); } catch (e) { toast(e.message); return; }
  if (yes) {
    if (s.kind === "tune") { var u = addUserTune(s.name, s.values); toast("Saved as \u201C" + u.name + "\u201D, filed at " + FL.PERM_NAME[u.level] + ". Nothing was flashed."); }
    else applySettings(s.values);
  } else toast("Declined. Nothing changed.");
  pullHelp(); render();
}
function addUserTune(name, values) {
  var id = "x" + Date.now().toString(36), n = userTunes().length + 1;
  var u = { id: id, name: String(name || "Shared tune").slice(0, 60), from: "factory", created: Date.now(), values: Object.assign({}, R.stockValues(S.car.engine), values) };
  fileInto(u); S.user[id] = u; saveUser(); builtKey = null; return u;
}
function applySettings(v) {
  if (v.skill && ["simple", "standard", "expert"].indexOf(v.skill) >= 0) { S.skill = v.skill; store.set("skill", v.skill); }
  if (v.fuel && ["91", "95", "98", "E85", "diesel"].indexOf(v.fuel) >= 0) { S.fuel = v.fuel; store.set("fuel:" + S.car.key, v.fuel); }
  if (v.theme && ["auto", "night", "sun"].indexOf(v.theme) >= 0 && window.setTheme) setTheme(v.theme);
  if (v.pkg && E.PACKAGES.some(function (p) { return p.id === v.pkg; }) && !showcase()) { S.pkg = v.pkg; store.set("pkg", v.pkg); }
  if (v.upgrades && typeof v.upgrades === "object") { Object.keys(S.upgrades).forEach(function (k) { if (k in v.upgrades) S.upgrades[k] = !!v.upgrades[k]; }); store.set("upgrades", S.upgrades); }
  builtKey = null; toast("Settings changed on this device");
}

/* ---- Tune Library Vault ---- */
async function openVault() {
  if (noApi()) return;
  var list = []; try { list = await SUP.api.vault(); } catch (e) { toast(e.message); return; }
  var mine = userTunes();
  openSheet('<h2>Tune Library Vault</h2><p class="lbl">Tunes other owners shared, checked by the CarTune crew. Downloading one saves it as your own tune; it is filed again on your car and every flash check still applies.</p>' +
    list.map(function (v) {
      var fits = v.engine === S.car.engine;
      return '<div class="panel vault-item" data-id="' + v.id + '"><b>' + esc(v.name) + '</b> <span class="perm perm' + v.level + '">' + esc(v.levelName) + "</span>" + (v.emissions ? ' <span class="perm perm3">Emissions off</span>' : "") +
        '<p class="why" style="margin:6px 0">' + esc(v.vehicle || v.engine) + " · by " + esc(v.author) + " · " + v.downloads + " downloads</p>" + (v.note ? '<p class="why" style="margin:6px 0">' + esc(v.note) + "</p>" : "") +
        (v.roadLegal ? '<p class="why" style="margin:6px 0"><b>Road level.</b></p>' : '<p class="why" style="margin:6px 0;color:var(--warn-text)"><b>Not for public roads.</b> ' + (v.level >= 3 ? "Competition and off-road: you must tick the off-road acknowledgement before flashing. " : "") + (v.emissions ? "Emissions changes: the user agreement must be accepted first. " : "") + "</p>") +
        '<button class="' + (fits ? "primary" : "ghost") + ' vDl" data-id="' + v.id + '" style="width:100%">' + (fits ? "Download to my tunes" : "Made for a different engine type") + "</button></div>";
    }).join("") + (list.length ? "" : '<p class="lbl">Nothing in the vault yet.</p>') +
    '<h3 style="margin-top:14px">Share one of yours</h3>' + (mine.length ? '<div class="field"><label for="vsPick">Your tune</label><select id="vsPick">' + mine.map(function (u) { return '<option value="' + u.id + '">' + esc(u.name) + " (" + esc(FL.PERM_NAME[u.level]) + ")</option>"; }).join("") + '</select></div><div class="field"><label for="vsNote">What it does and what you checked</label><input id="vsNote"></div><div class="field"><label for="vsName">Name shown (optional)</label><input id="vsName" value="' + esc(store.get("acctName", "")) + '"></div><button class="ghost" id="vsGo" style="width:100%">Submit for review</button>' : '<p class="lbl">Make a tune of your own first (change anything on a preset).</p>') +
    '<div style="margin-top:12px"><button class="primary" id="cancel" style="width:100%">Done</button></div>');
  $("cancel").onclick = closeSheet;
  document.querySelectorAll(".vDl").forEach(function (b) { b.onclick = async function () {
    var v = list.find(function (x) { return x.id === b.dataset.id; }); if (v.engine !== S.car.engine) { toast("That tune is for a " + v.engine.replace("_", " ") + " engine"); return; }
    try { var d = await SUP.api.vaultDownload(v.id); var u = addUserTune(d.name, d.values); toast("Saved \u201C" + u.name + "\u201D, filed at " + FL.PERM_NAME[u.level] + ". Nothing was flashed."); closeSheet(); render(); } catch (e) { toast(e.message); } }; });
  if ($("vsGo")) $("vsGo").onclick = async function () {
    var u = S.user[$("vsPick").value], vals = Object.assign({}, R.stockValues(S.car.engine), u.values), st = R.stockValues(S.car.engine), diff = {};
    Object.keys(vals).forEach(function (k) { if (vals[k] !== st[k]) diff[k] = vals[k]; });
    if (!Object.keys(diff).length) { toast("That tune is the same as stock"); return; }
    try { await SUP.api.submitTune({ name: u.name, engine: S.car.engine, vehicle: S.car.title, values: diff, level: u.level, reasons: (u.reasons || []).map(function (r) { return r.label; }), emissions: tuneHasEmissions(vals), note: $("vsNote").value, author: $("vsName").value || "CarTune owner", email: store.get("acctEmail", "") });
      toast("Sent for review. The crew checks every tune before it goes public."); closeSheet(); } catch (e) { toast(e.message); }
  };
}

/* ---- start-up: presence heartbeat, ?demo=CODE links, showcase expiry ---- */
(function () {
  applyShowcase();
  var q = null; try { q = new URLSearchParams(location.search).get("demo"); } catch (e) {}
  if (q && SUP.api) { try { history.replaceState(null, "", location.pathname); } catch (e) {} setTimeout(function () { redeem(q, false); }, 300); }
  function beat() { if (!SUP.api || document.hidden) return; SUP.api.heartbeat({ device: deviceId(), email: store.get("acctEmail", ""), car: S.car ? S.car.title : "" }).catch(function () {}); applyShowcase(); }
  setTimeout(beat, 1500); SUP.beat = setInterval(beat, 60000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) beat(); });
})();
/* Home shows the support row; Settings gets the same three entries. */
(function () {
  var rh = renderHome; renderHome = function () { rh(); supportRow(); };
  var so = $("settingsBtn").onclick;
  $("settingsBtn").onclick = function () { so(); var ok = $("ok"); if (!ok) return; var box = document.createElement("div");
    box.innerHTML = '<p class="lbl" style="margin-top:14px">Help and codes</p><div class="chips"><button class="chip" id="stHelp">Get help</button><button class="chip" id="stRedeem">Redeem a code</button><button class="chip" id="stVault">Tune Vault</button></div>' + (showcase() ? '<p class="why" style="margin:6px 0 0">Showcase pass on until ' + esc(new Date(showcase().until).toLocaleString("en-AU")) + " (demo mode, nothing flashed for real).</p>" : "");
    ok.parentNode.parentNode.insertBefore(box, ok.parentNode);
    $("stHelp").onclick = openHelpSheet; $("stRedeem").onclick = openRedeem; $("stVault").onclick = openVault; };
})();

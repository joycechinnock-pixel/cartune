/* ==========================================================================
 * CarTune Admin app. Talks only to the API layer (web/shared/api.js):
 * the local demo store by default (DEMO DATA, this browser), or a server
 * when opened with ?api=https://your-server (remembered; ?api=local resets).
 * Remote help is read-only on the car: staff see the customer's snapshot,
 * chat, and send suggestions the customer must accept on their own device.
 * ======================================================================== */
var R = requireMod("./tune/rules"), P = requireMod("./tune/presets"), FL = requireMod("./tune/filing"), E = requireMod("./ecu/ecuProfiles");
var api = CarTuneAPI.create();
var CAT = api.catalog();
var A = { token: null, me: null, perms: [], view: "dash", help: null, unsub: null, userFilter: "all", userQ: "", vaultFilter: "pending", timer: null };
try { A.token = sessionStorage.getItem("cartune-admin:token"); } catch (e) {}
var $ = function (id) { return document.getElementById(id); };
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function toast(t) { var el = $("toast"); el.textContent = t; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove("show"); }, 2600); }
function can(p) { return A.perms.indexOf("*") >= 0 || A.perms.indexOf(p) >= 0; }
function money(n) { return "$" + Number(n || 0).toLocaleString("en-AU"); }
function when(t) { if (!t) return "never"; var d = Date.now() - t, m = Math.round(d / 60000); if (d < 0) return new Date(t).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); if (m < 1) return "just now"; if (m < 60) return m + " min ago"; var h = Math.round(m / 60); if (h < 24) return h + " h ago"; return Math.round(h / 24) + " d ago"; }
function date(t) { return t ? new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"; }
function tierName(id) { var t = CAT.tiers.find(function (x) { return x.id === id; }); return t ? t.name : "—"; }
function lvlTag(l) { return '<span class="lvl lvl' + l + '">' + esc(FL.PERM_NAME[l]) + '</span>'; }
function presence(u) { return '<span class="dot ' + (u.online ? "on" : "off") + '" aria-hidden="true"></span>' + (u.online ? "<b>Online</b>" : '<span class="muted">Offline · ' + esc(when(u.lastSeen)) + "</span>"); }
function pkgLine(p, active) { if (!p) return '<span class="muted">No package</span>'; return esc(tierName(p.tier)) + ' <span class="badge ' + (p.source === "paid" ? "b-ok" : p.source === "comp" ? "b-info" : "b-warn") + '">' + esc(p.source) + "</span> " + (p.expires ? '<span class="small ' + (active ? "muted" : "b-fail") + '">' + (active ? "until " : "ended ") + date(p.expires) + "</span>" : '<span class="small muted">lifetime</span>'); }
async function run(fn, okMsg) { try { var r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { if (e.code === "auth") { signOut(true); } toast(e.message || "Something went wrong"); throw e; } }
function bars(arr, label) { var mx = Math.max.apply(null, arr.concat([1])); return '<div class="bars" role="img" aria-label="' + esc(label + ": " + arr.join(", ") + " over the last 14 days") + '">' + arr.map(function (v) { return '<i style="height:' + Math.round(4 + 96 * v / mx) + '%"></i>'; }).join("") + "</div>"; }

/* ---- theme ---- */
function setTheme(t) { document.documentElement.setAttribute("data-theme", t); try { localStorage.setItem("cartune-admin:theme", t); } catch (e) {} $("themeBtn").textContent = t === "night" ? "Sun" : "Night"; $("themeBtn").setAttribute("aria-label", t === "night" ? "Night mode is on. Switch to Sun mode" : "Sun mode is on. Switch to Night mode"); }
setTheme((function () { try { return localStorage.getItem("cartune-admin:theme") || "night"; } catch (e) { return "night"; } })());
$("themeBtn").onclick = function () { setTheme(document.documentElement.getAttribute("data-theme") === "night" ? "sun" : "night"); };
$("demoFlag").innerHTML = api.kind === "local" ? '<span class="demo-flag" title="Stored only in this browser. Point the admin at a server with ?api=https://…">DEMO DATA</span>' : '<span class="badge b-ok">Server: ' + esc(api.label) + "</span>";

/* ---- sign-in and one-time setup ---- */
async function start() {
  var info = await api.info();
  if (A.token) { try { var m = await api.me(A.token); A.me = m.user; A.perms = m.perms; return shell(); } catch (e) { A.token = null; } }
  if (info.setupNeeded) return setupScreen();
  loginScreen();
}
function setupScreen() {
  $("root").innerHTML = '<div class="login panel"><h1>Set up the owner</h1><p class="muted">First run. Create the owner account. This screen works once; after that, staff sign in.</p>' +
    (api.kind === "remote" ? '<label for="suTok">One-time setup token (printed by the server when it started)</label><input id="suTok" autocomplete="off">' : '<div class="banner info small">Demo store: the owner is kept in this browser only (DEMO DATA). Use a password you don\u2019t use anywhere else.</div>') +
    '<label for="suName">Your name</label><input id="suName" autocomplete="name"><label for="suEmail">Email</label><input id="suEmail" type="email" autocomplete="username">' +
    '<label for="suPw">Password (10+ characters)</label><input id="suPw" type="password" autocomplete="new-password"><div class="row" style="margin-top:14px"><button class="primary" id="suGo">Create owner</button></div></div>';
  $("suGo").onclick = async function () {
    await run(function () { return api.setupOwner({ name: $("suName").value, email: $("suEmail").value, password: $("suPw").value, setupToken: $("suTok") ? $("suTok").value.trim() : undefined }); }, "Owner created. Sign in.");
    loginScreen($("suEmail") && $("suEmail").value);
  };
}
function loginScreen(email) {
  $("who").innerHTML = "";
  $("root").innerHTML = '<div class="login panel"><h1>Staff sign in</h1><p class="muted">Owner, admin and support accounts only.</p>' +
    '<label for="liEmail">Email</label><input id="liEmail" type="email" autocomplete="username" value="' + esc(email || "") + '"><label for="liPw">Password</label><input id="liPw" type="password" autocomplete="current-password">' +
    '<div class="row" style="margin-top:14px"><button class="primary" id="liGo">Sign in</button></div></div>';
  var go = async function () { var r = await run(function () { return api.login($("liEmail").value, $("liPw").value); }); A.token = r.token; A.me = r.user; A.perms = r.perms; try { sessionStorage.setItem("cartune-admin:token", r.token); } catch (e) {} shell(); };
  $("liGo").onclick = go; $("liPw").onkeydown = function (e) { if (e.key === "Enter") go(); };
}
async function signOut(expired) { if (!expired) try { await api.logout(A.token); } catch (e) {} A.token = null; try { sessionStorage.removeItem("cartune-admin:token"); } catch (e) {} if (A.unsub) A.unsub(); clearInterval(A.timer); loginScreen(); }

/* ---- shell ---- */
var VIEWS = [["dash", "Dashboard", "stats.view"], ["users", "Users", "users.view"], ["help", "Remote help", "help.join"], ["packages", "Packages & codes", "packages.grant"], ["demo", "Demo access", "demo.manage"],
  ["orders", "Pre-orders & shop", "orders.view"], ["vault", "Tune vault", "catalog.view"], ["catalog", "Tunes & catalogue", "catalog.view"], ["audit", "Audit log", "audit.view"], ["staff", "Staff", "staff.manage"]];
function shell() {
  $("who").innerHTML = '<span class="small">' + esc(A.me.name || A.me.email) + ' · <b>' + esc(A.me.role) + '</b></span> <button class="ghost" id="outBtn">Sign out</button>';
  $("outBtn").onclick = function () { signOut(); };
  var h = location.hash.replace("#", ""); if (VIEWS.some(function (v) { return v[0] === h; })) A.view = h;
  $("root").innerHTML = '<div class="layout"><nav class="side" id="side" aria-label="Admin sections"></nav><main class="main" id="main"></main></div>';
  nav(); show(A.view);
  clearInterval(A.timer); A.timer = setInterval(function () { if (A.view === "dash" || A.view === "users" || (A.view === "help" && !A.help)) show(A.view, true); }, 15000);
}
function nav() { var s = $("side"); s.innerHTML = ""; VIEWS.filter(function (v) { return can(v[2]); }).forEach(function (v) { var b = document.createElement("button"); b.className = "navbtn"; b.id = "nav-" + v[0]; b.innerHTML = "<span>" + v[1] + "</span>"; b.setAttribute("aria-current", A.view === v[0] ? "page" : "false"); b.onclick = function () { A.help = A.view === "help" ? A.help : null; show(v[0]); }; s.appendChild(b); }); }
async function show(v, quiet) {
  if (A.view !== v && A.unsub) { A.unsub(); A.unsub = null; A.help = null; }
  A.view = v; try { history.replaceState(null, "", "#" + v); } catch (e) {} nav();
  var m = $("main"); if (!m) return;
  try { await ({ dash: vDash, users: vUsers, help: vHelp, packages: vPackages, demo: vDemo, orders: vOrders, vault: vVault, catalog: vCatalog, audit: vAudit, staff: vStaff })[v](m, quiet); }
  catch (e) { if (e.code === "auth") return signOut(true); m.innerHTML = '<div class="banner alert">' + esc(e.message) + "</div>"; }
}
function demoNote() { return api.kind === "local" ? '<div class="banner small"><b>DEMO DATA.</b> Customers, orders and codes here are seeded examples kept in this browser. No money moves and nothing is sent to anyone.</div>' : ""; }

/* ---- dashboard ---- */
async function vDash(m) {
  var s = await api.stats(A.token);
  var k = function (l, v, sub) { return '<div class="panel kpi"><span class="l">' + l + '</span><span class="v">' + v + '</span><span class="small muted">' + (sub || "") + "</span></div>"; };
  m.innerHTML = '<h1>Dashboard</h1>' + demoNote() + '<div class="grid">' +
    k("Customers", s.users, s.suspended + " suspended") + k("Online now", s.online, "app open in the last 2 min") + k("Active 7 days", s.active7, "") +
    k("Live help", s.liveHelp, s.helpSessions + " sessions all time") + k("Codes redeemed", s.codesRedeemed, "discount + demo") + k("Pre-orders open", s.preorders, money(s.preorderValue) + " locked in, unpaid") +
    k("Vault to review", s.vaultPending, s.vaultPublic + " public tunes") + k("Staff", s.staff, "") + '</div>' +
    '<div class="grid" style="margin-top:4px">' +
    '<div class="panel"><h3>Packages held</h3><table>' + CAT.tiers.map(function (t) { return "<tr><td>" + esc(t.name) + '</td><td class="mono">' + (s.byTier[t.id] || 0) + "</td></tr>"; }).join("") + '<tr><td class="muted">Paid / comp / demo</td><td class="mono">' + s.bySource.paid + " / " + s.bySource.comp + " / " + (s.bySource.demo || 0) + "</td></tr></table></div>" +
    '<div class="panel"><h3>Sign-ups</h3>' + bars(s.series.signups, "Sign-ups") + '<p class="small muted">Last 14 days</p></div>' +
    '<div class="panel"><h3>Codes redeemed</h3>' + bars(s.series.redemptions, "Codes redeemed") + '<p class="small muted">Last 14 days</p></div>' +
    '<div class="panel"><h3>Help sessions</h3>' + bars(s.series.help, "Help sessions") + '<p class="small muted">Last 14 days</p></div>' +
    '<div class="panel"><h3>Orders</h3>' + bars(s.series.orders, "Orders") + '<p class="small muted">Last 14 days</p></div></div>';
}

/* ---- users ---- */
async function vUsers(m, quiet) {
  var list = await api.listUsers(A.token, A.userQ), f = A.userFilter;
  var FILT = [["all", "All"], ["online", "Online"], ["offline", "Offline"], ["suspended", "Suspended"], ["comp", "Comped"], ["none", "No package"], ["staff", "Staff"]];
  var shown = list.filter(function (u) { return f === "all" ? true : f === "online" ? u.online : f === "offline" ? !u.online : f === "suspended" ? u.status === "suspended" : f === "comp" ? u.package && u.package.source === "comp" : f === "none" ? !u.packageActive && u.role === "customer" : u.role !== "customer"; })
    .sort(function (a, b) { return (b.online - a.online) || ((b.lastSeen || 0) - (a.lastSeen || 0)); });
  var on = list.filter(function (u) { return u.online; }).length;
  if (quiet && $("uTable")) { $("uTable").innerHTML = rows(); bindRows(); $("uCount").textContent = on + " online · " + (list.length - on) + " offline"; return; }
  m.innerHTML = '<h1>Users and accounts</h1>' + demoNote() + '<div class="panel"><div class="row"><div style="flex:1;min-width:220px"><label for="uQ">Search name, email, vehicle, package</label><input id="uQ" value="' + esc(A.userQ) + '" placeholder="e.g. Holden, pro, shazza"></div></div>' +
    '<div class="row" style="margin-top:10px" id="uF"></div><p class="small muted" id="uCount" style="margin:8px 0 0">' + on + " online · " + (list.length - on) + ' offline</p></div><div class="panel tbl"><table><thead><tr><th>Status</th><th>Name</th><th class="hide-m">Vehicle</th><th>Package</th><th class="hide-m">Account</th></tr></thead><tbody id="uTable">' + rows() + "</tbody></table></div>";
  var fb = $("uF"); FILT.forEach(function (x) { var b = document.createElement("button"); b.className = "chip"; b.textContent = x[1]; b.dataset.f = x[0]; b.setAttribute("aria-pressed", f === x[0] ? "true" : "false"); b.onclick = function () { A.userFilter = x[0]; vUsers(m); }; fb.appendChild(b); });
  var t; $("uQ").oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { A.userQ = v; vUsers(m).then(function () { var i = $("uQ"); i.focus(); i.setSelectionRange(v.length, v.length); }); }, 250); };
  bindRows();
  function rows() { return shown.map(function (u) { return '<tr class="click" data-id="' + u.id + '" tabindex="0"><td>' + presence(u) + "</td><td><b>" + esc(u.name || "—") + '</b><br><span class="small muted">' + esc(u.email) + "</span>" + (u.role !== "customer" ? ' <span class="badge b-info">' + esc(u.role) + "</span>" : "") + '</td><td class="hide-m">' + esc(u.vehicle ? u.vehicle.title : "—") + "</td><td>" + (u.role === "customer" ? pkgLine(u.package, u.packageActive) : "—") + '</td><td class="hide-m">' + (u.status === "suspended" ? '<span class="badge b-fail">Suspended</span>' : '<span class="badge b-ok">Active</span>') + "</td></tr>"; }).join("") || '<tr><td colspan="5" class="muted">No one matches.</td></tr>'; }
  function bindRows() { document.querySelectorAll("#uTable tr[data-id]").forEach(function (r) { r.onclick = function () { openUser(r.dataset.id); }; r.onkeydown = function (e) { if (e.key === "Enter") openUser(r.dataset.id); }; }); }
}
function drawer(html) { closeDrawer(); var s = document.createElement("div"); s.className = "scrim"; s.id = "scrim"; s.onclick = closeDrawer; var d = document.createElement("aside"); d.className = "drawer"; d.id = "drawer"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.innerHTML = '<div class="row" style="justify-content:flex-end"><button class="ghost" id="dClose">Close</button></div>' + html; document.body.appendChild(s); document.body.appendChild(d); $("dClose").onclick = closeDrawer; d.querySelector("input,button").focus(); }
function closeDrawer() { ["drawer", "scrim"].forEach(function (i) { var e = $(i); if (e) e.remove(); }); }
document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
async function openUser(id) {
  var u = await run(function () { return api.getUser(A.token, id); });
  var isStaff = u.role !== "customer";
  drawer('<h2>' + esc(u.name || u.email) + "</h2><p>" + presence(u) + (u.online ? "" : ' <span class="small muted">(you can still view and change an offline account)</span>') + "</p>" +
    '<div class="panel"><h3>Account</h3><div class="kv"><b>Email</b><span>' + esc(u.email) + "</span><b>Role</b><span>" + esc(u.role) + "</span><b>Status</b><span>" + (u.status === "suspended" ? '<span class="badge b-fail">Suspended</span>' : '<span class="badge b-ok">Active</span>') + "</span><b>Joined</b><span>" + date(u.createdAt) + "</span><b>Last seen</b><span>" + esc(when(u.lastSeen)) + "</span></div>" +
    (can("users.edit") ? '<div class="form2"><div><label for="eName">Name</label><input id="eName" value="' + esc(u.name) + '"></div><div><label for="eEmail">Email</label><input id="eEmail" value="' + esc(u.email) + '"></div></div>' : "") +
    (isStaff ? "" : '<h3 style="margin-top:14px">Vehicle</h3>' + (can("users.edit") ? '<div class="form2"><div><label for="eVt">Vehicle</label><input id="eVt" value="' + esc(u.vehicle && u.vehicle.title) + '"></div><div><label for="eVm">Make</label><input id="eVm" value="' + esc(u.vehicle && u.vehicle.make) + '"></div><div><label for="eVe">ECU</label><select id="eVe"><option value="">Confirmed when the receiver is plugged in</option>' + E.ECU_PROFILES.map(function (p) { return '<option value="' + p.id + '"' + (u.vehicle && u.vehicle.ecu === p.id ? " selected" : "") + ">" + esc(p.manufacturer + " " + p.family) + "</option>"; }).join("") + "</select></div></div>" : "<p>" + esc(u.vehicle ? u.vehicle.title : "—") + "</p>")) +
    (can("users.edit") ? '<label for="eNote">Add a note</label><textarea id="eNote" placeholder="e.g. Called about lumpy idle"></textarea><div class="row" style="margin-top:10px"><button class="primary" id="eSave">Save changes</button></div>' : "") +
    ((u.notes || []).length ? '<h3 style="margin-top:14px">Notes</h3>' + u.notes.map(function (n) { return '<p class="small"><b>' + esc(n.by) + "</b> · " + date(n.at) + "<br>" + esc(n.text) + "</p>"; }).join("") : "") + "</div>" +
    (isStaff ? "" : '<div class="panel"><h3>Package</h3><p>' + pkgLine(u.package, u.packageActive) + (u.package && u.package.note ? '<br><span class="small muted">' + esc(u.package.note) + "</span>" : "") + "</p>" +
      (can("packages.grant") ? '<div class="form2"><div><label for="gTier">Grant free</label><select id="gTier">' + CAT.tiers.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + " (" + money(t.price) + ")</option>"; }).join("") + '</select></div><div><label for="gDays">Days</label><input id="gDays" type="number" min="1" value="30"></div></div><label><input type="checkbox" id="gLife"> Lifetime comp (no expiry)</label><label for="gNote">Reason</label><input id="gNote" placeholder="e.g. Ambassador, show car, warranty"><div class="row" style="margin-top:10px"><button class="primary" id="gGo">Grant comp</button>' + (u.package && u.package.source !== "paid" ? '<button class="ghost" id="gRev">Remove comp</button>' : "") + "</div>" : "") + "</div>") +
    '<div class="panel"><h3>Actions</h3><div class="row">' + (can("users.suspend") && u.role !== "owner" ? '<button class="' + (u.status === "suspended" ? "btn" : "danger") + '" id="aSus">' + (u.status === "suspended" ? "Unsuspend" : "Suspend") + "</button>" : "") + (can("users.reset") && u.role !== "owner" ? '<button class="btn" id="aReset">Reset password</button>' : "") + '</div><div id="aOut"></div></div>' +
    (u.orders && u.orders.length ? '<div class="panel"><h3>Orders</h3>' + u.orders.map(function (o) { return "<p>" + esc(o.id) + " · " + esc(o.items.join("; ")) + " · " + money(o.total) + ' · <span class="badge b-info">' + esc(o.status) + "</span></p>"; }).join("") + "</div>" : "") +
    (u.vault && u.vault.length ? '<div class="panel"><h3>Vault submissions</h3>' + u.vault.map(function (v) { return "<p>" + esc(v.name) + " " + lvlTag(v.level) + ' <span class="badge b-info">' + esc(v.status) + "</span></p>"; }).join("") + "</div>" : "") +
    (u.help && u.help.length ? '<div class="panel"><h3>Help sessions</h3>' + u.help.map(function (h) { return '<p class="small">' + esc(h.code) + " · " + esc(h.status) + " · " + date(h.createdAt) + "</p>"; }).join("") + "</div>" : ""));
  var re = function () { openUser(id); if (A.view === "users") vUsers($("main"), true); };
  if ($("eSave")) $("eSave").onclick = async function () { var p = { name: $("eName").value, email: $("eEmail").value, note: $("eNote").value.trim() || undefined }; if ($("eVt")) p.vehicle = { title: $("eVt").value, make: $("eVm").value, ecu: $("eVe").value || null }; await run(function () { return api.updateUser(A.token, id, p); }, "Saved"); re(); };
  if ($("gGo")) { $("gLife").onchange = function () { $("gDays").disabled = this.checked; }; $("gGo").onclick = async function () { await run(function () { return api.grantPackage(A.token, id, { tier: $("gTier").value, days: Number($("gDays").value), lifetime: $("gLife").checked, note: $("gNote").value }); }, "Comp granted"); re(); }; }
  if ($("gRev")) $("gRev").onclick = async function () { await run(function () { return api.revokePackage(A.token, id, "removed by " + A.me.email); }, "Comp removed"); re(); };
  if ($("aSus")) $("aSus").onclick = async function () { var s = u.status !== "suspended"; if (s && !confirm("Suspend " + u.email + "? They're signed out everywhere.")) return; await run(function () { return api.setSuspended(A.token, id, s, s ? "suspended from admin" : ""); }, s ? "Suspended" : "Unsuspended"); re(); };
  if ($("aReset")) $("aReset").onclick = async function () { var r = await run(function () { return api.resetPassword(A.token, id); }); $("aOut").innerHTML = '<p class="small" style="margin-top:10px">Temporary password, shown once. Give it to the customer by phone; they choose a new one at next sign-in.</p><div class="secret" id="tempPw">' + esc(r.tempPassword) + "</div>"; };
}

/* ---- remote help ---- */
async function vHelp(m, quiet) {
  if (A.help) return helpSession(m);
  var list = await api.listHelp(A.token), live = list.filter(function (h) { return h.status !== "ended"; });
  m.innerHTML = '<h1>Remote help</h1>' + demoNote() + '<div class="banner info"><b>Read-only on the car.</b> You see what the customer\u2019s app shows: live data, fault codes, diagnostics, settings and the tune on screen. You can chat and suggest a tune or settings change. Nothing is ever flashed or written to an ECU remotely: the customer accepts on their own device, and their app\u2019s flash gates (backup, pull log, agreement, typing FLASH) still apply.</div>' +
    '<div class="panel"><h3>Join with the customer\u2019s code</h3><p class="small muted">The customer taps <b>Get help</b> in the app and reads you the 6-digit code.</p><div class="row"><input id="hCode" inputmode="numeric" maxlength="7" placeholder="123 456" style="max-width:220px;font:700 1.4rem var(--font-mono);letter-spacing:.15em"><button class="primary" id="hJoin">Join session</button></div></div>' +
    '<div class="panel"><h3>Waiting and live (' + live.length + ')</h3>' + (live.length ? '<table><tr><th>Code</th><th>Customer</th><th>Car</th><th>Opened</th><th></th></tr>' + live.map(function (h) { return '<tr><td class="mono">' + esc(h.code) + "</td><td>" + esc(h.customer.name || h.customer.email || "Anonymous device") + "</td><td>" + esc(h.snapshot && h.snapshot.car ? h.snapshot.car.title : "—") + "</td><td>" + when(h.createdAt) + '</td><td><span class="badge ' + (h.status === "joined" ? "b-ok" : "b-warn") + '">' + esc(h.status) + "</span></td></tr>"; }).join("") + "</table>" : '<p class="muted">No one is waiting. Codes last 30 minutes.</p>') + "</div>" +
    '<div class="panel"><h3>Recent</h3>' + list.filter(function (h) { return h.status === "ended"; }).slice(0, 8).map(function (h) { return '<p class="small"><span class="mono">' + esc(h.code) + "</span> · " + esc(h.customer.name || h.customer.email || "Anonymous") + " · " + date(h.createdAt) + " · " + h.messages.length + " messages · " + h.suggestions.length + " suggestions</p>"; }).join("") + "</div>";
  var go = async function () { var c = $("hCode").value.replace(/\D/g, ""); var h = await run(function () { return api.joinHelp(A.token, c); }, "Joined"); A.help = h; helpSession(m); };
  $("hJoin").onclick = go; $("hCode").onkeydown = function (e) { if (e.key === "Enter") go(); };
}
function helpSession(m) {
  var h = A.help, s = h.snapshot || {};
  if (!A.unsub) { A.unsub = api.subscribe(h.code, { token: A.token }, function (ev) { refreshHelp(); }); A.helpPoll = setInterval(function () { if (A.help) refreshHelp(); else clearInterval(A.helpPoll); }, 4000); }
  var kv = function (o) { return '<div class="kv">' + Object.keys(o || {}).map(function (k) { var v = o[k]; return "<b>" + esc(k) + '</b><span class="mono">' + esc(typeof v === "object" ? JSON.stringify(v) : v) + "</span>"; }).join("") + "</div>"; };
  var ended = h.status === "ended";
  m.innerHTML = '<div class="row" style="justify-content:space-between"><h1>Helping ' + esc(h.customer.name || "a customer") + ' <span class="mono small">#' + esc(h.code) + "</span></h1><div class=\"row\"><button class=\"ghost\" id=\"hBack\">All sessions</button>" + (ended ? "" : '<button class="danger" id="hEnd">End session</button>') + "</div></div>" +
    (ended ? '<div class="banner alert">This session has ended.</div>' : '<div class="banner info small">Read-only view of the customer\u2019s app. Updated ' + when(s.at) + ". You can\u2019t change the car from here.</div>") +
    '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">' +
    '<div class="panel ro"><h3>Vehicle</h3>' + kv(s.car) + "</div>" +
    '<div class="panel ro"><h3>Live data</h3>' + (s.live && Object.keys(s.live).length ? '<table>' + Object.keys(s.live).map(function (k) { return "<tr><td>" + esc((s.liveLabels && s.liveLabels[k]) || k) + '</td><td class="mono">' + esc(s.live[k]) + "</td></tr>"; }).join("") + "</table>" : '<p class="muted">No live data yet.</p>') + "</div>" +
    '<div class="panel ro"><h3>Fault codes</h3>' + (s.dtcs ? ["stored", "pending", "permanent"].map(function (k) { return "<p><b>" + k + ":</b> " + ((s.dtcs[k] || []).map(function (c) { return '<span class="badge b-warn mono">' + esc(c) + "</span>"; }).join(" ") || '<span class="muted">none</span>') + "</p>"; }).join("") : '<p class="muted">Not read yet.</p>') + "</div>" +
    '<div class="panel ro"><h3>Diagnostics</h3>' + ((s.diag && s.diag.length) ? s.diag.map(function (t) { return '<p class="small"><span class="badge ' + (t.status === "pass" ? "b-ok" : t.status === "fail" ? "b-fail" : "b-warn") + '">' + esc(t.status) + "</span> " + esc(t.label) + "<br>" + esc(t.message || "") + "</p>"; }).join("") : '<p class="muted">No tests saved.</p>') + "</div>" +
    '<div class="panel ro"><h3>Settings</h3>' + kv(s.settings) + "</div>" +
    '<div class="panel ro"><h3>Tune on screen</h3>' + (s.tune ? "<p><b>" + esc(s.tune.name) + "</b> " + (s.tune.level != null ? lvlTag(s.tune.level) : "") + '</p><p class="small muted">On the car: ' + esc(s.tune.onCar || "—") + "</p>" + kv(s.tune.changed) : '<p class="muted">—</p>') + "</div></div>" +
    '<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))"><div class="panel"><h3>Chat</h3><div class="chat" id="hChat">' + h.messages.map(function (x) { return '<div class="msg ' + x.from + '"><small>' + esc(x.from === "staff" ? x.name || "Staff" : h.customer.name || "Customer") + " · " + when(x.at) + "</small>" + esc(x.text) + "</div>"; }).join("") + "</div>" +
    (ended ? "" : '<div class="row"><input id="hMsg" placeholder="Type a message" style="flex:1"><button class="primary" id="hSend">Send</button></div>') + "</div>" +
    '<div class="panel"><h3>Suggest a change</h3><p class="small muted">The customer sees it on their phone and taps Accept or Decline. An accepted tune is saved as one of their tunes, filed at its permission level. Flashing it is still up to them and their app\u2019s gates.</p>' +
    (ended || !can("help.suggest") ? "" : '<div class="row" id="sKind"><button class="chip" aria-pressed="true" data-k="tune">Tune</button><button class="chip" aria-pressed="false" data-k="settings">Settings</button></div><div id="sForm"></div>') +
    '<h3 style="margin-top:14px">Sent</h3>' + (h.suggestions.map(function (g) { return '<p class="small"><b>' + esc(g.name) + "</b> (" + esc(g.kind) + ') <span class="badge ' + (g.status === "accepted" ? "b-ok" : g.status === "declined" ? "b-fail" : "b-warn") + '">' + esc(g.status) + "</span><br>" + esc(Object.keys(g.values).map(function (k) { return k + " = " + JSON.stringify(g.values[k]); }).join(", ")) + "</p>"; }).join("") || '<p class="muted small">Nothing sent yet.</p>') + "</div></div>";
  var c = $("hChat"); if (c) c.scrollTop = c.scrollHeight;
  $("hBack").onclick = function () { if (A.unsub) A.unsub(); A.unsub = null; A.help = null; clearInterval(A.helpPoll); vHelp(m); };
  if ($("hEnd")) $("hEnd").onclick = async function () { await run(function () { return api.endHelp(h.code, null, A.token); }, "Session ended"); refreshHelp(); };
  if ($("hSend")) { var send = async function () { var t = $("hMsg").value.trim(); if (!t) return; await run(function () { return api.staffChat(A.token, h.code, t); }); refreshHelp(); }; $("hSend").onclick = send; $("hMsg").onkeydown = function (e) { if (e.key === "Enter") send(); }; }
  if ($("sKind")) { var kind = A.sKind || "tune"; $("sKind").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b.dataset.k === kind ? "true" : "false"); b.onclick = function () { A.sKind = b.dataset.k; helpSession(m); }; }); suggestForm(kind, s); }
}
function suggestForm(kind, s) {
  var f = $("sForm"), eng = (s.car && s.car.engine) || "na_petrol";
  if (kind === "tune") {
    var defs = R.settingsFor(eng, "expert");
    f.innerHTML = '<label for="sBase">Start from preset</label><select id="sBase">' + P.PRESETS.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; }).join("") + '</select><label for="sName">Name the customer sees</label><input id="sName" value="Suggested by CarTune help">' +
      '<label for="sSet">Then change one setting (optional)</label><div class="row"><select id="sSet" style="flex:2"><option value="">— none —</option>' + defs.map(function (d) { return '<option value="' + d.id + '">' + esc(d.segment + ": " + d.name) + "</option>"; }).join("") + '</select><input id="sVal" type="number" step="any" placeholder="value" style="flex:1"></div><p class="small" id="sLvl"></p><label for="sNote">Why</label><input id="sNote" placeholder="e.g. Smooths the idle after your cam change"><div class="row" style="margin-top:10px"><button class="primary" id="sGo">Send suggestion</button></div>';
    var vals = function () { var v = P.presetValues(P.PRESETS.find(function (p) { return p.id === $("sBase").value; }), eng); if ($("sSet").value && $("sVal").value !== "") v[$("sSet").value] = Number($("sVal").value); var st = R.stockValues(eng), d = {}; Object.keys(v).forEach(function (k) { if (v[k] !== st[k]) d[k] = v[k]; }); return d; };
    var lv = function () { var fi = FL.fileTune(eng, Object.assign({}, R.stockValues(eng), vals())); $("sLvl").innerHTML = "Files at " + lvlTag(fi.level) + (fi.reasons.length ? ' <span class="muted">' + esc(fi.reasons.map(function (r) { return r.label; }).join(", ")) + "</span>" : ""); };
    ["sBase", "sSet", "sVal"].forEach(function (i) { $(i).oninput = lv; }); lv();
    $("sGo").onclick = async function () { if (!Object.keys(vals()).length) { toast("That's the same as stock. Pick a preset or change a setting."); return; } await run(function () { return api.suggest(A.token, A.help.code, { kind: "tune", name: $("sName").value, note: $("sNote").value, values: vals() }); }, "Suggestion sent. Waiting for the customer."); refreshHelp(); };
  } else {
    f.innerHTML = '<div class="form2"><div><label for="sSkill">Explain things</label><select id="sSkill"><option value="">no change</option><option value="simple">Simply</option><option value="standard">With detail</option><option value="expert">Technically</option></select></div><div><label for="sFuel">Fuel</label><select id="sFuel"><option value="">no change</option><option>91</option><option>95</option><option>98</option><option>E85</option><option>diesel</option></select></div><div><label for="sTheme">Theme</label><select id="sTheme"><option value="">no change</option><option value="night">Night</option><option value="sun">Sun</option></select></div></div><label for="sNote">Why</label><input id="sNote"><div class="row" style="margin-top:10px"><button class="primary" id="sGo">Send suggestion</button></div>';
    $("sGo").onclick = async function () { var v = {}; if ($("sSkill").value) v.skill = $("sSkill").value; if ($("sFuel").value) v.fuel = $("sFuel").value; if ($("sTheme").value) v.theme = $("sTheme").value; await run(function () { return api.suggest(A.token, A.help.code, { kind: "settings", name: "Suggested settings", note: $("sNote").value, values: v }); }, "Suggestion sent"); refreshHelp(); };
  }
}
async function refreshHelp() { if (!A.help || A.view !== "help") return; var typing = $("hMsg") && document.activeElement === $("hMsg") ? $("hMsg").value : null; if (document.activeElement && document.activeElement.closest && document.activeElement.closest("#sForm")) return; try { A.help = await api.staffView(A.token, A.help.code); } catch (e) { return; } helpSession($("main")); if (typing !== null && $("hMsg")) { $("hMsg").value = typing; $("hMsg").focus(); } }

/* ---- packages, comps and discount codes ---- */
async function vPackages(m) {
  var codes = (await api.listCodes(A.token)).filter(function (c) { return c.kind === "discount"; }), users = await api.listUsers(A.token, ""), comps = users.filter(function (u) { return u.package && u.package.source === "comp"; });
  m.innerHTML = '<h1>Packages and comps</h1>' + demoNote() +
    '<div class="panel"><h3>Packages (from the CarTune by DFTC shop, AUD incl. GST, paid once)</h3><div class="tbl"><table><tr><th>Licence</th><th>Price</th><th>App package</th><th class="hide-m">Covers</th></tr>' + CAT.tiers.map(function (t) { return "<tr><td><b>" + esc(t.name) + "</b>" + (t.biz ? ' <span class="badge b-info">business</span>' : "") + '</td><td class="mono">' + money(t.price) + "</td><td>" + esc(t.appPackage) + '</td><td class="hide-m small">' + esc(t.blurb) + "</td></tr>"; }).join("") + '</table></div><p class="small muted">Each extra make on the same licence is half price. Packs: ' + CAT.packs.map(function (p) { return esc(p.name) + " " + money(p.price) + " (business " + money(p.biz) + ")"; }).join(" · ") + ".</p></div>" +
    '<div class="panel"><h3>Free packages (comps) · ' + comps.length + '</h3><p class="small muted">Grant a comp from a user\u2019s account (Users → open → Grant free), with an expiry in days or lifetime.</p><div class="tbl"><table><tr><th>Who</th><th>Package</th><th>Reason</th></tr>' + comps.map(function (u) { return '<tr class="click" data-id="' + u.id + '"><td>' + esc(u.name) + '<br><span class="small muted">' + esc(u.email) + "</span></td><td>" + pkgLine(u.package, u.packageActive) + '</td><td class="small">' + esc(u.package.note || "") + "</td></tr>"; }).join("") + "</table></div></div>" +
    (can("codes.manage") ? '<div class="panel" id="newCode"><h3>New discount code</h3><div class="form2"><div><label for="cCode">Code (blank = random)</label><input id="cCode" placeholder="MATE25" style="text-transform:uppercase"></div><div><label for="cType">Type</label><select id="cType"><option value="pct">Percent off</option><option value="amt">Fixed $ off</option></select></div><div><label for="cVal">Amount</label><input id="cVal" type="number" min="1" value="20"></div><div><label for="cUses">Uses</label><input id="cUses" type="number" min="1" value="10"></div><div><label for="cExp">Expires in (days, blank = never)</label><input id="cExp" type="number" min="1" value="30"></div></div><label>Packages it applies to (none ticked = all)</label><div class="row">' + CAT.tiers.map(function (t) { return '<label style="margin:0;font-weight:600"><input type="checkbox" class="cScope" value="' + t.id + '"> ' + esc(t.name) + "</label>"; }).join("") + '</div><div class="row" style="margin-top:12px"><button class="primary" id="cGo">Create code</button></div></div>' : "") +
    '<div class="panel"><h3>Discount codes</h3><div class="tbl"><table><tr><th>Code</th><th>Off</th><th>Used</th><th class="hide-m">Scope</th><th>Expires</th><th></th></tr>' + codes.map(function (c) { var dead = c.disabled || (c.expires && c.expires < Date.now()) || c.used >= c.uses; return '<tr><td class="mono"><b>' + esc(c.code) + "</b></td><td>" + (c.pct ? c.pct + "%" : money(c.amount)) + '</td><td class="mono">' + c.used + " / " + c.uses + '</td><td class="hide-m small">' + esc(c.scope.length ? c.scope.map(tierName).join(", ") : "Any") + "</td><td>" + (c.expires ? date(c.expires) : "never") + "</td><td>" + (can("codes.manage") ? '<button class="ghost cDis" data-c="' + esc(c.code) + '" data-d="' + (c.disabled ? 0 : 1) + '">' + (c.disabled ? "Enable" : "Disable") + "</button>" : "") + (dead ? ' <span class="badge b-fail">' + (c.disabled ? "off" : "done") + "</span>" : "") + "</td></tr>"; }).join("") + "</table></div></div>";
  m.querySelectorAll("tr[data-id]").forEach(function (r) { r.onclick = function () { openUser(r.dataset.id); }; });
  if ($("cGo")) $("cGo").onclick = async function () { var pct = $("cType").value === "pct"; var r = await run(function () { return api.createCode(A.token, { kind: "discount", code: $("cCode").value, pct: pct ? Number($("cVal").value) : 0, amount: pct ? 0 : Number($("cVal").value), uses: Number($("cUses").value), expiresDays: Number($("cExp").value) || 0, scope: Array.prototype.filter.call(document.querySelectorAll(".cScope"), function (x) { return x.checked; }).map(function (x) { return x.value; }) }); }); toast("Code " + r.code + " created"); vPackages(m); };
  m.querySelectorAll(".cDis").forEach(function (b) { b.onclick = async function () { await run(function () { return api.setCodeDisabled(A.token, b.dataset.c, b.dataset.d === "1"); }); vPackages(m); }; });
}

/* ---- demo / showcase access ---- */
function appUrl() { var h = location.href.replace(/[#?].*$/, ""); if (/CarTune-Admin\.html$/i.test(h)) return h.replace(/CarTune-Admin\.html$/i, "CarTune-App.html"); return h.replace(/admin\/?(index\.html)?$/, ""); }
async function vDemo(m) {
  var codes = (await api.listCodes(A.token)).filter(function (c) { return c.kind === "demo"; });
  m.innerHTML = '<h1>Demo access</h1>' + demoNote() + '<div class="banner info">A demo code or link unlocks the whole app (every package and tool) in <b>demo mode</b> for a set time, with no payment. The demo car is simulated: there is no real ECU flashing, and a real adapter still can\u2019t write from the browser.</div>' +
    '<div class="panel"><h3>New demo link</h3><div class="form2"><div><label for="dLabel">What it\u2019s for</label><input id="dLabel" placeholder="e.g. Perth 4WD show stand"></div><div><label for="dCode">Code (blank = random)</label><input id="dCode" placeholder="DEMO-…" style="text-transform:uppercase"></div><div><label for="dHours">Unlocks for (hours)</label><input id="dHours" type="number" min="1" value="48"></div><div><label for="dUses">Uses (devices)</label><input id="dUses" type="number" min="1" value="10"></div><div><label for="dExp">Link valid for (days)</label><input id="dExp" type="number" min="1" value="14"></div></div><div class="row" style="margin-top:12px"><button class="primary" id="dGo">Create demo link</button></div><div id="dOut"></div></div>' +
    '<div class="panel"><h3>Demo codes</h3><div class="tbl"><table><tr><th>Code</th><th>For</th><th>Unlocks</th><th>Used</th><th>Valid until</th><th></th></tr>' + codes.map(function (c) { return '<tr><td class="mono"><b>' + esc(c.code) + '</b><br><span class="small muted" style="word-break:break-all">' + esc(appUrl() + "?demo=" + c.code) + "</span></td><td>" + esc(c.label || "—") + "</td><td>" + c.hours + ' h</td><td class="mono">' + c.used + " / " + c.uses + "</td><td>" + (c.expires ? date(c.expires) : "never") + '</td><td><button class="ghost dCopy" data-u="' + esc(appUrl() + "?demo=" + c.code) + '">Copy link</button> <button class="ghost dDis" data-c="' + esc(c.code) + '" data-d="' + (c.disabled ? 0 : 1) + '">' + (c.disabled ? "Enable" : "Disable") + "</button></td></tr>"; }).join("") + "</table></div></div>";
  $("dGo").onclick = async function () { var r = await run(function () { return api.createCode(A.token, { kind: "demo", code: $("dCode").value, label: $("dLabel").value, hours: Number($("dHours").value), uses: Number($("dUses").value), expiresDays: Number($("dExp").value) || 0 }); }); var u = appUrl() + "?demo=" + r.code;
    await vDemo(m); $("dOut").innerHTML = '<p class="small" style="margin-top:12px">Share this link, or have them type the code into <b>Settings → Redeem a code</b>:</p><div class="secret" id="dLink">' + esc(u) + '</div><p class="mono" style="font-size:1.4rem">' + esc(r.code) + "</p>"; };
  m.querySelectorAll(".dCopy").forEach(function (b) { b.onclick = function () { try { navigator.clipboard.writeText(b.dataset.u); toast("Link copied"); } catch (e) { toast(b.dataset.u); } }; });
  m.querySelectorAll(".dDis").forEach(function (b) { b.onclick = async function () { await run(function () { return api.setCodeDisabled(A.token, b.dataset.c, b.dataset.d === "1"); }); vDemo(m); }; });
}

/* ---- pre-orders and shop ---- */
async function vOrders(m) {
  var list = await api.listOrders(A.token);
  m.innerHTML = '<h1>Pre-orders and shop</h1>' + demoNote() + '<div class="banner"><b>No payment processing.</b> Card checkout isn\u2019t live yet (the shop takes pre-orders). Status changes and refunds here are <b>notes only</b>: no money moves. Do refunds in the payment provider once it\u2019s connected, then note them here.</div>' +
    '<div class="panel tbl"><table><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr>' + list.map(function (o) { return '<tr class="click" data-id="' + o.id + '"><td class="mono">' + esc(o.id) + '<br><span class="small muted">' + date(o.at) + "</span></td><td>" + esc(o.email) + '</td><td class="small">' + esc(o.items.join("; ")) + (o.code ? '<br><span class="badge b-info">' + esc(o.code) + "</span>" : "") + '</td><td class="mono">' + money(o.total) + '</td><td><span class="badge ' + (o.status === "paid" || o.status === "shipped" ? "b-ok" : o.status === "cancelled" || o.status === "refund noted" ? "b-fail" : "b-warn") + '">' + esc(o.status) + "</span></td></tr>"; }).join("") + "</table></div>";
  m.querySelectorAll("tr[data-id]").forEach(function (r) { r.onclick = function () { var o = list.find(function (x) { return x.id === r.dataset.id; });
    drawer("<h2>Order " + esc(o.id) + '</h2><div class="panel"><div class="kv"><b>Customer</b><span>' + esc(o.email) + "</span><b>Placed</b><span>" + date(o.at) + "</span><b>Items</b><span>" + esc(o.items.join("; ")) + '</span><b>Total</b><span class="mono">' + money(o.total) + "</span><b>Code</b><span>" + esc(o.code || "—") + "</span></div></div>" +
      (can("orders.edit") ? '<div class="panel"><label for="oSt">Status</label><select id="oSt">' + CAT.orderStatus.map(function (s) { return "<option" + (s === o.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + '</select><label for="oNote">Note (required for a refund note)</label><textarea id="oNote"></textarea><p class="small muted">"refund noted" records a refund made elsewhere. Nothing is charged or refunded from here.</p><div class="row"><button class="primary" id="oGo">Save</button></div></div>' : "") +
      '<div class="panel"><h3>Notes</h3>' + (o.notes.map(function (n) { return '<p class="small"><b>' + esc(n.by) + "</b> · " + date(n.at) + "<br>" + esc(n.text) + "</p>"; }).join("") || '<p class="muted small">None.</p>') + "</div>");
    if ($("oGo")) $("oGo").onclick = async function () { if ($("oSt").value === "refund noted" && !$("oNote").value.trim()) { toast("Add a note saying how and when the refund was made"); return; } await run(function () { return api.updateOrder(A.token, o.id, { status: $("oSt").value, note: $("oNote").value.trim() || undefined }); }, "Saved"); closeDrawer(); vOrders(m); }; }; });
}

/* ---- Tune Library Vault review ---- */
function refile(v) { var st = R.stockValues(v.engine), vals = Object.assign({}, st, v.values), fi = FL.fileTune(v.engine, vals);
  var emis = R.togglesFor(v.engine, "expert").some(function (t) { return t.agreement && R.isOn(t, vals) !== R.isOn(t, st); });
  return { level: fi.level, reasons: fi.reasons.map(function (r) { return r.label; }), emissions: emis, folder: fi.presetId }; }
async function vVault(m) {
  var all = await api.listSubmissions(A.token), f = A.vaultFilter, list = all.filter(function (v) { return f === "all" || v.status === f; });
  var cnt = function (s) { return all.filter(function (v) { return v.status === s; }).length; };
  m.innerHTML = '<h1>Tune Library Vault</h1>' + demoNote() + '<div class="banner info">Customers submit their own tunes. Accepted tunes go public in the vault, where anyone can download one into their own tunes. Each tune keeps its permission level. <b>Competition and emissions-off tunes keep their gates and warnings and can\u2019t be published as road-legal.</b> The app re-files every downloaded tune with the same rules and asks for the same acknowledgements before any flash.</div>' +
    '<div class="row" id="vF" style="margin-bottom:12px"></div><div id="vList">' + (list.map(card).join("") || '<p class="muted panel">Nothing here.</p>') + "</div>";
  [["pending", "To review (" + cnt("pending") + ")"], ["accepted", "Public (" + cnt("accepted") + ")"], ["rejected", "Rejected (" + cnt("rejected") + ")"], ["all", "All"]].forEach(function (x) { var b = document.createElement("button"); b.className = "chip"; b.textContent = x[1]; b.setAttribute("aria-pressed", f === x[0] ? "true" : "false"); b.onclick = function () { A.vaultFilter = x[0]; vVault(m); }; $("vF").appendChild(b); });
  function card(v) {
    var rf = refile(v), lvl = Math.max(v.level, rf.level), emis = v.emissions || rf.emissions, roadOk = lvl <= 1 && !emis;
    var changes = Object.keys(v.values).map(function (k) { var d = R.SETTINGS.find(function (s) { return s.id === k; }) || R.TOGGLES.find(function (s) { return s.id === k; }); return esc(d ? d.name : k) + " = " + esc(v.values[k]); }).join(" · ");
    return '<div class="panel vault-card" data-id="' + v.id + '"><div class="row" style="justify-content:space-between"><h3 style="margin:0">' + esc(v.name) + "</h3><div>" + lvlTag(lvl) + (emis ? ' <span class="badge b-fail">Emissions off</span>' : "") + (v.status === "accepted" ? (v.roadLegal ? ' <span class="badge b-ok">Road-legal</span>' : ' <span class="badge b-warn">Not for public roads</span>') : "") + ' <span class="badge b-info">' + esc(v.status) + "</span></div></div>" +
      '<p class="small">By <b>' + esc(v.author) + "</b> " + (v.userId ? presence({ online: v.authorOnline, lastSeen: v.authorLastSeen }) : '<span class="muted">(no account)</span>') + " · " + esc(v.vehicle || v.engine) + " · submitted " + when(v.submittedAt) + (v.downloads ? " · " + v.downloads + " downloads" : "") + "</p>" +
      (v.note ? '<p>\u201C' + esc(v.note) + '\u201D</p>' : "") + '<p class="small mono" style="word-break:break-word">' + changes + "</p>" +
      '<p class="small">Re-filed here: ' + lvlTag(rf.level) + (rf.reasons.length ? " " + esc(rf.reasons.join(", ")) : " no restrictions lifted") + (rf.level !== v.level ? ' <b class="b-warn">(submitted as ' + esc(FL.PERM_NAME[v.level]) + ")</b>" : "") + "</p>" +
      (lvl >= 3 ? '<div class="banner alert small">Competition and off-road: customers must tick the off-road acknowledgement before flashing.</div>' : "") + (emis ? '<div class="banner alert small">Emissions changes: the user agreement must be accepted before flashing. Never road-legal.</div>' : "") +
      (v.reviewNotes.length ? v.reviewNotes.map(function (n) { return '<p class="small"><b>' + esc(n.by) + "</b> · " + date(n.at) + ": " + esc(n.text) + "</p>"; }).join("") : "") +
      (can("presets.edit") && v.status === "pending" ? '<label for="vn-' + v.id + '">Review note</label><textarea id="vn-' + v.id + '" placeholder="What you checked, or what to fix"></textarea><label style="font-weight:600"><input type="checkbox" id="vr-' + v.id + '"' + (roadOk ? "" : " disabled") + "> Publish as road-legal" + (roadOk ? "" : " (not allowed: " + esc(FL.PERM_NAME[lvl]) + (emis ? ", emissions off" : "") + ")") + '</label><div class="row" style="margin-top:10px"><button class="primary vAcc" data-id="' + v.id + '">Accept and publish</button><button class="danger vRej" data-id="' + v.id + '">Reject</button><button class="ghost vNote" data-id="' + v.id + '">Add note only</button></div>' : "") + "</div>";
  }
  var byId = function (id) { return all.find(function (x) { return x.id === id; }); };
  m.querySelectorAll(".vAcc").forEach(function (b) { b.onclick = async function () { var v = byId(b.dataset.id), rf = refile(v); await run(function () { return api.reviewSubmission(A.token, v.id, { decision: "accept", note: $("vn-" + v.id).value.trim() || undefined, roadLegal: $("vr-" + v.id).checked, verified: rf }); }, "Published to the vault"); vVault(m); }; });
  m.querySelectorAll(".vRej").forEach(function (b) { b.onclick = async function () { var id = b.dataset.id; await run(function () { return api.reviewSubmission(A.token, id, { decision: "reject", note: $("vn-" + id).value.trim() }); }, "Rejected"); vVault(m); }; });
  m.querySelectorAll(".vNote").forEach(function (b) { b.onclick = async function () { var id = b.dataset.id; if (!$("vn-" + id).value.trim()) { toast("Write the note first"); return; } await run(function () { return api.reviewSubmission(A.token, id, { decision: "note", note: $("vn-" + id).value.trim() }); }, "Note added"); vVault(m); }; });
}

/* ---- presets and catalogue ---- */
async function vCatalog(m) {
  var ov = await api.listPresetOverrides(A.token), makes = 0; Object.keys(MAKE_MODELS).forEach(function (c) { Object.keys(MAKE_MODELS[c]).forEach(function (mk) { makes += MAKE_MODELS[c][mk].length; }); });
  m.innerHTML = '<h1>Tunes, presets and catalogue</h1>' + demoNote() + '<div class="panel"><h3>Presets</h3><p class="small muted">Names, descriptions and visibility can be edited here; the values are the shipped tune targets (edit them in mobile/src/tune/presets.ts so the tests cover them). Edits are stored as overrides.</p><div class="tbl"><table><tr><th>Preset</th><th>Level</th><th class="hide-m">Feel</th><th></th></tr>' +
    FL.orderedPresets().map(function (p) { var o = ov[p.id] || {}; return '<tr><td><b>' + esc(o.name || p.name) + "</b>" + (o.hidden ? ' <span class="badge b-warn">hidden</span>' : "") + (o.updatedAt ? '<br><span class="small muted">edited by ' + esc(o.by) + "</span>" : "") + "</td><td>" + lvlTag(FL.presetLevel(p, "turbo_petrol")) + '</td><td class="hide-m small">' + esc(o.feel || p.feel) + '</td><td>' + (can("presets.edit") ? '<button class="ghost pEd" data-id="' + p.id + '">Edit</button>' : "") + "</td></tr>"; }).join("") + "</table></div></div>" +
    '<div class="panel"><h3>Vehicle catalogue</h3><p>' + Object.keys(MAKE_MODELS).map(function (c) { return "<b>" + esc(c) + "</b>: " + Object.keys(MAKE_MODELS[c]).length + " makes"; }).join(" · ") + " · " + makes + ' models in total.</p><p class="small muted">Packages: ' + E.PACKAGES.map(function (p) { return esc(p.name) + " (" + p.includes.join(", ") + ")"; }).join(" · ") + "</p></div>" +
    '<div class="panel"><h3>ECU list (' + E.ECU_PROFILES.length + ')</h3><div class="tbl"><table><tr><th>ECU</th><th>Protocol</th><th>Status</th><th class="hide-m">Used by</th></tr>' + E.ECU_PROFILES.map(function (p) { return "<tr><td><b>" + esc(p.manufacturer) + "</b> " + esc(p.family) + '</td><td class="mono small">' + esc(p.protocol || "") + '</td><td><span class="badge ' + (p.status === "supported" ? "b-ok" : p.status === "oem-only" ? "b-fail" : "b-warn") + '">' + esc(p.status) + '</span></td><td class="hide-m small">' + esc((p.usedBy || []).join(", ")) + "</td></tr>"; }).join("") + "</table></div></div>";
  m.querySelectorAll(".pEd").forEach(function (b) { b.onclick = function () { var p = P.PRESETS.find(function (x) { return x.id === b.dataset.id; }), o = ov[p.id] || {};
    drawer("<h2>Edit " + esc(p.name) + '</h2><div class="panel"><label for="pN">Name</label><input id="pN" value="' + esc(o.name || p.name) + '"><label for="pF">Feel</label><textarea id="pF">' + esc(o.feel || p.feel) + '</textarea><label style="font-weight:600"><input type="checkbox" id="pH"' + (o.hidden ? " checked" : "") + '> Hide from customers</label><div class="row" style="margin-top:10px"><button class="primary" id="pGo">Save</button></div></div><div class="panel"><h3>Values (turbo petrol)</h3><p class="small mono">' + esc(JSON.stringify(P.presetValues(p, "turbo_petrol"))) + "</p></div>");
    $("pGo").onclick = async function () { await run(function () { return api.savePreset(A.token, p.id, { name: $("pN").value, feel: $("pF").value, hidden: $("pH").checked }); }, "Saved"); closeDrawer(); vCatalog(m); }; }; });
}

/* ---- audit ---- */
async function vAudit(m) {
  var q = A.auditQ || "", list = await api.listAudit(A.token, q);
  m.innerHTML = '<h1>Audit log</h1><p class="muted">Every admin action, sign-in (and failed sign-in), redemption and help session. Passwords and temporary passwords are never written here.</p><div class="panel"><label for="aQ">Filter</label><input id="aQ" value="' + esc(q) + '" placeholder="e.g. comp, help, shazza"></div><div class="panel tbl"><table><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th class="hide-m">Detail</th></tr>' +
    list.map(function (a) { return '<tr><td class="small">' + new Date(a.at).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + "</td><td>" + esc(a.actor) + (a.role ? ' <span class="small muted">' + esc(a.role) + "</span>" : "") + '</td><td class="mono small">' + esc(a.action) + "</td><td>" + esc(a.target) + '</td><td class="hide-m small">' + esc(a.detail) + "</td></tr>"; }).join("") + "</table></div>";
  var t; $("aQ").oninput = function () { clearTimeout(t); var v = this.value; t = setTimeout(function () { A.auditQ = v; vAudit(m).then(function () { $("aQ").focus(); }); }, 300); };
}

/* ---- staff (owner) ---- */
async function vStaff(m) {
  var staff = (await api.listUsers(A.token, "")).filter(function (u) { return u.role !== "customer"; });
  m.innerHTML = '<h1>Staff</h1><div class="panel"><h3>Add staff</h3><p class="small muted"><b>Admin</b>: everything except staff accounts. <b>Support</b>: view users and orders, remote help (chat and suggest), stats.</p><div class="form2"><div><label for="stN">Name</label><input id="stN"></div><div><label for="stE">Email</label><input id="stE" type="email"></div><div><label for="stR">Role</label><select id="stR"><option value="support">Support</option><option value="admin">Admin</option></select></div></div><div class="row" style="margin-top:12px"><button class="primary" id="stGo">Add</button></div><div id="stOut"></div></div>' +
    '<div class="panel tbl"><table><tr><th>Status</th><th>Name</th><th>Role</th><th>Last seen</th></tr>' + staff.map(function (u) { return '<tr class="click" data-id="' + u.id + '"><td>' + (u.status === "suspended" ? '<span class="badge b-fail">Suspended</span>' : '<span class="badge b-ok">Active</span>') + "</td><td>" + esc(u.name) + '<br><span class="small muted">' + esc(u.email) + '</span></td><td><span class="badge b-info">' + esc(u.role) + "</span></td><td>" + when(u.lastActive) + "</td></tr>"; }).join("") + "</table></div>" +
    '<div class="panel"><h3>Change my password</h3><div class="form2"><div><label for="cpO">Current</label><input id="cpO" type="password" autocomplete="current-password"></div><div><label for="cpN">New (10+ characters)</label><input id="cpN" type="password" autocomplete="new-password"></div></div><div class="row" style="margin-top:10px"><button class="btn" id="cpGo">Change password</button></div></div>';
  $("stGo").onclick = async function () { var r = await run(function () { return api.createStaff(A.token, { name: $("stN").value, email: $("stE").value, role: $("stR").value }); }); await vStaff(m); $("stOut").innerHTML = '<p class="small" style="margin-top:10px">Temporary password for ' + esc(r.user.email) + ", shown once:</p><div class=\"secret\">" + esc(r.tempPassword) + "</div>"; };
  $("cpGo").onclick = async function () { await run(function () { return api.changePassword(A.token, $("cpO").value, $("cpN").value); }, "Password changed"); };
  m.querySelectorAll("tr[data-id]").forEach(function (r) { r.onclick = function () { openUser(r.dataset.id); }; });
}

window.addEventListener("unhandledrejection", function (e) { if (e.reason && e.reason.code) e.preventDefault(); }); /* already shown as a toast by run() */
start().catch(function (e) { $("root").innerHTML = '<div class="login panel"><h1>Can\u2019t reach the admin store</h1><p>' + esc(e.message) + '</p><p class="small muted">Using a server? Check the address, or open with ?api=local for the demo store.</p></div>'; });

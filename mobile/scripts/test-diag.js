// Electrical diagnostics calculators: shared vectors (same file the Python
// tests use), fuse table sanity, decision trees, DTC descriptions, report.
const a = require("assert");
const fs = require("fs");
const path = require("path");
const D = require("./diag/electrical");
const F = require("./diag/fuses");
const W = require("./diag/workflow");
const I = require("./diag/dtcInfo");
const R = require("./diag/report");
let n = 0; const eq = (x, y, m) => { a.deepStrictEqual(x, y, m); n++; }; const ok = (v, m) => { a.ok(v, m); n++; };

const repo = process.env.CARTUNE_REPO || path.resolve(__dirname, "..", "..");
const { vectors } = JSON.parse(fs.readFileSync(path.join(repo, "mock_data", "diag_test_vectors.json"), "utf8"));
ok(vectors.length >= 60);
for (const v of vectors) {
  const r = D[v.fn](v.args);
  for (const [k, want] of Object.entries(v.expect)) {
    const got = r[k];
    if (typeof want === "number") ok(Math.abs(got - want) < 1e-6, `${v.fn} ${JSON.stringify(v.args)} ${k}: got ${got}, want ${want}`);
    else eq(got, want, `${v.fn} ${JSON.stringify(v.args)} ${k}`);
  }
  ok(typeof r.message === "string" && r.message.length > 10);
}

// bad input is rejected, not silently scored
a.throws(() => D.voltageDrop({ reading: NaN, circuit: "ground" })); n++;
a.throws(() => D.voltageDrop({ reading: 0.1, circuit: "nope" })); n++;
a.throws(() => D.fuseDropCurrent({ millivolts: 1, type: "ato", rating: "999" })); n++;

// fuse tables: resistance falls as the rating rises; mV/mΩ = A
for (const type of Object.keys(F.DEFAULT_FUSE_RESISTANCE_MOHM)) {
  const rs = F.fuseRatings(type).map((k) => F.DEFAULT_FUSE_RESISTANCE_MOHM[type][k]);
  for (let i = 1; i < rs.length; i++) ok(rs[i] < rs[i - 1], `${type} resistance should decrease with rating`);
}
eq(D.fuseDropCurrent({ millivolts: 7.7, type: "ato", rating: 10 }).milliamps, 1000);

// temperature-corrected cranking minimum
eq(D.crankingMinVoltage(25), 9.6); eq(D.crankingMinVoltage(0), 9.1); eq(D.crankingMinVoltage(-30), 8.5); eq(D.crankingMinVoltage(undefined), 9.6);

// decision trees are well formed and every path ends in a finding
for (const t of W.FAULT_TREES) {
  for (const node of Object.values(t.nodes)) {
    if (node.finding) ok(!node.yes && !node.no, `${t.id}/${node.id} leaf`);
    else { ok(t.nodes[node.yes] && t.nodes[node.no], `${t.id}/${node.id} branches exist`); }
  }
  const walkAll = (ans) => { const r = W.walkTree(t, ans); if (r.node.finding) return 1; return walkAll([...ans, "yes"]) + walkAll([...ans, "no"]); };
  ok(walkAll([]) >= 2);
}
eq(["open", "short_ground", "short_power", "high_resistance", "intermittent"].every((id) => W.FAULT_TREES.some((t) => t.id === id)), true);
eq(W.walkTree(W.FAULT_TREES[0], ["yes", "yes"]).node.id, "o3");
ok(W.WORKFLOW_STEPS.length >= 8);
ok(W.SAFETY_NOTES.some((s) => /airbag/i.test(s.title + s.body)) && W.SAFETY_NOTES.some((s) => /orange/i.test(s.body)));

// DTC descriptions
eq(I.describeDtc("P0171").description, "System too lean (Bank 1)");
eq(I.describeDtc("p0304").description, "Cylinder 4 misfire detected");
ok(/manufacturer-specific/.test(I.describeDtc("P1234").description));
ok(/generic/.test(I.describeDtc("P0999").description));
eq(I.describeDtc("U0100").known, true);
eq(I.isGeneric("B1000"), false); eq(I.isGeneric("P3400"), true); eq(I.isGeneric("P3000"), false);

// report
const s = R.newSession({ title: "Demo car", vin: "1G1ZE5ST9HF123456" }, { mode: "demo" }, new Date("2026-01-01T00:00:00Z"));
s.dtcs = { stored: ["P0171"], pending: ["P0300"], permanent: [] };
s.checklist.verify = { done: true, note: "Rough idle when cold" };
s.tests.push({ tool: "voltage_drop", label: "Engine ground <script>", inputs: { reading: 0.35 }, status: "fail", message: "x", at: "2026-01-01T00:00:00Z" });
const js = R.buildReportJson(s);
eq(js.summary.counts.fail, 1); eq(js.summary.stepsDone, 1); eq(js.dtc_details.length, 2);
const html = R.buildReportHtml(s);
ok(html.includes("P0171") && html.includes("System too lean") && html.includes("Demo data"));
ok(!html.includes("<script>") && html.includes("&lt;script&gt;"), "report HTML is escaped");
console.log(`DIAG TESTS PASSED — ${n} checks passed`);

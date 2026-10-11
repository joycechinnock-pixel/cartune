/**
 * Diagnostic session record + report builders (JSON and printable HTML).
 * The browser app prints the HTML to PDF; the mobile app can share either.
 */
import { WORKFLOW_STEPS, SAFETY_NOTES } from "./workflow";
import { describeDtc } from "./dtcInfo";
import { GUIDELINE_NOTE, Status } from "./electrical";

export interface TestEntry {
  tool: string;          // e.g. "voltage_drop", "battery_soc", "fuse_drop"
  label: string;         // human label, e.g. "Headlamp ground side"
  inputs: Record<string, unknown>;
  status: Status;
  message: string;
  at: string;            // ISO timestamp
}

export interface DiagSession {
  vehicle: { title?: string; vin?: string | null; ecu?: string; osId?: string | null };
  adapter: { mode: "demo" | "serial" | "ble" | "none"; id?: string | null; protocol?: string | null };
  complaint?: string;
  checklist: Record<string, { done: boolean; note?: string }>;
  notes?: string;
  dtcs?: { stored: string[]; pending: string[]; permanent: string[] } | null;
  freezeFrame?: { dtc: string | null; values: Record<string, number> } | null;
  tests: TestEntry[];
  liveLog?: { rows: number; keys: string[]; startedAt?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function newSession(vehicle: DiagSession["vehicle"], adapter: DiagSession["adapter"], now = new Date()): DiagSession {
  const iso = now.toISOString();
  return { vehicle, adapter, checklist: {}, tests: [], createdAt: iso, updatedAt: iso, dtcs: null, freezeFrame: null, liveLog: null };
}

export function summarize(s: DiagSession) {
  const counts: Record<Status, number> = { pass: 0, warn: 0, fail: 0, info: 0 };
  s.tests.forEach((t) => { counts[t.status] = (counts[t.status] ?? 0) + 1; });
  const stepsDone = WORKFLOW_STEPS.filter((st) => s.checklist[st.id]?.done).length;
  const allCodes = s.dtcs ? [...new Set([...s.dtcs.stored, ...s.dtcs.pending, ...s.dtcs.permanent])] : [];
  return { counts, stepsDone, stepsTotal: WORKFLOW_STEPS.length, codes: allCodes.length };
}

export function buildReportJson(s: DiagSession) {
  return {
    generated_by: "CarTune Diagnostics",
    generated_at: new Date().toISOString(),
    disclaimer: GUIDELINE_NOTE,
    summary: summarize(s),
    session: s,
    dtc_details: s.dtcs
      ? (["stored", "pending", "permanent"] as const).flatMap((k) => s.dtcs![k].map((c) => ({ ...describeDtc(c), status: k })))
      : [],
  };
}

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" } as Record<string, string>)[c]);
const COLORS: Record<Status, string> = { pass: "#1f8f52", warn: "#b58a00", fail: "#c0392b", info: "#4a6b8a" };

export function buildReportHtml(s: DiagSession): string {
  const sum = summarize(s);
  const badge = (st: Status) => `<span class="b" style="background:${COLORS[st]}">${st.toUpperCase()}</span>`;
  const dtcRows = s.dtcs
    ? (["stored", "pending", "permanent"] as const).flatMap((k) => s.dtcs![k].map((c) => {
        const d = describeDtc(c);
        return `<tr><td><b>${esc(d.code)}</b></td><td>${esc(k)}</td><td>${esc(d.description)}</td></tr>`;
      })).join("")
    : "";
  const ff = s.freezeFrame && s.freezeFrame.dtc
    ? `<p>Freeze frame stored by <b>${esc(s.freezeFrame.dtc)}</b></p><table><tr><th>PID</th><th>Value</th></tr>${Object.entries(s.freezeFrame.values).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(Math.round(v * 100) / 100)}</td></tr>`).join("")}</table>`
    : "<p class='m'>No freeze frame recorded.</p>";
  const steps = WORKFLOW_STEPS.map((st) => {
    const c = s.checklist[st.id];
    return `<tr><td>${c?.done ? "☑" : "☐"}</td><td><b>${esc(st.title)}</b>${c?.note ? `<br><span class="m">${esc(c.note)}</span>` : ""}</td></tr>`;
  }).join("");
  const tests = s.tests.map((t) => `<tr><td>${badge(t.status)}</td><td><b>${esc(t.label)}</b><br><span class="m">${esc(t.tool)} · ${esc(new Date(t.at).toLocaleString())}</span></td><td>${esc(Object.entries(t.inputs).map(([k, v]) => `${k}: ${v}`).join(", "))}</td><td>${esc(t.message)}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CarTune diagnostic report ${esc(s.vehicle.vin ?? "")}</title>
<style>body{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a222b;margin:24px;max-width:960px}h1{margin:0 0 4px}h2{margin:22px 0 6px;border-bottom:2px solid #d5dbe2;padding-bottom:3px}
table{border-collapse:collapse;width:100%;margin:6px 0}td,th{border:1px solid #d5dbe2;padding:5px 7px;text-align:left;vertical-align:top}th{background:#eef1f4}.m{color:#5c6874}.b{color:#fff;border-radius:5px;padding:1px 7px;font-weight:700;font-size:12px}
.note{background:#fff6e0;border-left:4px solid #b58a00;padding:8px 10px;margin:10px 0}.danger{background:#fdecea;border-left-color:#c0392b}@media print{button{display:none}body{margin:0}}</style></head><body>
<button onclick="print()" style="float:right;padding:8px 14px">Print / Save as PDF</button>
<h1>Vehicle electrical diagnostic report</h1>
<p class="m">Generated ${esc(new Date().toLocaleString())} by CarTune Diagnostics · session started ${esc(new Date(s.createdAt).toLocaleString())}</p>
<table><tr><th>Vehicle</th><td>${esc(s.vehicle.title ?? "—")}</td><th>VIN</th><td>${esc(s.vehicle.vin ?? "—")}</td></tr>
<tr><th>ECU</th><td>${esc(s.vehicle.ecu ?? "—")}</td><th>Adapter</th><td>${esc(s.adapter.mode === "demo" ? "DEMO (simulated — not a real vehicle)" : s.adapter.mode)}${s.adapter.id ? " · " + esc(s.adapter.id) : ""}${s.adapter.protocol ? " · " + esc(s.adapter.protocol) : ""}</td></tr></table>
${s.adapter.mode === "demo" ? `<div class="note danger"><b>Demo data.</b> This report was produced with the simulated adapter; codes and live values are not from a real vehicle.</div>` : ""}
<h2>Complaint</h2><p>${esc(s.complaint || "—")}</p>
<h2>Summary</h2><p>${sum.counts.pass} pass · ${sum.counts.warn} warn · ${sum.counts.fail} fail · ${sum.counts.info} info — workflow ${sum.stepsDone}/${sum.stepsTotal} steps — ${sum.codes} trouble code(s)</p>
<h2>Workflow</h2><table>${steps}</table>
<h2>Trouble codes</h2>${dtcRows ? `<table><tr><th>Code</th><th>Status</th><th>Description</th></tr>${dtcRows}</table>` : "<p class='m'>No codes read in this session.</p>"}
<h2>Freeze frame</h2>${ff}
<h2>Tests</h2>${tests ? `<table><tr><th></th><th>Test</th><th>Inputs</th><th>Result</th></tr>${tests}</table>` : "<p class='m'>No tests recorded.</p>"}
${s.liveLog && s.liveLog.rows ? `<h2>Live data log</h2><p>${s.liveLog.rows} samples of ${esc(s.liveLog.keys.join(", "))} (export the CSV from the app for the full log).</p>` : ""}
<h2>Notes</h2><p>${esc(s.notes || "—").replace(/\n/g, "<br>")}</p>
<div class="note"><b>Thresholds are general guidelines.</b> ${esc(GUIDELINE_NOTE)}</div>
<h2>Safety</h2><ul>${SAFETY_NOTES.filter((n) => n.level === "danger").map((n) => `<li><b>${esc(n.title)}:</b> ${esc(n.body)}</li>`).join("")}</ul>
</body></html>`;
}

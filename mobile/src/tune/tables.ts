/**
 * Pro table editor data: the full calibration tables for an ECU family,
 * shown at the "Technically" level as open, cell-by-cell editable maps.
 *
 * Source of truth for the Ford Spanish Oak (Barra) list is the user's own
 * HP Tuners VCM Editor session (OS-ID HACCKG6). Each table records where it
 * came from:
 *   file      — seen in that tune file (name and, where noted, real value)
 *   platform  — standard table on this PCM family; confirm against your file
 *
 * Tables transcribed from that file carry `realData` (every cell as read).
 * On a real car the cell values come from the stock read decoded through the
 * ECU family's definition. Until a definition is loaded, `demoData()` fills
 * the grid with a realistic-shaped placeholder and the UI labels it DEMO.
 */

export type Provenance = "file" | "platform";
export type Category = "Fuel" | "Spark" | "Knock" | "Torque model" | "Airflow & Boost" | "Limits & Protection" | "Idle" | "Cooling" | "Driver demand";

export interface Axis { name: string; unit: string; values: number[]; }
export interface TableDef {
  id: string;
  name: string;
  category: Category;
  unit: string;
  decimals: number;
  provenance: Provenance;
  realValue?: number;                 // a value actually read from the file (scalars)
  realData?: number[][];              // full grid actually read from the file
  hpId?: number;                      // HP Tuners table id, for cross-reference
  desc?: string;
  note?: string;
  turboOnly?: boolean;
  rows?: Axis;                        // omitted => scalar or 1-D
  cols?: Axis;                        // omitted => scalar
  min: number; max: number;           // hard cell limits (editor clamps)
  demo: (r: number, c: number, rows: number[], cols: number[]) => number;
  check?: (value: number, r: number, c: number, ctx: TableCheckContext) => CellFlag | null;
}
export interface CellFlag { level: "yellow" | "orange" | "red"; note: string; }
export interface TableCheckContext { all: Record<string, number[][]>; turbo: boolean; }

import { BARRA_TABLES, BARRA_SETTINGS, RealSetting } from "./barraData";

export const SETTINGS_SETS: Record<string, RealSetting[]> = { "ford-spanish-oak": BARRA_SETTINGS };
export function settingsListFor(ecuId: string): RealSetting[] { return SETTINGS_SETS[ecuId] ?? []; }

const RPM = [800, 1200, 1600, 2000, 2400, 2800, 3200, 3600, 4000, 4400, 4800, 5200, 5600, 6000, 6400];
const LOAD = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.4];
const ECT = [-20, 0, 20, 40, 60, 80, 90, 100, 110, 120];
const IAT = [-10, 10, 25, 40, 55, 70, 85];
const CYL = [1, 2, 3, 4, 5, 6];
const VOLT = [9, 10, 11, 12, 13, 14, 15, 16];
const PEDAL = [0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export const SPANISH_OAK_TABLES: TableDef[] = [
  // ---------- Fuel ----------
  { id: "pe_lambda", name: "Power enrichment lambda", category: "Fuel", unit: "λ", decimals: 3, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, min: 0.6, max: 1.05,
    demo: (r) => +(0.88 - Math.min(0.08, r * 0.008)).toFixed(3),
    check: (v, _r, _c, x) => (x.turbo ? (v > 0.84 ? { level: v > 0.87 ? "red" : "orange", note: "Lean for boost at WOT" } : null) : v > 0.9 ? { level: v > 0.93 ? "red" : "orange", note: "Lean at WOT" } : null) },
  { id: "ol_lambda", name: "Open-loop lambda", category: "Fuel", unit: "λ", decimals: 3, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, cols: { name: "Load", unit: "g/rev norm.", values: LOAD }, min: 0.6, max: 1.15,
    demo: (r, c) => +(c < 7 ? 1.0 : 1.0 - (c - 6) * 0.025 - r * 0.002).toFixed(3),
    check: (v, _r, c) => (c >= 9 && v > 0.9 ? { level: v > 0.95 ? "red" : "orange", note: "Lean at high load" } : null) },
  { id: "inj_offset", name: "Injector offset vs battery voltage", category: "Fuel", unit: "ms", decimals: 3, provenance: "platform",
    rows: { name: "Battery", unit: "V", values: VOLT }, min: 0, max: 3, demo: (r) => +(1.6 - r * 0.15).toFixed(3) },
  { id: "warmup_enrich", name: "Warm-up enrichment", category: "Fuel", unit: "%", decimals: 1, provenance: "platform",
    rows: { name: "Coolant", unit: "°C", values: ECT }, min: 0, max: 80, demo: (r) => Math.max(0, 40 - r * 6) },
  // ---------- Spark ----------
  { id: "spark_base", name: "Base spark advance", category: "Spark", unit: "°BTDC", decimals: 1, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, cols: { name: "Load", unit: "g/rev norm.", values: LOAD }, min: -10, max: 50,
    demo: (r, c) => +(Math.min(42, 14 + r * 1.6) - c * 2.1).toFixed(1),
    check: (v, r, c, x) => { const bl = x.all.spark_border?.[r]?.[c]; if (bl === undefined) return null; const d = v - bl;
      return d > 2 ? { level: "red", note: `${d.toFixed(1)}° past borderline knock` } : d > 0.5 ? { level: "orange", note: `${d.toFixed(1)}° past borderline` } : d > -0.5 ? { level: "yellow", note: "At borderline knock" } : null; } },
  { id: "spark_border", name: "Borderline knock spark", category: "Spark", unit: "°BTDC", decimals: 1, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, cols: { name: "Load", unit: "g/rev norm.", values: LOAD }, min: -10, max: 50,
    demo: (r, c) => +(Math.min(44, 16 + r * 1.6) - c * 2.0).toFixed(1) },
  { id: "spark_iat", name: "IAT spark correction", category: "Spark", unit: "°", decimals: 1, provenance: "platform",
    rows: { name: "Intake air", unit: "°C", values: IAT }, min: -15, max: 5, demo: (r) => (r < 3 ? 0 : -(r - 2) * 1.5) },
  { id: "spark_ect", name: "Coolant spark correction", category: "Spark", unit: "°", decimals: 1, provenance: "platform",
    rows: { name: "Coolant", unit: "°C", values: ECT }, min: -15, max: 10, demo: (r) => (r > 7 ? -(r - 7) * 2 : r < 3 ? 3 - r : 0) },
  // ---------- Knock (seen in the file) ----------
  { id: "knock_retard_max", name: "Maximum knock retard", category: "Knock", unit: "°", decimals: 1, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, min: 0, max: 20, demo: () => 8,
    check: (v) => (v < 4 ? { level: "orange", note: "Low authority to pull timing when knocking" } : null) },
  // ---------- Airflow & boost ----------
  { id: "maf_transfer", name: "MAF transfer function", category: "Airflow & Boost", unit: "g/s", decimals: 1, provenance: "platform",
    rows: { name: "MAF frequency", unit: "Hz", values: [1500, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000] },
    min: 0, max: 600, demo: (r) => +(3 * Math.pow(1.45, r)).toFixed(1) },
  { id: "boost_target", name: "Boost target", category: "Airflow & Boost", unit: "kPa", decimals: 0, provenance: "platform", turboOnly: true,
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, min: 90, max: 350, demo: (r) => (r < 3 ? 110 + r * 15 : 170) },
  { id: "wg_duty", name: "Wastegate base duty", category: "Airflow & Boost", unit: "%", decimals: 0, provenance: "platform", turboOnly: true,
    rows: { name: "Engine speed", unit: "rpm", values: RPM }, cols: { name: "Boost target", unit: "kPa", values: [120, 140, 160, 180, 200, 220, 240, 260] },
    min: 0, max: 100, demo: (r, c) => Math.min(95, Math.round(15 + c * 9 - r * 1.5)) },
  // ---------- Limits & protection (seen in the file) ----------
  { id: "speed_limit", name: "Vehicle speed limiter", category: "Limits & Protection", unit: "km/h", decimals: 0, provenance: "platform",
    note: "Keep within your tyres' speed rating.", min: 40, max: 320, demo: () => 250 },
  { id: "torque_limit_tbl", name: "Engine torque limit", category: "Limits & Protection", unit: "Nm", decimals: 0, provenance: "platform",
    rows: { name: "Gear", unit: "", values: [1, 2, 3, 4, 5, 6] }, min: 0, max: 1500, demo: (r) => (r === 0 ? 420 : 500) },
  // ---------- Driver demand ----------
  { id: "driver_demand", name: "Driver demand torque", category: "Driver demand", unit: "%", decimals: 0, provenance: "platform",
    rows: { name: "Engine speed", unit: "rpm", values: RPM.slice(0, 12) }, cols: { name: "Pedal", unit: "%", values: PEDAL },
    min: 0, max: 100, demo: (r, c) => Math.round(Math.pow(PEDAL[c] / 100, 1.35) * 100) },
  // ---------- Idle ----------
  { id: "idle_target", name: "Idle target vs coolant", category: "Idle", unit: "rpm", decimals: 0, provenance: "platform",
    rows: { name: "Coolant", unit: "°C", values: ECT }, min: 400, max: 2000, demo: (r) => Math.max(650, 1300 - r * 90) },
  // ---------- Cooling ----------
];

/** Real tables from the HACCKG6 file, as editable TableDefs. */
export const SPANISH_OAK_REAL: TableDef[] = BARRA_TABLES.map((t): TableDef => {
  const flat = t.data.flat();
  const lo = Math.min(...flat), hi = Math.max(...flat), span = Math.max(1, hi - lo);
  return {
    id: t.id, hpId: t.hpId, name: t.name, category: t.category as Category, unit: t.unit, decimals: t.decimals,
    provenance: "file" as Provenance, realData: t.data, desc: t.desc ?? undefined,
    note: [t.desc, t.note].filter(Boolean).join(" ") || undefined,
    rows: { ...t.rows, unit: "" }, cols: t.cols ? { ...t.cols, unit: "" } : undefined,
    min: Math.min(0, lo - span), max: hi + span * 2,
    demo: (r: number, c: number) => t.data[r][c],
  };
});

export const TABLE_SETS: Record<string, TableDef[]> = { "ford-spanish-oak": [...SPANISH_OAK_REAL, ...SPANISH_OAK_TABLES] };

export function tablesFor(ecuId: string, turbo: boolean): TableDef[] {
  return (TABLE_SETS[ecuId] ?? []).filter((t) => turbo || !t.turboOnly);
}

export function shape(t: TableDef): { rows: number; cols: number } {
  return { rows: t.rows?.values.length ?? 1, cols: t.cols?.values.length ?? 1 };
}

export function demoData(t: TableDef): number[][] {
  const { rows, cols } = shape(t);
  const rv = t.rows?.values ?? [0], cv = t.cols?.values ?? [0];
  if (t.realData) return t.realData.map((row) => row.slice());
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => t.realValue ?? t.demo(r, c, rv, cv)));
}

// ---------- editing operations (pure; return a new grid) ----------
export type Sel = { r0: number; c0: number; r1: number; c1: number };
const inSel = (s: Sel, r: number, c: number) => r >= Math.min(s.r0, s.r1) && r <= Math.max(s.r0, s.r1) && c >= Math.min(s.c0, s.c1) && c <= Math.max(s.c0, s.c1);
const round = (v: number, d: number) => +v.toFixed(d);
const clampT = (t: TableDef, v: number) => round(Math.min(t.max, Math.max(t.min, v)), t.decimals);

export function mapSel(t: TableDef, g: number[][], s: Sel, fn: (v: number, r: number, c: number) => number): number[][] {
  return g.map((row, r) => row.map((v, c) => (inSel(s, r, c) ? clampT(t, fn(v, r, c)) : v)));
}
export const addSel = (t: TableDef, g: number[][], s: Sel, d: number) => mapSel(t, g, s, (v) => v + d);
export const scaleSel = (t: TableDef, g: number[][], s: Sel, pct: number) => mapSel(t, g, s, (v) => v * (1 + pct / 100));
export const setSel = (t: TableDef, g: number[][], s: Sel, x: number) => mapSel(t, g, s, () => x);

/** 3×3 average inside the selection (edges use available neighbours). */
export function smoothSel(t: TableDef, g: number[][], s: Sel): number[][] {
  return mapSel(t, g, s, (_v, r, c) => {
    let sum = 0, n = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const x = g[r + dr]?.[c + dc];
      if (x !== undefined) { sum += x; n++; }
    }
    return sum / n;
  });
}

/** Bilinear fill between the four corners of the selection. */
export function interpolateSel(t: TableDef, g: number[][], s: Sel): number[][] {
  const r0 = Math.min(s.r0, s.r1), r1 = Math.max(s.r0, s.r1), c0 = Math.min(s.c0, s.c1), c1 = Math.max(s.c0, s.c1);
  const q = (r: number, c: number) => g[r][c];
  return mapSel(t, g, s, (_v, r, c) => {
    const fr = r1 === r0 ? 0 : (r - r0) / (r1 - r0), fc = c1 === c0 ? 0 : (c - c0) / (c1 - c0);
    const top = q(r0, c0) * (1 - fc) + q(r0, c1) * fc, bot = q(r1, c0) * (1 - fc) + q(r1, c1) * fc;
    return top * (1 - fr) + bot * fr;
  });
}

export function checkTable(t: TableDef, g: number[][], ctx: TableCheckContext): (CellFlag | null)[][] {
  return g.map((row, r) => row.map((v, c) => (t.check ? t.check(v, r, c, ctx) : null)));
}

export function diffCount(a: number[][], b: number[][]): number {
  let n = 0; a.forEach((row, r) => row.forEach((v, c) => { if (v !== b[r][c]) n++; })); return n;
}

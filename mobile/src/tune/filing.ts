// Preset order, permission levels and auto-filing of user-made tunes.
//
// Rule: a user tune is filed under the preset it is closest to in
// performance, BUT only among presets whose permission level allows every
// restriction the tune lifts. Permission always wins over performance, so a
// factory-like tune with any safety or restriction lifted can never be filed
// under Factory.

import { EngineType, Values, isOn, rangeFor, settingsFor, stockValues, togglesFor } from "./rules";
import { PRESETS, Preset, presetValues } from "./presets";

/** 0 Factory · 1 Road · 2 Sport · 3 Competition / Off-road. */
export type PermLevel = 0 | 1 | 2 | 3;
export const PERM_NAME: Record<PermLevel, string> = { 0: "Factory", 1: "Road", 2: "Sport", 3: "Competition and off-road" };

const TIER: Record<string, PermLevel> = {
  factory: 0,
  economical: 1, comfort: 1, highway: 1, day: 1,
  handling: 2, sport: 2,
  offroad: 3, burnout: 3, holeshot: 3, race: 3,
};

/** Presets in display order: by permission tier, then by power within a tier. */
export const PRESET_ORDER: string[] = ["factory", "economical", "comfort", "highway", "day", "handling", "sport", "offroad", "burnout", "holeshot", "race"];

export function orderedPresets(): Preset[] {
  return PRESET_ORDER.map((id) => PRESETS.find((p) => p.id === id)).filter((p): p is Preset => !!p);
}

interface Restriction { id: string; level: PermLevel; label: string; lifted: (v: Values, s: Values) => boolean; }
const off = (id: string) => (v: Values) => v[id] !== undefined && v[id] < 0.5;
const on = (id: string) => (v: Values) => v[id] !== undefined && v[id] >= 0.5;
const above = (id: string) => (v: Values, s: Values) => (v[id] ?? 0) > (s[id] ?? 0) + 1e-9;
const moved = (id: string) => (v: Values, s: Values) => Math.abs((v[id] ?? 0) - (s[id] ?? 0)) > 1e-9;

/** Anything that lifts a factory safety system, protection or restriction. */
export const RESTRICTIONS: Restriction[] = [
  // Sport level: limits raised, protections loosened
  { id: "t_speed_lim", level: 2, label: "Top-speed limiter off", lifted: off("t_speed_lim") },
  { id: "rev_add", level: 2, label: "Rev limit raised", lifted: above("rev_add") },
  { id: "t_auto_upshift", level: 2, label: "Auto upshift at redline off", lifted: off("t_auto_upshift") },
  { id: "tc_slip", level: 2, label: "More wheel slip allowed", lifted: above("tc_slip") },
  { id: "esc_thresh", level: 2, label: "Stability control later", lifted: above("esc_thresh") },
  { id: "knock_sens", level: 2, label: "Knock sensitivity reduced", lifted: above("knock_sens") },
  { id: "t_launch", level: 2, label: "Launch control on", lifted: on("t_launch") },
  { id: "t_flatshift", level: 2, label: "Flat-foot shift on", lifted: on("t_flatshift") },
  // Competition / off-road level: safety systems and protections off, emissions changes
  { id: "t_knock", level: 3, label: "Knock sensors off", lifted: off("t_knock") },
  { id: "t_overboost", level: 3, label: "Overboost protection off", lifted: off("t_overboost") },
  { id: "t_closed_loop", level: 3, label: "Closed-loop fuelling off", lifted: off("t_closed_loop") },
  { id: "overtemp", level: 3, label: "Over-temp protection raised", lifted: above("overtemp") },
  { id: "t_tc", level: 3, label: "Traction control off", lifted: off("t_tc") },
  { id: "t_esc", level: 3, label: "Stability control off", lifted: off("t_esc") },
  { id: "t_abs", level: 3, label: "ABS off", lifted: off("t_abs") },
  { id: "abs_slip", level: 3, label: "ABS slip target changed", lifted: moved("abs_slip") },
  { id: "t_brake_override", level: 3, label: "Brake-throttle override off", lifted: off("t_brake_override") },
  { id: "brake_override", level: 3, label: "Brake override delayed", lifted: above("brake_override") },
  { id: "t_antilag", level: 3, label: "Anti-lag on", lifted: on("t_antilag") },
  { id: "t_popsbangs", level: 3, label: "Pops and crackles on", lifted: on("t_popsbangs") },
  ...["t_egr", "t_dpf", "t_scr", "t_swirl", "t_cat_mon", "t_rear_o2", "t_evap"].map((id) => ({
    id, level: 3 as PermLevel, label: "Emissions system changed", lifted: (v: Values, s: Values) => v[id] !== undefined && s[id] !== undefined && (v[id] >= 0.5) !== (s[id] >= 0.5),
  })),
];

/** Highest permission level this tune needs, and why. */
export function restrictionsOf(engine: EngineType, values: Values): { level: PermLevel; reasons: { label: string; level: PermLevel }[] } {
  const stock = stockValues(engine);
  const reasons: { label: string; level: PermLevel }[] = [];
  let level: PermLevel = 0;
  for (const r of RESTRICTIONS) {
    if (!(r.id in stock)) continue;
    if (r.lifted(values, stock)) {
      if (!reasons.some((x) => x.label === r.label)) reasons.push({ label: r.label, level: r.level });
      if (r.level > level) level = r.level;
    }
  }
  return { level, reasons };
}

/** A preset's own permission level: its tier, raised if its defaults lift more. */
export function presetLevel(p: Preset, engine: EngineType): PermLevel {
  const own = restrictionsOf(engine, presetValues(p, engine)).level;
  return Math.max(TIER[p.id] ?? 1, own) as PermLevel;
}

/** How far apart two tunes are in performance (0 = identical). */
export function distance(engine: EngineType, a: Values, b: Values): number {
  let d = 0;
  for (const s of settingsFor(engine)) {
    const r = rangeFor(s, "expert"), span = r.max - r.min || 1;
    const x = ((a[s.id] ?? s.stock) - (b[s.id] ?? s.stock)) / span;
    d += x * x;
  }
  for (const t of togglesFor(engine)) if (isOn(t, a) !== isOn(t, b)) d += 0.25;
  return d;
}

export interface Filing { presetId: string; level: PermLevel; reasons: { label: string; level: PermLevel }[]; nearestByPerformance: string; }

/** File a user tune: permission first, then closest performance. */
export function fileTune(engine: EngineType, values: Values): Filing {
  const need = restrictionsOf(engine, values);
  const all = orderedPresets();
  let best = "", bestD = Infinity, nearest = "", nearestD = Infinity;
  for (const p of all) {
    const d = distance(engine, values, presetValues(p, engine));
    if (d < nearestD) { nearestD = d; nearest = p.id; }
    if (presetLevel(p, engine) < need.level) continue; // permission always overrides performance
    if (d < bestD) { bestD = d; best = p.id; }
  }
  return { presetId: best || "race", level: need.level, reasons: need.reasons, nearestByPerformance: nearest };
}

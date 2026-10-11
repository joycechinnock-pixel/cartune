/**
 * Vehicle electrical diagnostics calculators.
 *
 * Pure functions, no I/O — shared by the React Native app, the browser app
 * (bundled from this same file) and mirrored 1:1 in Python by
 * electrical_diag.py. Both sides are checked against the same test vectors
 * in mock_data/diag_test_vectors.json.
 *
 * EVERY THRESHOLD HERE IS A GENERAL GUIDELINE, NOT A MANUFACTURER SPEC.
 * Always check the vehicle maker's service information; every threshold can
 * be overridden by passing your own values.
 */
import { DEFAULT_FUSE_RESISTANCE_MOHM, FuseTable, FuseType } from "./fuses";

export type Status = "pass" | "warn" | "fail" | "info";

export interface Result {
  status: Status;
  message: string;
  [k: string]: unknown;
}

const round = (v: number, dp = 2) => Math.round(v * 10 ** dp) / 10 ** dp;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
function need(name: string, v: unknown): number {
  if (!isNum(v)) throw new Error(`${name} must be a number`);
  return v;
}

export const GUIDELINE_NOTE = "General guideline only — check the manufacturer's specification for this vehicle.";

// ---------------------------------------------------------------------------
// Default thresholds (all editable)
// ---------------------------------------------------------------------------
export type CircuitType = "ground" | "feed_high_current" | "feed_general" | "sensor_ground";

export const DEFAULT_THRESHOLDS = {
  voltageDrop: {
    ground: { pass: 0.2, warn: 0.3, label: "Ground side (engine/body ground)" },
    feed_high_current: { pass: 0.5, warn: 0.7, label: "High-current feed (starter / alternator output)" },
    feed_general: { pass: 0.3, warn: 0.5, label: "General power feed (lamps, motors, relays)" },
    sensor_ground: { pass: 0.1, warn: 0.15, label: "Sensor ground (5 V reference circuits)" },
  } as Record<CircuitType, { pass: number; warn: number; label: string }>,
  battery: {
    // Open-circuit (rested ≥1 h, no surface charge) voltage → state of charge, ~25 °C.
    socTable: {
      flooded: [[11.9, 0], [12.0, 25], [12.2, 50], [12.4, 75], [12.6, 100]] as [number, number][],
      agm: [[12.0, 0], [12.2, 25], [12.4, 50], [12.6, 75], [12.8, 100]] as [number, number][],
    },
    socPass: 75,
    socWarn: 50,
  },
  cranking: {
    minVolts: 9.6, // at ~21 °C / 70 °F
    warnMargin: 0.3,
    // Temperature-corrected minimum (BCI-style load-test table): [°C at or above, min V]
    tempTable: [[21, 9.6], [16, 9.5], [10, 9.4], [4, 9.3], [-1, 9.1], [-7, 8.9], [-12, 8.7], [-18, 8.5]] as [number, number][],
  },
  charging: { min: 13.5, max: 14.7, smartMin: 12.5, smartMax: 15.0 },
  ripple: { pass: 0.1, warn: 0.5 }, // volts AC
  parasitic: { limitMa: 50, warnMa: 85 },
  sleep: { expectedMinutes: 45 },
  can: {
    normal: [50, 70] as [number, number],
    oneTerminator: [108, 132] as [number, number],
    shortBelow: 10,
    openAbove: 1000,
    idle: 2.5,
    hRange: [2.5, 3.5] as [number, number],
    lRange: [1.5, 2.5] as [number, number],
  },
  sensor: { refNominal: 5.0, refPass: 0.25, refWarn: 0.5, groundPass: 0.1, groundWarn: 0.2, signalMin: 0.1, signalMax: 4.9 },
  compare: { tolPct: 5, tolAbs: 0 },
};
export type Thresholds = typeof DEFAULT_THRESHOLDS;

// ---------------------------------------------------------------------------
// Voltage drop
// ---------------------------------------------------------------------------
export function voltageDrop(o: {
  reading: number; circuit: CircuitType; loaded?: boolean;
  thresholds?: { pass: number; warn: number };
}): Result {
  const v = Math.abs(need("reading", o.reading));
  const th = o.thresholds ?? DEFAULT_THRESHOLDS.voltageDrop[o.circuit];
  if (!th) throw new Error(`unknown circuit type: ${o.circuit}`);
  if (o.loaded === false) {
    return { status: "info", reading: v, limit: th.pass,
      message: "Voltage drop is only meaningful with the circuit switched on and carrying current. Load the circuit and measure again." };
  }
  let status: Status = "pass";
  let message = `${round(v, 3)} V drop is within the ${th.pass} V guideline.`;
  if (v > th.warn) { status = "fail"; message = `${round(v, 3)} V drop is above ${th.warn} V — excessive resistance. Move the probe along the circuit to find the connection/wire section where the drop occurs.`; }
  else if (v > th.pass) { status = "warn"; message = `${round(v, 3)} V drop is marginal (guideline ${th.pass} V). Inspect connections, grounds and terminals in this path.`; }
  return { status, reading: v, limit: th.pass, warnAt: th.warn, message };
}

/** Voltage actually available to the load after both sides' drops. */
export function circuitBudget(o: { source: number; powerDrop: number; groundDrop: number }): Result {
  const src = need("source", o.source), p = Math.abs(need("powerDrop", o.powerDrop)), g = Math.abs(need("groundDrop", o.groundDrop));
  const available = round(src - p - g, 3);
  const pct = src > 0 ? round((available / src) * 100, 1) : 0;
  const status: Status = pct >= 95 ? "pass" : pct >= 90 ? "warn" : "fail";
  return { status, available, pct, lost: round(p + g, 3),
    message: `${available} V reaches the load (${pct}% of ${src} V); ${round(p + g, 3)} V is lost in wiring/connections.` };
}

// ---------------------------------------------------------------------------
// Battery / starting / charging
// ---------------------------------------------------------------------------
export function batterySoc(o: { volts: number; type?: "flooded" | "agm"; table?: [number, number][]; passPct?: number; warnPct?: number }): Result {
  const v = need("volts", o.volts);
  const type = o.type ?? "flooded";
  const table = o.table ?? DEFAULT_THRESHOLDS.battery.socTable[type];
  const passPct = o.passPct ?? DEFAULT_THRESHOLDS.battery.socPass;
  const warnPct = o.warnPct ?? DEFAULT_THRESHOLDS.battery.socWarn;
  const full = table[table.length - 1][0];
  if (v > full + 0.4) {
    return { status: "warn", socPct: 100, volts: v,
      message: `${v} V is above a rested battery's voltage — surface charge, a charger, or the engine running. Rest the battery (≥1 h, or switch the headlights on for a minute, then off) and re-measure.` };
  }
  let soc: number;
  if (v <= table[0][0]) soc = 0;
  else if (v >= full) soc = 100;
  else {
    soc = 0;
    for (let i = 1; i < table.length; i++) {
      const [v0, s0] = table[i - 1], [v1, s1] = table[i];
      if (v <= v1) { soc = s0 + ((v - v0) / (v1 - v0)) * (s1 - s0); break; }
    }
  }
  soc = Math.round(soc);
  let status: Status = "pass";
  let message = `About ${soc}% charged (${type === "agm" ? "AGM" : "flooded"} battery, ~25 °C).`;
  if (soc < warnPct) { status = "fail"; message += " Discharged — charge fully, then load/conductance test before condemning it or the charging system."; }
  else if (soc < passPct) { status = "warn"; message += " Partly discharged — charge before load testing or diagnosing starting/charging faults."; }
  return { status, socPct: soc, volts: v, message };
}

export function crankingMinVoltage(tempC: number | undefined, table = DEFAULT_THRESHOLDS.cranking.tempTable, base = DEFAULT_THRESHOLDS.cranking.minVolts): number {
  if (!isNum(tempC)) return base;
  for (const [t, v] of table) if (tempC >= t) return v;
  return table[table.length - 1][1];
}

export function crankingTest(o: { minVolts: number; tempC?: number; limit?: number; warnMargin?: number }): Result {
  const v = need("minVolts", o.minVolts);
  const limit = o.limit ?? crankingMinVoltage(o.tempC);
  const margin = o.warnMargin ?? DEFAULT_THRESHOLDS.cranking.warnMargin;
  if (v >= 12.0) {
    return { status: "warn", minVolts: v, limit,
      message: `Only dropped to ${v} V while cranking. If the engine cranked normally that's fine; if it did NOT crank, current isn't flowing — suspect the starter control circuit, solenoid, or an open in the starter feed rather than the battery.` };
  }
  if (v < limit) {
    return { status: "fail", minVolts: v, limit,
      message: `${v} V is below the ${limit} V cranking minimum. Check battery state of charge first; if the battery is charged and passes a load test, voltage-drop test the starter feed and ground, then suspect the starter (high current draw).` };
  }
  if (v < limit + margin) {
    return { status: "warn", minVolts: v, limit, message: `${v} V is only just above the ${limit} V minimum — battery or cables are marginal.` };
  }
  return { status: "pass", minVolts: v, limit, message: `${v} V stays above the ${limit} V cranking minimum.` };
}

export function chargingTest(o: { volts: number; smart?: boolean; min?: number; max?: number; smartMin?: number; smartMax?: number }): Result {
  const v = need("volts", o.volts);
  const t = DEFAULT_THRESHOLDS.charging;
  const min = o.min ?? t.min, max = o.max ?? t.max, smartMin = o.smartMin ?? t.smartMin, smartMax = o.smartMax ?? t.smartMax;
  if (v < min) {
    if (o.smart && v >= smartMin) {
      return { status: "warn", volts: v, min, max,
        message: `${v} V is low for a conventional system, but smart/ECM-controlled charging deliberately drops to ~12.5–13.2 V when the battery is full. Switch on heavy loads (headlights, blower, rear demister) — voltage should rise — or check the commanded charging voltage with a scan tool.` };
    }
    return { status: "fail", volts: v, min, max,
      message: `${v} V is below ${min} V — undercharging. Check the drive belt, alternator output/ground voltage drop, fusible links, and alternator control circuit.` };
  }
  if (v > max) {
    if (o.smart && v <= smartMax) {
      return { status: "warn", volts: v, min, max,
        message: `${v} V is above ${max} V. Some smart systems briefly charge higher (cold battery, recovery mode); if it stays high, suspect regulator/control.` };
    }
    return { status: "fail", volts: v, min, max,
      message: `${v} V is above ${max} V — overcharging. Suspect the voltage regulator or its sense/control circuit; overcharging damages batteries and electronics.` };
  }
  return { status: "pass", volts: v, min, max, message: `${v} V is within the ${min}–${max} V charging range.` };
}

export function rippleTest(o: { acVolts: number; pass?: number; warn?: number }): Result {
  const v = Math.abs(need("acVolts", o.acVolts));
  const p = o.pass ?? DEFAULT_THRESHOLDS.ripple.pass, w = o.warn ?? DEFAULT_THRESHOLDS.ripple.warn;
  const mv = Math.round(v * 1000);
  if (v > w) return { status: "fail", acVolts: v, message: `${mv} mV AC ripple — excessive. Likely a failed rectifier diode or stator winding in the alternator.` };
  if (v > p) return { status: "warn", acVolts: v, message: `${mv} mV AC ripple — elevated. Re-test at ~2000 rpm with loads on; a weak diode may be starting to fail.` };
  return { status: "pass", acVolts: v, message: `${mv} mV AC ripple is within the ${Math.round(p * 1000)} mV guideline.` };
}

// ---------------------------------------------------------------------------
// Parasitic draw
// ---------------------------------------------------------------------------
export function parasiticDraw(o: { milliamps: number; limitMa?: number; warnMa?: number; batteryAh?: number }): Result {
  const ma = need("milliamps", o.milliamps);
  const limit = o.limitMa ?? DEFAULT_THRESHOLDS.parasitic.limitMa;
  const warn = Math.max(limit, o.warnMa ?? DEFAULT_THRESHOLDS.parasitic.warnMa);
  const ah = o.batteryAh ?? 60;
  // Days until a full battery is at ~50% (roughly where cranking gets unreliable).
  const daysTo50 = ma > 0 ? round((ah * 0.5) / (ma / 1000) / 24, 1) : null;
  const tail = daysTo50 !== null ? ` A ${ah} Ah battery would be at ~50% after about ${daysTo50} days.` : "";
  if (ma > warn) return { status: "fail", milliamps: ma, limitMa: limit, daysTo50,
    message: `${ma} mA is excessive (guideline ${limit} mA, some newer vehicles allow up to ~${warn} mA). Confirm modules are asleep, then find the circuit with fuse voltage drop.` + tail };
  if (ma > limit) return { status: "warn", milliamps: ma, limitMa: limit, daysTo50,
    message: `${ma} mA is above the ${limit} mA guideline — acceptable on some modern vehicles; check the maker's spec and that every module has gone to sleep.` + tail };
  return { status: "pass", milliamps: ma, limitMa: limit, daysTo50, message: `${ma} mA is within the ${limit} mA guideline (typical 20–50 mA).` + tail };
}

export function sleepCheck(o: { elapsedMinutes: number; expectedMinutes?: number }): Result {
  const e = need("elapsedMinutes", o.elapsedMinutes);
  const x = o.expectedMinutes ?? DEFAULT_THRESHOLDS.sleep.expectedMinutes;
  if (e < x) return { status: "info", remaining: round(x - e, 1),
    message: `Wait about ${round(x - e, 1)} more min before trusting the reading — modules can stay awake 20–60+ min after lock-up (don't open doors or wake the car while you wait).` };
  return { status: "pass", remaining: 0, message: "Modules should be asleep now — take the draw reading." };
}

export function fuseDropCurrent(o: { millivolts: number; type: FuseType; rating: string | number; table?: FuseTable; resistanceMohm?: number }): Result {
  const mv = Math.abs(need("millivolts", o.millivolts));
  const table = o.table ?? DEFAULT_FUSE_RESISTANCE_MOHM;
  const key = Number.isFinite(parseFloat(String(o.rating))) ? String(parseFloat(String(o.rating))) : String(o.rating);
  const r = o.resistanceMohm ?? table[o.type]?.[key];
  if (!isNum(r) || r <= 0) throw new Error(`no resistance value for ${o.type} ${key} A fuse — enter one`);
  const amps = mv / r; // mV / mΩ = A
  const ma = round(amps * 1000, 1);
  const status: Status = ma < 5 ? "info" : "warn";
  return { status, milliamps: ma, amps: round(amps, 4), resistanceMohm: r,
    message: `${mv} mV across a ${key} A ${o.type} fuse (~${r} mΩ) ≈ ${ma} mA flowing in that circuit (approximate — fuse resistance varies).` +
      (ma < 5 ? " Essentially no current: this circuit is probably not the draw." : " This circuit is drawing current — unplug/isolate its loads to find the culprit.") };
}

// ---------------------------------------------------------------------------
// CAN bus (DLC pins 6 = CAN-H, 14 = CAN-L)
// ---------------------------------------------------------------------------
export function canTermination(o: { ohms: number | null; t?: Thresholds["can"] }): Result {
  const t = o.t ?? DEFAULT_THRESHOLDS.can;
  if (o.ohms === null || o.ohms === undefined || (isNum(o.ohms) && o.ohms >= t.openAbove)) {
    return { status: "fail", verdict: "open", message: "Open circuit (OL) between pins 6 and 14 — both terminators missing or an open in the CAN wiring to the DLC. Some vehicles route the DLC through a gateway, so check the wiring diagram." };
  }
  const r = need("ohms", o.ohms);
  if (r < t.shortBelow) return { status: "fail", verdict: "short", ohms: r, message: `${r} Ω — CAN-H and CAN-L are shorted together (or to each other through a failed module).` };
  if (r >= t.normal[0] && r <= t.normal[1]) return { status: "pass", verdict: "normal", ohms: r, message: `${r} Ω — normal: two 120 Ω terminators in parallel (~60 Ω).` };
  if (r >= t.oneTerminator[0] && r <= t.oneTerminator[1]) return { status: "fail", verdict: "one_terminator", ohms: r, message: `${r} Ω — only one terminator seen: a terminating module is disconnected/failed or a bus wire is open on one branch.` };
  if (r < t.normal[0]) return { status: "warn", verdict: "low", ohms: r, message: `${r} Ω — lower than 60 Ω: an extra terminator (e.g. ~40 Ω = three) or a partial short between H and L.` };
  return { status: "warn", verdict: "high", ohms: r, message: `${r} Ω — between normal and single-terminator values: high resistance in a bus wire or connector (corrosion, spread terminal).` };
}

export function canVoltages(o: { canH: number; canL: number; t?: Thresholds["can"] }): Result {
  const h = need("canH", o.canH), l = need("canL", o.canL);
  const t = o.t ?? DEFAULT_THRESHOLDS.can;
  const issues: string[] = [];
  let status: Status = "pass";
  const bad = (msg: string) => { issues.push(msg); status = "fail"; };
  if (h < 0.5) bad("CAN-H near 0 V — shorted to ground (or bus not powered).");
  else if (h > 5.5) bad("CAN-H near battery voltage — shorted to power.");
  if (l < 0.5) bad("CAN-L near 0 V — shorted to ground.");
  else if (l > 5.5) bad("CAN-L near battery voltage — shorted to power.");
  if (status === "pass" && Math.abs(h - l) < 0.05) {
    status = "warn";
    issues.push(`H and L both read ~${round((h + l) / 2, 2)} V: normal for an idle/asleep bus (recessive ~${t.idle} V), but if the bus should be active, suspect H shorted to L — confirm with the resistance test.`);
  }
  if (status === "pass") {
    const hOk = h >= t.hRange[0] && h <= t.hRange[1];
    const lOk = l >= t.lRange[0] && l <= t.lRange[1];
    if (!hOk) { status = "warn"; issues.push(`CAN-H ${h} V is outside the expected ${t.hRange[0]}–${t.hRange[1]} V.`); }
    if (!lOk) { status = "warn"; issues.push(`CAN-L ${l} V is outside the expected ${t.lRange[0]}–${t.lRange[1]} V.`); }
  }
  const sum = round(h + l, 2);
  const message = status === "pass"
    ? `CAN-H ${h} V / CAN-L ${l} V look normal for an active bus (sum ${sum} V, ideally ≈5 V).`
    : issues.join(" ");
  return { status, canH: h, canL: l, sum, message };
}

// ---------------------------------------------------------------------------
// Sensors
// ---------------------------------------------------------------------------
export function threeWireSensor(o: { ref: number; signal: number; groundDrop: number; s?: Thresholds["sensor"] }): Result {
  const s = o.s ?? DEFAULT_THRESHOLDS.sensor;
  const ref = need("ref", o.ref), sig = need("signal", o.signal), gd = Math.abs(need("groundDrop", o.groundDrop));
  const checks: { name: string; status: Status; message: string }[] = [];
  const dRef = Math.abs(ref - s.refNominal);
  if (ref < 0.5) checks.push({ name: "reference", status: "fail", message: `Reference ${ref} V — open reference wire or reference shorted to ground (a shorted sensor on the same 5 V rail can pull every sensor's reference down).` });
  else if (ref > s.refNominal + 2) checks.push({ name: "reference", status: "fail", message: `Reference ${ref} V — shorted to battery voltage.` });
  else if (dRef <= s.refPass) checks.push({ name: "reference", status: "pass", message: `Reference ${ref} V OK.` });
  else if (dRef <= s.refWarn) checks.push({ name: "reference", status: "warn", message: `Reference ${ref} V is off-nominal (${s.refNominal} V ±${s.refPass}).` });
  else checks.push({ name: "reference", status: "fail", message: `Reference ${ref} V is out of range — check the ECU supply/ground and the reference circuit.` });

  if (gd <= s.groundPass) checks.push({ name: "ground", status: "pass", message: `Sensor ground drop ${gd} V OK.` });
  else if (gd <= s.groundWarn) checks.push({ name: "ground", status: "warn", message: `Sensor ground drop ${gd} V is marginal (≤${s.groundPass} V expected).` });
  else checks.push({ name: "ground", status: "fail", message: `Sensor ground drop ${gd} V — poor ground; the ECU will read a wrong signal.` });

  if (sig < s.signalMin) checks.push({ name: "signal", status: "fail", message: `Signal ${sig} V — near 0: signal shorted to ground, open signal wire (with pull-down), or no reference.` });
  else if (sig > s.signalMax) checks.push({ name: "signal", status: "fail", message: `Signal ${sig} V — at/near reference: open sensor ground, open signal (with pull-up) or signal shorted to reference.` });
  else checks.push({ name: "signal", status: "pass", message: `Signal ${sig} V is in the plausible ${s.signalMin}–${s.signalMax} V range — compare against the scan-tool value and the sensor's spec curve.` });

  const order: Status[] = ["pass", "info", "warn", "fail"];
  const status = checks.reduce<Status>((w, c) => (order.indexOf(c.status) > order.indexOf(w) ? c.status : w), "pass");
  return { status, checks, message: checks.map((c) => c.message).join(" ") };
}

export function compareReadings(o: { meter: number; scan: number; tolPct?: number; tolAbs?: number }): Result {
  const m = need("meter", o.meter), sc = need("scan", o.scan);
  const tolPct = o.tolPct ?? DEFAULT_THRESHOLDS.compare.tolPct, tolAbs = o.tolAbs ?? DEFAULT_THRESHOLDS.compare.tolAbs;
  const diff = round(sc - m, 3);
  const pct = m !== 0 ? round((Math.abs(diff) / Math.abs(m)) * 100, 1) : (diff === 0 ? 0 : 100);
  const ok = Math.abs(diff) <= tolAbs || pct <= tolPct;
  return { status: ok ? "pass" : "fail", diff, pct,
    message: ok ? `Meter and scan tool agree (Δ ${diff}, ${pct}%).`
      : `Meter and scan tool disagree by ${diff} (${pct}%) — if the meter reading at the sensor is right, the fault is in the wiring between sensor and ECU (voltage drop / resistance) or the ECU input.` };
}

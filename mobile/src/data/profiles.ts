/**
 * Field schema + build-sheet profiles, ported VERBATIM from
 * CarTune-Map-Input-Console.html (FIELDS / PROFILES constants) so the mobile
 * app produces byte-for-byte the same tune_spec.json shape as the browser
 * console. If you change a profile value or add a field, change it in both
 * places — see tuneSpec.ts for the export logic these feed.
 */

export type FieldType = "select" | "number";

export interface FieldDef {
  key: string;
  label: string;
  segment: string;
  type: FieldType;
  options?: string[];
  step?: string;
  support: string;
  checkKeywords?: string[];
  ebcmCheck?: string[];
  ebcm?: boolean;
}

export const FIELDS: FieldDef[] = [
  {
    key: "power_stage", label: "Power stage", segment: "Overview", type: "select",
    options: ["None (baseline)", "ECU remap only", "Stage 1", "Stage 1–2 (+ intake/headers)", "Stage 2–3 (+ launch control)", "Stage 3 (+ cam/heads)"],
    support: "Descriptive only — not itself written to any table.",
  },
  {
    key: "afr_cruise", label: "Cruise AFR target", segment: "Fuel Calibration", type: "number", step: "0.1",
    support: "LinOLS, TunerPro, HyperTuner, LibreTune, Tune-Editor, PCM Hammer (GM E38/E67). RomRaider = Subaru/BMW only, not this platform. Universal Patcher only if a known patch exists for this OS ID.",
  },
  {
    key: "afr_wot", label: "WOT AFR target", segment: "Fuel Calibration", type: "number", step: "0.1",
    support: "Same tool set as cruise AFR — same VE/fuel table.",
  },
  {
    key: "spark_wot", label: "WOT spark strategy", segment: "Engine Calibration", type: "select",
    options: ["Factory conservative", "Moderately advanced (+2–4°)", "Advanced to knock-limit (+4–6°)", "Conservative during hold, full on release", "Complete rework (cam/head airflow change)"],
    support: "LinOLS, TunerPro, HyperTuner, LibreTune, Tune-Editor, PCM Hammer. A 'complete rework' entry (Race stage) is a re-learn, not a single-cell edit — treat as its own tuning pass.",
  },
  {
    key: "spark_partthrottle", label: "Part-throttle spark", segment: "Engine Calibration", type: "select",
    options: ["Factory", "Advanced (efficiency)", "Advanced (steady-state)", "Softened (transient smoothing)", "Softened (tip-in, loose surface)"],
    support: "Same table/tools as WOT spark.",
  },
  {
    key: "shift_wot_rpm", label: "WOT upshift RPM", segment: "Speed Calibration", type: "number",
    checkKeywords: ["shift", "upshift", "speed cal"],
    support: "TunerPro, PCM Hammer if your XDF/definition includes transmission tables. Universal Patcher: known values only.",
  },
  {
    key: "shift_partthrottle_rpm", label: "Part-throttle upshift RPM", segment: "Speed Calibration", type: "number",
    checkKeywords: ["shift", "upshift", "speed cal"],
    support: "Same tool set as WOT upshift RPM.",
  },
  {
    key: "line_pressure", label: "Line pressure", segment: "Speed Calibration", type: "select",
    options: ["Factory adaptive", "Softened (light throttle)", "Light / smooth", "Lowest (comfort)", "Moderate", "Raised", "High / firm", "Maximum", "N/A — manual gear hold"],
    checkKeywords: ["line pressure", "pressure control", "pc solenoid"],
    support: "Same tool set as shift schedule.",
  },
  {
    key: "tcc_lockup_rpm", label: "TCC lockup RPM", segment: "Speed Calibration", type: "select",
    options: ["~1,200 (very early)", "~1,400 (early)", "~1,600", "~1,800", "~2,200 (late)", "~2,500 (late, firm)", "Disabled entirely", "Locked/near-locked from launch"],
    checkKeywords: ["tcc", "torque converter", "lockup"],
    support: "Same tool set as shift schedule.",
  },
  {
    key: "afm_dod", label: "AFM / DOD range", segment: "Fuel Calibration", type: "select",
    options: ["Factory (light cruise, <40% load)", "Widened", "Wide (factory-default retained)", "Liberal, smoothed transitions", "Retained (near-factory)", "Disabled / reduced", "Off", "Off (often mechanically deleted)"],
    support: "LinOLS, TunerPro, HyperTuner, PCM Hammer, or a known Universal Patcher AFM-disable patch — the fastest path if you just want it off.",
  },
  {
    key: "traction_threshold", label: "Traction / stability threshold", segment: "EBCM (separate module)", type: "select",
    options: ["Factory tight — early intervention", "Unchanged", "Slightly loosened", "Loosened", "Loosened significantly", "Off — staged 'drag mode'", "Off — minimal", "Fully disabled"],
    ebcmCheck: ["yaw", "slip", "traction", "stability", "esc", "ebcm"],
    support: "Not reachable by any engine-tuning tool in this inventory — yaw/wheel-slip thresholds live in the EBCM. Needs its own UDS/ODX session via odxtools / ddt4all / EcuBus-Pro, and only if a definition for your EBCM exists.",
    ebcm: true,
  },
  {
    key: "launch_rev", label: "Launch control / rev limiter", segment: "Engine Calibration", type: "select",
    options: ["Standard rev limiter only", "N/A", "Optional soft launch assist", "2-step hold, release on clutch/brake", "2-step / anti-lag optional", "Optional 2-step for RPM hold on brake"],
    support: "TunerPro, PCM Hammer, Universal Patcher (known 2-step patches). RomRaider not applicable to this platform.",
  },
  {
    key: "rev_limiter_rpm", label: "Hard rev limiter / redline (rpm)", segment: "Engine Calibration", type: "number",
    support: "Same tool set as launch control.",
  },
];

export type FieldValues = Record<string, string | number>;

export interface Profile {
  est: string;
  v: FieldValues;
}

export const PROFILES: Record<string, Profile> = {
  "Factory Standard": { est: "5.4s", v: {
    power_stage: "None (baseline)", afr_cruise: 14.7, afr_wot: 12.9, spark_wot: "Factory conservative", spark_partthrottle: "Factory",
    shift_wot_rpm: 5150, shift_partthrottle_rpm: 2000, line_pressure: "Factory adaptive", tcc_lockup_rpm: "~1,600",
    afm_dod: "Factory (light cruise, <40% load)", traction_threshold: "Factory tight — early intervention",
    launch_rev: "Standard rev limiter only", rev_limiter_rpm: 6600 } },

  "Economical": { est: "~5.6s", v: {
    power_stage: "ECU remap only", afr_cruise: 15.0, afr_wot: 12.8, spark_wot: "Factory conservative", spark_partthrottle: "Advanced (efficiency)",
    shift_wot_rpm: 5150, shift_partthrottle_rpm: 2200, line_pressure: "Softened (light throttle)", tcc_lockup_rpm: "~1,200 (very early)",
    afm_dod: "Widened", traction_threshold: "Unchanged",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },

  "Highway Driving": { est: "~5.5s", v: {
    power_stage: "ECU remap only", afr_cruise: 14.7, afr_wot: 12.9, spark_wot: "Factory conservative", spark_partthrottle: "Advanced (steady-state)",
    shift_wot_rpm: 5150, shift_partthrottle_rpm: 2800, line_pressure: "Light / smooth", tcc_lockup_rpm: "~1,400 (early)",
    afm_dod: "Wide (factory-default retained)", traction_threshold: "Unchanged",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },

  "Comfort": { est: "~5.5s", v: {
    power_stage: "ECU remap only", afr_cruise: 14.7, afr_wot: 12.9, spark_wot: "Factory conservative", spark_partthrottle: "Softened (transient smoothing)",
    shift_wot_rpm: 2900, shift_partthrottle_rpm: 2900, line_pressure: "Lowest (comfort)", tcc_lockup_rpm: "~1,400 (early)",
    afm_dod: "Liberal, smoothed transitions", traction_threshold: "Unchanged",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },

  "Day Use": { est: "~5.1s", v: {
    power_stage: "Stage 1", afr_cruise: 14.7, afr_wot: 12.8, spark_wot: "Moderately advanced (+2–4°)", spark_partthrottle: "Factory",
    shift_wot_rpm: 4200, shift_partthrottle_rpm: 2000, line_pressure: "Raised", tcc_lockup_rpm: "~1,800",
    afm_dod: "Retained (near-factory)", traction_threshold: "Slightly loosened",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },

  "Sport": { est: "~4.8s", v: {
    power_stage: "Stage 1–2 (+ intake/headers)", afr_cruise: 14.7, afr_wot: 12.7, spark_wot: "Advanced to knock-limit (+4–6°)", spark_partthrottle: "Factory",
    shift_wot_rpm: 5500, shift_partthrottle_rpm: 2000, line_pressure: "High / firm", tcc_lockup_rpm: "~2,200 (late)",
    afm_dod: "Disabled / reduced", traction_threshold: "Loosened",
    launch_rev: "Optional soft launch assist", rev_limiter_rpm: 6600 } },

  "Handling": { est: "~5.0s (not the goal)", v: {
    power_stage: "Stage 1", afr_cruise: 14.7, afr_wot: 12.8, spark_wot: "Moderately advanced (+2–4°)", spark_partthrottle: "Factory",
    shift_wot_rpm: 5500, shift_partthrottle_rpm: 2000, line_pressure: "High / firm", tcc_lockup_rpm: "~2,200 (late)",
    afm_dod: "Off", traction_threshold: "Loosened significantly",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },

  "Holeshot": { est: "~4.0–4.3s", v: {
    power_stage: "Stage 2–3 (+ launch control)", afr_cruise: 14.7, afr_wot: 12.25, spark_wot: "Conservative during hold, full on release", spark_partthrottle: "Factory",
    shift_wot_rpm: 6200, shift_partthrottle_rpm: 2000, line_pressure: "Maximum", tcc_lockup_rpm: "Locked/near-locked from launch",
    afm_dod: "Off", traction_threshold: "Off — staged 'drag mode'",
    launch_rev: "2-step hold, release on clutch/brake", rev_limiter_rpm: 6600 } },

  "Race": { est: "~4.1s", v: {
    power_stage: "Stage 3 (+ cam/heads)", afr_cruise: 14.7, afr_wot: 12.4, spark_wot: "Complete rework (cam/head airflow change)", spark_partthrottle: "Factory",
    shift_wot_rpm: 6200, shift_partthrottle_rpm: 2000, line_pressure: "Maximum", tcc_lockup_rpm: "~2,500 (late, firm)",
    afm_dod: "Off (often mechanically deleted)", traction_threshold: "Off — minimal",
    launch_rev: "2-step / anti-lag optional", rev_limiter_rpm: 6600 } },

  "Burnout": { est: "n/a — closed course", v: {
    power_stage: "None (baseline)", afr_cruise: 14.7, afr_wot: 12.9, spark_wot: "Factory conservative", spark_partthrottle: "Factory",
    shift_wot_rpm: 0, shift_partthrottle_rpm: 0, line_pressure: "N/A — manual gear hold", tcc_lockup_rpm: "Disabled entirely",
    afm_dod: "Off", traction_threshold: "Fully disabled",
    launch_rev: "Optional 2-step for RPM hold on brake", rev_limiter_rpm: 6600 } },

  "Off-Road / Loose Surface": { est: "~5.3s (not the goal)", v: {
    power_stage: "Stage 1", afr_cruise: 14.7, afr_wot: 12.8, spark_wot: "Factory conservative", spark_partthrottle: "Softened (tip-in, loose surface)",
    shift_wot_rpm: 3500, shift_partthrottle_rpm: 3500, line_pressure: "Moderate", tcc_lockup_rpm: "~1,600",
    afm_dod: "Retained (near-factory)", traction_threshold: "Loosened",
    launch_rev: "N/A", rev_limiter_rpm: 6600 } },
};

export const DAY_USE_OR_BELOW = new Set(["None (baseline)", "ECU remap only", "Stage 1"]);

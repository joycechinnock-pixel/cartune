/**
 * Builds tune_spec.json in the exact shape CarTune-Map-Input-Console.html's
 * exportSpec() produces, so cartune_orchestrator.py --tune-spec accepts
 * output from either the browser console or this app interchangeably.
 */

import { FIELDS, PROFILES, FieldValues } from "./profiles";

export interface CapabilityCheck {
  field: string;
  checked: boolean;
  found: boolean | null;
}

export interface TuneSpec {
  generated_by: string;
  profile: string;
  values: FieldValues;
  segments_touched: string[];
  ebcm_fields: string[];
  requires_dyno_log: boolean;
  capability_checks: CapabilityCheck[];
  note: string;
}

const DAY_USE_OR_BELOW = new Set(["None (baseline)", "ECU remap only", "Stage 1"]);

/**
 * @param values           current field values (start from a PROFILES[name].v and override as needed)
 * @param profileName      which preset was used as the starting point (or "Custom")
 * @param xdfTableNames    table names parsed from an uploaded XDF, if any (null = not uploaded)
 * @param ebcmSignalNames  signal names parsed from an uploaded EBCM ODX/DBC, if any (null = not uploaded)
 */
export function buildTuneSpec(
  values: FieldValues,
  profileName: string,
  xdfTableNames: string[] | null = null,
  ebcmSignalNames: string[] | null = null
): TuneSpec {
  const baseline = PROFILES["Factory Standard"].v;
  const changedFields = FIELDS.filter(
    (f) => String(values[f.key]) !== String(baseline[f.key]) && f.key !== "power_stage"
  );
  const segmentsTouched = [...new Set(changedFields.map((f) => f.segment))];
  const requiresDynoLog = !DAY_USE_OR_BELOW.has(String(values.power_stage));

  const capabilityChecks: CapabilityCheck[] = changedFields
    .filter((f) => f.checkKeywords || f.ebcmCheck)
    .map((f) => {
      const usesXdf = !!f.checkKeywords;
      const checked = usesXdf ? xdfTableNames !== null : ebcmSignalNames !== null;
      let found: boolean | null = null;
      if (usesXdf && xdfTableNames !== null) {
        found = f.checkKeywords!.some((k) => xdfTableNames.some((n) => n.toLowerCase().includes(k)));
      } else if (!usesXdf && ebcmSignalNames !== null) {
        found = f.ebcmCheck!.some((k) => ebcmSignalNames.some((n) => n.toLowerCase().includes(k)));
      }
      return { field: f.key, checked, found };
    });

  return {
    generated_by: "CarTune Mobile Companion",
    profile: profileName,
    values,
    segments_touched: segmentsTouched,
    ebcm_fields: changedFields.filter((f) => f.ebcm).map((f) => f.key),
    requires_dyno_log: requiresDynoLog,
    capability_checks: capabilityChecks,
    note: requiresDynoLog
      ? "Power stage is beyond 'Day Use' — per the build sheet, this needs a live dyno pull with knock/AFR/coolant logged before you trust it. cartune_orchestrator.py's Validator will refuse to approve a flash for this spec without a --dyno-log CSV."
      : "This is a specification of intended changes, not a flashable binary. Apply these values inside the tool that supports the touched segment(s) (see per-field 'support' notes), against your own vehicle's exact base calibration/XDF/OS ID.",
  };
}

/**
 * Shape expected by MobileCaptureAgent in cartune_orchestrator.py:
 * { vin, ecus, protocol, dtcs, live_data }
 */
export interface MobileCapture {
  vin: string | null;
  ecus: string[];
  protocol: string;
  dtcs: string[];
  live_data: Record<string, number>;
}

export function buildMobileCapture(
  vin: string | null,
  dtcs: string[],
  liveData: Record<string, number>
): MobileCapture {
  return {
    vin,
    ecus: vin ? ["PCM (inferred — BLE OBD-II can't enumerate the full network like Discovery's live scan)"] : [],
    protocol: "ISO15765 (via BLE OBD-II)",
    dtcs,
    live_data: liveData,
  };
}

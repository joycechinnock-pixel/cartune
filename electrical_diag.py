#!/usr/bin/env python3
"""
CarTune electrical diagnostics — calculators + CLI.

Python mirror of mobile/src/diag/electrical.ts + fuses.ts (same thresholds,
same verdicts). Both implementations are tested against the same vectors in
mock_data/diag_test_vectors.json, so they cannot drift apart silently.

Pure stdlib, no hardware access: every function takes numbers a technician
measured (or the app read over OBD-II) and returns a verdict dict:
    {"status": "pass" | "warn" | "fail" | "info", "message": "...", ...}

EVERY THRESHOLD IS A GENERAL GUIDELINE, NOT A MANUFACTURER SPECIFICATION.
Check the vehicle maker's service information; all thresholds can be
overridden via keyword arguments / CLI flags.

CLI (also reachable as `cartune_orchestrator.py --electrical-diag ...`):
    python3 electrical_diag.py voltage-drop --reading 0.35 --circuit ground
    python3 electrical_diag.py battery --volts 12.4 [--type agm]
    python3 electrical_diag.py cranking --min-volts 9.8 [--temp-c 5]
    python3 electrical_diag.py charging --volts 13.1 [--smart]
    python3 electrical_diag.py ripple --ac-volts 0.3
    python3 electrical_diag.py parasitic --milliamps 70 [--limit-ma 50 --battery-ah 70]
    python3 electrical_diag.py fuse-drop --millivolts 1.2 --type mini --rating 10
    python3 electrical_diag.py fuse-table
    python3 electrical_diag.py can-termination --ohms 118   (or --open)
    python3 electrical_diag.py can-voltage --can-h 2.7 --can-l 2.3
    python3 electrical_diag.py sensor --ref 5.0 --signal 0.9 --ground-drop 0.03
    python3 electrical_diag.py compare --meter 12.6 --scan 12.5
Add --json to any subcommand for machine-readable output.
"""

from __future__ import annotations

import argparse
import json
import math
import sys

GUIDELINE_NOTE = "General guideline only — check the manufacturer's specification for this vehicle."

# ---------------------------------------------------------------------------
# Default thresholds — keep in sync with mobile/src/diag/electrical.ts
# ---------------------------------------------------------------------------
VOLTAGE_DROP = {
    "ground": {"pass": 0.2, "warn": 0.3, "label": "Ground side (engine/body ground)"},
    "feed_high_current": {"pass": 0.5, "warn": 0.7, "label": "High-current feed (starter / alternator output)"},
    "feed_general": {"pass": 0.3, "warn": 0.5, "label": "General power feed (lamps, motors, relays)"},
    "sensor_ground": {"pass": 0.1, "warn": 0.15, "label": "Sensor ground (5 V reference circuits)"},
}
SOC_TABLES = {
    "flooded": [(11.9, 0), (12.0, 25), (12.2, 50), (12.4, 75), (12.6, 100)],
    "agm": [(12.0, 0), (12.2, 25), (12.4, 50), (12.6, 75), (12.8, 100)],
}
SOC_PASS, SOC_WARN = 75, 50
CRANKING_MIN = 9.6
CRANKING_WARN_MARGIN = 0.3
CRANKING_TEMP_TABLE = [(21, 9.6), (16, 9.5), (10, 9.4), (4, 9.3), (-1, 9.1), (-7, 8.9), (-12, 8.7), (-18, 8.5)]
CHARGING = {"min": 13.5, "max": 14.7, "smart_min": 12.5, "smart_max": 15.0}
RIPPLE = {"pass": 0.1, "warn": 0.5}
PARASITIC = {"limit_ma": 50, "warn_ma": 85}
SLEEP_EXPECTED_MIN = 45
CAN = {"normal": (50, 70), "one_terminator": (108, 132), "short_below": 10, "open_above": 1000,
       "idle": 2.5, "h_range": (2.5, 3.5), "l_range": (1.5, 2.5)}
SENSOR = {"ref_nominal": 5.0, "ref_pass": 0.25, "ref_warn": 0.5, "ground_pass": 0.1, "ground_warn": 0.2,
          "signal_min": 0.1, "signal_max": 4.9}
COMPARE = {"tol_pct": 5, "tol_abs": 0}

# Approximate fuse cold resistance (mΩ). Sources: Littelfuse ATO / MICRO2
# datasheets (typical cold resistance) and Power Probe fuse voltage-drop
# charts (mini/maxi/J-case derived as 1 mV ÷ listed mA). APPROXIMATE — real
# fuses vary by maker, batch and temperature.
FUSE_RESISTANCE_MOHM = {
    "ato": {"1": 123, "2": 53.5, "3": 31.1, "4": 22.8, "5": 17.85, "7.5": 10.91, "10": 7.7, "15": 4.8, "20": 3.38,
            "25": 2.52, "30": 1.97, "35": 1.61, "40": 1.44},
    "mini": {"2": 55.6, "3": 33.8, "4": 23.5, "5": 17.8, "7.5": 10.85, "10": 7.42, "15": 4.58, "20": 3.21, "25": 2.36,
             "30": 1.85},
    "micro2": {"3": 31.7, "5": 17.4, "7.5": 10.8, "10": 7.7, "15": 4.9, "20": 3.5, "25": 2.6, "30": 2.1},
    "maxi": {"20": 3.1, "25": 2.39, "30": 1.95, "35": 1.71, "40": 1.42, "50": 1.1, "60": 0.89, "70": 0.64, "80": 0.54},
    "jcase": {"20": 6.0, "30": 5.2, "40": 3.8, "50": 2.4, "60": 1.7, "80": 1.23, "100": 0.47},
}
FUSE_TYPE_LABELS = {"ato": "Standard blade (ATO/ATC)", "mini": "Mini blade (ATM/APM)", "micro2": "Micro2",
                    "maxi": "Maxi blade (APX)", "jcase": "J-case cartridge"}

_ORDER = ["pass", "info", "warn", "fail"]


def _round(v: float, dp: int = 2) -> float:
    """Round half up, identical to JavaScript's Math.round-based helper."""
    f = 10 ** dp
    return math.floor(v * f + 0.5) / f


def _num(name: str, v) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        raise ValueError(f"{name} must be a number")
    return float(v)


def _fmt(v: float) -> str:
    """Number formatting that matches JavaScript's String(number) for messages."""
    return str(int(v)) if float(v).is_integer() else repr(float(v))


# ---------------------------------------------------------------------------
# Voltage drop
# ---------------------------------------------------------------------------
def voltage_drop(reading, circuit="ground", loaded=True, thresholds=None) -> dict:
    v = abs(_num("reading", reading))
    th = thresholds or VOLTAGE_DROP.get(circuit)
    if not th:
        raise ValueError(f"unknown circuit type: {circuit}")
    if loaded is False:
        return {"status": "info", "reading": v, "limit": th["pass"],
                "message": "Voltage drop is only meaningful with the circuit switched on and carrying current. "
                           "Load the circuit and measure again."}
    status, msg = "pass", f"{_fmt(_round(v, 3))} V drop is within the {_fmt(th['pass'])} V guideline."
    if v > th["warn"]:
        status = "fail"
        msg = (f"{_fmt(_round(v, 3))} V drop is above {_fmt(th['warn'])} V — excessive resistance. Move the probe along "
               "the circuit to find the connection/wire section where the drop occurs.")
    elif v > th["pass"]:
        status = "warn"
        msg = (f"{_fmt(_round(v, 3))} V drop is marginal (guideline {_fmt(th['pass'])} V). Inspect connections, grounds "
               "and terminals in this path.")
    return {"status": status, "reading": v, "limit": th["pass"], "warn_at": th["warn"], "message": msg}


def circuit_budget(source, power_drop, ground_drop) -> dict:
    src = _num("source", source)
    p, g = abs(_num("power_drop", power_drop)), abs(_num("ground_drop", ground_drop))
    available = _round(src - p - g, 3)
    pct = _round(available / src * 100, 1) if src > 0 else 0
    status = "pass" if pct >= 95 else "warn" if pct >= 90 else "fail"
    lost = _round(p + g, 3)
    return {"status": status, "available": available, "pct": pct, "lost": lost,
            "message": f"{_fmt(available)} V reaches the load ({_fmt(pct)}% of {_fmt(src)} V); {_fmt(lost)} V is lost in wiring/connections."}


# ---------------------------------------------------------------------------
# Battery / starting / charging
# ---------------------------------------------------------------------------
def battery_soc(volts, type="flooded", table=None, pass_pct=SOC_PASS, warn_pct=SOC_WARN) -> dict:  # noqa: A002
    v = _num("volts", volts)
    table = table or SOC_TABLES[type]
    full = table[-1][0]
    if v > full + 0.4:
        return {"status": "warn", "soc_pct": 100, "volts": v,
                "message": f"{_fmt(v)} V is above a rested battery's voltage — surface charge, a charger, or the engine "
                           "running. Rest the battery (≥1 h, or switch the headlights on for a minute, then off) and re-measure."}
    if v <= table[0][0]:
        soc = 0.0
    elif v >= full:
        soc = 100.0
    else:
        soc = 0.0
        for (v0, s0), (v1, s1) in zip(table, table[1:]):
            if v <= v1:
                soc = s0 + (v - v0) / (v1 - v0) * (s1 - s0)
                break
    soc = int(math.floor(soc + 0.5))
    status = "pass"
    msg = f"About {soc}% charged ({'AGM' if type == 'agm' else 'flooded'} battery, ~25 °C)."
    if soc < warn_pct:
        status = "fail"
        msg += " Discharged — charge fully, then load/conductance test before condemning it or the charging system."
    elif soc < pass_pct:
        status = "warn"
        msg += " Partly discharged — charge before load testing or diagnosing starting/charging faults."
    return {"status": status, "soc_pct": soc, "volts": v, "message": msg}


def cranking_min_voltage(temp_c=None, table=CRANKING_TEMP_TABLE, base=CRANKING_MIN) -> float:
    if temp_c is None:
        return base
    for t, v in table:
        if temp_c >= t:
            return v
    return table[-1][1]


def cranking_test(min_volts, temp_c=None, limit=None, warn_margin=CRANKING_WARN_MARGIN) -> dict:
    v = _num("min_volts", min_volts)
    limit = limit if limit is not None else cranking_min_voltage(temp_c)
    if v >= 12.0:
        return {"status": "warn", "min_volts": v, "limit": limit,
                "message": f"Only dropped to {_fmt(v)} V while cranking. If the engine cranked normally that's fine; if it did "
                           "NOT crank, current isn't flowing — suspect the starter control circuit, solenoid, or an open "
                           "in the starter feed rather than the battery."}
    if v < limit:
        return {"status": "fail", "min_volts": v, "limit": limit,
                "message": f"{_fmt(v)} V is below the {_fmt(limit)} V cranking minimum. Check battery state of charge first; if the "
                           "battery is charged and passes a load test, voltage-drop test the starter feed and ground, "
                           "then suspect the starter (high current draw)."}
    if v < limit + warn_margin:
        return {"status": "warn", "min_volts": v, "limit": limit,
                "message": f"{_fmt(v)} V is only just above the {_fmt(limit)} V minimum — battery or cables are marginal."}
    return {"status": "pass", "min_volts": v, "limit": limit,
            "message": f"{_fmt(v)} V stays above the {_fmt(limit)} V cranking minimum."}


def charging_test(volts, smart=False, min=None, max=None, smart_min=None, smart_max=None) -> dict:  # noqa: A002
    v = _num("volts", volts)
    lo = CHARGING["min"] if min is None else min
    hi = CHARGING["max"] if max is None else max
    smin = CHARGING["smart_min"] if smart_min is None else smart_min
    smax = CHARGING["smart_max"] if smart_max is None else smart_max
    base = {"volts": v, "min": lo, "max": hi}
    if v < lo:
        if smart and v >= smin:
            return {**base, "status": "warn",
                    "message": f"{_fmt(v)} V is low for a conventional system, but smart/ECM-controlled charging deliberately "
                               "drops to ~12.5–13.2 V when the battery is full. Switch on heavy loads (headlights, blower, "
                               "rear demister) — voltage should rise — or check the commanded charging voltage with a scan tool."}
        return {**base, "status": "fail",
                "message": f"{_fmt(v)} V is below {_fmt(lo)} V — undercharging. Check the drive belt, alternator output/ground voltage "
                           "drop, fusible links, and alternator control circuit."}
    if v > hi:
        if smart and v <= smax:
            return {**base, "status": "warn",
                    "message": f"{_fmt(v)} V is above {_fmt(hi)} V. Some smart systems briefly charge higher (cold battery, recovery "
                               "mode); if it stays high, suspect regulator/control."}
        return {**base, "status": "fail",
                "message": f"{_fmt(v)} V is above {_fmt(hi)} V — overcharging. Suspect the voltage regulator or its sense/control "
                           "circuit; overcharging damages batteries and electronics."}
    return {**base, "status": "pass", "message": f"{_fmt(v)} V is within the {_fmt(lo)}–{_fmt(hi)} V charging range."}


def ripple_test(ac_volts, pass_=None, warn=None) -> dict:
    v = abs(_num("ac_volts", ac_volts))
    p = RIPPLE["pass"] if pass_ is None else pass_
    w = RIPPLE["warn"] if warn is None else warn
    mv = int(math.floor(v * 1000 + 0.5))
    if v > w:
        return {"status": "fail", "ac_volts": v,
                "message": f"{mv} mV AC ripple — excessive. Likely a failed rectifier diode or stator winding in the alternator."}
    if v > p:
        return {"status": "warn", "ac_volts": v,
                "message": f"{mv} mV AC ripple — elevated. Re-test at ~2000 rpm with loads on; a weak diode may be starting to fail."}
    return {"status": "pass", "ac_volts": v,
            "message": f"{mv} mV AC ripple is within the {int(math.floor(p * 1000 + 0.5))} mV guideline."}


# ---------------------------------------------------------------------------
# Parasitic draw
# ---------------------------------------------------------------------------
def parasitic_draw(milliamps, limit_ma=None, warn_ma=None, battery_ah=60) -> dict:
    ma = _num("milliamps", milliamps)
    limit = PARASITIC["limit_ma"] if limit_ma is None else limit_ma
    warn = max(limit, PARASITIC["warn_ma"] if warn_ma is None else warn_ma)
    days = _round(battery_ah * 0.5 / (ma / 1000) / 24, 1) if ma > 0 else None
    tail = f" A {_fmt(battery_ah)} Ah battery would be at ~50% after about {_fmt(days)} days." if days is not None else ""
    base = {"milliamps": ma, "limit_ma": limit, "days_to50": days}
    if ma > warn:
        return {**base, "status": "fail",
                "message": f"{_fmt(ma)} mA is excessive (guideline {_fmt(limit)} mA, some newer vehicles allow up to ~{_fmt(warn)} mA). "
                           "Confirm modules are asleep, then find the circuit with fuse voltage drop." + tail}
    if ma > limit:
        return {**base, "status": "warn",
                "message": f"{_fmt(ma)} mA is above the {_fmt(limit)} mA guideline — acceptable on some modern vehicles; check the "
                           "maker's spec and that every module has gone to sleep." + tail}
    return {**base, "status": "pass", "message": f"{_fmt(ma)} mA is within the {_fmt(limit)} mA guideline (typical 20–50 mA)." + tail}


def sleep_check(elapsed_minutes, expected_minutes=SLEEP_EXPECTED_MIN) -> dict:
    e = _num("elapsed_minutes", elapsed_minutes)
    if e < expected_minutes:
        rem = _round(expected_minutes - e, 1)
        return {"status": "info", "remaining": rem,
                "message": f"Wait about {_fmt(rem)} more min before trusting the reading — modules can stay awake 20–60+ min after "
                           "lock-up (don't open doors or wake the car while you wait)."}
    return {"status": "pass", "remaining": 0, "message": "Modules should be asleep now — take the draw reading."}


def fuse_drop_current(millivolts, type, rating, table=None, resistance_mohm=None) -> dict:  # noqa: A002
    mv = abs(_num("millivolts", millivolts))
    table = table or FUSE_RESISTANCE_MOHM
    try:
        key = _fmt(float(rating))
    except (TypeError, ValueError):
        key = str(rating)
    r = resistance_mohm if resistance_mohm is not None else table.get(type, {}).get(key)
    if r is None or not isinstance(r, (int, float)) or r <= 0:
        raise ValueError(f"no resistance value for {type} {key} A fuse — enter one")
    amps = mv / r  # mV / mΩ = A
    ma = _round(amps * 1000, 1)
    status = "info" if ma < 5 else "warn"
    msg = (f"{_fmt(mv)} mV across a {key} A {type} fuse (~{_fmt(r)} mΩ) ≈ {_fmt(ma)} mA flowing in that circuit "
           "(approximate — fuse resistance varies).")
    msg += (" Essentially no current: this circuit is probably not the draw." if ma < 5
            else " This circuit is drawing current — unplug/isolate its loads to find the culprit.")
    return {"status": status, "milliamps": ma, "amps": _round(amps, 4), "resistance_mohm": r, "message": msg}


# ---------------------------------------------------------------------------
# CAN bus
# ---------------------------------------------------------------------------
def can_termination(ohms, t=None) -> dict:
    t = t or CAN
    if ohms is None or (isinstance(ohms, (int, float)) and ohms >= t["open_above"]):
        return {"status": "fail", "verdict": "open",
                "message": "Open circuit (OL) between pins 6 and 14 — both terminators missing or an open in the CAN "
                           "wiring to the DLC. Some vehicles route the DLC through a gateway, so check the wiring diagram."}
    r = _num("ohms", ohms)
    rs = _fmt(r)
    if r < t["short_below"]:
        return {"status": "fail", "verdict": "short", "ohms": r,
                "message": f"{rs} Ω — CAN-H and CAN-L are shorted together (or to each other through a failed module)."}
    if t["normal"][0] <= r <= t["normal"][1]:
        return {"status": "pass", "verdict": "normal", "ohms": r,
                "message": f"{rs} Ω — normal: two 120 Ω terminators in parallel (~60 Ω)."}
    if t["one_terminator"][0] <= r <= t["one_terminator"][1]:
        return {"status": "fail", "verdict": "one_terminator", "ohms": r,
                "message": f"{rs} Ω — only one terminator seen: a terminating module is disconnected/failed or a bus "
                           "wire is open on one branch."}
    if r < t["normal"][0]:
        return {"status": "warn", "verdict": "low", "ohms": r,
                "message": f"{rs} Ω — lower than 60 Ω: an extra terminator (e.g. ~40 Ω = three) or a partial short between H and L."}
    return {"status": "warn", "verdict": "high", "ohms": r,
            "message": f"{rs} Ω — between normal and single-terminator values: high resistance in a bus wire or connector "
                       "(corrosion, spread terminal)."}


def can_voltages(can_h, can_l, t=None) -> dict:
    t = t or CAN
    h, l = _num("can_h", can_h), _num("can_l", can_l)  # noqa: E741
    issues, status = [], "pass"
    if h < 0.5:
        issues.append("CAN-H near 0 V — shorted to ground (or bus not powered)."); status = "fail"
    elif h > 5.5:
        issues.append("CAN-H near battery voltage — shorted to power."); status = "fail"
    if l < 0.5:
        issues.append("CAN-L near 0 V — shorted to ground."); status = "fail"
    elif l > 5.5:
        issues.append("CAN-L near battery voltage — shorted to power."); status = "fail"
    if status == "pass" and abs(h - l) < 0.05:
        status = "warn"
        issues.append(f"H and L both read ~{_fmt(_round((h + l) / 2, 2))} V: normal for an idle/asleep bus (recessive ~{_fmt(t['idle'])} V), "
                      "but if the bus should be active, suspect H shorted to L — confirm with the resistance test.")
    if status == "pass":
        if not (t["h_range"][0] <= h <= t["h_range"][1]):
            status = "warn"; issues.append(f"CAN-H {_fmt(h)} V is outside the expected {_fmt(t['h_range'][0])}–{_fmt(t['h_range'][1])} V.")
        if not (t["l_range"][0] <= l <= t["l_range"][1]):
            status = "warn"; issues.append(f"CAN-L {_fmt(l)} V is outside the expected {_fmt(t['l_range'][0])}–{_fmt(t['l_range'][1])} V.")
    s = _round(h + l, 2)
    msg = (f"CAN-H {_fmt(h)} V / CAN-L {_fmt(l)} V look normal for an active bus (sum {_fmt(s)} V, ideally ≈5 V)." if status == "pass"
           else " ".join(issues))
    return {"status": status, "can_h": h, "can_l": l, "sum": s, "message": msg}


# ---------------------------------------------------------------------------
# Sensors
# ---------------------------------------------------------------------------
def three_wire_sensor(ref, signal, ground_drop, s=None) -> dict:
    s = s or SENSOR
    ref, sig, gd = _num("ref", ref), _num("signal", signal), abs(_num("ground_drop", ground_drop))
    checks = []
    d_ref = abs(ref - s["ref_nominal"])
    if ref < 0.5:
        checks.append(("reference", "fail", f"Reference {_fmt(ref)} V — open reference wire or reference shorted to ground."))
    elif ref > s["ref_nominal"] + 2:
        checks.append(("reference", "fail", f"Reference {_fmt(ref)} V — shorted to battery voltage."))
    elif d_ref <= s["ref_pass"]:
        checks.append(("reference", "pass", f"Reference {_fmt(ref)} V OK."))
    elif d_ref <= s["ref_warn"]:
        checks.append(("reference", "warn", f"Reference {_fmt(ref)} V is off-nominal ({_fmt(s['ref_nominal'])} V ±{_fmt(s['ref_pass'])})."))
    else:
        checks.append(("reference", "fail", f"Reference {_fmt(ref)} V is out of range — check the ECU supply/ground and the reference circuit."))
    if gd <= s["ground_pass"]:
        checks.append(("ground", "pass", f"Sensor ground drop {_fmt(gd)} V OK."))
    elif gd <= s["ground_warn"]:
        checks.append(("ground", "warn", f"Sensor ground drop {_fmt(gd)} V is marginal (≤{_fmt(s['ground_pass'])} V expected)."))
    else:
        checks.append(("ground", "fail", f"Sensor ground drop {_fmt(gd)} V — poor ground; the ECU will read a wrong signal."))
    if sig < s["signal_min"]:
        checks.append(("signal", "fail", f"Signal {_fmt(sig)} V — near 0: signal shorted to ground, open signal wire, or no reference."))
    elif sig > s["signal_max"]:
        checks.append(("signal", "fail", f"Signal {_fmt(sig)} V — at/near reference: open sensor ground, open signal or signal shorted to reference."))
    else:
        checks.append(("signal", "pass", f"Signal {_fmt(sig)} V is in the plausible {_fmt(s['signal_min'])}–{_fmt(s['signal_max'])} V range."))
    status = max((c[1] for c in checks), key=_ORDER.index)
    return {"status": status, "checks": [{"name": n, "status": st, "message": m} for n, st, m in checks],
            "message": " ".join(c[2] for c in checks)}


def compare_readings(meter, scan, tol_pct=None, tol_abs=None) -> dict:
    m, sc = _num("meter", meter), _num("scan", scan)
    tp = COMPARE["tol_pct"] if tol_pct is None else tol_pct
    ta = COMPARE["tol_abs"] if tol_abs is None else tol_abs
    diff = _round(sc - m, 3)
    pct = _round(abs(diff) / abs(m) * 100, 1) if m != 0 else (0 if diff == 0 else 100)
    ok = abs(diff) <= ta or pct <= tp
    return {"status": "pass" if ok else "fail", "diff": diff, "pct": pct,
            "message": (f"Meter and scan tool agree (Δ {_fmt(diff)}, {_fmt(pct)}%)." if ok else
                        f"Meter and scan tool disagree by {_fmt(diff)} ({_fmt(pct)}%) — if the meter reading at the sensor is right, "
                        "the fault is in the wiring between sensor and ECU or the ECU input.")}


# camelCase aliases matching the TypeScript names (used by the shared-vector tests)
TS_NAMES = {
    "voltageDrop": voltage_drop, "circuitBudget": circuit_budget, "batterySoc": battery_soc,
    "crankingTest": cranking_test, "chargingTest": charging_test, "rippleTest": ripple_test,
    "parasiticDraw": parasitic_draw, "sleepCheck": sleep_check, "fuseDropCurrent": fuse_drop_current,
    "canTermination": can_termination, "canVoltages": can_voltages, "threeWireSensor": three_wire_sensor,
    "compareReadings": compare_readings,
}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def _print(result: dict, as_json: bool) -> int:
    if as_json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        tag = {"pass": "PASS", "warn": "WARN", "fail": "FAIL", "info": "INFO"}[result["status"]]
        print(f"[{tag}] {result['message']}")
        print(f"       ({GUIDELINE_NOTE})")
    return {"pass": 0, "info": 0, "warn": 1, "fail": 2}[result["status"]]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="electrical_diag", description="CarTune vehicle electrical diagnostics calculators. "
                                "Exit code: 0 pass/info, 1 warn, 2 fail. " + GUIDELINE_NOTE)
    p.add_argument("--json", action="store_true", help="print the full result as JSON")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="print the full result as JSON")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("voltage-drop", parents=[common], help="judge a loaded-circuit voltage drop")
    s.add_argument("--reading", type=float, required=True, help="measured drop in volts (circuit ON and loaded)")
    s.add_argument("--circuit", choices=sorted(VOLTAGE_DROP), default="ground")
    s.add_argument("--not-loaded", action="store_true", help="reading was taken without the circuit loaded")
    s.add_argument("--pass-v", type=float, help="override pass limit (V)")
    s.add_argument("--warn-v", type=float, help="override warn limit (V)")

    s = sub.add_parser("budget", parents=[common], help="voltage available at the load after both drops")
    s.add_argument("--source", type=float, required=True)
    s.add_argument("--power-drop", type=float, required=True)
    s.add_argument("--ground-drop", type=float, required=True)

    s = sub.add_parser("battery", parents=[common], help="resting voltage → state of charge")
    s.add_argument("--volts", type=float, required=True)
    s.add_argument("--type", choices=["flooded", "agm"], default="flooded")

    s = sub.add_parser("cranking", parents=[common], help="minimum voltage while cranking")
    s.add_argument("--min-volts", type=float, required=True)
    s.add_argument("--temp-c", type=float, help="battery temperature (°C) for the temperature-corrected minimum")
    s.add_argument("--limit", type=float, help="override minimum volts")

    s = sub.add_parser("charging", parents=[common], help="charging voltage, engine running")
    s.add_argument("--volts", type=float, required=True)
    s.add_argument("--smart", action="store_true", help="vehicle has smart / ECM-controlled charging")
    s.add_argument("--min", type=float); s.add_argument("--max", type=float)

    s = sub.add_parser("ripple", parents=[common], help="alternator AC ripple (meter on AC volts at the alternator output)")
    s.add_argument("--ac-volts", type=float, required=True)

    s = sub.add_parser("parasitic", parents=[common], help="key-off parasitic draw")
    s.add_argument("--milliamps", type=float, required=True)
    s.add_argument("--limit-ma", type=float); s.add_argument("--warn-ma", type=float)
    s.add_argument("--battery-ah", type=float, default=60)

    s = sub.add_parser("sleep", parents=[common], help="module sleep wait check")
    s.add_argument("--elapsed-min", type=float, required=True)
    s.add_argument("--expected-min", type=float, default=SLEEP_EXPECTED_MIN)

    s = sub.add_parser("fuse-drop", parents=[common], help="mV across a fuse → current in that circuit")
    s.add_argument("--millivolts", type=float, required=True)
    s.add_argument("--type", choices=sorted(FUSE_RESISTANCE_MOHM), required=True)
    s.add_argument("--rating", required=True, help="fuse rating in amps, e.g. 7.5 or 10")
    s.add_argument("--resistance-mohm", type=float, help="use your own fuse resistance (mΩ)")

    sub.add_parser("fuse-table", parents=[common], help="print the approximate fuse resistance table")

    s = sub.add_parser("can-termination", parents=[common], help="resistance DLC pin 6 ↔ 14, battery disconnected")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--ohms", type=float); g.add_argument("--open", action="store_true", help="meter reads OL")

    s = sub.add_parser("can-voltage", parents=[common], help="CAN-H / CAN-L DC voltage to ground, ignition on")
    s.add_argument("--can-h", type=float, required=True); s.add_argument("--can-l", type=float, required=True)

    s = sub.add_parser("sensor", parents=[common], help="3-wire sensor check (5 V ref, signal, ground)")
    s.add_argument("--ref", type=float, required=True); s.add_argument("--signal", type=float, required=True)
    s.add_argument("--ground-drop", type=float, required=True)

    s = sub.add_parser("compare", parents=[common], help="meter vs scan-tool reading")
    s.add_argument("--meter", type=float, required=True); s.add_argument("--scan", type=float, required=True)
    s.add_argument("--tol-pct", type=float)
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.cmd == "fuse-table":
            if args.json:
                print(json.dumps(FUSE_RESISTANCE_MOHM, indent=2))
            else:
                print("Approximate fuse cold resistance (mΩ) — values vary by maker/temperature:")
                for t, rows in FUSE_RESISTANCE_MOHM.items():
                    print(f"  {FUSE_TYPE_LABELS[t]:<26} " + "  ".join(f"{k}A={v}" for k, v in rows.items()))
            return 0
        if args.cmd == "voltage-drop":
            th = None
            if args.pass_v is not None or args.warn_v is not None:
                base = VOLTAGE_DROP[args.circuit]
                th = {"pass": args.pass_v if args.pass_v is not None else base["pass"],
                      "warn": args.warn_v if args.warn_v is not None else base["warn"]}
            r = voltage_drop(args.reading, args.circuit, loaded=not args.not_loaded, thresholds=th)
        elif args.cmd == "budget":
            r = circuit_budget(args.source, args.power_drop, args.ground_drop)
        elif args.cmd == "battery":
            r = battery_soc(args.volts, type=args.type)
        elif args.cmd == "cranking":
            r = cranking_test(args.min_volts, temp_c=args.temp_c, limit=args.limit)
        elif args.cmd == "charging":
            r = charging_test(args.volts, smart=args.smart, min=args.min, max=args.max)
        elif args.cmd == "ripple":
            r = ripple_test(args.ac_volts)
        elif args.cmd == "parasitic":
            r = parasitic_draw(args.milliamps, limit_ma=args.limit_ma, warn_ma=args.warn_ma, battery_ah=args.battery_ah)
        elif args.cmd == "sleep":
            r = sleep_check(args.elapsed_min, args.expected_min)
        elif args.cmd == "fuse-drop":
            r = fuse_drop_current(args.millivolts, args.type, args.rating, resistance_mohm=args.resistance_mohm)
        elif args.cmd == "can-termination":
            r = can_termination(None if args.open else args.ohms)
        elif args.cmd == "can-voltage":
            r = can_voltages(args.can_h, args.can_l)
        elif args.cmd == "sensor":
            r = three_wire_sensor(args.ref, args.signal, args.ground_drop)
        elif args.cmd == "compare":
            r = compare_readings(args.meter, args.scan, tol_pct=args.tol_pct)
        else:  # pragma: no cover - argparse enforces choices
            raise ValueError(args.cmd)
    except ValueError as e:
        print(f"error: {e}", file=sys.stderr)
        return 3
    return _print(r, args.json)


if __name__ == "__main__":
    sys.exit(main())

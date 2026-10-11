/**
 * Plain-English descriptions for common GENERIC (SAE J2012 / ISO 15031-6)
 * DTCs, plus a structural fallback that explains any code from its format.
 * Manufacturer-specific codes (P1xxx, B1xxx, C1xxx, U1xxx, etc.) mean
 * different things per maker — the fallback says so rather than guessing.
 */
const cyl = (n: number) => `Cylinder ${n} misfire detected`;
const inj = (n: number) => `Injector circuit/open – cylinder ${n}`;
const coil = (n: number) => `Ignition coil ${"ABCDEFGHIJKL"[n - 1]} primary/secondary circuit`;

export const DTC_DESCRIPTIONS: Record<string, string> = {
  P0010: "Intake camshaft position actuator circuit (Bank 1)",
  P0011: "Intake camshaft position – timing over-advanced or system performance (Bank 1)",
  P0012: "Intake camshaft position – timing over-retarded (Bank 1)",
  P0016: "Crankshaft position – camshaft position correlation (Bank 1 Sensor A)",
  P0030: "HO2S heater control circuit (Bank 1 Sensor 1)",
  P0036: "HO2S heater control circuit (Bank 1 Sensor 2)",
  P0087: "Fuel rail/system pressure too low",
  P0088: "Fuel rail/system pressure too high",
  P0100: "Mass or volume air flow circuit",
  P0101: "Mass or volume air flow circuit range/performance",
  P0102: "Mass or volume air flow circuit low input",
  P0103: "Mass or volume air flow circuit high input",
  P0106: "Manifold absolute pressure/barometric pressure circuit range/performance",
  P0107: "Manifold absolute pressure/barometric pressure circuit low input",
  P0108: "Manifold absolute pressure/barometric pressure circuit high input",
  P0112: "Intake air temperature sensor circuit low input",
  P0113: "Intake air temperature sensor circuit high input",
  P0115: "Engine coolant temperature circuit",
  P0116: "Engine coolant temperature circuit range/performance",
  P0117: "Engine coolant temperature circuit low input",
  P0118: "Engine coolant temperature circuit high input",
  P0120: "Throttle/pedal position sensor/switch A circuit",
  P0121: "Throttle/pedal position sensor/switch A circuit range/performance",
  P0122: "Throttle/pedal position sensor/switch A circuit low input",
  P0123: "Throttle/pedal position sensor/switch A circuit high input",
  P0125: "Insufficient coolant temperature for closed loop fuel control",
  P0128: "Coolant thermostat (coolant temperature below thermostat regulating temperature)",
  P0130: "O2 sensor circuit (Bank 1 Sensor 1)",
  P0131: "O2 sensor circuit low voltage (Bank 1 Sensor 1)",
  P0132: "O2 sensor circuit high voltage (Bank 1 Sensor 1)",
  P0133: "O2 sensor circuit slow response (Bank 1 Sensor 1)",
  P0134: "O2 sensor circuit no activity detected (Bank 1 Sensor 1)",
  P0135: "O2 sensor heater circuit (Bank 1 Sensor 1)",
  P0137: "O2 sensor circuit low voltage (Bank 1 Sensor 2)",
  P0138: "O2 sensor circuit high voltage (Bank 1 Sensor 2)",
  P0141: "O2 sensor heater circuit (Bank 1 Sensor 2)",
  P0151: "O2 sensor circuit low voltage (Bank 2 Sensor 1)",
  P0155: "O2 sensor heater circuit (Bank 2 Sensor 1)",
  P0171: "System too lean (Bank 1)",
  P0172: "System too rich (Bank 1)",
  P0174: "System too lean (Bank 2)",
  P0175: "System too rich (Bank 2)",
  P0191: "Fuel rail pressure sensor circuit range/performance",
  P0200: "Injector circuit/open",
  P0217: "Engine coolant over-temperature condition",
  P0219: "Engine overspeed condition",
  P0220: "Throttle/pedal position sensor/switch B circuit",
  P0221: "Throttle/pedal position sensor/switch B circuit range/performance",
  P0222: "Throttle/pedal position sensor/switch B circuit low input",
  P0223: "Throttle/pedal position sensor/switch B circuit high input",
  P0230: "Fuel pump primary circuit",
  P0234: "Turbocharger/supercharger overboost condition",
  P0299: "Turbocharger/supercharger underboost",
  P0300: "Random/multiple cylinder misfire detected",
  P0325: "Knock sensor 1 circuit (Bank 1 or single sensor)",
  P0327: "Knock sensor 1 circuit low input (Bank 1 or single sensor)",
  P0328: "Knock sensor 1 circuit high input (Bank 1 or single sensor)",
  P0335: "Crankshaft position sensor A circuit",
  P0336: "Crankshaft position sensor A circuit range/performance",
  P0340: "Camshaft position sensor A circuit (Bank 1 or single sensor)",
  P0341: "Camshaft position sensor A circuit range/performance (Bank 1 or single sensor)",
  P0380: "Glow plug/heater circuit A",
  P0401: "Exhaust gas recirculation (EGR) flow insufficient detected",
  P0402: "Exhaust gas recirculation (EGR) flow excessive detected",
  P0403: "Exhaust gas recirculation (EGR) control circuit",
  P0420: "Catalyst system efficiency below threshold (Bank 1)",
  P0430: "Catalyst system efficiency below threshold (Bank 2)",
  P0440: "Evaporative emission system",
  P0441: "Evaporative emission system incorrect purge flow",
  P0442: "Evaporative emission system leak detected (small leak)",
  P0443: "Evaporative emission system purge control valve circuit",
  P0446: "Evaporative emission system vent control circuit",
  P0455: "Evaporative emission system leak detected (large leak)",
  P0456: "Evaporative emission system leak detected (very small leak)",
  P0480: "Fan 1 control circuit",
  P0500: "Vehicle speed sensor A",
  P0505: "Idle air control system",
  P0506: "Idle air control system RPM lower than expected",
  P0507: "Idle air control system RPM higher than expected",
  P0520: "Engine oil pressure sensor/switch A circuit",
  P0560: "System voltage",
  P0561: "System voltage unstable",
  P0562: "System voltage low",
  P0563: "System voltage high",
  P0600: "Serial communication link",
  P0601: "Internal control module memory checksum error",
  P0602: "Control module programming error",
  P0603: "Internal control module keep alive memory (KAM) error",
  P0606: "Control module processor",
  P0620: "Generator control circuit",
  P0621: "Generator lamp/L terminal control circuit",
  P0622: "Generator field/F terminal control circuit",
  P0641: "Sensor reference voltage A circuit/open",
  P0651: "Sensor reference voltage B circuit/open",
  P0700: "Transmission control system (MIL request)",
  P0705: "Transmission range sensor A circuit (PRNDL input)",
  P0715: "Input/turbine speed sensor A circuit",
  P0720: "Output speed sensor circuit",
  P0730: "Incorrect gear ratio",
  P0740: "Torque converter clutch solenoid circuit/open",
  P0741: "Torque converter clutch solenoid circuit performance/stuck off",
  P0750: "Shift solenoid A",
  P0755: "Shift solenoid B",
  P2096: "Post catalyst fuel trim system too lean (Bank 1)",
  P2097: "Post catalyst fuel trim system too rich (Bank 1)",
  P2101: "Throttle actuator control motor circuit range/performance",
  P2135: "Throttle/pedal position sensor/switch A/B voltage correlation",
  P2138: "Throttle/pedal position sensor/switch D/E voltage correlation",
  P2195: "O2 sensor signal biased/stuck lean (Bank 1 Sensor 1)",
  P2196: "O2 sensor signal biased/stuck rich (Bank 1 Sensor 1)",
  P2263: "Turbocharger/supercharger boost system performance",
  P2002: "Diesel particulate filter efficiency below threshold (Bank 1)",
  P2463: "Diesel particulate filter restriction – soot accumulation",
  U0001: "High speed CAN communication bus",
  U0073: "Control module communication bus A off",
  U0100: "Lost communication with ECM/PCM A",
  U0101: "Lost communication with TCM",
  U0121: "Lost communication with anti-lock brake system (ABS) control module",
  U0140: "Lost communication with body control module",
  U0151: "Lost communication with restraints control module",
  U0155: "Lost communication with instrument panel cluster (IPC) control module",
  U0401: "Invalid data received from ECM/PCM A",
};
for (let n = 1; n <= 12; n++) DTC_DESCRIPTIONS[`P03${String(n).padStart(2, "0")}`] = cyl(n);
for (let n = 1; n <= 8; n++) DTC_DESCRIPTIONS[`P020${n}`] = inj(n);
for (let n = 1; n <= 8; n++) DTC_DESCRIPTIONS[`P035${n}`] = coil(n);

const SYSTEMS: Record<string, string> = { P: "Powertrain", C: "Chassis", B: "Body", U: "Network/communication" };
const P_SUBSYSTEM: Record<string, string> = {
  "0": "fuel & air metering / auxiliary emission controls", "1": "fuel & air metering", "2": "fuel & air metering (injector circuit)",
  "3": "ignition system or misfire", "4": "auxiliary emission controls", "5": "vehicle speed, idle control & auxiliary inputs",
  "6": "computer & auxiliary outputs", "7": "transmission", "8": "transmission", "9": "transmission", A: "hybrid propulsion",
  B: "hybrid propulsion", C: "hybrid propulsion",
};

export function isGeneric(code: string): boolean {
  const c = code.toUpperCase();
  if (c[0] === "P") return c[1] === "0" || c[1] === "2" || (c[1] === "3" && parseInt(c[2], 16) >= 4);
  return c[1] === "0" || c[1] === "3";
}

export function describeDtc(code: string): { code: string; description: string; system: string; generic: boolean; known: boolean } {
  const c = code.trim().toUpperCase();
  const system = SYSTEMS[c[0]] ?? "Unknown";
  const generic = /^[PCBU][0-3][0-9A-F]{3}$/.test(c) ? isGeneric(c) : false;
  const known = c in DTC_DESCRIPTIONS;
  let description = DTC_DESCRIPTIONS[c];
  if (!description) {
    const sub = c[0] === "P" ? P_SUBSYSTEM[c[2]] : undefined;
    description = `${system}${sub ? " – " + sub : ""} – ${generic ? "generic code (look up the SAE J2012 definition)" : "manufacturer-specific code (meaning depends on the maker — check service info)"}`;
  }
  return { code: c, description, system, generic, known };
}

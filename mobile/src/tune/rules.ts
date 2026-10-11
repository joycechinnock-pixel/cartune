/**
 * CarTune tune-rules engine. Pure, dependency-free, shared by the phone app
 * (TuneScreen) and the web preview.
 *
 * Every slider is relative to the vehicle's stock calibration, so the same
 * rules work for any make/model: "+3° timing" means 3° more than whatever
 * that ECU shipped with. Zone thresholds ADAPT to the vehicle setup (fuel,
 * hardware upgrades) and to the other sliders (e.g. more boost shrinks the
 * safe timing range).
 *
 * IMPORTANT: threshold numbers are general-purpose starting points, not
 * verified limits for any specific engine. Per-platform overrides belong in
 * the ECU profile. The final gate is always real logged pull data
 * (knock / AFR / coolant) checked by ValidatorAgent before any flash.
 */

export type Zone = "green" | "yellow" | "orange" | "red";
export type EngineType = "na_petrol" | "turbo_petrol" | "turbo_diesel";
export type Fuel = "91" | "95" | "98" | "E85" | "diesel";
export type Skill = "simple" | "standard" | "expert";
export type Segment = "Fuel" | "Timing" | "Boost" | "Throttle" | "Limits" | "Transmission" | "Brakes & Traction" | "Cooling" | "Emissions";

export interface Upgrades {
  intercooler: boolean;   // bigger/better intercooler
  fuelSystem: boolean;    // injectors + pump sized for the power
  internals: boolean;     // forged internals / uprated valve springs
  cooling: boolean;       // bigger radiator / oil cooler
  driveline: boolean;     // uprated clutch / transmission / converter
}

export interface Context { engine: EngineType; fuel: Fuel; upgrades: Upgrades; skill: Skill; }
export type Values = Record<string, number>;

export type Action =
  | { kind: "set"; id: string; value: number }
  | { kind: "fuel"; value: Fuel }
  | { kind: "upgrade"; key: keyof Upgrades }
  | { kind: "toggle"; id: string; value: boolean };
export interface Advice { text: string; action: Action; why?: string; }

interface Bands { g: number; y: number; o: number; low?: number; }
interface Words { simple: string; expert: string; }

export interface SettingDef {
  id: string;
  segment: Segment;
  name: string;
  what: Words;                         // what this slider does
  unit: string;
  min: number; max: number; step: number; stock: number;
  level?: Skill;                       // lowest detail level that shows this slider (default "simple")
  proMin?: number; proMax?: number;    // wider "open" range unlocked at the Technically level
  stockBy?: Partial<Record<EngineType, number>>; // stock differs by engine type
  engines: EngineType[];
  format: (v: number, ctx: Context) => string;
  bands: (ctx: Context, v: Values) => Bands;
  zoneText: Record<Zone, Words>;
  lowText?: Words;                     // shown when below `low` (too far the other way)
  effect: (v: number, ctx: Context) => string;
  risks: string;                       // in-depth component implications, shown at orange/red
  balance: (ctx: Context, v: Values, b: Bands) => Advice[];
}

const u = (b: boolean) => (b ? 1 : 0);
const signed = (v: number, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d);
const PETROL: EngineType[] = ["na_petrol", "turbo_petrol"];
const ALL: EngineType[] = ["na_petrol", "turbo_petrol", "turbo_diesel"];
const OCTANE_TIMING: Record<Fuel, number> = { "91": 0, "95": 1.5, "98": 3, E85: 6, diesel: 0 };

function lambdaBands(ctx: Context, v: Values): Bands {
  const boost = ctx.engine === "turbo_petrol" ? v.boost_add ?? 0 : 0;
  const g = ctx.engine === "turbo_petrol" ? 0.82 - boost * 0.004 : 0.89;
  return { g: +g.toFixed(3), y: +(g + 0.03).toFixed(3), o: +(g + 0.06).toFixed(3), low: ctx.engine === "turbo_petrol" ? 0.72 : 0.82 };
}

function timingBands(ctx: Context, v: Values): Bands {
  const boost = ctx.engine === "turbo_petrol" ? v.boost_add ?? 0 : 0;
  const lb = lambdaBands(ctx, v);
  const lean = Math.max(0, (v.lambda_wot ?? lb.g) - lb.g) * 40;
  const g = +(OCTANE_TIMING[ctx.fuel] - boost * 0.5 - lean).toFixed(1);
  return { g, y: g + 1.5, o: g + 3 };
}

interface SlOpts {
  id: string; segment: Segment; name: string; level?: Skill; what: [string, string];
  unit: string; min: number; max: number; step: number; stock: number; stockBy?: Partial<Record<EngineType, number>>; engines: EngineType[];
  format: (v: number) => string; g: (ctx: Context, v: Values) => number; dy: number; dor: number;
  low?: number; lowText?: [string, string]; texts: [string, string][]; effect: (v: number) => string;
  risks: string; fixVerb: string; fmtFix: (v: number) => string; upgrade?: keyof Upgrades;
}
const W = (t: [string, string]): Words => ({ simple: t[0], expert: t[1] });
/** Compact builder for "higher = more stress" sliders. */
function sl(o: SlOpts): SettingDef {
  return {
    id: o.id, segment: o.segment, name: o.name, level: o.level, what: W(o.what), unit: o.unit,
    min: o.min, max: o.max, step: o.step, stock: o.stock, stockBy: o.stockBy, engines: o.engines,
    format: (v) => o.format(v),
    bands: (ctx, v) => { const g = o.g(ctx, v); return { g, y: g + o.dy, o: g + o.dy + o.dor, low: o.low }; },
    zoneText: { green: W(o.texts[0]), yellow: W(o.texts[1]), orange: W(o.texts[2]), red: W(o.texts[3]) },
    lowText: o.lowText ? W(o.lowText) : undefined,
    effect: (v) => o.effect(v), risks: o.risks,
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `${o.fixVerb} ${o.fmtFix(b.g)}`, action: { kind: "set", id: o.id, value: b.g } }];
      if (o.upgrade && !ctx.upgrades[o.upgrade]) out.push({ text: `Add ${UPGRADE_LABEL[o.upgrade]} upgrade`, action: { kind: "upgrade", key: o.upgrade } });
      return out;
    },
  };
}
const UPGRADE_LABEL: Record<keyof Upgrades, string> = { intercooler: "intercooler", fuelSystem: "fuel system", internals: "engine internals", cooling: "cooling", driveline: "driveline" };

export const SETTINGS: SettingDef[] = [
  // ---------------- Fuel ----------------
  {
    id: "lambda_wot", segment: "Fuel", name: "Full-throttle mixture",
    what: {
      simple: "How much fuel the engine gets at full throttle. Lower number = more fuel (richer, cooler, safer).",
      expert: "WOT lambda target. Richer mixtures suppress knock and cut combustion/EGT at the cost of some power and economy.",
    },
    unit: "λ", min: 0.7, max: 0.95, step: 0.01, proMin: 0.6, proMax: 1.0, stock: 0.87, stockBy: { turbo_petrol: 0.8 }, engines: PETROL,
    format: (v, ctx) => `λ ${v.toFixed(2)} (${(v * (ctx.fuel === "E85" ? 9.8 : 14.7)).toFixed(1)}:1 AFR)`,
    bands: lambdaBands,
    zoneText: {
      green: { simple: "Healthy mixture for this setup.", expert: "Within the usual safe WOT window for this induction type and boost level." },
      yellow: { simple: "A little lean. Runs fine, but a touch more fuel would add safety margin.", expert: "Slightly lean of target; margin to knock and EGT is reduced. Richen 0.01–0.02 λ." },
      orange: { simple: "Lean. The engine is running hotter than it should under load.", expert: "Lean enough to raise combustion temperature and knock tendency noticeably, especially under sustained load." },
      red: { simple: "Dangerously lean. High chance of engine damage at full throttle.", expert: "Lean WOT operation. Expect detonation, piston/ring-land and exhaust-valve damage; turbo engines are most at risk." },
    },
    lowText: { simple: "Very rich. Safe, but wastes fuel, loses power and can foul spark plugs.", expert: "Over-rich: power loss, plug fouling, oil dilution and cat loading. Lean out toward the green band." },
    effect: (v, ctx) => {
      const b = ctx.engine === "turbo_petrol" ? 0.8 : 0.87;
      if (Math.abs(v - b) < 0.015) return "Right around the common target for this engine type.";
      return v < b ? "Richer than typical: cooler and safer, slightly less power and economy." : "Leaner than typical: a little more power and economy on paper, but hotter combustion.";
    },
    risks: "Lean full-throttle running raises cylinder and exhaust temperatures. Typical failures: melted or cracked pistons and ring lands, burnt exhaust valves, cracked exhaust manifolds, and on turbo engines turbine damage from high exhaust gas temperature. Damage can happen in a single long pull, so a wideband O2 sensor and a logged pull are strongly recommended before trusting this.",
    balance: (ctx, v, b) => {
      const out: Advice[] = [{ text: `Richen to λ ${b.g.toFixed(2)}`, action: { kind: "set", id: "lambda_wot", value: b.g } }];
      if (ctx.engine === "turbo_petrol" && (v.boost_add ?? 0) > 0) out.push({ text: "Drop boost by 2 psi", action: { kind: "set", id: "boost_add", value: Math.max(0, (v.boost_add ?? 0) - 2) } });
      if (!ctx.upgrades.fuelSystem) out.push({ text: "Add fuel-system upgrade (injectors/pump) so it can actually deliver the fuel", action: { kind: "upgrade", key: "fuelSystem" } });
      return out;
    },
  },
  // ---------------- Timing ----------------
  {
    id: "timing_wot", segment: "Timing", name: "Ignition timing",
    what: {
      simple: "When the spark fires. More advance = more punch, until the engine starts to 'knock' (uncontrolled burning), which damages it.",
      expert: "WOT spark advance relative to stock. Allowable advance scales with fuel octane and falls with boost and leaner mixtures.",
    },
    unit: "°", min: -4, max: 10, step: 0.5, proMin: -10, proMax: 16, stock: 0, engines: PETROL,
    format: (v) => `${signed(v)}° vs stock`,
    bands: timingBands,
    zoneText: {
      green: { simple: "Safe for your fuel and setup.", expert: "Inside expected knock margin for this octane, boost and mixture." },
      yellow: { simple: "Close to the edge. Fine on good fuel, but little room for hot days or bad fuel.", expert: "Reduced knock margin. Heat soak, poor fuel or high intake temps may trigger knock retard." },
      orange: { simple: "Likely to knock under load. The ECU will probably pull timing back, costing power.", expert: "Expect knock activity under load; knock control will intervene and power may drop below a tamer tune." },
      red: { simple: "Very likely to damage the engine under full throttle.", expert: "Sustained detonation likely. Knock control may not react fast enough at high load." },
    },
    effect: (v) => {
      if (v < 0) return `${Math.abs(v)}° less than stock: cooler and safer, but softer response and some power and economy lost.`;
      if (v === 0) return "Stock timing.";
      if (v <= 2) return `${v}° more: crisper throttle and more mid-range torque.`;
      if (v <= 5) return `${v}° more: strong gains only if the fuel supports it; the engine now depends on fuel quality.`;
      return `${v}° more: most of the gain has already been had; extra advance mainly adds knock risk.`;
    },
    risks: "Knock (detonation) sends pressure spikes through the piston. Repeated knock cracks ring lands, breaks pistons, hammers rod bearings and can lift the head gasket. Knock sensors react after knock starts; under sustained boost or high load they may not pull timing fast enough. Hot weather, towing, and low-grade fuel all shrink the safe range further.",
    balance: (ctx, v, b) => {
      const out: Advice[] = [{ text: `Reduce timing to ${signed(b.g)}°`, action: { kind: "set", id: "timing_wot", value: b.g } }];
      const lb = lambdaBands(ctx, v);
      if ((v.lambda_wot ?? lb.g) > lb.g - 0.01) out.push({ text: `Richen mixture to λ ${(lb.g - 0.02).toFixed(2)} for extra knock margin`, action: { kind: "set", id: "lambda_wot", value: +(lb.g - 0.02).toFixed(2) } });
      if (ctx.fuel === "91" || ctx.fuel === "95") out.push({ text: "Switch to 98 fuel (raises the safe timing range)", action: { kind: "fuel", value: "98" } });
      if (ctx.engine === "turbo_petrol" && (v.boost_add ?? 0) >= 2) out.push({ text: "Drop boost by 2 psi", action: { kind: "set", id: "boost_add", value: (v.boost_add ?? 0) - 2 } });
      return out;
    },
  },
  // ---------------- Boost (petrol) ----------------
  {
    id: "boost_add", segment: "Boost", name: "Boost increase",
    what: { simple: "Extra turbo pressure over stock. More boost = more power, more heat and more strain on parts.", expert: "Target boost above stock. Safe headroom depends on intercooling, fuelling and bottom-end strength." },
    unit: "psi", min: 0, max: 15, step: 0.5, proMin: -5, proMax: 30, stock: 0, engines: ["turbo_petrol"],
    format: (v) => `+${v.toFixed(1)} psi`,
    bands: (ctx) => {
      const up = ctx.upgrades;
      const g = 2 + u(up.intercooler) * 2 + u(up.fuelSystem) * 2 + u(up.internals) * 4 - (ctx.fuel === "91" ? 1 : 0) + (ctx.fuel === "E85" && up.fuelSystem ? 2 : 0);
      return { g, y: g + 2, o: g + 4 };
    },
    zoneText: {
      green: { simple: "Within what your hardware handles comfortably.", expert: "Within the likely compressor, intercooler and fuelling headroom for this setup." },
      yellow: { simple: "Pushing the stock parts. Fine for now, but watch temperatures.", expert: "Intake temps and injector duty climb; check duty cycle and IAT in the log." },
      orange: { simple: "Beyond what the current parts are built for. Upgrades recommended.", expert: "Likely past stock intercooler efficiency and/or fuel supply; knock and lean-out risk rising." },
      red: { simple: "High risk of breaking engine or turbo parts.", expert: "Exceeds likely hardware limits: turbo overspeed, injector saturation, rod/piston stress." },
    },
    effect: (v) => (v === 0 ? "Stock boost." : v <= 3 ? `+${v} psi: a clear, usable power bump.` : v <= 7 ? `+${v} psi: big power gain; heat and fuelling become the limit.` : `+${v} psi: major gain, but heavily dependent on supporting upgrades.`),
    risks: "More boost raises cylinder pressure and intake temperature. Without supporting parts: injectors hit 100% duty and the engine goes lean, the stock intercooler heat-soaks and invites knock, the turbo can overspeed, and cast pistons, rods and head gaskets take loads they were not designed for. Clutches and automatic transmissions are often the first driveline parts to slip.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Reduce boost to +${b.g} psi`, action: { kind: "set", id: "boost_add", value: b.g } }];
      if (!ctx.upgrades.intercooler) out.push({ text: "Add intercooler upgrade", action: { kind: "upgrade", key: "intercooler" } });
      if (!ctx.upgrades.fuelSystem) out.push({ text: "Add fuel-system upgrade", action: { kind: "upgrade", key: "fuelSystem" } });
      if (!ctx.upgrades.internals) out.push({ text: "Add forged internals", action: { kind: "upgrade", key: "internals" } });
      return out;
    },
  },
  // ---------------- Diesel ----------------
  {
    id: "fuel_add", segment: "Fuel", name: "Fuel quantity increase",
    what: { simple: "Extra diesel injected. The main power maker on a diesel, but too much without enough air makes smoke and heat.", expert: "Injection quantity above stock. Must be matched by boost (air) or EGT and smoke rise sharply." },
    unit: "%", min: 0, max: 35, step: 1, proMin: -10, proMax: 70, stock: 0, engines: ["turbo_diesel"],
    format: (v) => `+${v}%`,
    bands: (ctx) => { const g = 5 + u(ctx.upgrades.intercooler) * 3 + u(ctx.upgrades.driveline) * 2; return { g, y: g + 5, o: g + 12 }; },
    zoneText: {
      green: { simple: "Good gain with low risk.", expert: "Modest fuelling increase, within typical stock-hardware tolerance." },
      yellow: { simple: "Strong gain. Keep an eye on exhaust temperature when towing.", expert: "EGT and clutch/torque-converter load rising; log EGT under sustained load." },
      orange: { simple: "A lot of extra fuel. Expect smoke and high exhaust heat unless boost and cooling match it.", expert: "High EGT risk under sustained load; clutch slip likely on stock driveline." },
      red: { simple: "Very likely to overheat pistons or the turbo, especially when towing.", expert: "Sustained operation risks piston crown damage, turbine failure and driveline failure." },
    },
    effect: (v) => (v === 0 ? "Stock fuelling." : v <= 8 ? `+${v}%: noticeably stronger pull.` : v <= 18 ? `+${v}%: big torque gain; air supply and heat now matter.` : `+${v}%: very high; only sensible with matched boost, cooling and driveline upgrades.`),
    risks: "Excess diesel without matching air raises exhaust gas temperature (EGT). Sustained high EGT melts or cracks piston crowns, damages turbine wheels and bearings, and cooks exhaust manifolds. Extra torque slips stock clutches and torque converters, especially when towing. A pyrometer (EGT gauge) is strongly recommended.",
    balance: (ctx, v, b) => {
      const out: Advice[] = [{ text: `Reduce fuel to +${b.g}%`, action: { kind: "set", id: "fuel_add", value: b.g } }];
      const needBoost = Math.ceil(Math.max(0, (v.fuel_add ?? 0) - 5) / 2.5);
      if ((v.diesel_boost_add ?? 0) < needBoost) out.push({ text: `Raise boost to +${needBoost} psi to supply the air`, action: { kind: "set", id: "diesel_boost_add", value: needBoost } });
      if (!ctx.upgrades.intercooler) out.push({ text: "Add intercooler upgrade", action: { kind: "upgrade", key: "intercooler" } });
      if (!ctx.upgrades.driveline) out.push({ text: "Add driveline upgrade (clutch/converter)", action: { kind: "upgrade", key: "driveline" } });
      return out;
    },
  },
  {
    id: "diesel_boost_add", segment: "Boost", name: "Boost increase",
    what: { simple: "Extra turbo pressure. On a diesel this supplies the air the extra fuel needs.", expert: "Boost above stock; primarily there to keep AFR and EGT under control as fuelling increases." },
    unit: "psi", min: 0, max: 12, step: 0.5, proMin: -5, proMax: 25, stock: 0, engines: ["turbo_diesel"],
    format: (v) => `+${v.toFixed(1)} psi`,
    bands: (ctx) => { const g = 2 + u(ctx.upgrades.intercooler) * 2 + u(ctx.upgrades.internals) * 3; return { g, y: g + 2, o: g + 4 }; },
    zoneText: {
      green: { simple: "Comfortable for the turbo.", expert: "Within likely turbo and head-gasket headroom." },
      yellow: { simple: "Working the turbo harder. Fine with sensible driving.", expert: "Turbo speed and intake temps rising; check for overboost codes." },
      orange: { simple: "Near the turbo's limit. Upgrades recommended.", expert: "Likely near compressor map limits; overspeed and head-gasket risk." },
      red: { simple: "High risk of turbo or head gasket failure.", expert: "Likely beyond turbo map / head clamping on stock hardware." },
    },
    effect: (v) => (v === 0 ? "Stock boost." : `+${v} psi: more air, cleaner burn and lower EGT for the same fuel.`),
    risks: "Diesel turbos can overspeed quietly and fail without warning. Excess boost also raises cylinder pressure, which stresses head gaskets and head studs. An overboost fault may put the vehicle into limp mode.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Reduce boost to +${b.g} psi`, action: { kind: "set", id: "diesel_boost_add", value: b.g } }];
      if (!ctx.upgrades.intercooler) out.push({ text: "Add intercooler upgrade", action: { kind: "upgrade", key: "intercooler" } });
      if (!ctx.upgrades.internals) out.push({ text: "Add head studs / uprated internals", action: { kind: "upgrade", key: "internals" } });
      return out;
    },
  },
  {
    id: "rail_add", segment: "Fuel", name: "Fuel rail pressure",
    what: { simple: "How hard the diesel is sprayed in. Higher = finer spray and more fuel, but more strain on the pump and injectors.", expert: "Common-rail pressure above stock; raises delivery and atomisation at the cost of pump/injector stress." },
    unit: "%", min: 0, max: 20, step: 1, proMin: -10, proMax: 40, stock: 0, engines: ["turbo_diesel"],
    format: (v) => `+${v}%`,
    bands: (ctx) => { const g = 5 + u(ctx.upgrades.fuelSystem) * 3; return { g, y: g + 3, o: g + 7 }; },
    zoneText: {
      green: { simple: "Within safe pump limits.", expert: "Within typical HP pump and injector tolerance." },
      yellow: { simple: "Working the fuel pump harder.", expert: "Pump/injector wear increases; check fuel quality and filtration." },
      orange: { simple: "Close to the fuel system's limit.", expert: "Near HP pump capacity; rail-pressure deviation faults possible." },
      red: { simple: "High risk of fuel pump or injector failure.", expert: "Likely beyond HP pump / injector design pressure." },
    },
    effect: (v) => (v === 0 ? "Stock rail pressure." : `+${v}%: finer spray and more delivery capacity.`),
    risks: "High-pressure diesel pumps and injectors are expensive and sensitive to overpressure. Failure can shed metal through the whole fuel system, requiring pump, injectors, rail and lines to be replaced.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Reduce rail pressure to +${b.g}%`, action: { kind: "set", id: "rail_add", value: b.g } }];
      if (!ctx.upgrades.fuelSystem) out.push({ text: "Add fuel-system upgrade", action: { kind: "upgrade", key: "fuelSystem" } });
      return out;
    },
  },
  {
    id: "inj_timing", segment: "Timing", name: "Injection timing",
    what: { simple: "When the diesel is injected. Earlier = more power and economy, but louder and harder on pistons.", expert: "Start-of-injection advance vs stock. Raises peak cylinder pressure and NOx." },
    unit: "°", min: -2, max: 5, step: 0.5, proMin: -6, proMax: 10, stock: 0, engines: ["turbo_diesel"],
    format: (v) => `${signed(v)}° vs stock`,
    bands: () => ({ g: 0.5, y: 1.5, o: 2.5 }),
    zoneText: {
      green: { simple: "Safe.", expert: "Near stock SOI; cylinder pressure unchanged." },
      yellow: { simple: "Slightly more power and noise.", expert: "Peak pressure up modestly; more combustion noise." },
      orange: { simple: "Harsh and hard on the engine.", expert: "High peak pressure; head gasket and piston stress." },
      red: { simple: "High risk of piston or head gasket damage.", expert: "Excessive peak cylinder pressure." },
    },
    effect: (v) => (v === 0 ? "Stock injection timing." : v < 0 ? "Retarded: quieter and cooler cylinders, hotter exhaust." : `+${v}°: more efficiency and power, more noise and cylinder pressure.`),
    risks: "Over-advanced injection raises peak cylinder pressure: cracked pistons, failed head gaskets and bearing damage.",
    balance: (_c, _v, b) => [{ text: `Reduce to ${signed(b.g)}°`, action: { kind: "set", id: "inj_timing", value: b.g } }],
  },
  // ---------------- Shared: limits ----------------
  {
    id: "rev_add", segment: "Limits", name: "Rev limiter",
    what: { simple: "How high the engine can rev. Higher revs can add top-end power but stress the valvetrain and bottom end.", expert: "Rev limit relative to stock. Valve float and rod loading set the practical ceiling." },
    unit: "rpm", min: -500, max: 1000, step: 50, proMin: -1500, proMax: 2500, stock: 0, engines: ALL,
    format: (v) => `${v > 0 ? "+" : ""}${v} rpm`,
    bands: (ctx) => { const g = u(ctx.upgrades.internals) * 500; return { g, y: g + 250, o: g + 500 }; },
    zoneText: {
      green: { simple: "Safe for your parts.", expert: "Within likely valvetrain and rod limits." },
      yellow: { simple: "A bit above stock. Usually fine.", expert: "Small margin into the stock safety buffer." },
      orange: { simple: "Beyond what stock springs and parts are made for.", expert: "Valve float and rod stress increasingly likely on stock parts." },
      red: { simple: "High risk of valve or bottom-end failure.", expert: "Likely valve-to-piston contact or rod failure on stock hardware." },
    },
    effect: (v) => (v === 0 ? "Stock rev limit." : v < 0 ? "Lower than stock: extra mechanical safety." : `+${v} rpm: more room before each shift.`),
    risks: "Over-revving can float the valves (they don't close in time) leading to valve-to-piston contact, bent valves and a destroyed head. Rod bolts and bearings load up with the square of rpm. Many engines also make no extra power above stock redline.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to ${b.g > 0 ? "+" : ""}${b.g} rpm`, action: { kind: "set", id: "rev_add", value: b.g } }];
      if (!ctx.upgrades.internals) out.push({ text: "Add uprated valve springs / internals", action: { kind: "upgrade", key: "internals" } });
      return out;
    },
  },
  {
    id: "throttle", segment: "Throttle", name: "Throttle response",
    what: { simple: "How sharply the engine reacts to the pedal. Doesn't add power, just changes the feel.", expert: "Pedal-to-throttle (or torque request) map aggressiveness." },
    unit: "%", min: 0, max: 100, step: 5, stock: 50, engines: ALL,
    format: (v) => `${v}%`,
    bands: () => ({ g: 70, y: 85, o: 95 }),
    zoneText: {
      green: { simple: "Comfortable to drive.", expert: "Linear, easy modulation." },
      yellow: { simple: "Sharp. Can feel jumpy in traffic.", expert: "Reduced low-pedal resolution." },
      orange: { simple: "Very jumpy. Hard to drive smoothly, especially off-road or in the wet.", expert: "Poor low-speed control; traction loss more likely." },
      red: { simple: "On/off feel. Easy to lose traction.", expert: "Near binary pedal; unsafe on low-grip surfaces." },
    },
    effect: (v) => (v < 40 ? "Softer than stock: smoother and easier off-road." : v <= 60 ? "Close to stock feel." : "Sharper than stock: feels quicker, same actual power."),
    risks: "Over-sharp throttle makes it hard to control wheelspin on gravel, wet roads and off-road, and can shock-load driveline parts (CV joints, diffs, clutches).",
    balance: (_c, _v, b) => [{ text: `Soften to ${b.g}%`, action: { kind: "set", id: "throttle", value: b.g } }],
  },
  // ---------------- Transmission ----------------
  {
    id: "shift_firmness", segment: "Transmission", name: "Shift firmness",
    what: { simple: "How hard automatic gear changes feel. Firmer = quicker, less slip, but harsher on parts.", expert: "Line/clutch-apply pressure during shifts." },
    unit: "%", min: 0, max: 100, step: 5, stock: 25, engines: ALL,
    format: (v) => `${v}%`,
    bands: (ctx) => { const g = 40 + u(ctx.upgrades.driveline) * 20; return { g, y: g + 20, o: g + 40 }; },
    zoneText: {
      green: { simple: "Smooth and safe.", expert: "Within stock clutch-pack tolerance." },
      yellow: { simple: "Firmer, sportier shifts.", expert: "Reduced slip time; slightly more shock load." },
      orange: { simple: "Harsh shifts. Hard on the gearbox and diffs.", expert: "High shock loading on clutch packs, shafts and diffs." },
      red: { simple: "Very harsh. Likely to break driveline parts.", expert: "Shift shock beyond stock driveline design." },
    },
    effect: (v) => (v <= 30 ? "Near-stock shift feel." : v <= 60 ? "Quicker, firmer shifts with less clutch slip." : "Race-style shifts: fast but harsh."),
    risks: "Very firm shifts shock-load gear sets, output shafts, tailshafts, diff gears and CV joints. Paired with a big power increase, this is a common way to break an otherwise healthy driveline.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Soften to ${b.g}%`, action: { kind: "set", id: "shift_firmness", value: b.g } }];
      if (!ctx.upgrades.driveline) out.push({ text: "Add driveline upgrade", action: { kind: "upgrade", key: "driveline" } });
      return out;
    },
  },
  {
    id: "torque_mgmt", segment: "Transmission", name: "Torque management reduction",
    what: { simple: "Stock ECUs cut power during gear changes to protect the gearbox. This reduces that cut.", expert: "Reduction of shift torque-management intervention." },
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: ALL,
    format: (v) => `${v}% less`,
    bands: (ctx) => { const g = 25 + u(ctx.upgrades.driveline) * 25; return { g, y: g + 20, o: g + 40 }; },
    zoneText: {
      green: { simple: "Gearbox still well protected.", expert: "Most shift-torque protection retained." },
      yellow: { simple: "Quicker shifts, a little less gearbox protection.", expert: "Higher torque through clutch packs during shifts." },
      orange: { simple: "The gearbox takes much more load each shift.", expert: "Accelerated clutch-pack wear; slip likely under power." },
      red: { simple: "Little to no gearbox protection. High failure risk.", expert: "Full torque during shifts on a stock transmission." },
    },
    effect: (v) => (v === 0 ? "Stock protection." : `${v}% less power cut during shifts: quicker, punchier shifts.`),
    risks: "Torque management exists because stock automatic transmissions can't take full engine torque mid-shift. Removing it on a stock gearbox commonly burns clutch packs within months, especially with extra power or towing.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to ${b.g}%`, action: { kind: "set", id: "torque_mgmt", value: b.g } }];
      if (!ctx.upgrades.driveline) out.push({ text: "Add driveline upgrade", action: { kind: "upgrade", key: "driveline" } });
      return out;
    },
  },
  // ---------------- Cooling ----------------
  {
    id: "fan_temp", segment: "Cooling", name: "Fan switch-on temperature",
    what: { simple: "When the radiator fan kicks in. Lower = cooler engine; higher = hotter engine.", expert: "Thermo-fan activation relative to stock." },
    unit: "°C", min: -10, max: 6, step: 1, proMin: -20, proMax: 12, stock: 0, engines: ALL,
    format: (v) => `${v > 0 ? "+" : ""}${v}°C vs stock`,
    bands: (ctx) => { const g = u(ctx.upgrades.cooling) * 2; return { g, y: g + 2, o: g + 4 }; },
    zoneText: {
      green: { simple: "Keeps the engine cool.", expert: "Stock or earlier fan activation." },
      yellow: { simple: "Runs a bit warmer.", expert: "Slightly higher running temp; less knock margin." },
      orange: { simple: "Runs hot. More knock risk and wear.", expert: "Elevated coolant temp; head and gasket stress." },
      red: { simple: "Overheating risk, especially in Aussie summer or towing.", expert: "High risk of overheat under load." },
    },
    effect: (v) => (v < 0 ? `${Math.abs(v)}°C earlier: cooler running, more knock margin, fan runs more.` : v === 0 ? "Stock fan point." : `${v}°C later: fan runs less, engine runs warmer.`),
    risks: "Higher running temperature reduces knock margin and can warp heads, blow head gaskets and break down oil faster. Hot climates, towing and slow off-road work make this much worse.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to ${b.g > 0 ? "+" : ""}${b.g}°C`, action: { kind: "set", id: "fan_temp", value: b.g } }];
      if (!ctx.upgrades.cooling) out.push({ text: "Add cooling upgrade", action: { kind: "upgrade", key: "cooling" } });
      return out;
    },
  },
  // ---------------- "With detail" level ----------------
  {
    id: "lambda_cruise", segment: "Fuel", name: "Cruise mixture", level: "standard",
    what: { simple: "Mixture at light throttle cruising. Leaner saves fuel but runs hotter.", expert: "Closed-loop / part-load lambda target. Lean-cruise raises EGT and NOx; too lean risks lean misfire and surge." },
    unit: "λ", min: 0.95, max: 1.1, step: 0.01, proMin: 0.85, proMax: 1.2, stock: 1.0, engines: PETROL,
    format: (v) => `λ ${v.toFixed(2)}`,
    bands: () => ({ g: 1.02, y: 1.05, o: 1.08, low: 0.97 }),
    zoneText: {
      green: { simple: "Normal cruise mixture.", expert: "At or near stoichiometric; catalyst and O2 feedback happy." },
      yellow: { simple: "Slightly lean. Saves a little fuel.", expert: "Mild lean-cruise; watch EGT and trims on long highway runs." },
      orange: { simple: "Lean. May surge or run hot on long trips.", expert: "Lean-cruise with rising EGT/NOx; drivability surge likely." },
      red: { simple: "Too lean. Misfires and overheating likely.", expert: "Lean-misfire territory; valve and cat damage risk." },
    },
    lowText: { simple: "Rich at cruise. Wastes fuel and can foul plugs.", expert: "Rich part-load: fuel economy loss, plug fouling, oil dilution, cat loading." },
    effect: (v) => (Math.abs(v - 1) < 0.005 ? "Stoichiometric cruise." : v > 1 ? "Leaner cruise: a little better economy, hotter exhaust." : "Richer cruise: cooler, but more fuel used."),
    risks: "Sustained lean cruise raises exhaust and valve temperatures and can overheat the catalytic converter. Lean misfire causes surging and can damage the cat.",
    balance: (_c, _v, b) => [{ text: `Set to λ ${b.g.toFixed(2)}`, action: { kind: "set", id: "lambda_cruise", value: b.g } }],
  },
  {
    id: "timing_part", segment: "Timing", name: "Part-throttle timing", level: "standard",
    what: { simple: "Spark timing when cruising or accelerating gently. Affects economy and smoothness.", expert: "Part-load spark advance relative to stock (main spark table, low-load region)." },
    unit: "°", min: -4, max: 8, step: 0.5, proMin: -10, proMax: 14, stock: 0, engines: PETROL,
    format: (v) => `${signed(v)}° vs stock`,
    bands: (ctx) => { const g = +(OCTANE_TIMING[ctx.fuel] / 2 + 1).toFixed(1); return { g, y: g + 2, o: g + 4 }; },
    zoneText: {
      green: { simple: "Efficient and safe.", expert: "Within part-load knock margin for this fuel." },
      yellow: { simple: "Possible light pinging on hills or hot days.", expert: "Light-load knock possible under heat or low-grade fuel." },
      orange: { simple: "Pinging likely when climbing or towing.", expert: "Tip-in and hill-climb knock likely; knock control active." },
      red: { simple: "Constant pinging. Damaging over time.", expert: "Sustained part-load detonation." },
    },
    effect: (v) => (v === 0 ? "Stock part-throttle timing." : v > 0 ? `+${v}°: better economy and crisper tip-in, up to the knock limit.` : `${v}°: softer and safer, some economy lost.`),
    risks: "Light, constant knock at part throttle is easy to miss but erodes pistons and ring lands over thousands of kilometres, especially towing or climbing hills.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Reduce to ${signed(b.g)}°`, action: { kind: "set", id: "timing_part", value: b.g } }];
      if (ctx.fuel === "91" || ctx.fuel === "95") out.push({ text: "Switch to 98 fuel", action: { kind: "fuel", value: "98" } });
      return out;
    },
  },
  {
    id: "idle_rpm", segment: "Limits", name: "Idle speed", level: "standard",
    what: { simple: "How fast the engine idles. Raise it for big cams or heavy accessories.", expert: "Target idle rpm offset (warm)." },
    unit: "rpm", min: -150, max: 400, step: 25, proMin: -300, proMax: 800, stock: 0, engines: ALL,
    format: (v) => `${v > 0 ? "+" : ""}${v} rpm`,
    bands: () => ({ g: 200, y: 300, o: 400, low: -75 }),
    zoneText: {
      green: { simple: "Stable idle.", expert: "Normal idle control authority." },
      yellow: { simple: "High idle. Uses a little more fuel; auto may creep more.", expert: "Elevated idle; more creep and fuel use." },
      orange: { simple: "Very high idle. Harder to stop smoothly in an auto.", expert: "Strong creep; brake and converter heat." },
      red: { simple: "Extreme idle speed.", expert: "Excessive idle; heat and wear." },
    },
    lowText: { simple: "Low idle. Risk of stalling with air-con or lights on.", expert: "Low idle; stall risk under accessory load, poor oil pressure at hot idle." },
    effect: (v) => (v === 0 ? "Stock idle." : v > 0 ? `+${v} rpm: steadier with big cams or loads.` : `${v} rpm: quieter, less fuel, less stable.`),
    risks: "Too low risks stalling and low oil pressure when hot. Very high idle loads brakes and the torque converter in traffic.",
    balance: (_c, _v, b) => [{ text: "Set to +100 rpm", action: { kind: "set", id: "idle_rpm", value: Math.min(100, b.g) } }],
  },
  // ---------------- "Technically" level ----------------
  {
    id: "knock_sens", segment: "Timing", name: "Knock sensitivity reduction", level: "expert",
    what: { simple: "Makes the knock sensor less sensitive.", expert: "Global reduction of knock detection gain / window thresholds (per-cylinder gains scaled together). Used to reject false knock from noisy valvetrains." },
    unit: "%", min: 0, max: 60, step: 5, proMin: 0, proMax: 100, stock: 0, engines: PETROL,
    format: (v) => `${v}% less sensitive`,
    bands: () => ({ g: 5, y: 15, o: 30 }),
    zoneText: {
      green: { simple: "Knock protection intact.", expert: "Knock detection at or near factory gain." },
      yellow: { simple: "Slightly less protection.", expert: "Reduced gain; only justified by confirmed false knock." },
      orange: { simple: "Real knock may go unnoticed.", expert: "Material risk of missing true knock events." },
      red: { simple: "Knock protection largely off.", expert: "Knock control effectively defeated." },
    },
    effect: (v) => (v === 0 ? "Factory knock sensitivity." : `${v}% less: fewer false knock events, less protection from real ones.`),
    risks: "Knock control is the last line of defence against detonation. Reducing sensitivity to hide noise also hides real knock: verify with audio knock detection or a knock-ear before trusting it.",
    balance: (_c, _v, b) => [{ text: `Set to ${b.g}%`, action: { kind: "set", id: "knock_sens", value: b.g } }],
  },
  {
    id: "iat_spark", segment: "Timing", name: "Hot-air timing pull reduction", level: "expert",
    what: { simple: "Less timing removed when intake air is hot.", expert: "Reduction of IAT-based spark retard." },
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: PETROL,
    format: (v) => `${v}% less pull`,
    bands: (ctx) => { const g = 10 + u(ctx.upgrades.intercooler) * 15; return { g, y: g + 20, o: g + 40 }; },
    zoneText: {
      green: { simple: "Hot-day protection intact.", expert: "IAT spark correction near factory." },
      yellow: { simple: "Less protection on hot days.", expert: "Reduced IAT correction; watch heat-soak logs." },
      orange: { simple: "Knock likely on hot days or after idling.", expert: "Heat-soak knock likely." },
      red: { simple: "No hot-day protection.", expert: "IAT correction defeated." },
    },
    effect: (v) => (v === 0 ? "Factory hot-air timing pull." : `${v}% less pull: stronger when hot, less knock margin.`),
    risks: "Aussie summers and heat-soaked intercoolers push intake temps high. Without the factory timing pull, knock risk climbs sharply in exactly those conditions.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to ${b.g}%`, action: { kind: "set", id: "iat_spark", value: b.g } }];
      if (!ctx.upgrades.intercooler) out.push({ text: "Add intercooler upgrade", action: { kind: "upgrade", key: "intercooler" } });
      return out;
    },
  },
  {
    id: "overtemp", segment: "Cooling", name: "Over-temp protection threshold", level: "expert",
    what: { simple: "How hot the engine gets before it protects itself.", expert: "ECT threshold offset for over-temperature protection (fuel/rpm cut strategy)." },
    unit: "°C", min: -5, max: 15, step: 1, stock: 0, engines: ALL,
    format: (v) => `${v > 0 ? "+" : ""}${v}°C vs stock`,
    bands: (ctx) => { const g = u(ctx.upgrades.cooling) * 3; return { g, y: g + 3, o: g + 8 }; },
    zoneText: {
      green: { simple: "Protection on time.", expert: "Factory or earlier over-temp intervention." },
      yellow: { simple: "Protection kicks in a bit later.", expert: "Later intervention; small margin loss." },
      orange: { simple: "Engine can get very hot before it protects itself.", expert: "Head/gasket damage possible before intervention." },
      red: { simple: "Protection effectively off.", expert: "Over-temp strategy defeated." },
    },
    effect: (v) => (v === 0 ? "Factory protection point." : v > 0 ? `${v}°C later: fewer nuisance cuts, less protection.` : `${Math.abs(v)}°C earlier: more protection.`),
    risks: "Over-temp protection prevents warped heads and blown head gaskets. Raising it hides a cooling problem rather than fixing it.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to +${b.g}°C`, action: { kind: "set", id: "overtemp", value: b.g } }];
      if (!ctx.upgrades.cooling) out.push({ text: "Add cooling upgrade", action: { kind: "upgrade", key: "cooling" } });
      return out;
    },
  },
  {
    id: "torque_limit", segment: "Transmission", name: "Torque limiter increase", level: "expert",
    what: { simple: "Raises the ECU's cap on engine torque.", expert: "Driver-demand / engine torque limit tables scaled above stock." },
    unit: "%", min: 0, max: 50, step: 5, proMin: 0, proMax: 100, stock: 0, engines: ALL,
    format: (v) => `+${v}%`,
    bands: (ctx) => { const g = 10 + u(ctx.upgrades.driveline) * 20; return { g, y: g + 10, o: g + 20 }; },
    zoneText: {
      green: { simple: "Within the gearbox's comfort zone.", expert: "Torque limits within stock driveline margin." },
      yellow: { simple: "More torque reaches the gearbox.", expert: "Driveline loads above factory limits." },
      orange: { simple: "Gearbox likely to slip or wear fast.", expert: "Clutch-pack / converter slip likely on stock hardware." },
      red: { simple: "High chance of gearbox failure.", expert: "Well past stock driveline capacity." },
    },
    effect: (v) => (v === 0 ? "Stock torque limits." : `+${v}%: lets more of the tune's torque through.`),
    risks: "Torque limiters protect the gearbox, tailshaft and diff. Raising them without driveline upgrades is a common way to kill an automatic.",
    balance: (ctx, _v, b) => {
      const out: Advice[] = [{ text: `Set to +${b.g}%`, action: { kind: "set", id: "torque_limit", value: b.g } }];
      if (!ctx.upgrades.driveline) out.push({ text: "Add driveline upgrade", action: { kind: "upgrade", key: "driveline" } });
      return out;
    },
  },

  // ---------------- Throttle ----------------
  sl({ id: "throttle_rate", segment: "Throttle", name: "Throttle opening speed", level: "standard",
    what: ["How fast the electronic throttle opens when you press the pedal.", "Electronic throttle body opening-rate limit (rate of change of throttle angle)."],
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: PETROL, format: (v) => `+${v}% faster`,
    g: () => 30, dy: 25, dor: 25,
    texts: [["Quick but smooth.", "Rate limit still damps driveline shock."], ["Snappy. Can jolt the driveline.", "Reduced damping of torque rise."], ["Harsh jolts on tip-in; wheelspin more likely.", "Driveline lash impacts and traction loss likely."], ["Violent tip-in. Hard on mounts, CVs and diffs.", "Undamped torque step through driveline."]],
    effect: (v) => (v === 0 ? "Stock opening speed." : `Throttle opens ${v}% faster.`),
    risks: "A faster throttle slams driveline lash shut on every tip-in: engine/gearbox mounts, uni joints, CVs and diff gears take the hit, and traction is lost more easily on loose ground.",
    fixVerb: "Set to", fmtFix: (v) => `+${v}%` }),
  sl({ id: "decel_dashpot", segment: "Throttle", name: "Throttle closing delay reduction", level: "expert",
    what: ["How quickly the throttle shuts when you lift off. Less delay = snappier, but can stall or jolt.", "Dashpot / throttle-follower decay reduction on closing."],
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: PETROL, format: (v) => `${v}% less`,
    g: () => 40, dy: 30, dor: 20,
    texts: [["Smooth lift-off.", "Adequate dashpot on closing."], ["Sharper lift-off.", "Reduced overrun damping."], ["Jerky lift-off; possible stalls on manuals.", "Idle dips and shunt on overrun."], ["Stall and shunt risk on every lift.", "Near zero dashpot; idle-control recovery unlikely."]],
    effect: (v) => (v === 0 ? "Stock lift-off feel." : `${v}% quicker throttle closing.`),
    risks: "Closing the throttle too fast drops rpm faster than idle control can catch it (stalls, especially manuals) and shunts the driveline on lift-off.",
    fixVerb: "Set to", fmtFix: (v) => `${v}%` }),
  sl({ id: "launch_rpm", segment: "Limits", name: "Launch control rpm", level: "standard",
    what: ["The rpm the engine holds at while you wait to launch (needs Launch control switched on).", "Two-step / launch limiter target rpm."],
    unit: "rpm", min: 1500, max: 6000, step: 100, stock: 3000, stockBy: { turbo_diesel: 2000 }, engines: ALL, format: (v) => `${v} rpm`,
    g: (ctx) => (ctx.engine === "turbo_diesel" ? 2200 : 3500) + u(ctx.upgrades.driveline) * 800, dy: 500, dor: 500,
    texts: [["Easy on the driveline.", "Moderate launch load."], ["Hard launches.", "High shock at clutch/converter engagement."], ["Very hard on clutch, axles and diff.", "Axle/CV/diff shock likely on grip."], ["Breakage likely on a stock driveline.", "Beyond stock driveline capacity at launch."]],
    effect: (v) => `Holds ${v} rpm on the line.`,
    risks: "High launch rpm dumps a big torque spike into the clutch or converter, tailshaft, diff and axles at once. On grippy surfaces this is the classic way to snap an axle or strip a diff.",
    fixVerb: "Lower to", fmtFix: (v) => `${v} rpm`, upgrade: "driveline" }),
  // ---------------- Transmission (TCM) ----------------
  sl({ id: "shift_rpm", segment: "Transmission", name: "Full-throttle shift point", level: "standard",
    what: ["The rpm the automatic changes up at under full throttle.", "WOT upshift speed/rpm tables (TCM)."],
    unit: "rpm", min: -500, max: 800, step: 50, stock: 0, engines: ALL, format: (v) => `${v > 0 ? "+" : ""}${v} rpm`,
    g: (_c, v) => v.rev_add ?? 0, dy: 100, dor: 100,
    texts: [["Shifts before the limiter.", "Upshift below rev limit with margin."], ["Shifts close to the limiter.", "Little margin to rev limiter."], ["May bounce off the limiter before shifting.", "Upshift at or above limiter; fuel cut before shift."], ["Will hit the limiter every gear.", "Upshift point above rev limit."]],
    effect: (v) => (v === 0 ? "Stock shift points." : `Shifts ${Math.abs(v)} rpm ${v > 0 ? "later" : "earlier"} at full throttle.`),
    risks: "If the shift point sits above the rev limiter the engine hits fuel/spark cut before every upshift: harsh, slow, and hard on the valvetrain and gearbox.",
    fixVerb: "Set to", fmtFix: (v) => `${v > 0 ? "+" : ""}${v} rpm` }),
  sl({ id: "shift_time", segment: "Transmission", name: "Shift speed", level: "standard",
    what: ["How quickly each automatic gear change completes.", "Shift-time / overlap reduction (TCM)."],
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: ALL, format: (v) => `${v}% faster`,
    g: (ctx) => 30 + u(ctx.upgrades.driveline) * 20, dy: 20, dor: 20,
    texts: [["Quick and smooth.", "Overlap still cushions the shift."], ["Fast, noticeable shifts.", "Reduced overlap; more shock load."], ["Hard, banging shifts.", "Clutch-pack shock and wear increase sharply."], ["Very likely to damage the gearbox.", "Minimal overlap on stock hardware."]],
    effect: (v) => (v === 0 ? "Stock shift time." : `Shifts complete ${v}% faster.`),
    risks: "Shorter shifts mean less clutch overlap: more shock through clutch packs, output shaft, tailshaft and diff, and more heat in the fluid.",
    fixVerb: "Set to", fmtFix: (v) => `${v}%`, upgrade: "driveline" }),
  sl({ id: "line_pressure", segment: "Transmission", name: "Line pressure", level: "expert",
    what: ["Hydraulic pressure that clamps the automatic's clutches. More = less slip, harsher.", "Main line pressure modifier (TCM)."],
    unit: "%", min: -10, max: 40, step: 2, stock: 0, engines: ALL, format: (v) => `${v > 0 ? "+" : ""}${v}%`,
    g: (ctx) => 10 + u(ctx.upgrades.driveline) * 10, dy: 8, dor: 8, low: -2,
    lowText: ["Too little clamp: clutches will slip and burn.", "Below stock line pressure: slip under torque."],
    texts: [["Good clamp, normal feel.", "Clamp margin adequate."], ["Firmer engagements.", "Higher pump load and shift shock."], ["Harsh, hard on seals and pump.", "Pump/seal stress; harsh garage shifts."], ["Pump and seal damage likely.", "Sustained excess pressure on stock hydraulics."]],
    effect: (v) => (v === 0 ? "Stock pressure." : `${v > 0 ? "+" : ""}${v}% line pressure.`),
    risks: "Too high overloads the pump and seals and makes every shift harsh; too low lets the clutches slip, overheat the fluid and burn out.",
    fixVerb: "Set to", fmtFix: (v) => `+${v}%`, upgrade: "driveline" }),
  sl({ id: "tcc_lock", segment: "Transmission", name: "Converter lock-up speed", level: "standard",
    what: ["Road speed where the torque converter locks. Later = more heat, earlier = can lug.", "TCC apply speed offset (TCM)."],
    unit: "km/h", min: -20, max: 20, step: 2, stock: 0, engines: ALL, format: (v) => `${v > 0 ? "+" : ""}${v} km/h`,
    g: () => 6, dy: 6, dor: 4, low: -10,
    lowText: ["Locks too early: engine lugs and vibrates.", "Early apply below torque peak; lugging/NVH."],
    texts: [["Normal lock-up.", "Converter slip heat acceptable."], ["More converter slip, more heat.", "Higher fluid temps in slip."], ["Hot gearbox fluid, especially towing.", "Sustained slip heat; fluid degradation."], ["Overheating gearbox likely.", "Fluid overtemp and clutch glazing likely."]],
    effect: (v) => (v === 0 ? "Stock lock-up." : `Locks ${Math.abs(v)} km/h ${v > 0 ? "later" : "earlier"}.`),
    risks: "An unlocked converter turns slip into heat. Towing or off-road work with late lock-up is a common cause of cooked fluid and gearbox failure.",
    fixVerb: "Set to", fmtFix: (v) => `${v > 0 ? "+" : ""}${v} km/h`, upgrade: "cooling" }),
  sl({ id: "kickdown", segment: "Transmission", name: "Kickdown eagerness", level: "standard",
    what: ["How readily the automatic drops a gear when you push the pedal.", "Downshift pedal-threshold sensitivity (TCM)."],
    unit: "%", min: 0, max: 100, step: 5, stock: 50, engines: ALL, format: (v) => `${v}%`,
    g: () => 70, dy: 15, dor: 10,
    texts: [["Downshifts when you want.", "Normal downshift thresholds."], ["Downshifts eagerly.", "Frequent downshift events."], ["Hunts between gears.", "Gear hunting; clutch wear and heat."], ["Constant gear hunting.", "Excessive shift count; wear and fluid heat."]],
    effect: (v) => (v <= 50 ? "Relaxed downshifts." : "Quicker to drop a gear."),
    risks: "An over-eager kickdown hunts between gears, adding shifts, heat and clutch wear, especially when towing.",
    fixVerb: "Set to", fmtFix: (v) => `${v}%` }),
  // ---------------- Brakes & Traction (ABS / ESC) ----------------
  sl({ id: "tc_slip", segment: "Brakes & Traction", name: "Traction control slip allowance",
    what: ["How much wheelspin traction control allows before cutting power.", "TCS target slip ratio increase."],
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: ALL, format: (v) => `+${v}%`,
    g: () => 20, dy: 25, dor: 25,
    texts: [["Still catches wheelspin early.", "Intervention close to stock."], ["Allows some wheelspin.", "Later TCS intervention."], ["Lots of wheelspin before it helps.", "Intervention late; yaw build-up possible."], ["Traction control barely helps.", "Effectively minimal TCS intervention."]],
    effect: (v) => (v === 0 ? "Stock traction control." : `Allows ${v}% more wheel slip.`),
    risks: "More slip helps in sand, mud and gravel, but on sealed roads it lets the car step out before the system reacts, and loads diffs and axles when grip returns suddenly.",
    fixVerb: "Set to", fmtFix: (v) => `+${v}%` }),
  sl({ id: "esc_thresh", segment: "Brakes & Traction", name: "Stability control intervention reduction", level: "standard",
    what: ["How late stability control steps in when the car slides.", "ESC yaw/slip-angle intervention threshold increase."],
    unit: "%", min: 0, max: 100, step: 5, stock: 0, engines: ALL, format: (v) => `${v}% later`,
    g: () => 15, dy: 20, dor: 25,
    texts: [["Still catches slides early.", "Near-stock ESC thresholds."], ["Allows some sliding.", "Later yaw intervention."], ["Slides get big before it helps.", "Late intervention; recovery harder."], ["Almost no stability help.", "ESC effectively passive."]],
    effect: (v) => (v === 0 ? "Stock stability control." : `Steps in ${v}% later.`),
    risks: "Later intervention means a slide can grow past the point the system (or driver) can recover, especially on high-centre-of-gravity 4WDs and loaded utes.",
    fixVerb: "Set to", fmtFix: (v) => `${v}%` }),
  sl({ id: "abs_slip", segment: "Brakes & Traction", name: "ABS slip target", level: "expert",
    what: ["How much the wheels can slip under hard braking before ABS releases. Higher helps on gravel/sand.", "ABS target slip ratio offset."],
    unit: "%", min: -20, max: 30, step: 2, stock: 0, engines: ALL, format: (v) => `${v > 0 ? "+" : ""}${v}%`,
    g: () => 4, dy: 6, dor: 8, low: -10,
    lowText: ["ABS releases too early: longer stops.", "Below-optimal slip; reduced peak decel."],
    texts: [["Close to stock braking.", "Slip target near optimal on seal."], ["Better on loose ground, a bit longer on bitumen.", "Higher slip; reduced lateral grip under braking."], ["Much longer stops on sealed roads; less steering.", "Wheel near lock; steering authority reduced."], ["Wheels close to locking. Steering under brakes poor.", "ABS near passive."]],
    effect: (v) => (v === 0 ? "Stock ABS." : `ABS allows ${v > 0 ? "more" : "less"} wheel slip.`),
    risks: "Letting wheels slip more builds a wedge of gravel that helps off-road, but on bitumen it lengthens stops and takes away steering while braking.",
    fixVerb: "Set to", fmtFix: (v) => `${v > 0 ? "+" : ""}${v}%` }),
  sl({ id: "brake_override", segment: "Brakes & Traction", name: "Brake-throttle override delay", level: "expert",
    what: ["How long the engine keeps power when brake and accelerator are both pressed (left-foot braking, launches, rock crawling).", "Brake-over-accelerator override delay."],
    unit: "ms", min: 0, max: 1000, step: 50, stock: 0, engines: ALL, format: (v) => `${v} ms`,
    g: () => 200, dy: 200, dor: 300,
    texts: [["Brakes still cut power quickly.", "Override near stock."], ["Allows short two-foot use.", "Delayed torque cut on brake."], ["Brakes fight the engine for a while.", "Extended brake/throttle overlap; brake heat."], ["Brake may not stop engine power.", "Override effectively disabled."]],
    effect: (v) => (v === 0 ? "Stock: brake cuts throttle." : `Power held ${v} ms with brake on.`),
    risks: "The override is the backstop if a pedal sticks. A long delay lets brakes and engine fight: brake fade, overheated rotors, and less stopping power.",
    fixVerb: "Set to", fmtFix: (v) => `${v} ms` }),

];

export const SEGMENTS: Segment[] = ["Fuel", "Timing", "Boost", "Throttle", "Limits", "Transmission", "Brakes & Traction", "Cooling", "Emissions"];
export const ZONE_ORDER: Zone[] = ["green", "yellow", "orange", "red"];

const LEVEL_RANK: Record<Skill, number> = { simple: 0, standard: 1, expert: 2 };

/** Sliders shown for an engine at a detail level (higher levels add more). */
export function settingsFor(engine: EngineType, skill: Skill = "expert"): SettingDef[] {
  return SETTINGS.filter((s) => s.engines.includes(engine) && LEVEL_RANK[s.level ?? "simple"] <= LEVEL_RANK[skill]);
}

/** Slider range: the "Technically" level unlocks the wider open range. */
export function rangeFor(def: SettingDef, skill: Skill): { min: number; max: number } {
  return skill === "expert" ? { min: def.proMin ?? def.min, max: def.proMax ?? def.max } : { min: def.min, max: def.max };
}

export function stockValues(engine: EngineType): Values {
  const v: Values = {};
  for (const s of settingsFor(engine)) v[s.id] = s.stockBy?.[engine] ?? s.stock;
  for (const t of togglesFor(engine)) v[t.id] = t.stock ? 1 : 0;
  return v;
}

export interface SettingResult {
  id: string; zone: Zone; tooLow: boolean; bands: Bands;
  headline: string; why?: string; effect: string; risks?: string;
  advice: Advice[];        // fixes within this setting
  otherFixes: Advice[];    // other settings/switches that relieve the same stress
  needsAgreement?: boolean;
}

export interface Warning { level: Zone; title: string; body: string; }

export interface Evaluation {
  results: Record<string, SettingResult>;
  overall: Zone;
  warnings: Warning[];
  counts: Record<Zone, number>;
}

function zoneOf(v: number, b: Bands): { zone: Zone; tooLow: boolean } {
  if (b.low !== undefined && v < b.low) return { zone: "yellow", tooLow: true };
  if (v <= b.g + 1e-9) return { zone: "green", tooLow: false };
  if (v <= b.y + 1e-9) return { zone: "yellow", tooLow: false };
  if (v <= b.o + 1e-9) return { zone: "orange", tooLow: false };
  return { zone: "red", tooLow: false };
}

function words(w: Words, skill: Skill): { headline: string; why?: string } {
  if (skill === "simple") return { headline: w.simple };
  if (skill === "expert") return { headline: w.expert };
  return { headline: w.simple, why: w.expert };
}

export function evaluate(ctx: Context, values: Values): Evaluation {
  const results: Record<string, SettingResult> = {};
  const counts: Record<Zone, number> = { green: 0, yellow: 0, orange: 0, red: 0 };
  const warnings: Warning[] = [];

  for (const s of settingsFor(ctx.engine, ctx.skill)) {
    const v = values[s.id] ?? s.stockBy?.[ctx.engine] ?? s.stock;
    const b = s.bands(ctx, values);
    const { zone, tooLow } = zoneOf(v, b);
    const w = words(tooLow && s.lowText ? s.lowText : s.zoneText[zone], ctx.skill);
    let advice: Advice[] = [];
    if (tooLow && b.low !== undefined) advice = [{ text: `Move to ${s.format(b.low, ctx)}`, action: { kind: "set", id: s.id, value: b.low } }];
    else if (zone !== "green") advice = s.balance(ctx, values, b);
    results[s.id] = {
      id: s.id, zone, tooLow, bands: b, headline: w.headline, why: w.why,
      effect: s.effect(v, ctx),
      risks: zone === "orange" || zone === "red" ? s.risks : undefined,
      advice, otherFixes: [],
    };
    counts[zone]++;
    if (zone === "red") warnings.push({ level: "red", title: `${s.name}: likely damage`, body: `${s.zoneText.red.simple} Open the ${s.segment} tab for what can go wrong and how to balance it.` });
  }

  for (const t of togglesFor(ctx.engine, ctx.skill)) {
    const on = isOn(t, values), changed = on !== t.stock;
    const zone: Zone = changed ? t.zone : "green";
    const w = changed ? words(t.changed, ctx.skill) : { headline: t.stock ? "On (factory)." : "Off (factory)." };
    results[t.id] = {
      id: t.id, zone, tooLow: false, bands: { g: 0, y: 0, o: 0 }, headline: w.headline, why: (w as any).why,
      effect: on ? "On" : "Off",
      risks: changed && zone !== "green" ? t.risks : undefined,
      advice: changed && zone !== "green" ? [{ text: `Turn back ${t.stock ? "on" : "off"}`, action: { kind: "toggle", id: t.id, value: t.stock } }] : [],
      otherFixes: [], needsAgreement: !!t.agreement,
    };
    counts[zone]++;
    if (zone === "red") warnings.push({ level: "red", title: `${t.name} ${on ? "on" : "off"}: likely damage`, body: `${t.changed.simple} Open the ${t.segment} tab for other ways to cover it.` });
  }
  for (const r of Object.values(results)) {
    if (r.zone === "green" || r.tooLow) continue;
    const seen = new Set(r.advice.map((a) => JSON.stringify(a.action)));
    r.otherFixes = reliefFor(r.id, ctx, values).filter((a) => !seen.has(JSON.stringify(a.action)) && !(a.action.kind === "set" && a.action.id === r.id));
  }
  const emi = togglesFor(ctx.engine, ctx.skill).filter((t) => t.agreement && isOn(t, values) !== t.stock);
  if (emi.length) warnings.push({ level: "yellow", title: "Emissions hardware changes", body: `${emi.map((t) => t.name).join(", ")} changed. ${EMISSIONS_NOTE} Do the matching hardware work before flashing.` });

  const z = (id: string) => results[id]?.zone;
  const atLeast = (id: string, lvl: Zone) => !!z(id) && ZONE_ORDER.indexOf(z(id)!) >= ZONE_ORDER.indexOf(lvl);

  if (ctx.engine !== "turbo_diesel" && atLeast("timing_wot", "yellow") && atLeast("lambda_wot", "yellow") && !results.lambda_wot.tooLow) {
    warnings.push({ level: "orange", title: "Stacked knock risk", body: "Timing and mixture are both on the aggressive side. Each is survivable alone; together they multiply knock risk. Pull one of them back into the green." });
  }
  if (ctx.engine === "turbo_diesel") {
    const fuel = values.fuel_add ?? 0, boost = values.diesel_boost_add ?? 0;
    if (fuel > boost * 2.5 + 5) warnings.push({ level: "orange", title: "More fuel than air", body: "Fuel has gone up more than boost. Expect black smoke and high exhaust temperature, especially when towing. Raise boost or lower fuel." });
  }
  const powerUp = (values.boost_add ?? 0) + (values.fuel_add ?? 0) / 3 + (values.diesel_boost_add ?? 0);
  if (powerUp >= 4 && !ctx.upgrades.driveline && atLeast("torque_mgmt", "yellow")) {
    warnings.push({ level: "orange", title: "Driveline under strain", body: "Extra power plus reduced shift protection on a stock gearbox/clutch is a common cause of slipping and failure. Restore some torque management or upgrade the driveline." });
  }
  if (counts.red + counts.orange > 0) {
    warnings.push({ level: "yellow", title: "Log a full-throttle pull before trusting this", body: "CarTune will not flash anything beyond a mild tune without logged knock, mixture and temperature data from a real pull (road, track or dyno)." });
  }

  const overall = ZONE_ORDER.slice().reverse().find((zz) => counts[zz] > 0) ?? "green";
  const rank = (l: Zone) => -ZONE_ORDER.indexOf(l);
  warnings.sort((a, b) => rank(a.level) - rank(b.level));
  return { results, overall, warnings, counts };
}

/** Applies an advice action, returning new context/values (never mutates). */
export function applyAction(ctx: Context, values: Values, a: Action): { ctx: Context; values: Values } {
  if (a.kind === "set") {
    const s = SETTINGS.find((x) => x.id === a.id);
    const r = s ? rangeFor(s, ctx.skill) : { min: -Infinity, max: Infinity };
    const clamped = s ? Math.min(r.max, Math.max(r.min, Math.round(a.value / s.step) * s.step)) : a.value;
    return { ctx, values: { ...values, [a.id]: +clamped.toFixed(3) } };
  }
  if (a.kind === "fuel") return { ctx: { ...ctx, fuel: a.value }, values };
  if (a.kind === "toggle") return { ctx, values: { ...values, [a.id]: a.value ? 1 : 0 } };
  return { ctx: { ...ctx, upgrades: { ...ctx.upgrades, [a.key]: true } }, values };
}

// ============================================================================
// On/off switches — straight enable/disable changes in every area.
// Stored in the same Values map as 1 (on) / 0 (off).
// ============================================================================

export interface ToggleDef {
  id: string; segment: Segment; name: string; what: Words; engines: EngineType[]; level?: Skill;
  stock: boolean;          // factory state
  zone: Zone;              // zone when switched away from stock
  changed: Words;          // what switching it away from stock means
  risks: string;
  agreement?: boolean;     // needs the CarTune user agreement accepted before changing
}
const TURBOS: EngineType[] = ["turbo_petrol", "turbo_diesel"];
const DIESEL: EngineType[] = ["turbo_diesel"];
const EMISSIONS_NOTE = "Off-road, competition and export use under the CarTune user agreement.";
const tg = (id: string, segment: Segment, name: string, stock: boolean, zone: Zone, engines: EngineType[], what: [string, string], changed: [string, string], risks: string, extra: Partial<ToggleDef> = {}): ToggleDef =>
  ({ id, segment, name, stock, zone, engines, what: W(what), changed: W(changed), risks, ...extra });

export const TOGGLES: ToggleDef[] = [
  // Fuel
  tg("t_decel_cut", "Fuel", "Deceleration fuel cut", true, "yellow", ALL, ["Shuts fuel off when you lift off at speed.", "DFCO enable."], ["Fuel keeps flowing on lift-off: smoother, uses more fuel.", "DFCO disabled; higher consumption, reduced engine braking."], "Uses more fuel and makes the exhaust run hotter on overrun."),
  tg("t_closed_loop", "Fuel", "Closed-loop fuelling (O2 feedback)", true, "orange", PETROL, ["Uses the oxygen sensors to keep the mixture right while cruising.", "Closed-loop STFT/LTFT control enable."], ["Runs open loop: mixture no longer self-corrects.", "Open-loop only; no trim correction for drift, fuel or altitude."], "Without O2 correction the mixture drifts with fuel quality, temperature and altitude. Lean drift can burn valves and pistons.", { level: "standard" }),
  tg("t_flex", "Fuel", "Flex-fuel (ethanol content sensor)", false, "yellow", PETROL, ["Reads an ethanol sensor and blends fuel/timing for E10–E85.", "Flex-fuel sensor input + blend tables enable."], ["Flex-fuel on: needs a sensor fitted and a fuel system that can flow E85.", "Requires sensor input wired and injector/pump headroom."], "Turning this on without a sensor or with an undersized fuel system will run lean on E85.", { level: "standard" }),
  // Timing
  tg("t_knock", "Timing", "Knock sensors", true, "red", PETROL, ["Listens for detonation and pulls timing to protect the engine.", "Knock detection and spark retard enable."], ["No knock protection at all.", "Knock control disabled; no retard on detonation."], "With knock control off, any bad tank of fuel, hot day or lean spot can hole a piston or crack a ring land with no warning.", { level: "expert" }),
  // Boost
  tg("t_overboost", "Boost", "Overboost protection", true, "red", TURBOS, ["Cuts power if boost goes past a safe limit (e.g. stuck wastegate).", "Overboost fuel/spark cut enable."], ["No cut if boost runs away.", "Overboost cut disabled."], "A stuck wastegate or split hose can spike boost far past the tune. Without the cut, head gaskets, rods and the turbo itself are at risk."),
  tg("t_antilag", "Boost", "Anti-lag", false, "red", ["turbo_petrol"], ["Keeps the turbo spinning off-throttle by burning fuel in the exhaust.", "ALS (retard + air bypass) enable."], ["Anti-lag on: huge exhaust heat.", "ALS active; extreme EGT."], "Anti-lag destroys turbos, exhaust manifolds and catalytic converters quickly. Competition use only.", { level: "expert" }),
  // Throttle
  tg("t_sport_pedal", "Throttle", "Sport pedal map by default", false, "green", ALL, ["Starts every drive in the sharper sport pedal map.", "Default drive-mode pedal map = sport."], ["Sport pedal on every start.", "Sport map default."], "No mechanical risk; just a sharper feel."),
  // Limits
  tg("t_speed_lim", "Limits", "Top-speed limiter", true, "yellow", ALL, ["Caps vehicle top speed.", "VSS-based speed limiter enable."], ["No top-speed cap.", "Speed limiter disabled."], "Tyre speed ratings, brakes and driveline were matched to the factory limit. Check tyre ratings before relying on higher speeds."),
  tg("t_launch", "Limits", "Launch control", false, "yellow", ALL, ["Holds a set rpm on the line for consistent launches (set rpm under Launch control rpm).", "Two-step launch limiter enable."], ["Launch control active.", "Two-step enabled."], "Repeated launches load clutches, converters, axles and diffs heavily.", { level: "standard" }),
  tg("t_flatshift", "Limits", "Flat-foot shift (manuals)", false, "yellow", ALL, ["Lets you change gear without lifting off the accelerator.", "No-lift shift ignition/fuel cut enable."], ["Flat-shift active.", "NLS enabled."], "Hard on synchros, clutch and gearbox when used every shift.", { level: "standard" }),
  tg("t_popsbangs", "Limits", "Overrun pops & crackles", false, "orange", PETROL, ["Adds fuel and retards timing on lift-off for exhaust pops.", "Overrun retard + fuel enrichment enable."], ["Pops & crackles on.", "Overrun enrichment active; high EGT on decel."], "Burning fuel in the exhaust overheats catalytic converters and exhaust valves, and can crack manifolds.", { level: "standard" }),
  tg("t_startstop", "Limits", "Auto start-stop", true, "green", ALL, ["Switches the engine off at lights to save fuel.", "Idle stop-start enable."], ["Start-stop off: engine keeps running.", "ISS disabled."], "No mechanical risk. Slightly more fuel used at idle."),
  // Transmission
  tg("t_tcc", "Transmission", "Converter lock-up", true, "orange", ALL, ["Locks the torque converter for efficiency and cooler fluid.", "TCC apply enable."], ["Converter never locks: lots of heat.", "TCC disabled; continuous slip."], "An unlocked converter turns slip into heat. Towing or off-road work with lock-up off will cook the fluid.", { level: "standard" }),
  tg("t_auto_upshift", "Transmission", "Auto upshift at redline (manual mode)", true, "yellow", ALL, ["In manual/paddle mode the box still changes up at the limiter.", "Forced upshift at rev limit in manual mode."], ["Holds gear on the limiter.", "Manual mode holds gear at limiter."], "Sitting on the limiter adds valvetrain load and heat.", { level: "standard" }),
  tg("t_skipshift", "Transmission", "Skip-shift (1st→4th)", true, "green", ALL, ["Forces 1st to 4th at light throttle on some manuals.", "CAGS/skip-shift enable."], ["Skip-shift removed.", "CAGS disabled."], "No mechanical risk."),
  tg("t_tow_mode", "Transmission", "Tow/haul mode by default", false, "green", ALL, ["Starts in tow mode: holds gears longer and locks up earlier.", "Tow/haul schedule default."], ["Tow mode on every start.", "Tow schedule default."], "Slightly higher fuel use unloaded."),
  // Brakes & Traction
  tg("t_tc", "Brakes & Traction", "Traction control", true, "orange", ALL, ["Cuts power when wheels spin.", "TCS enable."], ["Traction control off.", "TCS disabled."], "Useful in sand and mud, but on sealed or wet roads the car can step out suddenly, and shock loads hit axles and diffs when grip returns."),
  tg("t_esc", "Brakes & Traction", "Stability control", true, "red", ALL, ["Brakes individual wheels to stop slides and rollovers.", "ESC/VSC enable."], ["No stability control.", "ESC disabled."], "Without ESC a slide or rollover on a tall 4WD or loaded ute is far harder to save."),
  tg("t_abs", "Brakes & Traction", "ABS", true, "red", ALL, ["Stops wheels locking under hard braking so you can steer.", "ABS modulation enable."], ["Wheels can lock under hard braking.", "ABS disabled; no modulation."], "Locked wheels mean no steering and longer stops on bitumen. Only for dedicated off-road or competition vehicles.", { level: "expert" }),
  tg("t_brake_override", "Brakes & Traction", "Brake-throttle override", true, "orange", ALL, ["Pressing the brake cuts engine power, even with the accelerator down.", "Brake-over-accelerator enable."], ["Brake no longer cuts power.", "BOA disabled."], "The override is the backstop if a pedal sticks or you're two-footing. Without it the brakes fight the engine.", { level: "expert" }),
  tg("t_hill_hold", "Brakes & Traction", "Hill-start assist", true, "green", ALL, ["Holds the brakes briefly on a hill while you move off.", "HSA enable."], ["Hill hold off.", "HSA disabled."], "No mechanical risk."),
  // Cooling
  tg("t_ac_cut", "Cooling", "A/C cut at full throttle", true, "yellow", ALL, ["Switches the A/C compressor off at full throttle for power and cooling.", "WOT A/C clutch cut enable."], ["A/C stays on at full throttle.", "No WOT A/C cut."], "Less power at full throttle and more heat load on the radiator, which matters when towing or crawling."),
  tg("t_fan_runon", "Cooling", "Fan run-on after key-off", false, "green", ALL, ["Keeps the radiator fan running after you switch off.", "Post-key-off fan run enable."], ["Fans run on after shutdown.", "Key-off fan run active."], "Small battery drain only."),
  // Emissions (user agreement)
  tg("t_egr", "Emissions", "EGR", true, "yellow", ALL, ["Recirculates some exhaust into the intake.", "EGR valve control enable."], ["EGR off. " + EMISSIONS_NOTE, "EGR disabled; related DTCs suppressed."], "Blank the valve physically if required and check fuelling afterwards; combustion temperature rises without EGR.", { agreement: true, level: "standard" }),
  tg("t_dpf", "Emissions", "DPF (diesel particulate filter)", true, "yellow", DIESEL, ["Traps soot and burns it off in regenerations.", "DPF regen strategy + pressure monitoring enable."], ["DPF off. " + EMISSIONS_NOTE, "Regen and DPF monitoring disabled; related DTCs suppressed."], "Switching this off with the filter still fitted stops regenerations and the filter will block. Only change with the matching hardware change.", { agreement: true, level: "standard" }),
  tg("t_scr", "Emissions", "SCR / AdBlue", true, "yellow", DIESEL, ["Doses AdBlue into the exhaust.", "SCR dosing + NOx sensor monitoring enable."], ["SCR off. " + EMISSIONS_NOTE, "Dosing and NOx monitoring disabled; derate suppressed."], "Leaving dosing hardware fitted but inactive can crystallise AdBlue in the injector and lines.", { agreement: true, level: "standard" }),
  tg("t_swirl", "Emissions", "Swirl flaps", true, "yellow", DIESEL, ["Intake flaps that improve low-rpm mixing.", "Swirl flap actuation enable."], ["Swirl flaps off. " + EMISSIONS_NOTE, "Swirl control disabled."], "Flaps must be physically removed or blanked; loose flaps can be ingested.", { agreement: true, level: "expert" }),
  tg("t_cat_mon", "Emissions", "Catalyst monitor", true, "yellow", PETROL, ["Checks the catalytic converter is working.", "Catalyst efficiency monitor (P0420/P0430) enable."], ["Cat monitor off. " + EMISSIONS_NOTE, "Cat efficiency DTCs suppressed."], "No mechanical risk from the software change itself.", { agreement: true, level: "standard" }),
  tg("t_rear_o2", "Emissions", "Rear O2 sensors", true, "yellow", PETROL, ["Sensors after the cat that check it's working.", "Post-cat O2 input + monitoring enable."], ["Rear O2 off. " + EMISSIONS_NOTE, "Post-cat O2 ignored; related DTCs suppressed."], "No mechanical risk from the software change itself.", { agreement: true, level: "standard" }),
  tg("t_evap", "Emissions", "EVAP purge", true, "yellow", PETROL, ["Draws fuel-tank vapour into the engine to burn it.", "EVAP purge/leak-check enable."], ["EVAP off. " + EMISSIONS_NOTE, "Purge and leak monitoring disabled."], "Tank vapour must vent somewhere safe; a blocked system can pressurise the tank.", { agreement: true, level: "expert" }),
];

// ============================================================================
// Cross-setting fixes: for each setting/switch, the OTHER settings that also
// relieve the same stress. Shown under "Other settings that fix it".
// ============================================================================

type Relief =
  | { id: string; by: number; why: string }        // move a slider by this much
  | { id: string; to: number; why: string }        // move a slider to this value
  | { toggle: string; on: boolean; why: string }    // switch something on/off
  | { upgrade: keyof Upgrades; why: string }
  | { fuel: true; why: string };                    // run higher-octane fuel

const KNOCK_RELIEF: Relief[] = [
  { id: "timing_wot", by: -1.5, why: "less spark = less knock" },
  { id: "timing_part", by: -1, why: "less spark at part load" },
  { id: "lambda_wot", by: -0.02, why: "richer = cooler combustion" },
  { id: "boost_add", by: -2, why: "less cylinder pressure" },
  { id: "iat_spark", by: -25, why: "let hot-air timing pull work again" },
  { id: "knock_sens", by: -20, why: "knock control reacts sooner" },
  { toggle: "t_knock", on: true, why: "knock protection back on" },
  { id: "fan_temp", by: -3, why: "cooler engine, less knock" },
  { id: "overtemp", by: -3, why: "protection kicks in sooner" },
  { fuel: true, why: "higher octane resists knock" },
  { upgrade: "intercooler", why: "cooler intake air" },
];
const DRIVELINE_RELIEF: Relief[] = [
  { id: "torque_mgmt", by: -20, why: "restore some shift torque cut" },
  { id: "shift_firmness", by: -15, why: "softer shifts" },
  { id: "shift_time", by: -15, why: "more clutch overlap" },
  { id: "torque_limit", by: -5, why: "less torque into the box" },
  { id: "boost_add", by: -2, why: "less torque" },
  { id: "fuel_add", by: -3, why: "less torque" },
  { id: "launch_rpm", by: -300, why: "smaller launch hit" },
  { upgrade: "driveline", why: "stronger clutch/gearbox/diff" },
];
const TRACTION_RELIEF: Relief[] = [
  { id: "throttle", by: -15, why: "gentler pedal" },
  { id: "throttle_rate", by: -20, why: "smoother torque rise" },
  { id: "torque_mgmt", by: -20, why: "less torque spike on shifts" },
  { id: "tc_slip", by: -10, why: "traction control acts sooner" },
  { toggle: "t_tc", on: true, why: "traction control back on" },
  { toggle: "t_esc", on: true, why: "stability control back on" },
];
const HEAT_RELIEF: Relief[] = [
  { id: "fan_temp", by: -3, why: "fans on sooner" },
  { id: "overtemp", by: -3, why: "protection kicks in sooner" },
  { id: "timing_wot", by: -1.5, why: "less heat into the coolant" },
  { id: "boost_add", by: -2, why: "less heat" },
  { id: "fuel_add", by: -3, why: "less heat" },
  { toggle: "t_ac_cut", on: true, why: "A/C off at full throttle" },
  { toggle: "t_tcc", on: true, why: "no converter slip heat" },
  { upgrade: "cooling", why: "bigger radiator / oil cooler" },
];

export const RELIEF: Record<string, Relief[]> = {
  timing_wot: KNOCK_RELIEF, timing_part: [...KNOCK_RELIEF, { id: "lambda_cruise", by: -0.02, why: "richer cruise" }],
  knock_sens: KNOCK_RELIEF, t_knock: KNOCK_RELIEF, iat_spark: KNOCK_RELIEF,
  lambda_wot: [{ id: "boost_add", by: -2, why: "less air to fuel" }, { id: "timing_wot", by: -1.5, why: "extra knock margin while lean" }, { toggle: "t_knock", on: true, why: "knock protection" }, { upgrade: "fuelSystem", why: "injectors/pump that can keep up" }],
  lambda_cruise: [{ id: "timing_part", by: -1, why: "safer part-load timing" }, { toggle: "t_closed_loop", on: true, why: "O2 keeps cruise mixture right" }],
  boost_add: [...KNOCK_RELIEF.filter((r) => !("id" in r && r.id === "boost_add")), { toggle: "t_overboost", on: true, why: "cut if boost runs away" }],
  diesel_boost_add: [{ toggle: "t_overboost", on: true, why: "cut if boost runs away" }, { id: "fan_temp", by: -3, why: "cooler engine" }, { upgrade: "intercooler", why: "cooler, denser charge" }],
  fuel_add: [{ id: "diesel_boost_add", by: 2, why: "more air to burn the fuel (less smoke/EGT)" }, { id: "rail_add", by: -3, why: "less fuel pressure" }, { id: "inj_timing", by: -1, why: "lower cylinder pressure" }, { id: "fan_temp", by: -3, why: "cooler engine" }, { upgrade: "intercooler", why: "cooler charge, lower EGT" }, ...DRIVELINE_RELIEF.filter((r) => !("id" in r && r.id === "fuel_add"))],
  rail_add: [{ id: "fuel_add", by: -3, why: "less fuel demand" }, { id: "inj_timing", by: -1, why: "lower peak pressure" }, { upgrade: "fuelSystem", why: "pump/injectors rated for it" }],
  inj_timing: [{ id: "rail_add", by: -3, why: "lower peak pressure" }, { id: "fuel_add", by: -3, why: "less fuel" }, { id: "fan_temp", by: -3, why: "cooler engine" }],
  rev_add: [{ id: "shift_rpm", by: -200, why: "shift before the new limit" }, { id: "torque_limit", by: -5, why: "less load up top" }, { upgrade: "internals", why: "springs/rods rated for rpm" }],
  throttle: TRACTION_RELIEF, throttle_rate: TRACTION_RELIEF, t_tc: TRACTION_RELIEF, tc_slip: TRACTION_RELIEF,
  esc_thresh: TRACTION_RELIEF, t_esc: TRACTION_RELIEF,
  decel_dashpot: [{ id: "idle_rpm", by: 50, why: "idle catches the drop" }, { id: "throttle", by: -10, why: "gentler pedal" }],
  launch_rpm: DRIVELINE_RELIEF, t_launch: DRIVELINE_RELIEF, t_flatshift: DRIVELINE_RELIEF,
  shift_firmness: DRIVELINE_RELIEF, torque_mgmt: DRIVELINE_RELIEF, torque_limit: [...DRIVELINE_RELIEF, { id: "line_pressure", by: 4, why: "more clamp, less slip" }],
  shift_time: DRIVELINE_RELIEF, line_pressure: [{ id: "shift_firmness", by: -15, why: "softer apply" }, { id: "shift_time", by: -15, why: "more overlap" }, { upgrade: "driveline", why: "uprated pump/valve body" }],
  shift_rpm: [{ id: "rev_add", by: 200, why: "keep the limiter above the shift point" }],
  tcc_lock: HEAT_RELIEF, t_tcc: HEAT_RELIEF, kickdown: [{ id: "throttle", by: -10, why: "less pedal = fewer kickdowns" }, { id: "tcc_lock", by: -4, why: "lock up sooner, less slip" }],
  abs_slip: [{ toggle: "t_abs", on: true, why: "ABS back on" }, { id: "esc_thresh", by: -15, why: "stability control helps sooner" }, { id: "brake_override", to: 0, why: "brake always cuts power" }],
  t_abs: [{ id: "abs_slip", to: 0, why: "stock ABS slip" }, { toggle: "t_esc", on: true, why: "stability control back on" }],
  brake_override: [{ toggle: "t_brake_override", on: true, why: "override back on" }, { id: "throttle_rate", by: -20, why: "softer tip-in" }],
  t_brake_override: [{ id: "brake_override", to: 0, why: "no delay" }, { id: "throttle_rate", by: -20, why: "softer tip-in" }],
  fan_temp: HEAT_RELIEF, overtemp: HEAT_RELIEF, t_ac_cut: HEAT_RELIEF,
  t_closed_loop: [{ id: "lambda_cruise", to: 1.0, why: "hold a safe cruise mixture" }, { toggle: "t_knock", on: true, why: "knock protection" }, { id: "timing_part", by: -1, why: "margin for mixture drift" }],
  t_overboost: [{ id: "boost_add", by: -2, why: "more headroom below the limit" }, ...KNOCK_RELIEF.slice(0, 3)],
  t_antilag: [{ id: "boost_add", by: -2, why: "less heat" }, { id: "fan_temp", by: -3, why: "cooler engine" }, { upgrade: "cooling", why: "shed the extra heat" }],
  t_popsbangs: [{ id: "fan_temp", by: -3, why: "cooler engine" }, { id: "decel_dashpot", to: 0, why: "smoother overrun" }],
  t_egr: [{ id: "inj_timing", by: -1, why: "lower combustion temperature" }, { id: "fan_temp", by: -3, why: "cooler engine" }],
  t_dpf: [{ id: "fuel_add", by: -3, why: "less soot" }, { id: "diesel_boost_add", by: 1, why: "cleaner burn" }],
  t_scr: [{ id: "inj_timing", by: -1, why: "lower NOx formation" }],
};

/** Sliders where going past stock is itself a valid fix (e.g. retarding timing). */
const PAST_STOCK_OK = new Set(["timing_wot", "timing_part", "lambda_wot", "lambda_cruise", "fan_temp", "overtemp", "tcc_lock", "inj_timing", "shift_rpm"]);

const FUEL_UP: Record<Fuel, Fuel | undefined> = { "91": "95", "95": "98", "98": "E85", E85: undefined, diesel: undefined };

function reliefFor(key: string, ctx: Context, values: Values): Advice[] {
  const out: Advice[] = [];
  for (const r of RELIEF[key] ?? []) {
    if ("upgrade" in r) {
      if (!ctx.upgrades[r.upgrade]) out.push({ text: `Add ${UPGRADE_LABEL[r.upgrade]} upgrade`, why: r.why, action: { kind: "upgrade", key: r.upgrade } });
    } else if ("fuel" in r) {
      const f = PETROL.includes(ctx.engine) ? FUEL_UP[ctx.fuel] : undefined;
      if (f) out.push({ text: `Run ${f === "E85" ? "E85" : f + " fuel"}`, why: r.why, action: { kind: "fuel", value: f } });
    } else if ("toggle" in r) {
      const t = TOGGLES.find((x) => x.id === r.toggle);
      if (t && t.engines.includes(ctx.engine) && isOn(t, values) !== r.on) out.push({ text: `${t.name}: turn ${r.on ? "on" : "off"}`, why: r.why, action: { kind: "toggle", id: t.id, value: r.on } });
    } else {
      const d = SETTINGS.find((x) => x.id === r.id);
      if (!d || !d.engines.includes(ctx.engine) || d.id === key) continue;
      const cur = values[d.id] ?? d.stockBy?.[ctx.engine] ?? d.stock;
      const rg = rangeFor(d, ctx.skill);
      const stock = d.stockBy?.[ctx.engine] ?? d.stock;
      let raw = "to" in r ? r.to : cur + r.by;
      if ("by" in r && !PAST_STOCK_OK.has(d.id)) {
        if ((r.by < 0 && cur <= stock) || (r.by > 0 && cur >= stock && d.id !== "diesel_boost_add" && d.id !== "rev_add" && d.id !== "idle_rpm" && d.id !== "line_pressure")) continue;
        if (r.by < 0) raw = Math.max(raw, stock);
      }
      const target = +Math.min(rg.max, Math.max(rg.min, Math.round(raw / d.step) * d.step)).toFixed(3);
      if (Math.abs(target - cur) < 1e-9) continue;
      out.push({ text: `${d.name} → ${d.format(target, ctx)}`, why: r.why, action: { kind: "set", id: d.id, value: target } });
    }
  }
  return out;
}

export function isOn(t: ToggleDef, values: Values): boolean {
  const v = values[t.id];
  return v === undefined ? t.stock : v >= 0.5;
}

/** Switches shown for an engine at a detail level. */
export function togglesFor(engine: EngineType, skill: Skill = "expert"): ToggleDef[] {
  return TOGGLES.filter((t) => t.engines.includes(engine) && LEVEL_RANK[t.level ?? "simple"] <= LEVEL_RANK[skill]);
}

/** Tabs that have at least one slider or switch for this engine/level. */
export function segmentsFor(engine: EngineType, skill: Skill = "expert"): Segment[] {
  const sl = settingsFor(engine, skill), tl = togglesFor(engine, skill);
  return SEGMENTS.filter((g) => sl.some((x) => x.segment === g) || tl.some((x) => x.segment === g));
}

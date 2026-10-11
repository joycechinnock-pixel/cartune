/**
 * The 11 saved tune categories shown on the home screen (from the VE SS
 * build sheet), expressed as slider positions for the rules engine so they
 * work on any vehicle. Each category is a slot: on first connect the stock
 * file read from the car is saved into every slot as its base file, and the
 * slot keeps the user's own slider changes on top of the preset.
 */
import type { EngineType, Values } from "./rules";
import { stockValues } from "./rules";

export interface Preset {
  id: string;
  name: string;
  feel: string;            // one line, plain English
  power: number;           // 1–5, for the tile meter
  economy: number;         // 1–5
  needsPull: boolean;      // beyond Day Use: logged pull required before flashing
  petrol: Values;          // offsets on top of stock (petrol + turbo petrol)
  turbo?: Values;          // extra for turbo petrol
  diesel: Values;
}

export const PRESETS: Preset[] = [
  { id: "factory", name: "Factory", feel: "Exactly how it left the factory.", power: 2, economy: 3, needsPull: false, petrol: {}, diesel: {} },
  { id: "economical", name: "Economical", feel: "Softer pedal, early shifts, less fuel used.", power: 1, economy: 5, needsPull: false,
    petrol: { throttle: 40, shift_firmness: 20 }, diesel: { throttle: 40, shift_firmness: 20, fuel_add: 3 } },
  { id: "highway", name: "Highway", feel: "Relaxed cruising and easy overtaking.", power: 2, economy: 4, needsPull: false,
    petrol: { throttle: 45, timing_wot: 0.5, shift_firmness: 25 }, diesel: { throttle: 45, fuel_add: 5 } },
  { id: "comfort", name: "Comfort", feel: "Smooth, quiet, gentle gear changes.", power: 2, economy: 4, needsPull: false,
    petrol: { throttle: 35, shift_firmness: 10 }, diesel: { throttle: 35, shift_firmness: 10 } },
  { id: "day", name: "Day Use", feel: "Everyday driving with a bit more punch.", power: 3, economy: 3, needsPull: false,
    petrol: { timing_wot: 1.5, throttle: 60, shift_firmness: 40, torque_mgmt: 20 }, turbo: { boost_add: 2 },
    diesel: { throttle: 60, fuel_add: 8, diesel_boost_add: 1, shift_firmness: 40, torque_mgmt: 20 } },
  { id: "sport", name: "Sport", feel: "Sharper response and stronger pull.", power: 4, economy: 2, needsPull: true,
    petrol: { timing_wot: 3, throttle: 75, shift_firmness: 60, torque_mgmt: 40, lambda_wot: 0.86 }, turbo: { boost_add: 4, lambda_wot: 0.78 },
    diesel: { throttle: 75, fuel_add: 15, diesel_boost_add: 3, rail_add: 5, shift_firmness: 60, torque_mgmt: 40 } },
  { id: "handling", name: "Handling", feel: "Smooth, predictable power for corners.", power: 3, economy: 2, needsPull: false,
    petrol: { timing_wot: 1.5, throttle: 55, shift_firmness: 60, torque_mgmt: 30 }, turbo: { boost_add: 2 },
    diesel: { throttle: 55, fuel_add: 8, diesel_boost_add: 1, shift_firmness: 60, torque_mgmt: 30 } },
  { id: "holeshot", name: "Holeshot", feel: "Maximum launch off the line.", power: 5, economy: 1, needsPull: true,
    petrol: { timing_wot: 3, throttle: 85, shift_firmness: 80, torque_mgmt: 60, lambda_wot: 0.85 }, turbo: { boost_add: 5, lambda_wot: 0.77 },
    diesel: { throttle: 85, fuel_add: 18, diesel_boost_add: 4, rail_add: 6, shift_firmness: 80, torque_mgmt: 60 } },
  { id: "race", name: "Race", feel: "Track only. Everything turned up.", power: 5, economy: 1, needsPull: true,
    petrol: { timing_wot: 4, rev_add: 300, throttle: 90, shift_firmness: 85, torque_mgmt: 70, fan_temp: -4, lambda_wot: 0.85 }, turbo: { boost_add: 6, lambda_wot: 0.76 },
    diesel: { throttle: 90, fuel_add: 22, diesel_boost_add: 5, rail_add: 8, inj_timing: 1, shift_firmness: 85, torque_mgmt: 70, fan_temp: -4 } },
  { id: "burnout", name: "Burnout", feel: "Show mode. Instant throttle, loose shifts.", power: 4, economy: 1, needsPull: true,
    petrol: { timing_wot: 1, throttle: 90, shift_firmness: 70, torque_mgmt: 80, fan_temp: -6 },
    diesel: { throttle: 90, fuel_add: 10, diesel_boost_add: 2, shift_firmness: 70, torque_mgmt: 80, fan_temp: -6 } },
  { id: "offroad", name: "Off-Road", feel: "Soft, controllable pedal and cooler running.", power: 2, economy: 3, needsPull: false,
    petrol: { throttle: 30, shift_firmness: 30, fan_temp: -4 }, diesel: { throttle: 30, fuel_add: 5, diesel_boost_add: 1, shift_firmness: 30, fan_temp: -4 } },
];

/** Slider values for a preset on a given engine type (stock + preset offsets). */
export function presetValues(p: Preset, engine: EngineType): Values {
  const base = stockValues(engine);
  const over = engine === "turbo_diesel" ? p.diesel : { ...p.petrol, ...(engine === "turbo_petrol" ? p.turbo : {}) };
  const out: Values = { ...base };
  for (const k of Object.keys(over)) if (k in base) out[k] = over[k];
  return out;
}

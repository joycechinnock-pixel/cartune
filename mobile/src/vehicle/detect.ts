/**
 * Auto-detection on connect: VIN -> make/year, calibration ID -> ECU family.
 * Runs in the background; each result is pushed to the UI as soon as it
 * arrives so the vehicle card fills in progressively.
 *
 * Model, engine and body are NOT reliably encoded in a VIN across makers, so
 * those come from the ECU match / OS-ID lookup or the user's own edit.
 */
import { ECU_PROFILES, EcuProfile, matchByOsId } from "../ecu/ecuProfiles";

// World Manufacturer Identifier (first 3 VIN chars) — common Australian-market makers.
const WMI: Record<string, string> = {
  "6G1": "Holden", "6G2": "Pontiac (Holden-built)", "6H8": "Holden", "6FP": "Ford Australia", "6F4": "Ford Australia",
  "6T1": "Toyota Australia", "MR0": "Toyota (Thailand)", "MR1": "Toyota (Thailand)", "JTE": "Toyota", "JTM": "Toyota", "JT1": "Toyota",
  "MNT": "Nissan (Thailand)", "JN1": "Nissan", "JN8": "Nissan", "MMB": "Mitsubishi (Thailand)", "JMB": "Mitsubishi", "JMF": "Mitsubishi",
  "MPA": "Isuzu (Thailand)", "JAA": "Isuzu", "MM0": "Mazda (Thailand)", "JM0": "Mazda", "JMZ": "Mazda", "JF1": "Subaru", "JF2": "Subaru",
  "MNC": "Ford (Thailand)", "WVW": "Volkswagen", "WV1": "Volkswagen Commercial", "WV2": "Volkswagen Commercial", "WAU": "Audi",
  "WBA": "BMW", "WDD": "Mercedes-Benz", "KMH": "Hyundai", "KNA": "Kia", "KNE": "Kia", "LGW": "Great Wall", "LSJ": "MG / SAIC",
  // Heavy trucks (WMI per maker; Australian-built trucks may carry different codes — unlisted = "unknown make", not a guess)
  "1XK": "Kenworth", "2XK": "Kenworth", "1XP": "Peterbilt", "2XP": "Peterbilt", "1M1": "Mack", "1M2": "Mack",
  "1FU": "Freightliner", "1FV": "Freightliner", "3AK": "Freightliner", "4V4": "Volvo Trucks", "4V5": "Volvo Trucks", "YV2": "Volvo Trucks",
  "1HT": "International", "1HS": "International", "3HS": "International", "JAL": "Isuzu Trucks", "YS2": "Scania",
  "WMA": "MAN", "XLR": "DAF", "ZCF": "Iveco",
  "1G1": "Chevrolet", "1GC": "Chevrolet Truck", "1FT": "Ford Truck (USA)", "1C6": "Ram", "2T1": "Toyota (Canada)",
};
const YEAR = "ABCDEFGHJKLMNPRSTVWXY123456789";

export function decodeVin(vin: string): { make?: string; year?: number; valid: boolean } {
  const v = vin.trim().toUpperCase();
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return { valid: false };
  const make = WMI[v.slice(0, 3)];
  const idx = YEAR.indexOf(v[9]);
  // Year code cycles every 30 years; pick the most recent cycle not in the future.
  let year: number | undefined;
  if (idx >= 0) {
    const now = new Date().getFullYear();
    year = 1980 + idx;
    while (year + 30 <= now + 1) year += 30;
  }
  return { make, year, valid: true };
}

export function detectEcu(osId: string | null | undefined): EcuProfile | undefined {
  return osId ? matchByOsId(osId) : undefined;
}

export { ECU_PROFILES };

/**
 * Approximate cold resistance of common automotive blade/cartridge fuses, in
 * milliohms, for the "voltage drop across a fuse → current" parasitic-draw
 * method (I = V / R, so mV ÷ mΩ = A).
 *
 * APPROXIMATE VALUES — sources: Littelfuse ATO and MICRO2 datasheets ("typical
 * cold resistance") and the Power Probe fuse voltage-drop charts (mini, maxi,
 * J-case figures derived as 1 mV ÷ listed mA). Real fuses vary by maker,
 * batch and temperature (resistance rises as the element warms), so treat
 * the calculated current as an estimate for finding WHICH circuit draws, not
 * as a calibrated measurement. Users can edit every value in the app.
 */
export type FuseType = "ato" | "mini" | "micro2" | "maxi" | "jcase";

export const FUSE_TYPE_LABELS: Record<FuseType, string> = {
  ato: "Standard blade (ATO/ATC)",
  mini: "Mini blade (ATM/APM)",
  micro2: "Micro2",
  maxi: "Maxi blade (APX)",
  jcase: "J-case cartridge",
};

export type FuseTable = Record<FuseType, Record<string, number>>;

export const DEFAULT_FUSE_RESISTANCE_MOHM: FuseTable = {
  ato: { "1": 123, "2": 53.5, "3": 31.1, "4": 22.8, "5": 17.85, "7.5": 10.91, "10": 7.7, "15": 4.8, "20": 3.38, "25": 2.52, "30": 1.97, "35": 1.61, "40": 1.44 },
  mini: { "2": 55.6, "3": 33.8, "4": 23.5, "5": 17.8, "7.5": 10.85, "10": 7.42, "15": 4.58, "20": 3.21, "25": 2.36, "30": 1.85 },
  micro2: { "3": 31.7, "5": 17.4, "7.5": 10.8, "10": 7.7, "15": 4.9, "20": 3.5, "25": 2.6, "30": 2.1 },
  maxi: { "20": 3.1, "25": 2.39, "30": 1.95, "35": 1.71, "40": 1.42, "50": 1.1, "60": 0.89, "70": 0.64, "80": 0.54 },
  jcase: { "20": 6.0, "30": 5.2, "40": 3.8, "50": 2.4, "60": 1.7, "80": 1.23, "100": 0.47 },
};

export function fuseRatings(type: FuseType, table: FuseTable = DEFAULT_FUSE_RESISTANCE_MOHM): string[] {
  return Object.keys(table[type] ?? {}).sort((a, b) => parseFloat(a) - parseFloat(b));
}

/**
 * ECU family registry — how CarTune talks to each manufacturer's ECUs.
 *
 * Almost every modern ECU (roughly 2008+, and most from ~2004) flashes over
 * the same standard: UDS (ISO 14229) on CAN (ISO 15765). The sequence is the
 * same everywhere: extended session ($10) -> security unlock ($27) ->
 * erase ($31) -> request download ($34) -> transfer ($36) -> exit ($37) ->
 * checksum/verify ($31) -> reset ($11).
 *
 * What differs per family is captured here: bus settings, CAN IDs, memory
 * layout, and the SECURITY UNLOCK. The unlock (seed-key algorithm, or a
 * bench/boot-mode procedure on encrypted ECUs) is a per-family plug-in on
 * the receiver, referenced by `securityPlugin`.
 *
 * `status` is honest about where each family stands:
 *   ready        — open, working unlock + flash routine exists
 *   plugin-needed — protocol known; unlock plug-in still to be built/licensed
 *   bench-only   — ECU is locked/encrypted for OBD writes; needs bench/boot access
 *   legacy       — older non-UDS protocol (KWP2000 / J1850 / K-line / J1708); separate transport
 *   oem-only     — CarTune can READ it (live data, fault codes over J1939), but writing
 *                  needs the maker's own tool, adapter or login (e.g. Cat ET + Comm Adapter,
 *                  Deere Service ADVISOR, Cummins INSITE). Receivers must refuse to flash.
 *
 * Heavy vehicles and machinery (category "commercial" / "machinery") talk SAE J1939:
 * 29-bit CAN IDs, usually 250 kbit/s (500 kbit/s on newer J1939-14 buses), 9-pin
 * Deutsch connector (black = 250k, green = 500k). UDS on J1939 uses ISO 15765-2
 * "normal fixed" addressing: request 18DA<target><tester>, reply 18DA<tester><target>,
 * tester = 0xF9 (off-board diagnostic tool #1). Each module has its own source
 * address, listed in J1939_MODULES below, so one connection reaches engine,
 * transmission, brakes, aftertreatment, cluster and body modules.
 *
 * Emissions systems (DPF / SCR / EGR): nothing is blocked. Profiles with
 * `emissionsNotice` show CarTune's standard warning and require the user's
 * acceptance of the user agreement before emissions-system changes are staged —
 * the same pattern as every other high-risk change. Off-road, agricultural and
 * export customers are core users.
 */

export type EcuStatus = "ready" | "plugin-needed" | "bench-only" | "legacy" | "oem-only";
export type VehicleCategory = "passenger" | "commercial" | "machinery";
export type BusProtocol = "UDS/CAN" | "GMLAN/CAN" | "KWP2000/CAN" | "KWP2000/K-line" | "J1850" | "J1939/CAN" | "J1708";
export type Connector = "OBD-II 16-pin" | "Deutsch 9-pin" | "Deutsch 6-pin" | "Maker-specific";

export interface EcuProfile {
  id: string;
  manufacturer: string;        // ECU maker
  family: string;
  usedBy: string[];            // vehicle brands commonly fitted
  protocol: BusProtocol;
  bitrate: number;             // CAN bitrate (0 for non-CAN)
  requestId: string;           // physical request ID
  responseId: string;
  securityPlugin: string;      // receiver-side unlock module name
  status: EcuStatus;
  osIdPrefixes?: string[];     // match against the OS/calibration ID read from the ECU
  note?: string;
  category?: VehicleCategory;  // omitted = "passenger"
  connector?: Connector;       // omitted = "OBD-II 16-pin"
  oemTool?: string;            // the maker's own service tool, where writing needs it
  emissionsNotice?: boolean;   // show warning + user-agreement acceptance for DPF/SCR/EGR changes (never blocks)
}

/** J1939 source addresses (SAE J1939 industry-group-0 assignments) for the
 *  modules CarTune reads on a heavy-vehicle bus. */
export const J1939_MODULES: { sa: number; name: string }[] = [
  { sa: 0x00, name: "Engine #1" },
  { sa: 0x03, name: "Transmission #1" },
  { sa: 0x0b, name: "Brakes - system controller (ABS/EBS)" },
  { sa: 0x0f, name: "Engine retarder" },
  { sa: 0x17, name: "Instrument cluster #1" },
  { sa: 0x21, name: "Body controller" },
  { sa: 0x31, name: "Cab controller - primary" },
  { sa: 0x3d, name: "Exhaust emission controller (DPF/SCR)" },
];
export const J1939_TESTER_SA = 0xf9;

const HD = { protocol: "J1939/CAN" as BusProtocol, bitrate: 250000, requestId: "18DA00F9", responseId: "18DAF900", connector: "Deutsch 9-pin" as Connector };

export const ECU_PROFILES: EcuProfile[] = [
  { id: "ford-spanish-oak", manufacturer: "Ford", family: "Spanish Oak / Black Oak PCM", usedBy: ["Ford Falcon (Barra I6, Boss and Miami V8)", "Ford Territory (Barra)"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "ford-oak-seedkey", status: "ready", osIdPrefixes: ["HAC", "HBC", "HCC"], note: "Open flash routine available (jakka351). Reference platform for CarTune." },
  { id: "gm-e38-e67", manufacturer: "GM / Delco", family: "E38 / E67 / E92", usedBy: ["Holden Commodore V8", "HSV", "Chevrolet", "GMC"], protocol: "GMLAN/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "gm-gmlan-seedkey", status: "plugin-needed", note: "Open-source work exists (PCM Hammer covers older P01/P59; E38/E92 community tools)." },
  { id: "gm-e39-e77", manufacturer: "GM / Delco", family: "E39 / E39A / E69 / E77 (V6)", usedBy: ["Holden Commodore VE V6 (E69/E77 Alloytec, E39 SIDI)", "Holden Commodore VF V6 (E39A)"], protocol: "GMLAN/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "gm-gmlan-seedkey", status: "plugin-needed", note: "Same GMLAN security family as the E38 V8 controllers." },
  { id: "transtron-isuzu", manufacturer: "Transtron", family: "Isuzu Transtron ECUs (SH7058/SH725xx, TC265/TC277)", usedBy: ["Isuzu D-Max / MU-X 4JJ1, 4JJ3, RZ4E", "Isuzu N Series 4HK1"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "transtron", status: "plugin-needed", note: "Newer 4JJ3 units are Infineon Aurix (TC265/TC277)." },
  { id: "bosch-med17", manufacturer: "Bosch", family: "MED17 / MG1 (petrol)", usedBy: ["VW", "Audi", "Skoda", "BMW", "Mercedes", "Hyundai", "Kia", "Ford", "Mazda", "many others"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "bosch-tricore", status: "bench-only", note: "Newer variants are signature-protected; OBD write needs an unlock that is typically bench/boot mode." },
  { id: "bosch-edc17", manufacturer: "Bosch", family: "EDC17 / MD1 (diesel)", usedBy: ["Toyota HiLux (some)", "Ford Ranger/Everest (PX 3.2; next-gen 3.0 V6 on MD1CP062)", "Mazda BT-50", "Isuzu", "VW Amarok", "Holden Colorado", "Nissan Navara"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "bosch-tricore", status: "bench-only", note: "Very common in Australian utes. MD1 is heavily protected." },
  { id: "bosch-edc16", manufacturer: "Bosch", family: "EDC16", usedBy: ["Older VW/Audi/Ford/Mazda diesels"], protocol: "KWP2000/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "bosch-edc16", status: "legacy" },
  { id: "denso-toyota", manufacturer: "Denso", family: "Toyota / Lexus ECUs", usedBy: ["Toyota LandCruiser", "HiLux", "Prado", "86", "Lexus"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "denso-toyota", status: "plugin-needed", note: "Many 1GD/1KD diesels are common tuning targets in Australia." },
  { id: "denso-subaru-mazda", manufacturer: "Denso", family: "Subaru / Mazda ECUs", usedBy: ["Subaru WRX/Forester/Outback", "Mazda"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "denso-subaru", status: "plugin-needed", note: "Strong open community base (RomRaider for older Subaru)." },
  { id: "hitachi-nissan", manufacturer: "Hitachi", family: "Nissan ECUs", usedBy: ["Nissan Patrol", "Navara", "350Z/370Z", "GT-R"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "nissan-hitachi", status: "plugin-needed" },
  { id: "mitsubishi-mut", manufacturer: "Mitsubishi", family: "MUT-III ECUs", usedBy: ["Triton", "Pajero", "Lancer/Evo", "Outlander"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "mitsubishi-mut", status: "plugin-needed", note: "Open EcuFlash definitions exist for many older models." },
  { id: "continental-sim-sid", manufacturer: "Continental / Siemens", family: "SIM / SID / EMS", usedBy: ["Ford Territory 2.7 TDCi (SID204)", "Ford Ranger 2.0 Bi-Turbo (SID212)", "Ford", "Renault", "Peugeot/Citroen", "Hyundai", "Kia"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "continental", status: "plugin-needed" },
  { id: "delphi-dcm", manufacturer: "Delphi", family: "DCM 3.x / 6.x (diesel)", usedBy: ["Hyundai", "Kia", "SsangYong", "Great Wall", "LDV"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "delphi-dcm", status: "plugin-needed" },
  { id: "marelli", manufacturer: "Magneti Marelli", family: "IAW / MJD", usedBy: ["Fiat", "Alfa Romeo", "Jeep", "motorcycles"], protocol: "UDS/CAN", bitrate: 500000, requestId: "7E0", responseId: "7E8", securityPlugin: "marelli", status: "plugin-needed" },
  { id: "pre-can-legacy", manufacturer: "Various", family: "Pre-2006 K-line / J1850", usedBy: ["Older vehicles (VT–VZ Commodore, older Japanese)"], protocol: "KWP2000/K-line", bitrate: 0, requestId: "", responseId: "", securityPlugin: "legacy-kline", status: "legacy", note: "Needs K-line capable receiver hardware." },
  // ---- Commercial / heavy trucks (J1939). Engine-maker ECUs cover several truck brands. ----
  { id: "cummins-cm2350", manufacturer: "Cummins", family: "CM2350 / CM2450 (X15, ISX)", usedBy: ["Kenworth", "Western Star", "Peterbilt", "International", "Cummins-powered buses and machinery"], ...HD, securityPlugin: "cummins", status: "oem-only", category: "commercial", oemTool: "Cummins INSITE", emissionsNotice: true, note: "Kenworth's main engine in Australia (X15). Read via J1939; calibration writes go through INSITE." },
  { id: "paccar-mx", manufacturer: "PACCAR", family: "MX-11 / MX-13 engine ECU", usedBy: ["Kenworth", "DAF", "Peterbilt"], ...HD, securityPlugin: "paccar", status: "oem-only", category: "commercial", oemTool: "PACCAR ESA / DAF DAVIE", emissionsNotice: true },
  { id: "detroit-dd", manufacturer: "Detroit Diesel", family: "DD13 / DD15 / DD16 (MCM + CPC)", usedBy: ["Freightliner", "Western Star"], ...HD, securityPlugin: "detroit", status: "oem-only", category: "commercial", oemTool: "Detroit DiagnosticLink", emissionsNotice: true, note: "Two controllers: MCM (engine) and CPC (vehicle/powertrain)." },
  { id: "volvo-group", manufacturer: "Volvo Group", family: "Volvo D11/D13/D16, Mack MP", usedBy: ["Volvo Trucks", "Mack", "UD Trucks"], ...HD, securityPlugin: "volvo-group", status: "oem-only", category: "commercial", oemTool: "Volvo / Mack Premium Tech Tool", emissionsNotice: true, note: "Older units also use J1708/J1587 (see legacy truck profile)." },
  { id: "japan-trucks", manufacturer: "Isuzu / Hino / Fuso", family: "Japanese truck ECUs", usedBy: ["Isuzu N/F/G series", "Hino 300/500/700", "Fuso Canter/Fighter/Shogun"], ...HD, securityPlugin: "japan-trucks", status: "oem-only", category: "commercial", oemTool: "Isuzu IDSS / Hino DX", emissionsNotice: true, note: "ECU supplier and bus speed per model NOT yet confirmed — verify on the truck before relying on this profile." },
  { id: "euro-trucks", manufacturer: "Scania / MAN / Iveco / Mercedes", family: "European truck ECUs", usedBy: ["Scania", "MAN", "Iveco", "Mercedes-Benz Trucks"], ...HD, securityPlugin: "euro-trucks", status: "oem-only", category: "commercial", oemTool: "Scania SDP3 / MAN-cats / Iveco E.A.SY / Mercedes Xentry", emissionsNotice: true, note: "Newer Mercedes trucks sit behind a secure gateway." },
  { id: "hd-legacy-j1708", manufacturer: "Various (heavy duty)", family: "Pre-J1939 trucks (J1708 / J1587)", usedBy: ["Older Kenworth, Mack, Volvo, Freightliner, Cummins/Detroit/Cat-engined trucks"], protocol: "J1708", bitrate: 9600, requestId: "", responseId: "", securityPlugin: "legacy-j1708", status: "legacy", category: "commercial", connector: "Deutsch 6-pin", emissionsNotice: true, note: "RS-485 at 9600 baud; needs a J1708-capable receiver (RP1210 adapter class)." },
  // ---- Heavy machinery / agricultural / off-highway (J1939, maker tools for writes). ----
  { id: "cat-adem", manufacturer: "Caterpillar", family: "ADEM A4 / A5 (engine + machine ECMs)", usedBy: ["Cat excavators, loaders, dozers, generators", "Older Cat-engined trucks"], ...HD, securityPlugin: "cat-cdl", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "Cat ET + Comm Adapter 3", emissionsNotice: true, note: "J1939 is readable; Cat's own CDL link is proprietary and needs Cat's adapter. Cat 9-pin is NOT wired like the truck 9-pin." },
  { id: "deere", manufacturer: "John Deere", family: "PowerTech engine + tractor/combine controllers", usedBy: ["John Deere tractors, combines, sprayers, construction"], ...HD, securityPlugin: "deere", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "Service ADVISOR / Operations Center PRO Service", emissionsNotice: true, note: "Up to ~40 controllers on one machine; implements use ISOBUS (ISO 11783, built on J1939). Reprogramming needs Deere payload files." },
  { id: "cnh", manufacturer: "CNH / FPT", family: "Case IH, New Holland, Steyr controllers", usedBy: ["Case IH", "New Holland", "Steyr", "Case CE"], ...HD, securityPlugin: "cnh", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "CNH Electronic Service Tool (EST)", emissionsNotice: true, note: "Generic adapters don't run CNH software; needs CNH-firmware adapter." },
  { id: "kubota", manufacturer: "Kubota", family: "Kubota engine / machine ECUs", usedBy: ["Kubota tractors, excavators, engines", "Takeuchi"], ...HD, securityPlugin: "kubota", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "Kubota Diagmaster", emissionsNotice: true, note: "Low-confidence entry: protocol/bus details from reseller sources only — verify." },
  { id: "komatsu", manufacturer: "Komatsu", family: "Engine controller + cab monitor", usedBy: ["Komatsu excavators, loaders, dozers"], ...HD, securityPlugin: "komatsu", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "Komatsu dealer tools (cab monitor service mode)", emissionsNotice: true, note: "Low-confidence entry: engine data over J1939; machine functions mostly via the cab monitor." },
  { id: "jcb", manufacturer: "JCB", family: "JCB machine ECUs", usedBy: ["JCB backhoes, telehandlers, excavators"], ...HD, securityPlugin: "jcb", status: "oem-only", category: "machinery", connector: "Maker-specific", oemTool: "JCB ServiceMaster 4 + Data Link Adapter", emissionsNotice: true, note: "Low-confidence entry — verify bus details." },
];

/**
 * Paid packages. Trucks and machinery are only visible to buyers of the
 * packages that include them, so the general-public app shows passenger
 * vehicles only. Prices are set in the store, not here.
 */
export type Package = "standard" | "commercial" | "heavy";
export const PACKAGES: { id: Package; name: string; includes: VehicleCategory[] }[] = [
  { id: "standard", name: "Standard", includes: ["passenger"] },
  { id: "commercial", name: "Commercial (trucks)", includes: ["passenger", "commercial"] },
  { id: "heavy", name: "Heavy (trucks + machinery)", includes: ["passenger", "commercial", "machinery"] },
];

export function profilesForPackage(pkg: Package): EcuProfile[] {
  const inc = PACKAGES.find((x) => x.id === pkg)?.includes ?? ["passenger"];
  return ECU_PROFILES.filter((p) => inc.includes(categoryOf(p)));
}

export function categoryOf(p: EcuProfile): VehicleCategory {
  return p.category ?? "passenger";
}

export function profilesFor(cat: VehicleCategory): EcuProfile[] {
  return ECU_PROFILES.filter((p) => categoryOf(p) === cat);
}

export function matchByOsId(osId: string): EcuProfile | undefined {
  const id = osId.toUpperCase();
  return ECU_PROFILES.find((p) => p.osIdPrefixes?.some((pre) => id.startsWith(pre)));
}

/** Compact profile sent to the receiver with PROFILE:SET before staging. */
export function receiverProfile(p: EcuProfile) {
  return { id: p.id, proto: p.protocol, bitrate: p.bitrate, req: p.requestId, res: p.responseId, sec: p.securityPlugin,
    writable: p.status !== "oem-only", emissionsNotice: !!p.emissionsNotice };
}

/**
 * Connects on app start and fills the vehicle card as results arrive:
 * receiver -> VIN -> make/year -> calibration ID -> ECU family -> stock-file
 * backup. Every step degrades gracefully; anything not detected stays blank
 * for the user to fill in via Edit details.
 *
 * Uses the shared ObdSession (src/ble/sharedSession.ts) so Capture and
 * Diagnostics reuse this connection instead of opening a second BLE link,
 * and so replies are decoded with the headers-on/multi-frame-aware parser.
 */
import { useEffect } from "react";
import * as Link from "../ble/sharedSession";
import { decodeVin, detectEcu } from "./detect";
import { useCarTune } from "../state/CarTuneContext";

export function useAutoDetect() {
  const ct = useCarTune();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const obd = await Link.connectBle();
        if (cancelled) return;
        ct.setConn("reading");
        const vin = await obd.readVin();
        if (vin) {
          const d = decodeVin(vin);
          ct.updateVehicle({ vin, title: [d.year, d.make].filter(Boolean).join(" ") || undefined });
        }
        // Mode 09 PID 04 = calibration ID (OS-ID). Not every ECU answers it.
        const calIds = await obd.readCalIds().catch((): string[] => []);
        let osId: string | null = calIds[0] ?? null;
        let ecu: ReturnType<typeof detectEcu> = undefined;
        for (const c of calIds) { const m = detectEcu(c); if (m) { ecu = m; osId = c; break; } }
        if (ecu) ct.updateVehicle({ osId: osId ?? undefined, ecuId: ecu.id, ecuName: `${ecu.manufacturer} ${ecu.family}` });
        ct.setConn("connected");
        // Stock-file backup runs through the flash receiver (STAGE/readback);
        // progress is reported here as it streams in.
      } catch {
        if (!cancelled) ct.setConn("searching");
      }
    })();
    return () => { cancelled = true; if (Link.getKind() === "ble") Link.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

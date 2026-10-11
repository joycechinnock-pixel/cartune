/**
 * One OBD-II session shared by CaptureScreen and DiagnosticsScreen.
 *
 * - "ble": the react-native-ble-plx ObdLinkConnection (UUIDs still need the
 *   one-time discovery pass on real hardware — see obdLink.ts).
 * - "demo": the in-app ElmEmulator (simulated car, made-up data) so every
 *   screen can be exercised with no adapter. Always labelled DEMO in the UI.
 *
 * ObdSession does the decoding (headers on/off, CAN multi-frame), so screens
 * never parse adapter text themselves.
 */
import { ObdLinkConnection } from "./obdLink";
import { ObdSession, emulatorTransport } from "./obdSession";
import { ElmEmulator, DEFAULT_DEMO_VEHICLE } from "./elmEmulator";

export type LinkKind = "ble" | "demo";
interface Current { session: ObdSession; kind: LinkKind; emu?: ElmEmulator; close: () => Promise<void>; }
let current: Current | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribe(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
export function getSession(): ObdSession | null { return current?.session ?? null; }
export function getKind(): LinkKind | null { return current?.kind ?? null; }
export function getEmulator(): ElmEmulator | null { return current?.emu ?? null; }

export async function disconnect(): Promise<void> {
  const c = current; current = null; notify();
  if (c) { try { await c.close(); } catch { /* already gone */ } }
}

export async function connectBle(onStatus?: (msg: string) => void): Promise<ObdSession> {
  await disconnect();
  const conn = new ObdLinkConnection();
  await conn.connect(onStatus);
  const session = new ObdSession({ send: (cmd, timeoutMs) => conn.sendCommand(cmd, timeoutMs) });
  onStatus?.("Reading supported PIDs…");
  await session.init();
  current = { session, kind: "ble", close: () => conn.disconnect() };
  notify();
  onStatus?.(`Ready${session.protocol ? " · " + session.protocol : ""}`);
  return session;
}

export async function connectDemo(onStatus?: (msg: string) => void): Promise<ObdSession> {
  await disconnect();
  const emu = new ElmEmulator({ ...DEFAULT_DEMO_VEHICLE, stored: [...DEFAULT_DEMO_VEHICLE.stored], pending: [...DEFAULT_DEMO_VEHICLE.pending], permanent: [...DEFAULT_DEMO_VEHICLE.permanent] });
  const session = new ObdSession(emulatorTransport(emu, 15));
  await session.init();
  current = { session, kind: "demo", emu, close: async () => {} };
  notify();
  onStatus?.("DEMO adapter connected — simulated car, made-up data");
  return session;
}

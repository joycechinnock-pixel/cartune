/**
 * App-wide state: connection, the auto-detected vehicle, fuel/parts, and the
 * 11 tune slots. Detection runs in the background on connect and fills in
 * progressively; the stock file read is saved as every slot's base file.
 * Slot edits save instantly (optimistic) — no Save button.
 */
import React, { createContext, useContext, useMemo, useState } from "react";
import { Context, EngineType, Fuel, Skill, Upgrades, Values } from "../tune/rules";
import { PRESETS, presetValues } from "../tune/presets";
import type { Package } from "../ecu/ecuProfiles";

export interface Vehicle {
  title?: string; spec?: string; vin?: string;
  engine: EngineType; ecuId?: string; ecuName?: string; osId?: string;
}
type Conn = "searching" | "reading" | "connected";

interface Api {
  conn: Conn; vehicle: Vehicle; backup: number; baseDate: string;
  fuel: Fuel; upgrades: Upgrades; skill: Skill; onCar: string;
  setConn(c: Conn): void; updateVehicle(v: Partial<Vehicle>): void; setBackup(p: number): void;
  setFuel(f: Fuel): void; toggleUpgrade(k: keyof Upgrades): void; setUpgrades(u: Upgrades): void; setSkill(s: Skill): void;
  setOnCar(id: string): void;
  pkg: Package; setPkg(p: Package): void;          // paid package: which vehicle categories show
  agreed: boolean; setAgreed(a: boolean): void;    // user agreement accepted (needed for emissions switches)
  context(): Context; slotValues(id: string): Values; saveSlot(id: string, v: Values): void; resetSlot(id: string): void; isEdited(id: string): boolean;
  slotTable(slot: string, tableId: string): number[][] | undefined; saveTable(slot: string, tableId: string, g: number[][]): void;
}

const Ctx = createContext<Api | null>(null);
const NONE: Upgrades = { intercooler: false, fuelSystem: false, internals: false, cooling: false, driveline: false };

export function CarTuneProvider({ children }: { children: React.ReactNode }) {
  const [conn, setConn] = useState<Conn>("searching");
  const [vehicle, setVehicle] = useState<Vehicle>({ engine: "na_petrol" });
  const [backup, setBackup] = useState(0);
  const [fuel, setFuel] = useState<Fuel>("98");
  const [upgrades, setUpgrades] = useState<Upgrades>(NONE);
  const [skill, setSkill] = useState<Skill>("simple");
  const [onCar, setOnCar] = useState("factory");
  const [slots, setSlots] = useState<Record<string, Values>>({});
  const [pkg, setPkg] = useState<Package>("standard");
  const [agreed, setAgreed] = useState(false);
  const [tables, setTables] = useState<Record<string, Record<string, number[][]>>>({});
  const baseDate = useMemo(() => new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short" }), []);

  const api: Api = {
    conn, vehicle, backup, baseDate, fuel, upgrades, skill, onCar, pkg, setPkg, agreed, setAgreed,
    setConn, setBackup, setSkill, setOnCar, setUpgrades,
    updateVehicle: (v) => setVehicle((cur) => {
      const next = { ...cur, ...v };
      if (v.engine && v.engine !== cur.engine) { setSlots({}); setFuel(v.engine === "turbo_diesel" ? "diesel" : "98"); }
      return next;
    }),
    setFuel,
    toggleUpgrade: (k) => setUpgrades((u) => ({ ...u, [k]: !u[k] })),
    context: () => ({ engine: vehicle.engine, fuel, upgrades, skill }),
    slotValues: (id) => slots[id] ?? presetValues(PRESETS.find((p) => p.id === id)!, vehicle.engine),
    saveSlot: (id, v) => setSlots((s) => ({ ...s, [id]: v })),
    resetSlot: (id) => setSlots((s) => { const n = { ...s }; delete n[id]; return n; }),
    isEdited: (id) => !!slots[id] || !!tables[id],
    slotTable: (slot, tableId) => tables[slot]?.[tableId],
    saveTable: (slot, tableId, g) => setTables((t) => ({ ...t, [slot]: { ...(t[slot] ?? {}), [tableId]: g } })),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useCarTune(): Api {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCarTune must be used inside CarTuneProvider");
  return c;
}

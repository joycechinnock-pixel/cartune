/**
 * Home — the first thing users see.
 * 1. Vehicle card fills itself in as the car is read (progressive reveal,
 *    skeletons instead of spinners). Every detected field can be edited.
 * 2. The 11 saved tune categories. Each slot holds the stock file read from
 *    this car as its base, plus the user's own changes; its colour shows the
 *    risk for THIS car, fuel and fitted parts. Tap one to fine-tune or flash.
 */
import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ZONE_COLOR } from "../components/ZoneSlider";
import { PRESETS } from "../tune/presets";
import { Fuel, Upgrades, Zone, evaluate } from "../tune/rules";
import { useCarTune } from "../state/CarTuneContext";

const ZONE_LABEL: Record<Zone, string> = { green: "No risk", yellow: "Fine, could be better", orange: "Warning", red: "Likely damage" };
const UPG: Record<keyof Upgrades, string> = { intercooler: "Intercooler", fuelSystem: "Injectors + pump", internals: "Forged internals / springs", cooling: "Cooling", driveline: "Clutch / gearbox" };

export default function HomeScreen({ navigation }: any) {
  const ct = useCarTune();
  const v = ct.vehicle;
  const detected = !!v.ecuId;

  const Check = ({ ok, busy, label }: { ok: boolean; busy: boolean; label: string }) => (
    <View style={s.check}>
      <View style={[s.st, ok ? s.stOk : busy ? s.stBusy : s.stNo]}>{ok && <Text style={s.stTick}>✓</Text>}</View>
      <Text style={s.checkText}>{label}</Text>
    </View>
  );
  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress}><Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text></TouchableOpacity>
  );
  const Dots = ({ n }: { n: number }) => (
    <View style={s.dots}>{[1, 2, 3, 4, 5].map((i) => <View key={i} style={[s.dot, i <= n && s.dotOn]} />)}</View>
  );

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.hero}>
        <View style={s.heroTop}>
          {v.title ? <Text style={s.title}>{v.title}</Text> : <View style={[s.skel, { width: 220, height: 30 }]} />}
          <TouchableOpacity onPress={() => navigation.navigate("EditVehicle")}><Text style={s.link}>Edit details</Text></TouchableOpacity>
        </View>
        {v.spec ? <Text style={s.muted}>{v.spec}</Text> : <View style={[s.skel, { width: 160, marginTop: 6 }]} />}
        <View style={s.checks}>
          <Check ok={ct.conn !== "searching"} busy={ct.conn === "searching"} label="Receiver" />
          <Check ok={!!v.vin} busy={ct.conn === "reading" && !v.vin} label={v.vin ? `VIN ${v.vin}` : "VIN"} />
          <Check ok={detected} busy={!!v.vin && !detected} label={detected ? `ECU ${v.ecuName}` : "ECU"} />
          <Check ok={ct.backup >= 100} busy={ct.backup > 0 && ct.backup < 100}
            label={ct.backup >= 100 ? "Stock file backed up" : ct.backup > 0 ? `Backing up stock file… ${ct.backup}%` : "Stock file backup"} />
        </View>
        {detected && (
          <View style={s.fitted}>
            <Text style={s.lbl}>Fuel you run</Text>
            <View style={s.row}>{(v.engine === "turbo_diesel" ? ["diesel"] : ["91", "95", "98", "E85"]).map((f) => (
              <Chip key={f} on={ct.fuel === f} label={f === "diesel" ? "Diesel" : f === "E85" ? "E85" : `${f} petrol`} onPress={() => ct.setFuel(f as Fuel)} />
            ))}</View>
            <Text style={s.lbl}>Parts fitted (the app can’t see these, so tap any you have)</Text>
            <View style={s.row}>{(Object.keys(UPG) as (keyof Upgrades)[]).map((k) => (
              <Chip key={k} on={ct.upgrades[k]} label={UPG[k]} onPress={() => ct.toggleUpgrade(k)} />
            ))}</View>
          </View>
        )}
      </View>

      {detected && <Text style={s.onCar}>On the car now: <Text style={s.bold}>{PRESETS.find((p) => p.id === ct.onCar)?.name}</Text></Text>}
      <Text style={s.h2}>Your tunes</Text>
      <View style={s.grid}>
        {PRESETS.map((p) => {
          if (!detected) return (
            <View key={p.id} style={[s.tile, { borderTopColor: "#3a4450" }]}>
              <Text style={s.tileName}>{p.name}</Text><Text style={s.muted}>{p.feel}</Text><View style={[s.skel, { width: "60%", marginTop: 12 }]} />
            </View>
          );
          const ev = evaluate(ct.context(), ct.slotValues(p.id));
          return (
            <TouchableOpacity key={p.id} style={[s.tile, { borderTopColor: ZONE_COLOR[ev.overall] }]}
              accessibilityLabel={`${p.name}. ${p.feel} ${ZONE_LABEL[ev.overall]}`}
              onPress={() => navigation.navigate("Tune", { presetId: p.id })}>
              <Text style={s.tileName}>{p.name}</Text>
              <Text style={s.muted}>{p.feel}</Text>
              <View style={s.meterRow}><Text style={s.meterLbl}>Power</Text><Dots n={p.power} /></View>
              <View style={s.meterRow}><Text style={s.meterLbl}>Economy</Text><Dots n={p.economy} /></View>
              <View style={s.tfoot}>
                <View style={[s.zdot, { backgroundColor: ZONE_COLOR[ev.overall] }]} /><Text style={s.zl}>{ZONE_LABEL[ev.overall]}</Text>
                {ct.onCar === p.id && <Text style={[s.tag, s.tagLive]}>On car</Text>}
                {ct.isEdited(p.id) && <Text style={s.tag}>Edited</Text>}
                {p.needsPull && <Text style={s.tag}>Needs pull log</Text>}
              </View>
              <Text style={s.base}>Base file: {ct.backup >= 100 ? `stock read, ${ct.baseDate}` : "saving…"}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={[s.row, { marginTop: 18 }]}>
        <TouchableOpacity style={s.chip} onPress={() => navigation.navigate("Capture")}><Text style={s.chipText}>Live data</Text></TouchableOpacity>
        <TouchableOpacity style={s.chip} onPress={() => navigation.navigate("Diagnostics")}><Text style={s.chipText}>Diagnostics</Text></TouchableOpacity>
        <TouchableOpacity style={s.chip} onPress={() => navigation.navigate("TuneSpec")}><Text style={s.chipText}>Tune spec</Text></TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, backgroundColor: "#181d23", flexGrow: 1 },
  hero: { backgroundColor: "#222a33", borderRadius: 20, padding: 18 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { color: "#eaeef2", fontSize: 30, fontWeight: "800", flexShrink: 1 },
  link: { color: "#5fa8d3", fontWeight: "700", paddingVertical: 6 },
  muted: { color: "#98a4b0", marginTop: 4, lineHeight: 20 },
  checks: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  check: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#2b3540", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 11 },
  checkText: { color: "#eaeef2" },
  st: { width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  stOk: { backgroundColor: "#2fb36b" }, stBusy: { borderWidth: 2, borderColor: "#e8c33a" }, stNo: { backgroundColor: "#36414d" },
  stTick: { color: "#08140d", fontSize: 11, fontWeight: "800" },
  skel: { height: 14, borderRadius: 6, backgroundColor: "#2b3540" },
  fitted: { borderTopWidth: 1, borderTopColor: "#36414d", marginTop: 14, paddingTop: 12 },
  lbl: { color: "#98a4b0", fontSize: 13, marginBottom: 6, marginTop: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 6 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: "#36414d", paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: "#5fa8d3", borderColor: "#5fa8d3" },
  chipText: { color: "#c9d1d9" }, chipTextOn: { color: "#0e1418", fontWeight: "700" },
  onCar: { color: "#98a4b0", marginTop: 16 }, bold: { color: "#eaeef2", fontWeight: "700" },
  h2: { color: "#eaeef2", fontSize: 22, fontWeight: "800", marginTop: 16, marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  tile: { flexGrow: 1, flexBasis: 220, backgroundColor: "#222a33", borderRadius: 16, padding: 14, borderTopWidth: 5, minHeight: 170 },
  tileName: { color: "#eaeef2", fontSize: 19, fontWeight: "700" },
  meterRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  meterLbl: { color: "#98a4b0", fontSize: 12, width: 62 },
  dots: { flexDirection: "row", gap: 3 }, dot: { width: 14, height: 6, borderRadius: 3, backgroundColor: "#36414d" }, dotOn: { backgroundColor: "#eaeef2" },
  tfoot: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 10 },
  zdot: { width: 9, height: 9, borderRadius: 5 }, zl: { color: "#eaeef2", fontWeight: "700", fontSize: 13 },
  tag: { color: "#98a4b0", borderWidth: 1, borderColor: "#36414d", borderRadius: 6, paddingHorizontal: 6, fontSize: 12 },
  tagLive: { color: "#2fb36b", borderColor: "#2fb36b" },
  base: { color: "#98a4b0", fontSize: 11, marginTop: 6 },
});

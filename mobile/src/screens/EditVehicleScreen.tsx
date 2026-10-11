/** Manual override for anything auto-detection got wrong or couldn't see. */
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ECU_PROFILES, profilesForPackage } from "../ecu/ecuProfiles";
import { EngineType } from "../tune/rules";
import { useCarTune } from "../state/CarTuneContext";

const ENG: [EngineType, string][] = [["na_petrol", "Petrol"], ["turbo_petrol", "Turbo petrol"], ["turbo_diesel", "Turbo diesel"]];

export default function EditVehicleScreen({ navigation }: any) {
  const ct = useCarTune();
  const [title, setTitle] = useState(ct.vehicle.title ?? "");
  const [engine, setEngine] = useState<EngineType>(ct.vehicle.engine);
  const [ecuId, setEcuId] = useState(ct.vehicle.ecuId ?? ECU_PROFILES[0].id);

  function save() {
    const e = ECU_PROFILES.find((p) => p.id === ecuId)!;
    ct.updateVehicle({ title, engine, ecuId, ecuName: `${e.manufacturer} ${e.family}` });
    navigation.goBack();
  }
  const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
    <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress}><Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text></TouchableOpacity>
  );
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.muted}>Read automatically from the car. Change anything that’s wrong.</Text>
      <Text style={s.lbl}>Vehicle</Text>
      <TextInput style={s.input} value={title} onChangeText={setTitle} placeholder="e.g. 2008 Holden Commodore SS" placeholderTextColor="#6b7682" />
      <Text style={s.lbl}>Engine type</Text>
      <View style={s.row}>{ENG.map(([k, l]) => <Chip key={k} on={engine === k} label={l} onPress={() => setEngine(k)} />)}</View>
      <Text style={s.lbl}>ECU</Text>
      <View style={s.row}>{profilesForPackage(ct.pkg).map((p) => <Chip key={p.id} on={ecuId === p.id} label={`${p.manufacturer} ${p.family}`} onPress={() => setEcuId(p.id)} />)}</View>
      <TouchableOpacity style={s.save} onPress={save}><Text style={s.saveText}>Save</Text></TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, backgroundColor: "#181d23", flexGrow: 1 },
  muted: { color: "#98a4b0", marginBottom: 8 },
  lbl: { color: "#98a4b0", fontSize: 13, marginTop: 14, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: "#36414d", borderRadius: 10, color: "#eaeef2", padding: 12, backgroundColor: "#222a33" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: "#36414d", paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: "#5fa8d3", borderColor: "#5fa8d3" },
  chipText: { color: "#c9d1d9" }, chipTextOn: { color: "#0e1418", fontWeight: "700" },
  save: { backgroundColor: "#5fa8d3", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 24 },
  saveText: { color: "#0e1418", fontWeight: "800", fontSize: 16 },
});

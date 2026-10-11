/**
 * Pro settings — every single value (switches, limits, thresholds) read from
 * the ECU, grouped like the pro tools group them, searchable, editable.
 * Changes are shown against the value read from the file.
 */
import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { settingsListFor } from "../tune/tables";
import { useCarTune } from "../state/CarTuneContext";

export default function ProSettingsScreen({ route }: any) {
  const ct = useCarTune();
  const slot: string = route?.params?.presetId ?? "factory";
  const list = settingsListFor(ct.vehicle.ecuId ?? "");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<number, number | string>>({});

  if (!list.length) return <View style={s.page}><Text style={s.body}>Settings for this ECU appear once its definition is added.</Text></View>;
  const groups: Record<string, number[]> = {};
  list.forEach((it, i) => {
    if (q && !(it.name + " " + it.group).toLowerCase().includes(q.toLowerCase())) return;
    (groups[it.group] ??= []).push(i);
  });
  const changed = Object.keys(edits).length;

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Text style={s.muted}>{list.length} values read from your file{changed ? ` · ${changed} changed` : ""}</Text>
      <TextInput style={s.search} placeholder="Search (e.g. rev, fan, DFCO, wastegate)" placeholderTextColor="#6b7682" value={q} onChangeText={setQ} />
      {Object.keys(groups).sort().map((g) => {
        const isOpen = !!q || open[g];
        return (
          <View key={g} style={s.group}>
            <TouchableOpacity style={s.groupHead} onPress={() => setOpen({ ...open, [g]: !open[g] })}>
              <Text style={s.groupName}>{g}</Text><Text style={s.muted}>{groups[g].length} {isOpen ? "▴" : "▾"}</Text>
            </TouchableOpacity>
            {isOpen && groups[g].map((i) => {
              const it = list[i], v = edits[i] ?? it.value, ch = edits[i] !== undefined, num = typeof it.value === "number";
              return (
                <View key={i} style={s.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.body}>{it.name}</Text>
                    {ch && <Text style={s.fileVal}>file: {String(it.value)}</Text>}
                  </View>
                  {num ? (
                    <TextInput style={[s.input, ch && s.inputCh]} keyboardType="numbers-and-punctuation" defaultValue={String(v)}
                      onEndEditing={(e) => {
                        const n = parseFloat(e.nativeEvent.text);
                        if (isNaN(n)) return;
                        const next = { ...edits }; if (n === it.value) delete next[i]; else next[i] = n; setEdits(next);
                      }} />
                  ) : (
                    <TouchableOpacity style={[s.input, ch && s.inputCh]} onPress={() => {
                      const cur = String(v), on = /^(Enabled|Enable|Fitted)$/.test(cur);
                      const flip = on ? cur.replace("Enabled", "Disabled").replace("Enable", "Disable").replace("Fitted", "Not fitted") : cur.replace("Disabled", "Enabled").replace("Disable", "Enable").replace("Not fitted", "Fitted");
                      const next = { ...edits }; if (flip === it.value) delete next[i]; else next[i] = flip; setEdits(next);
                    }}><Text style={s.inputText}>{String(v)}</Text></TouchableOpacity>
                  )}
                  <Text style={s.unit}>{it.unit}</Text>
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, backgroundColor: "#181d23", flexGrow: 1 },
  body: { color: "#eaeef2" }, muted: { color: "#98a4b0" },
  search: { borderWidth: 1, borderColor: "#36414d", borderRadius: 10, color: "#eaeef2", padding: 10, backgroundColor: "#222a33", marginVertical: 10 },
  group: { backgroundColor: "#222a33", borderRadius: 12, marginBottom: 8, paddingHorizontal: 14 },
  groupHead: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  groupName: { color: "#eaeef2", fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: "#36414d" },
  fileVal: { color: "#5fa8d3", fontSize: 11 },
  input: { width: 110, borderWidth: 1, borderColor: "#36414d", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, color: "#eaeef2", textAlign: "right", backgroundColor: "#2b3540" },
  inputCh: { borderColor: "#5fa8d3" }, inputText: { color: "#eaeef2", textAlign: "right" },
  unit: { width: 50, color: "#98a4b0", fontSize: 12 },
});

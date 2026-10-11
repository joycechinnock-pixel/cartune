/**
 * Mobile counterpart to the profile-picker side of
 * CarTune-Map-Input-Console.html — pick a preset, see the diff vs Factory
 * Standard, get the same Day-Use-and-above dyno-log warning, export
 * tune_spec.json in the exact same shape the browser console produces.
 */

import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { FIELDS, PROFILES, DAY_USE_OR_BELOW, FieldValues } from "../data/profiles";
import { buildTuneSpec } from "../data/tuneSpec";
import { exportJsonFile } from "../utils/exportFile";

export default function TuneSpecScreen() {
  const [profileName, setProfileName] = useState("Factory Standard");
  const [values, setValues] = useState<FieldValues>({ ...PROFILES["Factory Standard"].v });
  const [status, setStatus] = useState("");

  function pickProfile(name: string) {
    setProfileName(name);
    setValues({ ...PROFILES[name].v });
  }

  const baseline = PROFILES["Factory Standard"].v;
  const diff = useMemo(
    () => FIELDS.filter((f) => String(values[f.key]) !== String(baseline[f.key]) && f.key !== "power_stage"),
    [values]
  );
  const requiresDynoLog = !DAY_USE_OR_BELOW.has(String(values.power_stage));

  async function handleExport() {
    const spec = buildTuneSpec(values, profileName);
    const path = await exportJsonFile("tune_spec.json", spec);
    setStatus(`Exported to ${path} — share sheet opened`);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Tune Spec</Text>

      <Text style={styles.sectionLabel}>Profile</Text>
      <View style={styles.profileRow}>
        {Object.keys(PROFILES).map((name) => (
          <TouchableOpacity
            key={name}
            style={[styles.profileChip, name === profileName && styles.profileChipActive]}
            onPress={() => pickProfile(name)}
          >
            <Text style={name === profileName ? styles.profileChipTextActive : styles.profileChipText}>
              {name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {requiresDynoLog && (
        <View style={styles.warnBanner}>
          <Text style={styles.warnText}>
            '{values.power_stage}' is beyond Day Use. A live dyno pull with knock/AFR/coolant
            logged is required — cartune_orchestrator.py's Validator won't approve a flash for
            this spec without a matching --dyno-log CSV.
          </Text>
        </View>
      )}

      <Text style={styles.sectionLabel}>Diff vs. Factory Standard</Text>
      {diff.length === 0 ? (
        <Text style={styles.emptyText}>No changes vs. Factory.</Text>
      ) : (
        diff.map((f) => (
          <View key={f.key} style={styles.diffRow}>
            <Text style={styles.diffSeg}>{f.segment}</Text>
            <Text style={styles.diffLabel}>{f.label}</Text>
            <Text style={styles.diffVals}>
              {String(baseline[f.key])} → {String(values[f.key])}
            </Text>
          </View>
        ))
      )}

      <View style={styles.spacer} />
      <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
        <Text style={styles.exportButtonText}>Export tune_spec.json</Text>
      </TouchableOpacity>
      {!!status && <Text style={styles.status}>{status}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 12 },
  sectionLabel: { fontSize: 14, fontWeight: "600", marginTop: 16, marginBottom: 8, color: "#888" },
  profileRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  profileChip: { borderWidth: 1, borderColor: "#ccc", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 },
  profileChipActive: { backgroundColor: "#ff7a1a", borderColor: "#ff7a1a" },
  profileChipText: { color: "#333" },
  profileChipTextActive: { color: "#fff", fontWeight: "600" },
  warnBanner: { backgroundColor: "#3a2a10", borderRadius: 8, padding: 12, marginTop: 12 },
  warnText: { color: "#ffb347" },
  emptyText: { color: "#888", fontStyle: "italic" },
  diffRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#ccc", paddingVertical: 8 },
  diffSeg: { fontSize: 11, color: "#999", textTransform: "uppercase" },
  diffLabel: { fontSize: 15, fontWeight: "600" },
  diffVals: { fontSize: 14, color: "#555" },
  spacer: { height: 20 },
  exportButton: { backgroundColor: "#ff7a1a", borderRadius: 8, padding: 14, alignItems: "center" },
  exportButtonText: { color: "#fff", fontWeight: "700" },
  status: { marginTop: 12, color: "#555" },
});

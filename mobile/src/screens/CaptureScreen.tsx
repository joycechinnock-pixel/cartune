/**
 * BLE connect + VIN/DTC/live-PID read screen.
 *
 * Writes mobile_capture.json in the shape MobileCaptureAgent
 * (cartune_orchestrator.py) expects, then hands it to the share sheet.
 * Deliberately does NOT read or write the calibration binary — see
 * design doc section 11 and MobileCaptureAgent's docstring for why.
 */

import React, { useEffect, useState } from "react";
import { View, Text, Button, ScrollView, StyleSheet, Alert } from "react-native";
import { LIVE_PIDS, LivePidKey } from "../ble/elm327";
import * as Link from "../ble/sharedSession";
import { buildMobileCapture } from "../data/tuneSpec";
import { exportJsonFile } from "../utils/exportFile";

/* Decoding now goes through ObdSession (src/ble/obdSession.ts), which copes with
 * the headers-ON output that INIT_SEQUENCE (ATH1) produces as well as
 * headers-off and multi-frame CAN replies. The old per-line decoders assumed
 * headers off and would mis-read ATH1 output. */
export default function CaptureScreen() {
  const [status, setStatus] = useState("Not connected");
  const [vin, setVin] = useState<string | null>(null);
  const [dtcs, setDtcs] = useState<string[]>([]);
  const [liveData, setLiveData] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  useEffect(() => Link.subscribe(() => force((x) => x + 1)), []);
  const kind = Link.getKind();

  async function withSession(label: string, fn: (obd: NonNullable<ReturnType<typeof Link.getSession>>) => Promise<void>) {
    const obd = Link.getSession();
    if (!obd) return Alert.alert("Connect first");
    setBusy(true);
    try { await fn(obd); } catch (err: any) { setStatus(`${label} error: ${err.message}`); } finally { setBusy(false); }
  }

  async function handleConnect(demo = false) {
    setBusy(true);
    try {
      await (demo ? Link.connectDemo(setStatus) : Link.connectBle(setStatus));
    } catch (err: any) {
      setStatus(`Connect failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const handleReadVin = () => withSession("VIN read", async (obd) => {
    const decoded = await obd.readVin();
    setVin(decoded);
    setStatus(decoded ? `VIN read: ${decoded}` : "VIN not reported by this vehicle");
  });

  const handleReadDtcs = () => withSession("DTC read", async (obd) => {
    const r = await obd.readDtcs();
    setDtcs(r.stored);
    setStatus(r.stored.length ? `${r.stored.length} DTC(s) found` : "No stored DTCs");
  });

  function confirmClearDtcs() {
    Alert.alert(
      "Clear DTCs?",
      "This erases stored trouble codes, freeze frame data and readiness monitors on the vehicle. This is destructive and cannot be undone from here.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: handleClearDtcs },
      ]
    );
  }

  const handleClearDtcs = () => withSession("Clear", async (obd) => {
    const ok = await obd.clearDtcs({ confirmed: true }); // only reached from the confirmation dialog above
    if (ok) setDtcs([]);
    setStatus(ok ? "DTCs cleared" : "ECU did not confirm the clear");
  });

  const handleReadLivePids = () => withSession("Live PID read", async (obd) => {
    const results: Record<string, number> = {};
    for (const key of Object.keys(LIVE_PIDS) as LivePidKey[]) {
      if (obd.isSupported(key) === false) continue;
      const v = await obd.readPid(key);
      if (v != null) results[key] = v;
    }
    setLiveData(results);
    setStatus("Live PIDs read");
  });

  async function handleExport() {
    const capture = buildMobileCapture(vin, dtcs, liveData);
    const path = await exportJsonFile("mobile_capture.json", capture);
    setStatus(`Exported to ${path} — share sheet opened`);
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>BLE Capture</Text>
      <Text style={styles.status}>{status}</Text>

      {kind === "demo" && <Text style={styles.demo}>DEMO adapter — simulated car, made-up data</Text>}
      <Button title="Connect to OBD adapter" onPress={() => handleConnect(false)} disabled={busy} />
      <View style={styles.spacer} />
      <Button title="Use demo car (no hardware)" onPress={() => handleConnect(true)} disabled={busy} />
      <View style={styles.spacer} />
      <Button title="Read VIN" onPress={handleReadVin} disabled={busy} />
      <View style={styles.spacer} />
      <Button title="Read stored DTCs" onPress={handleReadDtcs} disabled={busy} />
      <View style={styles.spacer} />
      <Button title="Clear DTCs (destructive)" onPress={confirmClearDtcs} disabled={busy} color="#b33" />
      <View style={styles.spacer} />
      <Button title="Read live PIDs" onPress={handleReadLivePids} disabled={busy} />
      <View style={styles.spacer} />
      <Button title="Export mobile_capture.json" onPress={handleExport} disabled={busy} />

      <View style={styles.results}>
        <Text style={styles.label}>VIN: {vin || "—"}</Text>
        <Text style={styles.label}>DTCs: {dtcs.length ? dtcs.join(", ") : "none read yet"}</Text>
        {Object.entries(liveData).map(([k, v]) => (
          <Text key={k} style={styles.label}>{k}: {v.toFixed(1)}</Text>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  title: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  status: { marginBottom: 16, color: "#555" },
  demo: { marginBottom: 10, color: "#8a6d00", fontWeight: "700" },
  spacer: { height: 10 },
  results: { marginTop: 20 },
  label: { fontSize: 14, marginBottom: 4 },
});

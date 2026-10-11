/**
 * Flash to ECU — stage-then-verify-then-commit.
 *   1. Pick the calibration file   2. Connect to the receiver (BLE or Wi-Fi)
 *   3. Send it into receiver memory   4. Verify SHA-256 matches exactly
 *   5. Type FLASH to confirm   6. Receiver writes over its own wired link
 * The Flash button can't be pressed until step 4 passes. Anything other than
 * an explicit SUCCESS from the receiver is shown as failed/unknown.
 */
import React, { useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Buffer } from "buffer";
import {
  BleUartTransport, FlashReceiver, FlashStatus, WifiTcpTransport, WIFI_DEFAULTS, sha256Hex,
} from "../ble/flashReceiver";
import { EcuProfile, profilesForPackage, receiverProfile } from "../ecu/ecuProfiles";
import { useCarTune } from "../state/CarTuneContext";

const STATUS_LABEL: Record<string, string> = {
  ready: "Ready", "plugin-needed": "Unlock coming", "bench-only": "Bench only", legacy: "Older protocol", "oem-only": "Read only",
};

type Step = "import" | "connect" | "send" | "confirm" | "flashing" | "done";
type TransportKind = "ble" | "wifi";

export default function FlashScreen({ route }: any) {
  const presetName: string | undefined = route?.params?.presetId;
  const [step, setStep] = useState<Step>("import");
  const [transport, setTransport] = useState<TransportKind>("ble");
  const [wifiHost, setWifiHost] = useState(WIFI_DEFAULTS.host);
  const ct = useCarTune();
  const profiles = profilesForPackage(ct.pkg);
  const [ecu, setEcu] = useState<EcuProfile>(profiles[0]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [localSum, setLocalSum] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [final, setFinal] = useState<FlashStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Pick the calibration file to begin.");
  const rx = useRef<FlashReceiver | null>(null);

  async function pickFile() {
    try {
      const DocumentPicker = require("react-native-document-picker").default;
      const RNFS = require("react-native-fs");
      const [res] = await DocumentPicker.pick({ type: [DocumentPicker.types.allFiles], copyTo: "cachesDirectory" });
      const path = decodeURIComponent((res.fileCopyUri || res.uri).replace("file://", ""));
      const data = new Uint8Array(Buffer.from(await RNFS.readFile(path, "base64"), "base64"));
      if (data.length === 0) throw new Error("that file is empty");
      setBytes(data);
      setFileName(res.name || "calibration.bin");
      setLocalSum(sha256Hex(data));
      setStep("connect");
      setStatus(`Loaded ${res.name} (${data.length.toLocaleString()} bytes). Now connect to the receiver.`);
    } catch (e: any) {
      if (e?.code === "DOCUMENT_PICKER_CANCELED") return;
      setStatus(`Couldn't load file: ${e.message}`);
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const t = transport === "ble" ? new BleUartTransport() : new WifiTcpTransport(wifiHost.trim());
      const r = new FlashReceiver(t);
      const info = await r.connect(setStatus);
      rx.current = r;
      setStep("send");
      setStatus(`Connected via ${t.label}: ${info}. Send the file to the receiver next.`);
    } catch (e: any) {
      setStatus(`Connect failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  async function sendAndVerify() {
    const r = rx.current;
    if (!r || !bytes || !localSum) return;
    setBusy(true);
    setProgress(0);
    try {
      setStatus(`Setting ECU type: ${ecu.manufacturer} ${ecu.family}…`);
      await r.setProfile(receiverProfile(ecu));
      setStatus("Sending to receiver memory — nothing is written to the ECU yet.");
      await r.stage(bytes, setProgress);
      setStatus("Checking the receiver got every byte…");
      const remote = await r.receiverChecksum();
      if (remote !== localSum) {
        await r.abort();
        setStep("send");
        setStatus(`Checksum MISMATCH (receiver ${remote.slice(0, 12)}…, expected ${localSum.slice(0, 12)}…). Flashing blocked — send again.`);
        return;
      }
      setStep("confirm");
      setStatus("Checksum matches exactly. Type FLASH below to write it to the ECU.");
    } catch (e: any) {
      setStep("send");
      setStatus(`Send/verify failed: ${e.message}. Flashing stays blocked until this passes.`);
    } finally { setBusy(false); setProgress(null); }
  }

  async function flash() {
    const r = rx.current;
    if (!r) return;
    if (confirmText !== "FLASH") {
      Alert.alert("Type FLASH to confirm", "This writes to the vehicle's ECU. Type FLASH exactly.");
      return;
    }
    setBusy(true);
    setStep("flashing");
    setStatus("Receiver is writing to the ECU. Keep ignition on, receiver powered and phone in range.");
    try {
      await r.startFlash();
      const s = await r.pollUntilDone((u) => {
        setStatus(u.state === "writing" ? `Writing… ${u.percent ?? "?"}%` : `Receiver: ${u.state}`);
      });
      setFinal(s);
      setStatus(
        s.state === "success"
          ? "Receiver confirmed the write completed and verified. Safe to unplug."
          : `NOT confirmed (${s.reason || s.state}). Treat as failed — re-read the ECU with your tuning software before driving.`,
      );
    } catch (e: any) {
      setFinal({ state: "failed", reason: e.message });
      setStatus(`Flash command failed: ${e.message}. Treat as unflashed — do not assume success.`);
    } finally { setBusy(false); setStep("done"); }
  }

  async function reset() {
    await rx.current?.disconnect();
    rx.current = null;
    setStep("import"); setFileName(null); setBytes(null); setLocalSum(null);
    setConfirmText(""); setFinal(null); setProgress(null);
    setStatus("Pick the calibration file to begin.");
  }

  const Btn = ({ label, onPress, enabled, danger }: { label: string; onPress: () => void; enabled: boolean; danger?: boolean }) => (
    <TouchableOpacity
      style={[styles.btn, danger && styles.btnDanger, (!enabled || busy) && styles.btnOff]}
      disabled={!enabled || busy} onPress={onPress}>
      <Text style={styles.btnText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Flash to ECU{presetName ? ` — ${presetName}` : ""}</Text>
      <View style={styles.warn}>
        <Text style={styles.warnText}>
          Writes directly to the ECU through the receiver's wired OBD-II link. Keep the receiver powered until it
          reports a final result.
        </Text>
      </View>

      <Text style={styles.label}>1. Calibration file</Text>
      <Btn label={fileName ? `Change file (${fileName})` : "Pick file"} onPress={pickFile} enabled={step === "import" || step === "connect"} />
      {localSum && <Text style={styles.mono}>SHA-256 {localSum.slice(0, 16)}…</Text>}

      <Text style={styles.label}>2. ECU type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 4 }}>
        {profiles.map((p) => (
          <TouchableOpacity key={p.id} disabled={step === "flashing" || step === "confirm"}
            style={[styles.chip, { marginRight: 8 }, ecu.id === p.id && styles.chipOn]} onPress={() => setEcu(p)}>
            <Text style={styles.chipText}>{p.manufacturer} {p.family}</Text>
            <Text style={styles.chipSub}>{STATUS_LABEL[p.status]}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.mono}>Fits: {ecu.usedBy.join(", ")}</Text>
      {ecu.status !== "ready" && (
        <Text style={styles.note}>
          {ecu.status === "oem-only"
            ? `CarTune can read this one (live data and fault codes). Writing needs the maker's own tool${ecu.oemTool ? ` (${ecu.oemTool})` : ""}, so the receiver will refuse to flash.`
            : ecu.status === "bench-only"
            ? "This ECU is locked against writing through the OBD port. It needs bench access; the receiver will refuse until a plug-in supports it."
            : ecu.status === "legacy"
            ? "Older protocol. Needs a receiver with K-line / legacy support."
            : "Supported by the protocol; the unlock plug-in for this family is still being built. The receiver will say so if it can't unlock it."}
        </Text>
      )}

      <Text style={styles.label}>3. Receiver connection</Text>
      <View style={styles.row}>
        {(["ble", "wifi"] as TransportKind[]).map((k) => (
          <TouchableOpacity key={k} disabled={step !== "connect" && step !== "import"}
            style={[styles.chip, transport === k && styles.chipOn]} onPress={() => setTransport(k)}>
            <Text style={styles.chipText}>{k === "ble" ? "Bluetooth" : "Wi-Fi"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {transport === "wifi" && (
        <TextInput style={styles.input} value={wifiHost} onChangeText={setWifiHost}
          placeholder="Receiver IP" placeholderTextColor="#777" autoCapitalize="none" keyboardType="numbers-and-punctuation" />
      )}
      <Btn label="Connect" onPress={connect} enabled={step === "connect"} />

      <Text style={styles.label}>4. Send + verify</Text>
      <Btn label={progress !== null ? `Sending… ${progress}%` : "Send to receiver"} onPress={sendAndVerify} enabled={step === "send"} />

      <Text style={styles.label}>5. Confirm + flash</Text>
      <TextInput style={styles.input} value={confirmText} onChangeText={setConfirmText}
        placeholder="Type FLASH" placeholderTextColor="#777" autoCapitalize="characters" editable={step === "confirm"} />
      <Btn label="FLASH" danger onPress={flash} enabled={step === "confirm" && confirmText === "FLASH"} />

      <View style={[styles.statusBox, final?.state === "success" && styles.ok, final && final.state !== "success" && styles.bad]}>
        <Text style={styles.statusText}>{status}</Text>
      </View>
      {step !== "import" && step !== "flashing" && <Btn label="Start over" onPress={reset} enabled />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, backgroundColor: "#111", flexGrow: 1 },
  title: { color: "#f5a623", fontSize: 24, fontWeight: "700", marginBottom: 8 },
  warn: { backgroundColor: "#3a2400", borderRadius: 8, padding: 10, marginBottom: 12 },
  warnText: { color: "#ffd28a" },
  label: { color: "#ddd", fontWeight: "600", marginTop: 14, marginBottom: 6 },
  btn: { backgroundColor: "#f5a623", borderRadius: 8, padding: 12, alignItems: "center", marginVertical: 4 },
  btnDanger: { backgroundColor: "#d0021b" },
  btnOff: { opacity: 0.35 },
  btnText: { color: "#111", fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, marginBottom: 6 },
  chip: { borderWidth: 1, borderColor: "#555", borderRadius: 16, paddingVertical: 6, paddingHorizontal: 14 },
  chipOn: { borderColor: "#f5a623", backgroundColor: "#2a1e08" },
  chipText: { color: "#eee" },
  chipSub: { color: "#999", fontSize: 11 },
  note: { color: "#ffd28a", fontSize: 12, marginVertical: 4 },
  input: { borderWidth: 1, borderColor: "#444", borderRadius: 8, color: "#fff", padding: 10, marginVertical: 4 },
  mono: { color: "#aaa", fontFamily: "Courier", fontSize: 12 },
  statusBox: { marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: "#1d1d1d" },
  ok: { backgroundColor: "#0f3a1a" },
  bad: { backgroundColor: "#3a0f0f" },
  statusText: { color: "#eee" },
});

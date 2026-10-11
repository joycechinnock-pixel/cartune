/**
 * Vehicle electrical diagnostics — React Native mirror of the web app's
 * Diagnostics tab. All verdict logic lives in src/diag/* (shared with the web
 * build and mirrored 1:1 in electrical_diag.py; test vectors in
 * mock_data/diag_test_vectors.json). Thresholds are general guidelines.
 *
 * OBD reads go through the shared ObdSession (BLE adapter or the DEMO
 * emulator). Clearing codes (Mode 04) sits behind an explicit two-step
 * confirmation. Nothing here writes to the ECU calibration.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as D from "../diag/electrical";
import { DEFAULT_FUSE_RESISTANCE_MOHM, FUSE_TYPE_LABELS, FuseType, fuseRatings } from "../diag/fuses";
import { WORKFLOW_STEPS, FAULT_TREES, SAFETY_NOTES, DLC_PINS, walkTree } from "../diag/workflow";
import { describeDtc } from "../diag/dtcInfo";
import { DiagSession, newSession, summarize, buildReportJson, buildReportHtml } from "../diag/report";
import { LIVE_PIDS, LivePidKey, parseAtrv } from "../ble/elm327";
import { DtcReadResult, FreezeFrame } from "../ble/obdSession";
import * as Link from "../ble/sharedSession";
import { exportJsonFile, exportTextFile } from "../utils/exportFile";
import { useCarTune } from "../state/CarTuneContext";

type Section = "workflow" | "scan" | "battery" | "vdrop" | "draw" | "faults" | "sensors" | "can" | "safety" | "report";
const SECTIONS: [Section, string][] = [["workflow", "Workflow"], ["scan", "Scan & codes"], ["battery", "Battery"], ["vdrop", "Voltage drop"], ["draw", "Parasitic draw"], ["faults", "Circuit faults"], ["sensors", "Sensors"], ["can", "CAN bus"], ["safety", "Safety"], ["report", "Report"]];
const TH = D.DEFAULT_THRESHOLDS;
const ST_COLOR: Record<D.Status, string> = { pass: "#2fb36b", warn: "#e8c33a", fail: "#e5484d", info: "#5fa8d3" };
const n = (s: string): number | undefined => (s.trim() === "" || isNaN(+s) ? undefined : +s);

function useLink() {
  const [, force] = useState(0);
  useEffect(() => Link.subscribe(() => force((x) => x + 1)), []);
  return { session: Link.getSession(), kind: Link.getKind() };
}

const Chip = ({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) => (
  <TouchableOpacity style={[s.chip, on && s.chipOn]} onPress={onPress} accessibilityState={{ selected: on }}><Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text></TouchableOpacity>
);
const Btn = ({ title, onPress, danger, disabled }: { title: string; onPress: () => void; danger?: boolean; disabled?: boolean }) => (
  <TouchableOpacity style={[s.btn, danger && s.btnDanger, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled}><Text style={[s.btnText, danger && { color: "#e5484d" }]}>{title}</Text></TouchableOpacity>
);
const Field = ({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit?: string }) => (
  <View style={s.field}><Text style={s.lbl}>{label}{unit ? ` (${unit})` : ""}</Text>
    <TextInput style={s.input} value={value} onChangeText={onChange} keyboardType="decimal-pad" placeholderTextColor="#6b7785" accessibilityLabel={label} /></View>
);
const Res = ({ r }: { r: D.Result | null }) => r ? (
  <View style={[s.res, { borderLeftColor: ST_COLOR[r.status] }]}><Text style={[s.resSt, { color: ST_COLOR[r.status] }]}>{r.status.toUpperCase()}</Text><Text style={s.body}>{r.message}</Text></View>
) : <Text style={s.muted}>Enter your readings.</Text>;
const Card = ({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) => (
  <View style={s.card}><Text style={s.h3}>{title}</Text>{intro ? <Text style={s.muted}>{intro}</Text> : null}{children}</View>
);
function safe(fn: () => D.Result | null): D.Result | null { try { return fn(); } catch (e: any) { return { status: "info", message: e.message } as D.Result; } }

export default function DiagnosticsScreen() {
  const ct = useCarTune();
  const { session: obd, kind } = useLink();
  const [section, setSection] = useState<Section>("workflow");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [sess, setSess] = useState<DiagSession>(() => newSession({ title: ct.vehicle.title, vin: ct.vehicle.vin ?? null }, { mode: "none" }));
  const [f, setF] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [fuseType, setFuseType] = useState<FuseType>("mini");
  const [fuseRating, setFuseRating] = useState("10");
  const [circuit, setCircuit] = useState<D.CircuitType>("ground");
  const [scan, setScan] = useState<DtcReadResult | null>(null);
  const [ff, setFf] = useState<FreezeFrame | null>(null);
  const [treeId, setTreeId] = useState(FAULT_TREES[0].id);
  const [answers, setAnswers] = useState<("yes" | "no")[]>([]);
  const [scanVals, setScanVals] = useState<Partial<Record<LivePidKey, number | null>>>({});
  const set = (k: string) => (v: string) => setF((o) => ({ ...o, [k]: v }));
  const connected = !!obd;

  function save(tool: string, label: string, r: D.Result | null, inputs: Record<string, unknown>) {
    if (!r) return Alert.alert("Enter readings first");
    setSess((x) => ({ ...x, adapter: { mode: kind ?? "none", id: obd?.adapterId ?? null, protocol: obd?.protocol ?? null }, updatedAt: new Date().toISOString(),
      tests: [...x.tests, { tool, label, inputs, status: r.status, message: r.message, at: new Date().toISOString() }] }));
    setStatus(`Saved “${label}” to report`);
  }
  async function run(label: string, fn: () => Promise<void>) {
    if (!obd) return Alert.alert("Connect first", "Connect the BLE adapter or the demo car.");
    setBusy(true); setStatus(label + "…");
    try { await fn(); } catch (e: any) { setStatus(`${label} failed: ${e.message}`); } finally { setBusy(false); }
  }

  // ---- calculators (same functions as web + Python) ----
  const socR = useMemo(() => safe(() => n(f.soc ?? "") == null ? null : D.batterySoc({ volts: n(f.soc!)!, type: flags.agm ? "agm" : "flooded" })), [f.soc, flags.agm]);
  const crankR = useMemo(() => safe(() => { const v = n(f.crank ?? ""); if (v == null) return null; const t = n(f.crankT ?? ""); return D.crankingTest({ minVolts: v, tempC: t, limit: D.crankingMinVoltage(t) }); }), [f.crank, f.crankT]);
  const chgR = useMemo(() => safe(() => n(f.chg ?? "") == null ? null : D.chargingTest({ volts: n(f.chg!)!, smart: !!flags.smart })), [f.chg, flags.smart]);
  const ripR = useMemo(() => safe(() => n(f.rip ?? "") == null ? null : D.rippleTest({ acVolts: n(f.rip!)! })), [f.rip]);
  const vdR = useMemo(() => safe(() => n(f.vd ?? "") == null ? null : D.voltageDrop({ reading: n(f.vd!)!, circuit, loaded: flags.unloaded !== true })), [f.vd, circuit, flags.unloaded]);
  const drawR = useMemo(() => safe(() => n(f.draw ?? "") == null ? null : D.parasiticDraw({ milliamps: n(f.draw!)!, batteryAh: n(f.ah ?? "") ?? 60 })), [f.draw, f.ah]);
  const fuseR = useMemo(() => safe(() => n(f.fmv ?? "") == null ? null : D.fuseDropCurrent({ millivolts: n(f.fmv!)!, type: fuseType, rating: fuseRating })), [f.fmv, fuseType, fuseRating]);
  const canR = useMemo(() => safe(() => flags.canOpen ? D.canTermination({ ohms: null }) : n(f.canR ?? "") == null ? null : D.canTermination({ ohms: n(f.canR!)! })), [f.canR, flags.canOpen]);
  const canV = useMemo(() => safe(() => n(f.canH ?? "") == null || n(f.canL ?? "") == null ? null : D.canVoltages({ canH: n(f.canH!)!, canL: n(f.canL!)! })), [f.canH, f.canL]);
  const s3R = useMemo(() => safe(() => [f.sRef, f.sSig, f.sGnd].some((x) => n(x ?? "") == null) ? null : D.threeWireSensor({ ref: n(f.sRef!)!, signal: n(f.sSig!)!, groundDrop: n(f.sGnd!)! })), [f.sRef, f.sSig, f.sGnd]);

  function confirmClear() {
    if (!obd) return;
    if (!flags.recorded) return Alert.alert("Record the codes first", "Tick “I have recorded the codes and freeze frame” before clearing.");
    Alert.alert("Clear trouble codes? (Mode 04)", "Erases stored and pending codes, freeze frame data and readiness monitors. Permanent codes stay until the fault is fixed." + (kind === "demo" ? " (Demo: simulated car only.)" : ""), [
      { text: "Cancel", style: "cancel" },
      { text: "Clear codes", style: "destructive", onPress: () => run("Clearing codes", async () => {
        const ok = await obd.clearDtcs({ confirmed: true });
        setStatus(ok ? "Codes cleared" : "ECU did not confirm the clear");
        setFlags((x) => ({ ...x, recorded: false })); setFf(null); setScan(await obd.readDtcs());
      }) },
    ]);
  }

  const tree = FAULT_TREES.find((t) => t.id === treeId)!;
  const walk = walkTree(tree, answers);
  const sum = summarize(sess);

  return (
    <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <View style={[s.banner, { borderLeftColor: "#e5484d" }]}><Text style={s.body}><Text style={s.bold}>Safety: </Text>never probe airbag (SRS) circuits with a test light or ohmmeter. Orange cables on hybrids/EVs are high voltage — training and PPE required.</Text></View>
      <View style={[s.banner, { borderLeftColor: kind === "demo" ? "#e8c33a" : connected ? "#2fb36b" : "#5fa8d3" }]}>
        <Text style={s.body}>{kind === "demo" ? "DEMO adapter — simulated car, made-up data." : connected ? `BLE adapter connected${obd?.protocol ? " · " + obd.protocol : ""}` : "No adapter — manual calculators still work."}</Text>
        <View style={s.row}>
          <Btn title="Connect BLE adapter" disabled={busy} onPress={() => { setBusy(true); Link.connectBle(setStatus).catch((e) => setStatus("Connect failed: " + e.message)).finally(() => setBusy(false)); }} />
          <Btn title="Demo car" disabled={busy} onPress={() => { Link.connectDemo(setStatus); }} />
          {connected && <Btn title="Disconnect" onPress={() => Link.disconnect()} />}
        </View>
      </View>
      {status ? <Text style={s.status} accessibilityLiveRegion="polite">{status}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        <View style={s.row}>{SECTIONS.map(([id, label]) => <Chip key={id} on={section === id} label={label} onPress={() => setSection(id)} />)}</View>
      </ScrollView>

      {section === "workflow" && <Card title={`Guided workflow · ${WORKFLOW_STEPS.filter((w) => sess.checklist[w.id]?.done).length}/${WORKFLOW_STEPS.length}`}>
        <Text style={s.lbl}>Customer complaint</Text>
        <TextInput style={[s.input, s.note]} multiline value={sess.complaint ?? ""} onChangeText={(t: string) => setSess((x) => ({ ...x, complaint: t }))} />
        {WORKFLOW_STEPS.map((w, i) => { const c = sess.checklist[w.id] ?? { done: false }; return (
          <View key={w.id} style={s.step}>
            <View style={s.rowBetween}><Text style={[s.bold, { flex: 1 }]}>{i + 1}. {w.title}</Text>
              <Switch value={c.done} onValueChange={(v: boolean) => setSess((x) => ({ ...x, checklist: { ...x.checklist, [w.id]: { ...c, done: v } } }))} accessibilityLabel={w.title} /></View>
            <Text style={s.muted}>{w.detail}</Text>
            <TextInput style={[s.input, s.note]} multiline placeholder="Notes / findings" placeholderTextColor="#6b7785" value={c.note ?? ""} onChangeText={(t: string) => setSess((x) => ({ ...x, checklist: { ...x.checklist, [w.id]: { ...c, note: t } } }))} />
          </View>); })}
      </Card>}

      {section === "scan" && <Card title="Trouble codes" intro="Stored (03), pending (07) and permanent (0A) codes with SAE J2012 descriptions; freeze frame (02).">
        <View style={s.row}>
          <Btn title="Read all codes" disabled={!connected || busy} onPress={() => run("Reading codes", async () => { const r = await obd!.readDtcs(); setScan(r); setSess((x) => ({ ...x, dtcs: { stored: r.stored, pending: r.pending, permanent: r.permanent } })); setStatus("Codes read"); })} />
          <Btn title="Freeze frame" disabled={!connected || busy} onPress={() => run("Reading freeze frame", async () => { const r = await obd!.readFreezeFrame(); setFf(r); setSess((x) => ({ ...x, freezeFrame: r as any })); setStatus("Freeze frame read"); })} />
        </View>
        {scan && (["stored", "pending", "permanent"] as const).map((k) => scan[k].map((c) => <Text key={k + c} style={s.body}><Text style={s.bold}>{c}</Text> ({k}) — {describeDtc(c).description}</Text>))}
        {scan && !scan.stored.length && !scan.pending.length && !scan.permanent.length && <Text style={s.body}>No codes reported.</Text>}
        {ff && <View style={{ marginTop: 8 }}><Text style={s.bold}>Freeze frame {ff.dtc ? `(set by ${ff.dtc})` : "— none stored"}</Text>
          {Object.entries(ff.values).map(([k, v]) => <Text key={k} style={s.body}>{LIVE_PIDS[k as LivePidKey].label}: {(v as number).toFixed(1)}</Text>)}</View>}
        <View style={[s.rowBetween, { marginTop: 10 }]}><Text style={[s.body, { flex: 1 }]}>I have recorded the codes and freeze frame</Text><Switch value={!!flags.recorded} onValueChange={(v: boolean) => setFlags((x) => ({ ...x, recorded: v }))} /></View>
        <Btn title="Clear codes (Mode 04)…" danger disabled={!connected || busy} onPress={confirmClear} />
      </Card>}

      {section === "battery" && <>
        <Card title="Read from the car" intro="ATRV (adapter measures OBD pin 16) and PID 0x42 (ECU module voltage). Confirm with a meter at the battery posts.">
          <Btn title="Read battery voltage" disabled={!connected || busy} onPress={() => run("Reading voltage", async () => {
            const bv = await obd!.readBatteryVoltage(); const rpm = await obd!.readPid("rpm"); const v = bv.atrv ?? bv.pid42; const running = rpm != null && rpm > 400;
            if (v != null) set(running ? "chg" : "soc")(v.toFixed(2));
            setStatus(`ATRV ${bv.atrv?.toFixed(2) ?? "n/a"} V · PID42 ${bv.pid42?.toFixed(2) ?? "n/a"} V · engine ${running ? "running → charging" : "off → resting"}`);
          })} />
          <Btn title="Capture cranking minimum (experimental)" disabled={!connected || busy} onPress={() => run("Sampling ATRV — crank now", async () => {
            const emu = Link.getEmulator(); if (emu) { emu.engineRunning = false; setTimeout(() => emu.startCrank(1800), 1500); }
            let min = Infinity; const t0 = Date.now();
            while (Date.now() - t0 < 8000) { const r = parseAtrv(await obd!.raw("ATRV", 2000)); if (r != null) min = Math.min(min, r); }
            if (isFinite(min)) { set("crank")(min.toFixed(1)); setStatus(`Lowest ATRV sample ${min.toFixed(1)} V (sample rate limited — confirm with a meter MIN/MAX)`); }
          })} />
        </Card>
        <Card title="Resting voltage → state of charge" intro="Engine off, rested ≥1 h. ~12.6 V ≈ full (flooded).">
          <Field label="Resting voltage" unit="V" value={f.soc ?? ""} onChange={set("soc")} />
          <View style={s.rowBetween}><Text style={s.body}>AGM battery</Text><Switch value={!!flags.agm} onValueChange={(v: boolean) => setFlags((x) => ({ ...x, agm: v }))} /></View>
          <Res r={socR} /><Btn title="Save to report" onPress={() => save("battery_soc", "Battery state of charge", socR, { volts: f.soc, type: flags.agm ? "agm" : "flooded" })} />
        </Card>
        <Card title="Cranking voltage" intro="Should stay above ~9.6 V at 21 °C (lower limit in the cold).">
          <Field label="Lowest voltage while cranking" unit="V" value={f.crank ?? ""} onChange={set("crank")} />
          <Field label="Battery temperature (optional)" unit="°C" value={f.crankT ?? ""} onChange={set("crankT")} />
          <Res r={crankR} /><Btn title="Save to report" onPress={() => save("cranking", "Cranking voltage", crankR, { minVolts: f.crank, tempC: f.crankT })} />
        </Card>
        <Card title="Charging voltage" intro="~13.5–14.7 V conventional; smart charging can sit lower.">
          <Field label="Charging voltage" unit="V" value={f.chg ?? ""} onChange={set("chg")} />
          <View style={s.rowBetween}><Text style={s.body}>Smart / ECM-controlled charging</Text><Switch value={!!flags.smart} onValueChange={(v: boolean) => setFlags((x) => ({ ...x, smart: v }))} /></View>
          <Res r={chgR} /><Btn title="Save to report" onPress={() => save("charging", "Charging voltage", chgR, { volts: f.chg, smart: !!flags.smart })} />
        </Card>
        <Card title="Alternator AC ripple" intro="Meter on AC volts at the alternator output, ~2000 rpm, loads on.">
          <Field label="AC ripple" unit="V AC" value={f.rip ?? ""} onChange={set("rip")} />
          <Res r={ripR} /><Btn title="Save to report" onPress={() => save("ripple", "Alternator ripple", ripR, { acVolts: f.rip })} />
        </Card>
      </>}

      {section === "vdrop" && <Card title="Voltage drop" intro="Circuit ON and loaded. Power side: battery + to load +. Ground side: load ground to battery −.">
        <View style={s.row}>{(Object.keys(TH.voltageDrop) as D.CircuitType[]).map((c) => <Chip key={c} on={circuit === c} label={TH.voltageDrop[c].label} onPress={() => setCircuit(c)} />)}</View>
        <Field label="Measured drop" unit="V" value={f.vd ?? ""} onChange={set("vd")} />
        <View style={s.rowBetween}><Text style={s.body}>Circuit was NOT loaded</Text><Switch value={!!flags.unloaded} onValueChange={(v: boolean) => setFlags((x) => ({ ...x, unloaded: v }))} /></View>
        <Res r={vdR} /><Btn title="Save to report" onPress={() => save("voltage_drop", "Voltage drop: " + TH.voltageDrop[circuit].label, vdR, { circuit, reading: f.vd })} />
      </Card>}

      {section === "draw" && <>
        <Card title="Total parasitic draw" intro="Typical 20–50 mA once modules sleep (some vehicles specify up to ~85 mA).">
          <Field label="Measured draw" unit="mA" value={f.draw ?? ""} onChange={set("draw")} />
          <Field label="Battery capacity" unit="Ah" value={f.ah ?? ""} onChange={set("ah")} />
          <Res r={drawR} /><Btn title="Save to report" onPress={() => save("parasitic_draw", "Parasitic draw", drawR, { milliamps: f.draw })} />
        </Card>
        <Card title="Fuse voltage drop → current" intro="mV across the fuse ÷ fuse resistance (approximate values; check your fuse maker's chart).">
          <View style={s.row}>{(Object.keys(FUSE_TYPE_LABELS) as FuseType[]).map((t) => <Chip key={t} on={fuseType === t} label={FUSE_TYPE_LABELS[t]} onPress={() => { setFuseType(t); setFuseRating(fuseRatings(t)[0]); }} />)}</View>
          <View style={s.row}>{fuseRatings(fuseType).map((r) => <Chip key={r} on={fuseRating === r} label={`${r} A · ${DEFAULT_FUSE_RESISTANCE_MOHM[fuseType][r]} mΩ`} onPress={() => setFuseRating(r)} />)}</View>
          <Field label="Measured across fuse" unit="mV" value={f.fmv ?? ""} onChange={set("fmv")} />
          <Res r={fuseR} /><Btn title="Save to report" onPress={() => save("fuse_drop", `Fuse drop: ${fuseType} ${fuseRating} A`, fuseR, { type: fuseType, rating: fuseRating, millivolts: f.fmv })} />
        </Card>
      </>}

      {section === "faults" && <Card title="Circuit fault finder">
        <View style={s.row}>{FAULT_TREES.map((t) => <Chip key={t.id} on={t.id === treeId} label={t.title} onPress={() => { setTreeId(t.id); setAnswers([]); }} />)}</View>
        <Text style={s.muted}>{tree.summary}</Text>
        <Res r={{ status: walk.node.finding ? "warn" : "info", message: walk.node.text } as D.Result} />
        <View style={s.row}>
          {!walk.node.finding && <><Btn title="Yes" onPress={() => setAnswers([...answers, "yes"])} /><Btn title="No" onPress={() => setAnswers([...answers, "no"])} /></>}
          {walk.node.finding && <Btn title="Save finding" onPress={() => save("fault_finder", tree.title, { status: "info", message: walk.node.text } as D.Result, { answers: answers.join(" → ") })} />}
          {answers.length > 0 && <Btn title="Back" onPress={() => setAnswers(answers.slice(0, -1))} />}
        </View>
      </Card>}

      {section === "sensors" && <>
        <Card title="3-wire sensor (5 V ref · signal · ground)">
          <Field label="Reference" unit="V" value={f.sRef ?? ""} onChange={set("sRef")} />
          <Field label="Signal" unit="V" value={f.sSig ?? ""} onChange={set("sSig")} />
          <Field label="Ground drop" unit="V" value={f.sGnd ?? ""} onChange={set("sGnd")} />
          <Res r={s3R} /><Btn title="Save to report" onPress={() => save("sensor_3wire", "3-wire sensor", s3R, { ref: f.sRef, signal: f.sSig, groundDrop: f.sGnd })} />
        </Card>
        <Card title="Meter vs scan tool" intro="Enter your meter reading next to the ECU's live value.">
          <Btn title="Read scan-tool values" disabled={!connected || busy} onPress={() => run("Reading PIDs", async () => {
            const out: Partial<Record<LivePidKey, number | null>> = {};
            for (const k of ["module_voltage", "coolant_c", "intake_air_c", "throttle_pct", "map_kpa"] as LivePidKey[]) out[k] = await obd!.readPid(k);
            setScanVals(out); setStatus("Scan values read");
          })} />
          {(Object.keys(scanVals) as LivePidKey[]).map((k) => { const sv = scanVals[k]; const mv = n(f["m_" + k] ?? ""); const r = sv != null && mv != null ? safe(() => D.compareReadings({ meter: mv, scan: sv })) : null; return (
            <View key={k} style={s.step}><Text style={s.bold}>{LIVE_PIDS[k].label}: scan {sv == null ? "n/a" : sv.toFixed(2)}</Text>
              <Field label="Meter" value={f["m_" + k] ?? ""} onChange={set("m_" + k)} /><Res r={r} /></View>); })}
        </Card>
      </>}

      {section === "can" && <>
        <Card title="CAN termination (DLC 6 ↔ 14)" intro="Battery disconnected. ~60 Ω normal, ~120 Ω one terminator missing, ~0 short, OL open.">
          <Field label="Resistance" unit="Ω" value={f.canR ?? ""} onChange={set("canR")} />
          <View style={s.rowBetween}><Text style={s.body}>Meter reads OL (open)</Text><Switch value={!!flags.canOpen} onValueChange={(v: boolean) => setFlags((x) => ({ ...x, canOpen: v }))} /></View>
          <Res r={canR} /><Btn title="Save to report" onPress={() => save("can_termination", "CAN termination", canR, { ohms: flags.canOpen ? "OL" : f.canR })} />
        </Card>
        <Card title="CAN-H / CAN-L voltage" intro="Ignition on, to pin 4/5: ~2.5 V idle; H 2.5–3.5 V, L 1.5–2.5 V.">
          <Field label="CAN-H (pin 6)" unit="V" value={f.canH ?? ""} onChange={set("canH")} />
          <Field label="CAN-L (pin 14)" unit="V" value={f.canL ?? ""} onChange={set("canL")} />
          <Res r={canV} /><Btn title="Save to report" onPress={() => save("can_voltage", "CAN voltages", canV, { canH: f.canH, canL: f.canL })} />
        </Card>
        <Card title="OBD-II connector pins">{DLC_PINS.map((p) => <Text key={p.pin} style={s.body}><Text style={s.bold}>{p.pin}</Text>  {p.use}</Text>)}</Card>
      </>}

      {section === "safety" && <Card title="Safety notes">{SAFETY_NOTES.map((x) => <View key={x.title} style={[s.banner, { borderLeftColor: x.level === "danger" ? "#e5484d" : x.level === "info" ? "#5fa8d3" : "#e8c33a" }]}><Text style={s.body}><Text style={s.bold}>{x.title}. </Text>{x.body}</Text></View>)}</Card>}

      {section === "report" && <Card title="Diagnostic report">
        {kind === "demo" && <Text style={s.muted}>Demo session — simulated data (the report says so).</Text>}
        <Text style={s.body}>{sum.counts.pass} pass · {sum.counts.warn} warn · {sum.counts.fail} fail · {sum.counts.info} info · workflow {sum.stepsDone}/{sum.stepsTotal} · {sum.codes} code(s)</Text>
        {sess.tests.map((t, i) => <Text key={i} style={s.body}><Text style={{ color: ST_COLOR[t.status], fontWeight: "800" }}>{t.status.toUpperCase()} </Text>{t.label} — {t.message}</Text>)}
        <View style={s.row}>
          <Btn title="Export JSON" onPress={() => exportJsonFile("cartune_diag_report.json", buildReportJson({ ...sess, adapter: { mode: kind ?? "none" } }))} />
          <Btn title="Export HTML (print to PDF)" onPress={() => exportTextFile("cartune_diag_report.html", buildReportHtml({ ...sess, adapter: { mode: kind ?? "none" } }), "text/html")} />
          <Btn title="New session" danger onPress={() => Alert.alert("Start a new session?", "Clears checklist, notes and saved tests.", [{ text: "Cancel", style: "cancel" }, { text: "New session", style: "destructive", onPress: () => { setSess(newSession({ title: ct.vehicle.title, vin: ct.vehicle.vin ?? null }, { mode: kind ?? "none" })); setScan(null); setFf(null); } }])} />
        </View>
      </Card>}
      <Text style={s.foot}>{D.GUIDELINE_NOTE}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, backgroundColor: "#181d23", flexGrow: 1 },
  card: { backgroundColor: "#222a33", borderRadius: 16, padding: 14, marginBottom: 12 },
  banner: { backgroundColor: "#222a33", borderRadius: 12, padding: 12, marginBottom: 8, borderLeftWidth: 5 },
  h3: { color: "#eaeef2", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  body: { color: "#eaeef2", lineHeight: 20, flexShrink: 1 },
  bold: { color: "#eaeef2", fontWeight: "800" },
  muted: { color: "#98a4b0", lineHeight: 19, marginBottom: 6 },
  status: { color: "#98a4b0", marginVertical: 4 },
  lbl: { color: "#98a4b0", fontSize: 13, marginBottom: 4 },
  field: { marginTop: 8 },
  input: { backgroundColor: "#181d23", color: "#eaeef2", borderWidth: 1, borderColor: "#36414d", borderRadius: 10, padding: 10, fontSize: 16 },
  note: { minHeight: 44, marginTop: 6, textAlignVertical: "top" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 },
  step: { borderTopWidth: 1, borderTopColor: "#36414d", paddingTop: 10, marginTop: 10 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: "#36414d", paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: "#5fa8d3", borderColor: "#5fa8d3" },
  chipText: { color: "#c9d1d9" }, chipTextOn: { color: "#0e1418", fontWeight: "700" },
  btn: { borderRadius: 10, borderWidth: 1, borderColor: "#36414d", backgroundColor: "#2b3540", paddingVertical: 10, paddingHorizontal: 14, marginTop: 8 },
  btnDanger: { borderColor: "#e5484d", backgroundColor: "transparent" },
  btnText: { color: "#eaeef2", fontWeight: "700" },
  res: { backgroundColor: "#181d23", borderLeftWidth: 5, borderRadius: 10, padding: 10, marginTop: 10 },
  resSt: { fontWeight: "800", marginBottom: 2 },
  foot: { color: "#6b7785", fontSize: 12, marginTop: 8, marginBottom: 24 },
});

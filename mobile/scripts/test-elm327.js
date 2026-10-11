// ELM327 layer: DTC/VIN/PID decoders against documented reply formats
// (headers on/off, spaces on/off, ISO-TP multi-frame, legacy protocols),
// plus a full ObdSession run against the ELM327 emulator.
const a = require("assert");
const E = require("./ble/elm327");
const { ElmEmulator, DEFAULT_DEMO_VEHICLE } = require("./ble/elmEmulator");
const { ObdSession, emulatorTransport } = require("./ble/obdSession");
let n = 0; const eq = (x, y, m) => { a.deepStrictEqual(x, y, m); n++; }; const ok = (v, m) => { a.ok(v, m); n++; };

// --- original single-line helpers still behave as before
eq(E.decodeDtcPair(0x01, 0x33), "P0133");
eq(E.decodeDtcPair(0x41, 0x23), "C0123");
eq(E.decodeDtcPair(0x81, 0x00), "B0100");
eq(E.decodeDtcPair(0xc1, 0x00), "U0100");
eq(E.decodeDtcPair(0, 0), null);
eq(E.decodeDtcResponse("43 02 01 33 04 21"), ["P0133", "P0421"]);
eq(E.decodePidResponseBytes("41 0C 1A F8"), [0x1a, 0xf8]);
eq(E.LIVE_PIDS.rpm.decode([0x1a, 0xf8]), 1726);
eq(E.decodeVinResponse(["014", "0:490201314731", "1:5A453553543948", "2:46313233343536"]), "1G1ZE5ST9HF123456");

// --- encodeDtc is the exact inverse of decodeDtcPair
for (const c of ["P0171", "P0300", "C0035", "B1234", "U0100", "P2A3F", "U3FFF"]) eq(E.decodeDtcPair(...E.encodeDtc(c)), c);
a.throws(() => E.encodeDtc("X0100")); n++;

// --- cleanLines / responseError
eq(E.cleanLines("0100\rSEARCHING...\r41 00 BE 3F A8 13\r\r>", "0100"), ["41 00 BE 3F A8 13"]);
eq(E.responseError("NO DATA\r\r>"), "NO DATA");
eq(E.responseError("UNABLE TO CONNECT\r>"), "UNABLE TO CONNECT");
eq(E.responseError("?\r>"), "?");
eq(E.responseError("41 0C 1A F8\r>"), null);

// --- PID parsing in every format
const rpmFormats = ["41 0C 1A F8", "410C1AF8", "7E8 04 41 0C 1A F8", "7E804410C1AF8", "18 DA F1 10 04 41 0C 1A F8", "48 6B 10 41 0C 1A F8 A2"];
for (const f of rpmFormats) eq(E.decodeLivePid("rpm", f), 1726, f);
eq(E.decodeLivePid("coolant_c", "7E8 03 41 05 7B"), 83);
eq(E.decodeLivePid("module_voltage", "7E8 04 41 42 37 5A"), 14.17);
eq(E.decodeLivePid("rpm", "NO DATA"), null);
eq(E.decodeLivePid("timing_adv_deg", "41 0E 98"), 12);
eq(E.decodeSupportedPids(0, [0xbe, 0x1f, 0xa8, 0x13]).slice(0, 6), [1, 3, 4, 5, 6, 7]);
ok(E.decodeSupportedPids(0, [0xbe, 0x1f, 0xa8, 0x13]).includes(0x20));

// --- DTC parsing: CAN (count byte) vs legacy (3 pairs), multiple ECUs, headers
eq(E.decodeDtcs("43 02 01 71 03 00", 3), ["P0171", "P0300"]);
eq(E.decodeDtcs("7E8 06 43 02 01 71 03 00", 3), ["P0171", "P0300"]);
eq(E.decodeDtcs("7E8 02 43 00", 3), []);
eq(E.decodeDtcs("7E8 04 47 01 03 00\r7E9 04 47 01 07 00", 7), ["P0300", "P0700"]);
eq(E.decodeDtcs("48 6B 10 43 01 71 03 00 00 00 5C", 3), ["P0171", "P0300"]);
eq(E.decodeDtcs("43 01 71 00 00 00 00", 3), ["P0171"]);
// multi-frame CAN reply with 4 DTCs (9-byte payload → FF + CF)
eq(E.decodeDtcs(["7E8 10 0A 43 04 01 71 03 00", "7E8 21 01 33 04 20 00 00"], 3), ["P0171", "P0300", "P0133", "P0420"]);
eq(E.decodeDtcs(["00A", "0: 43 04 01 71 03 00", "1: 01 33 04 20 00 00 00"], 3), ["P0171", "P0300", "P0133", "P0420"]);
eq(E.decodeDtcs("4A 01 01 71", 10), ["P0171"]);

// --- VIN in each format
const vinHex = Buffer.from("1G1ZE5ST9HF123456").toString("hex").toUpperCase().match(/../g);
eq(E.decodeVinFromResponse(["7E8 10 14 49 02 01 " + vinHex.slice(0, 3).join(" "), "7E8 21 " + vinHex.slice(3, 10).join(" "), "7E8 22 " + vinHex.slice(10, 17).join(" ")]), "1G1ZE5ST9HF123456");
eq(E.decodeVinFromResponse(["014", "0: 49 02 01 " + vinHex.slice(0, 3).join(" "), "1: " + vinHex.slice(3, 10).join(" "), "2: " + vinHex.slice(10, 17).join(" ")]), "1G1ZE5ST9HF123456");
const legacy = ["49 02 01 00 00 00 " + vinHex.slice(0, 1).join(" ")].concat([1, 5, 9, 13].map((s, i) => `49 02 0${i + 2} ` + vinHex.slice(s, s + 4).join(" ")));
eq(E.decodeVinFromResponse(legacy), "1G1ZE5ST9HF123456");

// --- Cal ID, ATRV, freeze frame
eq(E.decodeCalIds(["7E8 10 13 49 04 01 48 41 43", "7E8 21 43 4B 47 36 00 00 00", "7E8 22 00 00 00 00 00 00 00"]), ["HACCKG6"]);
eq(E.parseAtrv("ATRV\r12.6V\r\r>"), 12.6);
eq(E.parseAtrv("14.2V"), 14.2);
eq(E.parseAtrv("?"), null);
eq(E.freezeFrameCmd("010C"), "020C00");
eq(E.freezeFrameBytes("7E8 05 42 0C 00 0C 80", "020C00"), [0x0c, 0x80]);
eq(E.decodeFreezeFrameDtc("7E8 05 42 02 00 01 71"), "P0171");

// --- Emulator + session end to end (headers ON, as INIT_SEQUENCE sets)
(async () => {
  let t = 0;
  const emu = new ElmEmulator(DEFAULT_DEMO_VEHICLE, { now: () => t });
  const s = new ObdSession(emulatorTransport(emu));
  await s.init();
  ok(s.headers, "ATH1 honoured");
  ok(emu.headers && !emu.echo && !emu.spaces);
  eq(s.adapterId, "ELM327 v1.5");
  ok(s.isSupported("rpm") && s.isSupported("module_voltage") && s.isSupported("fuel_level_pct"));
  eq(await s.readVin(), "1G1ZE5ST9HF123456");
  eq(await s.readCalIds(), ["12612384"]);
  const d = await s.readDtcs();
  eq([d.stored, d.pending, d.permanent], [["P0171"], ["P0300"], ["P0171"]]);
  const ff = await s.readFreezeFrame(["rpm", "coolant_c", "long_fuel_trim_pct"]);
  eq(ff.dtc, "P0171"); eq(ff.values.rpm, 812); eq(ff.values.coolant_c, 88);
  ok(Math.abs(ff.values.long_fuel_trim_pct - 14.8) < 0.5);
  t = 3000;
  const rpm = await s.readPid("rpm"); ok(rpm > 700 && rpm < 2000, "rpm " + rpm);
  const bv = await s.readBatteryVoltage(); eq(bv.atrv, 14.2); ok(Math.abs(bv.pid42 - 14.2) < 0.2);
  // clear codes needs explicit confirmation; nothing is sent without it
  await a.rejects(s.clearDtcs({})); n++;
  await a.rejects(s.clearDtcs()); n++;
  ok(!emu.log.includes("04"), "Mode 04 must not be sent unconfirmed");
  ok(await s.clearDtcs({ confirmed: true }));
  const after = await s.readDtcs();
  eq([after.stored, after.pending, after.permanent], [[], [], ["P0171"]]);
  eq((await s.readFreezeFrame(["rpm"])).dtc, null);
  // headers off + spaces on also parse
  const emu2 = new ElmEmulator(DEFAULT_DEMO_VEHICLE, { now: () => 0 });
  emu2.handle("ATE0");
  const s2 = new ObdSession(emulatorTransport(emu2));
  eq(await s2.readVin(), "1G1ZE5ST9HF123456");
  eq((await s2.readDtcs()).stored, ["P0171"]);
  console.log(`ELM327 TESTS PASSED — ${n} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });

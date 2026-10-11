/**
 * Pro tables — every calibration table for this ECU family, open for
 * cell-by-cell editing. For professional tuners: no caps beyond each
 * table's physical limits; the safety overlay flags cells, never blocks.
 */
import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ECU_PROFILES } from "../ecu/ecuProfiles";
import {
  Sel, TableDef, addSel, checkTable, demoData, diffCount, interpolateSel, scaleSel, smoothSel, tablesFor,
} from "../tune/tables";
import { useCarTune } from "../state/CarTuneContext";

const FLAG = { yellow: "#e8c33a", orange: "#f08a2b", red: "#e0463c" };
const stepFor = (t: TableDef) => (t.decimals === 0 ? (t.max - t.min > 500 ? 10 : 1) : t.decimals === 1 ? 0.5 : Math.pow(10, -t.decimals) * (t.decimals >= 3 ? 5 : 1));
const heat = (v: number, lo: number, hi: number) => { const f = hi === lo ? 0.5 : (v - lo) / (hi - lo); return `hsl(${Math.round(220 - 200 * f)}, 55%, ${Math.round(38 + 10 * (1 - Math.abs(f - 0.5) * 2))}%)`; };

export default function ProTablesScreen({ route, navigation }: any) {
  const ct = useCarTune();
  const slot: string = route?.params?.presetId ?? "factory";
  const turbo = ct.vehicle.engine !== "na_petrol";
  const tables = tablesFor(ct.vehicle.ecuId ?? "", turbo);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState(tables[0]?.category);
  const [tid, setTid] = useState(tables[0]?.id);
  const [sel, setSel] = useState<Sel | null>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const [range, setRange] = useState(false);
  const [undo, setUndo] = useState<number[][][]>([]);

  const grids = useMemo(() => {
    const all: Record<string, number[][]> = {};
    tables.forEach((t) => (all[t.id] = ct.slotTable(slot, t.id) ?? demoData(t)));
    return all;
  }, [tables, slot, ct]);

  if (!tables.length) {
    const prof = ECU_PROFILES.find((p) => p.id === ct.vehicle.ecuId);
    return (
      <View style={s.page}><Text style={s.body}>{prof ? `${prof.manufacturer} ${prof.family}` : "This ECU"}: table map isn’t loaded yet. Full tables appear once its definition is added.</Text></View>
    );
  }
  const cats = Array.from(new Set(tables.map((t) => t.category)));
  const list = tables.filter((t) => (q ? (t.name + t.category).toLowerCase().includes(q.toLowerCase()) : t.category === cat));
  const t = tables.find((x) => x.id === tid) ?? list[0] ?? tables[0];
  const g = grids[t.id], base = demoData(t);
  const flags = checkTable(t, g, { all: grids, turbo });
  const flat = g.flat(), lo = Math.min(...flat), hi = Math.max(...flat);
  const st = stepFor(t);
  const inSel = (r: number, c: number) => !!sel && r >= Math.min(sel.r0, sel.r1) && r <= Math.max(sel.r0, sel.r1) && c >= Math.min(sel.c0, sel.c1) && c <= Math.max(sel.c0, sel.c1);

  function apply(ng: number[][]) { setUndo((u) => [...u, g]); ct.saveTable(slot, t.id, ng); }
  function tap(r: number, c: number) {
    if (range && anchor) { setSel({ r0: anchor.r, c0: anchor.c, r1: r, c1: c }); setAnchor(null); }
    else { setSel({ r0: r, c0: c, r1: r, c1: c }); setAnchor(range ? { r, c } : null); }
  }
  const Tool = ({ label, onPress, disabled, on }: { label: string; onPress: () => void; disabled?: boolean; on?: boolean }) => (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.tool, on && s.toolOn, disabled && { opacity: 0.35 }]}><Text style={[s.toolText, on && { color: "#5fa8d3" }]}>{label}</Text></TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={s.page}>
      <TouchableOpacity style={s.setBtn} onPress={() => navigation.navigate("ProSettings", { presetId: slot })}>
        <Text style={s.setBtnText}>Settings (every single value from your file)</Text>
      </TouchableOpacity>
      <TextInput style={s.search} placeholder="Search tables" placeholderTextColor="#6b7682" value={q} onChangeText={setQ} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
        {cats.map((c) => (
          <TouchableOpacity key={c} style={[s.chip, !q && cat === c && s.chipOn]} onPress={() => { setQ(""); setCat(c); setSel(null); }}>
            <Text style={[s.chipText, !q && cat === c && s.chipTextOn]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {list.map((x) => {
          const n = diffCount(grids[x.id], demoData(x));
          return (
            <TouchableOpacity key={x.id} style={[s.titem, x.id === t.id && s.titemOn]} onPress={() => { setTid(x.id); setSel(null); setUndo([]); }}>
              <Text style={s.titemText}>{x.name}</Text>
              <Text style={s.small}>{x.realData ? "● real, from your file" : "platform · demo"}{n ? ` · ${n} edited` : ""}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={s.editor}>
        <Text style={s.h3}>{t.name}</Text>
        <Text style={s.small}>{t.unit}{t.rows ? ` · rows: ${t.rows.name}` : ""}{t.cols ? ` · columns: ${t.cols.name}` : ""}</Text>
        <View style={s.row}>
          <Text style={[s.tag, t.provenance === "file" && s.tagLive]}>{t.provenance === "file" ? "From your file" : "Platform table · confirm vs your file"}</Text>
          <Text style={[s.tag, t.realData || t.realValue !== undefined ? s.tagLive : s.tagDemo]}>{t.realData || t.realValue !== undefined ? "Real values" : "Demo values"}</Text>
          {t.hpId ? <Text style={s.tag}>HPT #{t.hpId}</Text> : null}
        </View>
        {t.note && <Text style={s.small}>{t.note}</Text>}
        <View style={[s.row, { marginVertical: 8 }]}>
          <Tool label={`−${st}`} disabled={!sel} onPress={() => apply(addSel(t, g, sel!, -st))} />
          <Tool label={`+${st}`} disabled={!sel} onPress={() => apply(addSel(t, g, sel!, st))} />
          <Tool label="−1%" disabled={!sel} onPress={() => apply(scaleSel(t, g, sel!, -1))} />
          <Tool label="+1%" disabled={!sel} onPress={() => apply(scaleSel(t, g, sel!, 1))} />
          <Tool label="Smooth" disabled={!sel} onPress={() => apply(smoothSel(t, g, sel!))} />
          <Tool label="Interpolate" disabled={!sel} onPress={() => apply(interpolateSel(t, g, sel!))} />
          <Tool label="Undo" disabled={!undo.length} onPress={() => { const prev = undo[undo.length - 1]; setUndo(undo.slice(0, -1)); ct.saveTable(slot, t.id, prev); }} />
          <Tool label="Revert" onPress={() => apply(base)} />
          <Tool label="Range select" on={range} onPress={() => { setRange(!range); setAnchor(!range && sel ? { r: sel.r0, c: sel.c0 } : null); }} />
        </View>
        <ScrollView horizontal>
          <View>
            {t.cols && (
              <View style={s.gridRow}>
                <Text style={[s.axis, s.corner]}>{t.rows?.unit || ""}</Text>
                {t.cols.values.map((v, c) => <Text key={c} style={s.axis}>{v}</Text>)}
              </View>
            )}
            {g.map((rowVals, r) => (
              <View key={r} style={s.gridRow}>
                <Text style={[s.axis, s.corner]}>{t.rows ? t.rows.values[r] : t.unit}</Text>
                {rowVals.map((v, c) => {
                  const f = flags[r][c], changed = v !== base[r][c], on = inSel(r, c);
                  return (
                    <TouchableOpacity key={c} onPress={() => tap(r, c)} accessibilityLabel={`${v}${f ? ", " + f.note : ""}`}
                      style={[s.cell, { backgroundColor: heat(v, lo, hi) }, f && { borderColor: FLAG[f.level], borderWidth: 3 }, on && s.cellSel]}>
                      <Text style={[s.cellText, changed && s.cellChanged]}>{v.toFixed(t.decimals)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>
        <Text style={s.small}>
          {sel ? (() => { const n = (Math.abs(sel.r1 - sel.r0) + 1) * (Math.abs(sel.c1 - sel.c0) + 1); const f = flags[sel.r0][sel.c0];
            return `${n} cell${n > 1 ? "s" : ""} selected${n === 1 ? `: ${g[sel.r0][sel.c0]} (base ${base[sel.r0][sel.c0]})` : ""}${f ? " — " + f.note : ""}. `; })() : ""}
          {diffCount(g, base) ? `${diffCount(g, base)} cells changed from base.` : "Matches base file."}
          {range ? (anchor ? " Tap the opposite corner." : " Range select on: tap a corner, then the opposite corner.") : ""}
        </Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, backgroundColor: "#181d23", flexGrow: 1 },
  body: { color: "#eaeef2" },
  setBtn: { borderWidth: 1, borderColor: "#5fa8d3", borderRadius: 12, padding: 12, alignItems: "center", marginBottom: 10 },
  setBtnText: { color: "#9fd0ee", fontWeight: "700" },
  search: { borderWidth: 1, borderColor: "#36414d", borderRadius: 10, color: "#eaeef2", padding: 10, backgroundColor: "#222a33" },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: "#36414d", paddingVertical: 7, paddingHorizontal: 12, marginRight: 7 },
  chipOn: { backgroundColor: "#5fa8d3", borderColor: "#5fa8d3" }, chipText: { color: "#c9d1d9" }, chipTextOn: { color: "#0e1418", fontWeight: "700" },
  titem: { backgroundColor: "#222a33", borderWidth: 1, borderColor: "#36414d", borderRadius: 10, padding: 10, marginRight: 8, minWidth: 170 },
  titemOn: { borderColor: "#5fa8d3" }, titemText: { color: "#eaeef2", fontWeight: "700" },
  small: { color: "#98a4b0", fontSize: 12, marginTop: 4 },
  editor: { backgroundColor: "#222a33", borderRadius: 16, padding: 14, marginTop: 12 },
  h3: { color: "#eaeef2", fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  tag: { color: "#98a4b0", borderWidth: 1, borderColor: "#36414d", borderRadius: 6, paddingHorizontal: 6, fontSize: 12 },
  tagLive: { color: "#2fb36b", borderColor: "#2fb36b" }, tagDemo: { color: "#e8c33a", borderColor: "#e8c33a" },
  tool: { borderWidth: 1, borderColor: "#36414d", backgroundColor: "#2b3540", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  toolOn: { borderColor: "#5fa8d3" }, toolText: { color: "#eaeef2", fontWeight: "700", fontSize: 13 },
  gridRow: { flexDirection: "row" },
  axis: { width: 52, color: "#98a4b0", fontSize: 11, textAlign: "right", paddingVertical: 6, paddingRight: 6, fontWeight: "600" },
  corner: { width: 56 },
  cell: { width: 52, paddingVertical: 6, paddingRight: 5, borderWidth: 0.5, borderColor: "rgba(0,0,0,0.2)" },
  cellSel: { borderColor: "#ffffff", borderWidth: 2 },
  cellText: { color: "#fff", fontSize: 12, textAlign: "right", fontVariant: ["tabular-nums"] },
  cellChanged: { fontWeight: "800", textDecorationLine: "underline" },
});

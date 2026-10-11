/**
 * Tune detail — opened from a saved tune tile on Home.
 * Summary first; sliders grouped in tabs underneath (progressive disclosure).
 * Every change saves to the slot instantly. Flash button is docked at the
 * bottom so the goal is always one tap away.
 */
import React, { useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import ZoneSlider, { ZONE_COLOR } from "../components/ZoneSlider";
import { Action, Advice, Segment, Skill, ToggleDef, Zone, applyAction, evaluate, isOn, rangeFor, segmentsFor, settingsFor, togglesFor } from "../tune/rules";
import { PRESETS } from "../tune/presets";
import { useCarTune } from "../state/CarTuneContext";

const ZONE_LABEL: Record<Zone, string> = { green: "No risk", yellow: "Fine, could be better", orange: "Warning", red: "Likely damage" };
export default function TuneScreen({ route, navigation }: any) {
  const ct = useCarTune();
  const preset = PRESETS.find((p) => p.id === route?.params?.presetId) ?? PRESETS[0];
  const ctx = ct.context();
  const values = ct.slotValues(preset.id);
  const setValues = (v: typeof values) => ct.saveSlot(preset.id, v);
  const [segment, setSegment] = useState<Segment>("Fuel");
  const [open, setOpen] = useState<string | null>(null);

  const evalr = useMemo(() => evaluate(ctx, values), [ctx, values]);
  const settings = settingsFor(ctx.engine, ctx.skill);
  const toggles = togglesFor(ctx.engine, ctx.skill);
  const segs = segmentsFor(ctx.engine, ctx.skill);

  function act(a: Action) {
    if (a.kind === "toggle") {
      const t = toggles.find((x) => x.id === a.id);
      if (t?.agreement && a.value !== t.stock && !ct.agreed) return askAgreement(() => setValues({ ...values, [a.id]: a.value ? 1 : 0 }));
    }
    const r = applyAction(ctx, values, a);
    if (r.ctx.fuel !== ctx.fuel) ct.setFuel(r.ctx.fuel);
    if (r.ctx.upgrades !== ctx.upgrades) ct.setUpgrades(r.ctx.upgrades);
    setValues(r.values);
  }

  function askAgreement(onAccept: () => void) {
    Alert.alert(
      "User agreement",
      "Emissions-system changes are for off-road, competition and export use. You are responsible for how and where the vehicle is used, and for doing the matching hardware work. Accept the CarTune user agreement to continue.",
      [{ text: "Cancel", style: "cancel" }, { text: "I accept", onPress: () => { ct.setAgreed(true); onAccept(); } }],
    );
  }

  const Fixes = ({ title, list }: { title: string; list: Advice[] }) => list.length === 0 ? null : (
    <View style={{ marginTop: 8 }}>
      <Text style={s.small}>{title}</Text>
      {list.map((a, i) => (
        <TouchableOpacity key={i} style={s.fix} onPress={() => act(a.action)}>
          <Text style={s.fixText}>{a.text}</Text>{a.why && <Text style={s.fixWhy}>{a.why}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );

  function ToggleCard({ t }: { t: ToggleDef }) {
    const r = evalr.results[t.id];
    const on = isOn(t, values);
    return (
      <View style={[s.card, { flexDirection: "column" }]}>
        <View style={s.cardHead}>
          <Text style={[s.name, { flex: 1 }]}>{t.name}{t.agreement ? "  ·  Agreement" : ""}</Text>
          <Switch value={on} accessibilityLabel={t.name} onValueChange={(nv) => act({ kind: "toggle", id: t.id, value: nv })} />
        </View>
        <View style={[s.badge, { backgroundColor: ZONE_COLOR[r.zone] }]}><Text style={s.badgeText}>{on ? "On" : "Off"}{on === t.stock ? " · factory" : ""}</Text></View>
        <Text style={s.body}>{r.headline}</Text>
        {r.why && <Text style={s.muted}>{r.why}</Text>}
        {r.risks && <View style={s.risk}><Text style={s.riskTitle}>What can go wrong</Text><Text style={s.body}>{r.risks}</Text></View>}
        <Fixes title="Other settings that cover it" list={r.otherFixes} />
        <Fixes title="Or undo it" list={r.advice} />
        <Text style={s.muted}>{ctx.skill === "expert" ? t.what.expert : t.what.simple}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#1c2127" }}>
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>{preset.name}</Text>
      <Text style={s.muted}>{preset.feel}</Text>
      <View style={s.levels}>
        {([["simple", "Simply", "Quick sliders"], ["standard", "With detail", "More sliders"], ["expert", "Technically", "Open range + tables"]] as [Skill, string, string][]).map(([k, l, sub]) => (
          <TouchableOpacity key={k} accessibilityRole="radio" accessibilityState={{ checked: ctx.skill === k }}
            style={[s.level, ctx.skill === k && s.levelOn]} onPress={() => ct.setSkill(k)}>
            <Text style={s.levelText}>{l}</Text><Text style={s.levelSub}>{sub}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {ctx.skill === "expert" && (
        <TouchableOpacity style={s.proBtn} onPress={() => navigation.navigate("ProTables", { presetId: preset.id })}>
          <Text style={s.fixText}>Open pro tables (every map, cell by cell)</Text>
        </TouchableOpacity>
      )}
      <View style={[s.health, { borderColor: ZONE_COLOR[evalr.overall], marginTop: 14 }]}>
        <View style={[s.dot, { backgroundColor: ZONE_COLOR[evalr.overall] }]} />
        <View style={{ flex: 1 }}>
          <Text style={s.healthTitle}>{ZONE_LABEL[evalr.overall]}</Text>
          <Text style={s.muted}>{evalr.counts.green} safe, {evalr.counts.yellow} fine, {evalr.counts.orange} warning, {evalr.counts.red} danger, for this car on {ctx.fuel === "diesel" ? "diesel" : `${ctx.fuel} fuel`}</Text>
        </View>
      </View>

      {evalr.warnings.map((w, i) => (
        <View key={i} style={[s.warn, { borderLeftColor: ZONE_COLOR[w.level] }]}>
          <Text style={s.warnTitle}>{w.title}</Text>
          <Text style={s.body}>{w.body}</Text>
        </View>
      ))}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabs}>
        {segs.map((g) => {
          const worst = [...settings, ...toggles].filter((x) => x.segment === g).map((x) => evalr.results[x.id].zone)
            .sort((a, b) => ["green", "yellow", "orange", "red"].indexOf(b) - ["green", "yellow", "orange", "red"].indexOf(a))[0];
          return (
            <TouchableOpacity key={g} style={[s.tab, segment === g && s.tabOn]} onPress={() => setSegment(g)}>
              <View style={[s.tabDot, { backgroundColor: ZONE_COLOR[worst] }]} /><Text style={s.tabText}>{g}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {settings.filter((x) => x.segment === segment).map((def) => {
        const r = evalr.results[def.id];
        const v = values[def.id];
        const expanded = open === def.id || r.zone === "orange" || r.zone === "red";
        return (
          <View key={def.id} style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.name}>{def.name}</Text>
              <Text style={[s.value, { color: ZONE_COLOR[r.zone] }]}>{def.format(v, ctx)}</Text>
            </View>
            <ZoneSlider min={rangeFor(def, ctx.skill).min} max={rangeFor(def, ctx.skill).max} step={def.step} value={v} bands={r.bands} zone={r.zone}
              accessibilityLabel={def.name} onChange={(nv) => setValues({ ...values, [def.id]: nv })} />
            <View style={[s.badge, { backgroundColor: ZONE_COLOR[r.zone] }]}><Text style={s.badgeText}>{ZONE_LABEL[r.zone]}</Text></View>
            <Text style={s.body}>{r.effect}</Text>
            <Text style={s.body}>{r.headline}</Text>
            {r.why && <Text style={s.muted}>{r.why}</Text>}
            <Fixes title="Fix it with other settings" list={r.otherFixes} />
            <Fixes title="Or adjust this one" list={r.advice} />
            <TouchableOpacity onPress={() => setOpen(open === def.id ? null : def.id)}>
              <Text style={s.link}>{expanded ? "Less" : "What does this do?"}</Text>
            </TouchableOpacity>
            {expanded && (
              <>
                <Text style={s.muted}>{ctx.skill === "expert" ? def.what.expert : def.what.simple}</Text>
                {r.risks && <View style={s.risk}><Text style={s.riskTitle}>What can go wrong</Text><Text style={s.body}>{r.risks}</Text></View>}
              </>
            )}
          </View>
        );
      })}
      {toggles.filter((t) => t.segment === segment).length > 0 && <Text style={s.h}>Switches</Text>}
      {toggles.filter((t) => t.segment === segment).map((t) => <ToggleCard key={t.id} t={t} />)}
      <TouchableOpacity style={s.reset} onPress={() => ct.resetSlot(preset.id)}><Text style={s.fixText}>Reset to {preset.name} defaults</Text></TouchableOpacity>
    </ScrollView>
    <View style={s.dock}>
      <Text style={[s.muted, { flex: 1 }]}>{ct.onCar === preset.id ? "This tune is on the car" : ct.isEdited(preset.id) ? "Changes saved" : ""}</Text>
      <TouchableOpacity style={s.flashBtn} onPress={() => navigation.navigate("Flash", { presetId: preset.id })}>
        <Text style={s.flashText}>Flash {preset.name}</Text>
      </TouchableOpacity>
    </View>
    </View>
  );
}

const s = StyleSheet.create({
  page: { padding: 16, paddingBottom: 110, backgroundColor: "#1c2127", flexGrow: 1 },
  title: { color: "#e8ecef", fontSize: 32, fontWeight: "800" },
  levels: { flexDirection: "row", gap: 8, marginTop: 14 },
  level: { flex: 1, borderWidth: 1, borderColor: "#3a4450", borderRadius: 12, padding: 10, backgroundColor: "#262d36" },
  levelOn: { borderColor: "#5fa8d3" },
  levelText: { color: "#e8ecef", fontWeight: "700" }, levelSub: { color: "#9aa5b1", fontSize: 11 },
  proBtn: { borderWidth: 1, borderColor: "#5fa8d3", borderRadius: 12, padding: 12, marginTop: 10, alignItems: "center" },
  dock: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingBottom: 26, backgroundColor: "#1c2127ee", borderTopWidth: 1, borderTopColor: "#3a4450" },
  flashBtn: { backgroundColor: "#5fa8d3", borderRadius: 12, paddingVertical: 13, paddingHorizontal: 20 },
  flashText: { color: "#10161c", fontWeight: "800", fontSize: 16 },
  health: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 2, borderRadius: 14, padding: 14, marginBottom: 14, backgroundColor: "#232a32" },
  dot: { width: 18, height: 18, borderRadius: 9 },
  healthTitle: { color: "#e8ecef", fontSize: 20, fontWeight: "700" },
  h: { color: "#e8ecef", fontSize: 18, fontWeight: "700", marginTop: 6, marginBottom: 8 },
  small: { color: "#9aa5b1", fontSize: 13, marginTop: 8, marginBottom: 4 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { borderRadius: 18, borderWidth: 1, borderColor: "#3a4450", paddingVertical: 7, paddingHorizontal: 12 },
  chipOn: { backgroundColor: "#5fa8d3", borderColor: "#5fa8d3" },
  chipText: { color: "#c9d1d9" }, chipTextOn: { color: "#10161c", fontWeight: "700" },
  warn: { backgroundColor: "#262d36", borderLeftWidth: 5, borderRadius: 8, padding: 12, marginTop: 10 },
  warnTitle: { color: "#e8ecef", fontWeight: "700", marginBottom: 4 },
  tabs: { marginTop: 16, marginBottom: 8 },
  tab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, marginRight: 8, backgroundColor: "#262d36" },
  tabOn: { backgroundColor: "#34404d" },
  tabDot: { width: 10, height: 10, borderRadius: 5 },
  tabText: { color: "#e8ecef", fontWeight: "600" },
  card: { backgroundColor: "#262d36", borderRadius: 14, padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  name: { color: "#e8ecef", fontSize: 17, fontWeight: "700" },
  value: { fontSize: 16, fontWeight: "700" },
  badge: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginVertical: 6 },
  badgeText: { color: "#10161c", fontWeight: "700", fontSize: 12 },
  body: { color: "#d5dbe1", lineHeight: 20, marginTop: 2 },
  muted: { color: "#9aa5b1", lineHeight: 19, marginTop: 4 },
  fix: { backgroundColor: "#1c2127", borderWidth: 1, borderColor: "#5fa8d3", borderRadius: 10, padding: 10, marginTop: 6 },
  fixText: { color: "#9fd0ee", fontWeight: "600" },
  fixWhy: { color: "#9aa5b1", fontSize: 12, marginTop: 2 },
  link: { color: "#5fa8d3", marginTop: 10 },
  risk: { backgroundColor: "#3a1f1d", borderRadius: 8, padding: 10, marginTop: 8 },
  riskTitle: { color: "#ffb4ad", fontWeight: "700", marginBottom: 4 },
  reset: { alignItems: "center", padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#3a4450", marginTop: 4, marginBottom: 30 },
});

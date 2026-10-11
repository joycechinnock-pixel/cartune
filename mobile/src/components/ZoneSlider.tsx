/**
 * Slider whose track is split into green / yellow / orange / red segments
 * that move as the zone thresholds adapt. Drag, tap the track, or use the
 * − / + buttons (one interval per press) for fine control.
 */
import React, { useRef, useState } from "react";
import { PanResponder, StyleSheet, Text, TouchableOpacity, View, LayoutChangeEvent } from "react-native";
import type { Zone } from "../tune/rules";

export const ZONE_COLOR: Record<Zone, string> = { green: "#2fb36b", yellow: "#e8c33a", orange: "#f08a2b", red: "#e0463c" };

interface Props {
  min: number; max: number; step: number; value: number;
  bands: { g: number; y: number; o: number; low?: number };
  zone: Zone;
  onChange: (v: number) => void;
  accessibilityLabel: string;
}

export default function ZoneSlider({ min, max, step, value, bands, zone, onChange, accessibilityLabel }: Props) {
  const [width, setWidth] = useState(1);
  const startX = useRef(0);
  const snap = (v: number) => +Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(3);
  const toX = (v: number) => ((v - min) / (max - min)) * width;
  const fromX = (x: number) => snap(min + (Math.max(0, Math.min(width, x)) / width) * (max - min));

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; onChangeRef.current(fromXRef.current(startX.current)); },
      onPanResponderMove: (_e, g) => onChangeRef.current(fromXRef.current(startX.current + g.dx)),
    }),
  ).current;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const fromXRef = useRef(fromX); fromXRef.current = fromX;

  // Segment widths from the adaptive thresholds.
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const lowEdge = bands.low !== undefined ? clamp(bands.low) : min;
  const segs: { from: number; to: number; zone: Zone }[] = [];
  if (lowEdge > min) segs.push({ from: min, to: lowEdge, zone: "yellow" });
  segs.push({ from: lowEdge, to: clamp(bands.g), zone: "green" });
  segs.push({ from: clamp(bands.g), to: clamp(bands.y), zone: "yellow" });
  segs.push({ from: clamp(bands.y), to: clamp(bands.o), zone: "orange" });
  segs.push({ from: clamp(bands.o), to: max, zone: "red" });

  return (
    <View style={styles.wrap}>
      <TouchableOpacity accessibilityLabel={`Decrease ${accessibilityLabel}`} style={styles.step} onPress={() => onChange(snap(value - step))}>
        <Text style={styles.stepText}>−</Text>
      </TouchableOpacity>
      <View style={styles.trackArea} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}
        accessible accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => onChange(snap(value + (e.nativeEvent.actionName === "increment" ? step : -step)))}>
        <View style={styles.track}>
          {segs.filter((s) => s.to > s.from).map((s, i) => (
            <View key={i} style={{ position: "absolute", left: toX(s.from), width: toX(s.to) - toX(s.from), top: 0, bottom: 0, backgroundColor: ZONE_COLOR[s.zone], opacity: 0.85 }} />
          ))}
        </View>
        <View pointerEvents="none" style={[styles.knob, { left: toX(value) - 14, borderColor: ZONE_COLOR[zone], shadowColor: ZONE_COLOR[zone] }]} />
      </View>
      <TouchableOpacity accessibilityLabel={`Increase ${accessibilityLabel}`} style={styles.step} onPress={() => onChange(snap(value + step))}>
        <Text style={styles.stepText}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 10 },
  trackArea: { flex: 1, height: 44, justifyContent: "center" },
  track: { height: 10, borderRadius: 5, overflow: "hidden", backgroundColor: "#333" },
  knob: { position: "absolute", width: 28, height: 28, borderRadius: 14, backgroundColor: "#f4f6f8", borderWidth: 4, shadowOpacity: 0.7, shadowRadius: 6, elevation: 4 },
  step: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#2c3440", alignItems: "center", justifyContent: "center" },
  stepText: { color: "#e8ecef", fontSize: 22, fontWeight: "700" },
});

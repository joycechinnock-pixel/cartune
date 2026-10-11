/**
 * Guided electrical-diagnosis workflow, circuit fault-finder decision trees
 * and safety notes. Data only — the screens render it.
 */

export interface WorkflowStep { id: string; title: string; detail: string; tool?: string; }

export const WORKFLOW_STEPS: WorkflowStep[] = [
  { id: "verify", title: "Verify the complaint", detail: "Reproduce the fault yourself. Note exactly when it happens (cold/hot, key on/running, bumps, rain), what works and what doesn't. Record the customer's words." },
  { id: "tsb", title: "Check TSBs and known issues", detail: "Search technical service bulletins, recalls and known pattern failures for this model/engine before testing — it can save hours." },
  { id: "basics", title: "Check the basics", detail: "Battery state of charge and terminals, main grounds (battery–body, battery–engine, engine–body), fusible links and fuses (test fuses across both test points, don't just look).", tool: "battery" },
  { id: "scan", title: "Scan all modules", detail: "Read stored, pending and permanent codes plus freeze frame from every module you can reach. Note U-codes (communication) — they point at network/power/ground problems.", tool: "scan" },
  { id: "diagram", title: "Study the wiring diagram", detail: "Split the circuit into POWER (fuse/relay/switch feed) → CONTROL (switch, module driver) → LOAD (motor, lamp, solenoid, sensor) → GROUND. Identify connectors, splices and ground points and where you can access them." },
  { id: "isolate", title: "Isolate the fault", detail: "Test under load: voltage-drop the power and ground sides, check control signals, wiggle-test harnesses. Work from the easiest access point and halve the circuit until the fault is located.", tool: "vdrop" },
  { id: "repair", title: "Repair", detail: "Fix the root cause (corroded terminal, chafed wire, failed component). Use proper crimp/solder + heat-shrink repairs and the correct terminals; don't leave piercing-probe holes unsealed." },
  { id: "verify_fix", title: "Verify the repair", detail: "Re-test the original complaint under the same conditions, clear codes only after recording them, run the drive cycle and confirm no codes return (permanent codes clear themselves when the monitor passes).", tool: "scan" },
];

export interface TreeNode {
  id: string;
  text: string;
  /** Question nodes have yes/no; leaf nodes have a finding and no branches. */
  yes?: string;
  no?: string;
  finding?: boolean;
}

export interface FaultTree { id: string; title: string; summary: string; start: string; nodes: Record<string, TreeNode>; }

export const FAULT_TREES: FaultTree[] = [
  {
    id: "open", title: "Open circuit", summary: "Load doesn't work at all; no current flows.", start: "o1",
    nodes: {
      o1: { id: "o1", text: "With the circuit switched ON, is battery voltage present at the load's power terminal (back-probed, connector plugged in)?", yes: "o2", no: "o4" },
      o2: { id: "o2", text: "Is there a good ground at the load? (Voltage drop from load ground terminal to battery negative under load < ~0.2 V)", yes: "o3", no: "o6" },
      o3: { id: "o3", text: "Power and ground are good at the load → the load itself is open (burnt lamp filament, open motor/coil winding). Verify with an ohmmeter on the disconnected load, then replace.", finding: true },
      o4: { id: "o4", text: "Is voltage present at the fuse (both test points)?", yes: "o5", no: "o7" },
      o5: { id: "o5", text: "Open between the fuse and the load: follow the diagram and check voltage at each connector/switch/relay along the feed; the open lies between the last point with voltage and the first without.", finding: true },
      o6: { id: "o6", text: "Open or high-resistance ground: check the ground wire, splice and ground point (clean, tight, no paint/corrosion). Repair and re-test the voltage drop.", finding: true },
      o7: { id: "o7", text: "No voltage at the fuse: blown fuse/fusible link upstream, failed relay or ignition feed. If a fuse is blown, find out WHY (see Short to ground) before replacing it.", finding: true },
    },
  },
  {
    id: "short_ground", title: "Short to ground", summary: "Fuse blows (often immediately) or circuit is dead.", start: "g1",
    nodes: {
      g1: { id: "g1", text: "Does the fuse blow immediately when the circuit is switched on (before the load is commanded)?", yes: "g2", no: "g5" },
      g2: { id: "g2", text: "Replace the fuse with a test lamp or a short-finder/circuit breaker across the fuse terminals. Does the lamp stay lit with the load disconnected?", yes: "g3", no: "g4" },
      g3: { id: "g3", text: "Short is in the wiring between fuse and load. Unplug connectors along the circuit one at a time, starting mid-way: when the lamp goes out, the short is downstream of that connector. Look for chafed insulation at brackets, door hinges, seat tracks.", finding: true },
      g4: { id: "g4", text: "Short is in the load (or its internal wiring): with the load reconnected the lamp lights. Verify load resistance vs. spec and replace.", finding: true },
      g5: { id: "g5", text: "Does it blow only when the load is operating or the vehicle moves/bumps?", yes: "g6", no: "g7" },
      g6: { id: "g6", text: "Intermittent short or overloaded circuit: measure current draw of the load (stalled motor, seized mechanism) and wiggle-test the harness with the test lamp in place of the fuse.", finding: true },
      g7: { id: "g7", text: "Check for a wrong fuse rating, aftermarket accessories tapped into the circuit, or water intrusion in connectors/modules.", finding: true },
    },
  },
  {
    id: "short_power", title: "Short to power", summary: "Load runs when it should be off, or stays on; unexpected voltage on a circuit.", start: "p1",
    nodes: {
      p1: { id: "p1", text: "Does the load operate with the switch/module command OFF?", yes: "p2", no: "p5" },
      p2: { id: "p2", text: "Unplug the controlling switch/relay/module. Does the load still operate?", yes: "p3", no: "p4" },
      p3: { id: "p3", text: "The control wire is shorted to another powered circuit (wire-to-wire short in the harness). Check where it runs alongside powered wires; unplug connectors to locate.", finding: true },
      p4: { id: "p4", text: "The switch, relay (contacts welded) or module driver is stuck on — replace the component (check why it failed).", finding: true },
      p5: { id: "p5", text: "Measure voltage on the circuit with everything off. Voltage present that shouldn't be → back-feed through a shared ground or another circuit (e.g. bad ground making current flow through bulbs). Voltage-drop the grounds.", finding: true },
    },
  },
  {
    id: "high_resistance", title: "High resistance", summary: "Load works but weakly: dim lamps, slow motors, slow cranking, wrong sensor readings.", start: "h1",
    nodes: {
      h1: { id: "h1", text: "With the circuit loaded, is the voltage drop on the POWER side (battery + to load +) above the guideline?", yes: "h2", no: "h3" },
      h2: { id: "h2", text: "Move the negative probe from the load towards the battery connector by connector; the resistance is where the drop suddenly disappears. Clean/replace the terminal, switch or wire section.", finding: true },
      h3: { id: "h3", text: "Is the voltage drop on the GROUND side (load − to battery −) above ~0.2 V?", yes: "h4", no: "h5" },
      h4: { id: "h4", text: "High-resistance ground: clean the ground point and eyelet, check the ground strap/splice; re-test.", finding: true },
      h5: { id: "h5", text: "Both sides are good but the load is weak → the load itself is worn (e.g. starter drawing high current, dim lamp from blackened bulb). Test the component.", finding: true },
    },
  },
  {
    id: "intermittent", title: "Intermittent", summary: "Comes and goes: heat, cold, moisture, vibration.", start: "i1",
    nodes: {
      i1: { id: "i1", text: "Can you make it happen by wiggling the harness/connectors (wiggle test) while monitoring voltage, a test lamp or live data?", yes: "i2", no: "i3" },
      i2: { id: "i2", text: "Found it at the spot that reacts: inspect for spread female terminals (pin-drag test), corrosion, broken strands under insulation, poor splices.", finding: true },
      i3: { id: "i3", text: "Does it happen hot? Warm suspect components/connectors with a heat gun (carefully) while monitoring.", yes: "i4", no: "i5" },
      i4: { id: "i4", text: "Heat-related: a component or solder joint opening when hot (sensor, module, relay). Replace the part that reacts.", finding: true },
      i5: { id: "i5", text: "Does it happen cold or wet? Use freeze spray or a water mist on suspect areas while monitoring.", yes: "i6", no: "i7" },
      i6: { id: "i6", text: "Cold/moisture-related: cracked solder joint, water ingress in a connector or module. Dry, seal or replace.", finding: true },
      i7: { id: "i7", text: "Record freeze-frame data and log live data during a road test until it happens; look for a signal dropping out at the moment of the fault. Check module power/ground voltage drop during the event.", finding: true },
    },
  },
];

export const SAFETY_NOTES: { title: string; body: string; level: "danger" | "warning" | "info" }[] = [
  { level: "danger", title: "Airbag / SRS circuits", body: "Never probe airbag (SRS) circuits with a test light or ohmmeter — the meter's current can deploy an airbag. Yellow connectors/harnesses are SRS. Disconnect the battery and wait the maker's specified time (often several minutes) before working near SRS parts, and use only the manufacturer's procedure and tools." },
  { level: "danger", title: "Hybrid / EV high voltage", body: "Orange cables and components carry lethal high voltage (hundreds of volts DC). Do not touch, probe or disconnect them without high-voltage training, rated PPE (insulated gloves) and the manufacturer's disable procedure. The 12 V tests in this app are for the low-voltage system only." },
  { level: "warning", title: "Test lights on computer circuits", body: "An incandescent test light draws enough current to damage ECU driver and sensor circuits. Use a high-impedance digital meter (or an LED/logic probe) on module and sensor circuits." },
  { level: "warning", title: "Batteries", body: "Batteries can release explosive hydrogen gas. No sparks or flames near the battery; connect the last jump/charger clamp away from the battery; wear eye protection." },
  { level: "info", title: "Don't back-probe with force", body: "Use proper back-probe pins or break-out leads. Spreading terminals or piercing insulation creates new faults (intermittents, corrosion)." },
  { level: "info", title: "Clearing codes", body: "Clearing codes erases freeze frame data and resets readiness monitors (a vehicle may then fail an emissions inspection until drive cycles complete). Always record codes and freeze frame first." },
];

/** OBD-II J1962 DLC pinout (the standard pins used by these tools). */
export const DLC_PINS: { pin: number; use: string }[] = [
  { pin: 4, use: "Chassis ground" }, { pin: 5, use: "Signal ground" }, { pin: 6, use: "CAN-H (ISO 15765-4)" },
  { pin: 7, use: "K-line (ISO 9141-2 / ISO 14230-4)" }, { pin: 14, use: "CAN-L (ISO 15765-4)" }, { pin: 15, use: "L-line (optional)" },
  { pin: 2, use: "J1850 bus +" }, { pin: 10, use: "J1850 bus − (PWM)" }, { pin: 16, use: "Battery positive (unswitched)" },
];

/** Walks a decision tree: returns the node reached after the given answers. */
export function walkTree(tree: FaultTree, answers: ("yes" | "no")[]): { node: TreeNode; path: string[] } {
  let node = tree.nodes[tree.start];
  const path = [node.id];
  for (const a of answers) {
    const next = a === "yes" ? node.yes : node.no;
    if (!next) break;
    node = tree.nodes[next];
    path.push(node.id);
  }
  return { node, path };
}

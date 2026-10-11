/* v5 merge checks: the vehicle catalogue shared by prototype/ and the web app
 * picker (prototype/makes.js + web/src/22-catalog.js), and filing invariants
 * (permission always beats performance). Run via run-node-tests.js. */
const fs = require("fs"), path = require("path"), vm = require("vm");
const REPO = process.env.CARTUNE_REPO || path.resolve(__dirname, "..", "..");
const E = require("./ecu/ecuProfiles"), R = require("./tune/rules"), P = require("./tune/presets"), FL = require("./tune/filing");
let n = 0, bad = 0;
function ok(c, m) { n++; if (!c) { bad++; console.log("FAIL:", m); } }

const S = { pkg: "standard" };
const sb = { E, S, console };
vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(REPO, "prototype", "makes.js"), "utf8") + "\n" +
  fs.readFileSync(path.join(REPO, "web", "src", "22-catalog.js"), "utf8") +
  "\nthis.OUT={CAT_ALL,CATALOG,MAKE_ECU,MAKE_MODELS,POPULAR,CATS,catInPackage,profOf,STATUS};", sb);
const C = sb.OUT;

// counts claimed in the CHANGELOG (635 models across 57 car, 15 truck, 12 ag, 15 plant makes)
ok(C.CAT_ALL.length === 635, `635 models (got ${C.CAT_ALL.length})`);
const makes = {}; C.CAT_ALL.forEach((r) => { (makes[r.cat] = makes[r.cat] || new Set()).add(r.make); });
ok(makes.car.size === 57 && makes.truck.size === 15 && makes.ag.size === 12 && makes.plant.size === 15,
  `makes per type 57/15/12/15 (got ${Object.keys(makes).map((k) => k + ":" + makes[k].size).join(" ")})`);
ok(new Set(C.CAT_ALL.map((r) => r.cat + "|" + r.make + "|" + r.model)).size === C.CAT_ALL.length, "no duplicate models");
ok(Object.keys(C.MAKE_MODELS).every((cat) => Object.keys(C.MAKE_MODELS[cat]).every((mk) => C.MAKE_MODELS[cat][mk].every((mm) =>
  C.CAT_ALL.some((r) => r.cat === cat && r.make === mk && r.model === mm.split("|")[0])))), "every make/model from makes.js is pickable");
// every ECU id the catalogue can hand out exists (or is "detect" = confirmed when plugged in)
const ids = new Set(E.ECU_PROFILES.map((p) => p.id));
const used = new Set(); C.CAT_ALL.forEach((r) => r.gens.forEach((g) => g.e.forEach((e) => { if (e.ecu) used.add(e.ecu); })));
const unknown = [...used].filter((id) => id !== "detect" && !ids.has(id));
ok(unknown.length === 0, "catalogue ECU ids exist in ECU_PROFILES: " + unknown.join(","));
ok(Object.values(C.MAKE_ECU).every((id) => ids.has(id)), "MAKE_ECU ids exist in ECU_PROFILES");
const evs = C.CAT_ALL.filter((r) => r.gens.every((g) => g.e.every((e) => e.eng === null)));
ok(evs.length > 0 && evs.every((r) => r.gens[0].e[0].ecu === null), `electric models (${evs.length}) have no ECU (live data only)`);
ok(C.CAT_ALL.every((r) => r.gens.every((g) => g.e.every((e) => e.eng === null || ["na_petrol", "turbo_petrol", "turbo_diesel"].includes(e.eng)))), "engine types are ones the tune rules know");
ok(C.CATALOG.every((r) => C.CAT_ALL.find((x) => x.make === r.make && x.model === r.model).gens.some((g) => g.other)), "detailed models get an 'Other years' generation");
ok(C.profOf("nope").status === "detect" && C.profOf("gm-e38-e67").id === "gm-e38-e67", "profOf falls back to 'confirmed when plugged in'");
// packages decide which vehicle types the picker offers
const allowed = (pkg) => { S.pkg = pkg; return C.CATS.filter((c) => C.catInPackage(c.id)).map((c) => c.id).join(","); };
ok(allowed("standard") === "car", "Standard package: cars only");
ok(allowed("commercial") === "car,truck", "Commercial package: + trucks");
ok(allowed("heavy") === "car,truck,ag,plant", "Heavy package: + ag and earthmoving");
ok(E.profilesForPackage("standard").every((p) => E.categoryOf(p) === "passenger"), "Standard ECU list is passenger only");

// filing: permission first, then performance
for (const eng of ["na_petrol", "turbo_petrol", "turbo_diesel"]) {
  const stock = R.stockValues(eng);
  const f0 = FL.fileTune(eng, stock);
  ok(f0.presetId === "factory" && f0.level === 0, `${eng}: stock files under Factory`);
  for (const t of R.togglesFor(eng, "expert")) {
    const v = { ...stock, [t.id]: t.stock ? 0 : 1 };
    const f = FL.fileTune(eng, v), r = FL.RESTRICTIONS.find((x) => x.id === t.id);
    if (r) {
      ok(f.level >= r.level && FL.presetLevel(P.PRESETS.find((p) => p.id === f.presetId), eng) >= r.level,
        `${eng}: ${t.id} changed → filed at level ≥ ${r.level} (got ${f.presetId}/${f.level})`);
      ok(f.presetId !== "factory", `${eng}: ${t.id} changed is never filed under Factory`);
    }
    if (t.agreement) ok(f.level === 3 && f.reasons.some((x) => x.label === "Emissions system changed"), `${eng}: ${t.id} is an emissions change at Competition level`);
  }
}
ok(FL.orderedPresets().map((p) => p.id).join() === FL.PRESET_ORDER.join() && FL.PRESET_ORDER.length === P.PRESETS.length, "every preset is in PRESET_ORDER");

console.log(`${n - bad}/${n} checks passed`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
/**
 * Builds the CarTune web app (no bundler, no npm install beyond TypeScript).
 *
 *   node web/build.js            (TypeScript found via mobile/scripts/lib-ts.js)
 *
 * 1. Transpiles the shared logic in mobile/src (tune rules, presets, tables,
 *    ECU profiles, filing, ELM327 parser, emulator, OBD session, diag/*, tune spec)
 *    to CommonJS and wraps each file in a tiny module registry (requireMod).
 * 2. Inlines the CarTune Street Kit skin (web/assets/street-kit: token layer of
 *    tokens.css, woff2 fonts, WebP art) and web/src/*.js into web/app.template.html.
 *    Header photo slot: drop web/assets/street-kit/art/hero-photo.(webp|jpg|png)
 *    in and it replaces the inner-page header image (the Home hero is the owner's CARTUNE banner art).
 * 3. Writes:
 *      web/dist/index.html (+ manifest.webmanifest, sw.js, icon.svg)  — PWA, serve over http(s)/localhost
 *      CarTune-App.html (repo root)                                   — single self-contained file
 *    and, if --copy-to <dir> is given, a copy of CarTune-App.html there.
 */
const fs = require("fs");
const path = require("path");
const { loadTs, transpile, MOBILE, REPO } = require("../mobile/scripts/lib-ts");

const WEB = __dirname;
const SRC = path.join(MOBILE, "src");
const ENTRIES = [
  "tune/rules", "tune/presets", "tune/filing", "tune/barraData", "tune/tables", "ecu/ecuProfiles",
  "ble/elm327", "ble/elmEmulator", "ble/obdSession", "vehicle/detect",
  "diag/electrical", "diag/fuses", "diag/workflow", "diag/dtcInfo", "diag/report",
  "data/profiles", "data/tuneSpec",
];

function fileFor(id) {
  for (const ext of [".ts", ".tsx", "/index.ts"]) { const f = path.join(SRC, id + ext); if (fs.existsSync(f)) return f; }
  throw new Error("Module not found: " + id);
}

function makeBundle(ts, entries) {
  const mods = new Map();
  const queue = entries.slice();
  while (queue.length) {
    const id = queue.shift();
    if (mods.has(id)) continue;
    const code = transpile(ts, fileFor(id));
    mods.set(id, code);
    for (const m of code.matchAll(/require\("([^"]+)"\)/g)) {
      const spec = m[1];
      if (!spec.startsWith(".")) throw new Error(`${id} requires "${spec}" — only relative imports of pure-logic modules can go into the web bundle`);
      queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(id), spec)));
    }
  }
  let bundle = "/* ---- shared logic transpiled from mobile/src (do not edit here; edit the .ts and run node web/build.js) ---- */\n" +
    "var __mods={},__cache={};\n" +
    "function __resolve(from,spec){var parts=(from?from.split('/').slice(0,-1):[]).concat(spec.split('/')),out=[];parts.forEach(function(p){if(p==='..')out.pop();else if(p!=='.'&&p!=='')out.push(p)});return out.join('/')}\n" +
    "function __req(id){if(__cache[id])return __cache[id].exports;if(!__mods[id])throw new Error('module '+id+' not bundled');var m={exports:{}};__cache[id]=m;__mods[id](function(s){return __req(__resolve(id,s))},m,m.exports);return m.exports}\n" +
    "function requireMod(spec){return __req(__resolve('',spec))}\n";
  for (const [id, code] of mods) bundle += `__mods[${JSON.stringify(id)}]=function(require,module,exports){\n${code}\n};\n`;
  return { bundle, count: mods.size };
}
/* web/shared: the admin core + API layer (UMD; also used by server/ and the node tests) */
function shared() { return ["cartune-core.js", "api.js"].map((f) => `/* ==== web/shared/${f} ==== */\n` + fs.readFileSync(path.join(WEB, "shared", f), "utf8")).join("\n"); }

function build() {
  const ts = loadTs();
  const { bundle, count } = makeBundle(ts, ENTRIES);
  const mods = { size: count };

  // The full make/model list is shared with the prototype (prototype/makes.js: MAKE_MODELS, POPULAR); one copy, inlined first.
  const makes = path.join(REPO, "prototype", "makes.js");
  if (!fs.existsSync(makes)) throw new Error("prototype/makes.js not found — the vehicle picker needs the make/model list");
  const app = `/* ==== prototype/makes.js ==== */\n` + fs.readFileSync(makes, "utf8") + "\n" + shared() + "\n" +
    fs.readdirSync(path.join(WEB, "src")).filter((f) => /^\d\d-.*\.js$/.test(f)).sort()
    .map((f) => `/* ==== web/src/${f} ==== */\n` + fs.readFileSync(path.join(WEB, "src", f), "utf8")).join("\n");
  const skin = streetKit();
  const tpl = fs.readFileSync(path.join(WEB, "app.template.html"), "utf8");
  for (const ph of ["/*SKIN*/", "/*BUNDLE*/", "/*APP*/"]) if (!tpl.includes(ph)) throw new Error("template missing " + ph);
  const stamp = new Date().toISOString();
  const html = tpl.replace("/*SKIN*/", () => skin).replace("/*BUNDLE*/", () => bundle).replace("/*APP*/", () => `var CARTUNE_BUILD=${JSON.stringify(stamp)};\n` + app);
  if (/<\/script/i.test(bundle + app)) throw new Error("a source file contains </script — would break the inline bundle");

  const dist = path.join(WEB, "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "index.html"), html);
  fs.writeFileSync(path.join(dist, "icon.svg"), ICON);
  fs.writeFileSync(path.join(dist, "manifest.webmanifest"), JSON.stringify({
    name: "CarTune", short_name: "CarTune", description: "OBD-II diagnostics, electrical tests and tune planning",
    start_url: "./index.html", scope: "./", display: "standalone", background_color: "#111111", theme_color: "#111111",
    icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
  }, null, 2));
  fs.writeFileSync(path.join(dist, "sw.js"),
    `/* CarTune offline cache — network first, cache fallback. Build ${stamp} */\n` +
    `const C="cartune-${stamp}";const FILES=["./","./index.html","./manifest.webmanifest","./icon.svg"];\n` +
    `self.addEventListener("install",e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});\n` +
    `self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});\n` +
    `self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))});\n`);
  // Single-file build: no manifest/service worker (window.CARTUNE_SW=false keeps it self-contained).
  const single = html.replace("<script>", "<script>window.CARTUNE_SW=false;\n");
  fs.writeFileSync(path.join(REPO, "CarTune-App.html"), single);
  const i = process.argv.indexOf("--copy-to");
  if (i > 0 && process.argv[i + 1]) fs.writeFileSync(path.join(process.argv[i + 1], "CarTune-App.html"), single);
  buildAdmin(ts, stamp);
  console.log(`Built ${mods.size} modules + ${app.split("/* ==== web/src/").length - 1} app files → web/dist/index.html (${(html.length / 1024).toFixed(0)} KB), CarTune-App.html`);
}

/* ---- CarTune Street Kit skin: tokens + fonts + art, all inlined (self-contained single file) ---- */
/* ---- admin app: web/admin/admin.template.html + admin.js → CarTune-Admin.html and web/dist/admin/index.html ---- */
function buildAdmin(ts, stamp) {
  const ADM = path.join(WEB, "admin");
  const { bundle } = makeBundle(ts, ["tune/rules", "tune/presets", "tune/filing", "ecu/ecuProfiles"]);
  const tpl = fs.readFileSync(path.join(ADM, "admin.template.html"), "utf8");
  for (const ph of ["/*SKIN*/", "/*BUNDLE*/", "/*APP*/"]) if (!tpl.includes(ph)) throw new Error("admin template missing " + ph);
  const app = `var CARTUNE_BUILD=${JSON.stringify(stamp)};\n/* ==== prototype/makes.js ==== */\n` + fs.readFileSync(path.join(REPO, "prototype", "makes.js"), "utf8") + "\n" + shared() + "\n" +
    fs.readdirSync(ADM).filter((f) => /^\d\d-.*\.js$/.test(f)).sort().map((f) => `/* ==== web/admin/${f} ==== */\n` + fs.readFileSync(path.join(ADM, f), "utf8")).join("\n");
  if (/<\/script/i.test(bundle + app)) throw new Error("an admin source file contains </script");
  // admin only needs the wall, the paint corners, the tags and the two desktop banners (keeps the file small)
  const html = tpl.replace("/*SKIN*/", () => streetKit(["art-mural", "art-peel", "art-tags", "art-rule", "ph-hero-night", "ph-hero-sun", "ph-st-kooka"])).replace("/*BUNDLE*/", () => bundle).replace("/*APP*/", () => app);
  fs.mkdirSync(path.join(WEB, "dist", "admin"), { recursive: true });
  fs.writeFileSync(path.join(WEB, "dist", "admin", "index.html"), html);
  fs.writeFileSync(path.join(REPO, "CarTune-Admin.html"), html);
  const i = process.argv.indexOf("--copy-to");
  if (i > 0 && process.argv[i + 1]) fs.writeFileSync(path.join(process.argv[i + 1], "CarTune-Admin.html"), html);
  console.log(`Built admin → web/dist/admin/index.html (${(html.length / 1024).toFixed(0)} KB), CarTune-Admin.html`);
}

function streetKit(only) {
  const KIT = path.join(WEB, "assets", "street-kit");
  const b64 = (f, mime) => `data:${mime};base64,` + fs.readFileSync(f).toString("base64");
  // 1. Token layer of tokens.css (raw palette + semantic Night/Sun tokens). The component CSS in tokens.css
  //    isn't included: its class names collide with the app's own, so app.template.html restyles the app's classes with the tokens.
  const tokensCss = fs.readFileSync(path.join(KIT, "tokens.css"), "utf8");
  const cut = tokensCss.indexOf("/* Image tokens");
  if (cut < 0) throw new Error("street-kit/tokens.css: token layer marker not found");
  const tokens = tokensCss.slice(0, cut);
  // "Auto" theme follows the OS: re-use the Sun block under prefers-color-scheme: light unless Night is forced.
  const sun = tokens.match(/\[data-theme="sun"\]\s*\{([\s\S]*?)\n\}/);
  if (!sun) throw new Error("street-kit/tokens.css: Sun block not found");
  const auto = `@media (prefers-color-scheme: light) { :root:not([data-theme="night"]) {${sun[1]}\n} }\n`;
  // 2. Fonts (woff2, latin subsets; OFL 1.1 / Apache 2.0 licences sit next to them)
  const fonts = JSON.parse(fs.readFileSync(path.join(KIT, "fonts", "fonts.json"), "utf8")).map(([name, style, weight, file, range]) =>
    `@font-face{font-family:'${name}';font-style:${style};font-weight:${weight};font-display:swap;src:url(${b64(path.join(KIT, "fonts", file), "font/woff2")}) format('woff2');unicode-range:${range};}`).join("\n");
  // 3. Imagery as CSS custom properties (one copy each, reused by selectors). CSS backgrounds only decode when
  //    their element renders, so each tab's banner is effectively lazy even though it's inlined.
  const ART = path.join(KIT, "art"), PH = path.join(KIT, "photos");
  const mime = (f) => ({ webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" })[f.split(".").pop()];
  const art = {};
  //  a) Owner's photos (street-art treated by style-guide/src/photos/make_photos.py): every image in photos/
  //     becomes --ph-<name> (app-header, app-header-m, bn-*, st-*).
  const ph = {};
  if (fs.existsSync(PH)) for (const f of fs.readdirSync(PH).sort()) if (mime(f)) ph[f.replace(/\.[^.]+$/, "")] = path.join(PH, f);
  //  b) Drawn fallback (illustrated kit) for any slot with no photo, so the build still works without photos/.
  const drawn = { "app-header": "hero.webp", "bn-connect": "hero.webp", "st-swan": "sticker-servo.webp",
    "st-cocky": "sticker-roadtrain.webp", "st-kooka": "sticker-burnout.webp" };
  for (const [k, f] of Object.entries(drawn)) if (!ph[k]) ph[k] = path.join(ART, f);
  //  c) v8 artwork (style-guide/src/mural/build_v8.py): the owner's own artworks, cropped/scaled/compressed only.
  //     mural/<slot>.webp overrides the same --ph-<slot>: hero-night / hero-sun / hero-fire (+ -m phone crops) = the
  //     three CARTUNE banners (A); app-header = the Aussie line-up mural (B, inner headers + page foot); bn-* = slices
  //     of B for section pieces; st-* = B's cockatoo / black swan / kookaburra for empty states.
  //     mural/tex-<name>.webp becomes --art-<name> (page wall, B splash corner "peel", tag scribbles, spray rule).
  const MU = path.join(KIT, "mural");
  if (fs.existsSync(MU)) for (const f of fs.readdirSync(MU).sort()) if (mime(f)) {
    const n = f.replace(/\.[^.]+$/, "");
    if (n.startsWith("tex-")) art[n.slice(4)] = path.join(MU, f); else ph[n] = path.join(MU, f);
  }
  //  d) Drop-in override: art/hero-photo.(webp|jpg|jpeg|png) replaces the header image on every screen size.
  const hp = ["webp", "jpg", "jpeg", "png"].map((e) => path.join(ART, "hero-photo." + e)).find((f) => fs.existsSync(f));
  if (hp) ph["app-header"] = hp;
  if (!fs.existsSync(path.join(KIT, "mural", "tex-mural.webp"))) art.brick = path.join(ART, "tex-brick.webp");
  // Banner slots with no image fall back to none via var(--ph-bn-x, none) in the template.
  const v = (pre, [k, f]) => `--${pre}-${k}:url(${b64(f, mime(f))});`;
  const keep = (pre) => (e) => !only || only.includes(pre + "-" + e[0]);
  const vars = ":root{" + Object.entries(art).filter(keep("art")).map((e) => v("art", e)).join("") + Object.entries(ph).filter(keep("ph")).map((e) => v("ph", e)).join("") + "}";
  return `/* CarTune Street Kit (West Side Underground) — token layer of web/assets/street-kit/tokens.css */\n${tokens}\n${auto}\n${fonts}\n${vars}\n`;
}

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#111111"/><circle cx="256" cy="256" r="176" fill="#0A0A0A" stroke="#049ADB" stroke-width="30"/><path d="M150 330a110 110 0 0 1 212 0" fill="none" stroke="#6B6F6A" stroke-width="30" stroke-linecap="square"/><path d="M150 330a110 110 0 0 1 150-104" fill="none" stroke="#48F45C" stroke-width="30" stroke-linecap="square"/><path d="M256 330l66-82" stroke="#EDEDEC" stroke-width="20" stroke-linecap="square"/><circle cx="256" cy="330" r="22" fill="#EDEDEC"/><path d="M340 96l70-40" stroke="#F46E36" stroke-width="34" stroke-linecap="round"/></svg>`;

build();

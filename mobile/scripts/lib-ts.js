/**
 * Tiny helper shared by run-node-tests.js and ../../web/build.js: transpiles
 * the TypeScript sources in mobile/src to CommonJS with the TypeScript
 * compiler API (no type-check, no bundler, no React Native needed).
 *
 * TypeScript is the only dependency. It is found via, in order:
 *   $CARTUNE_TS (path to the typescript package), mobile/node_modules,
 *   <repo>/node_modules, then NODE_PATH / global resolution.
 * Install with `npm install` in mobile/, or `npm i -g typescript`.
 */
const fs = require("fs");
const path = require("path");

const MOBILE = path.resolve(__dirname, "..");
const REPO = path.resolve(MOBILE, "..");

function loadTs() {
  const tries = [process.env.CARTUNE_TS, path.join(MOBILE, "node_modules", "typescript"), path.join(REPO, "node_modules", "typescript"), "typescript"].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (e) { /* next */ }
  }
  console.error("TypeScript not found. Run `npm install` in mobile/ (or `npm i -g typescript`, or set CARTUNE_TS=/path/to/node_modules/typescript).");
  process.exit(2);
}

/** Transpiles one .ts file to CommonJS source text. */
function transpile(ts, file) {
  const src = fs.readFileSync(file, "utf8");
  const out = ts.transpileModule(src, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, jsx: ts.JsxEmit.React, esModuleInterop: true },
  });
  return out.outputText;
}

/** Transpiles every .ts/.tsx file under mobile/src into outDir (mirroring folders). */
function transpileTree(outDir) {
  const ts = loadTs();
  const srcRoot = path.join(MOBILE, "src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  for (const f of walk(srcRoot)) {
    if (!/\.tsx?$/.test(f)) continue;
    const rel = path.relative(srcRoot, f).replace(/\.tsx?$/, ".js");
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, transpile(ts, f));
  }
  return outDir;
}

module.exports = { loadTs, transpile, transpileTree, MOBILE, REPO };

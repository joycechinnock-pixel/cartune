#!/usr/bin/env node
/**
 * Runs every mobile/scripts/test-*.js with plain Node against a fresh
 * CommonJS transpile of mobile/src (see lib-ts.js). Usage:
 *   node mobile/scripts/run-node-tests.js
 * Exit code is non-zero if any test file fails. Prints a pass count.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { transpileTree } = require("./lib-ts");

const out = fs.mkdtempSync(path.join(os.tmpdir(), "cartune-mobile-js-"));
transpileTree(out);
// test-tune-rules.js is written against a flat tune/ folder (require("./rules"), "./filing", "./presets").
// Give it flat aliases next to the test files so it runs unchanged.
for (const f of fs.readdirSync(path.join(out, "tune"))) {
  if (f.endsWith(".js") && !fs.existsSync(path.join(out, f))) fs.writeFileSync(path.join(out, f), `module.exports = require("./tune/${f.slice(0, -3)}");\n`);
}
const tests = fs.readdirSync(__dirname).filter((f) => /^test-.*\.js$/.test(f)).sort();
let failed = 0;
let assertions = 0;
for (const t of tests) {
  fs.copyFileSync(path.join(__dirname, t), path.join(out, t));
  try {
    const stdout = execFileSync(process.execPath, [path.join(out, t)], {
      cwd: out,
      env: { ...process.env, RULES_JS: path.join(out, "tune", "rules"), CARTUNE_REPO: path.resolve(__dirname, "..", "..") },
      encoding: "utf8",
    });
    const m = /(\d+) checks passed/.exec(stdout);
    if (m) assertions += +m[1];
    console.log(`PASS ${t}${m ? ` (${m[1]} checks)` : ""}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${t}\n${e.stdout || ""}${e.stderr || e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} test files passed${assertions ? `, ${assertions} counted checks` : ""}.`);
fs.rmSync(out, { recursive: true, force: true });
process.exit(failed ? 1 : 0);

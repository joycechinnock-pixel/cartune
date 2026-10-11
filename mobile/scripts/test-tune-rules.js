const a=require("assert"); const R=require(process.env.RULES_JS || "./rules");
const up={intercooler:false,fuelSystem:false,internals:false,cooling:false,driveline:false};
let ctx={engine:"turbo_petrol",fuel:"95",upgrades:{...up},skill:"standard"};
let v=R.stockValues(ctx.engine);
let e=R.evaluate(ctx,v);
console.log("stock turbo:",e.overall,e.counts); a.strictEqual(e.overall,"green");
// timing adapts to boost
v={...v,timing_wot:2}; a.strictEqual(R.evaluate(ctx,v).results.timing_wot.zone,"yellow");
v={...v,boost_add:4}; const z=R.evaluate(ctx,v).results.timing_wot.zone; console.log("timing +2 with +4psi:",z); a.ok(["orange","red"].includes(z));
// fuel change fixes it
let r=R.applyAction(ctx,v,{kind:"fuel",value:"98"}); console.log("on 98:",R.evaluate(r.ctx,r.values).results.timing_wot.zone);
// upgrades widen boost
a.strictEqual(R.evaluate(ctx,{...v,boost_add:6}).results.boost_add.zone,"orange");
const ctx2={...ctx,upgrades:{...up,intercooler:true,fuelSystem:true}}; a.strictEqual(R.evaluate(ctx2,{...v,boost_add:6}).results.boost_add.zone,"green");
// lean -> red + warnings
e=R.evaluate(ctx,{...v,lambda_wot:0.92}); a.strictEqual(e.results.lambda_wot.zone,"red"); a.ok(e.warnings.length);
// too rich
e=R.evaluate(ctx,{...R.stockValues(ctx.engine),lambda_wot:0.7}); a.ok(e.results.lambda_wot.tooLow);
// advice actions are applicable and move towards green
e=R.evaluate(ctx,{...v,timing_wot:6}); const adv=e.results.timing_wot.advice[0]; r=R.applyAction(ctx,{...v,timing_wot:6},adv.action); a.strictEqual(R.evaluate(r.ctx,r.values).results.timing_wot.zone,"green");
// diesel
ctx={engine:"turbo_diesel",fuel:"diesel",upgrades:{...up},skill:"simple"}; v=R.stockValues(ctx.engine);
a.strictEqual(R.evaluate(ctx,v).overall,"green"); a.ok(!("timing_wot" in v));
e=R.evaluate(ctx,{...v,fuel_add:20}); console.log("diesel +20%:",e.results.fuel_add.zone,e.warnings.map(w=>w.title));
a.ok(e.warnings.some(w=>w.title==="More fuel than air"));
// every setting every zone text non-empty; every value on grid evaluates
for (const eng of ["na_petrol","turbo_petrol","turbo_diesel"]) for (const s of R.settingsFor(eng)) for (let x=s.min;x<=s.max+1e-9;x+=s.step){const c={engine:eng,fuel:eng==="turbo_diesel"?"diesel":"95",upgrades:{...up},skill:"expert"}; const res=R.evaluate(c,{...R.stockValues(eng),[s.id]:+x.toFixed(3)}).results[s.id]; a.ok(res.headline&&res.effect); if(res.zone!=="green") a.ok(res.advice.length);}
// cross-setting fixes: knock sensitivity lists other settings, all applicable and all move away from the problem
{ const c={engine:"na_petrol",fuel:"95",upgrades:{...up},skill:"expert"}; const v={...R.stockValues("na_petrol"),knock_sens:30,timing_wot:2};
  const r=R.evaluate(c,v).results.knock_sens; a.ok(r.otherFixes.length>=4,"knock has other fixes");
  a.ok(r.otherFixes.every(f=>!(f.action.kind==="set"&&f.action.id==="knock_sens")));
  for(const f of r.otherFixes){const x=R.applyAction(c,v,f.action); a.ok(JSON.stringify(x)!==JSON.stringify({ctx:c,values:v}),"fix changes something: "+f.text);} }
// toggles: stock is green everywhere, switching away gives the defined zone + a way back
for (const eng of ["na_petrol","turbo_petrol","turbo_diesel"]) { const c={engine:eng,fuel:eng==="turbo_diesel"?"diesel":"95",upgrades:{...up},skill:"expert"};
  const st=R.stockValues(eng); for (const t of R.togglesFor(eng)) { a.strictEqual(R.evaluate(c,st).results[t.id].zone,"green");
    const ev=R.evaluate(c,{...st,[t.id]:t.stock?0:1}), res=ev.results[t.id]; a.strictEqual(res.zone,t.zone,t.id);
    if(res.zone!=="green"){ a.ok(res.advice.length); const back=R.applyAction(c,{...st,[t.id]:t.stock?0:1},res.advice[0].action); a.strictEqual(R.evaluate(c,back.values).results[t.id].zone,"green"); }
    if(t.agreement){ a.ok(res.needsAgreement); a.ok(ev.warnings.some(w=>w.title==="Emissions hardware changes")); } } }
// new areas exist
for (const g of ["Throttle","Brakes & Traction","Emissions"]) a.ok(R.segmentsFor("turbo_diesel").includes(g),g);
a.ok(R.settingsFor("na_petrol").some(s=>s.id==="line_pressure")&&R.settingsFor("na_petrol").some(s=>s.id==="abs_slip"));
// filing: order starts at Factory; permission overrides performance
{ const F=require("./filing"), P=require("./presets"); a.strictEqual(F.orderedPresets()[0].id,"factory");
  const e="turbo_petrol", f=P.presetValues(P.PRESETS.find(p=>p.id==="factory"),e);
  a.strictEqual(F.fileTune(e,f).presetId,"factory");
  a.strictEqual(F.fileTune(e,{...f,timing_wot:0.5}).presetId,"factory");
  const lifted=F.fileTune(e,{...f,t_esc:0}); a.notStrictEqual(lifted.presetId,"factory"); a.ok(lifted.level===3);
  a.ok(F.presetLevel(P.PRESETS.find(p=>p.id===lifted.presetId),e)>=3);
  const sp=F.fileTune(e,{...f,t_speed_lim:0}); a.ok(F.presetLevel(P.PRESETS.find(p=>p.id===sp.presetId),e)>=2); }
console.log("ENGINE TESTS PASSED");

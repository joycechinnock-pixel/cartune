/* ==========================================================================
 * Diagnostics tab — vehicle electrical diagnosis tools. All verdict logic is
 * mobile/src/diag/*.ts (bundled above; mirrored in electrical_diag.py).
 * Thresholds are general guidelines and editable; the UI says so.
 * ======================================================================== */
function clone(o){return JSON.parse(JSON.stringify(o))}
var DG={sub:store.get("diagSub","workflow"),th:Object.assign(clone(D.DEFAULT_THRESHOLDS),store.get("thresholds",{})),
  inputs:store.get("diagInputs",{}),tree:{id:"open",answers:[]},fuseTable:store.get("fuseTable",null)||clone(FU.DEFAULT_FUSE_RESISTANCE_MOHM),
  scan:null,ff:null,cmp:store.get("cmpRows",{}),sleep:{start:null,timer:null}};
S.live={running:false,keys:store.get("liveKeys",["rpm","coolant_c","module_voltage","speed_kph","throttle_pct","short_fuel_trim_pct","long_fuel_trim_pct"]),rows:[],last:{},min:{},max:{},startedAt:null};
var SUBS=[["workflow","Workflow"],["scan","Scan & codes"],["live","Live dashboard"],["battery","Battery & charging"],["vdrop","Voltage drop"],["draw","Parasitic draw"],["faults","Circuit faults"],["sensors","Sensors"],["can","CAN bus"],["safety","Safety"],["report","Report"]];
var STATUS_ORDER=["pass","info","warn","fail"];
function worst(list){return list.reduce(function(w,s){return STATUS_ORDER.indexOf(s)>STATUS_ORDER.indexOf(w)?s:w},"pass")}
function resHtml(r){return '<div class="res st-'+r.status+'"><b class="st">'+r.status.toUpperCase()+'</b>'+esc(r.message)+'</div>'}
function num(v){return v===""||v==null||isNaN(+v)?undefined:+v}

/* ---- diagnostic session (per vehicle, localStorage) ---- */
function vehicleInfo(){var p=E.ECU_PROFILES.find(function(x){return x.id===S.car.ecu});return {title:S.car.title,vin:S.car.vin||null,ecu:p?p.manufacturer+" "+p.family:S.car.ecu,osId:S.car.osid||null}}
function adapterInfo(){return {mode:S.mode==="none"?"none":S.mode,id:S.obd&&S.obd.adapterId||null,protocol:S.obd&&S.obd.protocol||null}}
function sessKey(){return "diag:"+(S.car.vin||S.car.key)}
function getSession(){var s=store.get(sessKey(),null)||RP.newSession(vehicleInfo(),adapterInfo());s.vehicle=vehicleInfo();s.adapter=adapterInfo();return s}
function saveSession(s){s.updatedAt=new Date().toISOString();store.set(sessKey(),s)}
function addTest(tool,label,inputs,r){var s=getSession();s.tests.push({tool:tool,label:label||tool,inputs:inputs,status:r.status,message:r.message,at:new Date().toISOString()});saveSession(s);toast("Saved to report ("+s.tests.length+" tests)")}

/* ---- generic calculator card ---- */
function calcCard(o){
  var host=document.createElement("section");host.className="panel";host.id="calc-"+o.id;
  var vals=Object.assign({},o.defaults||{},DG.inputs[o.id]||{});
  host.innerHTML='<h3>'+esc(o.title)+'</h3>'+(o.intro?'<p class="why">'+o.intro+'</p>':'')+'<div class="form"></div><div class="out" aria-live="polite"></div>'+
    '<div class="row"><button class="btn save">Save to report</button><span class="extra"></span></div>'+(o.thHtml?'<details class="th"><summary>Guideline thresholds (editable)</summary>'+o.thHtml()+'</details>':'');
  var form=host.querySelector(".form"),inputs={};
  o.fields.forEach(function(f){
    var lab=document.createElement("label");if(f.type==="check")lab.className="ck";
    var id="f-"+o.id+"-"+f.k,el;
    if(f.type==="select"){el=document.createElement("select");(typeof f.options==="function"?f.options(vals):f.options).forEach(function(op){var oe=document.createElement("option");oe.value=op[0];oe.textContent=op[1];el.appendChild(oe)});el.value=vals[f.k]!=null?vals[f.k]:(f.options[0]&&f.options[0][0])}
    else{el=document.createElement("input");el.type=f.type==="check"?"checkbox":f.type==="text"?"text":"number";if(f.type==="number"){el.step="any";el.inputMode="decimal"}
      if(f.type==="check")el.checked=vals[f.k]!==undefined?!!vals[f.k]:!!f.def;else el.value=vals[f.k]!=null?vals[f.k]:"";if(f.ph)el.placeholder=f.ph}
    el.id=id;el.dataset.k=f.k;
    if(f.type==="check"){lab.appendChild(el);lab.appendChild(document.createTextNode(" "+f.label))}else{lab.appendChild(document.createTextNode(f.label+(f.unit?" ("+f.unit+")":"")));lab.appendChild(el)}
    form.appendChild(lab);inputs[f.k]=el;
    if(f.type==="check"&&vals[f.k]===undefined)vals[f.k]=!!f.def;
    el.addEventListener(f.type==="select"||f.type==="check"?"change":"input",function(){vals[f.k]=f.type==="check"?el.checked:f.type==="number"?num(el.value):el.value;DG.inputs[o.id]=vals;store.set("diagInputs",DG.inputs);if(f.onchange)f.onchange(vals,host);update()});
  });
  function update(){var out=host.querySelector(".out");try{var r=o.compute(vals);host._res=r;out.innerHTML=r?resHtml(r):'<div class="res">Enter your readings.</div>'}catch(e){host._res=null;out.innerHTML='<div class="res st-info">'+esc(e.message)+'</div>'}}
  host.querySelector(".save").onclick=function(){if(!host._res){toast("Enter readings first");return}var inp={};o.fields.forEach(function(f){if(f.k!=="label"&&vals[f.k]!==undefined&&vals[f.k]!=="")inp[f.k]=vals[f.k]});addTest(o.tool,o.label?o.label(vals):o.title,inp,host._res)};
  host.setVal=function(k,v){vals[k]=v;var el=inputs[k];if(el){if(el.type==="checkbox")el.checked=!!v;else el.value=v}DG.inputs[o.id]=vals;store.set("diagInputs",DG.inputs);update()};
  host.vals=vals;host.update=update;
  if(o.extra)o.extra(host.querySelector(".extra"),host);
  if(o.thHtml)wireTh(host);
  update();return host;
}
/* threshold editor inputs: data-th="voltageDrop.ground.pass" */
function thInput(path,label,unit){var v=path.split(".").reduce(function(o,k){return o[k]},DG.th);return '<label>'+esc(label)+(unit?" ("+esc(unit)+")":"")+'<input type="number" step="any" data-th="'+path+'" value="'+esc(v)+'"></label>'}
function thForm(inner){return '<div class="form">'+inner+'</div><p class="lbl">'+esc(D.GUIDELINE_NOTE)+' <button class="link" data-threset>Reset all thresholds to defaults</button></p>'}
function wireTh(host){[].forEach.call(host.querySelectorAll("[data-th]"),function(el){el.onchange=function(){var v=parseFloat(el.value);if(isNaN(v)){toast("Enter a number");return}var ks=el.dataset.th.split("."),o=DG.th;for(var i=0;i<ks.length-1;i++)o=o[ks[i]];o[ks[ks.length-1]]=v;store.set("thresholds",DG.th);toast("Threshold saved");renderDiag()}});
  [].forEach.call(host.querySelectorAll("[data-threset]"),function(b){b.onclick=function(){DG.th=clone(D.DEFAULT_THRESHOLDS);store.set("thresholds",{});toast("Defaults restored");renderDiag()}})}

/* ---- tab shell ---- */
function renderDiag(){
  var h=$("diag");
  h.innerHTML='<h2>Diagnostics</h2>'+
    '<div class="banner danger"><b>Safety:</b> never probe airbag (SRS, yellow) circuits with a test light or ohmmeter. Orange cables on hybrids/EVs are high voltage — training and PPE required. <button class="link" data-sub="safety">More</button></div>'+
    connLine()+'<div class="dsub" id="dsub" role="tablist"></div><div id="dbody"></div>'+
    '<p class="lbl">Thresholds shown are general guidelines — always check the manufacturer’s specification. Results are saved per vehicle in this browser.</p>';
  wireConnLinks(h);
  [].forEach.call(h.querySelectorAll("[data-sub]"),function(b){b.onclick=function(){setSub(b.dataset.sub)}});
  var ds=$("dsub");SUBS.forEach(function(s){var c=chip(s[1],DG.sub===s[0],function(){setSub(s[0])});c.setAttribute("role","tab");c.dataset.subid=s[0];ds.appendChild(c)});
  var body=$("dbody");({workflow:subWorkflow,scan:subScan,live:subLive,battery:subBattery,vdrop:subVdrop,draw:subDraw,faults:subFaults,sensors:subSensors,can:subCan,safety:subSafety,report:subReport}[DG.sub]||subWorkflow)(body);
}
function setSub(id){DG.sub=id;store.set("diagSub",id);renderDiag();var c=document.querySelector('[data-subid="'+id+'"]');c&&c.scrollIntoView&&c.scrollIntoView({block:"nearest",inline:"center"})}
function panel(html){var p=document.createElement("section");p.className="panel";p.innerHTML=html;return p}

/* ---- Workflow ---- */
function subWorkflow(body){
  var s=getSession(),done=W.WORKFLOW_STEPS.filter(function(x){return s.checklist[x.id]&&s.checklist[x.id].done}).length;
  var p=panel('<h3>Guided workflow <small class="lbl">'+done+'/'+W.WORKFLOW_STEPS.length+' done · '+esc(S.car.title)+'</small></h3>'+
    '<div class="meter" style="margin:6px 0 10px"><div style="width:'+(done/W.WORKFLOW_STEPS.length*100)+'%;background:var(--green)"></div></div>'+
    '<label class="lbl" for="wfComplaint">Customer complaint (in their words)</label><textarea class="note" id="wfComplaint" placeholder="e.g. Battery flat after sitting 2 days; headlights dim at idle">'+esc(s.complaint||"")+'</textarea>'+
    W.WORKFLOW_STEPS.map(function(st,i){var c=s.checklist[st.id]||{};return '<div class="check-item"><input type="checkbox" data-step="'+st.id+'" id="wf-'+st.id+'"'+(c.done?' checked':'')+'><div><label for="wf-'+st.id+'"><b>'+(i+1)+'. '+esc(st.title)+'</b></label><p class="why" style="margin:2px 0">'+esc(st.detail)+'</p>'+(st.tool?'<button class="link" data-sub="'+st.tool+'">Open tool →</button>':'')+'</div>'+
      '<textarea class="note" data-note="'+st.id+'" placeholder="Notes / findings">'+esc(c.note||"")+'</textarea></div>'}).join("")+
    '<label class="lbl" for="wfNotes" style="display:block;margin-top:10px">General notes</label><textarea class="note" id="wfNotes">'+esc(s.notes||"")+'</textarea>'+
    '<p class="lbl">Saved automatically for this vehicle ('+esc(S.car.vin||S.car.key)+').</p>');
  body.appendChild(p);
  [].forEach.call(p.querySelectorAll("[data-sub]"),function(b){b.onclick=function(){setSub(b.dataset.sub)}});
  var save=function(mut){var ss=getSession();mut(ss);saveSession(ss)};
  [].forEach.call(p.querySelectorAll("[data-step]"),function(cb){cb.onchange=function(){save(function(ss){var c=ss.checklist[cb.dataset.step]||{};c.done=cb.checked;ss.checklist[cb.dataset.step]=c});renderDiag()}});
  [].forEach.call(p.querySelectorAll("[data-note]"),function(t){t.oninput=function(){save(function(ss){var c=ss.checklist[t.dataset.note]||{done:false};c.note=t.value;ss.checklist[t.dataset.note]=c})}});
  $("wfComplaint").oninput=function(){var v=this.value;save(function(ss){ss.complaint=v})};
  $("wfNotes").oninput=function(){var v=this.value;save(function(ss){ss.notes=v})};
}

/* ---- Scan ---- */
function subScan(body){
  var c=connected(),sc=DG.scan,ff=DG.ff;
  var rows=sc?[["stored","Stored (Mode 03)"],["pending","Pending (Mode 07)"],["permanent","Permanent (Mode 0A)"]].map(function(k){return sc[k[0]].map(function(code){var d=DI.describeDtc(code);return '<tr><td><b>'+esc(code)+'</b></td><td>'+esc(k[1])+'</td><td>'+esc(d.description)+(d.generic?'':' <span class="tag">maker-specific</span>')+'</td></tr>'}).join("")}).join(""):"";
  var p=panel('<h3>Trouble codes</h3><p class="why">Reads stored, pending and permanent codes from every ECU that answers the OBD-II request, with SAE J2012 descriptions for common generic codes.</p>'+
    '<div class="row"><button class="btn pri" id="scRead"'+(c?'':' disabled')+'>Read all codes</button><button class="btn" id="scFf"'+(c?'':' disabled')+'>Read freeze frame</button><button class="btn danger" id="scClr"'+(c?'':' disabled')+'>Clear codes…</button></div>'+
    '<div id="scOut">'+(sc?(rows?'<table class="data" style="margin-top:10px"><tr><th>Code</th><th>Type</th><th>Description</th></tr>'+rows+'</table>':'<div class="res st-pass"><b class="st">NONE</b>No stored, pending or permanent codes.</div>')+
      (Object.keys(sc.errors||{}).length?'<p class="lbl">Adapter replies: '+esc(JSON.stringify(sc.errors))+'</p>':'')+'<p class="lbl">Read '+esc(new Date(sc.at).toLocaleTimeString())+'</p>':'<p class="lbl">'+(c?'Not read yet.':'Connect an adapter (or the demo car) to read codes.')+'</p>')+'</div>'+
    (ff?'<h3 style="margin-top:14px">Freeze frame</h3>'+(ff.dtc?'<p class="why">Stored by <b>'+esc(ff.dtc)+'</b> — '+esc(DI.describeDtc(ff.dtc).description)+'</p><table class="data">'+Object.keys(ff.values).map(function(k){return '<tr><td>'+esc(O.LIVE_PIDS[k].label)+'</td><td>'+(+ff.values[k]).toFixed(k==="module_voltage"?2:1)+'</td></tr>'}).join("")+'</table>':'<p class="why">No freeze frame stored (Mode 02 frame 00 not reported).</p>'):''));
  body.appendChild(p);
  if(!c)return;
  $("scRead").onclick=async function(){this.disabled=true;this.textContent="Reading…";try{var r=await S.obd.readDtcs();r.at=new Date().toISOString();DG.scan=r;var s=getSession();s.dtcs={stored:r.stored,pending:r.pending,permanent:r.permanent};saveSession(s)}catch(e){toast("Read failed: "+e.message)}renderDiag()};
  $("scFf").onclick=async function(){this.disabled=true;this.textContent="Reading…";try{var f=await S.obd.readFreezeFrame();DG.ff=f;var s=getSession();s.freezeFrame=f;saveSession(s)}catch(e){toast("Freeze frame failed: "+e.message)}renderDiag()};
  $("scClr").onclick=function(){confirmClearCodes(function(ok){if(ok){DG.ff=null;$("scRead").click()}})};
}

/* ---- Live dashboard ---- */
function fmtPid(k,v){return v==null?"—":(+v).toFixed(k==="module_voltage"||k==="o2_b1s1_v"?2:k==="rpm"||k==="speed_kph"||k==="map_kpa"||k==="baro_kpa"?0:1)}
function subLive(body){
  var L=S.live,c=connected(),keys=Object.keys(O.LIVE_PIDS);
  var p=panel('<h3>Live data dashboard</h3><p class="why">Polls the selected Mode 01 PIDs one after another (an ELM327 answers one request at a time, so more PIDs = slower refresh). Log to CSV for road tests and intermittent faults.</p>'+
    '<div class="chips" id="lvKeys"></div>'+
    '<div class="row"><button class="btn pri" id="lvGo"'+(c?'':' disabled')+'>'+(L.running?"Stop":"Start")+'</button><button class="btn" id="lvCsv"'+(L.rows.length?'':' disabled')+'>Download CSV ('+L.rows.length+' rows)</button><button class="btn" id="lvClr"'+(L.rows.length?'':' disabled')+'>Clear log</button><span class="lbl" id="lvRate"></span></div>'+
    '<div class="tiles" id="lvTiles" style="margin-top:10px">'+L.keys.map(function(k){return '<div class="gauge"><span>'+esc(O.LIVE_PIDS[k].label)+'</span><b id="g-'+k+'">'+fmtPid(k,L.last[k])+'</b><span id="gm-'+k+'">'+(L.min[k]!=null?"min "+fmtPid(k,L.min[k])+" · max "+fmtPid(k,L.max[k]):"")+'</span></div>'}).join("")+'</div>');
  body.appendChild(p);
  var kc=$("lvKeys");keys.forEach(function(k){var sup=S.obd&&S.obd.isSupported?S.obd.isSupported(k):null;kc.appendChild(chip(O.LIVE_PIDS[k].label+(sup===false?" (n/a)":""),L.keys.indexOf(k)>=0,function(){if(L.running){toast("Stop logging to change PIDs");return}var i=L.keys.indexOf(k);if(i>=0)L.keys.splice(i,1);else L.keys.push(k);store.set("liveKeys",L.keys);renderDiag()}))});
  $("lvGo").onclick=function(){if(L.running){L.running=false;renderDiag();return}if(!L.keys.length){toast("Pick at least one PID");return}L.running=true;if(!L.startedAt)L.startedAt=new Date().toISOString();renderDiag();liveLoop()};
  $("lvCsv").onclick=function(){var ks=[];L.rows.forEach(function(r){Object.keys(r).forEach(function(k){if(k!=="time"&&ks.indexOf(k)<0)ks.push(k)})});
    var csv=["time,"+ks.join(",")].concat(L.rows.map(function(r){return r.time+","+ks.map(function(k){return r[k]==null?"":(+r[k]).toFixed(3)}).join(",")})).join("\n");
    download("cartune_live_"+(S.car.vin||"demo")+"_"+new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")+".csv",csv,"text/csv")};
  $("lvClr").onclick=function(){L.rows=[];L.min={};L.max={};L.startedAt=null;renderDiag()};
}
async function liveLoop(){
  var L=S.live,gen=S.gen,t0=Date.now(),n=0;
  while(L.running&&gen===S.gen&&S.obd){
    var row={time:new Date().toISOString()};
    for(var i=0;i<L.keys.length&&L.running;i++){var k=L.keys[i],v=null;try{v=await S.obd.readPid(k)}catch(e){v=null}row[k]=v;
      if(v!=null){L.last[k]=v;L.min[k]=L.min[k]==null?v:Math.min(L.min[k],v);L.max[k]=L.max[k]==null?v:Math.max(L.max[k],v)}
      var g=$("g-"+k);if(g){g.textContent=fmtPid(k,v);var gm=$("gm-"+k);if(gm&&L.min[k]!=null)gm.textContent="min "+fmtPid(k,L.min[k])+" · max "+fmtPid(k,L.max[k])}}
    L.rows.push(row);if(L.rows.length>50000)L.rows.shift();n++;
    var rate=$("lvRate");if(rate)rate.textContent=(n/((Date.now()-t0)/1000)).toFixed(1)+" samples/s · "+L.rows.length+" rows";
    var csvb=$("lvCsv");if(csvb){csvb.disabled=false;csvb.textContent="Download CSV ("+L.rows.length+" rows)"}
    var s=getSession();s.liveLog={rows:L.rows.length,keys:L.keys.slice(),startedAt:L.startedAt};if(n%20===1)saveSession(s);
    await sleep(S.mode==="demo"?120:0);
  }
  L.running=false;if(S.tab==="diag"&&DG.sub==="live"&&S.view!=="detail"){var b=$("lvGo");if(b)b.textContent="Start"}
}

/* ---- Battery / starting / charging ---- */
function subBattery(body){
  var c=connected(),th=DG.th;
  var lp=panel('<h3>Read from the car</h3><p class="why">Reads battery voltage two ways: <b>ATRV</b> (the adapter measures OBD pin 16) and <b>PID 0x42</b> (the ECU’s own module-voltage reading). Adapter readings are typically within about ±0.1–0.2 V — confirm with a meter on the battery posts for pass/fail decisions.</p>'+
    '<div class="row"><button class="btn pri" id="bRead"'+(c?'':' disabled')+'>Read battery voltage</button><button class="btn" id="bCrank"'+(c?'':' disabled')+'>Capture cranking minimum (experimental)</button></div><div id="bOut" class="lbl" style="margin-top:6px">'+(c?'':'Connect an adapter (or the demo car) to auto-fill.')+'</div>');
  body.appendChild(lp);
  var soc=calcCard({id:"soc",tool:"battery_soc",title:"Resting voltage → state of charge",intro:"Engine off, battery rested ≥1 h (or remove surface charge: headlights on 1 min, then off). ~12.6 V ≈ full for a flooded battery.",
    fields:[{k:"volts",label:"Resting voltage",unit:"V",type:"number",ph:"12.6"},{k:"type",label:"Battery type",type:"select",options:[["flooded","Flooded / EFB"],["agm","AGM"]]}],
    compute:function(v){return v.volts==null?null:D.batterySoc({volts:v.volts,type:v.type||"flooded",table:th.battery.socTable[v.type||"flooded"],passPct:th.battery.socPass,warnPct:th.battery.socWarn})},
    label:function(){return "Battery state of charge"},
    thHtml:function(){return thForm(thInput("battery.socPass","Pass at or above","% SOC")+thInput("battery.socWarn","Warn at or above","% SOC"))}});
  var crank=calcCard({id:"crank",tool:"cranking",title:"Cranking voltage",intro:"Lowest battery voltage while cranking (disable fuel/ignition so it doesn’t start, crank ~10 s max). Should stay above ~9.6 V at 21 °C; the minimum drops in the cold.",
    fields:[{k:"minVolts",label:"Lowest voltage while cranking",unit:"V",type:"number",ph:"10.2"},{k:"tempC",label:"Battery temperature (optional)",unit:"°C",type:"number",ph:"21"}],
    compute:function(v){if(v.minVolts==null)return null;var lim=v.tempC==null?th.cranking.minVolts:D.crankingMinVoltage(v.tempC,th.cranking.tempTable,th.cranking.minVolts);return D.crankingTest({minVolts:v.minVolts,tempC:v.tempC,limit:lim,warnMargin:th.cranking.warnMargin})},
    label:function(){return "Cranking voltage"},thHtml:function(){return thForm(thInput("cranking.minVolts","Minimum at 21 °C","V")+thInput("cranking.warnMargin","Marginal band above minimum","V"))}});
  var chg=calcCard({id:"chg",tool:"charging",title:"Charging voltage",intro:"Engine running ~1500–2000 rpm. Conventional systems ~13.5–14.7 V. Smart (ECM-controlled) charging may sit lower when the battery is full — tick the box if the vehicle has it.",
    fields:[{k:"volts",label:"Charging voltage",unit:"V",type:"number",ph:"14.1"},{k:"smart",label:"Smart / ECM-controlled charging",type:"check"}],
    compute:function(v){return v.volts==null?null:D.chargingTest({volts:v.volts,smart:!!v.smart,min:th.charging.min,max:th.charging.max,smartMin:th.charging.smartMin,smartMax:th.charging.smartMax})},
    label:function(){return "Charging voltage"},thHtml:function(){return thForm(thInput("charging.min","Minimum","V")+thInput("charging.max","Maximum","V")+thInput("charging.smartMin","Smart charging lowest","V")+thInput("charging.smartMax","Smart charging highest","V"))}});
  var rip=calcCard({id:"ripple",tool:"ripple",title:"Alternator AC ripple",intro:"Meter on <b>AC volts</b>, probes on the alternator output stud and ground, engine ~2000 rpm with headlights/blower on. Enter volts (0.05 = 50 mV).",
    fields:[{k:"acVolts",label:"AC ripple",unit:"V AC",type:"number",ph:"0.05"}],
    compute:function(v){return v.acVolts==null?null:D.rippleTest({acVolts:v.acVolts,pass:th.ripple.pass,warn:th.ripple.warn})},
    label:function(){return "Alternator ripple"},thHtml:function(){return thForm(thInput("ripple.pass","Pass up to","V AC")+thInput("ripple.warn","Warn up to","V AC"))}});
  [soc,crank,chg,rip].forEach(function(x){body.appendChild(x)});
  if(!c)return;
  $("bRead").onclick=async function(){var out=$("bOut");out.textContent="Reading…";try{var bv=await S.obd.readBatteryVoltage();var rpm=null;try{rpm=await S.obd.readPid("rpm")}catch(e){}
    var v=bv.atrv!=null?bv.atrv:bv.pid42;var running=rpm!=null&&rpm>400;
    out.innerHTML='ATRV (pin 16): <b>'+(bv.atrv!=null?bv.atrv.toFixed(2)+" V":"n/a")+'</b> · PID 0x42 (ECU): <b>'+(bv.pid42!=null?bv.pid42.toFixed(2)+" V":"not supported")+'</b> · engine '+(rpm==null?"state unknown":running?"running ("+Math.round(rpm)+" rpm)":"off")+
      '. '+(v==null?'No voltage reported.':'Filled into <b>'+(running?'Charging voltage':'Resting voltage')+'</b>'+(running?'':' (only valid if the battery has rested)')+'. <button class="link" id="bSwap">Use as '+(running?'resting':'charging')+' instead</button>');
    if(v!=null){(running?chg:soc).setVal("volts",+v.toFixed(2));var sw=$("bSwap");if(sw)sw.onclick=function(){(running?soc:chg).setVal("volts",+v.toFixed(2));toast("Filled")}}}catch(e){out.textContent="Read failed: "+e.message}};
  $("bCrank").onclick=async function(){var btn=this,out=$("bOut");btn.disabled=true;var min=Infinity,n=0,t0=Date.now(),dur=8000;
    out.innerHTML='<b>Crank the engine now</b> (sampling ATRV for 8 s)…';if(S.mode==="demo"&&S.link&&S.link.emu){var emu=S.link.emu;emu.engineRunning=false;setTimeout(function(){emu.startCrank(1800)},1500)}
    while(Date.now()-t0<dur&&connected()){try{var r=O.parseAtrv(await S.obd.raw("ATRV",2000));if(r!=null){min=Math.min(min,r);n++}}catch(e){}if(S.mode==="demo")await sleep(60)}
    btn.disabled=false;if(n&&isFinite(min)){out.innerHTML='Lowest of '+n+' ATRV samples: <b>'+min.toFixed(1)+' V</b> — filled into Cranking voltage. ATRV sample rate is limited (~5–20/s), so a very short dip can be missed; confirm with a meter’s MIN/MAX mode.';crank.setVal("minVolts",+min.toFixed(1))}else out.textContent="No ATRV samples received."};
}

/* ---- Voltage drop ---- */
function circuitOptions(){return Object.keys(D.DEFAULT_THRESHOLDS.voltageDrop).map(function(k){return [k,D.DEFAULT_THRESHOLDS.voltageDrop[k].label]})}
function subVdrop(body){
  var th=DG.th;
  body.appendChild(panel('<h3>How to measure voltage drop</h3><ol class="why" style="margin:4px 0 0 18px;padding:0"><li>Switch the circuit ON so it carries its normal current (voltage drop means nothing on an unloaded circuit).</li><li><b>Power side:</b> meter red on battery +, black on the load’s + terminal (back-probe, connector plugged in).</li><li><b>Ground side:</b> red on the load’s ground terminal, black on battery −.</li><li>High reading? Move a probe along the circuit connector by connector until the drop disappears — that section is the fault.</li></ol>'));
  var single=calcCard({id:"vdrop",tool:"voltage_drop",title:"Single voltage-drop reading",
    fields:[{k:"label",label:"Circuit / measurement point",type:"text",ph:"e.g. Headlamp LH ground"},{k:"circuit",label:"Circuit type",type:"select",options:circuitOptions()},{k:"reading",label:"Measured drop",unit:"V",type:"number",ph:"0.15"},{k:"loaded",label:"Circuit was ON and loaded",type:"check",def:true}],
    compute:function(v){if(v.reading==null)return null;var c=v.circuit||"ground";return D.voltageDrop({reading:v.reading,circuit:c,loaded:v.loaded!==false,thresholds:th.voltageDrop[c]})},
    label:function(v){return "Voltage drop: "+(v.label||(v.circuit||"ground"))},
    thHtml:function(){return thForm(Object.keys(th.voltageDrop).map(function(k){return thInput("voltageDrop."+k+".pass",th.voltageDrop[k].label+" — pass up to","V")+thInput("voltageDrop."+k+".warn","… warn up to","V")}).join(""))}});
  var wiz=calcCard({id:"vwiz",tool:"voltage_drop_circuit",title:"Whole-circuit wizard (power + ground side)",intro:"Enter source voltage and both drops, measured with the circuit loaded, to see how much voltage actually reaches the load.",
    fields:[{k:"label",label:"Circuit",type:"text",ph:"e.g. Starter circuit"},{k:"feed",label:"Power-side circuit type",type:"select",options:circuitOptions().filter(function(o){return o[0]!=="ground"&&o[0]!=="sensor_ground"})},
      {k:"source",label:"Battery voltage (loaded)",unit:"V",type:"number",ph:"12.4"},{k:"power",label:"Power-side drop",unit:"V",type:"number",ph:"0.3"},{k:"ground",label:"Ground-side drop",unit:"V",type:"number",ph:"0.1"}],
    compute:function(v){if(v.power==null||v.ground==null)return null;var f=v.feed||"feed_high_current";
      var rp=D.voltageDrop({reading:v.power,circuit:f,thresholds:th.voltageDrop[f]}),rg=D.voltageDrop({reading:v.ground,circuit:"ground",thresholds:th.voltageDrop.ground});
      var parts=[rp,rg],msg="Power side: "+rp.message+" Ground side: "+rg.message;
      if(v.source!=null){var b=D.circuitBudget({source:v.source,powerDrop:v.power,groundDrop:v.ground});parts.push(b);msg+=" "+b.message}
      return {status:worst(parts.map(function(x){return x.status})),message:msg}},
    label:function(v){return "Circuit voltage drop: "+(v.label||"circuit")}});
  body.appendChild(single);body.appendChild(wiz);
}

/* ---- Parasitic draw ---- */
function subDraw(body){
  var th=DG.th;
  var total=calcCard({id:"draw",tool:"parasitic_draw",title:"Total parasitic draw",intro:"Ammeter in series with the battery negative (use a jumper while connecting so modules don’t wake), everything off, doors latched, key away. Typical 20–50 mA; some modern vehicles specify up to ~85 mA.",
    fields:[{k:"milliamps",label:"Measured draw",unit:"mA",type:"number",ph:"35"},{k:"ah",label:"Battery capacity",unit:"Ah",type:"number",ph:"60"}],
    compute:function(v){return v.milliamps==null?null:D.parasiticDraw({milliamps:v.milliamps,limitMa:th.parasitic.limitMa,warnMa:th.parasitic.warnMa,batteryAh:v.ah||60})},
    label:function(){return "Parasitic draw"},thHtml:function(){return thForm(thInput("parasitic.limitMa","Pass up to","mA")+thInput("parasitic.warnMa","Warn up to (fail above)","mA"))}});
  body.appendChild(total);
  var sl=DG.sleep,exp=store.get("sleepMin",th.sleep.expectedMinutes);
  var sp=panel('<h3>Module sleep timer</h3><p class="why">Many modules stay awake for 20–60+ minutes after lock-up. Start the timer when you close up the car; don’t open doors or wake it while waiting.</p>'+
    '<div class="form"><label>Expected sleep time (min)<input type="number" id="slMin" step="any" value="'+esc(exp)+'"></label></div>'+
    '<div class="row"><button class="btn pri" id="slGo">'+(sl.start?"Stop":"Start timer")+'</button><b id="slClock" class="mono"></b></div><div id="slOut"></div>');
  body.appendChild(sp);
  function tickSleep(){var el=$("slClock");if(!el)return;if(!sl.start){el.textContent="";$("slOut").innerHTML="";return}var mins=(Date.now()-sl.start)/60000,m=Math.floor(mins),s=Math.floor((mins-m)*60);
    el.textContent=m+":"+String(s).padStart(2,"0")+" elapsed";$("slOut").innerHTML=resHtml(D.sleepCheck({elapsedMinutes:Math.round(mins*10)/10,expectedMinutes:+$("slMin").value||th.sleep.expectedMinutes}))}
  $("slMin").onchange=function(){store.set("sleepMin",+this.value);tickSleep()};
  $("slGo").onclick=function(){if(sl.start){sl.start=null;clearInterval(sl.timer);sl.timer=null}else{sl.start=Date.now();clearInterval(sl.timer);sl.timer=setInterval(tickSleep,1000)}this.textContent=sl.start?"Stop":"Start timer";tickSleep()};
  tickSleep();
  var fuse=calcCard({id:"fuse",tool:"fuse_drop",title:"Fuse voltage drop → current",intro:"With modules asleep, measure millivolts across each fuse’s two test points (meter on mV, no need to pull fuses — pulling one can wake modules). Current = mV ÷ fuse resistance (mΩ). Resistances are <b>approximate</b>; edit them below.",
    fields:[{k:"label",label:"Fuse position / circuit",type:"text",ph:"e.g. F23 radio"},{k:"type",label:"Fuse type",type:"select",options:Object.keys(FU.FUSE_TYPE_LABELS).map(function(k){return [k,FU.FUSE_TYPE_LABELS[k]]}),onchange:function(v,host){renderDiag()}},
      {k:"rating",label:"Rating",unit:"A",type:"select",options:function(v){return FU.fuseRatings(v.type||"ato",DG.fuseTable).map(function(r){return [r,r+" A · "+DG.fuseTable[v.type||"ato"][r]+" mΩ"]})}},
      {k:"millivolts",label:"Measured across fuse",unit:"mV",type:"number",ph:"0.8"}],
    compute:function(v){if(v.millivolts==null)return null;var t=v.type||"ato",r=v.rating||FU.fuseRatings(t,DG.fuseTable)[0];if(!DG.fuseTable[t][r])r=FU.fuseRatings(t,DG.fuseTable)[0];return D.fuseDropCurrent({millivolts:v.millivolts,type:t,rating:r,table:DG.fuseTable})},
    label:function(v){return "Fuse drop: "+(v.label||((v.type||"ato")+" "+(v.rating||"")+"A"))}});
  body.appendChild(fuse);
  var ft=panel('<h3>Fuse resistance table <small class="lbl">approximate · editable</small></h3><p class="why">Cold resistance in milliohms. Defaults from Littelfuse ATO/MICRO2 datasheets and Power Probe fuse voltage-drop charts. Real fuses vary by maker and temperature — if you have your fuse maker’s chart, enter its values.</p>'+
    Object.keys(DG.fuseTable).map(function(t){return '<details class="th"><summary>'+esc(FU.FUSE_TYPE_LABELS[t])+'</summary><div class="form">'+FU.fuseRatings(t,DG.fuseTable).map(function(r){return '<label>'+r+' A (mΩ)<input type="number" step="any" data-fuse="'+t+'|'+r+'" value="'+DG.fuseTable[t][r]+'"></label>'}).join("")+'</div></details>'}).join("")+
    '<div class="row"><button class="btn" id="ftReset">Reset table to defaults</button></div>');
  body.appendChild(ft);
  [].forEach.call(ft.querySelectorAll("[data-fuse]"),function(el){el.onchange=function(){var p=el.dataset.fuse.split("|"),v=parseFloat(el.value);if(!(v>0)){toast("Enter a positive number");return}DG.fuseTable[p[0]][p[1]]=v;store.set("fuseTable",DG.fuseTable);fuse.update();toast("Saved")}});
  $("ftReset").onclick=function(){DG.fuseTable=clone(FU.DEFAULT_FUSE_RESISTANCE_MOHM);store.set("fuseTable",null);renderDiag()};
}

/* ---- Circuit fault finder ---- */
function subFaults(body){
  var tr=W.FAULT_TREES.find(function(t){return t.id===DG.tree.id})||W.FAULT_TREES[0],w=W.walkTree(tr,DG.tree.answers),node=w.node;
  var p=panel('<h3>Circuit fault finder</h3><p class="why">Pick the symptom type, then answer each step from your measurements.</p><div class="chips" id="ftChips"></div>'+
    '<p class="lbl" style="margin-top:6px">'+esc(tr.summary)+'</p>'+
    '<div class="crumbs">Step '+w.path.length+(DG.tree.answers.length?' · your answers: '+DG.tree.answers.join(" → "):'')+'</div>'+
    '<div class="res '+(node.finding?'st-warn':'st-info')+'"><b class="st">'+(node.finding?'FINDING':'CHECK')+'</b>'+esc(node.text)+'</div>'+
    '<div class="row">'+(node.finding?'<button class="btn pri" id="ftSave">Save finding to report</button>':'<button class="btn pri" id="ftYes">Yes</button><button class="btn" id="ftNo">No</button>')+
    (DG.tree.answers.length?'<button class="btn" id="ftBack">Back</button><button class="btn" id="ftRestart">Restart</button>':'')+'</div>');
  body.appendChild(p);
  var fc=$("ftChips");W.FAULT_TREES.forEach(function(t){fc.appendChild(chip(t.title,t.id===tr.id,function(){DG.tree={id:t.id,answers:[]};renderDiag()}))});
  if($("ftYes"))$("ftYes").onclick=function(){DG.tree.answers.push("yes");renderDiag()};
  if($("ftNo"))$("ftNo").onclick=function(){DG.tree.answers.push("no");renderDiag()};
  if($("ftBack"))$("ftBack").onclick=function(){DG.tree.answers.pop();renderDiag()};
  if($("ftRestart"))$("ftRestart").onclick=function(){DG.tree.answers=[];renderDiag()};
  if($("ftSave"))$("ftSave").onclick=function(){addTest("fault_finder",tr.title+" — decision tree",{answers:DG.tree.answers.join(" → ")},{status:"info",message:node.text})};
  body.appendChild(panel('<h3>Intermittent faults: provoke them</h3><ul class="why" style="margin:0 0 0 18px;padding:0"><li><b>Wiggle test:</b> flex harnesses and connectors while watching voltage, a test lamp on a non-computer circuit, or live data.</li><li><b>Heat:</b> warm suspect components with a heat gun (carefully).</li><li><b>Cold / wet:</b> freeze spray or a light water mist on connectors and modules.</li><li><b>Log it:</b> use the Live dashboard CSV log during a road test and check freeze frame when a code sets.</li></ul>'));
}

/* ---- Sensors ---- */
var CMP_KEYS=[["module_voltage","V","Meter across battery posts"],["coolant_c","°C","Thermometer / IR at the ECT sensor"],["intake_air_c","°C","Thermometer near the IAT sensor"],["throttle_pct","%","Throttle angle (closed ≈ 0–20%)"],["map_kpa","kPa","Gauge / baro at key-on engine-off"],["rpm","rpm","Tachometer"]];
function subSensors(body){
  var c=connected();
  body.appendChild(calcCard({id:"s3w",tool:"sensor_3wire",title:"3-wire sensor check (5 V ref · signal · ground)",intro:"Key on, sensor connected, back-probe each wire. Reference to battery −; signal to battery −; ground as a voltage drop (sensor ground pin to battery −). For MAP, TPS, pressure sensors and similar.",
    fields:[{k:"label",label:"Sensor",type:"text",ph:"e.g. MAP sensor"},{k:"ref",label:"Reference wire",unit:"V",type:"number",ph:"5.0"},{k:"signal",label:"Signal wire",unit:"V",type:"number",ph:"1.2"},{k:"groundDrop",label:"Ground drop",unit:"V",type:"number",ph:"0.03"}],
    compute:function(v){return v.ref==null||v.signal==null||v.groundDrop==null?null:D.threeWireSensor({ref:v.ref,signal:v.signal,groundDrop:v.groundDrop,s:DG.th.sensor})},
    label:function(v){return "3-wire sensor: "+(v.label||"sensor")},
    thHtml:function(){return thForm(thInput("sensor.refNominal","Reference nominal","V")+thInput("sensor.refPass","Reference ± pass","V")+thInput("sensor.refWarn","Reference ± warn","V")+thInput("sensor.groundPass","Ground drop pass","V")+thInput("sensor.groundWarn","Ground drop warn","V"))}}));
  var rows=CMP_KEYS.map(function(k){var r=DG.cmp[k[0]]||{};var res=null;if(r.meter!=null&&r.scan!=null)try{res=D.compareReadings({meter:r.meter,scan:r.scan,tolPct:r.tol!=null?r.tol:DG.th.compare.tolPct})}catch(e){}
    return '<tr><td><b>'+esc(O.LIVE_PIDS[k[0]].label)+'</b><br><span class="lbl">'+esc(k[2])+'</span></td><td class="mono" id="cmps-'+k[0]+'">'+(r.scan!=null?fmtPid(k[0],r.scan):"—")+'</td><td><input type="number" step="any" data-cmp="'+k[0]+'" data-f="meter" value="'+(r.meter!=null?r.meter:"")+'" aria-label="Meter value '+esc(k[0])+'"></td><td><input type="number" step="any" data-cmp="'+k[0]+'" data-f="tol" value="'+(r.tol!=null?r.tol:DG.th.compare.tolPct)+'" style="width:60px" aria-label="Tolerance percent"></td><td>'+(res?'<span class="res st-'+res.status+'" style="display:inline-block;margin:0;padding:3px 8px" title="'+esc(res.message)+'"><b class="st" style="margin:0">'+res.status.toUpperCase()+'</b> '+res.pct+'%</span> <button class="link" data-cmpsave="'+k[0]+'">Save</button>':'')+'</td></tr>'}).join("");
  var p=panel('<h3>Meter vs scan tool</h3><p class="why">Compare what your meter/thermometer measures at the component with what the ECU reports. A mismatch points at the wiring between sensor and ECU (resistance, poor ground) or the ECU input.</p>'+
    '<div class="row"><button class="btn pri" id="cmpRead"'+(c?'':' disabled')+'>Read scan-tool values</button>'+(c?'':'<span class="lbl">Connect to read live values</span>')+'</div>'+
    '<div style="overflow-x:auto"><table class="data" style="margin-top:8px"><tr><th>PID</th><th>Scan tool</th><th>Meter</th><th>Tol %</th><th>Result</th></tr>'+rows+'</table></div>');
  body.appendChild(p);
  [].forEach.call(p.querySelectorAll("[data-cmp]"),function(el){el.onchange=function(){var k=el.dataset.cmp,r=DG.cmp[k]||{};r[el.dataset.f]=num(el.value);DG.cmp[k]=r;store.set("cmpRows",DG.cmp);renderDiag()}});
  [].forEach.call(p.querySelectorAll("[data-cmpsave]"),function(b){b.onclick=function(){var k=b.dataset.cmpsave,r=DG.cmp[k];var res=D.compareReadings({meter:r.meter,scan:r.scan,tolPct:r.tol!=null?r.tol:DG.th.compare.tolPct});addTest("meter_vs_scan","Meter vs scan: "+O.LIVE_PIDS[k].label,{meter:r.meter,scan:+(+r.scan).toFixed(3),tolPct:r.tol},res)}});
  if(c)$("cmpRead").onclick=async function(){this.disabled=true;this.textContent="Reading…";for(var i=0;i<CMP_KEYS.length;i++){var k=CMP_KEYS[i][0];var v=null;try{v=await S.obd.readPid(k)}catch(e){}var r=DG.cmp[k]||{};r.scan=v;DG.cmp[k]=r}store.set("cmpRows",DG.cmp);renderDiag()};
}

/* ---- CAN bus ---- */
function subCan(body){
  var t=DG.th.can;
  body.appendChild(calcCard({id:"canr",tool:"can_termination",title:"CAN termination resistance (DLC pin 6 ↔ 14)",intro:"Battery disconnected (wait for modules to power down), ohmmeter between DLC pins 6 (CAN-H) and 14 (CAN-L). ~60 Ω normal, ~120 Ω one terminator missing, near 0 short, OL open.",
    fields:[{k:"ohms",label:"Resistance",unit:"Ω",type:"number",ph:"60"},{k:"open",label:"Meter reads OL (open)",type:"check"}],
    compute:function(v){if(v.open)return D.canTermination({ohms:null,t:t});return v.ohms==null?null:D.canTermination({ohms:v.ohms,t:t})},
    label:function(){return "CAN termination"},thHtml:function(){return thForm(thInput("can.normal.0","Normal from","Ω")+thInput("can.normal.1","Normal to","Ω")+thInput("can.oneTerminator.0","One terminator from","Ω")+thInput("can.oneTerminator.1","One terminator to","Ω")+thInput("can.shortBelow","Short below","Ω"))}}));
  body.appendChild(calcCard({id:"canv",tool:"can_voltage",title:"CAN-H / CAN-L voltage",intro:"Ignition ON, meter DC volts from pin 6 (H) and pin 14 (L) to pin 4/5 ground. A DMM shows the average: idle/recessive ~2.5 V each; an active bus reads H ~2.5–3.5 V, L ~1.5–2.5 V.",
    fields:[{k:"canH",label:"CAN-H (pin 6)",unit:"V",type:"number",ph:"2.7"},{k:"canL",label:"CAN-L (pin 14)",unit:"V",type:"number",ph:"2.3"}],
    compute:function(v){return v.canH==null||v.canL==null?null:D.canVoltages({canH:v.canH,canL:v.canL,t:t})},
    label:function(){return "CAN voltages"}}));
  body.appendChild(panel('<h3>OBD-II connector (J1962) pins</h3><table class="data">'+W.DLC_PINS.map(function(p){return '<tr><td class="mono">'+p.pin+'</td><td>'+esc(p.use)+'</td></tr>'}).join("")+'</table><p class="lbl">Use break-out leads or proper back-probes; never a test light on network pins.</p>'));
}

/* ---- Safety ---- */
function subSafety(body){
  body.appendChild(panel('<h3>Safety notes</h3>'+W.SAFETY_NOTES.map(function(n){return '<div class="banner '+(n.level==="danger"?"danger":n.level==="info"?"info":"")+'"><b>'+esc(n.title)+'.</b> '+esc(n.body)+'</div>'}).join("")));
}

/* ---- Report ---- */
function subReport(body){
  var s=getSession(),sum=RP.summarize(s);
  var p=panel('<h3>Diagnostic report <small class="lbl">'+esc(S.car.title)+'</small></h3>'+
    (S.mode==="demo"?'<div class="banner">Demo session — codes and live values are simulated. The report says so.</div>':'')+
    '<p>'+sum.counts.pass+' pass · '+sum.counts.warn+' warn · '+sum.counts.fail+' fail · '+sum.counts.info+' info — workflow '+sum.stepsDone+'/'+sum.stepsTotal+' — '+sum.codes+' code(s)</p>'+
    '<div class="row"><button class="btn pri" id="rpOpen">Open printable report</button><button class="btn" id="rpHtml">Download HTML</button><button class="btn" id="rpJson">Download JSON</button><button class="btn danger" id="rpNew">New session…</button></div>'+
    (s.tests.length?'<table class="data" style="margin-top:10px"><tr><th></th><th>Test</th><th>Result</th><th></th></tr>'+s.tests.map(function(t,i){return '<tr><td><span class="res st-'+t.status+'" style="display:inline-block;margin:0;padding:2px 6px"><b class="st" style="margin:0">'+t.status.toUpperCase()+'</b></span></td><td><b>'+esc(t.label)+'</b><br><span class="lbl">'+esc(new Date(t.at).toLocaleString())+'</span></td><td class="why">'+esc(t.message)+'</td><td><button class="link" data-del="'+i+'" aria-label="Remove test">✕</button></td></tr>'}).join("")+'</table>':'<p class="why">No tests saved yet — use “Save to report” on any tool.</p>'));
  body.appendChild(p);
  var fname="cartune_diag_"+(S.car.vin||"demo")+"_"+new Date().toISOString().slice(0,10);
  $("rpOpen").onclick=function(){var html=RP.buildReportHtml(getSession());var w=window.open("","_blank");if(!w){download(fname+".html",html,"text/html");toast("Pop-up blocked — downloaded instead");return}w.document.open();w.document.write(html);w.document.close()};
  $("rpHtml").onclick=function(){download(fname+".html",RP.buildReportHtml(getSession()),"text/html")};
  $("rpJson").onclick=function(){download(fname+".json",JSON.stringify(RP.buildReportJson(getSession()),null,2))};
  $("rpNew").onclick=function(){if(confirm("Start a new session for this vehicle? The current checklist, notes and saved tests will be cleared (download the report first if you need it).")){store.set(sessKey(),null);DG.scan=null;DG.ff=null;renderDiag();toast("New session started")}};
  [].forEach.call(p.querySelectorAll("[data-del]"),function(b){b.onclick=function(){var ss=getSession();ss.tests.splice(+b.dataset.del,1);saveSession(ss);renderDiag()}});
}

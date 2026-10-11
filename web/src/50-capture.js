/* ==========================================================================
 * Live data / capture tab — browser version of mobile CaptureScreen.tsx:
 * VIN, stored DTCs, clear DTCs (confirmed), one-shot live PIDs, and export of
 * mobile_capture.json in the exact shape MobileCaptureAgent expects
 * (built by mobile/src/data/tuneSpec.ts buildMobileCapture()).
 * ======================================================================== */
var CAP={status:"",vin:null,dtcs:[],live:{},busy:false};
function needConn(){if(!connected()){toast("Connect an adapter (or the demo car) first");openConnect();return false}return true}
function connLine(){
  if(connected())return '<div class="banner '+(S.mode==="demo"?"":"info")+'"><b>'+(S.mode==="demo"?'DEMO adapter — simulated car, made-up data.':'Connected: '+esc(S.link.label))+'</b>'+(S.obd.protocol?' · '+esc(S.obd.protocol):'')+' <button class="link" data-act="conn">Change</button></div>';
  if(S.conn==="connecting"||S.conn==="searching")return '<div class="banner info">Connecting to adapter…</div>';
  return '<div class="banner danger"><b>No adapter connected.</b> Readings from the car are unavailable; manual calculators still work. <button class="link" data-act="conn">Connect</button></div>';
}
function wireConnLinks(host){[].forEach.call(host.querySelectorAll('[data-act="conn"]'),function(b){b.onclick=openConnect})}
async function capRun(label,fn){if(!needConn()||CAP.busy)return;CAP.busy=true;CAP.status=label+"…";renderCapture();try{await fn()}catch(e){CAP.status=label+" failed: "+e.message}CAP.busy=false;renderCapture()}
function renderCapture(){
  var h=$("capture");
  h.innerHTML='<h2>Live data &amp; capture</h2>'+connLine()+
    '<div class="panel"><div class="row" style="margin-top:0">'+
    '<button class="btn" id="capVin">Read VIN</button><button class="btn" id="capDtc">Read stored codes</button><button class="btn danger" id="capClr">Clear codes…</button>'+
    '<button class="btn" id="capPid">Read live PIDs</button><button class="btn pri" id="capExp">Export mobile_capture.json</button></div>'+
    '<p class="lbl" style="margin-top:8px" aria-live="polite">'+esc(CAP.status||"Reads over the OBD-II adapter; never touches the calibration.")+'</p>'+
    '<table class="data"><tr><th>VIN</th><td class="mono">'+esc(CAP.vin||"—")+'</td></tr>'+
    '<tr><th>Stored codes</th><td>'+(CAP.dtcs.length?CAP.dtcs.map(function(c){return '<b>'+esc(c)+'</b> '+esc(DI.describeDtc(c).description)}).join("<br>"):"none read yet")+'</td></tr>'+
    Object.keys(CAP.live).map(function(k){return '<tr><th>'+esc(O.LIVE_PIDS[k].label)+'</th><td>'+(CAP.live[k]==null?"not supported":(+CAP.live[k]).toFixed(k==="module_voltage"||k==="o2_b1s1_v"?2:1))+'</td></tr>'}).join("")+'</table></div>'+
    '<div class="panel"><h3>Adapter log</h3><p class="why">Raw ELM327 traffic — useful when reporting adapter compatibility.</p><pre class="log" id="capLog">'+esc(S.adapterLog.slice(-120).join("\n"))+'</pre></div>'+
    '<p class="lbl">For full scans (pending/permanent codes, freeze frame), the live dashboard with CSV logging and electrical tests, open <button class="link" id="toDiag">Diagnostics</button>.</p>';
  wireConnLinks(h);
  $("toDiag").onclick=function(){S.tab="diag";store.set("tab","diag");render()};
  $("capVin").onclick=function(){capRun("Reading VIN",async function(){CAP.vin=await S.obd.readVin();CAP.status=CAP.vin?"VIN read: "+CAP.vin:"VIN not reported by this vehicle"})};
  $("capDtc").onclick=function(){capRun("Reading codes",async function(){var d=await S.obd.readDtcs();CAP.dtcs=d.stored;CAP.status=d.stored.length?d.stored.length+" stored code(s)":"No stored codes"})};
  $("capClr").onclick=function(){if(needConn())confirmClearCodes(function(ok){CAP.status=ok?"Codes cleared":"Clear not confirmed by the ECU";if(ok)CAP.dtcs=[];renderCapture()})};
  $("capPid").onclick=function(){capRun("Reading live PIDs",async function(){var out={};for(var k of ["rpm","coolant_c","intake_air_c","throttle_pct","short_fuel_trim_pct","long_fuel_trim_pct"]){out[k]=await S.obd.readPid(k)}CAP.live=out;CAP.status="Live PIDs read"})};
  $("capExp").onclick=function(){var live={};Object.keys(CAP.live).forEach(function(k){if(CAP.live[k]!=null)live[k]=CAP.live[k]});
    var cap=TSPEC.buildMobileCapture(CAP.vin,CAP.dtcs,live);download("mobile_capture.json",JSON.stringify(cap,null,2));CAP.status="Exported mobile_capture.json — pass it to cartune_orchestrator.py --mobile-capture";renderCapture()};
  var lg=$("capLog");lg.scrollTop=lg.scrollHeight;
}

/** Mode 04 behind an explicit confirmation (checkbox + typed CLEAR). */
function confirmClearCodes(done){
  openSheet('<h2>Clear trouble codes?</h2><div class="banner danger">This sends OBD-II Mode 04 to the vehicle: it erases stored and pending codes, <b>freeze frame data</b> and <b>readiness monitors</b>. Permanent codes stay until the fault is fixed and the monitor passes. The vehicle may fail an emissions inspection until drive cycles complete.'+(S.mode==="demo"?' <b>(Demo: only the simulated car is affected.)</b>':'')+'</div>'+
    '<label class="field" style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="clrAck" style="width:22px;height:22px"> I have recorded the codes and freeze frame</label>'+
    '<div class="field"><label for="clrTxt">Type CLEAR to confirm</label><input id="clrTxt" autocomplete="off" autocapitalize="characters"></div>'+
    '<p class="lbl">Ignition ON, engine OFF.</p><div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="clrNo">Cancel</button><button class="primary" id="clrGo" style="flex:1" disabled>Clear codes</button></div>');
  var upd=function(){$("clrGo").disabled=!($("clrAck").checked&&$("clrTxt").value.trim().toUpperCase()==="CLEAR")};
  $("clrAck").onchange=upd;$("clrTxt").oninput=upd;$("clrNo").onclick=closeSheet;
  $("clrGo").onclick=async function(){if($("clrGo").disabled)return;$("clrGo").disabled=true;$("clrGo").textContent="Clearing…";
    var ok=false;try{ok=await S.obd.clearDtcs({confirmed:true})}catch(e){toast("Clear failed: "+e.message)}
    closeSheet();toast(ok?"Codes cleared":"ECU did not confirm the clear");done&&done(ok)};
}

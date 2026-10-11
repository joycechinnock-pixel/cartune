/* ==========================================================================
 * CarTune web app — core: state, connection, Home / Tune detail / Pro tables /
 * Pro settings / Flash / Edit vehicle. The Home→Pro-settings code is carried
 * over from CarTune-App-Preview.html (mobile/scripts/app-preview.template.html)
 * with the simulated connection replaced by a real ObdSession (demo emulator,
 * Web Serial or Web Bluetooth).
 * ======================================================================== */
var R = requireMod("./tune/rules"), P = requireMod("./tune/presets"), E = requireMod("./ecu/ecuProfiles"), T = requireMod("./tune/tables");
var O = requireMod("./ble/elm327"), EM = requireMod("./ble/elmEmulator"), SESS = requireMod("./ble/obdSession"), DET = requireMod("./vehicle/detect");
var D = requireMod("./diag/electrical"), FU = requireMod("./diag/fuses"), W = requireMod("./diag/workflow"), DI = requireMod("./diag/dtcInfo"), RP = requireMod("./diag/report");
var PR = requireMod("./data/profiles"), TSPEC = requireMod("./data/tuneSpec");
var ZC={green:"var(--green)",yellow:"var(--yellow)",orange:"var(--orange)",red:"var(--red)"};
var ZL={green:"No risk",yellow:"Fine, could be better",orange:"Warning",red:"Likely damage"};
var ORDER=["green","yellow","orange","red"];
var UPG={intercooler:"Intercooler",fuelSystem:"Injectors + pump",internals:"Forged internals / springs",cooling:"Cooling",driveline:"Clutch / gearbox"};
var DEMO_CARS=[
  {key:"ve",title:"2008 Holden Commodore SS",spec:"6.0 L V8 · 6-speed automatic",engine:"na_petrol",fuel:"98",vin:"6G1EK5EU18L000123",ecu:"gm-e38-e67",osid:"12612384"},
  {key:"fg",title:"2012 Ford Falcon XR6 Turbo",spec:"4.0 L turbo I6 · 6-speed automatic",engine:"turbo_petrol",fuel:"98",vin:"6FPAAAJGSWCG12345",ecu:"ford-spanish-oak",osid:"HACCKG6"},
  {key:"hl",title:"2019 Toyota HiLux SR5",spec:"2.8 L turbo diesel · 6-speed automatic",engine:"turbo_diesel",fuel:"diesel",vin:"MR0HA3CD700123456",ecu:"denso-toyota",osid:"89663-0K"}
];
/* Demo trouble codes = mock_data/sample_dtc_report.json (P0171 stored, P0300 pending). */
var DEMO_DTCS={stored:["P0171"],pending:["P0300"],permanent:["P0171"]};
var store={get:function(k,d){try{var v=localStorage.getItem("cartune:"+k);return v?JSON.parse(v):d}catch(e){return d}},set:function(k,v){try{localStorage.setItem("cartune:"+k,JSON.stringify(v))}catch(e){}}};
var S={carKey:store.get("car","ve"),car:null,conn:"searching",found:{},backup:0,skill:store.get("skill","simple"),
  upgrades:store.get("upgrades",{intercooler:false,fuelSystem:false,internals:false,cooling:false,driveline:false}),
  fuel:null,slots:{},onCar:"factory",view:"home",preset:null,seg:null,open:{},
  mode:"demo",tab:store.get("tab","home"),link:null,obd:null,gen:0,adapterLog:[],linkError:null,renderedTab:null,tabDirty:true};
var $=function(id){return document.getElementById(id)};
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function ctx(){return{engine:S.car.engine,fuel:S.fuel,upgrades:S.upgrades,skill:S.skill}}
function toast(t){var el=$("toast");el.textContent=t;el.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(function(){el.classList.remove("show")},2200)}
function slotKey(){return "slots:"+S.car.key} /* pre-v5 storage, migrated by loadUserTunes() */
/* Tune values, user tunes and filing: web/src/25-tunes.js */
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function isLive(){return S.mode==="serial"||S.mode==="ble"}
function connected(){return !!(S.obd&&S.conn==="on")}
function download(name,text,type){var b=new Blob([text],{type:type||"application/json"});var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},1000)}

/* ---------- connection ---------- */
function logLine(t){var d=new Date();S.adapterLog.push(d.toTimeString().slice(0,8)+" "+t);if(S.adapterLog.length>400)S.adapterLog.splice(0,S.adapterLog.length-400);var el=$("alog");if(el){el.textContent=S.adapterLog.join("\n");el.scrollTop=el.scrollHeight}}
function makeSession(tr){var s=new SESS.ObdSession(tr);s.onTraffic=function(dir,txt){logLine((dir==="tx"?"→ ":"← ")+txt)};return s}
function loadCarPrefs(){S.fuel=store.get("fuel:"+S.car.key,S.car.fuel);loadUserTunes();S.onCar=store.get("oncar:"+S.car.key,"factory");if(String(S.onCar).indexOf("u:")===0&&!S.user[S.onCar.slice(2)])S.onCar="factory"}
async function disconnectLink(){if(S.live&&S.live.running)S.live.running=false;var l=S.link;S.link=null;S.obd=null;if(l){try{await l.close()}catch(e){}}}

async function connectDemo(){
  var gen=++S.gen;await disconnectLink();
  S.mode="demo";S.linkError=null;
  var picked=S.carKey==="pick"?store.get("pickedCar",null):null; /* a car chosen in the vehicle picker (45-picker.js) */
  S.car=Object.assign({},picked||DEMO_CARS.find(function(c){return c.key===S.carKey})||DEMO_CARS[0]);
  loadCarPrefs();S.conn="searching";S.found={};S.backup=0;S.tabDirty=true;render();
  var tr=new DemoTransport({vin:S.car.vin,calId:S.car.osid,stored:DEMO_DTCS.stored.slice(),pending:DEMO_DTCS.pending.slice(),permanent:DEMO_DTCS.permanent.slice()});
  S.link=tr;S.obd=makeSession(tr);logLine("DEMO adapter: simulated ELM327, no hardware");
  try{
    await sleep(350);if(gen!==S.gen)return;S.conn="connecting";render();
    await S.obd.init();if(gen!==S.gen)return;S.found.receiver=true;render();
    var vin=await S.obd.readVin();if(gen!==S.gen)return;if(vin)S.car.vin=vin;S.found.vin=true;render();
    await sleep(450);if(gen!==S.gen)return;S.found.vehicle=true;render();
    var cals=await S.obd.readCalIds();await sleep(350);if(gen!==S.gen)return;
    if(cals[0])S.car.osid=cals[0];S.car.ecuDetected=!!S.car.ecu;S.found.ecu=true;S.conn="on";S.tabDirty=true;render();
    /* Stock-file backup is SIMULATED in demo mode only (it needs the wired CarTune receiver on a real car). */
    (function tick(){if(gen!==S.gen)return;S.backup=Math.min(100,S.backup+7);if(S.tab==="home"&&S.view==="home")render();else if(S.view==="detail")render();if(S.backup<100)setTimeout(tick,160)})();
  }catch(e){if(gen===S.gen){S.conn="error";S.linkError=e.message;render()}}
}

async function connectReal(kind,baud){
  var tr=kind==="serial"?new SerialTransport(baud):new BleTransport();
  logLine("Opening "+(kind==="serial"?"Web Serial port":"Web Bluetooth device")+"…");
  await tr.open(logLine); /* must run inside the click handler (user gesture) */
  var gen=++S.gen;var prev=S.car||DEMO_CARS[0];await disconnectLink();
  S.mode=kind;S.link=tr;S.obd=makeSession(tr);S.linkError=null;S.backup=0;S.found={};S.conn="connecting";
  S.car={key:"live",title:"Reading vehicle…",spec:tr.label,engine:prev.engine,fuel:prev.fuel,vin:null,ecu:prev.ecu,osid:null,live:true,ecuDetected:false};
  loadCarPrefs();S.tabDirty=true;render();logLine("Connected: "+tr.label);
  try{
    await S.obd.init();if(gen!==S.gen)return;S.found.receiver=true;render();
    var vin=null;try{vin=await S.obd.readVin()}catch(e){logLine("VIN read failed: "+e.message)}
    if(vin){var d=DET.decodeVin(vin);S.car.vin=vin;S.car.key="vin:"+vin;S.car.title=[d.year,d.make].filter(Boolean).join(" ")||("Vehicle "+vin)}
    else{S.car.title="Vehicle (VIN not reported)"}
    S.found.vin=true;S.found.vehicle=true;render();
    var cals=[];try{cals=await S.obd.readCalIds()}catch(e){logLine("Cal ID read failed: "+e.message)}
    var ecu=null,cal=null;cals.forEach(function(c){if(!ecu){var m=DET.detectEcu(c);if(m){ecu=m;cal=c}}});
    if(ecu){S.car.ecu=ecu.id;S.car.osid=cal;S.car.ecuDetected=true}else{S.car.osid=cals[0]||null;S.car.ecuDetected=false}
    S.car.spec=(S.obd.protocol||"OBD-II")+(cals.length?" · Cal ID "+cals.join(", "):"")+" · "+tr.label;
    loadCarPrefs();S.found.ecu=true;S.conn="on";S.tabDirty=true;render();toast("Adapter connected");
  }catch(e){if(gen!==S.gen)return;S.conn="error";S.linkError=e.message;logLine("ERROR: "+e.message);S.tabDirty=true;render();toast("Adapter error: "+e.message)}
}

function openConnect(){
  var ser=SerialTransport.supported(),ble=BleTransport.supported(),sec=window.isSecureContext;
  var cur=S.mode==="demo"?"Demo adapter (simulated car)":S.link?S.link.label:"not connected";
  openSheet('<h2>OBD-II adapter</h2><p class="lbl">Now: <b>'+esc(cur)+'</b>'+(S.linkError?' — <span style="color:var(--red)">'+esc(S.linkError)+'</span>':'')+'</p>'+
    '<button class="opt" id="cDemo"><b>Demo car <span class="modetag">DEMO</span></b><span>No hardware needed. A simulated ELM327 answers with made-up data (codes from mock_data) so every screen can be tried.</span></button>'+
    '<button class="opt" id="cSer"'+(ser?'':' disabled')+'><b>USB adapter · Web Serial</b><span>'+(ser?'ELM327 / OBDLink (SX, EX) over USB. Chrome or Edge on a computer.':'Not available here'+(sec?'':' (needs https, localhost or a local file)')+' — use desktop Chrome or Edge.')+'</span></button>'+
    '<div class="field"><label for="cBaud">USB baud rate</label><select id="cBaud">'+[38400,115200,9600,57600,230400,500000].map(function(b){return '<option'+(b===store.get("baud",38400)?' selected':'')+'>'+b+'</option>'}).join("")+'</select></div>'+
    '<button class="opt" id="cBle"'+(ble?'':' disabled')+'><b>Bluetooth LE adapter · Web Bluetooth</b><span>'+(ble?'BLE ELM327-type dongles (tries FFF0, FFE0, Nordic UART and others). Chrome/Edge on Android, Windows, macOS, ChromeOS. Classic-Bluetooth (SPP) dongles cannot be used from a browser.':'Not available in this browser (Web Bluetooth needs Chrome/Edge; not supported on iPhone/iPad browsers).')+'</span></button>'+
    '<p class="lbl">Read-only: this app reads VIN, codes, freeze frame and live data, and can clear codes after you confirm. It never writes to the ECU.</p>'+
    '<details class="th"><summary>Adapter log</summary><pre class="log" id="alog"></pre><button class="btn" id="cLog">Download log</button></details>'+
    '<div style="display:flex;gap:10px;margin-top:12px">'+(isLive()?'<button class="btn danger" id="cOff">Disconnect</button>':'')+'<button class="ghost" id="cClose" style="margin-left:auto">Close</button></div>');
  logLine("");S.adapterLog.pop();
  $("cClose").onclick=closeSheet;$("cLog").onclick=function(){download("cartune-adapter-log.txt",S.adapterLog.join("\n"),"text/plain")};
  $("cDemo").onclick=function(){closeSheet();connectDemo()};
  $("cBaud").onchange=function(){store.set("baud",+$("cBaud").value)};
  $("cSer").onclick=function(){connectReal("serial",+$("cBaud").value).then(closeSheet,function(e){if(e&&e.name==="NotFoundError")toast("No port chosen");else{S.linkError=e.message;toast(e.message);openConnect()}})};
  $("cBle").onclick=function(){connectReal("ble").then(closeSheet,function(e){if(e&&e.name==="NotFoundError")toast("No device chosen");else{S.linkError=e.message;toast(e.message);openConnect()}})};
  if($("cOff"))$("cOff").onclick=function(){S.gen++;disconnectLink().then(function(){S.mode="none";S.conn="off";S.found={};S.tabDirty=true;closeSheet();render();toast("Disconnected")})};
}

/* ---------- header + nav ---------- */
var TABS=[["home","Tunes"],["capture","Live data"],["diag","Diagnostics"],["spec","Tune spec"]];
function renderPill(){
  var pill=$("pill"),live=isLive(),t;
  pill.className="pill "+(S.conn==="on"?"on":(S.conn==="connecting"||S.conn==="searching")?"busy":"");
  if(S.conn==="error")t="Adapter error";else if(S.conn==="off")t="Not connected";
  else if(S.conn!=="on")t=S.conn==="connecting"?"Reading car…":"Searching…";
  else t=live?(S.mode==="serial"?"USB adapter":"BLE adapter"):"Demo car";
  pill.querySelector("span").innerHTML=esc(t)+(S.mode==="demo"&&S.conn!=="off"?' <span class="modetag">DEMO</span>':'');
}
function renderNav(){var n=$("nav");n.innerHTML="";TABS.forEach(function(tb){var b=document.createElement("button");b.className="navbtn";b.textContent=tb[1];b.setAttribute("aria-current",S.tab===tb[0]?"page":"false");b.onclick=function(){if(S.tab!==tb[0]){S.tab=tb[0];store.set("tab",tb[0]);render();window.scrollTo(0,0)}};n.appendChild(b)})}
$("pill").onclick=openConnect;

/* ---------- home ---------- */
function st(ok,busy){return '<span class="st '+(ok?"ok":busy?"wait":"no")+'">'+(ok?"✓":"")+'</span>'}
function renderHome(){
  var f=S.found,car=S.car,prof=profOf(car.ecu),live=isLive();
  var title=f.vehicle?esc(car.title):'<span class="skel" style="min-width:12em;height:1.4em"></span>';
  var spec=f.vehicle?esc(car.spec):'<span class="skel"></span>';
  var backupTxt=S.backup>=100?"Stock file backed up (simulated)":S.backup>0?"Backing up stock file… "+S.backup+"%":"Stock file backup";
  var backupCell=live?'<div class="check">'+st(false)+'<span>Stock file backup: needs the wired CarTune receiver — an OBD-II adapter can’t read the ECU binary</span></div>':
    '<div class="check">'+st(S.backup>=100,S.backup>0&&S.backup<100)+'<span>'+backupTxt+(S.backup>0&&S.backup<100?'<div class="bar"><div style="width:'+S.backup+'%"></div></div>':'')+'</span></div>';
  $("hero").innerHTML='<div><h1>'+title+'</h1><p class="spec">'+spec+'</p></div>'+
    '<div><button class="link" id="editCar">Edit details</button></div>'+
    '<div class="checks">'+
      '<div class="check">'+st(f.receiver,!f.receiver&&S.conn!=="error"&&S.conn!=="off")+'<span>'+(live?"Adapter":"Receiver")+(S.mode==="demo"?' <span class="modetag">DEMO</span>':'')+'</span></div>'+
      '<div class="check">'+st(f.vin&&car.vin,f.receiver&&!f.vin)+'<span>VIN '+(f.vin?'<b>'+esc(car.vin||"not reported")+'</b>':'')+'</span></div>'+
      '<div class="check">'+st(f.ecu&&car.ecuDetected,f.vehicle&&!f.ecu)+'<span>ECU '+(f.ecu?'<b>'+esc(prof.manufacturer+" "+prof.family)+'</b>'+(car.ecuDetected?'':' (not detected — confirm in Edit details)'):'')+'</span></div>'+
      backupCell+
    '</div>'+
    (S.conn==="error"?'<div class="banner danger" style="grid-column:1/-1"><b>Adapter error:</b> '+esc(S.linkError||"")+' <button class="link" id="reconn">Choose adapter</button></div>':'')+
    (S.conn==="off"?'<div class="banner info" style="grid-column:1/-1">No adapter connected. <button class="link" id="reconn">Connect an adapter or use the demo car</button></div>':'')+
    '<div class="fitted"'+(f.ecu?'':' hidden')+'><p class="lbl">Fuel you run</p><div class="chips" id="fuelChips"></div>'+
    '<p class="lbl">Parts fitted (the app can’t see these, so tap any you have)</p><div class="chips" id="upChips"></div></div>';
  $("editCar").onclick=openEditCar;if($("reconn"))$("reconn").onclick=openConnect;
  if(f.ecu){
    var fc=$("fuelChips");(S.car.engine==="turbo_diesel"?["diesel"]:["91","95","98","E85"]).forEach(function(k){fc.appendChild(chip(k==="diesel"?"Diesel":k==="E85"?"E85":k+" petrol",S.fuel===k,function(){S.fuel=k;store.set("fuel:"+S.car.key,k);render()}))});
    var uc=$("upChips");Object.keys(UPG).forEach(function(k){uc.appendChild(chip(UPG[k],S.upgrades[k],function(){S.upgrades[k]=!S.upgrades[k];store.set("upgrades",S.upgrades);render()}))});
  }
  $("oncar").innerHTML=f.ecu?(live?'Tunes below are for planning — flashing needs the wired CarTune receiver.':'On the car now: <b>'+esc(tuneName(S.onCar))+'</b>'):'';
  var g=$("grid");g.innerHTML="";
  var onFolder=tuneInfo(S.onCar).folder;
  FL.orderedPresets().forEach(function(p){
    var b=document.createElement("button");b.className="tile";
    if(!f.ecu){b.innerHTML='<h3>'+esc(p.name)+'</h3><p class="feel">'+esc(p.feel)+'</p><span class="skel" style="margin-top:auto;width:60%"></span>';b.style.setProperty("--z","var(--line)");b.disabled=true;g.appendChild(b);return}
    var ev=R.evaluate(ctx(),tuneValues(p.id));b.style.setProperty("--z",ZC[ev.overall]);
    function dots(n){var s="";for(var i=1;i<=5;i++)s+='<span class="'+(i<=n?"f":"")+'"></span>';return '<div class="dots">'+s+'</div>'}
    var lvl=FL.presetLevel(p,S.car.engine);
    b.innerHTML='<h3>'+esc(p.name)+'</h3><p class="perm perm'+lvl+'">'+esc(FL.PERM_NAME[lvl])+'</p><p class="feel">'+esc(p.feel)+'</p>'+
      '<div class="meters"><span>Power</span>'+dots(p.power)+'<span>Economy</span>'+dots(p.economy)+'</div>'+
      '<div class="tfoot"><span class="zl"><i></i>'+ZL[ev.overall]+'</span>'+(!live&&onFolder===p.id?'<span class="tag live">On car</span>':'')+(userTunes(p.id).length?'<span class="tag mine">'+userTunes(p.id).length+' of yours</span>':'')+(p.needsPull?'<span class="tag">Needs pull log</span>':'')+'</div>'+
      '<div class="base">Base file: '+(live?"not read (needs wired receiver)":S.backup>=100?"stock read, "+new Date().toLocaleDateString("en-AU",{day:"numeric",month:"short"})+" (demo)":"saving…")+'</div>';
    b.setAttribute("aria-label",p.name+". "+p.feel+" "+ZL[ev.overall]);
    b.onclick=function(){openPreset(p.id)};g.appendChild(b);
  });
  renderMine();
  $("demoNote").innerHTML=S.mode==="demo"?'<b>Demo mode:</b> a simulated car is connected (made-up data). Tap the connection pill to use a real USB or Bluetooth OBD-II adapter.':
    isLive()?'Connected to a real adapter. Tune slots are for planning and exporting a tune spec; the browser never writes to the ECU.':'';
}
/* "Your own tunes": every user tune, with the folder it was filed in. */
function renderMine(){
  var m=$("mine");if(!m)return;var list=S.found.ecu?userTunes():[];
  if(!list.length){m.hidden=true;m.innerHTML="";return}
  m.hidden=false;m.innerHTML='<div class="banner-h"><h2>Your own tunes</h2><span>Filed automatically: permission first, then closest performance</span></div><div class="mine" id="mineList"></div>';
  var host=$("mineList");
  list.forEach(function(u){var id="u:"+u.id,ev=R.evaluate(ctx(),tuneValues(id)),fp=presetById(u.folder);
    var b=document.createElement("button");b.className="mtile";b.style.setProperty("--z",ZC[ev.overall]);
    b.innerHTML='<b>'+esc(u.name)+'</b><span class="zl"><i></i>'+ZL[ev.overall]+'</span><span class="lbl">Filed in <b>'+esc(fp.name)+'</b> · '+esc(FL.PERM_NAME[u.level])+'</span>'+(!isLive()&&S.onCar===id?'<span class="tag live">On car</span>':'');
    b.setAttribute("aria-label",u.name+", filed in "+fp.name+". "+ZL[ev.overall]);
    b.onclick=function(){openPreset(id)};host.appendChild(b)});
}
function chip(label,on,fn){var b=document.createElement("button");b.className="chip";b.textContent=label;b.setAttribute("aria-pressed",on?"true":"false");b.onclick=fn;return b}

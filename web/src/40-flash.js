/* ==========================================================================
 * Flash flow + vehicle/settings sheets. Safety gates are kept from the
 * App Preview (v5 adds permission, agreement and competition gates): car connected, stock file backed up, pull log when needed,
 * and the human must type FLASH. In DEMO mode the flash is simulated. With a
 * real OBD-II adapter the gates can never all pass (an ELM327 cannot back up
 * or write the ECU binary), so flashing stays with the wired CarTune receiver
 * (mobile FlashScreen / cartune_orchestrator.py) — no write path is added here.
 * ======================================================================== */
function openSheet(html){$("sheet").innerHTML=html;$("scrim").classList.add("open");var f=$("sheet").querySelector("button,input");f&&f.focus()}
function closeSheet(){$("scrim").classList.remove("open")}
$("scrim").onclick=function(e){if(e.target===$("scrim"))closeSheet()};
document.addEventListener("keydown",function(e){if(e.key==="Escape")closeSheet()});
var pulled={};
/* v5 gates on top of the originals: the permission level and reasons are
   shown; a Competition/off-road tune needs an extra acknowledgement; a tune
   with emissions changes needs the user agreement accepted. A pull log is
   tied to the exact values it was logged with. */
function openFlash(){
  var t=curTune(),vals=tuneValues(),ev=R.evaluate(ctx(),vals),live=isLive(),demo=S.mode==="demo";
  var rs=FL.restrictionsOf(S.car.engine,vals),lvl=t.isUser?t.u.level:Math.max(rs.level,FL.presetLevel(presetById(t.id),S.car.engine));
  var needsPull=t.needsPull||ev.counts.orange+ev.counts.red>0,pk=t.id+"|"+JSON.stringify(vals);
  var emis=tuneHasEmissions(vals),agreeOk=!emis||S.agreed;
  var ready=demo&&S.conn==="on"&&S.backup>=100,pullOk=!needsPull||pulled[pk];
  var gatesOk=function(){return ready&&pullOk&&agreeOk&&(lvl<3||($("ack3")&&$("ack3").checked))};
  openSheet('<h2>Flash '+esc(t.name)+(demo?' <span class="modetag">DEMO</span>':'')+'</h2>'+
    (demo?'<p class="lbl">Demo: this flash is simulated — nothing is written anywhere.</p>':'')+
    (live?'<div class="banner danger"><b>Not available from the browser.</b> An OBD-II adapter (ELM327/OBDLink) can read codes and live data but cannot back up or write the ECU calibration. Export the tune spec and flash through the wired CarTune receiver (mobile app Flash screen) or <span class="mono">cartune_orchestrator.py</span>, which keep the checksum, read-back and confirmation gates.</div>':'')+
    '<p class="permline"><span class="perm perm'+lvl+'">'+esc(FL.PERM_NAME[lvl])+' permission</span>'+(rs.reasons.length?' <span class="lbl">'+esc(rs.reasons.map(function(r){return r.label}).join(", "))+'</span>':'')+'</p>'+
    '<ul class="steps">'+
    '<li>'+st(S.conn==="on")+'<span>Car connected: '+esc(S.car.title)+'</span></li>'+
    '<li>'+st(ready,demo&&S.backup<100)+'<span>Stock file backed up (you can always go back)'+(live?' — needs the wired receiver':'')+'</span></li>'+
    '<li>'+st(pullOk)+'<span>'+(needsPull?(pulled[pk]?'Full-throttle pull logged and passed':'Needs a logged full-throttle pull first (knock, mixture, temperature)'):'Mild tune: no pull log needed')+'</span></li>'+
    (emis?'<li id="agRow">'+st(S.agreed)+'<span>'+(S.agreed?'User agreement accepted (emissions changes)':'Emissions changes: the user agreement must be accepted')+'</span></li>':'')+
    '</ul>'+(needsPull&&!pulled[pk]?(demo?'<button class="ghost" id="pullBtn" style="width:100%">Log a pull now (simulated)</button>':'<p class="lbl">Log a real pull with <span class="mono">cartune_orchestrator.py --capture-pull</span> (or a dyno) — the browser does not fake one.</p>'):'')+
    (emis&&!S.agreed?'<button class="ghost" id="agBtn" style="width:100%;margin-top:8px">Read the user agreement</button>':'')+
    (lvl>=3?'<label class="ack"><input type="checkbox" id="ack3"> <span>I understand this tune lifts safety systems or restrictions and is for competition and off-road use only, not public roads.</span></label>':'')+
    '<div class="field" style="margin-top:14px"><label for="confirm">Type FLASH to confirm</label><input id="confirm" autocomplete="off" autocapitalize="characters"'+(ready&&pullOk&&agreeOk&&lvl<3?'':' disabled')+'></div>'+
    '<div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="go" style="flex:1" disabled>Flash to car</button></div>');
  $("cancel").onclick=closeSheet;
  var pb=$("pullBtn");if(pb)pb.onclick=function(){pb.disabled=true;var n=0;(function tk(){n+=20;pb.textContent=n<100?"Logging pull… "+n+"%":"Checking…";if(n<100)setTimeout(tk,300);else setTimeout(function(){pulled[pk]=true;openFlash()},500)})()};
  var ab=$("agBtn");if(ab)ab.onclick=function(){openAgreement(openFlash);$("agNo").onclick=function(){openFlash()}};
  var ci=$("confirm"),a3=$("ack3");
  function upd(){ci.disabled=!(ready&&pullOk&&agreeOk&&(lvl<3||a3.checked));if(ci.disabled)ci.value="";$("go").disabled=!gatesOk()||ci.value.trim().toUpperCase()!=="FLASH"}
  if(a3)a3.onchange=upd;ci.oninput=upd;
  $("go").onclick=function(){if(!gatesOk()||ci.value.trim().toUpperCase()!=="FLASH")return;runFlash(t)};
}
function runFlash(p){
  if(S.mode!=="demo")return; /* belt and braces: only the simulated demo flash exists in the browser */
  openSheet('<h2>Flashing '+esc(p.name)+' <span class="modetag">DEMO</span></h2><p>Simulated. Keep the ignition on and the phone nearby.</p><div class="bar" style="width:100%;height:10px"><div id="fb" style="width:0%"></div></div><p id="fs" class="lbl" style="margin-top:8px">Sending to receiver…</p>');
  var n=0,stages=[[30,"Sending to receiver…"],[45,"Checksum matched"],[95,"Writing to ECU…"],[100,"Verifying…"]];
  (function t(){n+=2;$("fb").style.width=n+"%";var s=stages.find(function(x){return n<=x[0]});$("fs").textContent=s?s[1]:"";
    if(n<100)setTimeout(t,70);else setTimeout(function(){S.onCar=p.id;store.set("oncar:"+S.car.key,p.id);
      openSheet('<h2>'+esc(p.name)+' is on the (demo) car</h2><p>In a real session the receiver writes the tune and verifies it. Turn the ignition off for 10 seconds, then start the car.</p><button class="primary" id="done" style="width:100%">Done</button>');
      $("done").onclick=function(){closeSheet();render()}},400)})();
}

function openEditCar(){
  var car=S.car,prof=E.profilesForPackage(S.pkg).slice(),pkg=E.PACKAGES.find(function(x){return x.id===S.pkg})||E.PACKAGES[0];
  if(car.ecu&&!prof.some(function(p){return p.id===car.ecu})){var cp=E.ECU_PROFILES.find(function(p){return p.id===car.ecu});if(cp)prof.unshift(cp)}
  openSheet('<h2>Vehicle details</h2><p class="lbl">'+(isLive()?'Read from the car where possible. Change anything that’s wrong.':'Demo car. Change anything to try it out.')+'</p>'+
    '<button class="opt" id="ecPick"><b>Choose make &amp; model</b><span>'+CAT_ALL.length+' models: cars'+(catInPackage("truck")?', trucks':'')+(catInPackage("ag")?', tractors and earthmoving':'')+'. Package: '+esc(pkg.name)+'.</span></button>'+
    '<div class="field"><label for="ecTitle">Vehicle</label><input value="'+esc(car.title)+'" id="ecTitle"></div>'+
    '<div class="field"><label for="ecEng">Engine type</label><select id="ecEng">'+[["na_petrol","Petrol"],["turbo_petrol","Turbo petrol"],["turbo_diesel","Turbo diesel"]].map(function(o){return '<option value="'+o[0]+'"'+(o[0]===car.engine?' selected':'')+'>'+o[1]+'</option>'}).join("")+'</select></div>'+
    '<div class="field"><label for="ecEcu">ECU <small class="lbl">('+esc(pkg.name)+' package)</small></label><select id="ecEcu">'+(car.ecu?'':'<option value="" selected>Confirmed when the receiver is plugged in</option>')+prof.map(function(p){return '<option value="'+p.id+'"'+(p.id===car.ecu?' selected':'')+'>'+esc(p.manufacturer+" "+p.family)+'</option>'}).join("")+'</select></div>'+
    '<p class="lbl" style="margin-top:14px">'+(isLive()?'Switch to a demo car (disconnects the adapter)':'Demo: try a different car')+'</p><div class="chips" id="demoCars"></div>'+
    '<div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="cancel">Cancel</button><button class="primary" id="save" style="flex:1">Save</button></div>');
  var dc=$("demoCars");DEMO_CARS.forEach(function(c){dc.appendChild(chip(c.title,S.mode==="demo"&&c.key===S.car.key,function(){S.carKey=c.key;store.set("car",c.key);store.set("pickedCar",null);closeSheet();connectDemo()}))});
  $("ecPick").onclick=function(){openPicker()};
  $("cancel").onclick=closeSheet;
  $("save").onclick=function(){var eng=$("ecEng").value,engChanged=eng!==S.car.engine;S.car=Object.assign({},S.car,{title:$("ecTitle").value,engine:eng,ecu:$("ecEcu").value||null,ecuDetected:S.car.ecuDetected||isLive()});
    if(eng==="turbo_diesel")S.fuel="diesel";else if(S.fuel==="diesel")S.fuel="98";
    if(engChanged){userTunes().forEach(fileInto);saveUser()}builtKey=null;closeSheet();toast("Saved");render()};
}
$("settingsBtn").onclick=function(){
  openSheet('<h2>Settings</h2><p class="lbl">Explain things</p><div class="chips" id="sk"></div>'+
    '<p class="lbl" style="margin-top:14px">Theme</p><div class="chips" id="thm"></div>'+
    '<p class="lbl" style="margin-top:14px">Package (demo)</p><div class="chips" id="pkg"></div><p class="why" style="margin:6px 0 0">Which vehicle types and ECU families are offered: Standard (cars), Commercial (+ trucks), Heavy (+ tractors and earthmoving).</p>'+
    '<p class="lbl" style="margin-top:14px">User agreement (emissions switches)</p><p class="why" style="margin:0" id="agTxt">'+(S.agreed?'Accepted in this browser. Emissions switches can be changed; tunes with them are filed at '+esc(FL.PERM_NAME[3])+'.':'Not accepted. You’ll be asked before any emissions switch leaves its factory setting.')+'</p>'+(S.agreed?'<button class="btn danger" id="agWithdraw" style="margin-top:8px">Withdraw agreement</button>':'')+
    '<p class="lbl" style="margin-top:14px">About</p><p class="why" style="margin:0">CarTune web app. Diagnostics thresholds are general guidelines — always check the manufacturer’s specification. Data is stored only in this browser (localStorage).</p>'+
    '<div style="margin-top:14px"><button class="primary" id="ok" style="width:100%">Done</button></div>');
  var sk=$("sk");[["simple","Simply"],["standard","With detail"],["expert","Technically"]].forEach(function(o){sk.appendChild(chip(o[1],S.skill===o[0],function(){S.skill=o[0];store.set("skill",o[0]);builtKey=null;render();$("settingsBtn").onclick()}))});
  var th=$("thm"),cur=document.documentElement.getAttribute("data-theme")||"auto";[["auto","Auto (follow device)"],["night","Night (garage)"],["sun","Sun (high glare)"]].forEach(function(o){th.appendChild(chip(o[1],cur===o[0],function(){setTheme(o[0]);$("settingsBtn").onclick()}))});
  var pg=$("pkg");E.PACKAGES.forEach(function(x){pg.appendChild(chip(x.name,S.pkg===x.id,function(){S.pkg=x.id;store.set("pkg",x.id);render();$("settingsBtn").onclick()}))});
  if($("agWithdraw"))$("agWithdraw").onclick=function(){S.agreed=false;store.set("agreed",false);toast("Agreement withdrawn");render();$("settingsBtn").onclick()};
  $("ok").onclick=closeSheet};
$("flashBtn").onclick=openFlash;
$("resetBtn").onclick=function(){var t=curTune();
  if(!t.isUser){toast("Presets stay as shipped. Change anything to make your own tune.");return}
  var base=presetById(t.u.from)||presetById("factory");t.u.values=P.presetValues(base,S.car.engine);fileInto(t.u);saveUser();toast("Started again from "+base.name);render()};

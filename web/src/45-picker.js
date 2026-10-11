/* ==========================================================================
 * Vehicle picker (merged from prototype/app.template.html "finder"):
 * Type → Make → Model → Generation → Engine → Transmission, with search,
 * breadcrumbs, auto-skip of single answers and a confirm card. Uses CAT_ALL
 * (22-catalog.js + prototype/makes.js). Types follow the package: trucks need
 * Commercial, tractors/ag and earthmoving need Heavy (Settings → Package).
 * Electric models are shown but can't be picked for tuning.
 * In demo mode the picked vehicle becomes the simulated car (made-up VIN
 * starting CTDEMO); with a real adapter only the details are updated — what
 * the car reports (VIN, detected ECU) is kept.
 * ======================================================================== */
var PSTEPS=[["cat","Type"],["make","Make"],["model","Model"],["gen","Generation"],["eng","Engine"],["trans","Transmission"]];
var PK={sel:{},step:"cat",q:"",skipped:[]};
function pickList(step,sel){
  var rows=CAT_ALL.filter(function(c){return(!sel.cat||c.cat===sel.cat)&&(!sel.make||step==="make"||c.make===sel.make)&&(!sel.model||step==="make"||step==="model"||c.model===sel.model)});
  if(step==="cat")return CATS.filter(function(c){return catInPackage(c.id)}).map(function(c){var n=CAT_ALL.filter(function(x){return x.cat===c.id}).length;return{key:c.id,title:c.name,sub:c.sub,cnt:n+" models"}});
  if(step==="make"){var m={},pop=POPULAR[sel.cat]||[];rows.forEach(function(r){m[r.make]=(m[r.make]||0)+1});
    return Object.keys(m).sort(function(a,b){var ia=pop.indexOf(a),ib=pop.indexOf(b);if(ia<0)ia=99;if(ib<0)ib=99;return ia-ib||a.localeCompare(b)}).map(function(k){return{key:k,title:k,cnt:m[k]+(m[k]>1?" models":" model")}})}
  if(step==="model")return rows.slice().sort(function(a,b){return (a.generic?1:0)-(b.generic?1:0)||a.model.localeCompare(b.model)}).map(function(r){var e=[].concat.apply([],r.gens.map(function(g){return g.e}));var ok=e.filter(function(x){return x.ecu}).length;
    if(r.generic)return{key:r.model,title:r.model,sub:ok?"":"Electric",cnt:ok?"Supported":"Live data only",off:!ok};
    return{key:r.model,title:r.model,sub:r.gens.filter(function(g){return !g.other}).map(function(g){return g.g}).join(", "),cnt:ok+" engine"+(ok>1?"s":"")+" listed"}});
  var row=rows[0];if(!row)return[];
  if(step==="gen")return row.gens.map(function(g){if(g.other)return{key:g.g,title:g.g,sub:g.y,cnt:"Engine read when you plug in"};var ok=g.e.filter(function(x){return x.ecu}).length;return{key:g.g,title:g.g,sub:g.y,cnt:ok?ok+" engine"+(ok>1?"s":""):"Not supported yet",off:!ok}});
  var gen=row.gens.find(function(g){return g.g===sel.gen});if(!gen)return[];
  if(step==="eng")return gen.e.map(function(e){return{key:e.n,title:e.n,sub:(row.generic||gen.other)?"Exact engine and ECU read by the receiver":e.code+(e.kw?", "+e.kw+" kW / "+e.nm+" Nm":""),cnt:e.ecu?(profOf(e.ecu).status==="ready"?"Full tune ready":"Supported"):e.note,off:!e.ecu}});
  var eng=gen.e.find(function(e){return e.n===sel.eng});if(!eng)return[];
  if(step==="trans")return eng.trans.map(function(t){return{key:t,title:t}});
  return[];
}
function pNext(step){var i=PSTEPS.findIndex(function(s){return s[0]===step});return i<PSTEPS.length-1?PSTEPS[i+1][0]:null}
function pClearAfter(step){var i=PSTEPS.findIndex(function(s){return s[0]===step});PSTEPS.slice(i+1).forEach(function(s){delete PK.sel[s[0]]})}
function pAdvance(){var sk=[];
  while(PK.step){var list=pickList(PK.step,PK.sel),valid=list.filter(function(x){return !x.off});
    if(PK.step!=="cat"&&valid.length===1&&list.length===1){PK.sel[PK.step]=valid[0].key;sk.push(valid[0].title);PK.step=pNext(PK.step);continue}
    if(PK.step==="trans"&&list.length===0){PK.step=null;continue}
    break}
  PK.skipped=sk;return !PK.step}
function pResolve(sel){var row=CAT_ALL.find(function(c){return c.cat===sel.cat&&c.make===sel.make&&c.model===sel.model});if(!row)return null;var gen=row.gens.find(function(g){return g.g===sel.gen});var eng=gen&&gen.e.find(function(e){return e.n===sel.eng});return eng?{row:row,gen:gen,eng:eng}:null}
function openPicker(reset){if(reset!==false){PK={sel:{},step:"cat",q:"",skipped:[]}}paintPicker()}
function paintPicker(){
  if(pAdvance()){paintConfirm();return}
  var list=pickList(PK.step,PK.sel),title=PSTEPS.find(function(s){return s[0]===PK.step})[1];
  var crumbs=PSTEPS.filter(function(s){return PK.sel[s[0]]}).map(function(s){var v=PK.sel[s[0]],lab=s[0]==="cat"?CATS.find(function(c){return c.id===v}).name:v;return '<button class="crumb" data-s="'+s[0]+'" aria-label="Change '+s[1]+': '+esc(lab)+'">'+esc(lab)+'</button>'}).join("")+'<span class="crumb now">'+esc(title)+'</span>';
  var q=PK.q||"",searchable=list.length>8||PK.step==="make"||PK.step==="model";
  var locked=CATS.filter(function(c){return !catInPackage(c.id)});
  openSheet('<h2>Choose your vehicle</h2><nav class="pcrumbs" aria-label="Your choices">'+crumbs+'</nav>'+
    '<div class="pstep"><h3>'+({cat:"What are you tuning?",make:"Which make?",model:"Which model?",gen:"Which generation?",eng:"Which engine?",trans:"Which transmission?"}[PK.step])+'</h3><span class="lbl">'+list.filter(function(x){return !x.off}).length+' to choose from</span></div>'+
    (PK.skipped.length?'<p class="lbl pnote">Only one option for '+esc(PK.skipped.join(", "))+', so it’s selected.</p>':'')+
    (searchable?'<div class="field" style="margin:6px 0 10px"><label class="sr-only" for="pq">Search</label><input id="pq" type="search" placeholder="Search '+title.toLowerCase()+'s" value="'+esc(q)+'" autocomplete="off"></div>':'')+
    '<div class="ptiles" id="ptiles"></div>'+
    (PK.step==="cat"&&locked.length?'<p class="lbl" style="margin-top:12px">'+esc(locked.map(function(c){return c.name}).join(", "))+': need the '+esc(pkgNeededFor(locked[0].id).name)+' package or higher (Settings → Package).</p>':'')+
    (PK.step==="eng"||PK.step==="gen"?'<details style="margin-top:12px"><summary class="link">Not sure which one?</summary><p class="why">Plug in the receiver and CarTune reads it for you. Or check the engine code on the rocker cover or compliance plate.</p></details>':'')+
    '<div style="display:flex;gap:10px;margin-top:14px"><button class="ghost" id="pBack">'+(PSTEPS.some(function(s){return PK.sel[s[0]]})?"Back":"Cancel")+'</button></div>');
  $("pBack").onclick=function(){var i=PSTEPS.findIndex(function(s){return s[0]===PK.step});var prev=PSTEPS.slice(0,i).reverse().find(function(s){return PK.sel[s[0]]});
    if(!prev){closeSheet();return}PK.step=prev[0];pClearAfter(prev[0]);delete PK.sel[prev[0]];PK.q="";paintPicker()};
  [].forEach.call($("sheet").querySelectorAll(".crumb[data-s]"),function(b){b.onclick=function(){var s=b.dataset.s;PK.step=s;delete PK.sel[s];pClearAfter(s);PK.q="";paintPicker()}});
  function paint(){var host=$("ptiles");host.innerHTML="";var ql=(PK.q||"").toLowerCase(),shown=0;
    list.filter(function(x){return !ql||(x.title+" "+(x.sub||"")).toLowerCase().indexOf(ql)>=0}).forEach(function(x){shown++;
      var b=document.createElement("button");b.className="ptile";b.dataset.key=x.key;if(x.off)b.setAttribute("aria-disabled","true");
      b.innerHTML='<b>'+esc(x.title)+'</b>'+(x.sub?'<small>'+esc(x.sub)+'</small>':'')+(x.cnt?'<span class="cnt">'+esc(x.cnt)+'</span>':'');
      b.onclick=function(){if(x.off){toast(x.cnt||"Not supported yet");return}PK.sel[PK.step]=x.key;PK.q="";PK.step=pNext(PK.step);paintPicker();$("sheet").scrollTop=0};host.appendChild(b)});
    if(!shown)host.innerHTML='<p class="lbl">Nothing matches “'+esc(PK.q)+'”.</p>'}
  paint();
  var pq=$("pq");if(pq){pq.oninput=function(){PK.q=pq.value;paint()};if(q){pq.focus();pq.setSelectionRange(q.length,q.length)}}
}
function paintConfirm(){
  var r=pResolve(PK.sel);if(!r){openPicker();return}
  var ecu=r.eng.ecu==="detect"?null:r.eng.ecu,p=profOf(ecu),stt=STATUS[ecu?p.status:"detect"]||["Supported","yellow"];
  var other=r.row.generic||r.gen.other,live=isLive();
  openSheet('<h2>Is this your vehicle?</h2><article class="vcard" style="--z:var(--'+stt[1]+')"><h3>'+esc(r.row.make+" "+r.row.model)+'</h3><p class="lbl" style="margin:0">'+esc(r.gen.g+(r.gen.y?", "+r.gen.y:""))+'</p>'+
    '<dl class="vspec"><dt>Engine</dt><dd>'+esc(other?r.eng.n+", exact engine read when you plug in":r.eng.n+" ("+r.eng.code+")")+'</dd>'+(r.eng.kw?'<dt>Factory output</dt><dd class="mono">'+r.eng.kw+' kW / '+r.eng.nm+' Nm</dd>':'')+
    (PK.sel.trans?'<dt>Transmission</dt><dd>'+esc(PK.sel.trans)+'</dd>':'')+'<dt>ECU</dt><dd>'+esc(p.manufacturer+" "+p.family)+'</dd></dl>'+
    '<span class="zl"><i></i>'+esc(stt[0])+'</span></article>'+
    (live?'<p class="lbl">Connected to a real adapter: the VIN and any ECU the car reports are kept; this only fills in the details.</p>':'<p class="lbl">Demo: this becomes the simulated car (made-up VIN and data).</p>')+
    '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="ghost" id="pEdit">Change it</button><button class="primary" id="pYes" style="flex:1">Use this vehicle</button></div>');
  $("pEdit").onclick=function(){PK.step="make";delete PK.sel.make;pClearAfter("make");paintPicker()};
  $("pYes").onclick=function(){usePicked(r,ecu)};
}
function demoVin(seed){var A="0123456789ABCDEFGHJKLMNPRSTUVWXYZ",h=2166136261,out="";for(var i=0;i<seed.length;i++){h^=seed.charCodeAt(i);h=Math.imul(h,16777619)>>>0}
  for(var j=0;j<11;j++){out+=A[h%A.length];h=Math.imul(h^(j+7),2654435761)>>>0}return "CTDEMO"+out}
function usePicked(r,ecu){
  var title=r.row.make+" "+r.row.model+(r.row.generic||r.gen.other?"":" "+r.gen.g),eng=r.eng.eng;
  var spec=[r.row.generic||r.gen.other?r.eng.n:r.eng.n+(r.eng.code?" ("+r.eng.code+")":""),PK.sel.trans].filter(Boolean).join(" · ");
  var slug=(r.row.cat+"-"+r.row.make+"-"+r.row.model+"-"+r.gen.g+"-"+r.eng.n).toLowerCase().replace(/[^a-z0-9]+/g,"-");
  if(isLive()){
    S.car=Object.assign({},S.car,{title:title,spec:spec+(S.car.spec?" · "+S.car.spec:""),engine:eng,ecu:S.car.ecuDetected?S.car.ecu:ecu});
    S.fuel=eng==="turbo_diesel"?"diesel":(S.fuel==="diesel"?"98":S.fuel);userTunes().forEach(fileInto);saveUser();builtKey=null;closeSheet();toast("Vehicle details updated");render();return}
  var car={key:"pick:"+slug,title:title,spec:spec,engine:eng,fuel:eng==="turbo_diesel"?"diesel":"98",vin:demoVin(slug),ecu:ecu,osid:"CT"+demoVin(slug+"cal").slice(6,14),picked:true};
  store.set("pickedCar",car);S.carKey="pick";store.set("car","pick");closeSheet();S.view="home";toast(title+" picked (demo)");connectDemo();
}

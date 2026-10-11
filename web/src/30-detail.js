/* ==========================================================================
 * Tune detail, Pro tables and Pro settings — carried over from
 * mobile/scripts/app-preview.template.html (the CarTune App Preview); v5 adds
 * the new tabs, switches, "Fix it with other settings" and filing.
 * ======================================================================== */
/* ---------- detail ---------- */
/* v5: tabs come from R.segmentsFor (Fuel, Timing, Boost, Throttle, Limits,
   Transmission, Brakes & Traction, Cooling, Emissions), each tab has its
   sliders plus on/off switches, and every warning offers "Fix it with other
   settings" (RELIEF map) before "Or adjust this one". Presets stay as shipped:
   the first change saves a user tune, filed automatically (25-tunes.js). */
function openPreset(id){S.view="detail";S.preset=id;S.seg=null;S.open={};builtKey=null;history.pushState({v:"detail"},"");render();window.scrollTo(0,0)}
window.onpopstate=function(){if(S.view!=="home"){S.view="home";render()}};
var builtKey=null;
function snapR(d,nv){var r=R.rangeFor(d,S.skill);return +Math.min(r.max,Math.max(r.min,Math.round((nv-d.min)/d.step)*d.step+d.min)).toFixed(3)}
function snap(d,nv){return +Math.min(d.max,Math.max(d.min,Math.round((nv-d.min)/d.step)*d.step+d.min)).toFixed(3)}
function trackFor(d,b){var rg=R.rangeFor(d,S.skill),min=rg.min,max=rg.max,span=max-min;function p(v){return((Math.min(max,Math.max(min,v))-min)/span*100).toFixed(2)+"%"}
  var s=[],low=b.low!==undefined?Math.max(min,b.low):min;if(low>min)s.push("var(--yellow) 0%","var(--yellow) "+p(low));
  s.push("var(--green) "+p(low),"var(--green) "+p(b.g),"var(--yellow) "+p(b.g),"var(--yellow) "+p(b.y),"var(--orange) "+p(b.y),"var(--orange) "+p(b.o),"var(--red) "+p(b.o),"var(--red) 100%");
  return "linear-gradient(90deg,"+s.join(",")+")"}
function worseZone(a,b){return ORDER.indexOf(b)>ORDER.indexOf(a)?b:a}
/* A fix list: 4 shown, then "N more ways". Other settings come first. */
function fixList(title,list,key,cls){if(!list||!list.length)return"";var k="fx:"+key+":"+cls,all=S.open[k],shown=all?list:list.slice(0,4);
  return '<div class="fixes '+cls+'" data-k="'+esc(key)+'"><p class="lbl fxh">'+esc(title)+'</p>'+shown.map(function(a,i){return '<button class="fix" data-i="'+i+'">'+esc(a.text)+(a.why?'<small>'+esc(a.why)+'</small>':'')+'</button>'}).join("")+
    (list.length>4&&!all?'<button class="link morefx" data-more="'+esc(k)+'">'+(list.length-4)+' more way'+(list.length-4>1?'s':'')+'</button>':'')+'</div>'}
function bindFixes(el,lists){
  [].forEach.call(el.querySelectorAll(".fixes"),function(box){var cls=box.classList.contains("ofx")?"ofx":"afx",list=lists[cls]||[];
    [].forEach.call(box.querySelectorAll(".fix"),function(b){b.onclick=function(){var a=list[+b.dataset.i];if(a&&doAction(a.action))toast("Applied")}})});
  [].forEach.call(el.querySelectorAll(".morefx"),function(b){b.onclick=function(){S.open[b.dataset.more]=true;render()}});
}
function renderDetail(){
  var t=curTune(),vals=tuneValues(),c=ctx(),ev=R.evaluate(c,vals);
  var defs=R.settingsFor(c.engine,S.skill),tgs=R.togglesFor(c.engine,S.skill),segs=R.segmentsFor(c.engine,S.skill);
  if(!S.seg||segs.indexOf(S.seg)<0)S.seg=segs[0];
  var key=c.engine+"|"+S.seg+"|"+S.skill;
  var d=$("detail");
  if(builtKey!==key){
    d.innerHTML='<button class="back" id="back">‹ All tunes</button><div id="folder"></div><div class="dhead"><h1 id="dName"></h1><p id="dFeel"></p></div>'+
      '<div id="filed"></div>'+
      '<div class="levels" role="radiogroup" aria-label="Detail level" id="levels"></div>'+
      '<div class="summary" id="sum"></div><div id="warns" aria-live="polite"></div><div class="tabs" role="tablist" aria-label="Tune sections" id="tabs"></div><div class="cards" id="cards"></div>'+
      '<div id="swHead"></div><div class="cards" id="sws"></div>'+
      (S.skill==="expert"?'<section id="pro"></section>':'');
    var lv=$("levels");[["simple","Simply","Quick sliders"],["standard","With detail","More sliders + switches"],["expert","Technically","Open range + full tables"]].forEach(function(o){
      var b=document.createElement("button");b.className="level";b.setAttribute("role","radio");b.setAttribute("aria-checked",S.skill===o[0]?"true":"false");
      b.innerHTML='<b>'+o[1]+'</b><span>'+o[2]+'</span>';b.onclick=function(){S.skill=o[0];store.set("skill",o[0]);builtKey=null;render()};lv.appendChild(b)});
    $("back").onclick=function(){history.back()};
    var host=$("cards");
    defs.filter(function(x){return x.segment===S.seg}).forEach(function(def){
      var card=document.createElement("section");card.className="card";card.id="c-"+def.id;
      var rg=R.rangeFor(def,S.skill);
      card.innerHTML='<div class="head"><h3>'+esc(def.name)+(def.level&&def.level!=="simple"?' <small class="lvtag">'+(def.level==="expert"?"Pro":"Detail")+'</small>':'')+'</h3><span class="val"></span></div><div class="sl"><button class="step" aria-label="Decrease '+esc(def.name)+'">−</button><input type="range" aria-label="'+esc(def.name)+'" min="'+rg.min+'" max="'+rg.max+'" step="'+def.step+'"><button class="step" aria-label="Increase '+esc(def.name)+'">+</button></div>'+
        (S.skill==="expert"&&(def.proMin!==undefined||def.proMax!==undefined)?'<p class="lbl" style="margin:0">Open range: '+esc(def.format(rg.min,ctx()))+' to '+esc(def.format(rg.max,ctx()))+'</p>':'')+'<div class="dyn"></div>';
      var sb=card.querySelectorAll(".step"),inp=card.querySelector("input");
      function set(nv){var v=tuneValues(),nx=snapR(def,nv);if(nx===v[def.id])return;v[def.id]=nx;setTuneValues(v);render()}
      sb[0].onclick=function(){set(tuneValues()[def.id]-def.step)};sb[1].onclick=function(){set(tuneValues()[def.id]+def.step)};
      inp.addEventListener("input",function(){set(parseFloat(inp.value))});
      host.appendChild(card)});
    builtKey=key;
  }
  /* name, folder and filing (change as a preset becomes a user tune, or a tune moves folder) */
  $("dName").textContent=t.name;$("dFeel").textContent=t.feel;
  var inFolder=userTunes(t.folder),fp=presetById(t.folder);
  $("folder").innerHTML=inFolder.length?'<p class="lbl" style="margin:0 0 6px">In the '+esc(fp.name)+' folder</p><div class="chips folder" id="folderChips"></div>':'';
  if(inFolder.length){var fc=$("folderChips");fc.appendChild(chip(fp.name+" (preset)",!t.isUser,function(){S.preset=fp.id;render()}));
    inFolder.forEach(function(u){fc.appendChild(chip(u.name,t.id==="u:"+u.id,function(){S.preset="u:"+u.id;render()}))})}
  var plv=t.isUser?t.u.level:FL.presetLevel(fp,c.engine);
  $("filed").innerHTML=t.isUser?
    '<div class="filed" style="--z:'+(plv>=3?"var(--red)":plv===2?"var(--orange)":plv===1?"var(--yellow)":"var(--green)")+'"><b>Filed in '+esc(fp.name)+'</b> <span class="perm perm'+plv+'">'+esc(FL.PERM_NAME[plv])+' permission</span>'+
      (t.u.reasons.length?'<p>Because: '+esc(t.u.reasons.map(function(r){return r.label}).join(", "))+'</p>':'<p>No safety systems or restrictions lifted.</p>')+
      (t.u.nearest&&t.u.nearest!==t.folder?'<p class="lbl">Closest in performance: '+esc(presetById(t.u.nearest).name)+' — permission comes first.</p>':'')+
      '<div class="chips"><button class="chip" id="ren">Rename</button><button class="chip" id="del">Delete</button></div></div>':
    '<div class="filed preset"><b>Preset as shipped</b> <span class="perm perm'+plv+'">'+esc(FL.PERM_NAME[plv])+'</span><p>Change anything and it saves as your own tune, filed automatically: permission first, then closest performance.</p></div>';
  if(t.isUser){
    $("ren").onclick=function(){openSheet('<h2>Rename tune</h2><div class="field"><label for="nn">Tune name</label><input id="nn" maxlength="40" value="'+esc(t.name)+'"></div><div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="nc">Cancel</button><button class="primary" id="nok" style="flex:1">Save</button></div>');
      $("nc").onclick=closeSheet;$("nok").onclick=function(){var n=$("nn").value.trim();if(n){t.u.name=n;saveUser()}closeSheet();render()}};
    $("del").onclick=function(){openSheet('<h2>Delete '+esc(t.name)+'?</h2><p>This removes your tune from this browser. The '+esc(fp.name)+' preset is not affected.</p><div style="display:flex;gap:10px;margin-top:10px"><button class="ghost" id="dc">Cancel</button><button class="btn danger" id="dok" style="flex:1">Delete</button></div>');
      $("dc").onclick=closeSheet;$("dok").onclick=function(){delete S.user[t.u.id];if(S.onCar===t.id){S.onCar="factory";store.set("oncar:"+S.car.key,"factory")}S.preset=fp.id;saveUser();closeSheet();toast("Deleted");render()}};
  }
  var cn=ev.counts,tot=cn.green+cn.yellow+cn.orange+cn.red,sum=$("sum");sum.style.setProperty("--z",ZC[ev.overall]);
  sum.innerHTML='<div class="big"></div><div style="flex:1"><b>'+ZL[ev.overall]+'</b><span>'+cn.green+' safe · '+cn.yellow+' fine · '+cn.orange+' warning · '+cn.red+' danger — for this car, '+esc(S.fuel==="diesel"?"diesel":S.fuel+" fuel")+'</span><div class="meter">'+ORDER.map(function(z){return cn[z]?'<div style="width:'+(cn[z]/tot*100)+'%;background:'+ZC[z]+'"></div>':""}).join("")+'</div></div>';
  $("warns").innerHTML=ev.warnings.map(function(w){return '<div class="warn" style="--z:'+ZC[w.level]+'"><b>'+esc(w.title)+'</b>'+esc(w.body)+'</div>'}).join("");
  var tb=$("tabs");tb.innerHTML="";segs.forEach(function(g){var worst="green";defs.concat(tgs).forEach(function(x){if(x.segment===g&&ev.results[x.id])worst=worseZone(worst,ev.results[x.id].zone)});
    var b=document.createElement("button");b.className="tab";b.setAttribute("role","tab");b.dataset.seg=g;b.setAttribute("aria-selected",S.seg===g?"true":"false");b.style.setProperty("--z",ZC[worst]);b.innerHTML="<i></i>"+esc(g);b.onclick=function(){S.seg=g;render()};tb.appendChild(b)});
  var selTab=tb.querySelector('[aria-selected="true"]');if(selTab&&tb.scrollWidth>tb.clientWidth){var l=selTab.offsetLeft-tb.clientWidth/2+selTab.offsetWidth/2;tb.scrollLeft=Math.max(0,l)}
  defs.filter(function(x){return x.segment===S.seg}).forEach(function(def){
    var r=ev.results[def.id],v=vals[def.id],card=$("c-"+def.id);if(!card)return;
    var exp=S.open[def.id]||r.zone==="orange"||r.zone==="red",inp=card.querySelector("input");
    card.style.setProperty("--z",ZC[r.zone]);card.querySelector(".val").textContent=def.format(v,c);
    if(document.activeElement!==inp||String(inp.value)!==String(v))inp.value=v;
    inp.style.setProperty("--track",trackFor(def,r.bands));inp.setAttribute("aria-valuetext",def.format(v,c)+", "+ZL[r.zone]);
    var dyn=card.querySelector(".dyn");
    dyn.innerHTML='<span class="badge">'+ZL[r.zone]+'</span><p>'+esc(r.effect)+'</p><p>'+esc(r.headline)+'</p>'+(r.why?'<p class="why">'+esc(r.why)+'</p>':'')+
      fixList("Fix it with other settings",r.otherFixes,def.id,"ofx")+fixList("Or adjust this one",r.advice,def.id,"afx")+
      '<button class="link more">'+(exp?"Less":"What does this do?")+'</button>'+(exp?'<p class="why">'+esc(c.skill==="expert"?def.what.expert:def.what.simple)+'</p>'+(r.risks?'<div class="risk"><b>What can go wrong</b><p>'+esc(r.risks)+'</p></div>':''):'');
    bindFixes(dyn,{ofx:r.otherFixes,afx:r.advice});
    dyn.querySelector(".more").onclick=function(){S.open[def.id]=!exp;render()};
  });
  /* on/off switches for this tab (rebuilt each time; they hold no focus-sensitive input) */
  var sws=tgs.filter(function(x){return x.segment===S.seg}),sh=$("swHead"),sw=$("sws");
  sh.innerHTML=sws.length?'<h3 class="swh">On and off</h3>':'';
  var focusSw=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.sw:null;
  sw.innerHTML="";sws.forEach(function(tg){sw.appendChild(switchCard(tg,vals,ev,c))});
  if(focusSw){var f=sw.querySelector('[data-sw="'+focusSw+'"]');if(f)f.focus()}
  if(S.skill==="expert")renderPro(t);
  $("dockNote").textContent=S.onCar===t.id?"This tune is on the car":(t.isUser?"Saved in this browser":"Preset as shipped");
  $("resetBtn").textContent=t.isUser?"Start again":"Reset";
  $("flashBtn").textContent="Flash "+t.name;
}
/* A switch card. Red switches (e.g. stability control, ABS) sit under a lift
   cover while they are at the factory setting. Emissions switches need the
   user agreement (doAction → openAgreement) before they leave stock. */
function switchCard(tg,vals,ev,c){
  var r=ev.results[tg.id],on=R.isOn(tg,vals),changed=on!==tg.stock,guarded=tg.zone==="red"&&!changed&&!S.guard[tg.id];
  var card=document.createElement("section");card.className="card swcard";card.id="c-"+tg.id;card.style.setProperty("--z",ZC[r.zone]);
  card.innerHTML='<div class="head"><h3>'+esc(tg.name)+(tg.agreement?' <small class="lvtag agr">Agreement</small>':'')+(tg.level&&tg.level!=="simple"?' <small class="lvtag">'+(tg.level==="expert"?"Pro":"Detail")+'</small>':'')+'</h3>'+
    '<span class="swwrap">'+(guarded?'<button class="cover" data-cover="'+tg.id+'" aria-label="Lift the cover to change '+esc(tg.name)+'">Lift cover</button>':'')+
    '<button class="sw" role="switch" data-sw="'+tg.id+'" aria-checked="'+on+'" aria-label="'+esc(tg.name)+'"'+(guarded?' disabled':'')+'><span class="knob"></span><span class="swt">'+(on?"On":"Off")+'</span></button></span></div>'+
    '<span class="badge">'+ZL[r.zone]+'</span><p class="swstate"><b>'+(on?"On":"Off")+'</b>'+(changed?', changed from factory':', factory setting')+'</p>'+(changed?'<p>'+esc(r.headline)+'</p>':'')+(r.why&&changed?'<p class="why">'+esc(r.why)+'</p>':'')+
    (r.risks?'<div class="risk"><b>What can go wrong</b><p>'+esc(r.risks)+'</p></div>':'')+
    fixList("Other settings that cover it",r.otherFixes,tg.id,"ofx")+fixList("Or undo it",r.advice,tg.id,"afx")+
    '<p class="why">'+esc(c.skill==="expert"?tg.what.expert:tg.what.simple)+(tg.agreement?' Needs the user agreement (off-road, competition and export use).':'')+'</p>';
  var cv=card.querySelector(".cover");if(cv)cv.onclick=function(){S.guard[tg.id]=true;render();toast("Cover lifted");var b=document.querySelector('[data-sw="'+tg.id+'"]');if(b)b.focus()};
  card.querySelector(".sw").onclick=function(){if(guarded)return;doAction({kind:"toggle",id:tg.id,value:!on})};
  bindFixes(card,{ofx:r.otherFixes,afx:r.advice});
  return card;
}


/* ---------- pro table editor (Technically level) ---------- */
var PRO={cat:null,table:null,sel:null,anchor:null,range:false,diff:true,undo:[],q:""};
function tblKey(pid){return "tables:"+S.car.key+":"+pid}
function tblStore(pid){if(!S.tables)S.tables={};if(!S.tables[pid])S.tables[pid]=store.get(tblKey(pid),{});return S.tables[pid]}
function baseGrid(t){return T.demoData(t)}
function gridFor(pid,t){var st=tblStore(pid);return st[t.id]||baseGrid(t)}
function saveGrid(pid,t,g){var st=tblStore(pid);st[t.id]=g;store.set(tblKey(pid),st)}
function stepFor(t){return t.decimals===0?(t.max-t.min>500?10:1):t.decimals===1?0.5:Math.pow(10,-t.decimals)*(t.decimals>=3?5:1)}
function fmtN(t,v){return Number(v).toFixed(t.decimals)}
function heat(t,v,lo,hi){var f=hi===lo?.5:(v-lo)/(hi-lo);var h=220-200*f;return "hsl("+h.toFixed(0)+" 55% "+(38+10*(1-Math.abs(f-.5)*2)).toFixed(0)+"%)"}
function renderPro(p){
  var host=$("pro");if(!host)return;
  var tables=T.tablesFor(S.car.ecu,S.car.engine!=="na_petrol");
  if(!tables.length){
    var prof=profOf(S.car.ecu);
    host.innerHTML='<h2>Pro tables</h2><div class="card"><p><b>'+esc(prof.manufacturer+" "+prof.family)+'</b> table map isn’t loaded yet.</p><p class="why">Full tables appear for each ECU family once its definition is added. The Ford Barra (Spanish Oak) map is built from your HP Tuners file.</p><button class="fix" id="toBarra">Open the Barra demo car</button></div>';
    $("toBarra").onclick=function(){S.carKey="fg";store.set("car","fg");S.view="home";history.back();connectDemo()};return}
  var cats=[];tables.forEach(function(t){if(cats.indexOf(t.category)<0)cats.push(t.category)});
  if(!PRO.cat||cats.indexOf(PRO.cat)<0)PRO.cat=cats[0];
  var list=tables.filter(function(t){return PRO.q?(t.name+" "+t.category).toLowerCase().indexOf(PRO.q.toLowerCase())>=0:t.category===PRO.cat});
  if(!PRO.table||!tables.some(function(t){return t.id===PRO.table}))PRO.table=list[0]&&list[0].id;
  var t=tables.find(function(x){return x.id===PRO.table});
  var all={};tables.forEach(function(x){all[x.id]=gridFor(p.id,x)});
  var g=all[t.id],base=baseGrid(t),flags=T.checkTable(t,g,{all:all,turbo:S.car.engine!=="na_petrol"});
  var flat=[].concat.apply([],g),lo=Math.min.apply(null,flat),hi=Math.max.apply(null,flat);
  var edited=T.diffCount(g,base),flagCount=[].concat.apply([],flags).filter(Boolean).length;
  var focusSearch=document.activeElement&&document.activeElement.id==="proSearch";
  var h='<h2>Pro tables <small class="lbl" style="font-family:Barlow">'+tables.length+' tables · '+esc(profOf(S.car.ecu).family)+'</small></h2>'+
    '<div class="probar"><input id="proSearch" type="search" placeholder="Search tables" value="'+esc(PRO.q)+'"><div class="chips" id="proCats"></div></div>'+
    '<div class="prolayout"><nav class="tlist" id="tlist"></nav><div class="teditor">'+
    '<div class="thead"><div><h3>'+esc(t.name)+'</h3><p class="lbl" style="margin:2px 0">'+esc(t.unit)+(t.rows?' · rows: '+esc(t.rows.name)+(t.rows.unit?' ('+esc(t.rows.unit)+')':''):'')+(t.cols?' · columns: '+esc(t.cols.name):'')+'</p></div>'+
    '<div class="tbadges">'+(t.provenance==="file"?'<span class="tag live">From your file</span>':'<span class="tag">Platform table · confirm vs your file</span>')+(t.realData||t.realValue!==undefined?'<span class="tag live">Real values</span>':'<span class="tag demo">Demo values</span>')+(t.hpId?'<span class="tag">HPT #'+t.hpId+'</span>':'')+'</div></div>'+
    (t.note?'<p class="why" style="margin:4px 0 8px">'+esc(t.note)+'</p>':'')+
    '<div class="toolbar" id="tools"></div>'+
    '<div class="gridwrap"><table class="tgrid" id="tgrid"></table></div>'+
    '<p class="lbl" id="tinfo"></p></div></div>';
  host.innerHTML=h;
  var ps=$("proSearch");ps.oninput=function(){PRO.q=ps.value;PRO.table=null;renderPro(p)};if(focusSearch){ps.focus();ps.setSelectionRange(ps.value.length,ps.value.length)}
  var pc=$("proCats");cats.forEach(function(cn){pc.appendChild(chip(cn,!PRO.q&&PRO.cat===cn,function(){PRO.q="";PRO.cat=cn;PRO.table=null;PRO.sel=null;renderPro(p)}))});
  var tl=$("tlist");list.forEach(function(x){var b=document.createElement("button");b.className="titem";b.setAttribute("aria-current",x.id===t.id?"true":"false");
    var xd=T.diffCount(gridFor(p.id,x),baseGrid(x));b.innerHTML='<span>'+esc(x.name)+'</span><small>'+(x.realData?"● real, from your file":"platform · demo")+(xd?' · '+xd+' edited':'')+'</small>';
    b.onclick=function(){PRO.table=x.id;PRO.sel=null;PRO.undo=[];renderPro(p)};tl.appendChild(b)});
  // toolbar
  var tools=$("tools"),st=stepFor(t);
  function op(label,title,fn,needSel){var b=document.createElement("button");b.className="tool";b.textContent=label;b.title=title;b.setAttribute("aria-label",title);
    b.disabled=needSel!==false&&!PRO.sel;b.onclick=function(){var ng=fn();if(ng){PRO.undo.push(g);saveGrid(p.id,t,ng);render()}};tools.appendChild(b)}
  op("−"+st,"Subtract "+st,function(){return T.addSel(t,g,PRO.sel,-st)});
  op("+"+st,"Add "+st,function(){return T.addSel(t,g,PRO.sel,st)});
  op("−1%","Scale down 1%",function(){return T.scaleSel(t,g,PRO.sel,-1)});
  op("+1%","Scale up 1%",function(){return T.scaleSel(t,g,PRO.sel,1)});
  op("Set…","Set value",function(){var v=prompt("Set selected cells to ("+t.unit+")");if(v===null||v===""||isNaN(+v))return null;return T.setSel(t,g,PRO.sel,+v)});
  op("Smooth","Smooth selection",function(){return T.smoothSel(t,g,PRO.sel)});
  op("Interpolate","Interpolate between corners",function(){return T.interpolateSel(t,g,PRO.sel)});
  op("Copy","Copy selection",function(){var s=PRO.sel,r0=Math.min(s.r0,s.r1),r1=Math.max(s.r0,s.r1),c0=Math.min(s.c0,s.c1),c1=Math.max(s.c0,s.c1),out=[];
    for(var r=r0;r<=r1;r++)out.push(g[r].slice(c0,c1+1).join("\t"));try{navigator.clipboard.writeText(out.join("\n"));toast("Copied")}catch(e){toast("Copy not available")}return null});
  op("Paste","Paste from spreadsheet",function(){try{navigator.clipboard.readText().then(function(txt){var s=PRO.sel,r0=Math.min(s.r0,s.r1),c0=Math.min(s.c0,s.c1),rows=txt.trim().split(/\r?\n/).map(function(l){return l.split(/\t|,/).map(Number)});
      var ng=g.map(function(row,r){return row.map(function(v,c){var x=rows[r-r0]&&rows[r-r0][c-c0];return x!==undefined&&!isNaN(x)?+Math.min(t.max,Math.max(t.min,x)).toFixed(t.decimals):v})});PRO.undo.push(g);saveGrid(p.id,t,ng);render();toast("Pasted")})}catch(e){toast("Paste not available")}return null});
  op("Undo","Undo",function(){return PRO.undo.length?PRO.undo.pop():null},false);
  tools.lastChild.onclick=function(){if(PRO.undo.length){saveGrid(p.id,t,PRO.undo.pop());render()}};tools.lastChild.disabled=!PRO.undo.length;
  op("Revert","Revert table to base file",function(){return base},false);
  var rb=document.createElement("button");rb.className="tool"+(PRO.range?" on":"");rb.textContent="Range select";rb.setAttribute("aria-pressed",PRO.range?"true":"false");rb.onclick=function(){PRO.range=!PRO.range;PRO.anchor=PRO.range&&PRO.sel?{r:PRO.sel.r0,c:PRO.sel.c0}:null;renderPro(p)};tools.appendChild(rb);
  var db=document.createElement("button");db.className="tool"+(PRO.diff?" on":"");db.textContent="Show changes";db.setAttribute("aria-pressed",PRO.diff?"true":"false");db.onclick=function(){PRO.diff=!PRO.diff;renderPro(p)};tools.appendChild(db);
  // grid
  var tg=$("tgrid"),html="";
  if(t.cols){html+='<thead><tr><th class="corner">'+esc(t.rows?t.rows.unit||t.rows.name:"")+' \\ '+esc(t.cols.unit||t.cols.name)+'</th>'+t.cols.values.map(function(v){return '<th>'+v+'</th>'}).join("")+'</tr></thead>'}
  html+='<tbody>'+g.map(function(row,r){return '<tr>'+(t.rows?'<th>'+t.rows.values[r]+'</th>':'<th>'+esc(t.unit)+'</th>')+row.map(function(v,c){
    var sel=PRO.sel&&r>=Math.min(PRO.sel.r0,PRO.sel.r1)&&r<=Math.max(PRO.sel.r0,PRO.sel.r1)&&c>=Math.min(PRO.sel.c0,PRO.sel.c1)&&c<=Math.max(PRO.sel.c0,PRO.sel.c1);
    var f=flags[r][c],ch=PRO.diff&&v!==base[r][c];
    return '<td data-r="'+r+'" data-c="'+c+'" tabindex="-1" class="'+(sel?"sel ":"")+(ch?"chg ":"")+(f?"f-"+f.level:"")+'" style="background:'+heat(t,v,lo,hi)+'"'+(f?' title="'+esc(f.note)+'"':'')+'>'+fmtN(t,v)+'</td>'}).join("")+'</tr>'}).join("")+'</tbody>';
  tg.innerHTML=html;
  tg.onclick=function(e){var td=e.target.closest("td");if(!td)return;var r=+td.dataset.r,c=+td.dataset.c;
    if(PRO.range&&PRO.anchor){PRO.sel={r0:PRO.anchor.r,c0:PRO.anchor.c,r1:r,c1:c};PRO.anchor=null}else{PRO.sel={r0:r,c0:c,r1:r,c1:c};PRO.anchor=PRO.range?{r:r,c:c}:null}renderPro(p)};
  // drag-select with mouse/pen
  var drag=null;tg.onpointerdown=function(e){var td=e.target.closest("td");if(!td||e.pointerType==="touch"||PRO.range)return;drag={r:+td.dataset.r,c:+td.dataset.c,moved:false}};
  tg.onpointerover=function(e){if(!drag)return;var td=e.target.closest("td");if(!td)return;var r=+td.dataset.r,c=+td.dataset.c;if(r===drag.r&&c===drag.c&&!drag.moved)return;
    drag.moved=true;var s={r0:drag.r,c0:drag.c,r1:r,c1:c};
    [].forEach.call(tg.querySelectorAll("td"),function(x){var rr=+x.dataset.r,cc=+x.dataset.c;x.classList.toggle("sel",rr>=Math.min(s.r0,s.r1)&&rr<=Math.max(s.r0,s.r1)&&cc>=Math.min(s.c0,s.c1)&&cc<=Math.max(s.c0,s.c1))});drag.sel=s};
  window.onpointerup=function(){if(drag&&drag.moved&&drag.sel){PRO.sel=drag.sel;PRO.anchor=null;drag=null;setTimeout(function(){renderPro(p)},0)}else drag=null};
  tg.addEventListener("click",function(e){if(e.detail===0)return;},true);
  var info=$("tinfo"),selTxt="";
  if(PRO.sel){var s=PRO.sel,n=(Math.abs(s.r1-s.r0)+1)*(Math.abs(s.c1-s.c0)+1),fv=flags[s.r0][s.c0];selTxt=n+" cell"+(n>1?"s":"")+" selected"+(n===1?": "+fmtN(t,g[s.r0][s.c0])+" "+t.unit+" (base "+fmtN(t,base[s.r0][s.c0])+")":"")+(fv?" — "+fv.note:"")+". "}
  renderSettings(p);
  info.textContent=selTxt+(edited?edited+" cells changed from base. ":"Matches base file. ")+(flagCount?flagCount+" cells flagged.":"")+(PRO.range?(PRO.anchor?" Tap the opposite corner.":" Range select on: tap a corner, then the opposite corner."):" Tip: drag across cells, or turn on Range select.");
}


var PS={q:"",open:{}};
function setKey(pid){return "settings:"+S.car.key+":"+pid}
function renderSettings(p){
  var list=T.settingsListFor(S.car.ecu);var host=$("proSettings");
  if(!host){host=document.createElement("section");host.id="proSettings";$("pro").appendChild(host)}
  if(!list.length){host.innerHTML="";return}
  var edits=store.get(setKey(p.id),{}),focusId=document.activeElement&&document.activeElement.dataset?document.activeElement.dataset.sid:null;
  var q=PS.q.toLowerCase(),groups={};list.forEach(function(it,i){if(q&&(it.name+" "+it.group).toLowerCase().indexOf(q)<0)return;(groups[it.group]=groups[it.group]||[]).push([it,i])});
  var changed=Object.keys(edits).length;
  var h='<h2>Settings <small class="lbl" style="font-family:Barlow">'+list.length+' values read from your file'+(changed?' · '+changed+' changed':'')+'</small></h2>'+
    '<input id="setSearch" class="setsearch" type="search" placeholder="Search settings (e.g. rev, fan, DFCO, wastegate)" value="'+esc(PS.q)+'">';
  Object.keys(groups).sort().forEach(function(g){var open=q||PS.open[g];
    h+='<details class="sgroup"'+(open?' open':'')+' data-g="'+esc(g)+'"><summary><b>'+esc(g)+'</b><span>'+groups[g].length+'</span></summary><div class="srows">'+
    groups[g].map(function(x){var it=x[0],i=x[1],v=edits[i]!==undefined?edits[i]:it.value,num=typeof it.value==="number",ch=edits[i]!==undefined;
      return '<label class="srow'+(ch?' chg':'')+'"><span class="sname">'+esc(it.name)+(ch?'<small>file: '+esc(it.value)+'</small>':'')+'</span>'+
        (num?'<input data-sid="'+i+'" inputmode="decimal" value="'+esc(v)+'">':'<select data-sid="'+i+'">'+["Enabled","Disabled","Enable","Disable","Fitted","Single",String(it.value)].filter(function(o,j,a){return a.indexOf(o)===j&&(o===String(it.value)||/abled|able$|Fitted/.test(String(it.value)))}).map(function(o){return '<option'+(o===String(v)?' selected':'')+'>'+esc(o)+'</option>'}).join("")+'</select>')+
        '<span class="sunit">'+esc(it.unit)+'</span></label>'}).join("")+'</div></details>'});
  host.innerHTML=h;
  var ss=$("setSearch");ss.oninput=function(){PS.q=ss.value;renderSettings(p);var n=$("setSearch");n.focus();n.setSelectionRange(n.value.length,n.value.length)};
  [].forEach.call(host.querySelectorAll("details"),function(d){d.ontoggle=function(){PS.open[d.dataset.g]=d.open}});
  [].forEach.call(host.querySelectorAll("[data-sid]"),function(el){el.onchange=function(){var i=+el.dataset.sid,it=list[i],e=store.get(setKey(p.id),{});
    var nv=typeof it.value==="number"?parseFloat(el.value):el.value;if(typeof it.value==="number"&&isNaN(nv)){toast("Enter a number");return}
    if(nv===it.value)delete e[i];else e[i]=nv;store.set(setKey(p.id),e);toast("Saved");renderSettings(p)}});
}

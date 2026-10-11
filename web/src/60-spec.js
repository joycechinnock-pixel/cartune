/* ==========================================================================
 * Tune spec tab — browser version of mobile TuneSpecScreen.tsx: pick a
 * build-sheet profile, adjust fields, see the diff vs Factory Standard and
 * export tune_spec.json via buildTuneSpec() (same shape as the Map Input
 * Console and the mobile app, accepted by cartune_orchestrator.py --tune-spec).
 * ======================================================================== */
var SPEC=store.get("spec",null)||{profile:"Factory Standard",values:Object.assign({},PR.PROFILES["Factory Standard"].v)};
function renderSpec(){
  var h=$("spec"),base=PR.PROFILES["Factory Standard"].v,v=SPEC.values;
  var diff=PR.FIELDS.filter(function(f){return String(v[f.key])!==String(base[f.key])&&f.key!=="power_stage"});
  var needsLog=!PR.DAY_USE_OR_BELOW.has(String(v.power_stage));
  var segs=[];PR.FIELDS.forEach(function(f){if(segs.indexOf(f.segment)<0)segs.push(f.segment)});
  h.innerHTML='<h2>Tune spec <small class="lbl" style="font-family:Barlow">advanced</small></h2>'+
    '<div class="panel"><p class="lbl">Profile</p><div class="chips" id="specProf"></div>'+
    (needsLog?'<div class="banner">\''+esc(v.power_stage)+'\' is beyond Day Use. A logged full-throttle pull (knock / AFR / coolant) is required — cartune_orchestrator.py’s Validator won’t approve a flash for this spec without a matching --dyno-log or --pid-log.</div>':'')+
    '</div>'+segs.map(function(sg){return '<details class="sgroup"'+(sg==="Overview"?' open':'')+'><summary><b>'+esc(sg)+'</b><span>'+PR.FIELDS.filter(function(f){return f.segment===sg}).length+'</span></summary><div class="srows">'+
      PR.FIELDS.filter(function(f){return f.segment===sg}).map(function(f){var val=v[f.key],ch=String(val)!==String(base[f.key]);
        return '<label class="srow'+(ch?' chg':'')+'"><span class="sname">'+esc(f.label)+(ch?'<small>factory: '+esc(base[f.key])+'</small>':'')+'</span>'+
          (f.type==="select"?'<select data-fk="'+esc(f.key)+'">'+f.options.map(function(o){return '<option'+(String(o)===String(val)?' selected':'')+'>'+esc(o)+'</option>'}).join("")+'</select>':'<input data-fk="'+esc(f.key)+'" inputmode="decimal" value="'+esc(val)+'">')+
          '<span class="sunit"></span></label>'}).join("")+'</div></details>'}).join("")+
    '<div class="panel"><h3>Diff vs. Factory Standard</h3>'+(diff.length?'<table class="data">'+diff.map(function(f){return '<tr><td><span class="lbl">'+esc(f.segment)+'</span><br><b>'+esc(f.label)+'</b></td><td>'+esc(base[f.key])+' → <b>'+esc(v[f.key])+'</b></td></tr>'}).join("")+'</table>':'<p class="why">No changes vs. Factory.</p>')+
    '<div class="row"><button class="btn pri" id="specExp">Export tune_spec.json</button><span class="lbl">A specification of intended changes, not a flashable file.</span></div></div>';
  var pc=$("specProf");Object.keys(PR.PROFILES).forEach(function(n){pc.appendChild(chip(n,SPEC.profile===n,function(){SPEC={profile:n,values:Object.assign({},PR.PROFILES[n].v)};store.set("spec",SPEC);renderSpec()}))});
  [].forEach.call(h.querySelectorAll("[data-fk]"),function(el){el.onchange=function(){var f=PR.FIELDS.find(function(x){return x.key===el.dataset.fk});var nv=f.type==="number"?parseFloat(el.value):el.value;
    if(f.type==="number"&&isNaN(nv)){toast("Enter a number");return}SPEC.values[f.key]=nv;if(SPEC.profile.indexOf("(edited)")<0)SPEC.profile=SPEC.profile+" (edited)";store.set("spec",SPEC);renderSpec()}});
  $("specExp").onclick=function(){var spec=TSPEC.buildTuneSpec(SPEC.values,SPEC.profile);spec.generated_by="CarTune Web App";download("tune_spec.json",JSON.stringify(spec,null,2));toast("Exported tune_spec.json")};
}

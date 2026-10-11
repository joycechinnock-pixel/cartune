/* ==========================================================================
 * Presets and user tunes (merged from the 2026-09-26/27 source):
 *   - presets stay as shipped, shown in FL.PRESET_ORDER (permission tier,
 *     then power);
 *   - the first change to a preset saves it as the user's own tune
 *     ("My Sport 1"), which is filed automatically by mobile/src/tune/filing.ts:
 *     permission first (anything that lifts a safety system or restriction
 *     needs a preset with that permission), then closest performance;
 *   - every change re-files it, and a move is announced.
 * S.preset is a preset id ("sport") or a user tune ("u:<id>"). User tunes are
 * stored per car in this browser (localStorage "cartune:user:<car>").
 * Older builds kept edited presets as "slots:<car>"; those are migrated once.
 * ======================================================================== */
var FL = requireMod("./tune/filing");
S.user={};S.pkg=store.get("pkg","standard");S.agreed=!!store.get("agreed",false);S.guard={};
function presetById(id){return P.PRESETS.find(function(x){return x.id===id})}
function userKey(){return "user:"+S.car.key}
function saveUser(){store.set(userKey(),S.user)}
function fileInto(u){
  var f=FL.fileTune(S.car.engine,Object.assign({},R.stockValues(S.car.engine),u.values)),moved=!!u.folder&&u.folder!==f.presetId;
  u.folder=f.presetId;u.level=f.level;u.reasons=f.reasons;u.nearest=f.nearestByPerformance;return moved}
function loadUserTunes(){
  var u=store.get(userKey(),null);
  if(!u){u={};var old=store.get(slotKey(),{}),n=0;
    Object.keys(old).forEach(function(pid){var p=presetById(pid);if(!p||!old[pid])return;
      var t={id:"m"+(++n)+"-"+pid,name:"My "+p.name+" 1",from:pid,created:n,values:Object.assign({},R.stockValues(S.car.engine),old[pid])};
      u[t.id]=t});
    S.user=u;Object.keys(u).forEach(function(k){fileInto(u[k])});if(n)saveUser();return}
  S.user=u;
}
function userTunes(folder){return Object.keys(S.user).map(function(k){return S.user[k]}).filter(function(u){return !folder||u.folder===folder}).sort(function(a,b){return (a.created||0)-(b.created||0)})}
function tuneInfo(id){
  if(id&&String(id).indexOf("u:")===0){var u=S.user[id.slice(2)];
    if(u){var fp=presetById(u.folder)||presetById("factory"),bp=presetById(u.from)||fp;
      return{id:id,name:u.name,feel:"Your tune, based on "+bp.name+". Filed in "+fp.name+".",isUser:true,u:u,folder:fp.id,needsPull:!!(bp.needsPull||fp.needsPull)}}}
  var p=presetById(id)||presetById("factory");
  return{id:p.id,name:p.name,feel:p.feel,isUser:false,folder:p.id,power:p.power,economy:p.economy,needsPull:!!p.needsPull}}
function curTune(){var t=tuneInfo(S.preset);if(!t.isUser)S.preset=t.id;return t}
function tuneValues(id){var t=tuneInfo(id===undefined?S.preset:id);
  if(t.isUser)return Object.assign({},R.stockValues(S.car.engine),t.u.values);
  return P.presetValues(presetById(t.id),S.car.engine)}
/* Compatibility for older helpers (spec export etc.). */
function slotValues(id){return tuneValues(id)}
function isEdited(id){return userTunes(id).length>0}
function tuneName(id){return tuneInfo(id).name}
/* Save a change. A preset becomes a new user tune; a user tune is re-filed. */
function setTuneValues(vals){
  var t=curTune();
  if(!t.isUser){
    var n=1;while(userTunes().some(function(u){return u.name==="My "+t.name+" "+n}))n++;
    var id=String(Date.now())+Math.floor(Math.random()*1000);
    var u={id:id,name:"My "+t.name+" "+n,from:t.id,created:Date.now(),values:vals};fileInto(u);S.user[id]=u;S.preset="u:"+id;saveUser();
    toast("Saved as "+u.name+", filed in "+presetById(u.folder).name);return}
  t.u.values=vals;var moved=fileInto(t.u);saveUser();
  if(moved)toast("Moved to the "+presetById(t.u.folder).name+" folder ("+FL.PERM_NAME[t.u.level]+")");
}
/* Apply a suggestion ("Fix it with other settings" / "Or adjust this one").
   Emissions switches need the user agreement before they move away from stock. */
function doAction(a){
  if(a.kind==="toggle"){var tg=R.TOGGLES.find(function(x){return x.id===a.id});
    if(tg&&tg.agreement&&(a.value?1:0)!==(tg.stock?1:0)&&!S.agreed){openAgreement(function(){doAction(a)});return false}}
  var res=R.applyAction(ctx(),tuneValues(),a);
  S.fuel=res.ctx.fuel;S.upgrades=res.ctx.upgrades;store.set("upgrades",S.upgrades);store.set("fuel:"+S.car.key,S.fuel);
  setTuneValues(res.values);render();return true;
}
function openAgreement(then){
  openSheet('<h2>User agreement</h2><div class="banner danger" style="margin:0 0 12px"><b>Emissions-system changes</b></div>'+
    '<p>Emissions-system changes are for off-road, competition and export use only. You’re responsible for how and where the vehicle is used and for the matching hardware work. A tune with these changes is filed at <b>'+esc(FL.PERM_NAME[3])+'</b> permission.</p>'+
    '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="ghost" id="agNo">Cancel</button><button class="primary" id="agYes" style="flex:1">I accept</button></div>');
  $("agNo").onclick=function(){closeSheet();toast("Not changed")};
  $("agYes").onclick=function(){S.agreed=true;store.set("agreed",true);closeSheet();then&&then()};
}
function tuneHasEmissions(vals){var st=R.stockValues(S.car.engine);return R.togglesFor(S.car.engine,"expert").some(function(t){return t.agreement&&R.isOn(t,vals)!==R.isOn(t,st)})}

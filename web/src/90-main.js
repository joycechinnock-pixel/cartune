/* ==========================================================================
 * Render loop + start-up. Tab pages (Live data / Diagnostics / Tune spec)
 * rebuild only when shown or when the connection changes, so background
 * connection updates never steal focus from an input you are typing in.
 * ======================================================================== */
function renderTab(){if(S.tab==="capture")renderCapture();else if(S.tab==="diag")renderDiag();else if(S.tab==="spec")renderSpec()}
function render(){
  var detail=S.view==="detail";
  $("nav").hidden=detail;
  ["home","capture","diag","spec"].forEach(function(id){$(id).hidden=detail||S.tab!==id});
  $("detail").hidden=!detail;$("dock").hidden=!detail;
  renderPill();renderNav();
  if(detail){renderDetail();S.renderedTab=null;return}
  if(S.tab==="home"){renderHome();S.renderedTab="home";return}
  if(S.renderedTab!==S.tab||S.tabDirty){S.renderedTab=S.tab;S.tabDirty=false;renderTab()}
}
(function start(){
  var th=store.get("theme","auto");if(th!=="auto")document.documentElement.setAttribute("data-theme",th);
  if(!TABS.some(function(t){return t[0]===S.tab}))S.tab="home";
  /* PWA bits only when served over http(s): manifest + offline cache (sw.js). A file:// open works without them. */
  if(/^https?:$/.test(location.protocol)){
    try{var l=document.createElement("link");l.rel="manifest";l.href="manifest.webmanifest";document.head.appendChild(l)}catch(e){}
    if("serviceWorker" in navigator&&window.CARTUNE_SW!==false)navigator.serviceWorker.register("sw.js").catch(function(){});
  }
  window.addEventListener("beforeunload",function(e){if(S.live&&S.live.running&&S.live.rows.length){e.preventDefault();e.returnValue=""}});
  connectDemo();
})();

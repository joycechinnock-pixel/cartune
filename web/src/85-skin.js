/* ==========================================================================
 * CarTune Street Kit skin helpers — Night / Sun theme toggle only (UI; no
 * connection, diagnostics or ECU logic lives here). Night = garage / low
 * light (default), Sun = high-glare daylight. "Auto" follows the device.
 * Older builds stored "dark" / "light"; those map to night / sun.
 * ======================================================================== */
(function(){
  var legacy={dark:"night",light:"sun"},t=store.get("theme","auto");
  if(legacy[t]){t=legacy[t];store.set("theme",t)}
  if(t==="night"||t==="sun")document.documentElement.setAttribute("data-theme",t);
  var mq=window.matchMedia?window.matchMedia("(prefers-color-scheme: light)"):null;
  function effective(){var a=document.documentElement.getAttribute("data-theme");return a==="night"||a==="sun"?a:(mq&&mq.matches?"sun":"night")}
  function sync(){
    var sun=effective()==="sun",b=$("themeBtn");
    var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",sun?"#ECEBE5":"#111111");
    if(!b)return;
    b.setAttribute("aria-pressed",sun?"true":"false");
    b.setAttribute("aria-label",sun?"Sun mode is on. Switch to Night mode":"Night mode is on. Switch to Sun mode for bright daylight");
    b.querySelector(".tb-txt").textContent=sun?"Night":"Sun";
    b.querySelector("use").setAttribute("href",sun?"#i-moon":"#i-sun");
  }
  window.setTheme=function(v){if(v==="night"||v==="sun")document.documentElement.setAttribute("data-theme",v);else{v="auto";document.documentElement.removeAttribute("data-theme")}store.set("theme",v);sync()};
  $("themeBtn").onclick=function(){setTheme(effective()==="sun"?"night":"sun");toast(effective()==="sun"?"Sun mode: built for glare":"Night mode: garage lights")};
  if(mq&&mq.addEventListener)mq.addEventListener("change",sync);
  sync();
})();

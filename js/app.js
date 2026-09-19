/* ============================================================
   RakshaRide — SIH 2026 T6-P4
   Real-sensor crash detection + golden-hour response demo.
   ============================================================ */
"use strict";
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function fmtT(s){s=Math.max(0,Math.floor(s));return String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")}
function now(){return performance.now()/1000}

/* ---------- view routing ---------- */
function show(view){["landing","rider","command"].forEach(v=>$(v).classList.toggle("hide",v!==view))}
function enterRider(){show("rider");location.hash="rider";initRider()}
function enterCommand(){show("command");location.hash="command";initCommand()}
window.addEventListener("load",()=>{
  if(location.hash==="#rider")enterRider();
  else if(location.hash==="#command")enterCommand();
});

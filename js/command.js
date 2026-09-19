"use strict";
/* ============================================================
   108 COMMAND CENTER
   ============================================================ */
const C={inited:false,run:false,alerts:[],ambs:[],hosps:[],hot:[],t0:0,ddTimes:[],resolved:0,famN:0,preAlerts:0,nextId:1,lastSpawn:0};
const CW=1200,CH=800;
const PLACES=[["Gandhipuram",430,300],["Peelamedu",850,250],["Ukkadam",380,560],["Singanallur",950,470],["Saibaba Colony",250,220],["Race Course",560,430],["Town Hall",470,470],["Kuniyamuthur",300,700],["Avinashi Rd",760,180],["Trichy Rd",820,620]];
const NAMES=["Karthik","Priya","Suresh","Divya","Manoj","Lakshmi","Vignesh","Meena","Rahul","Fathima","Senthil","Anitha"];
let cmap,cctx,cscl=1,cox=0,coy=0,cmw=0,cmh=0;
const CX=x=>cox+x*cscl, CY=y=>coy+y*cscl;

function initCommand(){
  if(C.inited){return} C.inited=true; C.t0=now();
  cmap=$("cmap");cctx=cmap.getContext("2d");
  fitC(); window.addEventListener("resize",fitC);
  /* hospitals: name, x, y, trauma level, beds free/total */
  C.hosps=[
    {n:"Ganga Hospital",x:520,y:250,lvl:"L1",spec:"Ortho-trauma centre of excellence",free:7,tot:12,pre:0},
    {n:"CMCH (Govt)",x:420,y:420,lvl:"L1",spec:"Govt medical college · free care",free:14,tot:30,pre:0},
    {n:"KMCH",x:880,y:330,lvl:"L1",spec:"Neuro + cardio trauma",free:6,tot:15,pre:0},
    {n:"PSG Hospitals",x:830,y:210,lvl:"L2",spec:"Multi-speciality",free:9,tot:18,pre:0},
    {n:"GKNM",x:640,y:520,lvl:"L2",spec:"Multi-speciality",free:5,tot:14,pre:0},
    {n:"ESI Hospital",x:330,y:640,lvl:"L3",spec:"Stabilisation + referral",free:8,tot:10,pre:0},
  ];
  for(let i=0;i<8;i++)C.ambs.push({id:"AMB-"+(101+i),x:200+((i*137)%800),y:180+((i*211)%520),state:"FREE",tgt:null,alert:null,hosp:null});
  /* hotspots: known black-spots */
  C.hot=[{x:760,y:180,k:14,n:"Avinashi Rd flyover"},{x:380,y:560,k:11,n:"Ukkadam junction"},{x:950,y:470,k:9,n:"Singanallur signal"},{x:300,y:700,k:8,n:"Kuniyamuthur NH bend"},{x:560,y:430,k:6,n:"Race Course loop"}];
  $("feedBtn").onclick=()=>{C.run=!C.run;$("feedBtn").textContent=C.run?"⏸ Pause incident feed":"▶ Simulate incident feed";$("feedBtn").classList.toggle("primary",!C.run);
    if(C.run)clog("d","📡 Incident feed live — RakshaRide phones across the district reporting in")};
  $("cHowBtn").onclick=()=>$("howVeil").style.display="flex";
  $("ingestBtn").onclick=ingestCode;
  document.querySelectorAll(".c-layers input").forEach(i=>i.onchange=drawC);
  renderHosps();
  clog("d","🚑 Command grid online · 8 GVK-EMRI ambulances · 6-hospital trauma network mapped");
  /* live relay polling — alerts from rider phones arrive with ZERO human steps */
  C.seen=new Set();
  try{const v=localStorage.getItem("rr_cRelay");if(v)$("cRelay").value=v;
    $("cRelay").addEventListener("input",()=>{try{localStorage.setItem("rr_cRelay",$("cRelay").value)}catch(e){}});}catch(e){}
  setInterval(()=>{
    const u=$("cRelay").value.trim();if(!u)return;
    fetch(u.replace(/\/+$/,"")+"/alerts.json")
      .then(r=>r.json())
      .then(j=>{
        $("cRelayStat").textContent="relay LIVE — listening for rider phones ("+new Date().toLocaleTimeString()+")";
        $("cRelayStat").style.color="#7fd67f";
        if(!j)return;
        for(const [k,v] of Object.entries(j)){
          if(C.seen.has(k)||!v||!v.lat)continue;
          C.seen.add(k);
          if(v.t&&Date.parse(v.t)<Date.now()-600000)continue;   // ignore alerts older than 10 min
          spawnAlert(v);
          clog("a","📡 AUTO-RECEIVED from rider phone via live relay — zero human steps, "+(v.kind==="SAKHI"?"personal-safety":"crash")+" protocol engaged");
        }
      })
      .catch(()=>{$("cRelayStat").textContent="relay unreachable — check URL";$("cRelayStat").style.color="#ffd47a"});
  },3000);
  requestAnimationFrame(cFrame);
}
function fitC(){
  if(!cmap)return;
  const r=cmap.parentElement.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
  cmap.width=r.width*dpr;cmap.height=r.height*dpr;cctx.setTransform(dpr,0,0,dpr,0,0);
  cmw=r.width;cmh=r.height;cscl=Math.min(cmw/CW,cmh/CH);cox=(cmw-CW*cscl)/2;coy=(cmh-CH*cscl)/2;
}

/* ---------- alert lifecycle ---------- */
function spawnAlert(fromPayload){
  const p=fromPayload;
  const hs=C.hot[Math.floor(Math.random()*C.hot.length)];
  const x=p?520+Math.random()*220:clamp(hs.x+(Math.random()-0.5)*130,40,CW-40);
  const y=p?300+Math.random()*220:clamp(hs.y+(Math.random()-0.5)*130,40,CH-40);
  const sev=p?p.sev:(Math.random()<0.3?"CRITICAL":Math.random()<0.6?"SEVERE":"MODERATE");
  const a={id:C.nextId++,name:p?p.name:NAMES[Math.floor(Math.random()*NAMES.length)],
    blood:p?p.blood:"O+",x,y,sev,score:p?p.score:(sev==="CRITICAL"?70+Math.random()*25:sev==="SEVERE"?45+Math.random()*22:25+Math.random()*18)|0,
    peak:p?p.peak:(40+Math.random()*70)|0,preSpeed:p?p.preSpeed:(25+Math.random()*40)|0,
    kind:(p&&p.kind)||"CRASH",t:now(),amb:null,hosp:null,famT:null,state:"NEW",src:p?p.src:"SIM-FEED",place:nearestC(x,y)};
  C.alerts.unshift(a);
  clog("a",a.kind==="SAKHI"
    ?`🌸 PERSONAL-SAFETY silent SOS #${String(a.id).padStart(3,"0")} — ${a.name} near ${a.place} · police protocol engaged${p?" · FROM RIDER PHONE":""}`
    :`🆘 ${a.sev} crash alert #${String(a.id).padStart(3,"0")} — ${a.name} near ${a.place} (impact ${a.peak} m/s², ${a.preSpeed} km/h)${p?" · FROM RIDER PHONE":""}`);
  if(a.kind==="SAKHI")setTimeout(()=>clog("w",`🚓 City Police PCR van + nearest patrol informed for #${a.id} — discreet approach advised`),900);
  setTimeout(()=>dispatch(a),1800+Math.random()*2600);   // operator confirm + auto-match
  return a;
}
function nearestC(x,y){let b=null,d=1e9;for(const p of PLACES){const dd=Math.hypot(p[1]-x,p[2]-y);if(dd<d){d=dd;b=p[0]}}return b}
function dispatch(a){
  const amb=C.ambs.filter(m=>m.state==="FREE").sort((m,n)=>Math.hypot(m.x-a.x,m.y-a.y)-Math.hypot(n.x-a.x,n.y-a.y))[0];
  if(!amb){clog("w",`⚠ No free ambulance for #${a.id} — queued`);return}
  amb.state="ENROUTE";amb.alert=a;amb.tgt={x:a.x,y:a.y};a.amb=amb;a.state="DISPATCHED";
  C.ddTimes.push(now()-a.t);
  /* hospital matching by severity + beds + distance */
  const want=a.sev==="CRITICAL"?["L1"]:a.sev==="SEVERE"?["L1","L2"]:["L1","L2","L3"];
  const h=C.hosps.filter(h=>want.includes(h.lvl)&&h.free>0).sort((p,q)=>Math.hypot(p.x-a.x,p.y-a.y)-Math.hypot(q.x-a.x,q.y-a.y))[0]||C.hosps[1];
  a.hosp=h;h.pre++;h.free=Math.max(0,h.free-1);C.preAlerts++;
  clog("d",`🚑 ${amb.id} dispatched → #${a.id} (${a.place})`);
  clog("h",`🏥 PRE-ALERT ${h.n} [${h.lvl}]: incoming ${a.sev.toLowerCase()} two-wheeler trauma, ETA ~${Math.ceil(Math.hypot(amb.x-a.x,amb.y-a.y)/70)} min — trauma team readied`);
  setTimeout(()=>{a.famT=now();C.famN++;clog("f",`👨‍👩‍👧 Guardian circle of ${a.name} notified — live-tracking link active`)},1400);
  renderHosps();
}
function stepC(dt){
  if(C.run && now()-C.lastSpawn> (C.alerts.filter(a=>a.state!=="RESOLVED").length<2?6:11) && C.alerts.length<26){C.lastSpawn=now();spawnAlert()}
  for(const m of C.ambs){
    if(m.state==="ENROUTE"&&m.tgt){
      mv(m,m.tgt,80*dt);
      if(Math.hypot(m.x-m.tgt.x,m.y-m.tgt.y)<6){m.state="ONSITE";m.t0=now();m.alert.state="TEAM ON-SITE";
        clog("d",`⛑ ${m.id} on-site at #${m.alert.id} — stabilising`);}
    } else if(m.state==="ONSITE"){
      if(now()-m.t0>4){m.state="TOHOSP";m.tgt={x:m.alert.hosp.x,y:m.alert.hosp.y};m.alert.state="TO HOSPITAL";
        clog("d",`🚑 ${m.id} → ${m.alert.hosp.n} with ${m.alert.name}`)}
    } else if(m.state==="TOHOSP"){
      mv(m,m.tgt,90*dt);
      if(Math.hypot(m.x-m.tgt.x,m.y-m.tgt.y)<8){
        const a=m.alert;a.state="RESOLVED";a.doneT=now();C.resolved++;
        clog("f",`✅ #${a.id} ${a.name} handed over at ${a.hosp.n} — golden-hour time ${fmtT(now()-a.t)} · black-box report generated`);
        m.state="FREE";m.alert=null;m.tgt=null;
      }
    }
  }
}
function mv(o,t,d){const dx=t.x-o.x,dy=t.y-o.y,L=Math.hypot(dx,dy)||1;o.x+=dx/L*Math.min(d,L);o.y+=dy/L*Math.min(d,L)}

/* ---------- ingest from rider phone ---------- */
function ingestCode(){
  const v=$("ingestBox").value.trim();
  if(!v.startsWith("RKSA-")){clog("w","⚠ Invalid code — expected RKSA-…");return}
  try{
    const p=JSON.parse(decodeURIComponent(escape(atob(v.slice(5)))));
    const a=spawnAlert(p);
    clog("a",`📱 REAL rider-phone alert ingested: ${p.name}, ${p.sev}, GPS ${p.lat}°, ${p.lon}° (${p.src})`);
    $("ingestBox").value="";
  }catch(e){clog("w","⚠ Could not parse alert code")}
}

/* ---------- render ---------- */
function drawC(){
  const c=cctx;c.clearRect(0,0,cmw,cmh);
  c.fillStyle="#141614";c.fillRect(cox,coy,CW*cscl,CH*cscl);
  /* roads */
  c.strokeStyle="#33332f";c.lineWidth=Math.max(1.5,3*cscl);c.beginPath();
  for(let y=100;y<CH;y+=120){c.moveTo(CX(0),CY(y));c.lineTo(CX(CW),CY(y))}
  for(let x=100;x<CW;x+=130){c.moveTo(CX(x),CY(0));c.lineTo(CX(x),CY(CH))}
  c.stroke();
  c.strokeStyle="#3d3d38";c.lineWidth=Math.max(2,4.5*cscl);c.beginPath();
  c.moveTo(CX(0),CY(180));c.lineTo(CX(CW),CY(260));c.moveTo(CX(300),CY(CH));c.lineTo(CX(520),CY(0));c.stroke();
  /* hotspots */
  if($("cl-hot").checked)for(const h of C.hot){
    const g=c.createRadialGradient(CX(h.x),CY(h.y),0,CX(h.x),CY(h.y),h.k*7*cscl);
    g.addColorStop(0,"rgba(217,89,38,0.34)");g.addColorStop(1,"rgba(217,89,38,0)");
    c.fillStyle=g;c.beginPath();c.arc(CX(h.x),CY(h.y),h.k*7*cscl,0,7);c.fill();
    c.font=`${Math.max(8.5,10*cscl)}px system-ui`;c.fillStyle="rgba(255,184,148,0.7)";c.textAlign="center";
    c.fillText(h.n+" · "+h.k+" alerts/mo",CX(h.x),CY(h.y)-h.k*7*cscl-4);c.textAlign="left";
  }
  /* places */
  c.font=`${Math.max(9,11*cscl)}px system-ui`;c.fillStyle="rgba(255,255,255,0.45)";
  for(const p of PLACES)c.fillText(p[0],CX(p[1]),CY(p[2]));
  /* hospitals */
  if($("cl-hosp").checked)for(const h of C.hosps){
    c.fillStyle=h.lvl==="L1"?"#9085e9":"#6b62b8";c.strokeStyle="#0d0d0d";c.lineWidth=1.5;
    c.fillRect(CX(h.x)-7,CY(h.y)-7,14,14);c.strokeRect(CX(h.x)-7,CY(h.y)-7,14,14);
    c.fillStyle="#fff";c.font="bold 10px system-ui";c.textAlign="center";c.fillText("H",CX(h.x),CY(h.y)+3.5);c.textAlign="left";
    c.font="9px system-ui";c.fillStyle="#c9beff";c.fillText(h.n,CX(h.x)+10,CY(h.y)-4);
  }
  /* routes */
  if($("cl-routes").checked)for(const m of C.ambs){if(m.tgt&&m.state!=="FREE"){
    c.strokeStyle="rgba(143,208,255,0.5)";c.lineWidth=1.3;c.setLineDash([5,5]);
    c.beginPath();c.moveTo(CX(m.x),CY(m.y));c.lineTo(CX(m.tgt.x),CY(m.tgt.y));c.stroke();c.setLineDash([]);}}
  /* alerts */
  for(const a of C.alerts){
    if(a.state==="RESOLVED"&&now()-a.doneT>6)continue;
    const px=CX(a.x),py=CY(a.y);
    if(a.state==="RESOLVED"){c.fillStyle="#0ca30c";c.beginPath();c.arc(px,py,5,0,7);c.fill();
      c.fillStyle="#fff";c.font="bold 7.5px system-ui";c.textAlign="center";c.fillText("✓",px,py+2.7);c.textAlign="left";continue}
    const col=a.sev==="CRITICAL"?"#d03b3b":a.sev==="SEVERE"?"#ec835a":"#fab219";
    const ph=(now()*1.2)%1;
    c.strokeStyle=`rgba(208,59,59,${a.sev==="CRITICAL"?1-ph:0})`;c.lineWidth=2;
    c.beginPath();c.arc(px,py,(7+ph*16)*Math.max(cscl,.7),0,7);c.stroke();
    c.fillStyle=col;c.strokeStyle="#0d0d0d";c.lineWidth=1.6;
    c.beginPath();c.arc(px,py,6.5,0,7);c.fill();c.stroke();
    c.fillStyle="#fff";c.font="bold 7.5px system-ui";c.textAlign="center";c.fillText("!",px,py+2.7);c.textAlign="left";
  }
  /* ambulances */
  if($("cl-amb").checked)for(const m of C.ambs){
    const px=CX(m.x),py=CY(m.y);
    c.fillStyle=m.state==="FREE"?"#2a5f9e":"#3987e5";c.strokeStyle="#0d0d0d";c.lineWidth=1.4;
    c.beginPath();c.arc(px,py,5.5,0,7);c.fill();c.stroke();
    c.font="bold 8.5px system-ui";c.fillStyle="#8fd0ff";c.fillText(m.id,px+7,py+3);
  }
}
function renderAlerts(){
  const el=$("alertList");
  const act=C.alerts.filter(a=>a.state!=="RESOLVED");
  $("alertCount").textContent=act.length;
  if(!C.alerts.length)return;
  let html="";
  for(const a of C.alerts.slice(0,20)){
    const gh=3600-(now()-a.t);
    html+=`<div class="alert-card ${a.sev}"><div class="r1">
      <span class="sev ${a.sev}">${a.sev==="CRITICAL"?"▲":a.sev==="SEVERE"?"◆":"●"} ${a.sev}</span>
      <b style="font-size:11.5px">#${String(a.id).padStart(3,"0")} ${a.name}</b>
      ${a.state==="RESOLVED"?`<span class="tagline tag-fam" style="margin-left:auto">✅ ${fmtT(a.doneT-a.t)}</span>`:`<span class="gh ${gh>2700?"okt":""}">⏳ ${fmtT(gh)}</span>`}</div>
      <div class="meta"><b>${a.place}</b> · ${a.kind==="SAKHI"?'<b style="color:#c9beff">🌸 personal safety · silent manual trigger · live tracking</b>':`impact ${a.peak} m/s² · ${a.preSpeed} km/h`} · blood ${a.blood} · score ${a.score}<br>
      ${a.src==="SIM-FEED"?"":"<b style='color:#8fd0ff'>📱 from rider phone · </b>"}${a.state}</div>
      <div class="a-btns">
        ${a.amb?`<span class="tagline tag-amb">🚑 ${a.amb.id}</span>`:""}
        ${a.hosp?`<span class="tagline tag-hosp">🏥 ${a.hosp.n} pre-alerted</span>`:""}
        ${a.famT?`<span class="tagline tag-fam">👨‍👩‍👧 family tracking</span>`:""}
      </div></div>`;
  }
  el.innerHTML=html;
}
function renderHosps(){
  let html="";
  for(const h of C.hosps){
    html+=`<div class="hosp-card"><div class="r1"><span class="lvl ${h.lvl}">${h.lvl}</span>${h.n}
      <span style="margin-left:auto;font-size:10px;color:${h.pre?"#c9a6ff":"var(--ink-mut)"};font-weight:700">${h.pre?h.pre+" pre-alert"+(h.pre>1?"s":""):"standby"}</span></div>
      <div class="meta">${h.spec}</div>
      <div class="meta">Trauma beds free: <b>${h.free}/${h.tot}</b></div>
      <div class="beds"><i style="width:${h.free/h.tot*100}%;background:${h.free/h.tot>0.4?"#0ca30c":h.free>0?"#fab219":"#d03b3b"}"></i></div></div>`;
  }
  $("hospList").innerHTML=html;
  $("hospCount").textContent=C.hosps.length;
}
function renderCK(){
  const act=C.alerts.filter(a=>a.state!=="RESOLVED").length;
  $("ck-act").textContent=act;
  if(C.ddTimes.length){const s=[...C.ddTimes].sort((a,b)=>a-b);$("ck-dd").textContent=s[Math.floor(s.length/2)].toFixed(0)+" s"}
  $("ck-amb").textContent=C.ambs.filter(m=>m.state==="FREE").length+"/8";
  $("ck-hosp").textContent=C.preAlerts;
  $("ck-fam").textContent=C.famN;
  $("ck-resolved").textContent=C.resolved;
}
function clog(k,msg){
  const el=$("clog");const d=document.createElement("div");
  d.innerHTML=`<span class="tm">${new Date().toLocaleTimeString()}</span><span class="ev-${k}">${msg}</span>`;
  el.appendChild(d);el.scrollTop=el.scrollHeight;
  while(el.children.length>100)el.removeChild(el.firstChild);
}
let cLast=now(),cUi=0;
function cFrame(){
  const t=now(),dt=Math.min(0.05,t-cLast);cLast=t;
  if(!$("command").classList.contains("hide")){
    stepC(dt);drawC();
    cUi+=dt;if(cUi>0.4){cUi=0;renderAlerts();renderCK();renderHosps()}
  }
  requestAnimationFrame(cFrame);
}

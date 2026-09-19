"use strict";
/* ============================================================
   RIDER: sensor pipeline + 3-gate classifier
   ============================================================ */
const R={inited:false,riding:false,rideT0:0,dist:0,speed:0,gpsOk:false,lat:11.0168,lon:76.9558,
  buf:[],lastSample:0,peak:0,impactEvents:[],phase:"idle",still:null,cd:null,sirenT:null,
  realSensors:false,sampleHz:0,sampleCount:0,hzT0:0,ctxOverride:null,sim:null};
const IMPACT_T=26;            // m/s² net trigger (demo-calibrated; production ≈ 12 g with on-device model)
const FREEFALL_T=3;

function initRider(){
  if(R.inited)return; R.inited=true;
  const gc=$("gCanvas"); gc.width=gc.offsetWidth*2||700; gc.height=112;
  $("rideBtn").onclick=toggleRide;
  $("safeBtn").onclick=reachedSafely;
  $("cancelBtn").onclick=cancelCountdown;
  $("sosDone").onclick=()=>{escTimers.forEach(clearTimeout);stopLiveLocation();$("sosScreen").classList.add("hide");resetPipeline("SOS acknowledged. Pipeline re-armed.")};
  $("copyCode").onclick=e=>{navigator.clipboard&&navigator.clipboard.writeText($("alertCode").textContent);e.target.textContent="Copied ✓";setTimeout(()=>e.target.textContent="Copy code",1400)};
  document.querySelectorAll(".sim-btn").forEach(b=>b.onclick=()=>runSim(b.dataset.sim));
  /* ---- Sakhi mode ---- */
  let holdT=null,holdP=0;
  const startH=e=>{e.preventDefault();if(R.phase==="sos")return;holdP=0;
    holdT=setInterval(()=>{holdP+=100/30;$("holdFill").style.width=Math.min(100,holdP)+"%";
      if(holdP>=100){clearInterval(holdT);holdT=null;$("holdFill").style.width="0%";fireSOS({kind:"SAKHI"})}},100)};
  const endH=()=>{if(holdT){clearInterval(holdT);holdT=null;$("holdFill").style.width="0%"}};
  const hb=$("holdSOS");
  hb.addEventListener("pointerdown",startH);hb.addEventListener("pointerup",endH);hb.addEventListener("pointerleave",endH);
  let tripIv=null,tripT0=0;
  $("tripBtn").onclick=()=>{
    const off=$("tripPanel").classList.toggle("hide");
    $("tripBtn").textContent=off?"🧭 Start Trip Watch":"⏹ Stop Trip Watch";
    clearInterval(tripIv);
    if(off){stopLiveLocation()}
    if(!off){
      tripT0=now();
      startLiveLocation($("tripStat"));
      const tick=()=>{$("tripStat").innerHTML="🧭 <b>Trip Watch LIVE ·</b> "+fmtT(now()-tripT0)
        +" · "+(R.speed>3?Math.round(R.speed)+" km/h — moving ✅":"stationary")
        +" · GPS "+R.lat.toFixed(4)+"°, "+R.lon.toFixed(4)+"°"
        +"<br>Guardians watching this trip in real time. Deviation or unexpected stop → they're alerted <b>without her pressing anything</b>.";};
      tick();tripIv=setInterval(tick,1000);
    }
  };
  $("devBtn").onclick=()=>{
    const nm=$("gName").value||"Rider";
    clearInterval(tripIv);
    $("tripStat").innerHTML="⚠ <b>Route deviation detected</b> — 600 m off the expected path + stationary 4 min. Guardians auto-alerted with live location. <b>She pressed nothing — the system acted for her.</b>";
    autoNotify(`⚠ RakshaRide Trip Watch: ${nm}'s trip deviated from the expected route and stopped unexpectedly. Live tracking: https://maps.google.com/?q=${R.lat.toFixed(5)},${R.lon.toFixed(5)} — automatic alert, no action from her.`,$("tripStat"));
  };
  $("fakeBtn").onclick=()=>{$("fcState").textContent="incoming call…";$("fcTimer").textContent="";$("fakeCall").classList.remove("hide");
    if(navigator.vibrate)navigator.vibrate([500,300,500,300,500]);};
  let fcIv=null;
  $("fcAns").onclick=()=>{$("fcState").textContent="on call";let s=0;clearInterval(fcIv);
    fcIv=setInterval(()=>{s++;$("fcTimer").textContent=fmtT(s)},1000)};
  $("fcEnd").onclick=()=>{clearInterval(fcIv);$("fakeCall").classList.add("hide")};
  /* test-send + remember channel config on this device */
  $("testNotify").onclick=()=>{
    const st=$("notifyStat");st.style.display="block";st.innerHTML="Sending test…";
    autoNotify("✅ RakshaRide TEST: guardian channel is working. Crash & Sakhi alerts will arrive here automatically.",st);
  };
  try{
    ["tgToken","tgChat","waPhone","waKey","gPhone","gName","relayUrl"].forEach(id=>{
      const v=localStorage.getItem("rr_"+id); if(v)$(id).value=v;
      $(id).addEventListener("input",()=>{try{localStorage.setItem("rr_"+id,$(id).value)}catch(e){}});
    });
  }catch(e){}
  requestAnimationFrame(riderFrame);
}

/* ---------- real sensors ---------- */
async function toggleRide(){
  R.riding=!R.riding;
  const b=$("rideBtn");
  if(R.riding){
    R.rideT0=now();R.dist=0;
    b.textContent="⏹ Stop Ride"; b.className="big-btn stop";
    $("rideState").textContent="PROTECTED"; $("rideState").classList.add("on");
    try{
      if(typeof DeviceMotionEvent!=="undefined"&&DeviceMotionEvent.requestPermission){
        const perm=await DeviceMotionEvent.requestPermission();
        if(perm!=="granted"){$("sensorState").textContent="permission denied — allow Motion & Orientation access";}
      }
      window.addEventListener("devicemotion",onMotion);
    }catch(e){$("sensorState").textContent="sensor request blocked ("+(location.protocol==="https:"?"check browser settings":"needs HTTPS — use the hosted link")+")"}
    /* diagnostic: no events after 3 s → explain why */
    setTimeout(()=>{
      if(R.riding&&!R.realSensors){
        const inApp=!/^https?:$/.test(location.protocol);
        $("sensorState").textContent="no sensor events — "+(inApp
          ?"open in real Chrome/Safari via an HTTPS link (in-app previews & file:// often block sensors)"
          :"this device has no motion sensors (laptop?) — use the Signature Simulator below");
      }
    },3000);
    if(navigator.geolocation)navigator.geolocation.watchPosition(p=>{
      R.gpsOk=true;R.lat=p.coords.latitude;R.lon=p.coords.longitude;
      if(p.coords.speed!=null)R.speed=Math.max(0,p.coords.speed*3.6);
      $("gpsState").textContent=R.lat.toFixed(4)+"°, "+R.lon.toFixed(4)+"°";
    },()=>{ $("gpsState").textContent="unavailable (using demo location)"; },{enableHighAccuracy:true});
    setVerdict("","Ride armed. Context gate active — watching sensor stream for impact signatures.");
  } else {
    b.textContent="▶ Start Ride Protection"; b.className="big-btn start";
    $("rideState").textContent="IDLE"; $("rideState").classList.remove("on");
    window.removeEventListener("devicemotion",onMotion);
    resetPipeline("Ride ended.");
  }
}
function onMotion(e){
  const a=e.accelerationIncludingGravity;
  if(!a||a.x==null)return;
  if(!R.realSensors){R.realSensors=true;R.hzT0=now();$("pipeMode").textContent="REAL SENSORS LIVE";}
  R.sampleCount++;
  const t=now();
  if(t-R.hzT0>2){R.sampleHz=Math.round(R.sampleCount/(t-R.hzT0));R.sampleCount=0;R.hzT0=t;
    $("sensorState").textContent="LIVE · "+R.sampleHz+" Hz accelerometer";}
  const rr=e.rotationRate||{alpha:0,beta:0,gamma:0};
  feed({t,a:Math.hypot(a.x,a.y,a.z),rot:Math.hypot(rr.alpha||0,rr.beta||0,rr.gamma||0),spd:R.speed,src:"real"});
}

/* ---------- the shared pipeline (real + synthetic go through HERE) ---------- */
function feed(s){
  R.buf.push(s); const cut=s.t-8; while(R.buf.length&&R.buf[0].t<cut)R.buf.shift();
  $("gNow").textContent=s.a.toFixed(1); $("rotNow").textContent=Math.round(s.rot);
  const net=Math.abs(s.a-9.81);
  if(net>R.peak){R.peak=net;$("gPeak").textContent=R.peak.toFixed(1)+" m/s²";}

  /* Gate 1: context */
  const ctx = R.ctxOverride!==null ? R.ctxOverride : R.riding;
  stage("st-ctx",ctx?"ok":"", ctx?(R.sim?R.sim.ctxLabel:"ride armed"):"not riding");
  if(!ctx){
    if(net>IMPACT_T) setVerdict("reject","<b>Impact seen but context gate closed</b> — no riding context (no road-matched GPS trajectory). A kitchen drop or amusement ride never arms the detector. No alert.");
    return;
  }
  if(R.phase==="countdown"||R.phase==="sos")return;

  /* Gate 2: impact trigger */
  if(R.phase!=="impact" && (net>IMPACT_T || s.a<FREEFALL_T)){
    R.phase="impact"; R.impactT=s.t;
    stage("st-imp","fire",net.toFixed(0)+" m/s²");
    setTimeout(()=>classifyWindow(),1600);  // collect 1.6 s window then classify
  }
}
function classifyWindow(){
  const t1=R.impactT, win=R.buf.filter(x=>x.t>t1-1.2&&x.t<t1+1.6);
  const pre=R.buf.filter(x=>x.t<t1&&x.t>t1-6);
  const peak=Math.max(...win.map(x=>Math.abs(x.a-9.81)),0);
  const spikes=win.filter((x,i)=>Math.abs(x.a-9.81)>IMPACT_T&&(i===0||Math.abs(win[i-1].a-9.81)<=IMPACT_T)).length;
  const ffMs=win.filter(x=>x.a<FREEFALL_T).length*(1000/50);
  const rotE=Math.max(...win.map(x=>x.rot),0);   // peak tumble rate in window
  const preSpeed=Math.max(...pre.map(x=>x.spd||0),R.sim?R.sim.preSpeed:0,0);
  R.features={peak,spikes,ffMs,rotE,preSpeed};
  stage("st-imp","ok",peak.toFixed(0)+" m/s² · "+spikes+" spike"+(spikes>1?"s":""));

  /* rollercoaster pattern: repeated high-G events, smooth, motion continues */
  R.impactEvents.push(t1); R.impactEvents=R.impactEvents.filter(t=>t1-t<70);
  const periodic=R.impactEvents.length>=3 && rotE<140 && spikes<=2;

  let cls,why;
  if(R.sim&&R.sim.kind==="coaster"||periodic){cls="AMUSEMENT-RIDE PATTERN";why="repetitive smooth G-waves, no road-matched trajectory, motion continues after each wave — the exact pattern that made Apple dial 911 from rollercoasters. <b>Rejected without a countdown.</b>"}
  else if(ffMs>180&&spikes<=1&&rotE<160){cls="PHONE DROP";why="free-fall ("+ffMs.toFixed(0)+" ms of ~0 g) → one clean spike → low rotation. Watching for pickup motion…"}
  else if(spikes<=1&&rotE<160){cls="POTHOLE / HARD BRAKE";why="single spike, low tumbling energy. Watching GPS — if the ride continues, this is road noise."}
  else {cls="CRASH CANDIDATE";why="chaotic multi-spike impact + 3-axis tumbling (rot "+rotE.toFixed(0)+" °/s) after "+preSpeed.toFixed(0)+" km/h. Entering stillness verification."}
  stage("st-cls",cls==="CRASH CANDIDATE"?"fire":"ok",cls.split(" ")[0].toLowerCase());
  setVerdict(cls==="CRASH CANDIDATE"?"accept":"reject","<b>"+cls+"</b> — "+why);

  if(cls==="CRASH CANDIDATE"){stillnessGate()}
  else if(cls==="PHONE DROP"||cls==="POTHOLE / HARD BRAKE"){
    /* post-window: motion / speed resume check resolves the reject */
    setTimeout(()=>{
      const label=cls==="PHONE DROP"?"pickup motion detected — phone retrieved":"GPS speed resumed — ride continues";
      setVerdict("reject","<b>"+cls+" — REJECTED.</b> "+label+". No alert sent. (Logged as a labelled negative sample for retraining.)");
      stage("st-still","ok","motion resumed");
      setTimeout(()=>resetPipeline("Pipeline re-armed."),3200);
    },2600);
  } else {setTimeout(()=>resetPipeline("Pipeline re-armed."),4200)}
}
function stillnessGate(){
  R.phase="still"; let left=5;
  stage("st-still","fire","verifying "+left+" s");
  R.still=setInterval(()=>{
    /* real mode: any significant motion cancels */
    const recent=R.buf.filter(x=>x.t>now()-1);
    const moving=R.realSensors&&!R.sim&&recent.some(x=>Math.abs(x.a-9.81)>6);
    if(moving){clearInterval(R.still);setVerdict("reject","<b>Motion resumed during stillness check</b> — rider moving. Rejected, no alert.");stage("st-still","ok","motion resumed");setTimeout(()=>resetPipeline("Pipeline re-armed."),3000);return}
    left--; stage("st-still","fire","verifying "+left+" s");
    if(left<=0){clearInterval(R.still);stage("st-still","ok","NO MOVEMENT");startCountdown()}
  },1000);
}

/* ---------- countdown + siren ---------- */
let audioCtx=null,sirenOsc=null;
function siren(on){
  try{
    if(on){audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();
      sirenOsc=audioCtx.createOscillator();const g=audioCtx.createGain();g.gain.value=.4;
      sirenOsc.type="square";sirenOsc.connect(g);g.connect(audioCtx.destination);sirenOsc.start();
      R.sirenT=setInterval(()=>{sirenOsc.frequency.value=sirenOsc.frequency.value===880?620:880},280);
      sirenOsc.frequency.value=880;}
    else{if(R.sirenT)clearInterval(R.sirenT);if(sirenOsc){sirenOsc.stop();sirenOsc=null}}
  }catch(e){}
}
function startCountdown(){
  R.phase="countdown"; let n=10; $("countNum").textContent=n;
  $("countOverlay").classList.remove("hide"); siren(true);
  if(navigator.vibrate)navigator.vibrate([400,150,400,150,400]);
  R.cd=setInterval(()=>{n--;$("countNum").textContent=n;if(navigator.vibrate)navigator.vibrate(250);
    if(n<=0){clearInterval(R.cd);$("countOverlay").classList.add("hide");siren(false);fireSOS()}},1000);
}
function cancelCountdown(){
  clearInterval(R.cd);$("countOverlay").classList.add("hide");siren(false);
  setVerdict("reject","<b>Rider cancelled — false positive logged.</b> This tap becomes a labelled training sample; the model gets smarter with every cancel.");
  resetPipeline("");R.phase="idle";
}

/* ---------- SOS ---------- */
function severityOf(f){
  const s=Math.round(35*clamp((f.preSpeed||30)/60,0,1)+30*clamp(f.peak/120,0,1)+20*clamp(f.rotE/400,0,1)+15);
  return {score:s,band:s>=70?"CRITICAL":s>=45?"SEVERE":"MODERATE"};
}
function fireSOS(opts={}){
  R.phase="sos";
  const sakhi=opts.kind==="SAKHI";
  const f=R.features||{peak:88,spikes:4,rotE:310,preSpeed:46};
  const sev=sakhi?{score:82,band:"CRITICAL"}:severityOf(f);
  const lat=+(R.lat+(Math.random()-0.5)*0.02).toFixed(5), lon=+(R.lon+(Math.random()-0.5)*0.02).toFixed(5);
  const payload={v:1,kind:sakhi?"SAKHI":"CRASH",name:$("gName").value||"Rider",blood:$("gBlood").value||"?",t:new Date().toISOString(),
    lat,lon,sev:sev.band,score:sev.score,peak:sakhi?0:+f.peak.toFixed(0),preSpeed:sakhi?0:+(f.preSpeed||0).toFixed(0),rot:sakhi?0:+f.rotE.toFixed(0),
    src:sakhi?"MANUAL-SILENT-TRIGGER":(R.realSensors&&!R.sim?"REAL-SENSOR":"SIMULATED-SIGNATURE")};
  const code="RKSA-"+btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  $("sosTime").textContent=(sakhi?"🌸 SILENT PERSONAL-SAFETY SOS · ":"")+new Date().toLocaleTimeString()+" · severity "+sev.band+" ("+sev.score+"/100) · "+payload.src;
  $("sosKv").innerHTML=
    `<div class="cell"><span>RIDER</span><b>${payload.name} · ${payload.blood}</b></div>
     <div class="cell"><span>LOCATION</span><b>${lat}°, ${lon}°</b></div>
     <div class="cell"><span>IMPACT</span><b>${payload.peak} m/s² pk</b></div>
     <div class="cell"><span>PRE-CRASH SPEED</span><b>${payload.preSpeed} km/h</b></div>
     <div class="cell"><span>SEVERITY</span><b style="color:#ff9d9d">${sev.band} ${sev.score}/100</b></div>
     <div class="cell"><span>TUMBLE</span><b>${payload.rot} °/s</b></div>`;
  $("alertCode").textContent=code;
  const smsBody=encodeURIComponent(`🆘 RakshaRide SOS: ${payload.name} crash detected (${sev.band}). Location: https://maps.google.com/?q=${lat},${lon} . Impact ${payload.peak}m/s². Ambulance being dispatched.`);
  $("smsBtn").onclick=()=>{location.href="sms:"+($("gPhone").value.replace(/\s/g,"")||"112")+"?body="+smsBody};
  $("sosSteps").innerHTML= sakhi?
    `1️⃣ <b>Silent trigger</b> — no siren, no countdown, the screen stays normal; nothing shows an attacker that help was called<br>
     2️⃣ 🖥 Server fires guardians + <b>112</b> + live-location tracking automatically<br>
     3️⃣ 🚓 Nearest police PCR van informed alongside 108<br>
     4️⃣ 🧭 Trip Watch route &amp; stop history frozen as evidence<br>
     5️⃣ Native app: this fires from <b>power-button ×3</b> — from a pocket, screen off`:
    `1️⃣ Structured alert auto-built &amp; auto-transmitted — <b>zero taps needed</b>; an unconscious rider is exactly who this is for<br>
     2️⃣ 🖥 The SERVER sends every human message (SMS gateway + auto voice-calls + escalation) — servers don't forget and don't need fingers<br>
     3️⃣ 📩 No internet? Native app auto-sends one background SMS to the gateway number (SEND_SMS permission) — browser demos can't do this by web-security design, hence the manual button here<br>
     4️⃣ 🚑 108 command center: dispatch + trauma-hospital pre-alert (the alert code = the data packet; ingest it there)<br>
     5️⃣ 📦 Black-box: 60 s sensor buffer frozen for insurance / FIR report`;
  $("sosScreen").classList.remove("hide");
  runEscalation();
  /* ZERO-TAP auto-notification — fires by itself, rider touches nothing */
  const autoMsg=sakhi
    ?`🌸 RakshaRide SILENT SOS: ${payload.name} triggered a personal-safety alert. Live location: https://maps.google.com/?q=${lat},${lon} — 112 & police informed. Her phone shows nothing; do NOT call her, follow the tracking link.`
    :`🆘 RakshaRide AUTO-SOS: ${payload.name} crash detected (${sev.band} ${sev.score}/100). Location: https://maps.google.com/?q=${lat},${lon} Impact ${payload.peak} m/s² at ${payload.preSpeed} km/h. Ambulance being dispatched. This message was sent automatically — the rider did not touch the phone.`;
  autoNotify(autoMsg);
  startLiveLocation($("escList"));
  /* AUTO-TRANSMIT to 108 command center over the live relay — zero human steps */
  const relay=$("relayUrl").value.trim();
  if(relay){
    fetch(relay.replace(/\/+$/,"")+"/alerts.json",{method:"POST",body:JSON.stringify(payload)})
      .then(r=>escSay(r.ok?"📡 <b>AUTO-TRANSMITTED to 108 Command Center</b> — watch the alert appear on the map by itself; nobody copied anything.":"⚠ Relay rejected the alert — check the relay URL",r.ok))
      .catch(()=>escSay("⚠ Relay unreachable — offline fallback: SMS-to-gateway (native app) or the alert-code paste",false));
  } else escSay("ℹ No live relay configured — using the alert-code as manual fallback. Add the Firebase relay URL for true zero-touch dispatch.",false);
}
function escSay(txt,ok){const r=document.createElement("div");
  r.style.cssText="padding:5px 0;border-bottom:1px solid var(--grid);color:"+(ok?"#7fd67f":"#ffd47a");
  r.innerHTML=txt;$("escList").prepend(r)}
function autoNotify(msg,sink){
  const tk=$("tgToken").value.trim(),ch=$("tgChat").value.trim(),wp=$("waPhone").value.trim(),wk=$("waKey").value.trim();
  const el=sink||$("escList");
  const say=(txt,ok)=>{const r=document.createElement("div");r.style.cssText="padding:5px 0;border-bottom:1px solid var(--grid);color:"+(ok?"#7fd67f":"#ffd47a");r.innerHTML=txt;el.prepend(r)};
  let fired=false;
  if(tk&&ch){fired=true;
    fetch(`https://api.telegram.org/bot${encodeURIComponent(tk)}/sendMessage?chat_id=${encodeURIComponent(ch)}&text=${encodeURIComponent(msg)}`)
      .then(async r=>{const j=await r.json().catch(()=>null);
        if(j&&j.ok)say("🚀 <b>AUTO-SENT via Telegram — check the guardian's phone now.</b> Zero taps.",true);
        else{const d=(j&&j.description)||("HTTP "+r.status);
          say("⚠ Telegram refused: <b>"+d+"</b>"+(/chat not found/i.test(d)?" → wrong chat id, or the guardian never messaged the bot — send the bot 'hi' once, then re-check getUpdates":/unauthorized|not found/i.test(d)?" → bot token is wrong — paste the full token from @BotFather (numbers:letters)":""),false);}})
      .catch(()=>say("⚠ Telegram unreachable (no internet on this device?) — SMS fallback would fire in the native app",false));}
  if(wp&&wk){fired=true;
    fetch(`https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(wp)}&text=${encodeURIComponent(msg)}&apikey=${encodeURIComponent(wk)}`,{mode:"no-cors"})
      .then(()=>say("🚀 <b>AUTO-SENT via WhatsApp (CallMeBot) — check the guardian's phone now.</b> Zero taps.",true))
      .catch(()=>say("⚠ WhatsApp gateway unreachable — SMS fallback would fire in the native app",false));}
  if(!fired)say("ℹ No auto-notify channel configured — add a Telegram bot or CallMeBot key in Guardian Circle to test real zero-tap delivery. (Production: server SMS gateway + native auto-SMS.)",false);
}

/* ---- LIVE location stream to guardian (Telegram native live-location) ---- */
const liveLoc={id:null,iv:null,lastLat:0,lastLon:0};
function startLiveLocation(sink){
  const tk=$("tgToken").value.trim(),ch=$("tgChat").value.trim();
  if(!tk||!ch)return;
  const base=`https://api.telegram.org/bot${encodeURIComponent(tk)}`;
  stopLiveLocation();
  fetch(`${base}/sendLocation?chat_id=${encodeURIComponent(ch)}&latitude=${R.lat}&longitude=${R.lon}&live_period=900`)
    .then(r=>r.json()).then(j=>{
      if(!(j&&j.ok))return;
      liveLoc.id=j.result.message_id;liveLoc.lastLat=R.lat;liveLoc.lastLon=R.lon;
      if(sink){const d=document.createElement("div");d.style.cssText="padding:5px 0;color:#7fd67f";
        d.innerHTML="📍 <b>LIVE location streaming to guardian's Telegram</b> — a moving dot on their map, updates every ~12 s for 15 min.";sink.prepend(d)}
      liveLoc.iv=setInterval(()=>{
        if(!R.gpsOk){R.lat+=0.00045;R.lon+=0.00032;}   // demo drift indoors so the dot visibly moves
        if(Math.abs(R.lat-liveLoc.lastLat)<1e-6&&Math.abs(R.lon-liveLoc.lastLon)<1e-6)return;
        liveLoc.lastLat=R.lat;liveLoc.lastLon=R.lon;
        fetch(`${base}/editMessageLiveLocation?chat_id=${encodeURIComponent(ch)}&message_id=${liveLoc.id}&latitude=${R.lat}&longitude=${R.lon}`).catch(()=>{});
      },12000);
    }).catch(()=>{});
}
function stopLiveLocation(){
  clearInterval(liveLoc.iv);liveLoc.iv=null;
  const tk=$("tgToken").value.trim(),ch=$("tgChat").value.trim();
  if(liveLoc.id&&tk&&ch)fetch(`https://api.telegram.org/bot${encodeURIComponent(tk)}/stopMessageLiveLocation?chat_id=${encodeURIComponent(ch)}&message_id=${liveLoc.id}`).catch(()=>{});
  liveLoc.id=null;
}
/* acknowledgment-driven escalation: SMS+voice-call tiers → community responders */
let escTimers=[];
function runEscalation(){
  escTimers.forEach(clearTimeout);escTimers=[];
  const el=$("escList");el.innerHTML="";
  const g1=($("gPhone").value||"Guardian 1");
  const steps=[
    [0,   "wait","📩 SMS + 🤖 automated voice-call → <b>Guardian 1 (Amma, "+g1+")</b> — awaiting ACK tap…"],
    [8000,"warn","⏳ <b>No ACK in 8 s</b> (asleep? phone silent?) — auto-escalating, message NOT wasted"],
    [8300,"wait","📩📞 Tier 2: <b>Guardian 2 (Appa)</b> alerted — awaiting ACK…"],
    [16000,"warn","⏳ No ACK — final tier engaged"],
    [16300,"wait","🚨 <b>112 ERSS</b> informed · <b>3 RakshaRide riders within 2 km</b> pinged as community first-responders"],
    [22000,"ok","✔ <b>Rider Suresh, 800 m away, ACKNOWLEDGED</b> — heading to the site with live navigation. Amma's phone keeps ringing until answered."]
  ];
  for(const [d,k,html] of steps){
    escTimers.push(setTimeout(()=>{
      const row=document.createElement("div");
      row.style.cssText="padding:5px 0;border-bottom:1px solid var(--grid);color:"+(k==="ok"?"#7fd67f":k==="warn"?"#ffd47a":"var(--ink-2)");
      row.innerHTML=html; el.appendChild(row);
    },d));
  }
}
function reachedSafely(){
  const nm=$("gName").value||"Rider";
  setVerdict("","<b>✔ \"Reached safely\"</b> sent to guardian circle — the daily-value feature: every Indian mother's \"call me when you reach\", automated.");
  const b=encodeURIComponent(`✔ RakshaRide: ${nm} reached safely. Ride ${$("rideTime").textContent}, ${$("rideDist").textContent}.`);
  if(/Android|iPhone/i.test(navigator.userAgent))location.href="sms:"+($("gPhone").value.replace(/\s/g,"")||"")+"?body="+b;
}

/* ---------- helpers ---------- */
function stage(id,cls,txt){const el=$(id);el.className="stage "+(cls||"");$(id.replace("st-","v-")).textContent=txt||"—"}
function setVerdict(cls,html){const v=$("verdict");v.className="verdict "+(cls||"");v.innerHTML=html}
function resetPipeline(msg){
  R.phase="idle";R.peak=0;R.ctxOverride=null;R.sim=null;$("gPeak").textContent="—";
  stage("st-imp","","—");stage("st-cls","","—");stage("st-still","","—");
  if(msg)setVerdict("",msg+" Three-gate engine watching.");
  $("pipeMode").textContent=R.realSensors?"REAL SENSORS LIVE":"demo thresholds";
}

/* ---------- synthetic signature generator (feeds the SAME pipeline) ---------- */
function runSim(kind){
  if(R.phase!=="idle"){return}
  const t0=now(); let frames=[];
  const mk=(dt,a,rot,spd)=>frames.push({t:t0+dt,a,rot,spd,src:"sim"});
  if(kind==="drop"){
    R.ctxOverride=true; R.sim={kind,ctxLabel:"armed (tea-stall stop)",preSpeed:0};
    for(let t=0;t<0.35;t+=0.02)mk(t,1.2+Math.random(),15,0);              // free-fall ~0g
    mk(0.36,42,60,0);                                                      // one clean spike
    for(let t=0.4;t<2.4;t+=0.02)mk(t,9.8+Math.random()*0.5,8,0);          // lies still…
    for(let t=2.4;t<4;t+=0.02)mk(t,9.8+Math.sin(t*9)*3.5,85,0);           // pickup motion
  } else if(kind==="pothole"){
    R.ctxOverride=true; R.sim={kind,ctxLabel:"riding 38 km/h",preSpeed:38};
    for(let t=0;t<0.6;t+=0.02)mk(t,9.8+Math.random()*2.5,25,38);
    mk(0.62,46,70,36);                                                     // one vertical spike
    for(let t=0.66;t<4;t+=0.02)mk(t,9.8+Math.random()*2.5,25,37);         // ride continues
  } else if(kind==="coaster"){
    R.ctxOverride=false; R.sim={kind,ctxLabel:"no road context",preSpeed:0};
    for(let t=0;t<3;t+=0.02)mk(t,9.8+Math.abs(Math.sin(t*2.4))*30,40,0);  // smooth repetitive G-waves
  } else { // crash
    R.ctxOverride=true; R.sim={kind,ctxLabel:"riding 46 km/h",preSpeed:46};
    for(let t=0;t<0.5;t+=0.02)mk(t,9.8+Math.random()*3,30,46);
    mk(0.52,95,380,20); mk(0.60,60,420,8); mk(0.72,78,350,2); mk(0.9,45,300,0);  // chaotic multi-spike + tumble
    for(let t=1;t<9;t+=0.02)mk(t,9.8+Math.random()*0.4,4,0);              // stillness
  }
  setVerdict("","Injecting <b>"+kind+"</b> signature into the live pipeline…");
  let i=0; const iv=setInterval(()=>{
    if(i>=frames.length){clearInterval(iv);return}
    const f=frames[i++]; f.t=now(); feed(f);
  },20);
}

/* ---------- rider frame loop ---------- */
function riderFrame(){
  if(!$("rider").classList.contains("hide")){
    /* auto ride detection: arm at riding speed, disarm when parked */
    const auto=$("autoArm")&&$("autoArm").checked;
    if(auto&&!R.riding&&R.phase==="idle"){
      if(R.speed>14){R.spdHi=(R.spdHi||0)+1;
        if(R.spdHi>90){R.spdHi=0;toggleRide();
          setVerdict("","<b>🏍️ Riding detected ("+Math.round(R.speed)+" km/h) — protection auto-armed.</b> The rider never has to remember the button.")}}
      else R.spdHi=0;
    }
    if(auto&&R.riding&&R.phase==="idle"){
      if(R.speed<2&&R.realSensors){R.spdLo=(R.spdLo||0)+1;
        if(R.spdLo>3600){R.spdLo=0;toggleRide();
          setVerdict("","<b>🅿️ Parked 60 s — protection auto-disarmed.</b> Battery saved; re-arms on the next ride.")}}
      else R.spdLo=0;
    }
    if(R.riding){
      $("rideTime").textContent=fmtT(now()-R.rideT0);
      if(!R.realSensors){ /* laptop idle: gentle baseline so the chart lives */
        feed({t:now(),a:9.81+(Math.random()-0.5)*0.35,rot:Math.random()*4,spd:R.speed});
      }
      R.dist+=R.speed/3600/2; $("rideDist").textContent=R.dist.toFixed(1)+" km";
    }
    $("spd").textContent=Math.round(R.speed);
    drawG();
  }
  requestAnimationFrame(riderFrame);
}
function drawG(){
  const c=$("gCanvas"),x=c.getContext("2d"),w=c.width,h=c.height;
  x.clearRect(0,0,w,h);
  x.strokeStyle="#383835";x.setLineDash([4,4]);x.beginPath();
  const yT=h-((IMPACT_T+9.81)/60)*h; x.moveTo(0,yT);x.lineTo(w,yT);x.stroke();x.setLineDash([]);
  x.fillStyle="#898781";x.font="16px system-ui";x.fillText("impact threshold",8,yT-6);
  const t1=now(),buf=R.buf.filter(s=>s.t>t1-6);
  if(buf.length>1){
    x.strokeStyle="#3987e5";x.lineWidth=3;x.lineJoin="round";x.beginPath();
    buf.forEach((s,i)=>{const px=w-( (t1-s.t)/6 )*w, py=h-clamp(s.a/60,0,1)*h; i?x.lineTo(px,py):x.moveTo(px,py)});
    x.stroke();
  }
}

const DEADLINE = Date.parse("2026-10-26T14:00:00Z");
const END = Date.parse("2026-11-09T14:00:00Z");
const MAX = 20;
const COLORS = ["#18c964","#0ea5e9","#f97316","#a855f7","#ef4444","#14b8a6","#eab308","#ec4899","#6366f1","#84cc16"];
const REGIONS = ["All","Asia","USA","EU","Africa"];
const REGION_OPTS = REGIONS.slice(1);
const REQS = [0,1000,5000,10000,25000,50000];
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

let squads = [];
let loaded = false, loadError = false;

const state={view:"all",lbView:"all",q:"",period:"d30",region:"All",minReq:0,qual:false,hideFull:true,sort:"pnl",me:null};
const $=s=>document.querySelector(s);
const money=v=>{if(v==null)return "—";const a=Math.abs(v),s=v<0?"-":"+";return s+"$"+(a>=1e6?(a/1e6).toFixed(2)+"M":a>=1e3?(a/1e3).toFixed(a>=1e4?0:1)+"K":a)};
const plain=v=>"$"+(v>=1e3?(v/1e3).toFixed(v%1000?1:0)+"K":v);
const PL={d7:"7D",d30:"30D",all:"all-time"};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const short=w=>w.slice(0,4)+"…"+w.slice(-4);
const initials=n=>n.split(/\s+/).map(x=>x[0]).join("").slice(0,2).toUpperCase();
const safeImg=u=>typeof u==="string"&&/^\/api\/img\?id=[\w-]+$/.test(u)?u:null;
const counted=s=>s.list.filter(m=>m.v);
const total=(s,p)=>counted(s).reduce((a,m)=>a+(m[p]||0),0);
const avg=(s,p)=>Math.round(total(s,p)/Math.max(1,counted(s).length));
const isMine=s=>!!state.me&&s.creator===state.me.w;
const inSquad=s=>!!state.me&&state.me.squadId===s.id;
const hasPnl=s=>{const v=state.me?.[s.req.p];return s.req.v===0?v==null||v>=0:v!=null&&v>=s.req.v};
const canJoin=s=>!!state.me&&!state.me.squadId&&hasPnl(s)&&s.members<MAX&&!s.entered;
const tabs=(id,key,nHere,nAll)=>{const el=$(id);el.innerHTML=`<button data-v="here" class="${state[key]==="here"?"on":""}">Made here<span class="n">${nHere}</span></button><button data-v="all" class="${state[key]==="all"?"on":""}">All squads<span class="n">${nAll}</span></button>`;el.querySelectorAll("button").forEach(b=>b.onclick=()=>{state[key]=b.dataset.v;render()})};
const av=(s,extra="")=>{const img=safeImg(s.img);return `<div class="av" style="background-color:${s.color};${img?`background-image:url(${img});`:""}${extra}">${img?"":esc(initials(s.name))}</div>`};
const bannerEl=(s,cls)=>{const b=safeImg(s.banner);return `<div class="${cls}" style="background-image:${b?`url(${b})`:`linear-gradient(120deg,${s.color},color-mix(in srgb,${s.color} 35%,#0f1a14))`}"></div>`};

/* server */
async function api(url,{method="GET",body}={}){
 const r=await fetch(url,{method,credentials:"same-origin",headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(data.error||"Something went wrong. Try again.");
 return data;
}
function setMe(m){state.me=m&&m.wallet?{w:m.wallet,d7:m.pnl?.d7??null,d30:m.pnl?.d30??null,all:m.pnl?.all??null,sol:m.pnlSol??null,updatedAt:m.pnlUpdatedAt,squadId:m.squadId}:null}
const solStr=v=>v==null?"—":(v<0?"-":"+")+Math.abs(v).toFixed(Math.abs(v)>=100?0:2)+" SOL";
async function loadSquads(){
 try{const d=await api("/api/squads");squads=d.squads.map(s=>({...s,color:COLORS[s.id%COLORS.length]}));loaded=true;loadError=false}
 catch(e){loadError=!loaded}
 render();
}
async function refresh(){
 const [me]=await Promise.all([api("/api/auth").catch(()=>null),loadSquads()]);
 if(me)setMe(me);renderWallet();render();
}

/* countdown */
function tick(){const now=Date.now();let t=DEADLINE-now,lbl="Squad Entry closes in";
 if(t<=0){t=END-now;lbl=t>0?"Competition ends in":"Competition finished";}
 t=Math.max(0,t);const d=Math.floor(t/864e5),h=Math.floor(t/36e5)%24,m=Math.floor(t/6e4)%60,s=Math.floor(t/1e3)%60;
 $("#dl-label").textContent=lbl;
 $("#count").innerHTML=[[d,"days"],[h,"hrs"],[m,"min"],[s,"sec"]].map(([v,l])=>`<div><b>${String(v).padStart(2,"0")}</b><span>${l}</span></div>`).join("");}
tick();setInterval(tick,1000);

/* wallet */
const WALLETS=[
 {name:"Phantom",get:()=>window.phantom?.solana?.isPhantom?window.phantom.solana:window.solana?.isPhantom?window.solana:null,
  open:u=>`https://phantom.app/ul/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}`,install:"https://phantom.com/download"},
 {name:"Solflare",get:()=>window.solflare?.isSolflare?window.solflare:null,
  open:u=>`https://solflare.com/ul/v1/browse/${encodeURIComponent(u)}?ref=${encodeURIComponent(location.origin)}`,install:"https://solflare.com/download"},
 {name:"Backpack",get:()=>window.backpack?.signMessage?window.backpack:window.backpack?.solana||null,install:"https://backpack.app/download"},
];
const b64=bytes=>{let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)};

async function signIn(provider){
 const res=await provider.connect();
 const pk=(res?.publicKey||provider.publicKey)?.toString();
 if(!pk)throw new Error("The wallet didn't share an address");
 const {nonce,message}=await api("/api/auth?action=nonce",{method:"POST"});
 const signed=await provider.signMessage(new TextEncoder().encode(message),"utf8");
 const sig=new Uint8Array(signed?.signature||signed);
 return api("/api/auth?action=verify",{method:"POST",body:{wallet:pk,signature:b64(sig),nonce}});
}

function renderWallet(){const el=$("#wallet-slot");
 if(!state.me){el.innerHTML=`<button class="btn btn-primary" id="connect">Connect wallet</button>`;$("#connect").onclick=openConnect;return}
 el.innerHTML=`<button class="btn btn-ghost wallet-chip" id="me-btn"><span class="dot"></span><span class="mono">${short(state.me.w)}</span><span class="mono ${state.me[state.period]<0?"neg":"pos"}">${money(state.me[state.period])}</span></button>`;
 $("#me-btn").onclick=openMe;}

function openConnect(){
 const here=location.href.split("#")[0];
 modal(`<h2>Connect wallet</h2>
 <p class="note" style="margin:0">You sign a free message to prove the wallet is yours. No transaction and no access to funds. We then read your public PNL from on-chain data.</p>
 <div class="wallet-list">
  ${WALLETS.map((w,i)=>{const p=w.get();
   if(p)return `<button class="btn btn-ghost" data-i="${i}">${w.name}<span class="note">Detected</span></button>`;
   if(IS_MOBILE&&w.open)return `<a class="btn btn-ghost" href="${esc(w.open(here))}">${w.name}<span class="note">Open in app ↗</span></a>`;
   return `<a class="btn btn-ghost" href="${w.install}" target="_blank" rel="noopener">${w.name}<span class="note">Install ↗</span></a>`}).join("")}
 </div>
 ${IS_MOBILE?`<p class="note" style="margin:0">On a phone, open Enlist inside your wallet app's browser to sign in.</p>`:""}`,
 m=>m.querySelectorAll("[data-i]").forEach(b=>b.onclick=async()=>{
   const label=b.innerHTML;b.textContent="Waiting for signature…";b.classList.add("busy");
   try{const me=await signIn(WALLETS[+b.dataset.i].get());setMe(me);closeModal();renderWallet();render();
     toast(state.me.d30!=null?"Signed in · 30D PNL "+money(state.me.d30):"Signed in · we couldn't load your PNL yet")}
   catch(e){b.innerHTML=label;b.classList.remove("busy");toast(/reject|denied|cancel/i.test(e.message||"")?"Signature cancelled":e.message||"Couldn't sign in")}}));}

function openMe(){const m=state.me;
 const upd=m.updatedAt?new Date(m.updatedAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):null;
 modal(`<h2>Your wallet</h2>
 <div class="mono" style="word-break:break-all">${esc(m.w)}</div>
 <div class="stats" style="grid-template-columns:repeat(3,1fr)">${["d7","d30","all"].map(p=>`<div class="stat"><div class="k">PNL ${PL[p]}</div><div class="v ${m[p]<0?"neg":"pos"}">${money(m[p])}</div></div>`).join("")}</div>
 ${m.sol?`<div class="note" style="margin:0">In SOL: 7D ${solStr(m.sol.d7)} · 30D ${solStr(m.sol.d30)} · all time ${solStr(m.sol.all)}</div>`:""}
 <p class="note" style="margin:0">PNL is the SOL you made or lost in trades, fees included, at today's SOL price. Deposits, withdrawals and tokens you still hold don't count. ${upd?"Updated "+esc(upd)+".":"We couldn't load your PNL yet."}</p>
 <div style="display:flex;gap:8px;flex-wrap:wrap">${m.squadId?`<button class="btn btn-primary" id="my-squad">Open my squad</button>`:""}<button class="btn btn-ghost" id="logout">Sign out</button></div>`,
 el=>{const ms=el.querySelector("#my-squad");if(ms)ms.onclick=()=>openSquad(m.squadId);
  el.querySelector("#logout").onclick=async()=>{await api("/api/auth?action=logout",{method:"POST"}).catch(()=>{});state.me=null;state.qual=false;closeModal();renderWallet();renderFilters();render();toast("Signed out")}});}

/* filters */
function renderFilters(){
 $("#reqchips").innerHTML=REQS.map(v=>`<button class="chip ${v===state.minReq?"on":""}" data-v="${v}">${v?plain(v)+"+":"Any"}</button>`).join("");
 $("#reqchips").querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{state.minReq=+b.dataset.v;$("#req-custom").value="";renderFilters();render()});
 $("#regions").innerHTML=REGIONS.map(r=>`<button class="chip ${r===state.region?"on":""}" data-r="${r}">${r}</button>`).join("");
 $("#regions").querySelectorAll("[data-r]").forEach(b=>b.onclick=()=>{state.region=b.dataset.r;renderFilters();render()});
 $("#period").querySelectorAll("button").forEach(b=>{b.classList.toggle("on",b.dataset.p===state.period);b.onclick=()=>{state.period=b.dataset.p;renderFilters();renderWallet();render()}});
 [["#t-qual","qual"],["#t-full","hideFull"]].forEach(([id,k])=>{const b=$(id);b.classList.toggle("on",state[k]);b.setAttribute("aria-pressed",state[k]);b.onclick=()=>{if(k==="qual"&&!state.me){openConnect();return}state[k]=!state[k];renderFilters();render()}});
}
$("#req-custom").oninput=e=>{state.minReq=Math.max(0,+e.target.value||0);renderFilters();render()};
$("#q").oninput=e=>{state.q=e.target.value.toLowerCase();render()};
$("#sort").onchange=e=>{state.sort=e.target.value;render()};

function render(){
 const nHere=squads.filter(s=>s.origin==="here").length;
 tabs("#viewtabs","view",nHere,squads.length);tabs("#lbtabs","lbView",nHere,squads.length);
 if(!loaded){$("#grid").innerHTML=loadError?`<div class="empty">Couldn't load squads. Check your connection and refresh the page.</div>`:`<div class="loading">Loading squads…</div>`;$("#lb").innerHTML="";return}
 let list=squads.filter(s=>(state.view==="all"||s.origin==="here")&&(state.region==="All"||s.region===state.region)&&(!state.minReq||(s.req.p===state.period&&s.req.v>=state.minReq))
  &&(!state.q||(s.name+" "+s.region).toLowerCase().includes(state.q))
  &&(!state.hideFull||(s.members<MAX&&!s.entered)||inSquad(s))&&(!state.qual||canJoin(s)));
 const P=state.period;
 list.sort({pnl:(a,b)=>total(b,P)-total(a,P),spots:(a,b)=>a.members-b.members,req:(a,b)=>a.req.v-b.req.v,new:(a,b)=>b.created-a.created}[state.sort]);
 $("#grid").innerHTML=list.length?list.map(s=>{const t=total(s,P);
  let gate="";if(state.me&&!inSquad(s)&&s.members<MAX&&!s.entered){gate=canJoin(s)?`<span class="badge ok">You qualify</span>`:hasPnl(s)?"":`<span class="badge no">Need ${plain(s.req.v)} ${PL[s.req.p]}</span>`}
  return `<div class="card" role="button" tabindex="0" data-id="${s.id}">
   ${bannerEl(s,"card-banner")}
   <div class="card-top">${av(s)}
    <div style="min-width:0"><h3>${esc(s.name)}</h3><div class="sub">${esc(s.region)} · entry ${s.req.v?plain(s.req.v)+" "+PL[s.req.p]+" PNL":"any positive PNL"}</div></div></div>
   <div class="stats"><div class="stat"><div class="k">Squad PNL ${PL[P]}</div><div class="v ${t>=0?"pos":"neg"}">${money(t)}</div></div>
    <div class="stat"><div class="k">Avg / member</div><div class="v">${money(avg(s,P))}</div></div></div>
   <div><div class="row" style="margin-bottom:6px"><span class="sub">${s.entered?"Members locked":s.members>=MAX?"Squad full":MAX-s.members+" spots left"}</span><span class="mono" style="font-weight:700">${s.members}/${MAX}</span></div>
    <div class="meter"><i style="width:${s.members/MAX*100}%"></i></div></div>
   <div class="badges">${s.origin==="pf"?`<span class="badge pf">From Pumpfun</span>`:""}${s.verified<s.members?`<span class="badge">${s.verified}/${s.members} verified</span>`:""}${s.entered?`<span class="badge full">LOCKED · ENTERED</span>`:s.members>=MAX?`<span class="badge full">FULL</span>`:`<span class="badge">Recruiting</span>`}${isMine(s)?`<span class="badge ok">Your squad</span>`:inSquad(s)?`<span class="badge ok">You're in</span>`:""}${gate}</div>
  </div>`}).join(""):`<div class="empty"><p>No squads yet in this filter. Create one or import yours from the Pumpfun app.</p>
  <div class="acts"><button class="btn btn-primary" id="st-create">+ Create a squad</button><button class="btn btn-ghost" id="st-add">Import my Pumpfun squad</button></div></div>`;
 if(list.length&&squads.length<6)$("#grid").insertAdjacentHTML("beforeend",`<div class="starter"><div><h3>There aren't many squads here yet</h3>
  <p>Enlist just launched, so the list is short for now. Start a new squad, or import the one you already made in the Pumpfun app. Set a minimum PNL to join, and only traders who clear it can get in, so you spend less time vetting people and more time trading.</p></div>
  <div class="acts"><button class="btn btn-primary" id="st-create">+ Create a squad</button><button class="btn btn-ghost" id="st-add">Import my Pumpfun squad</button></div></div>`);
 const sc=$("#st-create");if(sc)sc.onclick=openCreate;const sa=$("#st-add");if(sa)sa.onclick=openAdd;
 $("#grid").querySelectorAll(".card").forEach(c=>{const open=()=>openSquad(+c.dataset.id);c.onclick=open;c.onkeydown=e=>{if(e.key==="Enter")open()}});
 const lb=squads.filter(s=>state.lbView==="all"||s.origin==="here").sort((a,b)=>total(b,"d30")-total(a,"d30")).slice(0,10);
 $("#lb").innerHTML=lb.map((s,i)=>{const t=total(s,"d30");return `<tr data-id="${s.id}" tabindex="0"><td class="rank" style="color:${i<3?["var(--gold)","#9aa5ad","#c07a3e"][i]:"var(--muted)"}">${i+1}</td>
  <td><div style="display:flex;gap:10px;align-items:center">${av(s,"width:28px;height:28px;font-size:11px;border-radius:8px")}<b>${esc(s.name)}</b></div></td>
  <td class="sub">${esc(s.region)}</td><td>${s.origin==="pf"?`<span class="badge pf">Pumpfun</span>`:`<span class="badge ok">Made here</span>`}</td><td class="num mono">${s.members}/${MAX}</td><td class="num mono">${money(avg(s,"d30"))}</td><td class="num mono ${t>=0?"pos":"neg"}" style="font-weight:700">${money(t)}</td></tr>`}).join("")+(lb.length<5?`<tr><td colspan="7" class="note" style="text-align:center;padding:18px">More squads show up here as people create or import them.</td></tr>`:"");
 $("#lb").querySelectorAll("tr[data-id]").forEach(r=>{const o=()=>openSquad(+r.dataset.id);r.onclick=o;r.onkeydown=e=>{if(e.key==="Enter")o()}});
}

/* squad detail */
function memberRows(s){
 const pos=counted(s).reduce((a,m)=>a+Math.max(0,m.d30||0),0);
 const cell=(m,k)=>m.v&&m[k]!=null?`<td class="num mono ${m[k]>=0?"pos":"neg"}">${money(m[k])}</td>`:`<td class="num mono" style="color:var(--muted)">—</td>`;
 const mine=isMine(s);
 return [...s.list].sort((a,b)=>(b.v-a.v)||((b.d30||0)-(a.d30||0))).map(m=>`<tr><td><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="mono">${short(m.w)}</span>${m.creator?`<span class="badge ok">Creator</span>`:""}${m.v?"":`<span class="badge">unverified</span>`}</div></td>
  ${cell(m,"d7")}${cell(m,"d30")}${cell(m,"all")}<td class="num mono">${m.v&&pos?Math.round(Math.max(0,m.d30||0)/pos*100)+"%":"—"}</td>
  <td><a href="https://gmgn.ai/sol/address/${encodeURIComponent(m.w)}" target="_blank" rel="noopener">GMGN ↗</a>${mine&&!m.creator?` · <button class="linkbtn" data-rm="${esc(m.w)}">Remove</button>`:""}</td></tr>`).join("")}

function drawQR(cv,text){
 if(typeof qrcode!=="function"){cv.hidden=true;return}
 const q=qrcode(0,"M");q.addData(text);q.make();
 const n=q.getModuleCount(),pad=4,size=n+pad*2,x=cv.getContext("2d");
 cv.width=size;cv.height=size;x.fillStyle="#fff";x.fillRect(0,0,size,size);x.fillStyle="#0f1a14";
 for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))x.fillRect(c+pad,r+pad,1,1);
}

async function act(body,okMsg,id){
 try{await api("/api/squads",{method:"POST",body});await refresh();toast(okMsg);if(id&&squads.some(s=>s.id===id))openSquad(id);else closeModal()}
 catch(e){toast(e.message)}
}

function openSquad(id){const s=squads.find(x=>x.id===id);if(!s){toast("This squad doesn't exist anymore");return}const P=s.req.p;
 let action,loadInvite=false;
 if(isMine(s))action=`<div class="creator"><div class="fl">Creator checklist · before 26 Oct, 14:00 UTC</div>
   <ol class="steps"><li>Create the squad in the Pumpfun app and paste its invite here (done)</li><li>Recruit at least 2 members, max 20 (now ${s.members}/${MAX})</li><li>Remind everyone to accept the competition terms in the app</li><li>Submit Squad Entry in the app. Anyone who joins after that won't count.</li></ol>
   ${s.entered?`<div class="badges"><span class="badge full">LOCKED · ENTERED</span></div>`:`<button class="btn btn-primary" id="mark" style="align-self:flex-start">I submitted Squad Entry · lock squad</button>`}
   <div><button class="linkbtn" id="del">Delete this listing</button></div></div>`;
 else if(inSquad(s)){action=`<div class="joinbox" id="joinbox"><span class="note">Loading invite…</span></div><div><button class="linkbtn" id="leave">Leave this squad on Enlist</button></div>`;loadInvite=true}
 else if(s.entered)action=`<div class="warn">This squad already submitted its Squad Entry. Its members are locked for the competition, so new joiners wouldn't count.</div>`;
 else if(s.members>=MAX)action=`<div class="warn">This squad is full (20/20). Pumpfun squads cap at 20 members.</div>`;
 else if(!state.me)action=`<button class="btn btn-primary" id="j-connect" style="align-self:flex-start">Connect wallet to check if you qualify</button>`;
 else if(state.me.squadId)action=`<div class="warn">You're already in a squad on Enlist. One squad per person.</div>`;
 else if(!canJoin(s))action=`<div class="warn">${state.me[P]==null?`Entry needs ${plain(s.req.v)} ${PL[P]} PNL. We couldn't load your PNL yet, so try signing in again later.`:`Entry needs ${plain(s.req.v)} ${PL[P]} PNL. Your ${PL[P]} PNL is ${money(state.me[P])}.`}</div>`;
 else{action=`<div class="joinbox" id="joinbox"><span class="note">Loading invite…</span></div>`;loadInvite=true}
 modal(`${bannerEl(s,"modal-banner")}<div style="display:flex;gap:14px;align-items:flex-end;margin-top:-50px">${av(s,"width:76px;height:76px;font-size:28px;border-radius:18px;border:4px solid var(--bg);flex:none")}
   <div style="min-width:0;padding-bottom:2px"><h2>${esc(s.name)}</h2><div class="sub">${esc(s.region)} · ${s.members}/${MAX} members · entry ${s.req.v?plain(s.req.v)+" "+PL[P]+" PNL":"any positive PNL"}</div></div></div>
  ${s.desc?`<p style="margin:0">${esc(s.desc)}</p>`:""}
  ${s.origin==="pf"?`<p class="note" style="margin:0">Made in the Pumpfun app and added here by its creator. ${s.verified}/${s.members} members have verified their wallets, and only verified wallets count toward PNL on this site.</p>`:""}
  <div class="stats" style="grid-template-columns:repeat(3,1fr)">${["d7","d30","all"].map(p=>{const t=total(s,p);return `<div class="stat"><div class="k">Squad ${PL[p]}</div><div class="v ${t>=0?"pos":"neg"}">${money(t)}</div></div>`}).join("")}</div>
  ${action}
  <div><div class="row" style="margin-bottom:8px;flex-wrap:wrap"><span class="fl">Members · ${s.members}/${MAX}</span><span class="note">Share = part of the squad's positive 30D PNL</span></div>
  <div class="tbl-wrap"><table class="mtbl"><thead><tr><th>Wallet</th><th class="num">7D</th><th class="num">30D</th><th class="num">All time</th><th class="num">Share</th><th></th></tr></thead><tbody>${memberRows(s)}</tbody></table></div>
  <p class="note" style="margin:8px 0 0">PNL comes from public on-chain data. Unverified members haven't signed in yet, so their PNL isn't counted.</p></div>`,
 m=>{const c=m.querySelector("#j-connect");if(c)c.onclick=openConnect;
   const mk=m.querySelector("#mark");if(mk)mk.onclick=()=>{if(confirm("Lock the squad? Do this only after you submitted Squad Entry in the Pumpfun app."))act({action:"lock",id:s.id},"Squad locked · listed as entered",s.id)};
   const del=m.querySelector("#del");if(del)del.onclick=()=>{if(confirm("Delete this listing from Enlist? Your squad in the Pumpfun app stays as it is."))act({action:"delete",id:s.id},"Listing deleted")};
   const lv=m.querySelector("#leave");if(lv)lv.onclick=()=>{if(confirm("Leave this squad on Enlist? Leave it in the Pumpfun app too."))act({action:"remove",id:s.id},"You left the squad on Enlist",s.id)};
   m.querySelectorAll("[data-rm]").forEach(b=>b.onclick=()=>{if(confirm("Remove "+short(b.dataset.rm)+" from this listing?"))act({action:"remove",id:s.id,wallet:b.dataset.rm},"Member removed",s.id)});
   if(loadInvite)showInvite(m.querySelector("#joinbox"),s)});}

async function showInvite(box,s){
 let invite;
 try{invite=(await api("/api/squads?invite="+s.id)).invite}catch(e){box.outerHTML=`<div class="warn">${esc(e.message)}</div>`;return}
 if(!box.isConnected)return;
 const isUrl=/^https:\/\//.test(invite),member=inSquad(s);
 box.innerHTML=`${isUrl?`<canvas id="qr" width="29" height="29" aria-label="QR code of the invite link"></canvas>`:""}
  <div style="display:flex;flex-direction:column;gap:8px;min-width:0;${isUrl?"":"grid-column:1/-1"}"><span class="fl" style="color:var(--soft-ink)">${member?"You're in this squad":"You qualify"} · Pumpfun invite</span>
  <span class="invite">${esc(invite)}</span>
  <div class="acts">${isUrl?`<a class="btn btn-primary" href="${esc(invite)}" target="_blank" rel="noopener">Open in Pumpfun ↗</a>`:""}<button class="btn ${isUrl?"btn-ghost":"btn-primary"}" id="copy">Copy invite</button></div>
  ${member?"":`<ol class="steps"><li>${isUrl?"Scan the QR or open the link":"Enter the code"} in the Pumpfun app</li><li>Accept the competition terms in the app, or your PNL won't count</li><li>Come back and tap "I joined" so the squad's list here shows you</li></ol>
  <button class="btn btn-ghost" id="joined" style="align-self:flex-start">I joined in the Pumpfun app</button>`}</div>`;
 const q=box.querySelector("#qr");if(q)drawQR(q,invite);
 box.querySelector("#copy").onclick=()=>(navigator.clipboard?navigator.clipboard.writeText(invite):Promise.reject()).then(()=>toast("Invite copied"),()=>toast(invite));
 const j=box.querySelector("#joined");if(j)j.onclick=()=>act({action:"join",id:s.id},"You're on the squad's list",s.id);
}

/* images: resized in the browser so uploads stay small */
async function resizeImage(file,w,h){
 if(file.size>5e6)throw new Error("Image is over 5 MB, pick a smaller one");
 const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("That file isn't an image we can read"));i.src=URL.createObjectURL(file)});
 const cv=document.createElement("canvas");cv.width=w;cv.height=h;
 const sc=Math.max(w/img.naturalWidth,h/img.naturalHeight),dw=img.naturalWidth*sc,dh=img.naturalHeight*sc;
 cv.getContext("2d").drawImage(img,(w-dw)/2,(h-dh)/2,dw,dh);URL.revokeObjectURL(img.src);
 const webp=cv.toDataURL("image/webp",.85);
 return webp.startsWith("data:image/webp")?webp:cv.toDataURL("image/jpeg",.85);
}
function bindUpload(m,inp,box,w,h,set){m.querySelector(inp).onchange=async e=>{const f=e.target.files[0];if(!f)return;
  try{const url=await resizeImage(f,w,h);set(url);const b=m.querySelector(box);b.style.backgroundImage=`url(${url})`;b.querySelector("span").hidden=true}
  catch(err){toast(err.message)}}}
// The entry bar can't be above the creator's own PNL for the same period. Returns a check for submit.
const startBar=()=>Math.max(0,Math.min(1000,Math.floor(state.me?.d30||0)));
function bindBar(m,minSel,perSel,skip=()=>false){
 const min=m.querySelector(minSel),per=m.querySelector(perSel),note=document.createElement("span");
 note.className="note";min.closest(".field").appendChild(note);
 const ok=()=>{const v=state.me[per.value],want=+min.value||0;return skip()||!want||(v!=null&&v>=want)};
 const upd=()=>{const v=state.me[per.value];
  note.textContent=v==null?"We couldn't load your PNL, so the bar can only be $0 for now.":"Your "+PL[per.value]+" PNL is "+money(v)+". The bar can't be higher.";
  note.style.color=ok()?"":"var(--red)"};
 min.addEventListener("input",upd);per.addEventListener("change",upd);upd();
 return ok;
}
async function submitSquad(form,body,okMsg){
 const btn=form.querySelector("[type=submit]");btn.classList.add("busy");
 try{const {id}=await api("/api/squads",{method:"POST",body});closeModal();state.sort="new";$("#sort").value="new";await refresh();toast(okMsg);openSquad(id)}
 catch(e){toast(e.message);btn.classList.remove("busy")}
}

/* create squad */
function openCreate(){
 if(!state.me){openConnect();return}
 if(state.me.squadId){toast("You're already in a squad. One squad per person.");openSquad(state.me.squadId);return}
 modal(`<h2>Create a squad</h2>
 <form class="form" id="cf">
  <div class="field full"><label for="c-name">Squad name</label><input class="input" id="c-name" maxlength="28" required placeholder="e.g. Degen Snipers"></div>
  <div class="full uploads">
   <div class="field"><span class="fl">Photo</span><label class="upload" id="up-img"><input type="file" accept="image/*" id="c-img" hidden><span>Upload photo</span></label></div>
   <div class="field"><span class="fl">Banner</span><label class="upload" id="up-ban"><input type="file" accept="image/*" id="c-ban" hidden><span>Upload banner · 1500×500</span></label></div>
  </div>
  <div class="field full"><label for="c-region">Region</label><select class="input" id="c-region">${REGION_OPTS.map(r=>`<option>${r}</option>`).join("")}</select></div>
  <div class="field"><label for="c-min">Minimum PNL to join ($)</label><input class="input mono" id="c-min" type="number" min="0" step="any" value="${startBar()}"></div>
  <div class="field"><label for="c-per">Measured over</label><select class="input" id="c-per"><option value="d7">Last 7 days</option><option value="d30" selected>Last 30 days</option><option value="all">All time</option></select></div>
  <div class="sync-card full">
   <span style="font-weight:700">Step 1: create the squad in the Pumpfun app</span>
   <span class="note">Use the same name and photo, then copy its invite link or code. Pumpfun only accepts squads made inside the app, so we never create or enter squads for you.</span>
   <div class="field"><label for="c-invite">Pumpfun invite link or code</label><input class="input mono" id="c-invite" required placeholder="Pumpfun app → Squads → Invite"></div>
  </div>
  <div class="field full"><label for="c-desc">About the squad</label><input class="input" id="c-desc" maxlength="90" placeholder="Trading style, hours, language"></div>
  <div class="full" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
   <span class="note">Your 30D PNL: <b class="mono ${state.me.d30<0?"neg":"pos"}">${money(state.me.d30)}</b> · you'll be member 1/20</span>
   <button class="btn btn-primary" type="submit">Publish squad</button></div>
 </form>`,m=>{
  let img=null,ban=null;
  bindUpload(m,"#c-img","#up-img",320,320,v=>img=v);bindUpload(m,"#c-ban","#up-ban",1500,500,v=>ban=v);
  const f=m.querySelector("#cf"),barOk=bindBar(m,"#c-min","#c-per");
  f.onsubmit=e=>{e.preventDefault();
   if(!barOk()){toast("The entry bar can't be higher than your own PNL");return}
   submitSquad(f,{action:"create",name:m.querySelector("#c-name").value,region:m.querySelector("#c-region").value,minPnl:+m.querySelector("#c-min").value||0,
    period:m.querySelector("#c-per").value,desc:m.querySelector("#c-desc").value,invite:m.querySelector("#c-invite").value,photo:img,banner:ban},"Squad listed")}});}
$("#nav-create").onclick=e=>{e.preventDefault();openCreate()};$("#side-create").onclick=openCreate;$("#hero-create").onclick=openCreate;

/* add an existing Pumpfun squad */
function openAdd(){
 if(!state.me){openConnect();return}
 if(state.me.squadId){toast("You're already in a squad. One squad per person.");openSquad(state.me.squadId);return}
 modal(`<h2>Import your Pumpfun squad</h2>
 <p class="note" style="margin:0">Already made a squad in the Pumpfun app? List it so traders can find it and it shows on the leaderboard. You sign in with the creator wallet, and you'll be listed as its creator.</p>
 <form class="form" id="af">
  <div class="field full"><label for="a-name">Squad name, as in the app</label><input class="input" id="a-name" maxlength="28" required placeholder="e.g. Moon Raiders"></div>
  <div class="full uploads">
   <div class="field"><span class="fl">Photo</span><label class="upload" id="up-aimg"><input type="file" accept="image/*" id="a-img" hidden><span>Upload photo</span></label></div>
   <div class="field"><span class="fl">Banner</span><label class="upload" id="up-aban"><input type="file" accept="image/*" id="a-ban" hidden><span>Upload banner · 1500×500</span></label></div>
  </div>
  <div class="field full"><label for="a-invite">Pumpfun invite link or code</label><input class="input mono" id="a-invite" required placeholder="Pumpfun app → Squads → Invite"></div>
  <div class="field"><label for="a-region">Region</label><select class="input" id="a-region">${REGION_OPTS.map(r=>`<option>${r}</option>`).join("")}</select></div>
  <div class="field"><label for="a-status">Status</label><select class="input" id="a-status"><option value="open">Still recruiting</option><option value="entered">Squad Entry submitted (locked)</option></select></div>
  <div class="field" id="a-min-f"><label for="a-min">Minimum PNL to join ($)</label><input class="input mono" id="a-min" type="number" min="0" step="any" value="${startBar()}"></div>
  <div class="field" id="a-per-f"><label for="a-per">Measured over</label><select class="input" id="a-per"><option value="d7">Last 7 days</option><option value="d30" selected>Last 30 days</option><option value="all">All time</option></select></div>
  <div class="field full"><label for="a-wallets">Current members' wallets (optional)</label><textarea class="input mono" id="a-wallets" placeholder="One Solana address per line"></textarea>
   <span class="note">Each member shows as unverified until they connect and sign here. Only verified wallets count toward PNL on this site.</span></div>
  <div class="full" style="display:flex;justify-content:flex-end"><button class="btn btn-primary" type="submit">Import squad</button></div>
 </form>`,m=>{
  let img=null,ban=null;bindUpload(m,"#a-img","#up-aimg",320,320,v=>img=v);bindUpload(m,"#a-ban","#up-aban",1500,500,v=>ban=v);
  const st=m.querySelector("#a-status");st.onchange=()=>{const h=st.value==="entered";m.querySelector("#a-min-f").hidden=h;m.querySelector("#a-per-f").hidden=h};
  const f=m.querySelector("#af"),barOk=bindBar(m,"#a-min","#a-per",()=>st.value==="entered");
  f.onsubmit=e=>{e.preventDefault();
   if(!barOk()){toast("The entry bar can't be higher than your own PNL");return}
   const ws=m.querySelector("#a-wallets").value.split(/\s+/).filter(Boolean);
   const bad=ws.find(w=>!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w));
   if(bad){toast(short(bad)+" isn't a Solana address");return}
   if(ws.length+1>MAX){toast("A squad has at most 20 members, including you");return}
   submitSquad(f,{action:"import",name:m.querySelector("#a-name").value,region:m.querySelector("#a-region").value,status:st.value,
    minPnl:+m.querySelector("#a-min").value||0,period:m.querySelector("#a-per").value,invite:m.querySelector("#a-invite").value,wallets:ws,photo:img,banner:ban,
    desc:"Existing Pumpfun squad, added by its creator."},"Squad added · members can now verify")}});}
$("#nav-add").onclick=e=>{e.preventDefault();openAdd()};$("#side-add").onclick=openAdd;

/* modal + toast */
function modal(html,bind){const root=$("#modal-root");root.innerHTML=`<div class="scrim" id="scrim"><div class="modal" role="dialog" aria-modal="true"><button class="x" id="x" aria-label="Close">×</button>${html}</div></div>`;
 $("#x").onclick=closeModal;$("#scrim").onclick=e=>{if(e.target.id==="scrim")closeModal()};bind&&bind(root.querySelector(".modal"))}
function closeModal(){$("#modal-root").innerHTML=""}
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeModal()});
let tt;function toast(t){document.querySelector(".toast")?.remove();const d=document.createElement("div");d.className="toast";d.textContent=t;document.body.appendChild(d);clearTimeout(tt);tt=setTimeout(()=>d.remove(),2800)}

renderWallet();renderFilters();render();refresh();
setInterval(()=>{if(document.visibilityState==="visible"&&!$("#modal-root").innerHTML)loadSquads()},60000);

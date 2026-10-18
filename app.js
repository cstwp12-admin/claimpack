"use strict";
/* ================================================================
   ClaimPack — monthly claim submission. Key in the month's items,
   attach receipts / e-invoices / other support, review the checks,
   generate one submission PDF:
     cover · Admin 27 (company form) · claim summary · document index ·
     supporting documents (numbered 01-R, 01-E, 01-S …)
   No server; everything stays on the device.  Developed by WPN.
   ================================================================ */
const APP_NAME = "ClaimPack";
const APP_VERSION = "0.5.0";
const APP_BUILD = "0.5.0.1"; // must match version.json and the cache name in sw.js
const DEV = "WPN";
/* WhatsApp number for feedback, international format without + (e.g. "60123456789"). Empty: WhatsApp asks which chat to send to. */
const FEEDBACK_WHATSAPP = "60136130919";
const DEFAULT_CHECKER = "Ms. Lily Lian";   // the only place this name is kept: printed in the claim form note line unless changed in Setup
const WHATS_NEW = [
  {v:"0.5.0", t:"Print-friendly pack (black on white, colour only for the 01-R / 01-E / 01-S references). Appendix A cover sheet for the original receipts. Receipt scanner: crop, straighten and clean photos. Receipts keep their own length on the page. Drag and drop on a computer. Feedback on WhatsApp. No signature block on the summary — sign the claim form."},
  {v:"0.4.0", t:"The claim form now prints exactly like the original and fills itself from your items. Several claim types in one submission. Fuel amount = litres × price. New cover and summary pages with a choice of what to show. Receipts are numbered (01-R, 01-E, 01-S), sorted and tiled to match the index. Share-the-app QR code."},
  {v:"0.3.0", t:"Claim form as a native form, optional cover page, CSV export, batch receipt import and optional Gemini AI scanning."},
  {v:"0.2.0", t:"Rebuild on the timesheet app's structure: Records, Help, Setup, flow steps, dock and camera capture."}
];
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const THEME_KEY = "claimpack-theme";
const AI_KEY = "claimpack-ai";
const SET_KEY = "claimpack-settings";
const DEFAULT_MODEL = "gemini-3.5-flash";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_REV = "2026-05-20";
const DB_NAME = "claimpack-local-v1";
const FILE_STORE = "documents";
const META_KEY = "claimpack-v2-data";

/* ---------------- small helpers ---------------- */
const pad2 = n => String(n).padStart(2,"0");
const localToday=()=>{const d=new Date();return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;};
const currentMonth = localToday().slice(0,7);
const safeNum = v => {const n=Number(String(v??"").replace(/,/g,""));return Number.isFinite(n)?n:0;};
const fmt2 = n => safeNum(n).toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2});
const money = n => `RM ${fmt2(n)}`;
const round2 = n => Math.round((safeNum(n)+Number.EPSILON)*100)/100;
const claimMonthLabel=(period,monthFormat="long")=>{const [year,month]=String(period||"").split("-").map(Number);return year&&month?new Date(year,month-1,1).toLocaleString("en",{month:monthFormat,year:"numeric"}):"";};
const monthShift=(period,delta)=>{const [y,m]=(String(period||currentMonth).split("-").map(Number));const d=new Date(y,m-1+delta,1);return `${d.getFullYear()}-${pad2(d.getMonth()+1)}`;};
const dmy = iso => {const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:"";};
const dmyDot = iso => {const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}.${m[2]}.${m[1]}`:"";};
const dShort = iso => {const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return"";return new Date(+m[1],+m[2]-1,+m[3]).toLocaleString("en-GB",{day:"2-digit",month:"short"});};
const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* PDF standard fonts are WinAnsi only — map common characters, drop the rest */
const pdfSafe = s => String(s ?? "").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[–—]/g,"-").replace(/…/g,"...").replace(/[×]/g,"x").replace(/[^\n\x20-\x7E\xA0-\xFF]/g,"");
const uid = () => (crypto.randomUUID?crypto.randomUUID():`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

/* ---------------- claim types (mapped to the Admin 27 lines) ---------------- */
const TYPES = [
  {k:"fuel",       l:"Fuel",                 a27:"s1a", line:"1a", merchant:"Fuel station",        ref:"E-invoice / receipt no.", desc:"Fuel grade",              descPh:"e.g. Diesel Euro 5",            qty:"Litres",   rate:"Price per litre (RM)", qtyStep:"0.001", rateStep:"0.01"},
  {k:"parking",    l:"Parking / toll",       a27:"s1d", line:"1d", merchant:"Operator / location", ref:"Receipt / ref. no.",      desc:"Details",                 descPh:"e.g. Toll plaza, site parking"},
  {k:"carwash",    l:"Car wash / care",      a27:"s1b", line:"1b", merchant:"Shop",                ref:"Receipt no.",             desc:"Details",                 descPh:"e.g. Wash and vacuum"},
  {k:"maint",      l:"Maintenance / service",a27:"s1c", line:"1c", merchant:"Workshop",            ref:"Invoice no.",             desc:"Work done",               descPh:"e.g. 10,000 km service"},
  {k:"transport",  l:"Other transport",      a27:"s1e", line:"1e", merchant:"Provider",            ref:"Receipt no.",             desc:"What it was (printed on the form)", descPh:"e.g. Taxi, e-hailing"},
  {k:"medical",    l:"Medical",              a27:"s2",  line:"2",  merchant:"Clinic / pharmacy",   ref:"Receipt no.",             desc:"Details",                 descPh:"e.g. Outpatient"},
  {k:"telco",      l:"Telecommunication",    a27:"s3",  line:"3",  merchant:"Provider",            ref:"Bill / account no.",      desc:"Bill period",             descPh:"e.g. Mobile bill, Sep 2026"},
  {k:"utilities",  l:"Utilities",            a27:"s4",  line:"4",  merchant:"Provider",            ref:"Bill / account no.",      desc:"Details",                 descPh:"e.g. Site office electricity"},
  {k:"misc",       l:"Misc. expenses",       a27:"s5",  line:"5",  merchant:"Shop / supplier",     ref:"Receipt no.",             desc:"What it was (form line 5a–5c)", descPh:"e.g. Printing, stationery"},
  {k:"outstation", l:"Outstation travel",    a27:"os",  line:"6",  merchant:"Merchant / hotel / airline", ref:"Receipt / booking no.", desc:"Details",              descPh:"e.g. Hotel 2 nights"}
];
const SHORT={fuel:"Fuel",parking:"Parking/toll",carwash:"Car wash",maint:"Maintenance",transport:"Transport",medical:"Medical",telco:"Telecom",utilities:"Utilities",misc:"Misc.",outstation:"Outstation"};
TYPES.forEach(t=>t.s=SHORT[t.k]);
const TYPE = Object.fromEntries(TYPES.map(t=>[t.k,t]));
const typeOf = it => TYPE[it.type] || TYPE.misc;
const LEGACY_TYPE = {"Fuel":"fuel","Travel / mileage":"transport","Accommodation":"outstation","Parking / toll":"parking","Supplies / materials":"misc","Other":"misc"};
const OS_COLS = [["air","Air Ticket"],["hotel","Hotel"],["fares","Fares"],["fb","F & B"],["parking","Parking / Toll"],["mileage","Fuel (Mileage)"],["others","Others"]];
const OS_LABEL = Object.fromEntries(OS_COLS);
const KINDS = [["receipt","R","Receipt"],["invoice","E","E-invoice"],["other","S","Other support"]];
const KIND = Object.fromEntries(KINDS.map(([k,c,l])=>[k,{code:c,label:l}]));
const nameKey = k => `${k}Name`, typeKey = k => `${k}Type`;
const usesVehicle = c => (c.details.claimTypes||[]).some(k=>["fuel","parking","carwash","maint","transport"].includes(k));

/* ---------------- storage ---------------- */
let db;
const store = {claims:{}, currentId:null};
function openDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,1);
    req.onupgradeneeded=()=>req.result.createObjectStore(FILE_STORE);
    req.onsuccess=()=>{db=req.result;resolve();};
    req.onerror=()=>reject(req.error);
  });
}
function putFile(key,value){return new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,"readwrite");tx.objectStore(FILE_STORE).put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function getFile(key){return new Promise((resolve,reject)=>{const req=db.transaction(FILE_STORE).objectStore(FILE_STORE).get(key);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
function deleteFile(key){return new Promise((resolve,reject)=>{const tx=db.transaction(FILE_STORE,"readwrite");tx.objectStore(FILE_STORE).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
const fileKey=(claimId,itemId,kind)=>`${claimId}:${itemId}:${kind}`;
async function deleteItemFiles(claimId,itemId){for(const [k] of KINDS)await deleteFile(fileKey(claimId,itemId,k)).catch(()=>{});}

function settings(){try{return Object.assign({checker:""},JSON.parse(localStorage.getItem(SET_KEY)||"{}"));}catch(e){return{checker:""};}}
const checkerName=()=>String(settings().checker||"").trim()||DEFAULT_CHECKER||"the Admin Department";
function saveSettings(s){try{localStorage.setItem(SET_KEY,JSON.stringify(s));}catch(e){}}

const cur = () => store.claims[store.currentId] || null;
const blankDetails = () => ({period:currentMonth,project:"",projectCode:"",claimant:"",designation:"",claimTypes:["fuel"],ownership:"Company",vehicle:"",submissionDate:localToday()});
const blankItem = type => ({id:uid(),type,date:"",station:"",invoiceNo:"",desc:"",qty:"",rate:"",amount:"",amountManual:false,trip:0,osCol:"others",confirmed:false,created:Date.now()});
const blankOpts = () => ({
  cover:true, coverQr:true, admin27:true, summary:true, index:true, attachments:true, appendix:true,
  sum:{details:true, items:true, colRef:true, colQty:true, colCum:true, byType:true, fuelStats:true, cap:false, capAmount:"600", subsidyPrice:"2.10", remarks:"", declaration:true},
  att:{order:"type", layout:"auto2", stamp:true}
});
function blankOutstation(){return{claimable:"",travelDate:"",travelBy:"",travelByOther:"",fromTo:"",jobNo:"",meeting:"",meetingOther:"",othersLabel:"",rmPerKm:"",air:"",hotel:"",fares:"",fb:"",parking:"",mileage:"",others:""};}
const A27_LINES=["s1a","s1b","s1c","s1d","s1e","s2","s3","s4","s5a","s5b","s5c"];
function blankAdmin27(){return{auto:true,name:"",monthYear:"",vehicleNo:"",vehicleOwn:"",fillSubmitted:true,s1eLabel:"",s5aLbl:"",s5bLbl:"",s5cLbl:"",m:Object.fromEntries(A27_LINES.map(k=>[k,""])),os:[blankOutstation(),blankOutstation(),blankOutstation()]};}

/* bring any older claim (v0.1–v0.3) up to the v0.4 shape */
function upgradeClaim(cl){
  const d=cl.details=Object.assign(blankDetails(),cl.details||{});
  if(!Array.isArray(d.claimTypes)||!d.claimTypes.length){d.claimTypes=[LEGACY_TYPE[d.claimType]||"fuel"];}
  d.claimTypes=d.claimTypes.filter(k=>TYPE[k]);if(!d.claimTypes.length)d.claimTypes=["fuel"];
  const legacy=LEGACY_TYPE[d.claimType]||d.claimTypes[0];
  cl.items=(Array.isArray(cl.items)?cl.items:[]).map((it,i)=>{
    const n=Object.assign(blankItem(it.type||legacy),it);
    if(!it.type){n.type=legacy;if(d.claimType==="Accommodation")n.osCol="hotel";}
    if(n.qty===""&&it.litres!==undefined)n.qty=it.litres;
    if(n.rate===""&&it.price!==undefined)n.rate=it.price;
    if(n.desc===""&&it.fuel!==undefined)n.desc=it.fuel;
    if(it.amountManual===undefined){const au=autoAmount(n);n.amountManual=String(n.amount||"")!==""&&(au===null||Math.abs(au-safeNum(n.amount))>0.005);}
    if(!n.created)n.created=(cl.created||Date.now())+i;
    delete n.litres;delete n.price;delete n.fuel;
    return n;
  });
  if(!cl.opts){cl.opts=blankOpts();if(d.cover===false)cl.opts.cover=false;}
  else{const b=blankOpts(),old=cl.opts.att||{};cl.opts=Object.assign(b,cl.opts);cl.opts.sum=Object.assign(b.sum,cl.opts.sum||{});cl.opts.att=Object.assign(b.att,old);if(!old.layout&&old.perPage)cl.opts.att.layout=attLayout(old);delete cl.opts.att.perPage;delete cl.opts.sum.signatures;}
  const old=cl.admin27;
  if(!old||old.m===undefined){
    const a=blankAdmin27();
    if(old){
      ["name","monthYear","vehicleNo","vehicleOwn","s1eLabel","s5aLbl","s5bLbl","s5cLbl"].forEach(k=>{if(old[k])a[k]=old[k];});
      const hadAmounts=A27_LINES.some(k=>String(old[k]||"").trim());
      A27_LINES.forEach(k=>a.m[k]=old[k]||"");
      (old.os||[]).forEach((o,i)=>{if(!a.os[i])return;const t=a.os[i];Object.assign(t,{claimable:o.claimable||"",travelDate:o.travelDate||"",travelBy:o.travelBy||"",travelByOther:o.travelByOther||"",fromTo:[o.destination,o.fromTo].filter(Boolean).join(" / "),jobNo:o.jobNo||"",meeting:o.meeting||"",meetingOther:o.meetingOther||"",othersLabel:o.othersLabel||"",rmPerKm:o.rmPerKm||"",air:o.airTicket||"",hotel:o.hotel||"",fb:o.fb||"",parking:o.parking||"",mileage:o.fuel||"",others:o.others||""});});
      a.auto=!hadAmounts;
    }
    cl.admin27=a;
  }
  if(!Array.isArray(cl.admin27.os))cl.admin27.os=[];
  while(cl.admin27.os.length<3)cl.admin27.os.push(blankOutstation());
  cl.admin27.os=cl.admin27.os.map(o=>Object.assign(blankOutstation(),o));
  cl.v=4;
  delete d.claimType;delete d.category;delete d.cover;
  return cl;
}
function newClaim(fromClaim=null){
  const id=uid(),details=blankDetails();
  if(fromClaim){
    const f=fromClaim.details;
    Object.assign(details,{project:f.project,projectCode:f.projectCode,claimant:f.claimant,designation:f.designation,claimTypes:[...(f.claimTypes||["fuel"])],ownership:f.ownership,vehicle:f.vehicle});
    const latest=Object.values(store.claims).map(c=>c.details.period).sort().pop()||f.period;
    details.period=monthShift(latest,1);
    details.submissionDate=localToday();
  }
  const cl={id,details,items:[],admin27:blankAdmin27(),opts:fromClaim?JSON.parse(JSON.stringify(fromClaim.opts||blankOpts())):blankOpts(),exported:false,created:Date.now(),v:4};
  if(fromClaim){cl.opts.sum.remarks="";cl.admin27.fillSubmitted=fromClaim.admin27?.fillSubmitted!==false;}
  store.claims[id]=cl;store.currentId=id;
  return cl;
}
function migrateV1(){
  try{
    const raw=localStorage.getItem("claimpack-data-v1");if(!raw)return false;
    const old=JSON.parse(raw);if(!old.details&&!old.items)return false;
    const id=uid(),details=Object.assign({},old.details||{});
    if(details.fuelType&&!details.category){details.category=details.fuelType;delete details.fuelType;}
    store.claims[id]=upgradeClaim({id,details,items:Array.isArray(old.items)?old.items:[],exported:false,created:Date.now()});
    store.currentId=id;localStorage.removeItem("claimpack-data-v1");
    return true;
  }catch(e){console.error("v1 migration failed",e);return false;}
}
let saveTimer=null;
function save(){
  clearTimeout(saveTimer);
  try{localStorage.setItem(META_KEY,JSON.stringify({currentId:store.currentId,claims:store.claims}));}
  catch(error){console.error("Claim could not be saved locally:",error);toast(`Local save failed: ${error.message}`);}
  invalidatePdf();
}
function load(){
  let migrated=false;
  const raw=localStorage.getItem(META_KEY);
  if(raw){
    try{const saved=JSON.parse(raw);store.claims=saved.claims||{};store.currentId=saved.currentId||null;}
    catch(e){console.error("Saved data unreadable",e);}
  }else migrated=migrateV1();
  Object.values(store.claims).forEach(upgradeClaim);
  if(!cur()&&Object.keys(store.claims).length)store.currentId=Object.keys(store.claims)[0];
  if(!cur())newClaim();
  if(migrated)toast("Your earlier claim was moved into Records.");
}

/* ---------------- derived data ---------------- */
const itemTotal = c => round2(c.items.reduce((s,x)=>s+safeNum(x.amount),0));
/* items in submission order: by date, undated last, then by entry order */
function sortedItems(c){
  return [...c.items].sort((a,b)=>{
    if(!a.date&&b.date)return 1; if(a.date&&!b.date)return -1;
    return String(a.date).localeCompare(String(b.date))||(a.created||0)-(b.created||0);
  });
}
function refMap(c){const m={};sortedItems(c).forEach((it,i)=>m[it.id]=pad2(i+1));return m;}
const docCount = it => KINDS.filter(([k])=>it[nameKey(k)]).length;
function itemIssues(c,it){
  const t=typeOf(it),miss=[];
  if(!it.date)miss.push("date");
  if(!String(it.station||"").trim())miss.push(t.merchant.toLowerCase());
  if(!(safeNum(it.amount)>0))miss.push("amount");
  if(it.type==="fuel"){if(!(safeNum(it.qty)>0))miss.push("litres");if(!(safeNum(it.rate)>0))miss.push("price");if(!String(it.invoiceNo||"").trim())miss.push("invoice no.");}
  if(!it.receiptName)miss.push("receipt");
  return miss;
}
const itemReady = (c,it) => !itemIssues(c,it).length && it.confirmed;
function autoAmount(it){const q=safeNum(it.qty),r=safeNum(it.rate);return q>0&&r>0?round2(q*r):null;}

/* Admin 27 amounts — auto from the items, or the keyed-in figures in manual mode */
function a27of(c=cur()){if(!c)return null;if(!c.admin27||c.admin27.m===undefined)upgradeClaim(c);return c.admin27;}
function a27Calc(c=cur()){
  const a=a27of(c),d=c.details;
  const lines=Object.fromEntries(A27_LINES.map(k=>[k,0]));
  const os=a.os.map(o=>({...o,amt:Object.fromEntries(OS_COLS.map(([k])=>[k,0])),km:0}));
  let labels={s1e:a.s1eLabel,s5a:a.s5aLbl,s5b:a.s5bLbl,s5c:a.s5cLbl};
  if(a.auto){
    const s1e=[],misc=[];
    for(const it of sortedItems(c)){
      const t=typeOf(it),amt=safeNum(it.amount);
      if(t.a27==="os"){
        const o=os[Math.min(2,Math.max(0,Number(it.trip)||0))],col=OS_LABEL[it.osCol]?it.osCol:"others";
        o.amt[col]+=amt;if(col==="mileage")o.km+=safeNum(it.qty);
        if(col==="others"&&it.desc&&!o.othersLabel)o.othersLabel=it.desc;
      }else if(t.a27==="s5"){
        const lab=String(it.desc||it.station||"Misc.").trim();
        let g=misc.find(m=>m.label.toLowerCase()===lab.toLowerCase());
        if(!g){g={label:lab,amt:0};misc.push(g);}g.amt+=amt;
      }else{
        lines[t.a27]+=amt;
        if(t.a27==="s1e"){const lab=String(it.desc||it.station||"").trim();if(lab&&!s1e.includes(lab))s1e.push(lab);}
      }
    }
    misc.forEach((g,i)=>{const key=["s5a","s5b","s5c"][Math.min(i,2)];lines[key]+=g.amt;});
    const ml=["s5a","s5b","s5c"].map((k,i)=>i<2?(misc[i]?.label||""):misc.slice(2).map(g=>g.label).join(", "));
    labels={s1e:a.s1eLabel||s1e.join(", "),s5a:a.s5aLbl||ml[0],s5b:a.s5bLbl||ml[1],s5c:a.s5cLbl||ml[2]};
  }else{
    A27_LINES.forEach(k=>lines[k]=safeNum(a.m[k]));
    os.forEach((o,i)=>OS_COLS.forEach(([k])=>o.amt[k]=safeNum(a.os[i][k])));
  }
  A27_LINES.forEach(k=>lines[k]=round2(lines[k]));
  os.forEach(o=>{OS_COLS.forEach(([k])=>o.amt[k]=round2(o.amt[k]));o.total=round2(OS_COLS.reduce((s,[k])=>s+o.amt[k],0));
    if(!o.rmPerKm&&o.km>0&&o.amt.mileage>0)o.rmPerKm=(o.amt.mileage/o.km).toFixed(2);});
  const s1=round2(["s1a","s1b","s1c","s1d","s1e"].reduce((s,k)=>s+lines[k],0));
  const s5=round2(["s5a","s5b","s5c"].reduce((s,k)=>s+lines[k],0));
  const total=round2(s1+lines.s2+lines.s3+lines.s4+s5+os.reduce((s,o)=>s+o.total,0));
  const name=(a.name||`${d.claimant||""}${d.projectCode?` (${d.projectCode})`:""}`).trim();
  const vehicleOn=usesVehicle(c);
  return {name,month:(a.monthYear||claimMonthLabel(d.period)).toUpperCase(),vehicle:a.vehicleNo||(vehicleOn?d.vehicle:""),own:a.vehicleOwn||(vehicleOn&&d.vehicle?d.ownership:""),lines,labels,os,s1,s5,total,
    submittedBy:a.fillSubmitted?(d.claimant||""):"",submittedDate:a.fillSubmitted?dmyDot(d.submissionDate):""};
}

/* ---------------- ui helpers ---------------- */
let toastTimer=null;
function toast(msg){const el=$("#toast");el.textContent=msg;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},3400);}
function busy(on,msg){const el=$("#busy");if(on){$("#busy-msg").textContent=msg||"Working…";el.hidden=false;}else el.hidden=true;}
function openSheet(id){$(id).hidden=false;}
function closeSheet(el){(el.closest?el.closest(".sheet"):$(el)).hidden=true;}

/* ---------------- render ---------------- */
const openItems=new Set();
let addType=null;
function renderMeta(){
  const c=cur();if(!c)return;
  const d=c.details,total=itemTotal(c);
  const docsHave=c.items.reduce((s,x)=>s+docCount(x),0);
  $("#m-name").textContent=claimMonthLabel(d.period)||"—";
  $("#m-sub").textContent=`${d.claimant||"No claimant"} · ${d.project||"No project"}`;
  $("#btn-records-plate").textContent=(d.period||"claim").replace("-","");
  $("#dock-stat").innerHTML=`<b>${money(total)}</b><br>${c.items.length} item${c.items.length===1?"":"s"} · ${docsHave} document${docsHave===1?"":"s"}`;
  $("#credit-line").textContent=`${APP_NAME} v${APP_VERSION} · data stays on this device · developed by ${DEV}`;
  $("#s-version").textContent=`v${APP_VERSION} (${APP_BUILD})`;
  $$(".fb-link").forEach(a=>a.href=feedbackUrl());
}
function flowState(){
  const c=cur(),d=c.details;
  const detailsOk=!!(["period","claimant","designation","project"].every(k=>String(d[k]||"").trim())&&(!(d.claimTypes||[]).includes("fuel")||String(d.vehicle||"").trim()));
  const evidence=c.items.length>0&&c.items.every(x=>x.receiptName);
  const review=evidence&&c.items.every(x=>itemReady(c,x));
  const done=[detailsOk,evidence,review,!!c.exported&&!!latestPdf];
  let curIdx=done.findIndex(x=>!x);if(curIdx<0)curIdx=3;
  return {done,curIdx,detailsOk,evidence,review};
}
function renderFlow(){
  const st=flowState(),c=cur();
  const ready=c.items.filter(x=>itemReady(c,x)).length;
  const names=[["Details","Month, name, types"],["Receipts",`${c.items.filter(x=>x.receiptName).length}/${c.items.length} attached`],["Review",`${ready}/${c.items.length} checked`],["Export",c.exported?"PDF built":"Build the PDF"]];
  $("#flow").innerHTML=names.map(([b,s],i)=>`<button type="button" class="${st.done[i]?"done":st.curIdx===i?"cur":""}"><i>${st.done[i]?"✓":i+1}</i><b>${b}</b><span>${escapeHtml(s)}</span></button>`).join("");
}
function renderTypes(){
  const c=cur(),d=c.details;
  $("#seg-type").innerHTML=TYPES.map(t=>`<button type="button" data-type="${t.k}" aria-pressed="${d.claimTypes.includes(t.k)}">${escapeHtml(t.l)}</button>`).join("");
  $$("[data-own]").forEach(b=>b.setAttribute("aria-pressed",String(d.ownership===b.dataset.own)));
  $("#fuel-fields").hidden=!usesVehicle(c);
  if(!addType||!d.claimTypes.includes(addType))addType=d.claimTypes[0];
  $("#addtype-wrap").hidden=d.claimTypes.length<2;
  $("#seg-addtype").innerHTML=d.claimTypes.map(k=>`<button type="button" data-addtype="${k}" aria-pressed="${k===addType}">${escapeHtml(TYPE[k].l)}</button>`).join("");
  const t=TYPE[addType];
  $("#btn-add").querySelector("b").textContent=`＋ Add ${t.k==="fuel"?"fuel":t.l.toLowerCase()} item`;
  $("#add-sub").textContent=t.k==="fuel"?"Date, station, litres and price — the amount works itself out":"Key in the receipt, then attach it";
}
function fieldHtml(label,field,value,attrs=""){return `<div><label class="lbl">${escapeHtml(label)}</label><input ${attrs} data-field="${field}" value="${escapeHtml(value)}"></div>`;}
function itemCard(c,it,ref){
  const t=typeOf(it),open=openItems.has(it.id),issues=itemIssues(c,it),ready=!issues.length&&it.confirmed;
  const types=[...new Set([...c.details.claimTypes,it.type])];
  const qtyLabel=it.type==="fuel"?t.qty:(it.type==="outstation"&&it.osCol==="mileage"?"Distance (km)":it.type==="outstation"&&it.osCol==="hotel"?"Nights":"Quantity (optional)");
  const rateLabel=it.type==="fuel"?t.rate:(it.type==="outstation"&&it.osCol==="mileage"?"Rate per km (RM)":it.type==="outstation"&&it.osCol==="hotel"?"Rate per night (RM)":"Unit price (optional)");
  const auto=autoAmount(it);
  let calc="";
  if(auto!==null&&!it.amountManual)calc=`<div class="calc"><span class="auto">= ${safeNum(it.qty)} × ${safeNum(it.rate).toFixed(2)} (auto)</span></div>`;
  else if(auto!==null&&it.amountManual&&Math.abs(auto-safeNum(it.amount))>0.005)calc=`<div class="calc"><span>${it.type==="fuel"?"Litres":"Qty"} × price = ${money(auto)}</span><button type="button" data-useauto>Use this</button></div>`;
  else if(it.type==="fuel"&&safeNum(it.amount)>0&&safeNum(it.rate)>0&&!(safeNum(it.qty)>0))calc=`<div class="calc"><span>≈ ${(safeNum(it.amount)/safeNum(it.rate)).toFixed(3)} litres at this price</span><button type="button" data-fillqty>Fill litres</button></div>`;
  const sub=[dShort(it.date)||"No date",t.l,it.type==="fuel"&&safeNum(it.qty)>0?`${safeNum(it.qty).toFixed(3)} L`:"",it.invoiceNo?`No. ${it.invoiceNo}`:""].filter(Boolean).join(" · ");
  const docs=docCount(it);
  const head=`<button class="ihead" type="button" data-toggle aria-expanded="${open}"><span class="ref">${ref}</span><span class="mid"><b>${escapeHtml(it.station||t.l)}</b><span>${escapeHtml(sub)}</span></span><span class="right"><span class="amount">${money(it.amount)}</span><small class="${ready?"ok":"need"}">${ready?"✓ ready":issues.length?`needs ${escapeHtml(issues.slice(0,2).join(", "))}`:"tick to confirm"} · <span class="chips">${KINDS.map(([k,code])=>it[nameKey(k)]?`<span class="chip ${code}">${code}</span>`:"").join("")||'<span class="chip off">no docs</span>'}</span></small></span></button>`;
  if(!open)return `<article class="item ${ready?"ready":""}" data-id="${it.id}">${head}</article>`;
  const osFields=it.type==="outstation"?`
      <div><label class="lbl">Trip on the form</label><select data-field="trip">${[0,1,2].map(i=>`<option value="${i}" ${Number(it.trip)===i?"selected":""}>6${"abc"[i]} — trip ${i+1}</option>`).join("")}</select></div>
      <div><label class="lbl">Form column</label><select data-field="osCol">${OS_COLS.map(([k,l])=>`<option value="${k}" ${it.osCol===k?"selected":""}>${escapeHtml(l)}</option>`).join("")}</select></div>`:"";
  const docBox=(kind)=>{
    const has=it[nameKey(kind)],K=KIND[kind];
    const label=kind==="receipt"?(it.type==="fuel"?"Receipt":"Receipt / bill"):kind==="invoice"?"E-invoice (optional)":"Other support (optional)";
    const isImg=has&&String(it[typeKey(kind)]||"").startsWith("image/");
    return `<div class="doc ${has?"has":""} ${K.code}" data-kind="${kind}"><label class="dl"><span>${label}</span><span class="dref ${K.code}">${ref}-${K.code}</span></label><div class="filemeta">${escapeHtml(has||"Nothing attached")}</div>
      <div class="docrow">
        <label class="btnlike" style="display:inline-flex;align-items:center">${has?"Replace":"Attach"}<input type="file" data-file="${kind}" accept="image/*,application/pdf" hidden></label>
        <button class="btnlike" data-cam="${kind}" type="button">Camera</button>
        ${isImg?`<button class="btnlike" data-crop="${kind}" type="button" title="Crop, straighten and clean up this photo">Crop</button>`:""}
        ${has?`<button class="btnlike" data-view="${kind}" type="button">View</button><button class="btnlike" data-ocr="${kind}" type="button" title="Suggest the date, number and amount from this document">Read</button><button class="btnlike" data-unattach="${kind}" type="button" aria-label="Remove ${label}">✕</button>`:""}
      </div></div>`;
  };
  return `<article class="item open ${ready?"ready":""}" data-id="${it.id}">${head}<div class="ibody">
    <div class="grid">
      ${types.length>1?`<div><label class="lbl">Claim type</label><select data-field="type">${types.map(k=>`<option value="${k}" ${it.type===k?"selected":""}>${escapeHtml(TYPE[k].l)} (form line ${TYPE[k].line})</option>`).join("")}</select></div>`:""}
      <div><label class="lbl">Date</label><input type="date" data-field="date" value="${escapeHtml(it.date)}"></div>
      ${fieldHtml(t.merchant,"station",it.station,'type="text"')}
      ${fieldHtml(t.ref,"invoiceNo",it.invoiceNo,'type="text"')}
      <div><label class="lbl">${escapeHtml(t.desc)}</label><input type="text" data-field="desc" value="${escapeHtml(it.desc)}" placeholder="${escapeHtml(t.descPh||"")}"></div>
      ${osFields}
      ${fieldHtml(qtyLabel,"qty",it.qty,`type="number" inputmode="decimal" min="0" step="${t.qtyStep||"any"}"`)}
      ${fieldHtml(rateLabel,"rate",it.rate,`type="number" inputmode="decimal" min="0" step="${t.rateStep||"any"}"`)}
      <div><label class="lbl">Amount (RM)</label><input type="number" inputmode="decimal" min="0" step="0.01" data-field="amount" value="${escapeHtml(it.amount)}">${calc}</div>
    </div>
    <div class="docs">${KINDS.map(([k])=>docBox(k)).join("")}</div>
    <label class="confirmline"><input type="checkbox" data-confirm ${it.confirmed?"checked":""}><span>I checked the details against the attached documents.</span></label>
    ${issues.length?`<div class="status">Still needed: ${escapeHtml(issues.join(", "))}</div>`:it.confirmed?`<div class="status ok">Ready — prints as ${ref} on the summary, with documents ${KINDS.filter(([k])=>it[nameKey(k)]).map(([k])=>`<span class="dref ${KIND[k].code}">${ref}-${KIND[k].code}</span>`).join(" ")}</div>`:`<div class="status">Tick the box once you have checked this item</div>`}
    <div class="ibtns"><button class="rmbtn" data-dup type="button">Duplicate</button><button class="rmbtn" data-toggle type="button">Collapse</button><button class="rmbtn danger" data-remove type="button">Remove</button></div>
  </div></article>`;
}
function renderItems(){
  const c=cur(),root=$("#entries");
  if(!c.items.length){
    root.innerHTML=`<div class="empty"><b>No claim items yet.</b><span class="small muted">Add one item per receipt. Items are numbered by date (01, 02…) — the same numbers appear on the summary and on each attached document.</span></div>`;
    $("#btn-expand").hidden=true;return;
  }
  $("#btn-expand").hidden=false;
  $("#btn-expand").textContent=c.items.every(x=>openItems.has(x.id))?"Collapse all":"Expand all";
  const refs=refMap(c);
  root.innerHTML=sortedItems(c).map(it=>itemCard(c,it,refs[it.id])).join("");
}
function rerenderItem(id){
  const c=cur(),it=c.items.find(x=>x.id===id),el=document.querySelector(`.item[data-id="${id}"]`);
  if(!it||!el||!el.isConnected)return renderItems();
  const active=document.activeElement,field=active?.dataset?.field,sel=[active?.selectionStart,active?.selectionEnd];
  el.outerHTML=itemCard(c,it,refMap(c)[id]);
  if(field){const n=document.querySelector(`.item[data-id="${id}"] [data-field="${field}"]`);if(n){n.focus();try{n.setSelectionRange(sel[0],sel[1]);}catch(e){}}}
}
function renderStats(){
  const c=cur(),total=itemTotal(c);
  const fuelItems=c.items.filter(x=>x.type==="fuel"),litres=fuelItems.reduce((s,x)=>s+safeNum(x.qty),0);
  const docsHave=c.items.reduce((s,x)=>s+docCount(x),0);
  const st=flowState(),a=a27Calc(c);
  $("#stats").innerHTML=`
    <div class="stat"><b>${money(total)}</b><span>Claim total</span></div>
    <div class="stat"><b>${c.items.length}</b><span>Items</span></div>
    <div class="stat"><b>${docsHave}</b><span>Documents</span></div>
    <div class="stat"><b>${fuelItems.length?litres.toFixed(3):"—"}</b><span>${fuelItems.length?"Litres of fuel":"No fuel items"}</span></div>`;
  const by=byTypeRows(c);
  $("#bytype").innerHTML=by.length>1||c.details.claimTypes.length>1?by.map(r=>`<tr><td>${escapeHtml(r.label)}</td><td class="l">Form line ${escapeHtml(r.line)}</td><td class="n">${r.count}</td><td class="n">${money(r.amount)}</td></tr>`).join(""):"";
  const checks=[
    [st.detailsOk,`Month, name, designation and project${(c.details.claimTypes||[]).includes("fuel")?", and vehicle":""} filled in`],
    [c.items.length>0,`${c.items.length} claim item${c.items.length===1?"":"s"} keyed in`],
    [st.evidence,"A receipt attached to every item"],
    [st.review,"Every item complete and ticked as checked"],
    [Math.abs(a.total-total)<0.005,`Claim form total ${money(a.total)} matches the items${a27of(c).auto?"":" (manual figures)"}`]
  ];
  $("#checks").innerHTML=checks.map(([ok,text])=>`<div class="${ok?"ok":"need"}">${ok?"✓":"○"} ${escapeHtml(text)}</div>`).join("");
  $("#warns").innerHTML=warnings(c).map(w=>`<div>⚠ ${escapeHtml(w)}</div>`).join("");
}
function byTypeRows(c){
  const rows=[];
  for(const k of [...new Set([...c.details.claimTypes,...c.items.map(x=>x.type)])]){
    const its=c.items.filter(x=>x.type===k);if(!its.length&&!c.details.claimTypes.includes(k))continue;
    rows.push({k,label:TYPE[k].l,line:TYPE[k].line,count:its.length,amount:round2(its.reduce((s,x)=>s+safeNum(x.amount),0))});
  }
  return rows;
}
function warnings(c){
  const w=[],refs=refMap(c),p=c.details.period;
  for(const it of sortedItems(c)){
    const r=refs[it.id];
    if(it.date&&p&&!it.date.startsWith(p))w.push(`${r}: dated ${dmy(it.date)} — outside ${claimMonthLabel(p)}`);
    const auto=autoAmount(it);
    if(auto!==null&&it.amountManual&&Math.abs(auto-safeNum(it.amount))>0.05)w.push(`${r}: amount ${money(it.amount)} differs from quantity × price (${money(auto)})`);
  }
  const seen={};
  for(const it of sortedItems(c)){const n=String(it.invoiceNo||"").trim().toUpperCase();if(!n)continue;if(seen[n])w.push(`${seen[n]} and ${refs[it.id]} have the same invoice no. ${it.invoiceNo}`);else seen[n]=refs[it.id];}
  const a=a27of(c);
  c.items.filter(x=>x.type==="outstation").forEach(it=>{const o=a.os[Number(it.trip)||0];if(!o.fromTo&&!o.travelDate)w.push(`${refs[it.id]}: add the trip details for 6${"abc"[Number(it.trip)||0]} in Check claim form`);});
  const miscGroups=new Set(c.items.filter(x=>x.type==="misc").map(x=>String(x.desc||x.station||"Misc.").trim().toLowerCase()));
  if(a.auto&&miscGroups.size>3)w.push(`${miscGroups.size} different misc. expenses share the form's three lines (5a–5c) — line 5c lists the rest`);
  return [...new Set(w)];
}
const DETAIL_MAP={"d-project":"project","d-code":"projectCode","d-claimant":"claimant","d-designation":"designation","d-subdate":"submissionDate","d-vehicle":"vehicle"};
function render(){
  const c=cur();if(!c)return;
  const d=c.details;
  Object.entries(DETAIL_MAP).forEach(([id,key])=>{const el=$("#"+id);if(document.activeElement!==el)el.value=d[key]??"";});
  renderTypes();renderMeta();renderFlow();renderItems();renderStats();renderExport();
  if($("#details-form").hidden)setDetailsOpen(false);
}
function renderLight(){if(matchMedia('(pointer:fine)').matches)$("#batch-sub").textContent="Pick photos or PDFs — or drag them onto this page. One item each.";renderMeta();renderFlow();renderStats();renderExport();}
const PACK_PARTS=[["cover","Cover page","Month, claimant, total, contents with page numbers"],["admin27","Claim form","The monthly claim form, filled in"],["summary","Claim summary","Item table, breakdown, fuel statistics — choose in Summary contents"],["index","Supporting document index","Every document with its reference and page number"],["attachments","Supporting documents","Receipts, e-invoices and other support, numbered to match"],["appendix","Appendix A — original receipts","Cover sheet at the end: attach the original receipts behind it, tick each one"]];
function renderExport(){
  const c=cur(),o=c.opts;
  $("#packlist").innerHTML=PACK_PARTS.map(([k,l,s])=>`<label><input type="checkbox" data-pack="${k}" ${o[k]?"checked":""}><span><b>${l}</b><small>${s}</small></span></label>`).join("");
  $("#btn-share").disabled=!latestPdf;
  $("#export-status").textContent=latestPdf&&c.exported?`PDF built ${new Date(c.exported).toLocaleString("en-GB")} · ${latestPageCount} pages. Review every page before submitting.`:c.exported?"Details changed since the last PDF — generate it again.":"";
}

/* ---------------- details binding ---------------- */
function bindDetails(){
  Object.entries(DETAIL_MAP).forEach(([id,key])=>{
    const el=$("#"+id);
    el.addEventListener("input",()=>{const c=cur();if(!c)return;c.details[key]=el.value;save();renderLight();});
  });
  $("#seg-type").addEventListener("click",e=>{
    const b=e.target.closest("[data-type]");if(!b)return;
    const c=cur(),k=b.dataset.type,list=c.details.claimTypes;
    if(list.includes(k)){
      if(list.length===1){toast("Keep at least one claim type.");return;}
      if(c.items.some(x=>x.type===k)){toast(`Some items are ${TYPE[k].l} — change or remove them first.`);return;}
      c.details.claimTypes=list.filter(x=>x!==k);
    }else c.details.claimTypes=TYPES.map(t=>t.k).filter(x=>list.includes(x)||x===k);
    save();render();
  });
  $("#seg-addtype").addEventListener("click",e=>{const b=e.target.closest("[data-addtype]");if(!b)return;addType=b.dataset.addtype;renderTypes();});
  $("#seg-own").addEventListener("click",e=>{const b=e.target.closest("[data-own]");if(!b)return;cur().details.ownership=b.dataset.own;save();renderTypes();renderLight();});
  $("#m-prev").addEventListener("click",()=>{const c=cur();c.details.period=monthShift(c.details.period,-1);save();render();});
  $("#m-next").addEventListener("click",()=>{const c=cur();c.details.period=monthShift(c.details.period,1);save();render();});
  $("#btn-collapse").addEventListener("click",()=>setDetailsOpen($("#details-form").hidden));
}
function setDetailsOpen(open){
  $("#details-form").hidden=!open;$("#details-summary").hidden=open;$("#btn-collapse").textContent=open?"Hide":"Edit";
  const c=cur(),d=c.details;
  $("#details-summary").innerHTML=`<b>${escapeHtml(claimMonthLabel(d.period)||"No month")}</b> · ${escapeHtml(d.claimant||"No claimant")} · ${escapeHtml(d.claimTypes.map(k=>TYPE[k].l).join(", "))}${d.vehicle&&usesVehicle(c)?` · ${escapeHtml(d.vehicle)}`:""}`;
}

/* ---------------- items ---------------- */
async function addItem(file=null,type=null){
  const c=cur(),it=blankItem(type||addType||c.details.claimTypes[0]);
  c.items.push(it);
  if(file){const ok=await attachFile(it,"receipt",file);if(!ok){c.items=c.items.filter(x=>x.id!==it.id);save();render();return null;}}
  openItems.clear();openItems.add(it.id);save();render();
  requestAnimationFrame(()=>{const el=document.querySelector(`.item[data-id="${it.id}"]`);if(el){el.scrollIntoView({behavior:"smooth",block:"center"});el.querySelector('[data-field="date"]')?.focus({preventScroll:true});}});
  return it;
}
async function attachFile(item,kind,file){
  if(!(file.type.startsWith("image/")||file.type==="application/pdf")){toast("Choose a PDF or an image (JPEG/PNG).");return false;}
  if(file.size>25*1024*1024){toast("This file is over 25 MB. Compress it or scan at a lower resolution.");return false;}
  if(/heic|heif/i.test(file.type)&&!(await canDecodeImage(file))){toast("This phone saved the photo as HEIC, which this browser cannot read. Use the Camera button, or set the camera to 'Most compatible' (JPEG).");return false;}
  try{await putFile(fileKey(store.currentId,item.id,kind),file);}
  catch(error){console.error("Attach failed",error);toast(`Could not save ${file.name}: ${error.message}`);return false;}
  item[nameKey(kind)]=file.name||`${kind}.jpg`;item[typeKey(kind)]=file.type;item.confirmed=false;
  return true;
}
async function canDecodeImage(file){try{const b=await createImageBitmap(file);b.close&&b.close();return true;}catch(e){return false;}}
function findItem(el){const card=el.closest(".item"),c=cur();return card?c.items.find(x=>x.id===card.dataset.id):null;}
function onItemField(input,commit){
  const it=findItem(input);if(!it)return;
  const f=input.dataset.field;
  let v=input.value;
  if(f==="trip")v=Number(v)||0;
  it[f]=v;
  if(f==="amount"){const au=autoAmount(it);it.amountManual=String(v).trim()!==""&&(au===null||Math.abs(safeNum(v)-au)>0.005);}
  if((f==="qty"||f==="rate")&&!it.amountManual){const a=autoAmount(it);it.amount=a===null?"":a.toFixed(2);}
  if(f==="amount"&&commit&&String(v).trim()===""&&autoAmount(it)!==null){it.amountManual=false;it.amount=autoAmount(it).toFixed(2);}
  save();renderLight();
  if(commit&&["type","osCol","trip"].includes(f)){rerenderItem(it.id);return;}  // selects: safe to redraw
  patchCard(it);
  if(f==="date")refreshRefs();
}
/* update the parts of an open card that depend on its values, without touching the inputs being typed in */
function patchCard(it){
  const card=document.querySelector(`.item[data-id="${it.id}"]`);if(!card)return;
  const tmp=document.createElement("div");tmp.innerHTML=itemCard(cur(),it,refMap(cur())[it.id]);
  const fresh=tmp.firstElementChild;
  card.className=fresh.className;
  card.querySelector(".ihead").replaceWith(fresh.querySelector(".ihead"));
  const amt=card.querySelector('[data-field="amount"]');
  if(amt&&document.activeElement!==amt&&amt.value!==String(it.amount??""))amt.value=it.amount;
  const box=amt?.parentElement,oldCalc=box?.querySelector(".calc"),newCalc=fresh.querySelector('[data-field="amount"]')?.parentElement.querySelector(".calc");
  if(oldCalc)oldCalc.remove();if(newCalc&&box)box.append(newCalc);
  const st=card.querySelector(".ibody>.status"),nst=fresh.querySelector(".ibody>.status");
  if(st&&nst)st.replaceWith(nst);
}
/* item numbers follow the dates: renumber in place; the list re-sorts when a card is closed or added */
function refreshRefs(){
  const refs=refMap(cur());
  $$(".item[data-id]").forEach(el=>{const r=refs[el.dataset.id];if(!r)return;const b=el.querySelector(".ihead .ref");if(b)b.textContent=r;
    el.querySelectorAll(".dref").forEach(d=>d.textContent=`${r}-${d.textContent.split("-").pop()}`);});
}
async function attachAndShow(it,kind,file){
  busy(true,"Saving…");const ok=await attachFile(it,kind,file);busy(false);
  if(ok){save();renderLight();rerenderItem(it.id);toast(`Attached as ${refMap(cur())[it.id]}-${KIND[kind].code}.`);}
  return ok;
}
/* ---------------- drag and drop (desktop / laptop) ----------------
   Drop on a document box → attach there; on an item → its first empty box (PDF prefers the e-invoice box);
   anywhere else → one new item per file. */
function bindDrop(){
  let depth=0;const zone=$("#dropzone");
  const hasFiles=e=>[...(e.dataTransfer?.types||[])].includes("Files");
  const clearTargets=()=>$$(".droptarget").forEach(el=>el.classList.remove("droptarget"));
  const targetOf=e=>{const el=document.elementFromPoint(e.clientX,e.clientY);return {doc:el?.closest(".item.open .doc[data-kind]"),item:el?.closest(".item[data-id]")};};
  document.addEventListener("dragenter",e=>{if(!hasFiles(e))return;e.preventDefault();depth++;zone.hidden=false;});
  document.addEventListener("dragleave",e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(!depth){zone.hidden=true;clearTargets();}});
  document.addEventListener("dragover",e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect="copy";
    zone.style.pointerEvents="none";clearTargets();const t=targetOf(e);(t.doc||t.item)?.classList.add("droptarget");
    $("#drop-msg").innerHTML=t.doc?`Attach to <b>${escapeHtml(t.doc.querySelector(".dref")?.textContent||"")}</b>`:t.item?"Attach to this item":"Drop receipts or e-invoices here — each file becomes a new item.<br>Drop onto an item, or onto its Receipt / E-invoice / Other box, to attach it there.";});
  document.addEventListener("drop",async e=>{
    if(!hasFiles(e))return;e.preventDefault();depth=0;zone.hidden=true;
    const t=targetOf(e);clearTargets();
    const files=[...e.dataTransfer.files].filter(f=>f.type.startsWith("image/")||f.type==="application/pdf");
    if(!files.length){toast("Only photos (JPEG/PNG) and PDFs can be added.");return;}
    const c=cur(),it=t.item?c.items.find(x=>x.id===t.item.dataset.id):null;
    if(it){
      for(const f of files){
        let kind=t.doc?.dataset.kind;
        if(!kind){const free=KINDS.map(([k])=>k).filter(k=>!it[nameKey(k)]);kind=f.type==="application/pdf"&&free.includes("invoice")?"invoice":free[0];}
        if(!kind){toast("This item already has a receipt, an e-invoice and an other document.");break;}
        if(it[nameKey(kind)]&&!confirm(`Replace the attached ${KIND[kind].label.toLowerCase()}?`))continue;
        await attachAndShow(it,kind,f);if(t.doc)break;
      }
      return;
    }
    await batchImport(files);
  });
}
async function handleFileInput(input){
  const it=findItem(input),file=input.files?.[0];input.value="";
  if(!file||!it)return;
  busy(true,"Saving document…");
  const ok=await attachFile(it,input.dataset.file,file);
  busy(false);
  if(ok){save();renderLight();rerenderItem(it.id);toast(`${file.name} attached as ${refMap(cur())[it.id]}-${KIND[input.dataset.file].code}.`);}
}
async function viewDoc(it,kind){
  const f=await getFile(fileKey(store.currentId,it.id,kind));if(!f){toast("File not found on this device.");return;}
  const url=URL.createObjectURL(f),w=window.open(url,"_blank");
  if(!w)toast("The browser blocked the new tab.");
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}

/* ---------------- OCR ---------------- */
let ocrWorker=null;
const asset=path=>new URL(path,location.href).href;
async function loadScript(src,message){await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(message));document.head.append(s);});}
async function getOcrWorker(){
  if(!window.Tesseract)await loadScript("lib/tesseract/tesseract.min.js","Offline OCR library could not be loaded.");
  if(!ocrWorker)ocrWorker=await Tesseract.createWorker("eng",1,{workerPath:asset("lib/tesseract/worker.min.js"),corePath:asset("lib/tesseract/"),langPath:asset("lib/tesseract/lang"),gzip:true});
  return ocrWorker;
}
async function getPdfJs(){
  if(!window.pdfjsLib)await loadScript("lib/pdfjs.min.js","PDF viewer library could not be loaded.");
  pdfjsLib.GlobalWorkerOptions.workerSrc=asset("lib/pdfjs.worker.min.js");
  return pdfjsLib;
}
async function readText(file){
  let source=file;
  if(file.type==="application/pdf"){
    const pdfjs=await getPdfJs(),pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
    const page=await pdf.getPage(1),tc=await page.getTextContent();
    const digital=tc.items.map(i=>i.str).join(" ").trim();if(digital)return digital;
    const vp=page.getViewport({scale:Math.min(2.2,1600/page.getViewport({scale:1}).width)});
    const cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;
    await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;
    source=await new Promise((res,rej)=>cv.toBlob(b=>b?res(b):rej(new Error("The first PDF page could not be rendered for scanning.")),"image/png"));
  }
  const result=await (await getOcrWorker()).recognize(source);
  return result.data.text||"";
}
function parseSuggestions(text){
  const flat=text.replace(/\s+/g," ");
  const patterns={
    date:[/\b(\d{4}-\d{2}-\d{2})\b/,/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/,/\b(\d{1,2}[-\s]+[A-Za-z]{3,9}[-\s]+\d{4})\b/],
    invoiceNo:[/(?:e-?invoice|tax invoice|invoice|receipt|bill)\s*(?:no\.?|number|#)\s*[:\-]?\s*((?=[A-Z0-9\-\/]*\d)[A-Z0-9][A-Z0-9\-\/]{4,})/i],
    station:[/(?:station|merchant|outlet|seller|supplier name|name)\s*[:\-]\s*([A-Za-z0-9&'().\- ]{3,40})/i],
    qty:[/\b(\d{1,3}\.\d{2,3})\s*(?:L|litres?|liters?|ltr)\b/i],
    amount:[/(?:total payable amount|total payable|grand total|total amount|amount due|total)\s*[:\-]?\s*(?:RM\s*)?(\d{1,6}\.\d{2})/i,/RM\s*(\d{1,6}\.\d{2})/i],
    rate:[/(?:price|RM)\s*(?:\/|per)\s*(?:L|litre|liter|ltr)\s*[:\-]?\s*(\d{1,2}\.\d{2,3})/i,/(?:unit price)\s*[:\-]?\s*(\d{1,2}\.\d{2,3})/i]
  };
  return Object.entries(patterns).map(([field,regs])=>{for(const re of regs){const m=flat.match(re);if(m)return{field,value:m[1]};}return null;}).filter(Boolean);
}
function toIsoDate(value){
  const input=String(value||"").trim(),iso=input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let year,month,day;
  if(iso){year=+iso[1];month=+iso[2];day=+iso[3];}
  else{
    const p=input.match(/^(\d{1,2})[-/. ]+([A-Za-z]{3,9}|\d{1,2})[-/. ]+(\d{2,4})$/);if(!p)return"";
    day=+p[1];year=+p[3];if(year<100)year+=year<50?2000:1900;
    month=/^\d+$/.test(p[2])?+p[2]:new Date(`${p[2]} 1, 2000`).getMonth()+1;
  }
  const date=new Date(year,month-1,day);
  return date.getFullYear()===year&&date.getMonth()===month-1&&date.getDate()===day?`${year}-${pad2(month)}-${pad2(day)}`:"";
}
const SUG_LABEL={date:"Date",invoiceNo:"Invoice / ref. no.",station:"Merchant",qty:"Quantity / litres",rate:"Price per unit",amount:"Amount (RM)"};
let sugTarget=null,sugItems=[];
async function scanDoc(itemId,kind){
  const c=cur(),item=c.items.find(x=>x.id===itemId);if(!item)return;
  const useAi=!!aiCfg().key;
  busy(true,useAi?"Reading with AI…":"Reading document…");
  try{
    const file=await getFile(fileKey(c.id,item.id,kind));if(!file)throw new Error("No document attached.");
    let suggestions=[];
    if(useAi){try{suggestions=(await geminiScanReceipt(file)).suggestions||[];}catch(err){console.error(err);toast(`AI scan failed (${err.message||err}) — using the offline scanner.`);}}
    if(!suggestions.length)suggestions=parseSuggestions(await readText(file));
    if(!suggestions.length){toast("Nothing recognised. Key in the values by hand.");return;}
    sugTarget=item;sugItems=suggestions;
    $("#sug-list").innerHTML=suggestions.map((s,i)=>`<label class="sugline"><input type="checkbox" checked data-sug="${i}"><span class="sf"><b>${escapeHtml(SUG_LABEL[s.field]||s.field)}</b><input type="text" data-sugval="${i}" value="${escapeHtml(s.value)}"></span></label>`).join("");
    openSheet("#sh-sug");
  }catch(err){console.error(err);toast(`Could not scan: ${err.message||err}`);}
  finally{busy(false);}
}
function applySuggestions(){
  for(const cb of $$("[data-sug]")){
    if(!cb.checked)continue;
    const s=sugItems[Number(cb.dataset.sug)],value=document.querySelector(`[data-sugval="${cb.dataset.sug}"]`).value.trim();
    if(s.field==="date"){const p=toIsoDate(value);if(p)sugTarget.date=p;}
    else if(s.field==="amount"){sugTarget.amount=String(safeNum(value));sugTarget.amountManual=true;}
    else if(["invoiceNo","station","qty","rate"].includes(s.field))sugTarget[s.field]=value;
  }
  if(!sugTarget.amountManual||!String(sugTarget.amount).trim()){const a=autoAmount(sugTarget);if(a!==null){sugTarget.amount=a.toFixed(2);sugTarget.amountManual=false;}}
  save();render();$("#sh-sug").hidden=true;toast("Applied — check them against the document.");
}

/* ---------------- theme ---------------- */
function applyTheme(){
  let t="auto";try{t=localStorage.getItem(THEME_KEY)||"auto";}catch(e){}
  if(t==="auto")document.documentElement.removeAttribute("data-theme");else document.documentElement.setAttribute("data-theme",t);
  $$("[data-theme-opt]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.themeOpt===t)));
}
function setTheme(t){try{localStorage.setItem(THEME_KEY,t);}catch(e){}applyTheme();}

/* ---------------- AI scan (Gemini) ---------------- */
function aiCfg(){try{return Object.assign({key:"",model:DEFAULT_MODEL},JSON.parse(localStorage.getItem(AI_KEY)||"{}"));}catch(e){return{key:"",model:DEFAULT_MODEL};}}
function saveAiCfg(cfg){try{localStorage.setItem(AI_KEY,JSON.stringify(cfg));}catch(e){}}
function renderAiSettings(){const cfg=aiCfg();$("#s-key").value=cfg.key||"";$("#s-model").value=cfg.model||DEFAULT_MODEL;$("#s-ai-status").textContent=cfg.key?"AI scan is on — documents are read with Gemini when you tap Read.":"No key set — Read uses the offline text reader.";}
function saveAiSettings(){const cfg={key:$("#s-key").value.trim(),model:$("#s-model").value.trim()||DEFAULT_MODEL};saveAiCfg(cfg);renderAiSettings();toast(cfg.key?"AI settings saved.":"AI key cleared — using the offline scanner.");}
async function testAiKey(){
  const out=$("#s-ai-status"),key=$("#s-key").value.trim(),model=$("#s-model").value.trim()||DEFAULT_MODEL;
  if(!key){out.textContent="Enter an API key first.";return;}
  out.textContent="Testing…";
  try{const j=await geminiPost({model,input:"Reply with the single word OK.",store:false},key);out.textContent=`Key works ✓ (${extractText(j).trim().slice(0,40)||"OK"})`;}
  catch(e){out.textContent=`Test failed: ${e.message}`;}
}
async function geminiPost(body,key){
  const go=rev=>fetch(GEMINI_URL,{method:"POST",headers:Object.assign({"Content-Type":"application/json","x-goog-api-key":key},rev?{"Api-Revision":GEMINI_REV}:{}),body:JSON.stringify(body)});
  let res;try{res=await go(true);}catch(e){res=await go(false);}
  const j=await res.json().catch(()=>({}));
  if(!res.ok){let m=j.error?.message||res.statusText;if(res.status===404||(/model/i.test(m)&&/not found|unsupported/i.test(m)))m+=` — check the model name (default ${DEFAULT_MODEL}).`;throw new Error(`Gemini error ${res.status}: ${m}`);}
  return j;
}
function extractText(j){
  if(typeof j.output_text==="string")return j.output_text;
  const cand=j.candidates?.[0]?.content?.parts;if(cand)return cand.map(p=>p.text||"").join("");
  for(const o of (j.outputs||j.steps||[])){const t=(o.content||[]).map(x=>x.text||"").join("");if(t)return t;}
  return "";
}
async function fileToImageDataUrl(file){
  if(file.type==="application/pdf"){
    const pdfjs=await getPdfJs(),pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise,page=await pdf.getPage(1);
    const vp=page.getViewport({scale:Math.min(2.2,1600/page.getViewport({scale:1}).width)});
    const cv=document.createElement("canvas");cv.width=vp.width;cv.height=vp.height;
    await page.render({canvasContext:cv.getContext("2d"),viewport:vp}).promise;
    return cv.toDataURL("image/jpeg",.9);
  }
  const {canvas}=await imageToCanvas(file,2000);return canvas.toDataURL("image/jpeg",.9);
}
async function geminiScanReceipt(file){
  const cfg=aiCfg();
  if(!cfg.key)throw new Error("No Gemini API key.");
  if(!navigator.onLine)throw new Error("No signal — AI scan needs internet.");
  const dataUrl=await fileToImageDataUrl(file);
  const schema={type:"object",properties:{
    date:{type:"string",description:"Receipt date exactly as written"},merchant:{type:"string",description:"Merchant, station or supplier name"},
    invoiceNo:{type:"string",description:"Invoice or receipt reference number"},litres:{type:"string",description:"Quantity in litres, if fuel"},
    price:{type:"string",description:"Price per litre, if fuel"},amount:{type:"string",description:"Total amount paid in RM"},notes:{type:"string",description:"Anything unclear"}
  },required:["amount"]};
  const prompt="You are reading a Malaysian purchase receipt or e-invoice for a monthly expense claim. Transcribe the fields exactly as printed. Never guess, round or compute values; leave a field empty if it is not present. Amounts are in Malaysian Ringgit (RM).";
  const body={model:cfg.model||DEFAULT_MODEL,store:false,input:[{type:"text",text:prompt},{type:"image",data:dataUrl.split(",")[1],mime_type:"image/jpeg"}],response_format:{type:"text",mime_type:"application/json",schema}};
  const j=await geminiPost(body,cfg.key),txt=extractText(j);if(!txt)throw new Error("Gemini returned no text.");
  let out;try{out=JSON.parse(txt.replace(/^```(json)?|```$/g,"").trim());}catch(e){throw new Error("Could not understand the AI reply.");}
  const map={date:"date",merchant:"station",invoiceNo:"invoiceNo",litres:"qty",price:"rate",amount:"amount"};
  return {suggestions:Object.entries(map).filter(([k])=>String(out[k]??"").trim()).map(([k,f])=>({field:f,value:String(out[k]).trim()})),notes:out.notes||""};
}

/* ---------------- Admin 27 sheet ---------------- */
function renderAdmin27(){
  const c=cur();if(!c)return;
  const a=a27of(c),k=a27Calc(c),man=!a.auto;
  const txt=(key,ph="")=>`<input type="text" data-a27="${key}" value="${escapeHtml(a[key])}" placeholder="${escapeHtml(ph)}">`;
  const amt=(key,val)=>man?`<input type="number" inputmode="decimal" min="0" step="0.01" data-a27m="${key}" value="${escapeHtml(a.m[key])}" placeholder="0.00">`:`<input type="text" readonly value="${val?fmt2(val):"—"}" style="text-align:right">`;
  const line=(key,label,specKey)=>`<div class="a27line"><span class="lbl">${escapeHtml(label)}${specKey?`<input type="text" data-a27="${specKey}" value="${escapeHtml(a[specKey])}" placeholder="${escapeHtml(k.labels[specKey==="s1eLabel"?"s1e":specKey.slice(0,3)]||"Specify")}" style="margin-top:4px">`:""}</span>${amt(key,k.lines[key])}</div>`;
  const osIn=(i,key,type="text",ph="")=>`<input type="${type}" data-os="${i}" data-osk="${key}" value="${escapeHtml(a.os[i][key])}" placeholder="${escapeHtml(ph)}">`;
  const seg=(i,key,opts)=>`<div class="seg">${opts.map(([v,l])=>`<button type="button" data-osseg="${i}" data-osk="${key}" data-v="${v}" aria-pressed="${a.os[i][key]===v}">${l}</button>`).join("")}</div>`;
  const used=new Set(c.items.filter(x=>x.type==="outstation").map(x=>Number(x.trip)||0));
  const osBlock=i=>{
    const o=k.os[i],show=used.has(i)||o.total>0||a.os[i].fromTo||a.os[i].travelDate;
    return `<details class="a27sec" ${show?"open":""}><summary style="list-style:none;cursor:pointer"><h3 style="font-size:14.5px;padding:9px 12px;background:var(--sunk);display:flex;justify-content:space-between">6${"abc"[i]}. Outstation expenses <span class="amount mono">${money(o.total)}</span></h3></summary>
    <div class="body">
      <div class="a27grid">
        <div><span class="lbl">Claimable</span>${seg(i,"claimable",[["Yes","Yes"],["No","No"]])}</div>
        <div><label class="lbl">Travel date</label>${osIn(i,"travelDate","text","e.g. 14–16/09/2026")}</div>
        <div class="span2"><span class="lbl">Travel by</span>${seg(i,"travelBy",[["Air","✈ Air"],["Land","🚌 Land"],["Others","Others"]])}</div>
        ${a.os[i].travelBy==="Others"?`<div class="span2"><label class="lbl">Others (travel by)</label>${osIn(i,"travelByOther")}</div>`:""}
        <div><label class="lbl">Destination: from / to</label>${osIn(i,"fromTo","text","e.g. Site office / Head office")}</div>
        <div><label class="lbl">Job no.</label>${osIn(i,"jobNo")}</div>
        <div class="span2"><span class="lbl">Type of meeting</span>${seg(i,"meeting",[["Co-ordination","Co-ordination"],["Site","Site"],["Others","Others"]])}</div>
        ${a.os[i].meeting==="Others"?`<div class="span2"><label class="lbl">Others (meeting)</label>${osIn(i,"meetingOther")}</div>`:""}
      </div>
      <div class="a27grid three">${OS_COLS.map(([key,l])=>`<div><label class="lbl">${escapeHtml(l)} (RM)</label>${man?osIn(i,key,"number"):`<input type="text" readonly value="${o.amt[key]?fmt2(o.amt[key]):"—"}">`}</div>`).join("")}</div>
      <div class="a27grid"><div><label class="lbl">Others — specify</label>${osIn(i,"othersLabel","text",o.othersLabel||"")}</div><div><label class="lbl">Mileage rate (RM / km)</label>${osIn(i,"rmPerKm","text",o.rmPerKm||"")}</div></div>
    </div></details>`;
  };
  $("#a27-body").innerHTML=`
    <div class="modebar"><p>${a.auto?"<b>Filled from your claim items.</b> Each item goes to its line by claim type — change an item to change the form.":"<b>Manual figures.</b> The amounts below are what prints — they no longer follow the items."}</p>
      <div class="seg" id="a27-mode"><button type="button" data-mode="auto" aria-pressed="${a.auto}">From items</button><button type="button" data-mode="manual" aria-pressed="${!a.auto}">Key in myself</button></div></div>
    <div class="a27sec"><h3>Header</h3><div class="body"><div class="a27grid">
      <div><label class="lbl">Name</label>${txt("name",k.name||"Claimant (project code)")}</div>
      <div><label class="lbl">Month / year</label>${txt("monthYear",k.month||"")}</div>
    </div><p class="a27hint">Leave blank to use the claim details. Both print in capitals, as on the original form.</p></div></div>
    <div class="a27sec"><h3>1. Transportation <span class="amount">${money(k.s1)}</span></h3><div class="body">
      <div class="a27grid">
        <div><label class="lbl">Vehicle no.</label>${txt("vehicleNo",k.vehicle||"e.g. QAA 1234")}</div>
        <div><span class="lbl">Vehicle</span><div class="seg"><button type="button" data-a27own="" aria-pressed="${!a.vehicleOwn}">As details${k.own?` (${k.own})`:""}</button><button type="button" data-a27own="Own" aria-pressed="${a.vehicleOwn==="Own"}">Own</button><button type="button" data-a27own="Company" aria-pressed="${a.vehicleOwn==="Company"}">Company</button></div></div>
      </div>
      ${line("s1a","a) Fuel (mileage claim not acceptable)")}${line("s1b","b) Car wash / care")}${line("s1c","c) Maintenance / service")}${line("s1d","d) Parking / toll")}${line("s1e","e) Others — specify","s1eLabel")}
    </div></div>
    <div class="a27sec"><h3>2–4. Medical · Telecommunication · Utilities</h3><div class="body">${line("s2","2. Medical expenses")}${line("s3","3. Telecommunication")}${line("s4","4. Utilities")}</div></div>
    <div class="a27sec"><h3>5. Misc. expenses <span class="amount">${money(k.s5)}</span></h3><div class="body">${line("s5a","a)","s5aLbl")}${line("s5b","b)","s5bLbl")}${line("s5c","c)","s5cLbl")}</div></div>
    ${[0,1,2].map(osBlock).join("")}
    <div class="a27sec"><h3>Signature block</h3><div class="body"><label class="confirmline"><input type="checkbox" id="a27-fillsub" ${a.fillSubmitted?"checked":""}><span>Print my name and the submission date (${escapeHtml(dmyDot(c.details.submissionDate)||"—")}) on <i>Submitted by</i>. Leave unticked to sign and date by hand.</span></label></div></div>
    <div class="a27total"><span>Total claim amount</span><b>${money(k.total)}</b></div>
    <p class="a27hint">Items total ${money(itemTotal(c))}${Math.abs(k.total-itemTotal(c))>0.005?" — <b>does not match the form total</b>":" — matches"}. The note line under the total is set in Setup.</p>
    <div class="preview" id="a27-prev" hidden></div>`;
}
function bindAdmin27(){
  const body=$("#a27-body");
  body.addEventListener("input",e=>{
    const a=a27of(),t=e.target;if(!a)return;
    if(t.dataset.a27){a[t.dataset.a27]=t.value;}
    else if(t.dataset.a27m){a.m[t.dataset.a27m]=t.value;}
    else if(t.dataset.os!==undefined&&t.dataset.osk){a.os[+t.dataset.os][t.dataset.osk]=t.value;}
    else if(t.id==="a27-fillsub"){a.fillSubmitted=t.checked;}
    else return;
    save();renderLight();
    clearTimeout(bindAdmin27.t);bindAdmin27.t=setTimeout(()=>{const k=a27Calc();body.querySelectorAll(".a27total b").forEach(b=>b.textContent=money(k.total));if(!$("#a27-prev").hidden)previewA27();},350);
  });
  body.addEventListener("change",e=>{if(e.target.id==="a27-fillsub"){a27of().fillSubmitted=e.target.checked;save();}});
  body.addEventListener("click",e=>{
    const a=a27of();if(!a)return;
    const mode=e.target.closest("[data-mode]");
    if(mode){
      const toManual=mode.dataset.mode==="manual";
      if(toManual&&a.auto){const k=a27Calc();A27_LINES.forEach(key=>a.m[key]=k.lines[key]?k.lines[key].toFixed(2):"");a.os.forEach((o,i)=>OS_COLS.forEach(([key])=>o[key]=k.os[i].amt[key]?k.os[i].amt[key].toFixed(2):""));["s1e","s5a","s5b","s5c"].forEach(key=>{const lk=key==="s1e"?"s1eLabel":key+"Lbl";if(!a[lk])a[lk]=k.labels[key]||"";});}
      if(!toManual&&!a.auto&&!confirm("Switch back to filling the form from the items? Your keyed-in amounts will be replaced."))return;
      a.auto=!toManual;save();renderAdmin27();renderLight();return;
    }
    const own=e.target.closest("[data-a27own]");if(own){a.vehicleOwn=own.dataset.a27own;save();renderAdmin27();return;}
    const sg=e.target.closest("[data-osseg]");
    if(sg){const o=a.os[+sg.dataset.osseg];o[sg.dataset.osk]=o[sg.dataset.osk]===sg.dataset.v?"":sg.dataset.v;save();renderAdmin27();renderLight();}
  });
}
async function previewA27(){
  const wrap=$("#a27-prev");wrap.hidden=false;
  try{
    const bytes=await makeAdmin27(),pdfjs=await getPdfJs(),pdf=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
    const page=await pdf.getPage(1),base=page.getViewport({scale:1});
    const scale=Math.max(.5,(wrap.clientWidth-20)/base.width),vp=page.getViewport({scale}),ratio=Math.min(2,window.devicePixelRatio||1);
    const cv=document.createElement("canvas");cv.width=Math.round(vp.width*ratio);cv.height=Math.round(vp.height*ratio);cv.style.width=`${vp.width}px`;
    await page.render({canvasContext:cv.getContext("2d"),viewport:vp,transform:[ratio,0,0,ratio,0,0]}).promise;
    wrap.innerHTML="";wrap.append(cv);
  }catch(e){console.error(e);wrap.innerHTML=`<p class="small" style="color:#fff">Preview failed: ${escapeHtml(e.message)}</p>`;}
}

/* ---------------- pack option sheets ---------------- */
const SUM_OPTS=[
  ["Sections",[["details","Claim details","Claimant, designation, project, vehicle, period"],["items","Claim items table","One row per item, numbered like the documents"],["byType","Breakdown by claim type","Amount per type and the claim form line it goes to"],["fuelStats","Fuel statistics","Litres, average and lowest / highest price per litre, price movement"],["cap","Fuel allowance comparison","Against a monthly cap and a subsidised price (set below)"],["declaration","Declaration","Short statement that the claims are for official work (no signature here — sign the claim form)"]]],
  ["Item table columns",[["colRef","Invoice / reference no.",""],["colQty","Quantity and unit price",""],["colCum","Running total",""]]]
];
function renderSumOpts(){
  const s=cur().opts.sum;
  $("#sumopts-body").innerHTML=SUM_OPTS.map(([g,list])=>`<div class="optgroup"><h4>${g}</h4><div class="packlist" style="margin:0">${list.map(([k,l,h])=>`<label><input type="checkbox" data-sum="${k}" ${s[k]?"checked":""}><span><b>${l}</b>${h?`<small>${h}</small>`:""}</span></label>`).join("")}</div></div>`).join("")+
  `<div class="optgroup"><h4>Fuel allowance comparison</h4><div class="grid"><div><label class="lbl">Monthly fuel cap (RM)</label><input type="number" inputmode="decimal" data-sumv="capAmount" value="${escapeHtml(s.capAmount)}"></div><div><label class="lbl">Subsidised price (RM / litre)</label><input type="number" inputmode="decimal" step="0.01" data-sumv="subsidyPrice" value="${escapeHtml(s.subsidyPrice)}"></div></div><p class="a27hint">Leave the subsidised price blank to compare with the cap only.</p></div>
  <div class="optgroup"><h4>Remarks</h4><textarea data-sumv="remarks" placeholder="Optional note printed on the summary, e.g. All fuel bought at unsubsidised pump prices.">${escapeHtml(s.remarks)}</textarea></div>`;
}
function renderAttOpts(){
  const a=cur().opts.att,lay=attLayout(a);
  $("#attopts-body").innerHTML=`
    <div class="optgroup"><h4>Order</h4><div class="seg" data-attseg="order"><button type="button" data-v="type" aria-pressed="${a.order==="type"}">All receipts first, then e-invoices</button><button type="button" data-v="item" aria-pressed="${a.order==="item"}">Item by item</button></div>
    <p class="a27hint">Either way, every page is marked with its reference (<b style="color:#C2410C">01-R</b>, <b style="color:#1D4ED8">01-E</b>, <b style="color:#15803D">01-S</b>) and says where its partner documents are.</p></div>
    <div class="optgroup"><h4>Receipt photos</h4><div class="seg" data-attseg="layout"><button type="button" data-v="auto2" aria-pressed="${lay==="auto2"}">2 columns</button><button type="button" data-v="auto3" aria-pressed="${lay==="auto3"}">3 columns (small receipts)</button><button type="button" data-v="one" aria-pressed="${lay==="one"}">One per page</button></div>
    <p class="a27hint">Photos keep their own length: short receipts stack several to a column, a long one may take a whole column. PDFs such as e-invoices keep one page per sheet so they stay readable.</p></div>
    <div class="optgroup"><h4>Cover page</h4><label class="confirmline"><input type="checkbox" id="opt-coverqr" ${cur().opts.coverQr!==false?"checked":""}><span>Small QR code to the app at the bottom of the cover, so colleagues who see your pack can use the app too.</span></label></div>`;
}

/* ---------------- CSV export ---------------- */
function exportCsv(){
  const c=cur(),d=c.details,refs=refMap(c);
  const esc=v=>{const s=String(v??"");return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;};
  const rows=[["Ref","Date","Claim type","Form line","Merchant","Description","Invoice / reference","Quantity","Unit price","Amount (RM)","Documents"]];
  sortedItems(c).forEach(it=>rows.push([refs[it.id],it.date||"",typeOf(it).l,typeOf(it).line,it.station||"",it.desc||"",it.invoiceNo||"",it.qty||"",it.rate||"",safeNum(it.amount).toFixed(2),KINDS.filter(([k])=>it[nameKey(k)]).map(([k])=>`${refs[it.id]}-${KIND[k].code}`).join(" ")]));
  rows.push(["","","","","","","","","Total",itemTotal(c).toFixed(2),""]);
  download(new TextEncoder().encode("﻿"+rows.map(r=>r.map(esc).join(",")).join("\r\n")),`CLAIM_${(d.period||"claim").replace("-","")}_${fileSlug(d.claimant)}_items.csv`,"text/csv");
  toast("CSV exported.");
}
const fileSlug=s=>String(s||"claim").trim().replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toUpperCase()||"CLAIM";

/* ---------------- batch import ---------------- */
async function batchImport(files){
  const list=[...files].filter(f=>f.type.startsWith("image/")||f.type==="application/pdf");
  if(!list.length){toast("Choose image or PDF files.");return;}
  const c=cur();busy(true,`Adding ${list.length} document${list.length===1?"":"s"}…`);
  let added=0;
  try{
    for(const file of list){
      const it=blankItem(addType||c.details.claimTypes[0]);it.created=Date.now()+added;c.items.push(it);
      if(await attachFile(it,"receipt",file)){added++;openItems.add(it.id);}else c.items=c.items.filter(x=>x.id!==it.id);
    }
    save();render();
  }finally{busy(false);}
  toast(`${added} item${added===1?"":"s"} added — key in the details for each.`);
}

/* =================================================================
   PDF — shared design for cover, summary and index (A4, mm)
   ================================================================= */
/* print-friendly: black text and hairlines on white, colour only for the document references */
const INK=[20,33,43],MUTED=[89,104,115],LINE=[200,207,212],SOFT=[246,247,248],ACC=[217,72,15],OKC=[47,125,59],HEADC=[236,239,241];
const REFC={R:[194,65,12],E:[29,78,216],S:[21,128,61]};   // receipt orange · e-invoice blue · other support green
const refColor=ref=>REFC[String(ref).slice(-1)]||INK;
let FONT_B64=null;
async function loadFonts(){
  if(FONT_B64!==null)return FONT_B64;
  const names=["adventor-r","adventor-b","adventor-i","pagella-r","pagella-b","pagella-i"];
  try{
    const out={};
    for(const n of names){
      const res=await fetch(`fonts/${n}.ttf`);if(!res.ok)throw new Error(n);
      const buf=new Uint8Array(await res.arrayBuffer());let s="";for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode(...buf.subarray(i,i+8192));
      out[n]=btoa(s);
    }
    FONT_B64=out;
  }catch(e){console.warn("Form fonts not available, using standard fonts",e);FONT_B64=false;}
  return FONT_B64;
}
function newDoc(orientation="portrait",unit="mm"){
  if(!window.jspdf?.jsPDF)throw new Error("PDF library did not load. Reopen the app while online, then try again.");
  const doc=new window.jspdf.jsPDF({unit,format:"a4",orientation,compress:true});
  doc.setProperties({title:"Monthly claim submission",creator:`${APP_NAME} ${APP_VERSION} (${DEV})`});
  return doc;
}
const T=s=>pdfSafe(s);
function docHeader(doc,title,c,extra=""){
  const d=c.details;
  doc.setDrawColor(...INK);doc.setLineWidth(.6);doc.line(14,9,196,9);doc.setLineWidth(.2);doc.line(14,10.1,196,10.1);
  doc.setTextColor(...INK);doc.setFont("helvetica","bold");doc.setFontSize(14);doc.text(T(title),14,18);
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(...MUTED);
  doc.text(T([d.claimant,d.designation].filter(Boolean).join(" · ")||"Claimant not entered"),14,23);
  doc.setFont("helvetica","bold");doc.setFontSize(11);doc.setTextColor(...INK);doc.text(T(claimMonthLabel(d.period)||""),196,18,{align:"right"});
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(...MUTED);doc.text(T(extra||d.project||""),196,23,{align:"right",maxWidth:90});
  doc.setDrawColor(...LINE);doc.setLineWidth(.3);doc.line(14,26.5,196,26.5);
  doc.setTextColor(...INK);
  return 34;
}
function sectionTitle(doc,y,num,title){
  doc.setFont("helvetica","bold");doc.setFontSize(10.5);doc.setTextColor(...INK);
  if(num!==""&&num!=null){doc.text(`${num}.`,14,y);doc.text(T(title),20,y);}else doc.text(T(title),14,y);
  return y+4;
}
/* table with wrapping and a header row repeated on new pages; light grey header, hairlines (prints well in black & white).
   A column may give color(row) -> [r,g,b] to colour its text, e.g. the document references. */
function drawTable(doc,{x=14,y,cols,rows,foot=null,size=8,onNewPage,maxY=278,lineH=3.6}){
  const W=cols.reduce((s,c)=>s+c.w,0);
  const head=()=>{
    doc.setFillColor(...HEADC);doc.rect(x,y,W,7,"F");doc.setDrawColor(...INK);doc.setLineWidth(.35);doc.line(x,y,x+W,y);doc.line(x,y+7,x+W,y+7);
    doc.setFont("helvetica","bold");doc.setFontSize(size-.5);doc.setTextColor(...INK);
    let cx=x;cols.forEach(c=>{const tx=c.align==="right"?cx+c.w-1.8:c.align==="center"?cx+c.w/2:cx+1.8;doc.text(T(c.h),tx,y+4.6,{align:c.align||"left"});cx+=c.w;});
    y+=7;
  };
  head();
  const drawRow=(r,i,isFoot)=>{
    doc.setFont("helvetica",isFoot?"bold":"normal");doc.setFontSize(size);
    const cells=cols.map((c,j)=>doc.splitTextToSize(T(r[j]??""),c.w-3.6));
    const h=Math.max(1,...cells.map(l=>l.length))*lineH+3;
    if(y+h>maxY){onNewPage&&(y=onNewPage());head();}
    if(isFoot){doc.setDrawColor(...INK);doc.setLineWidth(.35);doc.line(x,y,x+W,y);}
    let cx=x;cols.forEach((c,j)=>{const tx=c.align==="right"?cx+c.w-1.8:c.align==="center"?cx+c.w/2:cx+1.8;
      if(c.box&&!isFoot){doc.setDrawColor(...INK);doc.setLineWidth(.3);doc.rect(cx+c.w/2-1.8,y+1.2,3.6,3.6);cx+=c.w;return;}
      const col=!isFoot&&c.color?c.color(r,j):null;
      if(col){doc.setTextColor(...col);doc.setFont("helvetica","bold");}
      doc.text(cells[j],tx,y+3.9,{align:c.align||"left",lineHeightFactor:lineH/(size*.3528)});
      if(col){doc.setTextColor(...INK);doc.setFont("helvetica",isFoot?"bold":"normal");}
      cx+=c.w;});
    y+=h;doc.setDrawColor(...(isFoot?INK:LINE));doc.setLineWidth(isFoot?.35:.2);doc.line(x,y,x+W,y);
  };
  rows.forEach((r,i)=>drawRow(r,i,false));
  if(foot)drawRow(foot,0,true);
  return y;
}
function kvGrid(doc,y,pairs,{cols=2,x=14,W=182}={}){
  const cw=W/cols;
  doc.setFont("helvetica","bold");doc.setFontSize(9.5);
  const cells=pairs.map(([k,v])=>[T(k).toUpperCase(),doc.splitTextToSize(T(v||"-"),cw-7).slice(0,3)]);
  const rowsN=Math.ceil(cells.length/cols),rowH=[];
  for(let r=0;r<rowsN;r++)rowH.push(6+Math.max(...cells.slice(r*cols,r*cols+cols).map(c=>c[1].length))*4.1);
  const h=rowH.reduce((a,b)=>a+b,0)+3;
  doc.setDrawColor(...LINE);doc.setLineWidth(.3);doc.roundedRect(x,y,W,h,1.2,1.2,"S");
  let ry=y+5.5;
  for(let r=0;r<rowsN;r++){cells.slice(r*cols,r*cols+cols).forEach(([k,v],j)=>{const cx=x+4+j*cw;
      doc.setFont("helvetica","normal");doc.setFontSize(6.8);doc.setTextColor(...MUTED);doc.text(k,cx,ry);
      doc.setFont("helvetica","bold");doc.setFontSize(9.5);doc.setTextColor(...INK);doc.text(v,cx,ry+4.3);});
    ry+=rowH[r];}
  return y+h+6;
}

/* ---------------- Admin 27: redrawn from the original form's geometry ----------------
   Coordinates below are the company original (US Letter, points, measured from the top),
   scaled uniformly onto an A4 page so the form looks exactly like the original. */
async function makeAdmin27(){
  const doc=newDoc("portrait","pt"),c=cur(),k=a27Calc(c),fonts=await loadFonts();
  const S=595.28/612,OY=(841.89-792*S)/2,X=x=>x*S,Y=t=>OY+t*S;
  let GOTHIC="helvetica",BOOK="times";
  if(fonts){
    [["adventor-r","Gothic","normal"],["adventor-b","Gothic","bold"],["adventor-i","Gothic","italic"],["pagella-r","Book","normal"],["pagella-b","Book","bold"],["pagella-i","Book","italic"]]
      .forEach(([n,fam,st])=>{doc.addFileToVFS(`${n}.ttf`,fonts[n]);doc.addFont(`${n}.ttf`,fam,st);});
    GOTHIC="Gothic";BOOK="Book";
  }
  const VAL="helvetica";
  doc.setTextColor(0,0,0);
  // text at the original position: x0 = left (or right/center with align), bottom = glyph-box bottom
  const tx=(s,x,bottom,size,fam,style="normal",opt={})=>{doc.setFont(fam,style);doc.setFontSize(size*S);doc.text(T(s),X(x),Y(bottom-size*.215),opt);};
  // shrink to fit (down to 70% of the size), then shorten with "..."
  const fit=(s,maxW,size,fam=VAL,style="normal")=>{doc.setFont(fam,style);s=T(s);let z=size;doc.setFontSize(z*S);
    while(z>size*.7&&doc.getTextWidth(s)>maxW*S){z-=.25;doc.setFontSize(z*S);}
    if(doc.getTextWidth(s)>maxW*S){while(s.length>1&&doc.getTextWidth(s+"...")>maxW*S)s=s.slice(0,-1);s+="...";}
    return {s,z};};
  const val=(s,x,bottom,size,maxW)=>{if(!String(s??"").trim())return;const r=fit(s,maxW,size);doc.setFont(VAL,"normal");doc.setFontSize(r.z*S);doc.text(r.s,X(x),Y(bottom-r.z*.215));};
  const bar=(x0,t0,x1,t1)=>{doc.setFillColor(0,0,0);doc.rect(X(x0),Y(t0),(x1-x0)*S,Math.max(.15,(t1-t0))*S,"F");};
  const dots=(x0,x1,t)=>{doc.setDrawColor(0,0,0);doc.setLineWidth(.75*S);doc.setLineDashPattern([.01*S,1.3*S],0);doc.setLineCap("round");doc.line(X(x0),Y(t+.35),X(x1),Y(t+.35));doc.setLineDashPattern([],0);doc.setLineCap("butt");};
  const cbox=(x,t,on)=>{ // Wingdings "q": box with a drop shadow
    doc.setDrawColor(0,0,0);doc.setLineWidth(.42*S);doc.rect(X(x+.2),Y(t+.2),3.3*S,3.3*S);
    doc.setFillColor(0,0,0);doc.rect(X(x+3.5),Y(t+.9),.8*S,3.4*S,"F");doc.rect(X(x+.9),Y(t+3.5),3.4*S,.8*S,"F");
    if(on){doc.setLineWidth(1.05*S);doc.setLineCap("round");doc.setLineJoin("round");doc.lines([[1.6*S,2.2*S],[3.6*S,-6.2*S]],X(x+.3),Y(t+1.8));doc.setLineCap("butt");doc.setLineJoin("miter");}
  };
  const poly=(pts,x0,t0,w,h)=>{const P=pts.map(([px,py])=>[X(x0+px*w),Y(t0+py*h)]);doc.setFillColor(0,0,0);
    doc.lines(P.slice(1).map((p,i)=>[p[0]-P[i][0],p[1]-P[i][1]]),P[0][0],P[0][1],[1,1],"F",true);};
  const plane=(x0,t0)=>poly([[.98,.5],[.9,.43],[.6,.43],[.34,.02],[.24,.02],[.4,.43],[.15,.43],[.08,.28],[.02,.28],[.06,.5],[.02,.72],[.08,.72],[.15,.57],[.4,.57],[.24,.98],[.34,.98],[.6,.57],[.9,.57]],x0,t0,9.2,9.6);
  const bus=(x0,t0)=>{doc.setFillColor(0,0,0);doc.roundedRect(X(x0),Y(t0),7.6*S,7.4*S,1.1*S,1.1*S,"F");doc.rect(X(x0+.7),Y(t0+7),1.5*S,1.6*S,"F");doc.rect(X(x0+5.4),Y(t0+7),1.5*S,1.6*S,"F");
    doc.setFillColor(255,255,255);doc.rect(X(x0+.9),Y(t0+1.4),2.7*S,2.6*S,"F");doc.rect(X(x0+4),Y(t0+1.4),2.7*S,2.6*S,"F");doc.rect(X(x0+1.6),Y(t0+.45),4.4*S,.55*S,"F");
    doc.circle(X(x0+1.6),Y(t0+5.6),.65*S,"F");doc.circle(X(x0+6),Y(t0+5.6),.65*S,"F");};

  /* header */
  tx("ADMIN 27",557.4,29.2,9.1,VAL,"normal",{align:"right"});
  bar(96.6,35.4,544.9,36.1);bar(96.6,36.8,544.9,37.6);
  tx("MONTHLY CLAIM FORM",321,50.1,10.7,GOTHIC,"bold",{align:"center"});bar(261.5,48.7,380.5,49.7);
  tx("NAME  :",98,68.4,7.6,GOTHIC,"bold");val(String(k.name).toUpperCase(),130.9,68.7,8,285);
  tx("MONTH / YEAR  :",422.6,68.2,6.8,GOTHIC,"bold");val(k.month,482.5,68.6,8,75);
  /* main table */
  [[73.9,74.6],[83.9,84.6]].forEach(([a,b])=>bar(96.6,a,544.9,b));
  const rowTops=[98.6,112.6,126.5,140.4,154.3,168.2,182.6,197.0,211.4,225.8,240.2,254.6,269.0];
  rowTops.forEach(t=>bar(96.6,t,544.9,t+.18));
  bar(433.6,74.6,433.75,83.9);bar(487.4,74.6,487.6,83.9);bar(433.6,84.6,433.75,269.2);bar(487.4,84.6,487.6,269.2);
  tx("Item",100.1,83.1,6.1,GOTHIC,"bold");tx("Description",124,83.1,6.1,GOTHIC,"bold");tx("Amount (RM)",438.5,82.7,6.1,GOTHIC,"bold");tx("Total (RM)",501.7,83.1,6.1,GOTHIC,"bold");
  tx("1.",103.9,95.6,6.8,GOTHIC);tx("TRANSPORTATION :",124,95.6,6.8,GOTHIC,"bold");tx("Vehicle No. :",207.6,95.2,6.1,GOTHIC);
  val(k.vehicle,246,97.4,9,40);
  cbox(289.3,89.4,k.own==="Own");tx("Own",304.1,95.2,6.1,GOTHIC);cbox(337.8,89.4,k.own==="Company");tx("Company",352.3,95.2,6.1,GOTHIC);
  tx("a)",123.8,109.3,6.1,GOTHIC);tx("Fuel",133.5,109.3,6.1,GOTHIC);tx("(",149,109.3,6.1,GOTHIC,"italic");tx("Mileage claim not acceptable)",178.3,109.3,6.1,GOTHIC,"italic");
  [["b)","Car Wash / Care",123.3],["c)","Maintenance / Service",137.2],["d)","Parking / Toll",151.1],["e)","Others (pls specify) :",165.0]].forEach(([n,l,b])=>{tx(n,151.1,b,6.1,GOTHIC);tx(l,160.8,b,6.1,GOTHIC);});
  val(k.labels.s1e,222,165.4,6.8,205);
  [["2.","MEDICAL EXPENSES :",179.6],["3.","TELECOMMUNICATION :",194.0],["4.","UTILITIES :",208.4],["5.","MISC. EXPENSES (pls specify)",222.8]].forEach(([n,l,b])=>{tx(n,103.9,b,6.8,GOTHIC);tx(l,124,b,6.8,GOTHIC,"bold");});
  [["a)",236.8,"s5a"],["b)",251.2,"s5b"],["c)",265.6,"s5c"]].forEach(([n,b,key])=>{tx(n,123.8,b,6.1,GOTHIC);val(k.labels[key],137,b+.3,6.8,290);});
  /* amounts: Amount column per line, Total column = section total on the section's last filled line */
  const rowBottom={s1a:112.6,s1b:126.5,s1c:140.4,s1d:154.3,s1e:168.2,s2:182.6,s3:197.0,s4:211.4,s5a:240.2,s5b:254.6,s5c:269.0};
  const amt=(key,v)=>{if(!(v>0))return;val(`RM ${fmt2(v)}`,436.2,rowBottom[key]-1,9,49);};
  const tot=(key,v)=>{if(!(v>0))return;val(`RM ${fmt2(v)}`,490.3,rowBottom[key]-1,9,52);};
  A27_LINES.forEach(key=>amt(key,k.lines[key]));
  const lastOf=keys=>[...keys].reverse().find(x=>k.lines[x]>0);
  const l1=lastOf(["s1a","s1b","s1c","s1d","s1e"]);if(l1)tot(l1,k.s1);
  ["s2","s3","s4"].forEach(key=>tot(key,k.lines[key]));
  const l5=lastOf(["s5a","s5b","s5c"]);if(l5)tot(l5,k.s5);
  /* outstation blocks 6a–6c */
  k.os.forEach((o,i)=>{
    const d=i*96.7;
    tx(`6${"abc"[i]}.`,101.5,283.5+d,6.8,GOTHIC);tx("OUTSTATION EXPENSES",124,283.4+d,6.8,GOTHIC,"bold");tx("Claimable :",248.4,283.1+d,6.1,GOTHIC,"bold");
    const cy=[276.4,368.0,464.8][i];cbox(289.8,cy,o.claimable==="Yes");tx("  Yes",304.2,283.6+d,6.8,BOOK);cbox(337.8,cy,o.claimable==="No");tx("  No",352.4,283.6+d,6.8,BOOK);
    tx("  Travel Date :",97.9,298.1+d,6.1,GOTHIC,"bold");dots(144.1,240.7,301.4+d);val(o.travelDate,146,299.6+d,7,92);
    tx("Travel By :",248.4,298.1+d,6.1,GOTHIC,"bold");cbox(289.8,291.8+d,o.travelBy==="Air");plane(306.8,290.4+d);cbox(337.8,291.8+d,o.travelBy==="Land");bus(355.7,289.7+d);cbox(368.4,291.8+d,o.travelBy==="Others");
    tx("Others :",400.6,298.0+d,6.1,BOOK);if(o.travelBy==="Others")val(o.travelByOther,424,298.2+d,6.8,120);
    tx("  Destination :",97.9,314.7+d,6.1,GOTHIC,"bold");tx("  From / To :",145.3,314.7+d,6.1,GOTHIC,"italic");dots(192.4,399.5,316.4+d);val(o.fromTo,195,314.6+d,7,200);
    tx("  Job No. :",400.7,314.7+d,6.1,GOTHIC,"bold");dots(433.6,481.9,316.4+d);val(o.jobNo,435.5,314.6+d,7,45);
    tx("  Type of Meeting :",97.9,330.0+d,6.1,GOTHIC,"bold");cbox(159.3,322.4+d,o.meeting==="Co-ordination");tx("Co-ordination :",172.3,330.4+d,6.1,BOOK);
    cbox(241.4,322.4+d,o.meeting==="Site");tx("Site :",255.9,330.4+d,6.1,BOOK);cbox(289.3,322.4+d,o.meeting==="Others");tx("Others :",304.1,330.4+d,6.1,BOOK);
    if(o.meeting==="Others")val(o.meetingOther,328,330.6+d,6.8,150);
    // amounts table
    [335.2,348.5,364.1].forEach(t=>bar(96.7,t+d,481.9,t+d+.12));
    [96.6,144.1,192.4,240.6,288.8,337.1,385.3,481.8].forEach(x=>bar(x,335.3+d,x+.13,364.2+d));
    bar(487.4,348.5+d,487.6,364.2+d);bar(544.8,348.6+d,544.95,364.2+d);bar(487.6,348.5+d,544.9,348.62+d);bar(487.6,364.1+d,544.9,364.22+d);
    [["Air Ticket",107.2],["Hotel",160.8],["Fares",208.9],["F & B",257.9],["Parking /Toll",295.1]].forEach(([l,x])=>tx(l,x,345.3+d,6.1,GOTHIC,"bold"));
    tx("Fuel ",343.9,345.3+d,6.1,GOTHIC,"bold");tx("(Mileage)",357.6,344.9+d,4.6,GOTHIC,"bold");
    tx("Others ",408.8,343.0+d,6.1,GOTHIC,"bold");tx("(Pls specify) :",429.7,342.6+d,4.6,GOTHIC,"bold");
    if(o.othersLabel)val(o.othersLabel,388,347.2+d,5,92);
    [97.7,145.2,193.4,241.7,289.9,386.4].forEach(x=>tx("RM",x,358.7+d,4.6,GOTHIC));tx("/KM",372.7,358.7+d,4.6,GOTHIC);
    const colX={air:105,hotel:152.6,fares:200.8,fb:249,parking:297.3,others:394};
    Object.entries(colX).forEach(([key,x])=>{if(o.amt[key]>0)val(fmt2(o.amt[key]),x,359.4+d,7,key==="others"?84:37);});
    if(o.amt.mileage>0)val(`RM ${fmt2(o.amt.mileage)}`,339,353.6+d,6,44);
    if(o.rmPerKm)val(String(o.rmPerKm),352,359.4+d,6,19);
    if(o.total>0)val(`RM ${fmt2(o.total)}`,490.3,360.4+d,8.5,52);
  });
  /* total + note + signatures */
  tx("TOTAL CLAIM AMOUNT (RM) :",368.2,574.3,7.6,GOTHIC,"bold");
  bar(487.4,560.9,544.9,561.6);bar(487.4,562.3,544.9,563.0);bar(487.4,576.8,544.9,578.3);
  if(k.total>0)val(`RM ${fmt2(k.total)}`,489.8,576.2,10,54);
  const who=checkerName();
  tx("Note:",97.8,606.8,6.1,BOOK,"bold");
  tx(`All claims without supporting document (e.g. receipt / invoice) will not be entertained.  Kindly pass to ${who} for checking purposes.`,124,607,6.8,BOOK,"italic");
  [["Submitted by",97.9,": ………………………...",142.2],["Checked by",241.9,": …………..…………………",279.6],["Approved by",406.1,": …………..……………...",446.8]].forEach(([l,x,dl,x2])=>{tx(l,x,626.9,7.6,BOOK,"italic");tx(dl.replace(/…/g,"..."),x2,626.9,7.6,BOOK);});
  [[97.9,142.8],[234.4,273.5],[398.5,439.6]].forEach(([x,x2])=>{tx("Date",x,651.2,7.6,BOOK,"italic");tx(": ..............................",x2,651.2,7.6,BOOK);});
  if(k.submittedBy)val(String(k.submittedBy).toUpperCase(),147.7,624.3,9,92);
  if(k.submittedDate)val(k.submittedDate,151,648.6,10,62);
  bar(96.6,660.4,544.9,662.5);
  /* revision box (company document control) */
  const rb={x0:107,x1:527.2,y:[667.3,679.7,692.4,705.4],c:[177.1,341.3,453.3]};
  doc.setFillColor(242,242,242);doc.rect(X(rb.x0),Y(rb.y[0]),(rb.x1-rb.x0)*S,(rb.y[1]-rb.y[0])*S,"F");
  doc.setDrawColor(0,0,0);doc.setLineWidth(.9*S);doc.rect(X(rb.x0),Y(rb.y[0]),(rb.x1-rb.x0)*S,(rb.y[3]-rb.y[0])*S);
  doc.setLineWidth(.6*S);[rb.y[1],rb.y[2]].forEach(t=>doc.line(X(rb.x0),Y(t),X(rb.x1),Y(t)));
  doc.line(X(rb.c[1]),Y(rb.y[0]),X(rb.c[1]),Y(rb.y[3]));doc.line(X(rb.c[0]),Y(rb.y[1]),X(rb.c[0]),Y(rb.y[3]));doc.line(X(rb.c[2]),Y(rb.y[1]),X(rb.c[2]),Y(rb.y[3]));
  tx("REVISION INFORMATION",116.2,677.6,8,BOOK,"bold");tx("REVISION NOTES",350.5,677.6,8,BOOK,"bold");
  tx("Revision Date:",116.2,690.4,7.7,BOOK);doc.setTextColor(230,30,30);tx("07/05/2024",186.2,690.4,7.7,BOOK);
  doc.setTextColor(70,200,90);tx("GREEN FONT",397.3,690.4,7.7,BOOK,"normal",{align:"center"});doc.setTextColor(0,0,0);tx("New document",462.8,690.4,7.7,BOOK);
  tx("Circulation:",116.2,703.1,7.7,BOOK);tx("Confidential & strictly for office use only",186.2,703.1,7.7,BOOK);
  doc.setTextColor(230,30,30);tx("RED FONT",397.3,703.1,7.7,BOOK,"normal",{align:"center"});doc.setTextColor(0,0,0);tx("Line Change",462.8,703.1,7.7,BOOK);
  tx("A27/1",305.8,754.6,7.6,VAL,"normal",{align:"center"});
  return doc.output("arraybuffer");
}

/* ---------------- claim summary ---------------- */
function fuelStats(c){
  const f=sortedItems(c).filter(x=>x.type==="fuel"&&safeNum(x.qty)>0&&safeNum(x.amount)>0);
  if(!f.length)return null;
  const litres=f.reduce((s,x)=>s+safeNum(x.qty),0),paid=round2(f.reduce((s,x)=>s+safeNum(x.amount),0));
  const prices=f.map(x=>safeNum(x.rate)||safeNum(x.amount)/safeNum(x.qty));
  const first=f[0],last=f[f.length-1],p0=prices[0],p1=prices[prices.length-1];
  return {n:f.length,litres,paid,wavg:paid/litres,savg:prices.reduce((s,x)=>s+x,0)/prices.length,lo:Math.min(...prices),hi:Math.max(...prices),
    move:p1-p0,movePct:p0?((p1-p0)/p0*100):0,firstDate:first.date,lastDate:last.date,avgL:litres/f.length,avgRM:paid/f.length};
}
async function makeSummary(c){
  const doc=newDoc(),d=c.details,s=c.opts.sum,refs=refMap(c),items=sortedItems(c);
  const page=()=>{doc.addPage();return docHeader(doc,"CLAIM SUMMARY (cont.)",c);};
  let y=docHeader(doc,"CLAIM SUMMARY",c),n=1;
  const need=h=>{if(y+h>278)y=page();};
  if(s.details){
    y=sectionTitle(doc,y,n++,"Claim details")+1;
    const pairs=[["Claimant",d.claimant],["Designation",d.designation],["Project / contract",d.project],["Claim month",claimMonthLabel(d.period)],
      ["Claim types",d.claimTypes.map(k=>TYPE[k].l).join(", ")],["Submission date",dmy(d.submissionDate)]];
    if(usesVehicle(c)&&d.vehicle)pairs.push(["Vehicle",`${d.vehicle}${d.ownership?` (${d.ownership.toLowerCase()} vehicle)`:""}`]);
    if(d.projectCode)pairs.push(["Project code",d.projectCode]);
    y=kvGrid(doc,y,pairs,{cols:3});
  }
  if(s.items){
    need(30);y=sectionTitle(doc,y,n++,"Claim items")+1;
    const cols=[{h:"Ref",w:9},{h:"Date",w:17.5},{h:"Type",w:19},{h:"Merchant / details",w:0}];
    if(s.colRef)cols.push({h:"Invoice / ref. no.",w:27});
    if(s.colQty)cols.push({h:"Qty",w:13,align:"right"},{h:"Unit RM",w:13,align:"right"});
    cols.push({h:"Amount (RM)",w:19,align:"right"});
    if(s.colCum)cols.push({h:"Running (RM)",w:19,align:"right"});
    cols[3].w=182-cols.reduce((a,b)=>a+b.w,0);
    let run=0;
    const rows=items.map(it=>{run+=safeNum(it.amount);const t=typeOf(it);
      const r=[refs[it.id],dmy(it.date)||"-",t.s,[it.station,it.desc].filter(Boolean).join(" - ")||"-"];
      if(s.colRef)r.push(it.invoiceNo||"-");
      if(s.colQty)r.push(safeNum(it.qty)>0?(it.type==="fuel"?safeNum(it.qty).toFixed(3):String(it.qty)):"-",safeNum(it.rate)>0?safeNum(it.rate).toFixed(2):"-");
      r.push(fmt2(it.amount));if(s.colCum)r.push(fmt2(run));return r;});
    const foot=cols.map(()=>"");foot[3]=`TOTAL (${items.length} item${items.length===1?"":"s"})`;
    const fuelL=items.filter(x=>x.type==="fuel").reduce((a,x)=>a+safeNum(x.qty),0);
    if(s.colQty&&fuelL>0&&items.every(x=>x.type==="fuel"))foot[cols.findIndex(cc=>cc.h==="Qty")]=fuelL.toFixed(3);
    foot[cols.findIndex(cc=>cc.h==="Amount (RM)")]=fmt2(itemTotal(c));
    y=drawTable(doc,{y,cols,rows,foot,onNewPage:page,size:7.8})+7;
  }
  if(s.byType){
    const by=byTypeRows(c).filter(r=>r.count);
    if(by.length){
      need(24);y=sectionTitle(doc,y,n++,"Breakdown by claim type")+1;
      y=drawTable(doc,{y,cols:[{h:"Claim type",w:70},{h:"Form line",w:40},{h:"Items",w:22,align:"right"},{h:"Amount (RM)",w:25,align:"right"},{h:"Share",w:25,align:"right"}],
        rows:by.map(r=>[r.label,`Item ${r.line}`,String(r.count),fmt2(r.amount),itemTotal(c)?`${(r.amount/itemTotal(c)*100).toFixed(1)}%`:"-"]),
        foot:["Total","",String(c.items.length),fmt2(itemTotal(c)),"100%"],onNewPage:page})+7;
    }
  }
  const fs=fuelStats(c);
  if(s.fuelStats&&fs){
    need(52);y=sectionTitle(doc,y,n++,"Fuel statistics")+1;
    y=drawTable(doc,{y,cols:[{h:"Measure",w:122},{h:"Value",w:60,align:"right"}],onNewPage:page,rows:[
      ["Number of refuelling transactions",String(fs.n)],["Total quantity purchased",`${fs.litres.toFixed(3)} litres`],["Total amount paid",money(fs.paid)],
      ["Weighted average price per litre (total paid / total litres)",`RM ${fs.wavg.toFixed(3)}`],["Simple average of receipt prices per litre",`RM ${fs.savg.toFixed(3)}`],
      ["Lowest / highest price per litre",`RM ${fs.lo.toFixed(2)} / RM ${fs.hi.toFixed(2)}`],
      [`Price movement, ${dShort(fs.firstDate)} to ${dShort(fs.lastDate)}`,`${fs.move>=0?"+":"-"}RM ${Math.abs(fs.move).toFixed(2)} per litre (${fs.move>=0?"+":""}${fs.movePct.toFixed(1)}%)`],
      ["Average quantity / amount per refuel",`${fs.avgL.toFixed(3)} litres / ${money(fs.avgRM)}`]]})+7;
  }
  if(s.cap&&fs&&safeNum(s.capAmount)>0){
    const cap=safeNum(s.capAmount),sub=safeNum(s.subsidyPrice),over=fs.paid-cap;
    const rows=[["Monthly fuel allowance cap",money(cap)],["Total paid as % of cap",`${(fs.paid/cap*100).toFixed(1)}%`],[over>0?"Amount paid in excess of cap":"Amount within cap",money(Math.abs(over))],
      [`Litres the cap buys at this month's weighted average price (RM ${fs.wavg.toFixed(3)})`,`${(cap/fs.wavg).toFixed(1)} litres`]];
    if(sub>0)rows.push([`Subsidised price (as stated)`,`RM ${sub.toFixed(2)} per litre`],[`Cost of the same ${fs.litres.toFixed(3)} litres at the subsidised price`,money(fs.litres*sub)],
      ["Additional cost versus the subsidised price",money(fs.paid-fs.litres*sub)],["Litres the cap would buy at the subsidised price",`${(cap/sub).toFixed(1)} litres`]);
    need(16+rows.length*7);y=sectionTitle(doc,y,n++,"Fuel allowance comparison")+1;
    y=drawTable(doc,{y,cols:[{h:"Comparison",w:122},{h:"Value",w:60,align:"right",color:(r)=>/excess|Additional/.test(r[0])?ACC:null}],onNewPage:page,rows})+7;
  }
  if(String(s.remarks||"").trim()){
    const lines=doc.splitTextToSize(T(s.remarks),174);need(12+lines.length*4.5);
    y=sectionTitle(doc,y,n++,"Remarks")+2;doc.setFont("helvetica","italic");doc.setFontSize(9);doc.text(lines,16,y+1);y+=lines.length*4.3+6;
  }
  if(s.declaration){
    const txt=`The expenses above were incurred in the course of official duties for ${d.project||"the project"} and have not been claimed before. The attached receipts and e-invoices are true copies; the original receipts are attached at the Appendix. The claim is signed on the claim form.`;
    const lines=doc.splitTextToSize(T(txt),174);need(14+lines.length*4.5);
    y=sectionTitle(doc,y,n++,"Declaration")+2;doc.setFont("helvetica","normal");doc.setFontSize(9);doc.setTextColor(...INK);doc.text(lines,16,y+1);y+=lines.length*4.3+5;
  }
  return doc.output("arraybuffer");
}

/* ---------------- index + cover (need page numbers, built after the plan) ---------------- */

async function makeIndex(c,plan,appendix){
  const doc=newDoc(),refs=refMap(c);
  const page=()=>{doc.addPage();return docHeader(doc,"SUPPORTING DOCUMENT INDEX (cont.)",c);};
  let y=docHeader(doc,"SUPPORTING DOCUMENT INDEX",c);
  y=refLegend(doc,y,"Each document carries its reference on its page.");
  const rows=[];
  for(const it of sortedItems(c)){
    const r=refs[it.id],docs=plan.docs.filter(x=>x.item.id===it.id);
    const base=[dmy(it.date)||"-",typeOf(it).s,[it.station,it.invoiceNo?`No. ${it.invoiceNo}`:""].filter(Boolean).join("\n")||"-",fmt2(it.amount)];
    if(!docs.length){rows.push([r,...base,"No document attached","-"]);continue;}
    docs.forEach((x,k)=>rows.push([x.ref,...(k?["","","",""]:base),KIND[x.kind].label,x.pages.length?pagesTxt(x):"-"]));
  }
  y=drawTable(doc,{y,cols:[{h:"Ref",w:14,color:r=>/-[RES]$/.test(r[0])?refColor(r[0]):null},{h:"Date",w:18},{h:"Type",w:20},{h:"Merchant / invoice no.",w:58},{h:"Amount (RM)",w:22,align:"right"},{h:"Document",w:28},{h:"Page",w:22,align:"right"}],rows,
    foot:["","","",`${c.items.length} items · ${plan.docs.length} documents`,fmt2(itemTotal(c)),"",`${plan.attPages} pages`],onNewPage:page,size:7.8})+6;
  if(appendix){
    if(y>262)y=page();
    doc.setDrawColor(...INK);doc.setLineWidth(.3);doc.rect(14,y,182,13);
    doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...INK);doc.text(T(`Appendix A - Original receipts: page ${appendix.from}`),18,y+5.5);
    doc.setFont("helvetica","normal");doc.setFontSize(8);doc.setTextColor(...MUTED);doc.text(T("The original receipts and bills are attached behind the Appendix A cover sheet at the end of this pack, in reference order."),18,y+10);
  }
  return doc.output("arraybuffer");
}
/* the three reference colours, explained once at the top of a page */
function refLegend(doc,y,lead){
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(...MUTED);doc.text(T(lead),14,y);
  let x=14+doc.getTextWidth(T(lead))+4;
  [["R","Receipt / bill"],["E","E-invoice"],["S","Other support"]].forEach(([k,l])=>{doc.setFillColor(...REFC[k]);doc.roundedRect(x,y-3,6.5,4,.8,.8,"F");doc.setTextColor(255,255,255);doc.setFont("helvetica","bold");doc.setFontSize(7);doc.text(k,x+3.25,y-.1,{align:"center"});
    doc.setTextColor(...MUTED);doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.text(l,x+8,y);x+=8+doc.getTextWidth(l)+5;});
  doc.setTextColor(...INK);return y+5;
}
/* Appendix A: the cover sheet for the original receipts, stapled behind it in the hardcopy */
async function makeAppendix(c,plan){
  const doc=newDoc(),refs=refMap(c),d=c.details;
  const page=()=>{doc.addPage();return docHeader(doc,"APPENDIX A - ORIGINAL RECEIPTS (cont.)",c);};
  let y=docHeader(doc,"APPENDIX A",c);
  doc.setFont("helvetica","bold");doc.setFontSize(24);doc.setTextColor(...INK);doc.text("ORIGINAL RECEIPTS",105,y+14,{align:"center"});
  doc.setFont("helvetica","normal");doc.setFontSize(10);doc.setTextColor(...MUTED);
  doc.text(T(`${claimMonthLabel(d.period)} claim · ${d.claimant||""}`),105,y+21,{align:"center"});
  y+=30;
  doc.setDrawColor(...INK);doc.setLineWidth(.3);doc.rect(14,y,182,17);
  doc.setFont("helvetica","bold");doc.setFontSize(9);doc.setTextColor(...INK);doc.text("Attach the original receipts behind this sheet",18,y+6);
  doc.setFont("helvetica","normal");doc.setFontSize(8.5);doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(T("In the order below. Write the reference (e.g. 01-R) on the back of each original, or stick small receipts on A4 paper and write the references beside them. Tick each one as you attach it."),172),18,y+10.5);
  y+=23;
  y=refLegend(doc,y,"References match the claim summary and the copies in this pack.");
  const rows=[];
  for(const it of sortedItems(c)){
    const ds=plan.docs.filter(x=>x.item.id===it.id&&x.kind!=="invoice");
    const list=ds.length?ds:[{ref:`${refs[it.id]}-R`,kind:"receipt",pages:[]}];
    list.forEach(x=>rows.push([x.ref,dmy(it.date)||"-",[it.station,it.invoiceNo?`No. ${it.invoiceNo}`:""].filter(Boolean).join("\n")||"-",KIND[x.kind].label,fmt2(it.amount),x.pages&&x.pages.length?pagesTxt(x):"-",""]));
  }
  const cols=[{h:"Ref",w:15,color:r=>refColor(r[0])},{h:"Date",w:19},{h:"Merchant / receipt no.",w:62},{h:"Document",w:25},{h:"Amount (RM)",w:22,align:"right"},{h:"Copy at",w:19,align:"right"},{h:"Attached",w:20,align:"center",box:true}];
  y=drawTable(doc,{y,cols,rows,foot:["","",`${rows.length} original${rows.length===1?"":"s"}`,"",fmt2(itemTotal(c)),"",""],onNewPage:page,size:8});
  return {bytes:doc.output("arraybuffer"),rows:rows.length};
}
async function makeCover(c,sections,totalPages,plan){
  const doc=newDoc(),d=c.details,total=itemTotal(c);
  // title block: black text on white, double rule as on the Admin 27 form
  doc.setDrawColor(...INK);doc.setLineWidth(.8);doc.line(14,16,196,16);doc.setLineWidth(.25);doc.line(14,17.4,196,17.4);
  doc.setTextColor(...MUTED);doc.setFont("helvetica","bold");doc.setFontSize(9);doc.text("MONTHLY CLAIM SUBMISSION",14,29,{charSpace:.8});
  doc.setTextColor(...INK);doc.setFontSize(30);doc.text(T((claimMonthLabel(d.period)||"Claim").toUpperCase()),14,43);
  doc.setFontSize(14);doc.text(T(d.claimant||"Claimant not entered"),14,53);
  doc.setFont("helvetica","normal");doc.setFontSize(10);doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(T([d.designation,d.project].filter(Boolean).join("  |  ")),182).slice(0,2),14,60);
  doc.setDrawColor(...INK);doc.setLineWidth(.25);doc.line(14,68,196,68);
  const tiles=[["TOTAL CLAIMED",money(total)],["CLAIM ITEMS",String(c.items.length)],["SUPPORTING DOCUMENTS",`${plan.docs.length} (${plan.attPages} page${plan.attPages===1?"":"s"})`]];
  tiles.forEach(([l,v],i)=>{const x=14+i*61.3,w=59;doc.setDrawColor(...(i===0?INK:LINE));doc.setLineWidth(i===0?.5:.3);doc.roundedRect(x,75,w,24,1.5,1.5,"S");
    doc.setTextColor(...MUTED);doc.setFont("helvetica","bold");doc.setFontSize(7);doc.text(l,x+5,82);
    doc.setTextColor(...INK);doc.setFontSize(i===0?16:13);doc.text(T(v),x+5,93);});
  let y=111;
  y=sectionTitle(doc,y,"","Claim details")+1;
  const pairs=[["Project / contract",d.project],["Claim types",d.claimTypes.map(k=>TYPE[k].l).join(", ")],["Submission date",dmy(d.submissionDate)]];
  if(usesVehicle(c)&&d.vehicle)pairs.push(["Vehicle",`${d.vehicle}${d.ownership?` (${d.ownership.toLowerCase()} vehicle)`:""}`]);
  if(d.projectCode)pairs.push(["Project code",d.projectCode]);
  y=kvGrid(doc,y,pairs,{cols:2});
  y=sectionTitle(doc,y+1,"","Contents")+1;
  y=drawTable(doc,{y,cols:[{h:"Section",w:120},{h:"Pages",w:62,align:"right"}],rows:sections.map(sct=>[sct.title,sct.from===sct.to?`${sct.from}`:`${sct.from} - ${sct.to}`]),foot:["Total",`${totalPages} pages`],maxY:999})+8;
  const by=byTypeRows(c).filter(r=>r.count);
  if(by.length>1&&y+14+(by.length+2)*6.7<252){y=sectionTitle(doc,y,"","Amount by claim type")+1;
    y=drawTable(doc,{y,cols:[{h:"Claim type",w:100},{h:"Items",w:30,align:"right"},{h:"Amount (RM)",w:52,align:"right"}],rows:by.map(r=>[r.label,String(r.count),fmt2(r.amount)]),foot:["Total",String(c.items.length),fmt2(total)],maxY:999})+4;}
  // bottom right: prepared-with line, and (optional) a small QR to the app for colleagues who want to use it
  const qr=c.opts.coverQr!==false?qrModules(appUrl()):null,qs=qr?20:0;
  if(qr){const n=qr.length,cell=qs/n,x0=196-qs,y0=284-qs-1;doc.setFillColor(...INK);
    for(let r=0;r<n;r++)for(let k=0;k<n;k++)if(qr[r][k])doc.rect(x0+k*cell,y0+r*cell,cell+.02,cell+.02,"F");}
  const tx=qr?196-qs-3:196;
  doc.setFont("helvetica","normal");doc.setFontSize(7.5);doc.setTextColor(...MUTED);
  doc.text(T(`Prepared ${dmy(localToday())} with ${APP_NAME} (developed by ${DEV}).`),tx,qr?272:279,{align:"right"});
  doc.text(T("Check every entry against the original documents before submission."),tx,qr?276:283,{align:"right"});
  if(qr){doc.setFontSize(6.5);doc.text("Scan to use the app",tx,280.5,{align:"right"});}
  return doc.output("arraybuffer");
}
/* ---------------- supporting documents: plan, then draw ---------------- */
async function imageToCanvas(file,maxPx=2000){
  let src;
  try{src=await createImageBitmap(file);}catch(e){
    const url=URL.createObjectURL(file);
    try{src=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error(`${file.name}: this image type cannot be read here (use JPEG or PNG).`));i.src=url;});}
    finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}
  }
  const w=src.width||src.naturalWidth,h=src.height||src.naturalHeight,s=Math.min(1,maxPx/Math.max(w,h));
  const canvas=document.createElement("canvas");canvas.width=Math.round(w*s);canvas.height=Math.round(h*s);
  const ctx=canvas.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(src,0,0,canvas.width,canvas.height);
  return {canvas,w:canvas.width,h:canvas.height};
}
async function jpegBytes(file){
  const {canvas}=await imageToCanvas(file,2000);
  const blob=await new Promise((res,rej)=>canvas.toBlob(b=>b?res(b):rej(new Error("The image could not be converted for the PDF.")),"image/jpeg",.85));
  return new Uint8Array(await blob.arrayBuffer());
}
/* page geometry for the supporting documents (points, A4) */
const AP={W:595.28,H:841.89,M:34,top:841.89-40,bottom:42,gap:12,cap:34};
const attLayout=o=>o.layout||(Number(o.perPage)===1?"one":Number(o.perPage)>=6?"auto3":"auto2");
async function imageSize(file){
  try{const b=await createImageBitmap(file);const r={w:b.width,h:b.height};b.close&&b.close();return r;}
  catch(e){const {w,h}=await imageToCanvas(file,400);return {w,h};}
}
async function planAttachments(c){
  const {PDFDocument}=await getPdfLib(),refs=refMap(c),items=sortedItems(c),o=c.opts.att,layout=attLayout(o);
  const docs=[];
  for(const it of items)for(const [kind] of KINDS){
    const file=await getFile(fileKey(c.id,it.id,kind));if(!file)continue;
    const d={item:it,kind,ref:`${refs[it.id]}-${KIND[kind].code}`,file,isPdf:file.type==="application/pdf",pages:[],pdf:null,n:1};
    if(d.isPdf){
      try{d.pdf=await PDFDocument.load(await file.arrayBuffer(),{ignoreEncryption:true});d.n=d.pdf.getPageCount();}
      catch(e){throw new Error(`${d.ref} (${file.name}) could not be opened as a PDF: ${e.message}`);}
    }else Object.assign(d,await imageSize(file));
    docs.push(d);
  }
  const byKind=k=>[...docs.filter(d=>d.kind===k&&!d.isPdf),...docs.filter(d=>d.kind===k&&d.isPdf)];
  const order=o.order==="item"?docs:[...byKind("receipt"),...byKind("invoice"),...byKind("other")];
  const ncol=layout==="one"?1:layout==="auto3"?3:2,cw=(AP.W-2*AP.M-(ncol-1)*AP.gap)/ncol,fullH=AP.top-AP.bottom;
  // each photo goes into the shortest column (reads left to right, top to bottom); a new page when it does not fit
  const pages=[];let pg=null,yCol=[];
  const newPage=()=>{pg={type:"img",tiles:[]};pages.push(pg);yCol=Array(ncol).fill(AP.top);};
  for(const d of order){
    if(d.isPdf){pg=null;for(let i=0;i<d.n;i++)pages.push({type:"pdf",d,i});continue;}
    const imgH=layout==="one"?fullH-AP.cap:Math.min(cw*d.h/d.w,fullH-AP.cap),tileH=AP.cap+imgH;
    if(!pg||layout==="one")newPage();
    let col=yCol.indexOf(Math.max(...yCol));
    if(yCol[col]-tileH<AP.bottom){newPage();col=0;}
    pg.tiles.push({d,x:AP.M+col*(cw+AP.gap),yTop:yCol[col],w:cw,imgH});
    yCol[col]-=tileH+AP.gap;
  }
  return {docs:order,pages,attPages:pages.length};
}
function assignPages(plan,startPage){
  plan.docs.forEach(d=>d.pages=[]);
  plan.pages.forEach((p,i)=>{const no=startPage+i;if(p.type==="pdf")p.d.pages.push(no);else p.tiles.forEach(t=>t.d.pages.push(no));});
}
const pagesTxt=d=>d.pages.length?`p.${d.pages[0]}${d.pages.length>1?`-${d.pages[d.pages.length-1]}`:""}`:"";
function partnersTxt(plan,d){
  const others=plan.docs.filter(x=>x.item.id===d.item.id&&x!==d);
  return others.length?`With ${others.map(x=>`${x.ref} (${pagesTxt(x)})`).join(", ")}`:"";
}
async function drawAttachments(out,plan,c,fonts){
  const {rgb}=await getPdfLib();
  const {W,H,M}=AP,ink=rgb(.078,.13,.17),muted=rgb(.35,.41,.45),line=rgb(.78,.81,.83),C=k=>rgb(...REFC[k].map(v=>v/255));
  const {reg,bold}=fonts;
  const fitText=(s,font,size,maxW)=>{s=T(s);if(font.widthOfTextAtSize(s,size)<=maxW)return s;while(s.length>1&&font.widthOfTextAtSize(s+"...",size)>maxW)s=s.slice(0,-1);return s+"...";};
  const pageHead=(page,label)=>{
    page.drawLine({start:{x:M,y:H-24},end:{x:W-M,y:H-24},thickness:1.2,color:ink});
    page.drawText("SUPPORTING DOCUMENTS",{x:M,y:H-36,size:10,font:bold,color:ink});
    const l=fitText(label,reg,8,300);page.drawText(l,{x:W-M-reg.widthOfTextAtSize(l,8),y:H-35.5,size:8,font:reg,color:muted});
  };
  const caption=(page,d,x,yTop,w,pageNote="")=>{ // a 30pt caption box with the coloured reference; returns y below it
    const it=d.item,t=typeOf(it),k=KIND[d.kind].code,col=C(k);
    page.drawRectangle({x,y:yTop-30,width:w,height:30,borderColor:line,borderWidth:.6});
    page.drawRectangle({x,y:yTop-30,width:3.2,height:30,color:col});
    const tag=d.ref,tw=bold.widthOfTextAtSize(tag,10)+10;
    page.drawRectangle({x:x+8,y:yTop-19,width:tw,height:14,color:col});
    page.drawText(tag,{x:x+13,y:yTop-15.2,size:10,font:bold,color:rgb(1,1,1)});
    const head=`${KIND[d.kind].label.toUpperCase()}${pageNote}  ·  ${money(it.amount)}`;
    page.drawText(fitText(head,bold,8.5,w-tw-22),{x:x+tw+14,y:yTop-14.8,size:8.5,font:bold,color:ink});
    const l2=[dmy(it.date),t.l,it.station,it.invoiceNo?`No. ${it.invoiceNo}`:""].filter(Boolean).join("  ·  ");
    page.drawText(fitText(l2,reg,7.3,w-16),{x:x+8,y:yTop-26.5,size:7.3,font:reg,color:muted});
    const pt=partnersTxt(plan,d);
    if(pt&&w>230){const s=fitText(pt,reg,7,Math.max(40,w-tw-24-bold.widthOfTextAtSize(fitText(head,bold,8.5,w-tw-22),8.5)-8));const sw=reg.widthOfTextAtSize(s,7);page.drawText(s,{x:x+w-8-sw,y:yTop-14.6,size:7,font:reg,color:muted});}
    else if(pt){const s=fitText(pt,reg,6.5,w-16);page.drawText(s,{x:x+8,y:yTop-33.5,size:6.5,font:reg,color:muted});}
    return yTop-(pt&&w<=230?38:34);
  };
  for(const p of plan.pages){
    const page=out.addPage([W,H]);
    if(p.type==="pdf"){
      const d=p.d;pageHead(page,`${d.ref} · ${d.file.name}`);
      const yTop=caption(page,d,M,AP.top,W-2*M,d.n>1?` (page ${p.i+1} of ${d.n})`:"");
      let emb;
      try{[emb]=await out.embedPdf(d.pdf,[p.i]);}catch(e){throw new Error(`${d.ref}: page ${p.i+1} could not be placed (${e.message})`);}
      const box={x:M,y:AP.bottom,w:W-2*M,h:yTop-6-AP.bottom};
      const sc=Math.min(box.w/emb.width,box.h/emb.height),w=emb.width*sc,h=emb.height*sc,x=box.x+(box.w-w)/2,y=box.y+box.h-h;
      page.drawRectangle({x:x-.5,y:y-.5,width:w+1,height:h+1,borderColor:line,borderWidth:.6});
      page.drawPage(emb,{x,y,width:w,height:h});
    }else{
      pageHead(page,p.tiles.map(t=>t.d.ref).join("  ·  "));
      for(const t of p.tiles){
        const below=caption(page,t.d,t.x,t.yTop,t.w);
        const img=await out.embedJpg(await jpegBytes(t.d.file));
        const boxH=Math.max(20,t.imgH-(t.yTop-AP.cap-below));
        const sc=Math.min(t.w/img.width,boxH/img.height),w=img.width*sc,h=img.height*sc,x=t.x+(t.w-w)/2,y=below-4-h;
        page.drawRectangle({x:x-.5,y:y-.5,width:w+1,height:h+1,borderColor:line,borderWidth:.6});
        page.drawImage(img,{x,y,width:w,height:h});
      }
    }
  }
}
/* ---------------- assemble the pack ---------------- */
let latestPdf=null,latestPdfName="",latestPageCount=0,latestSections=[],previewDoc=null,previewPage=1;
function invalidatePdf(){if(latestPdf){latestPdf=null;latestSections=[];}}
async function getPdfLib(){if(!window.PDFLib)throw new Error("PDF tools did not load. Reopen the app while online, then try again.");return window.PDFLib;}
async function countPages(bytes){const {PDFDocument}=await getPdfLib();return (await PDFDocument.load(bytes)).getPageCount();}
async function makePacket(){
  const {PDFDocument,StandardFonts,rgb}=await getPdfLib();
  const c=cur(),o=c.opts;
  if(!["cover","admin27","summary","index","attachments","appendix"].some(k=>o[k]))throw new Error("Nothing selected — tick at least one part of the pack.");
  const plan=await planAttachments(c);
  const parts=[];
  if(o.admin27)parts.push({key:"admin27",title:"Monthly claim form",bytes:await makeAdmin27()});
  if(o.summary)parts.push({key:"summary",title:"Claim summary",bytes:await makeSummary(c)});
  for(const p of parts)p.n=await countPages(p.bytes);
  // index page count is fixed by its rows, so page numbers can be worked out before drawing it
  let page=1+(o.cover?1:0);
  parts.forEach(p=>{p.from=page;page+=p.n;p.to=page-1;});
  let idx=null;
  const apxProbe=o.appendix&&c.items.length?{from:0}:null;
  if(o.index){
    assignPages(plan,0);const probe=await makeIndex(c,plan,apxProbe),n=await countPages(probe);
    idx={key:"index",title:"Supporting document index",n,from:page,to:page+n-1};page+=n;
  }
  const att=o.attachments&&plan.pages.length?{key:"attachments",title:"Supporting documents (receipts, e-invoices, other)",n:plan.pages.length,from:page,to:page+plan.pages.length-1}:null;
  if(att)page+=att.n;
  assignPages(plan,att?att.from:0);
  if(!att)plan.docs.forEach(d=>d.pages=[]);
  let apx=null;
  if(apxProbe){const a=await makeAppendix(c,plan);apx={key:"appendix",title:"Appendix A - original receipts (attach behind this sheet)",bytes:a.bytes,n:await countPages(a.bytes),from:page};apx.to=page+apx.n-1;page+=apx.n;}
  if(idx){idx.bytes=await makeIndex(c,plan,apx);if(await countPages(idx.bytes)!==idx.n)throw new Error("Index pagination changed — try again.");parts.push(idx);}
  const totalPages=page-1;
  const sections=[...parts];if(att)sections.push(att);if(apx)sections.push(apx);
  if(o.cover)parts.unshift({key:"cover",title:"Cover",bytes:await makeCover(c,sections,totalPages,plan),n:1,from:1,to:1});
  // assemble
  const out=await PDFDocument.create();
  out.setTitle(`Monthly claim ${claimMonthLabel(c.details.period)} - ${pdfSafe(c.details.claimant)}`);out.setCreator(`${APP_NAME} ${APP_VERSION} (${DEV})`);out.setProducer(APP_NAME);
  const pageKeys=[];
  for(const p of parts.sort((a,b)=>a.from-b.from)){const src=await PDFDocument.load(p.bytes);(await out.copyPages(src,src.getPageIndices())).forEach(pg=>{out.addPage(pg);pageKeys.push(p.key);});}
  const reg=await out.embedFont(StandardFonts.Helvetica),bold=await out.embedFont(StandardFonts.HelveticaBold);
  if(att){await drawAttachments(out,plan,c,{reg,bold});for(let i=0;i<att.n;i++)pageKeys.push("attachments");}
  if(apx){const src=await PDFDocument.load(apx.bytes);(await out.copyPages(src,src.getPageIndices())).forEach(pg=>{out.addPage(pg);pageKeys.push("appendix");});}
  // footer on every page except the company form
  const N=out.getPageCount(),d=c.details,left=T(`${d.claimant||"Claimant"} · ${claimMonthLabel(d.period)} claim`);
  out.getPages().forEach((pg,i)=>{
    if(pageKeys[i]==="admin27")return;
    const {width}=pg.getSize(),txt=`Page ${i+1} of ${N}`;
    pg.drawLine({start:{x:34,y:27},end:{x:width-34,y:27},thickness:.5,color:rgb(.8,.84,.86)});
    pg.drawText(left,{x:34,y:16,size:7.5,font:reg,color:rgb(.35,.41,.45)});
    pg.drawText(txt,{x:width-34-bold.widthOfTextAtSize(txt,7.5),y:16,size:7.5,font:bold,color:rgb(.078,.13,.17)});
    const mid=`${APP_NAME} · ${DEV}`;pg.drawText(mid,{x:width/2-reg.widthOfTextAtSize(mid,6.5)/2,y:16.5,size:6.5,font:reg,color:rgb(.6,.65,.68)});
  });
  latestSections=(o.cover?[{title:"Cover",from:1,to:1}]:[]).concat(sections.map(s=>({title:s.title,from:s.from,to:s.to})));
  return {bytes:await out.save(),pages:N};
}
function download(bytes,name,type="application/pdf"){
  const url=URL.createObjectURL(bytes instanceof Blob?bytes:new Blob([bytes],{type})),a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function generatePdf(){
  const c=cur();
  if(!c.items.length&&(c.opts.summary||c.opts.attachments||c.opts.index)&&!confirm("There are no claim items yet. Build the PDF anyway?"))return false;
  busy(true,"Building the submission pack…");
  try{
    const {bytes,pages}=await makePacket();
    latestPdf=new Blob([bytes],{type:"application/pdf"});latestPageCount=pages;
    latestPdfName=`CLAIM_${(c.details.period||"claim").replace("-","")}_${fileSlug(c.details.claimant)}.pdf`;
    c.exported=Date.now();
    try{localStorage.setItem(META_KEY,JSON.stringify({currentId:store.currentId,claims:store.claims}));}catch(e){}
    renderLight();toast(`PDF ready — ${pages} pages. Review every page.`);
    return true;
  }catch(err){console.error(err);toast(`Could not build the PDF: ${err.message}`);return false;}
  finally{busy(false);}
}
async function renderPreview(){
  const wrap=$("#pdf-preview");wrap.innerHTML="";$("#pdf-jump").innerHTML="";
  if(!latestPdf){wrap.innerHTML='<p class="small" style="color:#fff;margin:6px">Generate the PDF first.</p>';$("#pdf-page-label").textContent="—";return;}
  busy(true,"Loading preview…");
  try{
    const pdfjs=await getPdfJs();
    if(previewDoc)await previewDoc.destroy();
    previewDoc=await pdfjs.getDocument({data:new Uint8Array(await latestPdf.arrayBuffer())}).promise;
    previewPage=1;
    $("#pdf-jump").innerHTML=latestSections.map(s=>`<button type="button" data-jump="${s.from}">${escapeHtml(s.title.replace(/ \(.*\)| - .*/,""))} · p.${s.from}</button>`).join("");
    $("#pdf-info").textContent=`${latestPdfName} · ${previewDoc.numPages} A4 pages · ${(latestPdf.size/1048576).toFixed(1)} MB. Print at actual size (100%).`;
    await renderPreviewPage();
  }catch(err){console.error(err);toast(`Could not preview: ${err.message}`);}
  finally{busy(false);}
}
async function renderPreviewPage(){
  if(!previewDoc)return;
  const page=await previewDoc.getPage(previewPage),base=page.getViewport({scale:1}),wrap=$("#pdf-preview");
  const scale=Math.min(1.6,Math.max(.4,(wrap.clientWidth-20)/base.width)),vp=page.getViewport({scale});
  const canvas=document.createElement("canvas"),ratio=Math.min(2,window.devicePixelRatio||1);
  canvas.width=Math.round(vp.width*ratio);canvas.height=Math.round(vp.height*ratio);canvas.style.width=`${vp.width}px`;canvas.setAttribute("aria-label",`Page ${previewPage}`);
  await page.render({canvasContext:canvas.getContext("2d"),viewport:vp,transform:[ratio,0,0,ratio,0,0]}).promise;
  wrap.innerHTML="";wrap.appendChild(canvas);
  $("#pdf-page-label").textContent=`Page ${previewPage} / ${previewDoc.numPages}`;
  $("#pdf-prev").disabled=previewPage<=1;$("#pdf-next").disabled=previewPage>=previewDoc.numPages;
  const curSec=[...latestSections].reverse().find(s=>previewPage>=s.from);
  $$("#pdf-jump [data-jump]").forEach(b=>b.setAttribute("aria-current",String(curSec&&+b.dataset.jump===curSec.from)));
}
function sharePdf(){
  if(!latestPdf){toast("Generate the PDF first.");return;}
  const file=new File([latestPdf],latestPdfName,{type:"application/pdf"});
  (async()=>{
    try{
      if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]})))await navigator.share({title:"Monthly claim submission",files:[file]});
      else{download(latestPdf,latestPdfName);toast("Sharing isn't available here — the PDF was downloaded instead.");}
    }catch(err){if(err.name!=="AbortError")toast(`Could not share: ${err.message}`);}
  })();
}

/* ---------------- share the app (QR) ---------------- */
function appUrl(){const u=new URL(location.href);u.search="";u.hash="";return u.href.replace(/index\.html$/,"");}
function qrModules(text){
  if(typeof qrcode!=="function")return null;
  try{const q=qrcode(0,"M");q.addData(text);q.make();const n=q.getModuleCount();return Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>q.isDark(r,c)));}catch(e){return null;}
}
function qrSvg(text){
  if(typeof qrcode!=="function")return "<p>QR library not loaded.</p>";
  const q=qrcode(0,"M");q.addData(text);q.make();
  const n=q.getModuleCount(),m=2;let p="";
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))p+=`M${c+m},${r+m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n+2*m} ${n+2*m}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="QR code for the app link"><rect width="100%" height="100%" fill="#fff"/><path d="${p}" fill="#14212B"/></svg>`;
}
function openShareApp(){
  const url=appUrl();$("#qr-app").innerHTML=qrSvg(url);$("#qr-url").textContent=url;
  $$(".sheet").forEach(s=>s.hidden=true);openSheet("#sh-share");
}

/* ---------------- feedback (WhatsApp) ---------------- */
function deviceText(){
  const u=navigator.userAgent;
  const os=/iPhone/.test(u)?"iPhone":/iPad/.test(u)?"iPad":/Android/.test(u)?"Android":/Windows/.test(u)?"Windows":/Mac OS X/.test(u)?"Mac":"other device";
  const br=/EdgA?\//.test(u)?"Edge":/SamsungBrowser/.test(u)?"Samsung Internet":/CriOS|Chrome\//.test(u)?"Chrome":/FxiOS|Firefox\//.test(u)?"Firefox":/Safari\//.test(u)?"Safari":"browser";
  let inst=false;try{inst=matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;}catch(e){}
  return `${os}, ${br}${inst?", home-screen app":""}`;
}
function feedbackUrl(){
  const t=`${APP_NAME} feedback – App v${APP_VERSION} (${APP_BUILD}) – ${deviceText()}\n\nWhat I tried to do:\n\nWhat happened:\n\n(Add a screenshot if you can.)`;
  return `https://wa.me/${String(FEEDBACK_WHATSAPP).replace(/\D/g,"")}?text=${encodeURIComponent(t)}`;
}

/* ---------------- records ---------------- */
function renderRecords(){
  const list=Object.values(store.claims).sort((a,b)=>String(b.details.period).localeCompare(String(a.details.period))||b.created-a.created);
  $("#rec-list").innerHTML=list.map(cl=>{
    const total=itemTotal(cl),ok=cl.items.length>0&&cl.items.every(x=>itemReady(cl,x));
    return `<div class="rgrow" data-rec="${cl.id}">
      <div class="t"><b>${escapeHtml(claimMonthLabel(cl.details.period)||"No month")}</b><span class="amount">${money(total)}</span></div>
      <div class="s">${escapeHtml(cl.details.claimant||"No claimant")} · ${escapeHtml((cl.details.claimTypes||[]).map(k=>TYPE[k]?.l).join(", "))} · ${cl.items.length} item${cl.items.length===1?"":"s"} <span class="tag ${ok?"ok":"need"}">${ok?"Ready":"In progress"}</span>${cl.id===store.currentId?' <span class="tag">Open now</span>':""}</div>
      <div class="btns"><button class="btn sm pri" data-open="${cl.id}" type="button">Open</button><button class="btn sm" data-copyrec="${cl.id}" type="button">Start next month from this</button><button class="btn sm danger" data-delrec="${cl.id}" type="button">Delete</button></div>
    </div>`;
  }).join("");
}
async function deleteClaim(id){
  const cl=store.claims[id];if(!cl)return;
  if(!confirm(`Delete the ${claimMonthLabel(cl.details.period)||""} claim and its documents? This cannot be undone.`))return;
  for(const it of cl.items)await deleteItemFiles(id,it.id);
  delete store.claims[id];
  if(store.currentId===id){store.currentId=Object.keys(store.claims)[0]||null;if(!cur())newClaim();previewDoc=null;}
  save();render();renderRecords();toast("Claim deleted.");
}

/* ---------------- backup / restore ---------------- */
async function blobToB64(blob){const buf=new Uint8Array(await blob.arrayBuffer());let s="";for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode(...buf.subarray(i,i+8192));return btoa(s);}
function b64ToBytes(b64){const s=atob(b64),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u;}
async function exportBackup(){
  busy(true,"Packing backup…");
  try{
    const docs=[];
    for(const cl of Object.values(store.claims))for(const it of cl.items)for(const [kind] of KINDS){
      const f=await getFile(fileKey(cl.id,it.id,kind));if(f)docs.push({claimId:cl.id,itemId:it.id,kind,name:f.name,type:f.type,b64:await blobToB64(f)});
    }
    const payload={version:3,app:APP_NAME,appVersion:APP_VERSION,exported:new Date().toISOString(),currentId:store.currentId,claims:Object.values(store.claims),docs,settings:settings()};
    download(new Blob([JSON.stringify(payload)],{type:"application/json"}),`CLAIMPACK_BACKUP_${localToday()}.json`,"application/json");
    toast(`Backup saved — ${Object.keys(store.claims).length} claim(s), ${docs.length} document(s).`);
  }catch(e){console.error(e);toast(`Backup failed: ${e.message}`);}
  finally{busy(false);}
}
async function importBackup(file){
  try{
    const data=JSON.parse(await file.text());
    let claims=null,docs=null;
    if((data.version===2||data.version===3)&&Array.isArray(data.claims)&&Array.isArray(data.docs)){claims=data.claims;docs=data.docs;}
    else if(data.version===1&&Array.isArray(data.items)&&Array.isArray(data.docs)){
      const id=uid();claims=[{id,details:data.details||{},items:data.items,exported:false,created:Date.now()}];
      docs=data.docs.map(d=>({claimId:id,itemId:d.id,kind:d.kind,name:d.name,type:d.type,data:d.data}));
    }else throw new Error("This file is not a ClaimPack backup.");
    if(!confirm(`Restore ${claims.length} claim(s) and ${docs.length} document(s)? Claims now on this phone will be replaced.`))return;
    busy(true,"Restoring backup…");
    for(const cl of Object.values(store.claims))for(const it of cl.items)await deleteItemFiles(cl.id,it.id);
    store.claims={};store.currentId=null;
    for(const cl of claims)store.claims[cl.id]=upgradeClaim({...cl,items:Array.isArray(cl.items)?cl.items:[]});
    for(const d of docs){const bytes=d.b64?b64ToBytes(d.b64):new Uint8Array(d.data||[]);await putFile(fileKey(d.claimId,d.itemId,d.kind),new File([bytes],d.name,{type:d.type}));}
    if(data.settings)saveSettings(Object.assign(settings(),data.settings));
    store.currentId=claims.find(c=>c.id===data.currentId)?.id||claims[0]?.id||null;
    if(!cur())newClaim();
    save();render();$("#sh-setup").hidden=true;toast("Backup restored.");
  }catch(e){console.error(e);toast(`Could not restore: ${e.message}`);}
  finally{busy(false);}
}

/* ---------------- version check ---------------- */
async function checkVersion(){
  if(location.protocol==="file:")return;
  try{
    const res=await fetch("version.json",{cache:"no-store"});if(!res.ok)return;
    const v=await res.json(),num=x=>String(x).split(".").map(n=>parseInt(n,10)||0).reduce((a,n)=>a*10000+n,0);
    if(v.build&&num(v.build)>num(APP_BUILD)){
      const bar=document.createElement("div");bar.className="updbar";
      bar.innerHTML=`<b>New version ready (v${escapeHtml(v.version||"")}).</b><button class="btn sm pri" type="button">Update now</button>`;
      bar.querySelector("button").addEventListener("click",async()=>{try{const r=await navigator.serviceWorker?.getRegistration();await r?.update();const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));}catch(e){}location.reload();});
      $("#notices").appendChild(bar);
    }
  }catch(e){/* offline */}
}
function showWhatsNew(){
  $("#whats-new").innerHTML=`<div class="rgrow" style="border-style:dashed"><div class="t"><b>What's new</b></div>${WHATS_NEW.map(w=>`<div class="s"><b>v${escapeHtml(w.v)}</b> — ${escapeHtml(w.t)}</div>`).join("")}</div>`;
  $("#whats-new").hidden=false;
}

/* ---------------- events ---------------- */
function bindEvents(){
  bindDetails();bindDrop();
  $("#btn-add").addEventListener("click",()=>addItem());
  $("#btn-camera").addEventListener("click",async()=>{const f=await openScanner({title:"Scan receipt · new item"});if(!f)return;const it=await addItem(f);if(it)toast("Receipt added — key in the details.");});
  const entries=$("#entries");
  entries.addEventListener("input",e=>{if(e.target.dataset.field&&e.target.tagName!=="SELECT"&&e.target.type!=="date")onItemField(e.target,false);});
  entries.addEventListener("change",async e=>{
    const t=e.target;
    if(t.matches("[data-file]"))return handleFileInput(t);
    if(t.matches("[data-confirm]")){const it=findItem(t);if(it){it.confirmed=t.checked;save();renderLight();rerenderItem(it.id);}return;}
    if(t.dataset.field)onItemField(t,true);
  });
  entries.addEventListener("click",async e=>{
    const it=findItem(e.target);if(!it)return;
    const c=cur();
    if(e.target.closest("[data-toggle]")){openItems.has(it.id)?openItems.delete(it.id):openItems.add(it.id);renderItems();return;}
    if(e.target.closest("[data-remove]")){
      if(!confirm("Remove this item and its attached documents?"))return;
      c.items=c.items.filter(x=>x.id!==it.id);await deleteItemFiles(c.id,it.id);save();render();toast("Item removed.");return;
    }
    if(e.target.closest("[data-dup]")){
      const n=Object.assign(blankItem(it.type),{type:it.type,station:it.station,desc:it.desc,rate:it.rate,trip:it.trip,osCol:it.osCol,created:Date.now()});
      c.items.push(n);openItems.add(n.id);save();render();toast("Copied — enter the date, amount and attach the receipt.");return;
    }
    if(e.target.closest("[data-useauto]")){const a=autoAmount(it);if(a!==null){it.amount=a.toFixed(2);it.amountManual=false;save();renderLight();rerenderItem(it.id);}return;}
    if(e.target.closest("[data-fillqty]")){it.qty=(safeNum(it.amount)/safeNum(it.rate)).toFixed(3);save();renderLight();rerenderItem(it.id);return;}
    const cam=e.target.closest("[data-cam]");
    if(cam){const kind=cam.dataset.cam,f=await openScanner({title:`Scan ${KIND[kind].label.toLowerCase()} · ${refMap(c)[it.id]}-${KIND[kind].code}`,name:kind});if(f)await attachAndShow(it,kind,f);return;}
    const crop=e.target.closest("[data-crop]");
    if(crop){const kind=crop.dataset.crop,old=await getFile(fileKey(c.id,it.id,kind));if(!old)return;const f=await openScanner({title:`Crop ${refMap(c)[it.id]}-${KIND[kind].code}`,image:old,name:kind});if(f)await attachAndShow(it,kind,f);return;}
    const view=e.target.closest("[data-view]");if(view){viewDoc(it,view.dataset.view);return;}
    const un=e.target.closest("[data-unattach]");
    if(un){const k=un.dataset.unattach;if(!confirm(`Remove the attached ${KIND[k].label.toLowerCase()}?`))return;await deleteFile(fileKey(c.id,it.id,k)).catch(()=>{});it[nameKey(k)]="";it[typeKey(k)]="";it.confirmed=false;save();renderLight();rerenderItem(it.id);return;}
    const ocr=e.target.closest("[data-ocr]");if(ocr)scanDoc(it.id,ocr.dataset.ocr);
  });
  $("#btn-expand").addEventListener("click",()=>{const c=cur(),all=c.items.every(x=>openItems.has(x.id));c.items.forEach(x=>all?openItems.delete(x.id):openItems.add(x.id));renderItems();});
  $("#btn-clear-items").addEventListener("click",async()=>{
    const c=cur();if(!c.items.length)return;
    if(!confirm(`Remove all ${c.items.length} items and their documents from this claim?`))return;
    for(const it of c.items)await deleteItemFiles(c.id,it.id);
    c.items=[];save();render();toast("Items cleared.");
  });
  $("#btn-summary-copy").addEventListener("click",()=>{
    const c=cur(),d=c.details,refs=refMap(c);
    const lines=[`Monthly claim · ${claimMonthLabel(d.period)}`,`${d.claimant||"—"}${d.designation?`, ${d.designation}`:""}`,d.project||"",""];
    sortedItems(c).forEach(it=>lines.push(`${refs[it.id]}. ${dmy(it.date)||"—"} · ${typeOf(it).l} · ${it.station||"—"} · ${money(it.amount)}`));
    lines.push("",`Total: ${money(itemTotal(c))}`);
    (navigator.clipboard?navigator.clipboard.writeText(lines.join("\n")):Promise.reject()).then(()=>toast("Summary copied — paste it with the PDF."),()=>toast("Could not copy."));
  });
  $("#packlist").addEventListener("change",e=>{const k=e.target.dataset.pack;if(!k)return;cur().opts[k]=e.target.checked;save();renderExport();});
  $("#btn-sumopts").addEventListener("click",()=>{renderSumOpts();openSheet("#sh-sumopts");});
  $("#sumopts-body").addEventListener("change",e=>{const k=e.target.dataset.sum;if(k){cur().opts.sum[k]=e.target.checked;save();}});
  $("#sumopts-body").addEventListener("input",e=>{const k=e.target.dataset.sumv;if(k){cur().opts.sum[k]=e.target.value;save();}});
  $("#btn-attopts").addEventListener("click",()=>{renderAttOpts();openSheet("#sh-attopts");});
  $("#attopts-body").addEventListener("click",e=>{const b=e.target.closest("[data-v]"),g=e.target.closest("[data-attseg]");if(!b||!g)return;const k=g.dataset.attseg;cur().opts.att[k]=b.dataset.v;save();renderAttOpts();});
  $("#attopts-body").addEventListener("change",e=>{if(e.target.id==="opt-coverqr"){cur().opts.coverQr=e.target.checked;save();}});
  $("#btn-export").addEventListener("click",async()=>{if(await generatePdf())openPdfSheet();});
  $("#dock-go").addEventListener("click",async()=>{if(await generatePdf())openPdfSheet();});
  $("#btn-preview").addEventListener("click",async()=>{if(!latestPdf&&!(await generatePdf()))return;openPdfSheet();});
  $("#btn-csv").addEventListener("click",exportCsv);
  $("#btn-a27").addEventListener("click",()=>{renderAdmin27();openSheet("#sh-a27");});
  $("#a27-done").addEventListener("click",()=>{$("#sh-a27").hidden=true;renderLight();});
  $("#a27-preview").addEventListener("click",()=>{previewA27();setTimeout(()=>$("#a27-prev").scrollIntoView({behavior:"smooth"}),150);});
  bindAdmin27();
  $("#btn-batch").addEventListener("click",()=>$("#f-batch").click());
  $("#f-batch").addEventListener("change",async e=>{const files=[...(e.target.files||[])];e.target.value="";if(files.length)await batchImport(files);});
  $("#s-test").addEventListener("click",testAiKey);
  $("#s-save-ai").addEventListener("click",saveAiSettings);
  $("#s-checker").addEventListener("input",e=>{const s=settings();s.checker=e.target.value;saveSettings(s);invalidatePdf();$("#s-checker-show").textContent=checkerName();});
  $("#seg-theme").addEventListener("click",e=>{const b=e.target.closest("[data-theme-opt]");if(b)setTheme(b.dataset.themeOpt);});
  $("#flow").addEventListener("click",e=>{
    const btn=e.target.closest("button");if(!btn)return;
    const idx=[...$("#flow").children].indexOf(btn);
    if(idx===0)setDetailsOpen(true);
    if(idx===1||idx===2){const c=cur(),first=sortedItems(c).find(x=>idx===1?!x.receiptName:!itemReady(c,x));if(first){openItems.add(first.id);renderItems();document.querySelector(`.item[data-id="${first.id}"]`)?.scrollIntoView({behavior:"smooth",block:"center"});return;}}
    document.querySelector(["#sec-details","#h-items","#sec-sum","#sec-export"][idx])?.scrollIntoView({behavior:"smooth",block:"start"});
  });
  $("#btn-share").addEventListener("click",sharePdf);
  $("#pdf-share").addEventListener("click",sharePdf);
  $("#pdf-save").addEventListener("click",()=>{if(latestPdf)download(latestPdf,latestPdfName);});
  $("#pdf-open").addEventListener("click",()=>{if(!latestPdf)return;const url=URL.createObjectURL(latestPdf),w=window.open(url,"_blank");if(!w)toast("The browser blocked the tab — use Share or Save.");setTimeout(()=>URL.revokeObjectURL(url),60000);});
  $("#pdf-prev").addEventListener("click",async()=>{if(previewPage>1){previewPage--;await renderPreviewPage().catch(e=>toast(e.message));}});
  $("#pdf-next").addEventListener("click",async()=>{if(previewDoc&&previewPage<previewDoc.numPages){previewPage++;await renderPreviewPage().catch(e=>toast(e.message));}});
  $("#pdf-jump").addEventListener("click",async e=>{const b=e.target.closest("[data-jump]");if(b&&previewDoc){previewPage=+b.dataset.jump;await renderPreviewPage();}});
  $("#sug-apply").addEventListener("click",applySuggestions);
  $("#sug-cancel").addEventListener("click",()=>{$("#sh-sug").hidden=true;});
  $("#btn-help").addEventListener("click",()=>{showWhatsNew();openSheet("#sh-help");});
  ["#btn-shareapp","#btn-shareapp2","#s-shareapp"].forEach(id=>$(id).addEventListener("click",openShareApp));
  $("#qr-copy").addEventListener("click",()=>{(navigator.clipboard?navigator.clipboard.writeText(appUrl()):Promise.reject()).then(()=>toast("Link copied."),()=>toast("Could not copy."));});
  $("#qr-share").addEventListener("click",async()=>{try{if(navigator.share)await navigator.share({title:"ClaimPack · monthly claims",text:"Prepare your monthly claim on your phone:",url:appUrl()});else{await navigator.clipboard.writeText(appUrl());toast("Link copied.");}}catch(e){if(e.name!=="AbortError")toast("Could not share.");}});
  $("#btn-records").addEventListener("click",()=>{renderRecords();openSheet("#sh-rec");});
  $("#btn-records-plate").addEventListener("click",()=>{renderRecords();openSheet("#sh-rec");});
  $("#btn-setup").addEventListener("click",()=>{renderAiSettings();$("#s-checker").value=settings().checker||"";$("#s-checker").placeholder=DEFAULT_CHECKER||"Name of the person who checks claims";$("#s-checker-show").textContent=checkerName();openSheet("#sh-setup");});
  $$("[data-close]").forEach(b=>b.addEventListener("click",()=>{closeSheet(b);if(b.closest("#sh-sumopts,#sh-attopts,#sh-a27"))renderLight();}));
  $$(".sheet").forEach(sh=>sh.addEventListener("click",e=>{if(e.target===sh){sh.hidden=true;renderLight();}}));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){const open=$$(".sheet").filter(s=>!s.hidden).pop();if(open)open.hidden=true;}});
  $("#rec-new").addEventListener("click",()=>{newClaim(cur());openItems.clear();save();render();$("#sh-rec").hidden=true;toast(`${claimMonthLabel(cur().details.period)} claim started — your details were copied.`);});
  $("#rec-blank").addEventListener("click",()=>{newClaim();openItems.clear();save();render();setDetailsOpen(true);$("#sh-rec").hidden=true;toast("Blank claim started.");});
  $("#rec-list").addEventListener("click",e=>{
    const open=e.target.closest("[data-open]"),del=e.target.closest("[data-delrec]"),cp=e.target.closest("[data-copyrec]");
    if(open){store.currentId=open.dataset.open;openItems.clear();previewDoc=null;latestPdf=null;save();render();$("#sh-rec").hidden=true;toast("Claim opened.");}
    if(cp){newClaim(store.claims[cp.dataset.copyrec]);openItems.clear();save();render();$("#sh-rec").hidden=true;toast(`${claimMonthLabel(cur().details.period)} claim started.`);}
    if(del)deleteClaim(del.dataset.delrec);
  });
  $("#s-export").addEventListener("click",exportBackup);
  $("#s-restore").addEventListener("click",()=>$("#f-restore").click());
  $("#f-restore").addEventListener("change",async e=>{const f=e.target.files?.[0];e.target.value="";if(f)await importBackup(f);});
  $("#s-reset").addEventListener("click",async()=>{
    if(!confirm("Delete EVERY claim and document on this phone? This cannot be undone."))return;
    for(const cl of Object.values(store.claims))for(const it of cl.items)await deleteItemFiles(cl.id,it.id);
    localStorage.removeItem(META_KEY);store.claims={};store.currentId=null;newClaim();openItems.clear();previewDoc=null;save();render();$("#sh-setup").hidden=true;toast("All data deleted.");
  });
}
async function openPdfSheet(){openSheet("#sh-pdf");await renderPreview();}

/* ---------------- init ---------------- */
async function init(){
  // help pages: GitHub Pages serves GUIDE.html; opened from a folder (file://) only GUIDE.md exists
  if(location.protocol==="file:")$$("a[data-doc]").forEach(a=>a.href=a.getAttribute("href").replace(/\.html$/,".md"));
  try{
    applyTheme();await openDb();load();bindEvents();render();
    const c=cur();if(c.items.length&&flowState().detailsOk)setDetailsOpen(false);
  }catch(err){console.error(err);toast(`ClaimPack could not start: ${err.message}`);}
  checkVersion();
  if("serviceWorker" in navigator&&location.protocol!=="file:")navigator.serviceWorker.register("./sw.js").catch(e=>console.error("Service worker registration failed:",e));
}
init();

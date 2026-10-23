"use client";
import Link from "next/link";
import { useEffect, useState, type ChangeEvent } from "react";
import { Plus, Trash2, UploadCloud, CheckCircle2, AlertCircle, Flag, MapPinned, ClipboardCheck } from "lucide-react";
import styles from "./uploader.module.css";

type Track = { id:string; name:string };
type Slot = { id:string; driver:string; number:string; className:string; passCode:string; sessionType:string; fileName:string; status:"waiting"|"uploading"|"queued"|"error"; message:string; sessionId?:string };
type Draft = { trackId:string; eventDate:string; slots:Slot[] };
const makeSlot = (index:number):Slot => ({id:crypto.randomUUID(),driver:"",number:"",className:"",passCode:"",sessionType:"practice",fileName:"",status:"waiting",message:""});
const KEY = "rivali-operator-raceday-v1";
export function UploaderClient({tracks}:{tracks:Track[]}) {
  const [draft,setDraft] = useState<Draft>({trackId:"",eventDate:"",slots:[]});
  const [hydrated,setHydrated] = useState(false);
  const [files,setFiles] = useState<Record<string,File>>({});
  useEffect(()=>{
    try {
      const raw=window.localStorage.getItem(KEY);
      if(raw) { const stored=JSON.parse(raw) as Draft; setDraft({trackId:stored.trackId??"",eventDate:stored.eventDate??"",slots:Array.isArray(stored.slots)?stored.slots.slice(0,5):[]}); }
      else setDraft({trackId:"",eventDate:new Date().toLocaleDateString("en-CA"),slots:[makeSlot(0)]});
    } catch {setDraft({trackId:"",eventDate:"",slots:[makeSlot(0)]});}
    setHydrated(true);
  },[]);
  useEffect(()=>{if(hydrated)window.localStorage.setItem(KEY,JSON.stringify({...draft,slots:draft.slots.map(s=>({...s,passCode:"",status:s.status==="uploading"?"waiting":s.status}))}));},[draft,hydrated]);
  function change(id:string,patch:Partial<Slot>) {setDraft(d=>({...d,slots:d.slots.map(s=>s.id===id?{...s,...patch}:s)}));}
  function add() {setDraft(d=>d.slots.length>=5?d:{...d,slots:[...d.slots,makeSlot(d.slots.length)]});}
  function remove(id:string) {setDraft(d=>({...d,slots:d.slots.filter(s=>s.id!==id)}));setFiles(f=>{const next={...f};delete next[id];return next;});}
  function onFile(id:string,event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".xrk") || file.size===0 || file.size>100*1024*1024) {change(id,{status:"error",message:"Choose a .xrk file between 1 byte and 100 MB."});return;}
    setFiles(f=>({...f,[id]:file}));change(id,{fileName:file.name,status:"waiting",message:"File selected. Ready to upload."});
  }
  async function upload(slot:Slot) {
    const file=files[slot.id];
    if(!file)return change(slot.id,{status:"error",message:"Select an XRK file first. Files must be reselected after reopening this page."});
    if(slot.passCode.replace(/[^A-Z0-9]/gi,"").length<6)return change(slot.id,{status:"error",message:"Enter this driver's active RaceDay pass code."});
    change(slot.id,{status:"uploading",message:"Uploading to Rivali..."});
    try {
      const form=new FormData();form.append("file",file);form.append("sessionType",slot.sessionType);
      const result=await fetch("/api/race-day/bridge-upload",{method:"POST",headers:{"x-rivali-pass-code":slot.passCode},body:form});
      const data=await result.json();
      if(!result.ok)throw new Error(data.error??"Upload was rejected.");
      change(slot.id,{status:"queued",sessionId:data.sessionId,message:"XRK received. Analysis queued."});
    }catch(e){change(slot.id,{status:"error",message:e instanceof Error?e.message:"Upload failed."});}
  }
  return <main className={styles.page}>
    <header className={styles.bar}><div className={styles.brand}><span className={styles.mark}>▦</span><span>Rivali <b>Uploader</b></span></div><nav><Link href="/race-day/uploader">Race Day</Link><Link href="/race-day/admin">Race Day Admin</Link><Link href="/reports">Reports</Link></nav><span className={styles.tag}>OPERATOR · 5 KART MAX</span></header>
    <div className={styles.content}>
      <div className={styles.heading}><div><h1>Race Day</h1><p>Set up drivers, upload MyChron data, analyze and deliver reports.</p></div><Link className={styles.trackLink} href="/dashboard"><MapPinned size={17}/> Track Editor / Race Shop</Link></div>
      <section className={styles.setup}>
        <label>Track<select value={draft.trackId} onChange={e=>setDraft(d=>({...d,trackId:e.target.value}))}><option value="">Select track</option>{tracks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Race date<input type="date" value={draft.eventDate} onChange={e=>setDraft(d=>({...d,eventDate:e.target.value}))}/></label>
        <div className={styles.setupNote}><Flag size={16}/> Pre-race entries save in this browser. Actual telemetry is filed under each driver's active RaceDay pass.</div>
      </section>
      <div className={styles.sectionHeader}><div><h2>Your Karts</h2><span>{draft.slots.length} of 5 configured</span></div><button disabled={draft.slots.length>=5} onClick={add}><Plus size={18}/> Add Kart</button></div>
      <div className={styles.grid}>{draft.slots.map((slot,i)=><article className={styles.card} key={slot.id}>
        <div className={styles.cardTop}><div className={styles.cardName}><span className={styles.number}>{i+1}</span><b>Kart {i+1}</b></div><span className={slot.status==="queued"?styles.success:slot.status==="error"?styles.error:styles.wait}>{slot.status==="uploading"?"Uploading":slot.status==="queued"?"Queued":slot.status==="error"?"Needs attention":"Waiting"}</span><button className={styles.remove} title="Remove kart" onClick={()=>remove(slot.id)}><Trash2 size={17}/></button></div>
        <div className={styles.fields}><label>Driver<input value={slot.driver} onChange={e=>change(slot.id,{driver:e.target.value})} placeholder="Driver name"/></label><label>Kart #<input value={slot.number} onChange={e=>change(slot.id,{number:e.target.value})} placeholder="145"/></label><label>Class<input value={slot.className} onChange={e=>change(slot.id,{className:e.target.value})} placeholder="Animal Medium"/></label></div>
        <div className={styles.fieldsTwo}><label>RaceDay pass code<input value={slot.passCode} onChange={e=>change(slot.id,{passCode:e.target.value.toUpperCase()})} placeholder="Active driver pass" autoCapitalize="characters"/></label><label>Run type<select value={slot.sessionType} onChange={e=>change(slot.id,{sessionType:e.target.value})}>{["practice","hot laps","heat","feature"].map(t=><option key={t} value={t}>{t}</option>)}</select></label></div>
        <label className={styles.drop}><UploadCloud size={26}/><strong>{slot.fileName || "Choose XRK file"}</strong><span>{slot.fileName?"Click to replace":"MyChron / Race Studio .xrk · max 100 MB"}</span><input type="file" accept=".xrk" onChange={e=>onFile(slot.id,e)}/></label>
        <button className={styles.upload} disabled={slot.status==="uploading"} onClick={()=>void upload(slot)}><UploadCloud size={18}/>{slot.status==="uploading"?"Uploading...":"Upload & Analyze"}</button>
        <div className={styles.status}><span>{slot.status==="queued"?<CheckCircle2 size={16}/>:slot.status==="error"?<AlertCircle size={16}/>:<ClipboardCheck size={16}/>}</span><p>{slot.message || "Waiting for telemetry. Enter an active pass code and select an XRK file."}</p></div>
        {slot.sessionId&&<small className={styles.session}>Session: {slot.sessionId}</small>}
      </article>)}</div>
      <footer className={styles.footer}><span>Rivali RaceDay · 1–5 independent kart workflows</span><span>Track mapping must be analysis-ready before XRK processing.</span></footer>
    </div>
  </main>;
}

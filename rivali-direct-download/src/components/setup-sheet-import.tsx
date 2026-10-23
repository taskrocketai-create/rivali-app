"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RaceSession } from "@/types/domain";

type Entry = {key:string; value:string; source_text:string; confidence:string; accepted:boolean};
const labels: Record<string,string> = {
  lf_pressure_psi:"LF pressure (PSI)",rf_pressure_psi:"RF pressure (PSI)",
  lr_pressure_psi:"LR pressure (PSI)",rr_pressure_psi:"RR pressure (PSI)",
  rear_stagger_in:"Rear stagger (in)",front_stagger_in:"Front stagger (in)",
  crossweight_pct:"Recorded crossweight (%)",left_weight_pct:"Left weight (%)",
  rear_weight_pct:"Rear weight (%)",rear_sprocket:"Rear sprocket",
  camber_lf_deg:"LF camber (deg)",camber_rf_deg:"RF camber (deg)",
  caster_lf_deg:"LF caster (deg)",caster_rf_deg:"RF caster (deg)",
  toe_in_in:"Toe (in)",ballast_notes:"Ballast notes",
  spindle_washer_notes:"Spindle washer notes",setup_notes:"Setup notes",
  class_name:"Class",kart_number:"Kart number on sheet",track_name:"Track on sheet",
  driver_name:"Driver on sheet",
};
const textFields = new Set(["ballast_notes","spindle_washer_notes","setup_notes","class_name"]);
const identityFields = new Set(["kart_number","track_name","driver_name"]);
const numeric = (key:string) => !textFields.has(key) && !identityFields.has(key);
export function SetupSheetImport({ sessions, onSaved }: {
  sessions: RaceSession[];
  onSaved: (id:string,setup:Record<string,unknown>)=>void;
}) {
  const [id,setId] = useState("");
  const [file,setFile] = useState<File|null>(null);
  const [entries,setEntries] = useState<Entry[]>([]);
  const [warnings,setWarnings] = useState<string[]>([]);
  const [working,setWorking] = useState(false);
  const [message,setMessage] = useState("");
  const db = createClient();
  async function scan() {
    if (!id || !file) return;
    setWorking(true);setMessage("");setEntries([]);setWarnings([]);
    try {
      const form = new FormData();form.set("sessionId",id);form.set("file",file);
      const response = await fetch("/api/setup-sheet",{method:"POST",body:form});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not read setup sheet.");
      setEntries((data.entries||[]).map((x:Entry)=>({...x,accepted:x.confidence!=="low"})));
      setWarnings(data.warnings||[]);
      if (!data.entries?.length) setMessage("No unambiguous setup fields found. Try a clearer picture.");
    } catch(e){setMessage(e instanceof Error?e.message:"Image import failed.");}
    finally {setWorking(false);}
  }
  async function save() {
    if (!id || !file || !entries.some(x=>x.accepted)) return;
    setWorking(true);setMessage("");
    let path="";
    try {
      const {data:auth,error:authError}=await db.auth.getUser();
      if (authError||!auth.user) throw new Error("Sign in again.");
      const {data:session,error:fetchError}=await db.from("sessions").select("id,setup").eq("id",id).eq("user_id",auth.user.id).single();
      if (fetchError||!session) throw new Error("Session not found.");
      const original = (session.setup||{}) as Record<string,unknown>;
      const accepted=entries.filter(x=>x.accepted&&x.value.trim());
      const additions:Record<string,unknown>={};
      for(const item of accepted){
        if(identityFields.has(item.key)) continue;
        if(numeric(item.key)) {
          const value=Number(item.value);
          if(!Number.isFinite(value)) throw new Error(`Check numeric value for ${labels[item.key]||item.key}.`);
          additions[item.key]=value;
        } else additions[item.key]=item.value.trim();
      }
      const uuid=crypto.randomUUID();
      const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      path=`${auth.user.id}/${id}/setup-sheets/${uuid}-${safe}`;
      const {error:uploadError}=await db.storage.from("telemetry").upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError) throw uploadError;
      const history=Array.isArray(original.setup_sheet_imports)?original.setup_sheet_imports:[];
      const setup={
        ...original,...additions,
        setup_sheet_imports:[...history,{id:uuid,storage_path:path,file_name:file.name,imported_at:new Date().toISOString(),
          entries:accepted.map(({key,value,source_text,confidence})=>({key,value,source_text,confidence})),
          warnings,source:"setup_sheet_image",crossweight_verification:"sheet_record_only"}]
      };
      const {error:saveError}=await db.from("sessions").update({setup}).eq("id",id).eq("user_id",auth.user.id);
      if(saveError) throw saveError;
      onSaved(id,setup);
      setMessage("Setup sheet approved and saved with the original image.");
      setEntries([]);setFile(null);
    } catch(e){
      if(path) await db.storage.from("telemetry").remove([path]);
      setMessage(e instanceof Error?e.message:"Could not save setup.");
    } finally {setWorking(false);}
  }
  return <section className="card stack">
    <div><div className="eyebrow">SETUP RECORD</div><h2>Import a setup sheet photo</h2>
      <p className="muted">Upload a handwritten or printed sheet, review every extracted value, then approve. Nothing is saved automatically.</p></div>
    <div className="field"><label>Assign to existing session</label>
      <select value={id} onChange={e=>{setId(e.target.value);setEntries([]);}}>
        <option value="">Select driver, kart and session</option>
        {sessions.map(s=><option key={s.id} value={s.id}>{s.session_date} · {s.racers?.name||"Driver"} · {s.karts?.name||"Kart"} · {s.tracks?.name||"Track"} · {s.session_type}</option>)}
      </select>
    </div>
    <div className="field"><label>Photo (JPG, PNG or WEBP, up to 6 MB)</label>
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{setFile(e.target.files?.[0]||null);setEntries([]);}} />
    </div>
    <button className="button secondary" type="button" disabled={!file||!id||working} onClick={()=>void scan()}>{working?"Working...":"Read setup sheet"}</button>
    {warnings.length>0&&<div className="notice"><strong>Needs review</strong><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
    {entries.length>0&&<>
      <p className="muted">Check each value against the original photo. Low-confidence entries are unchecked. Sheet identity details are retained for reference but never silently replace the linked kart or driver.</p>
      <div className="stack">{entries.map((entry,i)=><div key={i} className="field">
        <label><input type="checkbox" checked={entry.accepted} onChange={e=>setEntries(prev=>prev.map((x,j)=>j===i?{...x,accepted:e.target.checked}:x))} />
          {" "}{labels[entry.key]||entry.key} · {entry.confidence} confidence</label>
        <input value={entry.value} onChange={e=>setEntries(prev=>prev.map((x,j)=>j===i?{...x,value:e.target.value}:x))} />
        <small className="muted">Read from image: {entry.source_text}</small>
      </div>)}</div>
      <button type="button" className="button" disabled={working||!entries.some(x=>x.accepted)} onClick={()=>void save()}>
        {working?"Saving...":"Approve and save setup"}
      </button>
    </>}
    {message&&<p role="status" className="muted">{message}</p>}
  </section>;
}

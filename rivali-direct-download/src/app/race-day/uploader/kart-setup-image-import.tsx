"use client";
import {useState} from "react";
import {createClient} from "@/lib/supabase/client";

type Entry={key:string;value:string;source_text:string;confidence:"high"|"medium"|"low";accepted:boolean};
const mapping:Record<string,string>={
  lf_pressure_psi:"lf",rf_pressure_psi:"rf",lr_pressure_psi:"lr",rr_pressure_psi:"rr",
  rear_stagger_in:"stagger",front_stagger_in:"frontStagger",
  crossweight_pct:"cross",left_weight_pct:"leftPct",rear_weight_pct:"rearPct",
  rear_sprocket:"rearSprocket",camber_lf_deg:"frontCamberLF",camber_rf_deg:"frontCamberRF",
  caster_lf_deg:"casterLF",caster_rf_deg:"casterRF",toe_in_in:"frontToe",
  lf_tire_circumference_in:"lfCirc",rf_tire_circumference_in:"rfCirc",
  lr_tire_circumference_in:"lrCirc",rr_tire_circumference_in:"rrCirc",
  ballast_notes:"ballastNotes",spindle_washer_notes:"washerNotes",setup_notes:"notes",class_name:"class"
};
export function KartSetupImageImport({onApply}:{onApply:(values:Record<string,string>)=>void}){
  const [file,setFile]=useState<File|null>(null);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [warnings,setWarnings]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  async function read(){
    if(!file)return;
    setBusy(true);setMessage("");setEntries([]);setWarnings([]);
    try{
      const form=new FormData();form.set("file",file);
      const response=await fetch("/api/setup-sheet",{method:"POST",body:form});
      const payload=await response.json();
      if(!response.ok)throw new Error(payload.error||"Could not read photo.");
      setEntries((payload.entries||[]).map((x:Entry)=>({...x,accepted:x.confidence!=="low"&&Boolean(mapping[x.key])})));
      setWarnings(payload.warnings||[]);
      if(!payload.entries?.length)setMessage("No clear setup measurements found. Try a sharper photo.");
    }catch(e){setMessage(e instanceof Error?e.message:"Could not import image.");}
    finally{setBusy(false);}
  }
  async function apply(){
    if(!file)return;
    const accepted=entries.filter(e=>e.accepted&&mapping[e.key]&&e.value.trim());
    if(!accepted.length)return;
    setBusy(true);setMessage("");
    try{
      const values:Record<string,string>={};
      for(const entry of accepted){
        if(!["ballast_notes","spindle_washer_notes","setup_notes","class_name"].includes(entry.key)&&!Number.isFinite(Number(entry.value))){
          throw new Error(`Enter a valid number for ${entry.key} or uncheck it.`);
        }
        values[mapping[entry.key]]=entry.value.trim();
      }
      const supabase=createClient();
      const {data,error}=await supabase.auth.getUser();
      if(error||!data.user)throw new Error("Sign in again.");
      const safe=file.name.replace(/[^a-z0-9._-]/gi,"_");
      const path=`${data.user.id}/setup-sheets/${crypto.randomUUID()}-${safe}`;
      const {error:uploadError}=await supabase.storage.from("telemetry").upload(path,file,{contentType:file.type,upsert:false});
      if(uploadError)throw new Error("The original image could not be retained: "+uploadError.message);
      values.setupSheetSource=path;
      values.setupSheetImportedAt=new Date().toISOString();
      values.setupSheetWarnings=warnings.join("; ");
      values.crossVerification=values.cross?"Recorded on sheet; not reweighed after on-track changes":"Not measured";
      onApply(values);
      setEntries([]);
      setFile(null);
      setMessage("Imported into the setup draft. Review the fields, then save a setup version.");
    }catch(e){setMessage(e instanceof Error?e.message:"Could not apply setup.");}
    finally{setBusy(false);}
  }
  return <div className="card stack" style={{marginBottom:16}}>
    <h3>Read a setup sheet photo</h3>
    <p className="muted">Read handwritten or printed sheets. Check every extracted value before it enters the kart setup.</p>
    <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e=>{setFile(e.target.files?.[0]||null);setEntries([]);}}/>
    <button type="button" className="button secondary" disabled={!file||busy} onClick={()=>void read()}>{busy?"Working...":"Read sheet"}</button>
    {warnings.length>0&&<div className="notice"><strong>Unreadable or uncertain:</strong><ul>{warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
    {entries.length>0&&<div className="stack">
      <p>Review each reading. Unchecked entries will not change your setup.</p>
      {entries.map((entry,i)=><label key={i} className="field">
        <span><input type="checkbox" checked={entry.accepted} disabled={!mapping[entry.key]} onChange={e=>setEntries(v=>v.map((x,j)=>j===i?{...x,accepted:e.target.checked}:x))}/>
          {" "}{entry.key.replaceAll("_"," ")} · {entry.confidence}</span>
        <input value={entry.value} onChange={e=>setEntries(v=>v.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/>
        <small className="muted">Sheet says: {entry.source_text}{!mapping[entry.key]?" · Reference only":""}</small>
      </label>)}
      <button type="button" className="button" disabled={busy||!entries.some(e=>e.accepted)} onClick={()=>void apply()}>Approve values for this kart</button>
    </div>}
    {message&&<p role="status">{message}</p>}
  </div>;
}

"use client";
import {useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {isNumericSetupField,normalizeSetupNumber} from "@/lib/setup-measurements";

const sections: {title:string;fields:[string,string][]}[]=[
 {title:"Kart and engine",fields:[["class_name","Class"],["chassis_make","Chassis make"],["chassis_model","Chassis model"],["engine_make","Engine make"],["engine_model","Engine model"]]},
 {title:"Tires and stagger",fields:[["tire_brand","Tire brand"],["tire_compound","Compound"],["lf_pressure_psi","LF pressure PSI"],["rf_pressure_psi","RF pressure PSI"],["lr_pressure_psi","LR pressure PSI"],["rr_pressure_psi","RR pressure PSI"],["front_stagger_in","Front stagger inches"],["rear_stagger_in","Rear stagger inches"],["lf_tire_circumference_in","LF circumference inches"],["rf_tire_circumference_in","RF circumference inches"],["lr_tire_circumference_in","LR circumference inches"],["rr_tire_circumference_in","RR circumference inches"]]},
 {title:"Weight and seat",fields:[["crossweight_pct","Crossweight %"],["left_weight_pct","Left side %"],["rear_weight_pct","Rear weight %"],["scale_measurement_source","Scale source: shop, track, estimate, unknown"],["seat_position","Seat position"],["ballast_notes","Ballast notes"]]},
 {title:"Chassis and drivetrain",fields:[["front_track_width_in","Front track inches"],["rear_track_width_in","Rear track inches"],["lf_camber_deg","LF camber degrees"],["rf_camber_deg","RF camber degrees"],["lf_caster_deg","LF caster degrees"],["rf_caster_deg","RF caster degrees"],["toe_in_in","Toe inches"],["spindle_washer_notes","Spindle washers"],["driver_sprocket","Driver sprocket"],["rear_sprocket","Rear sprocket"],["gear_ratio","Gear ratio"],["clutch_notes","Clutch"]]},
 {title:"Track and driver notes",fields:[["track_conditions","Track conditions"],["handling_feedback","Driver feedback"],["setup_notes","Other setup notes"]]}
];
export function SetupReviewEditor({id,setup,status,onSaved}:{id:string;setup:Record<string,unknown>;status:string;onSaved:()=>Promise<void>}){
 const db=useMemo(()=>createClient(),[]);
 const [draft,setDraft]=useState<Record<string,string>>(()=>Object.fromEntries(Object.entries(setup).filter(([,v])=>typeof v==="string"||typeof v==="number").map(([k,v])=>[k,String(v)])));
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const empty=sections.flatMap(s=>s.fields).filter(([key])=>!draft[key]?.trim()).length;
 async function save(approve:boolean){
  setBusy(true);setMessage("");
  try{
   const merged:Record<string,unknown>={...setup};
   for(const [key,value] of Object.entries(draft)){
    if(!value.trim()){delete merged[key];continue;}
    if(isNumericSetupField(key)){
      const number=normalizeSetupNumber(value);
      if(number===null)throw new Error("Invalid measurement: "+key.replaceAll("_"," "));
      merged[key]=number;
    }else merged[key]=value.trim();
   }
   merged.operator_reviewed_at=new Date().toISOString();
   const changes:Record<string,unknown>={setup:merged};
   if(approve)changes.status="approved";
   const {error}=await db.from("kart_setup_baselines").update(changes).eq("id",id);
   if(error)throw error;
   setMessage(approve?"Approved baseline saved.":"Edits saved. Still awaiting approval.");
   await onSaved();
  }catch(e){setMessage(e instanceof Error?e.message:"Unable to save changes.");}
  finally{setBusy(false);}
 }
 return <div style={{marginTop:12}}>
  <p style={{color:"#e9eeb0"}}>{empty} optional fields remain blank. They will stay available for your entries. Unknown measurements are never guessed.</p>
  {sections.map(section=><details key={section.title} style={{border:"1px solid #435044",borderRadius:8,margin:"9px 0",padding:11}}>
   <summary style={{cursor:"pointer",fontWeight:800}}>{section.title} · {section.fields.filter(([key])=>!draft[key]?.trim()).length} missing</summary>
   <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:12,marginTop:14}}>
    {section.fields.map(([key,label])=><label key={key} style={{display:"grid",gap:5,fontSize:12,color:"#d1dccc"}}>
     {label}<input style={{background:"#080f0c",border:"1px solid #56675c",borderRadius:7,padding:10,color:"white",fontSize:16}}
       value={draft[key]??""} placeholder="Not provided" onChange={e=>setDraft(s=>({...s,[key]:e.target.value}))}/></label>)}
   </div>
  </details>)}
  <div style={{display:"flex",gap:9,flexWrap:"wrap",marginTop:12}}>
   <button type="button" disabled={busy} onClick={()=>void save(false)} style={{padding:"10px 14px",borderRadius:8,background:"#313e32",color:"white",border:"1px solid #697c66"}}>Save missing / corrected fields</button>
   {status==="pending_review"&&<button type="button" disabled={busy} onClick={()=>void save(true)} style={{padding:"10px 14px",borderRadius:8,background:"#e9f441",color:"#151b0f",fontWeight:800,border:0}}>Save and approve</button>}
  </div>
  {message&&<p role="status">{message}</p>}
 </div>;
}

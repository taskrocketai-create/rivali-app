"use client";
import {useEffect,useState} from "react";
import styles from "./uploader.module.css";
import {KartDiagram} from "./kart-diagram";
import {KartSetupImageImport} from "./kart-setup-image-import";
import {createClient} from "@/lib/supabase/client";
type Setup=Record<string,string>;
type Version={id:string;at:string;session:string;setup:Setup};
const canonicalToForm:Record<string,string>={lf_pressure_psi:"lf",rf_pressure_psi:"rf",lr_pressure_psi:"lr",rr_pressure_psi:"rr",rear_stagger_in:"stagger",crossweight_pct:"cross",rear_sprocket:"rearSprocket",driver_sprocket:"driverSprocket",chassis_make:"chassis",engine_make:"engine",tire_brand:"tireBrand",tire_compound:"compound",gear_ratio:"gear",seat_position:"seat",handling_feedback:"feedback",setup_notes:"notes",track_conditions:"surface"};
const numericOrNull=(value:string|undefined)=>value?.trim()&&Number.isFinite(Number(value))?Number(value):null;
const defs:{title:string;fields:[string,string,string][]}[]=[
 {title:"Driver & Kart",fields:[["driver","Driver","text"],["kart","Kart #","text"],["class","Class","text"],["chassis","Chassis","text"],["engine","Engine","text"],["clutch","Clutch","text"],["mychron","MyChron","text"]]},
 {title:"Tires & Pressures",fields:[["lf","LF pressure PSI","number"],["rf","RF pressure PSI","number"],["lr","LR pressure PSI","number"],["rr","RR pressure PSI","number"],["tireBrand","Tire brand","text"],["compound","Compound","text"],["stagger","Rear stagger (in)","number"]]},
 {title:"Chassis & Geometry",fields:[["frontCamber","Front camber","text"],["rearCamber","Rear camber","text"],["caster","Caster","text"],["frontToe","Front toe","text"],["rideF","Front ride height","text"],["rideR","Rear ride height","text"],["widthF","Front track width","text"],["widthR","Rear track width","text"],["seat","Seat position","text"],["cross","Measured crossweight %","number"]]},
 {title:"Drivetrain",fields:[["gear","Gear ratio","text"],["driverSprocket","Driver sprocket","text"],["rearSprocket","Rear sprocket","text"],["chain","Chain condition","text"]]},
 {title:"Track & Notes",fields:[["surface","Surface","text"],["moisture","Moisture","text"],["grip","Grip level","text"],["feedback","Driver feedback","text"],["notes","Crew notes","text"]]}
];
export function KartSetup({driver,kart,className,trackId,kartId,racerId}:{driver:string;kart:string;className:string;trackId:string;kartId?:string;racerId?:string}){
 const [values,setValues]=useState<Setup>({});
 const [versions,setVersions]=useState<Version[]>([]);
 const [session,setSession]=useState("Practice");
 const [active,setActive]=useState(1);
 const [notice,setNotice]=useState("");
 const key="rivali-uploader-setup-v1:"+trackId+":"+(kart||driver||"new");
 useEffect(()=>{void Promise.resolve().then(()=>{try{const saved=JSON.parse(localStorage.getItem(key)||"[]") as Version[];setVersions(saved);setValues(saved[0]?.setup??{driver,kart,class:className});}catch{setVersions([]);setValues({driver,kart,class:className});}});},[key,driver,kart,className]);
 useEffect(()=>{
  if(!kartId)return;
  let alive=true;
  const db=createClient();
  void db.from("kart_setup_baselines").select("setup").eq("kart_id",kartId).eq("status","approved")
    .order("submitted_at",{ascending:false}).limit(1).maybeSingle().then(({data})=>{
      if(!alive||!data?.setup)return;
      const saved=JSON.parse(localStorage.getItem(key)||"[]") as Version[];
      if(saved.length)return;
      const source=data.setup as Record<string,unknown>;
      const sheet=(source.kart_worksheet&&typeof source.kart_worksheet==="object"?source.kart_worksheet:{}) as Record<string,unknown>;
      const imported:Setup={driver,kart,class:className};
      for(const [name,value] of Object.entries({...source,...sheet})){
        if(value!=null&&typeof value!=="object")imported[canonicalToForm[name]||name]=String(value);
      }
      setValues(imported);
      setNotice("Latest approved baseline loaded from Rivali. Review and save any changes.");
    });
  return ()=>{alive=false;};
 },[kartId,key,driver,kart,className]);
 async function save(){
  if(!kartId||!racerId){setNotice("Select a registered kart and driver to save this setup to Rivali.");return;}
  const next:Version={id:crypto.randomUUID(),at:new Date().toISOString(),session,setup:{...values,driver:values.driver||driver,kart:values.kart||kart,class:values.class||className}};
  const db=createClient();
  const {data:auth,error:authError}=await db.auth.getUser();
  if(authError||!auth.user){setNotice("Sign in again before saving.");return;}
  const setup:Record<string,unknown>={...next.setup,
    kart_worksheet:next.setup,session_label:session,
    lf_pressure_psi:numericOrNull(next.setup.lf),rf_pressure_psi:numericOrNull(next.setup.rf),
    lr_pressure_psi:numericOrNull(next.setup.lr),rr_pressure_psi:numericOrNull(next.setup.rr),
    rear_stagger_in:numericOrNull(next.setup.stagger),crossweight_pct:numericOrNull(next.setup.cross),
    rear_sprocket:numericOrNull(next.setup.rearSprocket),
    scale_measurement_source:next.setup.crossVerification||"not_recorded"
  };
  const {error}=await db.from("kart_setup_baselines").insert({
    user_id:auth.user.id,racer_id:racerId,kart_id:kartId,setup,status:"approved"
  });
  if(error){setNotice("Cloud save failed. Setup not approved: "+error.message);return;}
  const all=[next,...versions];localStorage.setItem(key,JSON.stringify(all));
  setVersions(all);setNotice("Setup version saved to Rivali database.");
 }
 return <div className={styles.setupWorkspace}>
 <div className={styles.setupForm}><div className={styles.setupTitle}><div><h2>Kart Setup</h2><p>Record only what changes between sessions. Unmeasured fields stay blank.</p></div><span>Draft v{versions.length+1}</span></div>
 <div className={styles.setupStage}><label>Session<select value={session} onChange={e=>setSession(e.target.value)}>{["Practice","Qualifying","Heat","Race","Other"].map(x=><option key={x}>{x}</option>)}</select></label><span>Driver: {driver||"Not chosen"} · Kart {kart||"Not chosen"}</span></div>
 <KartSetupImageImport onApply={(imported)=>setValues(v=>({...v,...imported}))}/><KartDiagram values={values} onChange={(key,value)=>setValues(v=>({...v,[key]:value}))}/><div className={styles.setupSections}>{defs.map((section,i)=><section key={section.title} className={styles.setupSection}>
 <button type="button" className={styles.setupSectionButton} onClick={()=>setActive(active===i?-1:i)}><b>{i+1}</b><strong>{section.title}</strong><span>{active===i?"−":"+"}</span></button>
 {active===i&&<div className={styles.setupFields}>{section.fields.map(([field,label,type])=><label key={field}>{label}<input type={type} step={type==="number"?"any":undefined} value={values[field]??(field==="driver"?driver:field==="kart"?kart:field==="class"?className:"")} onChange={e=>setValues(v=>({...v,[field]:e.target.value}))} placeholder="Not recorded" /></label>)}</div>}</section>)}</div>
 <div className={styles.setupActions}><button type="button" onClick={save}>Save Session Changes</button>{notice&&<span>{notice}</span>}</div>
 </div>
 <aside className={styles.setupHistory}><h2>Setup Change History</h2><p>Approved saves go to Rivali; this browser also keeps a convenient local history.</p>{versions.length===0?<p>No versions saved yet.</p>:versions.map((v,i)=><article key={v.id}><b>v{versions.length-i} · {v.session}</b><small>{new Date(v.at).toLocaleString()}</small><button type="button" onClick={()=>{setValues(v.setup);setNotice("Version loaded for editing. Save to create a new version.");}}>Restore as Draft</button><div>{Object.entries(v.setup).filter(([k])=>!["driver","kart","class"].includes(k)).slice(0,5).map(([k,val])=><small key={k}>{k}: {val}</small>)}</div></article>)}</aside>
 </div>;
}

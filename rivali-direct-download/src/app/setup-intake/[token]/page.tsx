"use client";
import {useEffect,useRef,useState} from "react";
import {useParams} from "next/navigation";
import styles from "./setup-intake.module.css";

type KartDraft={id:string;kart_number:string;setup:Record<string,string>};
type VoiceEntry={key:string;value:string;confidence:string;accept:boolean};
type SpeechEvent={results:ArrayLike<{0:{transcript:string}}>} ;
type SpeechClient={
  lang:string;continuous:boolean;interimResults:boolean;
  onresult:((e:SpeechEvent)=>void)|null;
  onend:(()=>void)|null;
  onerror:(()=>void)|null;
  start:()=>void;stop:()=>void;
};
const makeKart=(id:string):KartDraft=>({id,kart_number:"",setup:{}});
const sections:{title:string;subtitle:string;fields:[string,string,string][]}[]=[
 {title:"Kart Identity",subtitle:"Keep every kart separate, even when the same driver races different classes.",fields:[
  ["class_name","Class","text"],["chassis_make","Chassis make","text"],["chassis_model","Chassis model","text"],
  ["engine_make","Engine make","text"],["engine_model","Engine model","text"]]},
 {title:"Tires & Stagger",subtitle:"Pressures in PSI; circumferences and stagger in inches.",fields:[
  ["tire_brand","Tire brand","text"],["tire_compound","Tire compound","text"],
  ["lf_pressure_psi","LF PSI","number"],["rf_pressure_psi","RF PSI","number"],
  ["lr_pressure_psi","LR PSI","number"],["rr_pressure_psi","RR PSI","number"],
  ["lf_tire_circumference_in","LF circumference (in)","number"],
  ["rf_tire_circumference_in","RF circumference (in)","number"],
  ["lr_tire_circumference_in","LR circumference (in)","number"],
  ["rr_tire_circumference_in","RR circumference (in)","number"],
  ["front_stagger_in","Front stagger (in)","number"],["rear_stagger_in","Rear stagger (in)","number"]]},
 {title:"Scales & Weight",subtitle:"Tell Rivali whether readings came from scales or are estimates.",fields:[
  ["crossweight_pct","Crossweight (%)","number"],["left_weight_pct","Left-side weight (%)","number"],
  ["rear_weight_pct","Rear weight (%)","number"],["ballast_notes","Ballast position or moves","textarea"]]},
 {title:"Chassis & Geometry",subtitle:"Unknown is better than an invented setting.",fields:[
  ["front_track_width_in","Front track width (in)","number"],["rear_track_width_in","Rear track width (in)","number"],
  ["lf_camber_deg","LF camber (°)","number"],["rf_camber_deg","RF camber (°)","number"],
  ["lf_caster_deg","LF caster (°)","number"],["rf_caster_deg","RF caster (°)","number"],
  ["toe_in_in","Toe (in)","number"],["seat_position","Seat position","text"],
  ["spindle_washer_notes","Spindle washer placement","textarea"]]},
 {title:"Drivetrain",subtitle:"Record what is actually installed on this kart.",fields:[
  ["driver_sprocket","Driver sprocket teeth","number"],["rear_sprocket","Rear sprocket teeth","number"],
  ["gear_ratio","Gear ratio","text"],["clutch_notes","Clutch / engagement","textarea"]]},
 {title:"Race Notes",subtitle:"These help Doug interpret the MyChron data later.",fields:[
  ["track_conditions","Track and surface conditions","textarea"],
  ["handling_feedback","Handling, entry / center / exit","textarea"],
  ["setup_notes","Other setup notes or adjustments","textarea"]]}
];
export default function SetupIntakePage(){
 const {token}=useParams<{token:string}>();
 const [valid,setValid]=useState<boolean|null>(null);
 const [recipient,setRecipient]=useState("");
 const [driverName,setDriverName]=useState("");
 const [karts,setKarts]=useState<KartDraft[]>([makeKart("first")]);
 const [activeId,setActiveId]=useState("first");
 const [dictation,setDictation]=useState("");
 const [voiceEntries,setVoiceEntries]=useState<VoiceEntry[]>([]);
 const [voiceWarnings,setVoiceWarnings]=useState<string[]>([]);
 const [listening,setListening]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [success,setSuccess]=useState(false);
 const recognitionRef=useRef<SpeechClient|null>(null);
 useEffect(()=>{
  if(!token||!(/^[a-f0-9]{64}$/.test(token))) {void Promise.resolve().then(()=>setValid(false));return;}
  const controller=new AbortController();
  fetch("/api/setup-intake/submit?token="+encodeURIComponent(token),{cache:"no-store",signal:controller.signal})
   .then(r=>r.ok?r.json():Promise.reject())
   .then(data=>{setValid(Boolean(data.valid));setRecipient(data.recipientName||"Driver");
     setDriverName(v=>v||data.recipientName||"");})
   .catch(()=>{if(!controller.signal.aborted)setValid(false);});
  return ()=>controller.abort();
 },[token]);
 useEffect(()=>()=>recognitionRef.current?.stop(),[]);
 const active=karts.find(k=>k.id===activeId)||karts[0];
 function updateKart(update:Partial<KartDraft>){
  setKarts(items=>items.map(k=>k.id===active.id?{...k,...update}:k));
 }
 function updateField(key:string,value:string){
  updateKart({setup:{...active.setup,[key]:value}});
 }
 function addKart(){
  if(karts.length>=5)return setMessage("Submit these five first, then you can add more using the same link.");
  const next=String(Date.now())+"-"+karts.length;
  setKarts(v=>[...v,makeKart(next)]);setActiveId(next);setMessage("");setVoiceEntries([]);
 }
 function startDictation(){
  const browser=window as unknown as {
    SpeechRecognition?:new()=>SpeechClient;
    webkitSpeechRecognition?:new()=>SpeechClient;
  };
  const Constructor=browser.SpeechRecognition||browser.webkitSpeechRecognition;
  if(!Constructor){
   setMessage("Browser voice recognition is unavailable here. Use your phone keyboard microphone to dictate into the notes box.");
   return;
  }
  if(listening){recognitionRef.current?.stop();return;}
  try{
   const rec=new Constructor();rec.lang="en-US";rec.continuous=true;rec.interimResults=false;
   rec.onresult=e=>{
    const phrase=Array.from(e.results).map(x=>x[0]?.transcript||"").join(" ").trim();
    setDictation(phrase);
   };
   rec.onend=()=>setListening(false);
   rec.onerror=()=>{setListening(false);setMessage("Speech recognition stopped. You can still type the setup below.");};
   recognitionRef.current=rec;
   rec.start();setListening(true);setMessage("");
  }catch{setMessage("Could not open the microphone. Try the keyboard microphone or type the setup.");}
 }
 async function parseDictation(){
  if(!dictation.trim())return;
  setBusy(true);setMessage("");setVoiceEntries([]);setVoiceWarnings([]);
  try{
   const response=await fetch("/api/setup-intake/dictation",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({token,transcript:dictation})
   });
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Could not understand that dictation.");
   setVoiceEntries((data.entries||[]).map((x:VoiceEntry)=>({...x,accept:x.confidence!=="low"})));
   setVoiceWarnings(data.warnings||[]);
   if(!data.entries?.length)setMessage("No clear setup values detected. Say the corner and units, for example 'left front pressure six PSI'.");
  }catch(e){setMessage(e instanceof Error?e.message:"Unable to understand dictation.");}
  finally{setBusy(false);}
 }
 function applyDictation(){
  const next={...active.setup};
  for(const entry of voiceEntries){if(entry.accept)next[entry.key]=entry.value;}
  updateKart({setup:next});
  setVoiceEntries([]);
  setDictation("");
  setMessage("Dictated values inserted into this kart's setup. Review them before submission.");
 }
 async function submitAll(){
  if(!driverName.trim()||karts.some(k=>!k.kart_number.trim())){
   setMessage("Enter a driver name and a number or unique name for each kart.");return;
  }
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/setup-intake/submit",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({token,driverName:driverName.trim(),
      karts:karts.map(k=>({kart_number:k.kart_number.trim(),
        setup:{...k.setup,intake_source:"driver_link",intake_status:"pending_operator_review"}}))})
   });
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Setup could not be saved.");
   setSuccess(true);
   setMessage(`${data.kartCount} kart setup${data.kartCount===1?"":"s"} saved for operator review.`);
  }catch(e){setMessage(e instanceof Error?e.message:"Could not submit setups.");}
  finally{setBusy(false);}
 }
 if(valid===null)return <main className={styles.page}><div className={styles.shell}>Checking your Rivali setup link…</div></main>;
 if(valid===false)return <main className={styles.page}><div className={styles.shell}><h1>Setup link unavailable</h1><p>Ask your Rivali operator for a fresh invitation.</p></div></main>;
 return <main className={styles.page}>
  <div className={styles.shell}>
   <header className={styles.header}><strong>RIVALI <span>UPLOADER</span></strong><small>PRIVATE KART SETUP INTAKE</small></header>
   <div className={styles.hero}><p className={styles.eyebrow}>RACE-DAY PREPARATION</p>
    <h1>{success?"Setup received":"Kart setup intake"}</h1>
    <p>{recipient}, this form saves the details you know about each kart. You can skip unknown measurements.
      Rivali will keep the settings for each kart separate and wait for operator approval.</p></div>
   {success?<section className={styles.panel}><h2>Submitted successfully</h2>
     <p>{message} You may close this page, or submit additional karts using the same invitation.</p>
     <button className={styles.primary} onClick={()=>{setSuccess(false);setKarts([makeKart(String(Date.now()))]);setActiveId("");setMessage("");}}>Add more karts</button>
    </section>:<>
     <section className={styles.panel}><label className={styles.label}>Driver name
       <input value={driverName} maxLength={120} onChange={e=>setDriverName(e.target.value)} placeholder="Full name" />
     </label>
     <div className={styles.kartBar}>
      {karts.map((k,i)=><button key={k.id} className={active.id===k.id?styles.activeKart:styles.kart}
        type="button" onClick={()=>{setActiveId(k.id);setVoiceEntries([]);}}>
        {k.kart_number?"#"+k.kart_number:"Kart "+(i+1)}</button>)}
      <button type="button" className={styles.add} onClick={addKart}>+ Add kart</button>
     </div>
     <label className={styles.label}>Kart number or name
      <input value={active.kart_number} maxLength={120} onChange={e=>updateKart({kart_number:e.target.value})}
        placeholder="Example: 145" />
     </label>
     </section>
     <section className={styles.panel}>
       <h2>Talk through the setup</h2><p>Tell Rivali about one kart at a time. For example, “Kart 145, left front six PSI, right rear seven PSI, rear stagger an inch and a half.”</p>
       <div className={styles.voiceRow}>
        <button type="button" className={listening?styles.recording:styles.secondary} onClick={startDictation}>
          {listening?"Stop recording":"🎙 Dictate setup"}</button>
        <span>{listening?"Listening to you…":"Or use your phone keyboard microphone below"}</span>
       </div>
       <textarea rows={4} className={styles.notes} value={dictation} onChange={e=>setDictation(e.target.value)}
         placeholder="Dictate or type measurements, chassis details, or adjustments for this kart."/>
       <button type="button" className={styles.secondary} disabled={busy||!dictation.trim()} onClick={()=>void parseDictation()}>
         {busy?"Interpreting…":"Place dictated values into fields"}</button>
       {voiceWarnings.length>0&&<div className={styles.warning}>{voiceWarnings.map((w,i)=><p key={i}>{w}</p>)}</div>}
       {voiceEntries.length>0&&<div className={styles.review}>
        <h3>Approve these interpreted values</h3>
        {voiceEntries.map((entry,i)=><div className={styles.reviewEntry} key={i}>
         <label><input type="checkbox" checked={entry.accept} onChange={e=>setVoiceEntries(a=>a.map((x,j)=>j===i?{...x,accept:e.target.checked}:x))}/>
          {" "}{entry.key.replaceAll("_"," ")} <small>({entry.confidence})</small></label>
         <input value={entry.value} onChange={e=>setVoiceEntries(a=>a.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/>
        </div>)}
        <button type="button" className={styles.primary} onClick={applyDictation}>Apply selected values to this kart</button>
       </div>}
     </section>
     {sections.map(section=><section className={styles.panel} key={section.title}>
       <h2>{section.title}</h2><p className={styles.hint}>{section.subtitle}</p>
       {section.title==="Scales & Weight"&&<label className={styles.label}>How was crossweight obtained?
        <select value={active.setup.scale_measurement_source||""} onChange={e=>updateField("scale_measurement_source",e.target.value)}>
         <option value="">Not recorded</option><option value="shop_scales">Shop scales</option>
         <option value="track_scales">Track scales</option><option value="estimate">Estimated, not weighed</option>
         <option value="unknown">Unknown</option>
        </select></label>}
       <div className={styles.fields}>{section.fields.map(([key,label,kind])=><label className={styles.label} key={key}>
        {label}
        {kind==="textarea"?<textarea rows={2} value={active.setup[key]||""} onChange={e=>updateField(key,e.target.value)} placeholder="Leave blank if unknown"/>:
         <input type={kind==="number"?"text":kind} inputMode={kind==="number"?"decimal":undefined}
         value={active.setup[key]||""} onChange={e=>updateField(key,e.target.value)} placeholder="Not recorded"/>}
       </label>)}</div>
     </section>)}
     <section className={styles.panel}><h2>Review and submit</h2>
       <p>{karts.length} kart{karts.length===1?"":"s"} prepared. Each kart will be recorded separately. No setup is marked verified until the operator reviews it.</p>
       {karts.map((k,i)=><p key={k.id}><strong>{i+1}. {k.kart_number||"Unnamed kart"}</strong> · {Object.values(k.setup).filter(v=>v.trim()).length} fields entered</p>)}
       <button type="button" className={styles.primary} disabled={busy} onClick={()=>void submitAll()}>
        {busy?"Saving…":"Submit all kart setups"}</button>
       <p className={styles.hint}>Private to your Rivali operator. Share no passwords. Keep the original setup sheet for comparison.</p>
     </section>
    </>}
   {message&&<div className={styles.message} role="status">{message}</div>}
   <footer>RIVALI · Turn Data Into Speed</footer>
  </div>
 </main>;
}

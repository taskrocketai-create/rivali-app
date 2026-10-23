"use client";
import {useRef,useState} from "react";
import styles from "./uploader.module.css";
import {DougLiveVoice} from "./doug-live-voice";
type Mode="instructions"|"setup"|"debrief"|"debate"|"outcome";
type SpeechResult={results:ArrayLike<{0:{transcript:string}}>};
type VoiceEngine={lang:string;interimResults:boolean;onresult:((e:SpeechResult)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
export function DougAssistant({context,trackId,slots}:{context:string;trackId:string;slots:{id:string;driver:string;number:string;className:string;sessionId?:string}[]}){
 const [open,setOpen]=useState(false),[mode,setMode]=useState<Mode>("debate"),[message,setMessage]=useState(""),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[listening,setListening]=useState(false),[error,setError]=useState("");
 const [history,setHistory]=useState<{role:"user"|"assistant";content:string}[]>([]);
 const recognition=useRef<VoiceEngine|null>(null);
 const [slotId,setSlotId]=useState("");
 const [proposal,setProposal]=useState<Record<string,string>|null>(null);
 const [savedNote,setSavedNote]=useState("");
 const chosen=slots.find(s=>s.id===(slotId||slots[0]?.id));
 function dictate(){
  if(listening){recognition.current?.stop();setListening(false);return;}
  const w=window as Window & {SpeechRecognition?:new()=>VoiceEngine;webkitSpeechRecognition?:new()=>VoiceEngine};
  const Recognition=w.SpeechRecognition??w.webkitSpeechRecognition;
  if(!Recognition){setError("Voice dictation is not available in this browser. Type below instead.");return;}
  const r=new Recognition();r.lang="en-US";r.interimResults=false;
  r.onresult=e=>setMessage(text=>[text,e.results[0][0].transcript].filter(Boolean).join(" "));
  r.onerror=()=>{setListening(false);setError("Microphone failed. Check browser permissions.");};
  r.onend=()=>setListening(false);recognition.current=r;setError("");setListening(true);r.start();
 }
 async function send(){
  if(!message.trim())return;setBusy(true);setError("");setReply("");
  try{
   const response=await fetch("/api/race-day/doug",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,message:"Trackside context: "+context+"\nOperator: "+message,history})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Doug unavailable");
   setReply(data.reply);setHistory(prev=>[...prev,{role:"user" as const,content:message},{role:"assistant" as const,content:String(data.reply)}].slice(-16));
   setProposal(data.setupFields??null);
   setSavedNote("");
  }catch(e){setError(e instanceof Error?e.message:"Doug unavailable");}
  finally{setBusy(false);}
 }
 return <div className={styles.dougDock}><button className={styles.dougFab} onClick={()=>setOpen(x=>!x)} aria-expanded={open} aria-label="Talk to Doug"><span>ðŸŽ™</span> Talk to Doug</button>{open&&<section className={styles.dougPanel} aria-label="Doug crew chief"><div className={styles.dougHead}><strong>DOUG Â· CREW CHIEF</strong><button onClick={()=>setOpen(false)} aria-label="Close Doug">Ã—</button></div><p>Just talk normally. Ask Doug anything about your kart, the data, setup choices or race-day workflow.</p>
 <DougLiveVoice context={context+"; Selected kart: "+(chosen?.number||"not selected")+"; Driver: "+(chosen?.driver||"not selected")}/>
 <div style={{display:"none"}}><div className={styles.dougModes}>{([["instructions","Instructions"],["setup","Voice setup"],["debrief","Debrief"],["debate","Debate"],["outcome","Test outcome"]] as const).map(([id,label])=><button key={id} className={mode===id?styles.dougSelected:""} onClick={()=>setMode(id)}>{label}</button>)}</div>
 <label style={{display:"block",marginBottom:8}}>Kart context <select value={slotId||slots[0]?.id||""} onChange={e=>setSlotId(e.target.value)} style={{width:"100%",background:"#121a1a",color:"#fff",padding:9,border:"1px solid #4b5656"}}>{slots.map((s,i)=><option value={s.id} key={s.id}>{s.number||"Kart "+(i+1)} Â· {s.driver||"Unassigned"}</option>)}</select></label>
 <button type="button" onClick={()=>{setHistory([]);setReply("");setMessage("");}} style={{fontSize:12,background:"transparent",border:"1px solid #555",color:"#ccc",padding:6,marginBottom:8,cursor:"pointer"}}>New conversation</button>
 <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={5} placeholder={mode==="debate"?"I think we should move a 5 lb weight rearward because...":mode==="outcome"?"We tried the change. The measured result was...":"Tell Doug what happened or what to record..."} />
 <div className={styles.dougActions}><button onClick={dictate}>{listening?"Stop listening":"ðŸŽ™ Dictate"}</button><button disabled={busy||!message.trim()} onClick={()=>void send()}>{busy?"Thinking...":"Ask Doug"}</button></div>
 {proposal&&chosen&&<div className={styles.dougReply}><strong>Proposed setup entries Â· {chosen.number||"Kart"}</strong>{Object.entries(proposal).map(([key,value])=><p key={key}>{key}: {value}</p>)}<button type="button" className={styles.dougSave} onClick={()=>{
   const key="rivali-uploader-setup-v1:"+trackId+":"+(chosen.number||chosen.driver||"new");
   try {const old=JSON.parse(localStorage.getItem(key)||"[]") as {id:string;at:string;session:string;setup:Record<string,string>}[];
   const next={id:crypto.randomUUID(),at:new Date().toISOString(),session:"Doug confirmed setup",setup:{...(old[0]?.setup||{}),...proposal,driver:chosen.driver,kart:chosen.number,class:chosen.className}};
   localStorage.setItem(key,JSON.stringify([next,...old]));setSavedNote("Confirmed setup saved locally. Reopen Kart Setup to see it.");setProposal(null);
   }catch{setSavedNote("Could not save setup.");}
 }}>Confirm and save setup</button></div>}
 {mode==="debrief"&&reply&&chosen&&<button type="button" className={styles.dougSave} onClick={()=>{const key="rivali-uploader-debriefs-v1:"+trackId+":"+(chosen.number||chosen.driver||"new");const old=JSON.parse(localStorage.getItem(key)||"[]") as unknown[];localStorage.setItem(key,JSON.stringify([{at:new Date().toISOString(),driver:chosen.driver,kart:chosen.number,transcript:message,doug:reply},...old]));setSavedNote("Debrief saved locally for this kart.");}}>Save driver debrief</button>}
 </div>{savedNote&&<p>{savedNote}</p>}
 {error&&<p role="alert" className={styles.dougError}>{error}</p>}{reply&&<div className={styles.dougReply}><strong>Doug's assessment</strong><p>{reply}</p></div>}
 <small>Two-way voice is the primary interface. Changes require your approval before saving.</small></section>}</div>;
}


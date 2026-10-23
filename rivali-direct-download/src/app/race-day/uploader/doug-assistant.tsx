"use client";
import {useRef,useState} from "react";
import styles from "./uploader.module.css";
type Mode="instructions"|"setup"|"debrief"|"debate"|"outcome";
type SpeechResult={results:ArrayLike<{0:{transcript:string}}>};
type VoiceEngine={lang:string;interimResults:boolean;onresult:((e:SpeechResult)=>void)|null;onerror:(()=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void};
export function DougAssistant({context}:{context:string}){
 const [open,setOpen]=useState(false),[mode,setMode]=useState<Mode>("debate"),[message,setMessage]=useState(""),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[listening,setListening]=useState(false),[error,setError]=useState("");
 const recognition=useRef<VoiceEngine|null>(null);
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
   const response=await fetch("/api/race-day/doug",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode,message:"Trackside context: "+context+"\nOperator: "+message})});
   const data=await response.json();
   if(!response.ok)throw new Error(data.error||"Doug unavailable");
   setReply(data.reply);
  }catch(e){setError(e instanceof Error?e.message:"Doug unavailable");}
  finally{setBusy(false);}
 }
 return <div className={styles.dougDock}><button className={styles.dougFab} onClick={()=>setOpen(x=>!x)} aria-expanded={open} aria-label="Talk to Doug"><span>🎙</span> Talk to Doug</button>{open&&<section className={styles.dougPanel} aria-label="Doug crew chief"><div className={styles.dougHead}><strong>DOUG · CREW CHIEF</strong><button onClick={()=>setOpen(false)} aria-label="Close Doug">×</button></div><p>Ask questions, dictate a setup, debrief a driver or challenge a setup choice. Doug weighs evidence, not opinions.</p>
 <div className={styles.dougModes}>{([["instructions","Instructions"],["setup","Voice setup"],["debrief","Debrief"],["debate","Debate"],["outcome","Test outcome"]] as const).map(([id,label])=><button key={id} className={mode===id?styles.dougSelected:""} onClick={()=>setMode(id)}>{label}</button>)}</div>
 <textarea value={message} onChange={e=>setMessage(e.target.value)} rows={5} placeholder={mode==="debate"?"I think we should move a 5 lb weight rearward because...":mode==="outcome"?"We tried the change. The measured result was...":"Tell Doug what happened or what to record..."} />
 <div className={styles.dougActions}><button onClick={dictate}>{listening?"Stop listening":"🎙 Dictate"}</button><button disabled={busy||!message.trim()} onClick={()=>void send()}>{busy?"Thinking...":"Ask Doug"}</button></div>
 {error&&<p role="alert" className={styles.dougError}>{error}</p>}{reply&&<div className={styles.dougReply}><strong>Doug's assessment</strong><p>{reply}</p></div>}
 <small>Voice is speech-to-text where supported. Suggested setups are not saved automatically. Test outcomes need validation and review before entering the knowledge base.</small></section>}</div>;
}

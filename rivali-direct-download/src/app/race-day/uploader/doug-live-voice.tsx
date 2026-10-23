"use client";
import {useEffect,useRef,useState} from "react";
import {tool} from "@openai/agents";
import {z} from "zod";
import {RealtimeAgent,RealtimeSession} from "@openai/agents/realtime";
import styles from "./uploader.module.css";
type Turn={role:"driver"|"doug";text:string};
type Kart={id:string;number:string;driver:string;className:string};
type Pending={kind:"setup"|"debrief";kartId:string;summary:string;values?:Record<string,string>;transcript?:string};
const KEY="rivali-doug-conversation-v2";
const setupFields=["lf","rf","lr","rr","stagger","ballastFL","ballastFR","ballastCL","ballastCR","ballastRL","ballastRR","cross","gear","driverSprocket","rearSprocket","rideF","rideR","frontCamber","rearCamber","caster","frontToe","widthF","widthR","seat","tireBrand","compound","feedback","notes"];
export function DougLiveVoice({context,trackId,karts,onSelectKart}:{context:string;trackId:string;karts:Kart[];onSelectKart:(id:string)=>void}){
 const session=useRef<RealtimeSession|null>(null);
 const kartRef=useRef(karts),selectRef=useRef(onSelectKart),trackRef=useRef(trackId);
 kartRef.current=karts;selectRef.current=onSelectKart;trackRef.current=trackId;
 const [status,setStatus]=useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle");
 const [caption,setCaption]=useState(""),[turns,setTurns]=useState<Turn[]>([]),[pending,setPending]=useState<Pending|null>(null),[notice,setNotice]=useState("");
 useEffect(()=>{try{const v=JSON.parse(sessionStorage.getItem(KEY)||"[]");if(Array.isArray(v))setTurns(v.slice(-60));}catch{};return()=>{session.current?.close();session.current=null;};},[]);
 function remember(role:Turn["role"],text:string){const value=text.trim();if(!value)return;setTurns(old=>{const next=[...old,{role,text:value}].slice(-60);try{sessionStorage.setItem(KEY,JSON.stringify(next));}catch{}return next;});}
 function commit(){
  if(!pending)return;
  const kart=kartRef.current.find(k=>k.id===pending.kartId);if(!kart){setNotice("Kart no longer exists; no changes saved.");return;}
  const base=trackRef.current+":"+(kart.number||kart.driver||"new");
  try{
   if(pending.kind==="setup"){
    const key="rivali-uploader-setup-v1:"+base;
    const previous=JSON.parse(localStorage.getItem(key)||"[]") as {setup:Record<string,string>}[];
    const next={id:crypto.randomUUID(),at:new Date().toISOString(),session:"Doug voice confirmed",setup:{...(previous[0]?.setup||{}),...pending.values,driver:kart.driver,kart:kart.number,class:kart.className}};
    localStorage.setItem(key,JSON.stringify([next,...previous]));
   }else{
    const key="rivali-uploader-debriefs-v1:"+base;
    const previous=JSON.parse(localStorage.getItem(key)||"[]") as unknown[];
    localStorage.setItem(key,JSON.stringify([{at:new Date().toISOString(),driver:kart.driver,kart:kart.number,transcript:pending.transcript||pending.summary},...previous]));
   }
   setNotice("Saved to this device for kart "+(kart.number||"unassigned")+".");setPending(null);
  }catch{setNotice("Save failed. Please retry.");}
 }
 async function start(){
  if(session.current)return;
  setStatus("connecting");setCaption("Connecting Doug...");setNotice("");
  try{
   const response=await fetch("/api/realtime-token",{method:"POST"});
   const payload=await response.json();
   if(!response.ok||!payload.value)throw new Error(payload.error??"Voice unavailable.");
   const recent=turns.slice(-24).map(t=>(t.role==="driver"?"Driver: ":"Doug: ")+t.text).join("\n").slice(-9000);
   const selectKart=tool({name:"select_kart",description:"Select an existing kart when the user asks to change or discuss a kart. Call before changing that kart's setup.",parameters:z.object({kart_id:z.string()}),execute:async({kart_id})=>{const kart=kartRef.current.find(k=>k.id===kart_id);if(!kart)return "Unknown kart. Ask the driver which kart.";selectRef.current(kart_id);return "Active kart now "+(kart.number||"unassigned")+" driven by "+(kart.driver||"unassigned")+". Continue our conversation."; }});
   const stageSetup=tool({name:"prepare_setup_change",description:"After gathering explicitly stated numeric or text kart setup settings, show an on-screen confirmation before saving. Never infer missing values. Use count of 5 lb ballast weights for ballast fields.",parameters:z.object({kart_id:z.string(),summary:z.string(),values:z.record(z.string(),z.string())}),execute:async({kart_id,summary,values})=>{if(!kartRef.current.some(k=>k.id===kart_id))return "Unknown kart, ask which kart.";const safe=Object.fromEntries(Object.entries(values).filter(([k,v])=>setupFields.includes(k)&&typeof v==="string"&&v.length<=150));if(!Object.keys(safe).length)return "No recognized setup values; ask for details.";setPending({kind:"setup",kartId:kart_id,summary,values:safe});return "Setup proposal displayed for approval. Ask operator to tap Confirm before it is saved."; }});
   const stageDebrief=tool({name:"prepare_driver_debrief",description:"Record driver feedback for the current kart and show a confirmation card. Include the observed handling and turn location if stated.",parameters:z.object({kart_id:z.string(),summary:z.string(),driver_words:z.string()}),execute:async({kart_id,summary,driver_words})=>{if(!kartRef.current.some(k=>k.id===kart_id))return "Unknown kart, ask which kart.";setPending({kind:"debrief",kartId:kart_id,summary,transcript:driver_words});return "Debrief prepared. Ask operator to confirm on screen to save."; }});
   const agent=new RealtimeAgent({name:"Doug",voice:"cedar",tools:[selectKart,stageSetup,stageDebrief],instructions:`You are Doug, the Rivali dirt oval kart crew chief. Conversation is natural, continuous, short and direct. No modes. Infer instructions, driver debrief, setup debate or setup entry from speech. Explain or disagree with mechanical evidence, uncertainty and missing measurements. Five-pound ballast weights are discrete pieces. Never pretend telemetry or corner weights exist. Use select_kart to switch active kart, prepare_setup_change for setup writes, prepare_driver_debrief for debriefs. Ask operator to confirm on screen. Never say a save happened before confirmation. Do not modify the knowledge base. Existing kart IDs: ${JSON.stringify(karts)}. Track: ${context}. Conversation so far: ${recent}`});
   const live=new RealtimeSession(agent,{model:"gpt-realtime-2.1"});
   live.on("audio_start",()=>setStatus("speaking"));live.on("audio_stopped",()=>setStatus("listening"));
   live.on("agent_end",(_context,_agent,output)=>{if(output){const answer=String(output);setCaption(answer);remember("doug",answer);}});
   live.on("transport_event",event=>{const e=event as {type?:string;transcript?:string};if(e.type==="conversation.item.input_audio_transcription.completed"&&e.transcript)remember("driver",e.transcript);});
   live.on("error",()=>{setStatus("error");setCaption("Voice connection interrupted. Tap again.");session.current?.close();session.current=null;});
   await live.connect({apiKey:payload.value});session.current=live;setStatus("listening");
   live.sendMessage(recent?"Continue naturally from the earlier conversation. Ask how to help now.":"Greet me briefly as Doug and listen.");
  }catch(e){setStatus("error");setCaption(e instanceof Error?e.message:"Could not connect.");}
 }
 function end(){session.current?.close();session.current=null;setStatus("idle");setCaption("Call ended. Session history retained on this device.");}
 const active=status==="listening"||status==="speaking";
 return <div className={styles.dougDock}>
 {pending&&<section className={styles.dougConfirm}><strong>{pending.kind==="setup"?"Confirm kart setup":"Confirm driver debrief"}</strong><p>{pending.summary}</p>{pending.values&&Object.entries(pending.values).map(([k,v])=><small key={k}>{k}: {v}</small>)}<div><button type="button" onClick={commit}>Confirm & Save</button><button type="button" onClick={()=>{setPending(null);setNotice("Discarded.");}}>Discard</button></div></section>}
 {notice&&<div className={styles.dougMinimalStatus}>{notice}</div>}
 <button type="button" className={styles.dougFab} disabled={status==="connecting"} onClick={()=>active?end():void start()}>{status==="connecting"?"Connecting...":active?"End Doug Call":"Talk to Doug"}</button>
 {(active||status==="error")&&!pending&&!notice&&<div className={styles.dougMinimalStatus}>{active?(status==="speaking"?"Doug speaking":"Listening"):"Connection error"}{status==="error"&&<small>{caption}</small>}</div>}
 </div>;
}

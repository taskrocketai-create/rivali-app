"use client";
import {useEffect,useRef,useState} from "react";
import {RealtimeAgent,RealtimeSession} from "@openai/agents/realtime";
import styles from "./uploader.module.css";
export function DougLiveVoice({context}:{context:string}){
 const session=useRef<RealtimeSession|null>(null);
 const [status,setStatus]=useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle");
 const [muted,setMuted]=useState(false),[caption,setCaption]=useState("");
 useEffect(()=>()=>{session.current?.close();session.current=null;},[]);
 async function start(){
  if(session.current)return;
  setStatus("connecting");setCaption("Connecting to Doug...");
  try{
   const response=await fetch("/api/realtime-token",{method:"POST"});
   const payload=await response.json();
   if(!response.ok||!payload.value)throw new Error(payload.error??"Voice connection unavailable.");
   const agent=new RealtimeAgent({name:"Doug",voice:"cedar",instructions:`You are Doug, concise, practical kart crew chief for Rivali Uploader. This is a natural two-way voice discussion. Listen and respond briefly, ask clarifying questions, disagree when evidence warrants, and give confidence and the reason. Help with instructions, verbal setup intake, driver debriefs and debate setup changes. Never fabricate MyChron data, measured corner weights or outcomes. Ballast weights are physical 5 lb units. Never claim that a setup/debrief was saved or KB updated through voice alone. All data-changing actions need explicit on-screen confirmation using the separate text panel. Do not auto-edit the knowledge base. User trackside context: ${context}`});
   const live=new RealtimeSession(agent,{model:"gpt-realtime-2.1"});
   live.on("audio_start",()=>setStatus("speaking"));
   live.on("audio_stopped",()=>setStatus("listening"));
   live.on("agent_end",(_ctx,_agent,output)=>{if(output)setCaption(String(output));});
   live.on("error",()=>{setStatus("error");setCaption("Voice connection interrupted.");});
   await live.connect({apiKey:payload.value});session.current=live;setStatus("listening");
   live.sendMessage("Greet me briefly as Doug, then ask what we need to work on with this kart.");
  }catch(e){setStatus("error");setCaption(e instanceof Error?e.message:"Could not connect.");}
 }
 function stop(){session.current?.close();session.current=null;setMuted(false);setStatus("idle");setCaption("Call ended.");}
 function mute(){if(!session.current)return;const next=!muted;session.current.mute(next);setMuted(next);}
 const on=status==="listening"||status==="speaking";
 return <div className={styles.dougVoice}><strong>Live 2-way Doug voice</strong><p>{status==="listening"?"Doug is listening. Speak naturally.":status==="speaking"?"Doug is speaking.":status==="connecting"?"Connecting microphone and audio...":"Live audio conversation using your microphone and speakers."}</p><div className={styles.dougActions}><button type="button" disabled={status==="connecting"} onClick={()=>on?stop():void start()}>{on?"End Voice Call":status==="connecting"?"Connecting...":"Start Voice Call"}</button>{on&&<button type="button" onClick={mute}>{muted?"Unmute":"Mute"}</button>}</div>{caption&&<small>{caption}</small>}</div>;
}

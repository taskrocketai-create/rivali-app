"use client";
import {useEffect,useRef,useState} from "react";
import {RealtimeAgent,RealtimeSession} from "@openai/agents/realtime";
import styles from "./uploader.module.css";
type Turn={role:"driver"|"doug";text:string};
const KEY="rivali-doug-conversation-v2";
export function DougLiveVoice({context}:{context:string}){
 const session=useRef<RealtimeSession|null>(null);
 const [status,setStatus]=useState<"idle"|"connecting"|"listening"|"speaking"|"error">("idle");
 const [caption,setCaption]=useState("");
 const [turns,setTurns]=useState<Turn[]>([]);
 useEffect(()=>{try{const v=JSON.parse(sessionStorage.getItem(KEY)||"[]");if(Array.isArray(v))setTurns(v.slice(-60));}catch{};return()=>{session.current?.close();session.current=null;};},[]);
 function remember(role:Turn["role"],text:string){
  const content=text.trim();if(!content)return;
  setTurns(old=>{const next=[...old,{role,text:content}].slice(-60);try{sessionStorage.setItem(KEY,JSON.stringify(next));}catch{}return next;});
 }
 async function start(){
  if(session.current)return;
  setStatus("connecting");setCaption("Connecting Doug...");
  try{
   const response=await fetch("/api/realtime-token",{method:"POST"});
   const payload=await response.json();
   if(!response.ok||!payload.value)throw new Error(payload.error??"Voice unavailable.");
   const prior=turns.slice(-25).map(t=>(t.role==="driver"?"Driver: ":"Doug: ")+t.text).join("\n").slice(-9000);
   const agent=new RealtimeAgent({name:"Doug",voice:"cedar",instructions:`You are Doug, the Rivali trackside crew chief. Speak as naturally as a human crew chief in an uninterrupted two-way conversation. There are no modes to select. Infer whether the person needs instructions, a setup debrief, setup entry, or wants to argue through a tuning choice. Answer the question, and challenge wrong claims with mechanical reasoning and uncertainty. Don't invent lap results, weight percentages, or telemetry. Ballast consists of 5 lb physical weights. For actions that modify setup data, collect exact values and request operator confirmation, and never claim the data was saved by this voice-only UI. No knowledge-base changes. Trackside context: ${context}. Recent conversation, if any: ${prior}`});
   const live=new RealtimeSession(agent,{model:"gpt-realtime-2.1"});
   live.on("audio_start",()=>setStatus("speaking"));
   live.on("audio_stopped",()=>setStatus("listening"));
   live.on("agent_end",(_ctx,_agent,output)=>{if(output){const answer=String(output);setCaption(answer);remember("doug",answer);}});
   live.on("transport_event",event=>{const v=event as {type?:string;transcript?:string};if(v.type==="conversation.item.input_audio_transcription.completed"&&v.transcript)remember("driver",v.transcript);});
   live.on("error",()=>{setStatus("error");setCaption("Connection interrupted. Tap again to reconnect.");session.current?.close();session.current=null;});
   await live.connect({apiKey:payload.value});session.current=live;setStatus("listening");
   live.sendMessage(prior?"Continue our previous conversation naturally. Ask what I want to do next.":"Say hello briefly as Doug, then listen for what I need.");
  }catch(e){setStatus("error");setCaption(e instanceof Error?e.message:"Could not connect.");}
 }
 function end(){session.current?.close();session.current=null;setStatus("idle");setCaption("Call ended. Conversation retained on this device.");}
 const live=status==="listening"||status==="speaking";
 return <div className={styles.dougDock}><button className={styles.dougFab} type="button" disabled={status==="connecting"} onClick={()=>live?end():void start()} aria-label={live?"End call with Doug":"Talk to Doug"}>{status==="connecting"?"Connecting...":live?"End Doug Call":"Talk to Doug"}</button>{(live||status==="error")&&<div className={styles.dougMinimalStatus} role="status">{live?(status==="speaking"?"Doug speaking":"Listening to you"):"Connection error"}{status==="error"&&<small>{caption}</small>}</div>}</div>;
}

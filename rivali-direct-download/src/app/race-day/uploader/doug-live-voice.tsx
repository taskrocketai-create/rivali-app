"use client";
import {useEffect,useRef,useState} from "react";
import {tool} from "@openai/agents";
import {z} from "zod";
import {RealtimeAgent,RealtimeSession} from "@openai/agents/realtime";
import styles from "./uploader.module.css";
type Turn={role:"driver"|"doug";text:string};
const KEY="rivali-doug-conversation-v2";
export function DougLiveVoice({context,karts,onSelectKart}:{context:string;karts:{id:string;number:string;driver:string}[];onSelectKart:(id:string)=>void}){
 const session=useRef<RealtimeSession|null>(null);
 const kartState=useRef(karts);const selectState=useRef(onSelectKart);kartState.current=karts;selectState.current=onSelectKart;
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
   const selectKart=tool({name:"select_kart",description:"Change active kart when driver asks to switch, open, work on, or talk about a numbered kart or driver. Use this before discussing that kart.",parameters:z.object({kart_id:z.string().describe("Kart slot ID from current context")}),execute:async({kart_id})=>{const kart=kartState.current.find(k=>k.id===kart_id);if(!kart)return "Kart not found. Ask which kart they mean.";selectState.current(kart_id);return "Switched to kart "+(kart.number||"unassigned")+" driver "+(kart.driver||"unassigned")+". The selected kart is now active.";}});
   const agent=new RealtimeAgent({name:"Doug",voice:"cedar",tools:[selectKart],instructions:`You are Doug, the Rivali trackside crew chief. Speak as naturally as a human crew chief in an uninterrupted two-way conversation. There are no modes to select. Infer whether the person needs instructions, a setup debrief, setup entry, or wants to argue through a tuning choice. Answer the question, and challenge wrong claims with mechanical reasoning and uncertainty. Don't invent lap results, weight percentages, or telemetry. Ballast consists of 5 lb physical weights. For actions that modify setup data, collect exact values and request operator confirmation, and never claim the data was saved by this voice-only UI. Use select_kart immediately for spoken kart switching. The current kart IDs are ${JSON.stringify(karts)}. If asked to perform a save, clearly say that on-screen confirmation is still required. No knowledge-base changes. Trackside context: ${context}. Recent conversation, if any: ${prior}`});
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

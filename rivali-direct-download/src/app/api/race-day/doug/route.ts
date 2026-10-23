import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export async function POST(request:Request){
 const db=await createClient();const {data:auth}=await db.auth.getClaims();
 if(!auth?.claims?.sub)return NextResponse.json({error:"Please sign in."},{status:401});
 const payload=await request.json().catch(()=>null);
 const message=typeof payload?.message==="string"?payload.message.trim().slice(0,4000):"";
 const mode=["instructions","setup","debrief","debate","outcome"].includes(payload?.mode)?payload.mode:"debate";
 if(!message)return NextResponse.json({error:"Tell Doug what you want to discuss."},{status:400});
 if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"Doug requires OPENAI_API_KEY in the deployment."},{status:503});
 const {data:kb}=await db.from("knowledge_items").select("title,body").eq("status","active").limit(80);
 const context=(kb??[]).filter(x=>/kart|weight|tire|stagger|chassis|handling/i.test(x.title)).slice(0,12).map(x=>x.title+": "+x.body.slice(0,650)).join("\n");
 const system="You are Doug, a concise, evidence-first dirt oval kart crew chief. Answer in practical plain language. Do not agree automatically. For disputed adjustments, weigh driver observations, counterarguments, likely mechanisms, alternatives, measurements, uncertainty. State AGREE, DISAGREE, or INSUFFICIENT EVIDENCE and explain. Never invent telemetry or measured weights. Five-pound ballast refers to the physical weights, not recommended changes. For setup voice entry, extract proposed field values but never claim the setup has been saved. For driver debrief, identify what was felt and where. For an outcome, ask what was changed, objective lap/sector evidence, and confounders; treat findings as provisional until reviewed. Do not claim the knowledge base has been updated. Relevant reference excerpts:\n"+context;
 const fields=["lf","rf","lr","rr","stagger","ballastFL","ballastFR","ballastCL","ballastCR","ballastRL","ballastRR","cross","gear","driverSprocket","rearSprocket","rideF","rideR","frontCamber","rearCamber","caster","frontToe","widthF","widthR","seat","tireBrand","compound","feedback","notes"];
 const extraction=mode==="setup" ? "\nFor setup mode, respond only in JSON matching {\"reply\":\"short grounded response\",\"setupFields\":{...}}. Extract ONLY fields explicitly supplied by user using field names "+fields.join(",")+". Preserve values as strings. Each ballast location uses a count of physical 5 lb weights, not pounds. Do not infer missing values. If values or selected location are ambiguous, omit them and ask for clarification in reply.": "";
 const history=Array.isArray(payload?.history)?payload.history.slice(-12).filter((v:unknown)=>!!v&&typeof v==="object"&&["user","assistant"].includes((v as {role?:string}).role??"")&&typeof (v as {content?:unknown}).content==="string").map((v:{role:"user"|"assistant";content:string})=>({role:v.role,content:v.content.slice(0,1500)})):[];
 const upstream=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",temperature:.25,messages:[{role:"system",content:system+extraction},...history,{role:"user",content:"Mode: "+mode+"\n"+message}]}),signal:AbortSignal.timeout(25000)});
 const json=await upstream.json().catch(()=>({}));
 if(!upstream.ok)return NextResponse.json({error:json?.error?.message??"Doug is unavailable."},{status:502});
 const output=String(json?.choices?.[0]?.message?.content??"No response generated.");
 if(mode==="setup"){try{const parsed=JSON.parse(output.replace(/^```json\s*/,"").replace(/```$/,""));const proposal=Object.fromEntries(Object.entries(parsed.setupFields??{}).filter(([k,v])=>fields.includes(k)&&typeof v==="string"&&v.length<150));return NextResponse.json({reply:parsed.reply??"Review the proposed entries.",setupFields:proposal});}catch{return NextResponse.json({reply:output});}}
 return NextResponse.json({reply:output});
}

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
 const upstream=await fetch("https://api.openai.com/v1/chat/completions",{method:"POST",headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-4o-mini",temperature:.25,messages:[{role:"system",content:system},{role:"user",content:"Mode: "+mode+"\n"+message}]}),signal:AbortSignal.timeout(25000)});
 const json=await upstream.json().catch(()=>({}));
 if(!upstream.ok)return NextResponse.json({error:json?.error?.message??"Doug is unavailable."},{status:502});
 return NextResponse.json({reply:json?.choices?.[0]?.message?.content??"No response generated."});
}

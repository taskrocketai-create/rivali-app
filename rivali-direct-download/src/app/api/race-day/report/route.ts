import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export const runtime="nodejs";
export const maxDuration=45;
type Lap={lap_number?:number;lap_time_sec?:number;duration_sec?:number};
export async function POST(request:Request){
 const db=await createClient();
 const {data:auth}=await db.auth.getClaims();
 const owner=auth?.claims?.sub;
 if(!owner)return NextResponse.json({error:"Sign in first."},{status:401});
 const body=await request.json().catch(()=>null);
 const id=body?.sessionId, tier=body?.tier==="crew_chief"?"crew_chief":"standard";
 if(typeof id!=="string"||!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:"Choose a session."},{status:400});
 const {data:s,error:sError}=await db.from("sessions").select("id,status,report_status,raw_file_name,session_date,session_type,setup,conditions,lap_count,best_lap_sec,average_lap_sec,consistency_stdev_sec,tracks(name),racers(name),karts(name)").eq("id",id).eq("user_id",owner).maybeSingle();
 if(sError||!s||s.status!=="completed")return NextResponse.json({error:"A completed, owned XRK session is required."},{status:400});
 if(s.report_status==="approved"||s.report_status==="sent")return NextResponse.json({error:"Approved reports cannot be overwritten."},{status:409});
 const {data:t,error:tError}=await db.from("session_telemetry").select("laps,channel_manifest,corner_analysis,report_analysis").eq("session_id",id).eq("user_id",owner).maybeSingle();
 if(tError||!t)return NextResponse.json({error:"Telemetry has not been processed yet."},{status:409});
 const previous=t.report_analysis as Record<string,unknown>|null;
 if(tier==="standard"&&previous?.tier==="crew_chief")return NextResponse.json({error:"Crew Chief recommendations already exist; Standard will not overwrite them."},{status:409});
 const laps=(Array.isArray(t.laps)?t.laps:[]) as Lap[];
 const lapTimes=laps.map(x=>Number(x.lap_time_sec??x.duration_sec)).filter(x=>Number.isFinite(x)&&x>0);
 const best=Number(s.best_lap_sec),avg=Number(s.average_lap_sec);
 const corner=(t.corner_analysis??{}) as Record<string,unknown>;
 const timing=(corner.lap_timing??{}) as Record<string,unknown>;
 const timingSource=String(timing.source??"unknown");
 const limitedTiming=/fallback|unvalidated|unknown/i.test(timingSource+" "+String(timing.diagnostic??""));
 const mapping=String(corner.diagnostic??"");
 const unmapped=/incomplete|missing|not mapped/i.test(mapping)||!corner.alignment;
 const confidence: "low"|"medium"|"high"=limitedTiming||unmapped?"low":lapTimes.length>=5?"medium":"low";
 const facts={
  session_file:s.raw_file_name,session_date:s.session_date,session_type:s.session_type,
  driver:s.racers,kart:s.karts,track:s.tracks,setup:s.setup,conditions:s.conditions,
  recorded_laps:lapTimes.length, best_lap_seconds:Number.isFinite(best)&&best>0?best:null,
  raw_average_lap_seconds:Number.isFinite(avg)&&avg>0?avg:null,
  lap_times_seconds:lapTimes.slice(0,75),
  channels:Array.isArray(t.channel_manifest)?t.channel_manifest.slice(0,50):[],
  lap_timing_source:timingSource,lap_timing_diagnostic:String(timing.diagnostic??""),
  corner_mapping_diagnostic:mapping,has_verified_corner_alignment:!unmapped,
  setup_source: (s.setup as Record<string,unknown>)?.setup_reference_type??"not confirmed for this run",
  confidence_floor:confidence
 };
 if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OpenAI is not configured."},{status:503});
 const system=`You write RIVALI trackside dirt oval kart telemetry report SUPPLEMENTS, never claim to reproduce the original AiM Race Studio report. Ground every statement in the supplied measured data; separate facts, plain-language meaning, possible causes, and uncertainty. Do not assert causes from missing channels. If timing packet status or lap alignment is unverified, explicitly label lap times as provisional and do not use raw average as representative pace if outlaps/slow laps may be included. If track turns or groove are unmapped, do NOT diagnose specific corner, turn-in, apex, or exit. If setup was not verified for this run, do not attribute lap differences to it. A sheet-recorded weight is not proof of trackside weighing. Never invent mph, handling issues, sensor channels, weather, precision or driver feedback. Standard tier must remain neutral: no adjustments, tests or prescriptions. Crew Chief tier must give specific next checks or controlled tests linked to the measured evidence. If chassis adjustment is not supported, explicitly say no adjustment is justified and specify what to measure before recommending a change. Do not invent stagger, spindle washer or weight adjustments. Include confidence with explicit reasons. Keep concise for trackside reading.`;
 const upstream=await fetch("https://api.openai.com/v1/responses",{
  method:"POST",headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
  body:JSON.stringify({model:"gpt-4.1-mini",store:false,max_output_tokens:1900,
    input:[{role:"system",content:[{type:"input_text",text:system}]},
      {role:"user",content:[{type:"input_text",text:JSON.stringify({tier,facts})}]}],
    text:{format:{type:"json_schema",name:"rivali_interpretation",strict:true,schema:{
      type:"object",additionalProperties:false,
      properties:{
        summary:{type:"string"},what_data_says:{type:"string"},
        what_it_means:{type:"string"},possible_causes:{type:"string"},
        confidence_reason:{type:"string"},what_to_try:{type:"string"},how_to_verify:{type:"string"}
      },
      required:["summary","what_data_says","what_it_means","possible_causes","confidence_reason","what_to_try","how_to_verify"]
    }}}
  }),cache:"no-store",signal:AbortSignal.timeout(38000)
 }).catch(()=>null);
 if(!upstream||!upstream.ok)return NextResponse.json({error:"Report interpretation unavailable. Nothing was published."},{status:502});
 const answer=await upstream.json();
 const raw=(answer.output??[]).flatMap((x:{content?:{type:string;text?:string}[]})=>x.content??[])
 .filter((x:{type:string})=>x.type==="output_text").map((x:{text?:string})=>x.text??"").join("");
 let ai:Record<string,string>;
 try{ai=JSON.parse(raw);}catch{return NextResponse.json({error:"Invalid interpretation. Nothing was published."},{status:502});}
 const nextChecks=unmapped?"Verify the track start/finish and turn markers against GPS; verify lap numbering in Race Studio; record the actual stagger, pressure and scale readings for this kart. No chassis adjustment is justified yet.":"Run a controlled baseline comparison with verified setup and lap timing, then change only one measured variable if evidence supports it.";
 const verificationSteps="Compare lap timestamps with Race Studio, document actual setup values rather than planned values, and compare clean laps in repeatable conditions.";
 const report={version:1,tier,generated_at:new Date().toISOString(),source:"AiM XRK parsed telemetry",confidence,
  verification:{timing_provisional:limitedTiming,corner_mapping_incomplete:unmapped,setup_unverified_for_run:true},
  facts,interpretation:{
   summary:String(ai.summary??"").slice(0,900),what_data_says:String(ai.what_data_says??"").slice(0,1500),
   what_it_means:String(ai.what_it_means??"").slice(0,1500),possible_causes:String(ai.possible_causes??"").slice(0,1500),
   confidence_reason:String(ai.confidence_reason??"").slice(0,900),
   what_to_try:tier==="crew_chief"?String(confidence==="low"?nextChecks:(ai.what_to_try||nextChecks)).slice(0,1100):"",
   how_to_verify:tier==="crew_chief"?String(confidence==="low"?verificationSteps:(ai.how_to_verify||verificationSteps)).slice(0,1100):""
  },original_aim_report:"Not included; attach original AiM report separately if available."
 };
 const {error:saveError}=await db.from("session_telemetry").update({report_analysis:report}).eq("session_id",id).eq("user_id",owner);
 if(saveError)return NextResponse.json({error:"Could not save the report draft."},{status:500});
 const {error:statusError}=await db.from("sessions").update({report_status:"pending_approval"}).eq("id",id).eq("user_id",owner);
 if(statusError)return NextResponse.json({error:"Report draft saved, but approval status could not update."},{status:500});
 return NextResponse.json({ok:true,report},{headers:{"Cache-Control":"no-store"}});
}

import Link from "next/link";
import {redirect,notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {PrintReport} from "./print-report";
export const dynamic="force-dynamic";
function one<T>(value:T|T[]|null|undefined):T|null{return Array.isArray(value)?value[0]??null:value??null;}
export default async function SessionReportPage({params}:{params:Promise<{sessionId:string}>}){
 const {sessionId}=await params;
 const db=await createClient();
 const {data:auth}=await db.auth.getClaims();
 const userId=auth?.claims?.sub;
 if(!userId)redirect("/login");
 const [{data:s},{data:t}]=await Promise.all([
  db.from("sessions").select("id,session_date,session_type,report_status,raw_file_name,lap_count,best_lap_sec,average_lap_sec,racers(name),karts(name),tracks(name)")
    .eq("id",sessionId).eq("user_id",userId).maybeSingle(),
  db.from("session_telemetry").select("report_analysis").eq("session_id",sessionId).eq("user_id",userId).maybeSingle()
 ]);
 if(!s)notFound();
 const r=t?.report_analysis as Record<string,unknown>|undefined;
 const i=r?.interpretation as Record<string,unknown>|undefined;
 const facts=r?.facts as Record<string,unknown>|undefined;
 const verification=r?.verification as Record<string,unknown>|undefined;
 const sections: [string,string][]=[
  ["What the data says","what_data_says"],["What it means","what_it_means"],
  ["Possible causes","possible_causes"],["Confidence and limitations","confidence_reason"],
  ["What to try","what_to_try"],["How to verify","how_to_verify"]
 ];
 const driver=one(s.racers as {name:string}|{name:string}[]|null)?.name??"Not recorded";
 const kart=one(s.karts as {name:string}|{name:string}[]|null)?.name??"Not recorded";
 const track=one(s.tracks as {name:string}|{name:string}[]|null)?.name??"Not recorded";
 return <main style={{background:"#fafaf6",color:"#171b16",minHeight:"100vh",padding:"25px 20px",fontFamily:"Arial,sans-serif"}}>
  <div style={{maxWidth:840,margin:"auto",background:"white",padding:"28px",border:"1px solid #ddd"}}>
   <div className="no-print" style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:20,flexWrap:"wrap"}}>
    <Link href="/race-day/uploader" style={{color:"#a32d20"}}>← Back to Rivali Uploader</Link><PrintReport/>
   </div>
   <header style={{borderBottom:"4px solid #e24e26",paddingBottom:14,marginBottom:24}}>
    <strong style={{color:"#ca3a18",fontSize:29,letterSpacing:2}}>RIVALI</strong>
    <div style={{fontSize:12,letterSpacing:2}}>TURN DATA INTO SPEED · TRACK TEST INTERPRETATION</div>
    <h1 style={{fontSize:26,margin:"18px 0 2px"}}>RaceDay Report</h1>
    <div style={{fontSize:14,color:"#4c514a"}}>Rivali interpretation supplement to AiM / Race Studio data</div>
   </header>
   {!i?<p>No interpreted report is available for this session. Generate the report draft in Rivali Uploader first.</p>:<>
    <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:20}}>
     {[["Driver",driver],["Kart",kart],["Track",track],["Date",s.session_date],
       ["Run",s.session_type],["Status",s.report_status],
       ["Analysis",String(r?.tier??"standard").replaceAll("_"," ")],
       ["Confidence",String(r?.confidence??"low")]].map(([label,value])=>
       <div key={label} style={{flex:"1 1 155px",padding:10,background:"#f4f5ef"}}>
        <div style={{fontSize:11,color:"#565d51"}}>{label}</div><strong>{value}</strong>
       </div>)}
    </div>
    <section style={{background:"#fff8e5",borderLeft:"4px solid #e5a620",padding:13,marginBottom:22}}>
     <strong>{s.report_status==="approved"?"OPERATOR APPROVED":"DRAFT · NOT APPROVED FOR DISTRIBUTION"}</strong>
     <p style={{margin:"7px 0 0",fontSize:13}}>The original AiM / Race Studio report is a separate source document and is not embedded here. Telemetry-derived results must be verified against the original when available.</p>
    </section>
    <section aria-label="Quick read" style={{background:"#f5f6ef",borderRadius:10,padding:"20px",marginBottom:16}}>
      <div style={{fontSize:11,fontWeight:800,letterSpacing:2,color:"#6b752e"}}>QUICK READ · 30 SECONDS</div>
      <h2 style={{fontSize:23,margin:"9px 0"}}>{String(i.summary??"Analysis not available")}</h2>
      <div style={{display:"flex",flexWrap:"wrap",gap:10,marginTop:16}}>
       <div style={{flex:"1 1 110px"}}><small>LAPS</small><div style={{fontSize:23,fontWeight:800}}>{s.lap_count??"?"}</div></div>
       <div style={{flex:"1 1 110px"}}><small>BEST LAP</small><div style={{fontSize:23,fontWeight:800}}>{s.best_lap_sec?Number(s.best_lap_sec).toFixed(3)+"s":"Unverified"}</div></div>
       <div style={{flex:"1 1 110px"}}><small>CONFIDENCE</small><div style={{fontSize:23,fontWeight:800,textTransform:"capitalize"}}>{String(r?.confidence??"low")}</div></div>
      </div>
      <p style={{marginBottom:0,fontSize:14}}><strong>Bottom line:</strong> {String(i.what_it_means??"Not established").slice(0,310)}{String(i.what_it_means??"").length>310?"…":""}</p>
      {r?.tier==="crew_chief"&&<div style={{marginTop:15,padding:13,background:"#fff"}}><strong>Doug’s recommended next steps</strong><p style={{margin:"8px 0",fontSize:14,lineHeight:1.5}}>{String(i.what_to_try||"No supported recommendation yet.")}</p><small>How to verify: {String(i.how_to_verify||"Confirm measurements before changes.")}</small></div>}
    </section>
    <p style={{fontSize:13,fontWeight:700}}>Key limits: {verification?.corner_mapping_incomplete?"Corner map incomplete. ":""}{verification?.setup_unverified_for_run?"Setup not verified for this run. ":""}{verification?.timing_provisional?"Timing provisional.":""}</p>
    <details style={{border:"1px solid #d5dbd0",borderRadius:10,padding:"15px",marginTop:22}}>
     <summary style={{fontWeight:800,cursor:"pointer",fontSize:17}}>Expand full report and supporting evidence</summary>
     <h2 style={{fontSize:20,marginTop:22}}>Recorded evidence</h2>
     <p style={{lineHeight:1.6,fontSize:14}}>File: {s.raw_file_name}. Recorded laps: {s.lap_count??"Not verified"}. Fastest stored lap: {s.best_lap_sec??"Not established"} seconds. Timing source: {String(facts?.lap_timing_source??"Unknown")}.</p>
    {Boolean(verification?.timing_provisional)&&<p style={{color:"#993b1e",fontWeight:700,fontSize:13}}>Lap timing is provisional and requires Race Studio verification.</p>}
    {Boolean(verification?.corner_mapping_incomplete)&&<p style={{color:"#993b1e",fontWeight:700,fontSize:13}}>Track corner mapping is incomplete. Corner-specific handling claims are not supported.</p>}
    {Boolean(verification?.setup_unverified_for_run)&&<p style={{fontSize:13}}>The recorded baseline setup was not verified as installed for this run.</p>}
    {sections.filter(([,key])=>Boolean(i[key])).map(([label,key])=><section key={key} style={{borderTop:"1px solid #ddd",paddingTop:12,marginTop:21}}>
      <h2 style={{fontSize:18}}>{label}</h2><p style={{lineHeight:1.6,whiteSpace:"pre-line"}}>{String(i[key])}</p>
    </section>)}
    </details>
    <footer style={{borderTop:"1px solid #aaa",paddingTop:12,marginTop:30,fontSize:11,color:"#555"}}>
     RIVALI · Operator review required · Original AiM data remains the technical source of record
    </footer>
   </>}
  </div>
 </main>;
}

"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {SetupReviewEditor} from "./setup-review-editor";

type Baseline={id:string;kart_id:string;racer_id:string;setup:Record<string,unknown>;
 status:"pending_review"|"approved"|"rejected";submitted_at:string};
type Person={id:string;name:string};
export function SetupInvitePanel({racers,karts}:{racers:Person[];karts:Person[]}){
 const db=useMemo(()=>createClient(),[]);
 const [knownRacers,setKnownRacers]=useState(racers);
 const [knownKarts,setKnownKarts]=useState(karts);
 const [recipientName,setRecipientName]=useState("Stephen");
 const [link,setLink]=useState("");
 const [records,setRecords]=useState<Baseline[]>([]);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const reload=useCallback(async()=>{
  const [baselines,drivers,vehicles]=await Promise.all([
    db.from("kart_setup_baselines").select("id,kart_id,racer_id,setup,status,submitted_at").order("submitted_at",{ascending:false}).limit(100),
    db.from("racers").select("id,name").order("name"),
    db.from("karts").select("id,name").order("name")
  ]);
  if(baselines.error)setNotice("Could not load incoming setups: "+baselines.error.message);
  else setRecords((baselines.data||[]) as Baseline[]);
  if(!drivers.error&&drivers.data)setKnownRacers(drivers.data);
  if(!vehicles.error&&vehicles.data)setKnownKarts(vehicles.data);
 },[db]);
 useEffect(()=>{void Promise.resolve().then(reload);},[reload]);
 async function createInvite(){
  setBusy(true);setNotice("");
  try{
   const res=await fetch("/api/setup-intake/invite",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({recipientName})
   });
   const payload=await res.json();
   if(!res.ok)throw new Error(payload.error||"Could not create link.");
   setLink(payload.url);
   setNotice("Private 30-day intake link ready. Copy or text it to the driver.");
  }catch(e){setNotice(e instanceof Error?e.message:"Failed to create link.");}
  finally{setBusy(false);}
 }
 async function changeReview(id:string,status:"approved"|"rejected"){
  setBusy(true);setNotice("");
  try{
   const {error}=await db.from("kart_setup_baselines").update({status}).eq("id",id);
   if(error)throw error;
   await reload();
   setNotice(status==="approved"?"Kart setup approved as a baseline.":"Submission rejected.");
  }catch(e){setNotice(e instanceof Error?e.message:"Could not update review.");}
  finally{setBusy(false);}
 }
 const input:React.CSSProperties={width:"100%",padding:11,border:"1px solid #566456",
   borderRadius:8,background:"#121813",color:"#fff",fontSize:16};
 const button:React.CSSProperties={padding:"11px 15px",background:"#e8f642",border:"none",
   borderRadius:8,color:"#111",fontWeight:800,cursor:"pointer"};
 return <div style={{display:"grid",gap:14,marginBottom:20}}>
  <section style={{border:"1px solid #3b4d3c",borderRadius:13,padding:18,background:"#131b16"}}>
   <h2 style={{margin:"0 0 8px"}}>Text a setup intake link</h2>
   <p style={{opacity:.8}}>The driver can dictate or type setup details for multiple karts. Each submission goes to Rivali for your review.</p>
   <div style={{display:"flex",gap:10,alignItems:"end",flexWrap:"wrap"}}>
    <label style={{flex:"1 1 170px"}}>Driver name<input style={input} value={recipientName} onChange={e=>setRecipientName(e.target.value)} maxLength={120}/></label>
    <button type="button" style={button} disabled={busy||!recipientName.trim()} onClick={()=>void createInvite()}>Generate secure link</button>
   </div>
   {link&&<div style={{marginTop:16}}>
    <input style={input} readOnly value={link} onFocus={e=>e.target.select()}/>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:9}}>
     <button type="button" style={button} onClick={()=>void navigator.clipboard.writeText(link).then(()=>setNotice("Copied. Paste into a text to the driver.")).catch(()=>setNotice("Select and copy the link above."))}>Copy link</button>
     <a href={`sms:?&body=${encodeURIComponent("Rivali kart setup form: "+link)}`}
       style={{...button,textDecoration:"none",display:"inline-block"}}>Text link</a>
    </div>
   </div>}
  </section>
  <section style={{border:"1px solid #3b4d3c",borderRadius:13,padding:18,background:"#131b16"}}>
   <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:15}}>
    <div><h2 style={{margin:0}}>Submitted setups</h2><p style={{opacity:.75}}>Each kart is a separate database record. No unreviewed measurement is treated as verified.</p></div>
    <button type="button" style={button} onClick={()=>void reload()}>Refresh</button>
   </div>
   {records.length===0?<p>No driver setup submissions yet.</p>:records.map(record=>{
    const kart=knownKarts.find(k=>k.id===record.kart_id)?.name||record.kart_id.slice(0,8);
    const racer=knownRacers.find(r=>r.id===record.racer_id)?.name||"Driver";
    const fields=Object.entries(record.setup||{}).filter(([k])=>!["intake_source","intake_status"].includes(k));
    return <article key={record.id} style={{borderTop:"1px solid #364338",padding:"14px 0"}}>
     <div style={{display:"flex",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
      <strong>{racer} · Kart {kart}</strong><span style={{color:record.status==="pending_review"?"#eaf43e":"#abc0ac"}}>{record.status.replaceAll("_"," ")}</span>
     </div>
     <small style={{opacity:.75}}>{new Date(record.submitted_at).toLocaleString()}</small>
     <details><summary style={{cursor:"pointer",padding:"10px 0"}}>Review {fields.length} setup fields</summary>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:9}}>
       {fields.map(([key,value])=><div key={key} style={{padding:9,border:"1px solid #384339",borderRadius:8}}>
        <small style={{display:"block",opacity:.7}}>{key.replaceAll("_"," ")}</small>
        <strong style={{overflowWrap:"anywhere"}}>{String(value)}</strong>
       </div>)}
      </div>
     </details>
     <details style={{marginTop:12}}><summary style={{cursor:"pointer",fontWeight:800,color:"#eaf43e"}}>Complete missing fields or correct intake values</summary><SetupReviewEditor key={record.id+record.submitted_at} id={record.id} setup={record.setup} status={record.status} onSaved={reload}/></details>
     {record.status==="pending_review"&&<div style={{display:"flex",gap:10,marginTop:10}}>
      <button style={button} type="button" disabled={busy} onClick={()=>void changeReview(record.id,"approved")}>Approve baseline</button>
      <button style={{...button,background:"#343d36",color:"#e9ede7"}} type="button" disabled={busy} onClick={()=>void changeReview(record.id,"rejected")}>Reject</button>
     </div>}
    </article>;
   })}
  </section>
  {notice&&<div role="status" style={{padding:10,background:"#253227",borderRadius:8}}>{notice}</div>}
 </div>;
}

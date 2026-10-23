"use client";
import { createClient } from "@/lib/supabase/client";
import { RivaliLogo } from "@/components/rivali-logo";
import { TrackMapEditor } from "@/components/track-map-editor";
import type { Track as DomainTrack, RaceSession } from "@/types/domain";
import { useEffect, useState, type ChangeEvent } from "react";
import { Plus, Trash2, UploadCloud, CheckCircle2, AlertCircle, Flag, MapPinned, ClipboardCheck } from "lucide-react";
import styles from "./uploader.module.css";
import { KartSetup } from "./kart-setup";
import { SetupInvitePanel } from "./setup-invite-panel";
import { DougLiveVoice } from "./doug-live-voice";

type Track = DomainTrack;
type OperatorSession = RaceSession & {report_status?:string|null};
type Racer = { id:string; name:string; primary_class:string | null };
type Kart = { id:string; name:string; racer_id:string | null; chassis_make:string | null; chassis_model:string | null };
type Slot = { id:string; driver:string; number:string; className:string; sessionType:string; fileName:string; status:"waiting"|"uploading"|"queued"|"error"; message:string; sessionId?:string };
type Draft = { trackId:string; eventDate:string; slots:Slot[] };
const makeSlot = (index:number):Slot => ({id:crypto.randomUUID(),driver:"",number:"",className:"",sessionType:"practice",fileName:"",status:"waiting",message:""});
const KEY = "rivali-operator-raceday-v1";
export function UploaderClient({tracks,racers,karts,sessions}:{tracks:Track[];racers:Racer[];karts:Kart[];sessions:OperatorSession[]}) {
  const [draft,setDraft] = useState<Draft>({trackId:"",eventDate:"",slots:[]});
  const [hydrated,setHydrated] = useState(false);
  const [files,setFiles] = useState<Record<string,File>>({});
  const [showMapper,setShowMapper] = useState(true);
  const [activeTab,setActiveTab]=useState<"race"|"setup"|"admin"|"reports"|"timekeeper">("race");
  const [selectedKart,setSelectedKart]=useState<string|null>(null);
  const [demoTiming,setDemoTiming]=useState(false);
  const [demoLap,setDemoLap]=useState(0);
  useEffect(()=>{if(!demoTiming)return;const timer=window.setInterval(()=>setDemoLap(lap=>lap+1),2200);return ()=>window.clearInterval(timer);},[demoTiming]);
  const [liveSessions,setLiveSessions]=useState<OperatorSession[]>(sessions);
  const [selectedReport,setSelectedReport]=useState<string|null>(null);
  const [reportTelemetry,setReportTelemetry]=useState<Record<string,unknown>|null>(null);
  const [reportError,setReportError]=useState("");
  const [generatingReport,setGeneratingReport]=useState(false);
  const [approvingReport,setApprovingReport]=useState(false);
  const supabase=createClient();
  async function refreshSessions(){
    const {data,error}=await supabase.from("sessions").select("id,session_date,session_type,status,report_status,best_lap_sec,average_lap_sec,consistency_stdev_sec,lap_count,setup,conditions,raw_file_name,tracks(id,name),racers(id,name),karts(id,name)").order("created_at",{ascending:false}).limit(100);
    if(!error&&data)setLiveSessions(data as unknown as OperatorSession[]);
  }
  useEffect(()=>{
    void Promise.resolve().then(()=>refreshSessions());
    const timer=window.setInterval(()=>{void refreshSessions();},15000);
    return ()=>window.clearInterval(timer);
  },[]);
  async function inspectReport(id:string){
    setSelectedReport(id);setReportError("");setReportTelemetry(null);
    const {data,error}=await supabase.from("session_telemetry").select("laps,corner_analysis,channel_manifest,report_analysis").eq("session_id",id).maybeSingle();
    if(error)setReportError(error.message);
    else if(data)setReportTelemetry(data as Record<string,unknown>);
    else setReportError("Telemetry is not available for this session yet.");
  }
  async function generateReport(id:string,tier:"standard"|"crew_chief"){
    setGeneratingReport(true);setReportError("");
    try{
      const response=await fetch("/api/race-day/report",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sessionId:id,tier})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Report generation failed.");
      await inspectReport(id);await refreshSessions();
    }catch(error){setReportError(error instanceof Error?error.message:"Could not generate report.");}
    finally{setGeneratingReport(false);}
  }
  async function approveReport(id:string){
    setApprovingReport(true);setReportError("");
    try{
      const response=await fetch(`/api/reports/${id}/approve`,{method:"POST"});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||"Approval failed.");
      await inspectReport(id);await refreshSessions();
      setReportError("Report approved privately. No automatic text or payment.");
    }catch(error){setReportError(error instanceof Error?error.message:"Could not approve report.");}
    finally{setApprovingReport(false);}
  }
  const [currentTracks,setCurrentTracks] = useState(tracks);
  const chosenTrack = currentTracks.find(t=>t.id===draft.trackId);
  const turnNames=chosenTrack?.turns?Object.keys(chosenTrack.turns).filter(x=>/^[1-4]$/.test(x)):[];
  const groove=(chosenTrack?.turns?._rivali as {groove?:unknown[]} | undefined)?.groove;
  const mapReady=!!chosenTrack && Array.isArray(chosenTrack.start_finish) && chosenTrack.start_finish.length>=2 && turnNames.length===4 && Array.isArray(groove) && groove.length>=2;
  function chooseRacer(id:string,value:string){
    const racer=racers.find(x=>x.id===value);
    if(!racer)return;
    const kart=karts.find(x=>x.racer_id===racer.id);
    change(id,{driver:racer.name,className:racer.primary_class??"",number:kart?.name??""});
  }
  function chooseKart(id:string,value:string){
    const kart=karts.find(x=>x.id===value);
    if(!kart)return;
    const racer=racers.find(x=>x.id===kart.racer_id);
    change(id,{number:kart.name,driver:racer?.name??"",className:racer?.primary_class??""});
  }
  useEffect(()=>{
    void Promise.resolve().then(()=>{
    try {
      const raw=window.localStorage.getItem(KEY);
      if(raw) { const stored=JSON.parse(raw) as Draft; setDraft({trackId:stored.trackId??"",eventDate:stored.eventDate??"",slots:Array.isArray(stored.slots)?stored.slots.slice(0,5):[]}); }
      else setDraft({trackId:"",eventDate:new Date().toLocaleDateString("en-CA"),slots:[makeSlot(0)]});
    } catch {setDraft({trackId:"",eventDate:"",slots:[makeSlot(0)]});}
    setHydrated(true);
    });
  },[]);
  useEffect(()=>{if(hydrated)window.localStorage.setItem(KEY,JSON.stringify({...draft,slots:draft.slots.map(s=>({...s,status:s.status==="uploading"?"waiting":s.status}))}));},[draft,hydrated]);
  function change(id:string,patch:Partial<Slot>) {setDraft(d=>({...d,slots:d.slots.map(s=>s.id===id?{...s,...patch}:s)}));}
  function add() {setDraft(d=>d.slots.length>=5?d:{...d,slots:[...d.slots,makeSlot(d.slots.length)]});}
  function remove(id:string) {setDraft(d=>({...d,slots:d.slots.filter(s=>s.id!==id)}));setFiles(f=>{const next={...f};delete next[id];return next;});}
  function onFile(id:string,event:ChangeEvent<HTMLInputElement>) {
    const file=event.target.files?.[0];
    if(!file)return;
    if(!file.name.toLowerCase().endsWith(".xrk") || file.size===0 || file.size>100*1024*1024) {change(id,{status:"error",message:"Choose a .xrk file between 1 byte and 100 MB."});return;}
    setFiles(f=>({...f,[id]:file}));change(id,{fileName:file.name,status:"waiting",message:"File selected. Ready to upload."});
  }
  async function upload(slot:Slot) {
    const file=files[slot.id];
    if(!file)return change(slot.id,{status:"error",message:"Select an XRK file first. Files must be reselected after reopening this page."});
    change(slot.id,{status:"uploading",message:"Uploading to Rivali..."});
    try {
      const form=new FormData();form.append("file",file);form.append("sessionType",slot.sessionType);form.append("driver",slot.driver);form.append("kartNumber",slot.number);form.append("className",slot.className);form.append("trackId",draft.trackId);form.append("eventDate",draft.eventDate);
      const result=await fetch("/api/race-day/operator-upload",{method:"POST",body:form});
      const data=await result.json();
      if(!result.ok)throw new Error(data.error??"Upload was rejected.");
      change(slot.id,{status:"queued",sessionId:data.sessionId,message:"XRK received. Analysis queued."});void refreshSessions();
    }catch(e){change(slot.id,{status:"error",message:e instanceof Error?e.message:"Upload failed."});}
  }
  return <main className={styles.page}>
    <header className={styles.bar}><div className={styles.brand}><RivaliLogo compact /><span><em>RIVALI</em> UPLOADER</span></div><nav>{([["race","Race Day"],["setup","Kart Setup"],["admin","Race Day Admin"],["reports","Reports"],["timekeeper","Timekeeper"]] as const).map(([tab,name])=><button key={tab} type="button" onClick={()=>{setActiveTab(tab);void refreshSessions();}} className={activeTab===tab?styles.activeTab:styles.navTab}>{name}</button>)}</nav><span className={styles.tag}>OPERATOR Â· 5 KART MAX</span></header>
    <div className={styles.content}>
    {activeTab==="race" && <div className={styles.racedayHero}>
      <div><strong>TRACKSIDE OPERATIONS</strong><span>Load up to five karts, collect telemetry, review evidence, then approve reports.</span></div>
      <div className={styles.racedayHeroBadges}><span>{chosenTrack?.name??"Select track"}</span><span>{liveSessions.filter(s=>s.status==="completed").length} processed sessions</span><span>5 kart capacity</span></div>
    </div>}
    {activeTab==="setup" && <section className={styles.operatorArea}><div className={styles.heading}><div><h1>Kart Setup</h1><p>Session settings and version history</p></div></div><SetupInvitePanel racers={racers} karts={karts} /><div className={styles.kartPicker}>{draft.slots.map((slot,i)=><button key={slot.id} className={selectedKart===slot.id||(!selectedKart&&i===0)?styles.selectedKart:""} onClick={()=>setSelectedKart(slot.id)}>Kart {slot.number||i+1} · {slot.driver||"Add driver"}</button>)}</div>{draft.slots.filter((slot,i)=>slot.id===(selectedKart||draft.slots[0]?.id)).map(slot=>{const linked=karts.find(k=>k.name===slot.number&&racers.some(r=>r.id===k.racer_id&&r.name===slot.driver));return <KartSetup key={slot.id} driver={slot.driver} kart={slot.number} className={slot.className} trackId={draft.trackId} kartId={linked?.id} racerId={linked?.racer_id??undefined}/>;})}</section>}
    {activeTab==="timekeeper" && <section className={styles.operatorArea}><div className={styles.heading}><div><h1>Timekeeper</h1><p>MYLAPS / Race Monitor · read-only trackside timing</p></div></div><div className={styles.timingPanel}><h2>Rivali Uploader Live Timing</h2><p>The existing Timekeeper is a separate Windows receiver. It must connect to the scoring operator authorized RMonitor feed. No live connection is represented here until that receiver is connected.</p><div className={styles.demoControls}><button type="button" onClick={()=>{setDemoTiming(v=>!v);setDemoLap(0);}}>{demoTiming?"Stop Demo":"Run Demo"}</button><strong>{demoTiming?"SIMULATED DATA · DEMO MODE":"Connection status: Not linked to web Uploader"}</strong></div>
 {demoTiming&&<div className={styles.demoTimingTable}><h3>Practice 1 · Demonstration only</h3><table><thead><tr><th>Pos</th><th>Kart</th><th>Driver</th><th>Laps</th><th>Best</th><th>Status</th></tr></thead><tbody>{[["145","Demo Driver A","12.110"],["22","Demo Driver B","12.296"],["88","Demo Driver C","12.341"],["7","Demo Driver D","12.415"],["11","Demo Driver E","12.488"]].map((v,i)=><tr key={v[0]}><td>{i+1}</td><td>{v[0]}</td><td>{v[1]}</td><td>{Math.max(0,demoLap-i)}</td><td>{v[2]}</td><td>Simulated</td></tr>)}</tbody></table><p>This is fabricated demonstration data and is never saved as official race timing.</p></div>}<p>On this laptop, open <code>Documents\rivali-app\rivali-direct-download\timing_listener\START_RIVALI_TIMING.bat</code> to launch the receiver. Use Demo only for simulated testing. Obtain the scoring operator permission before connecting to a live feed.</p><p>Live leaderboards and timing data will appear here only after a verified receiver-to-Uploader connection is built.</p></div></section>}
    {["admin","reports"].includes(activeTab) && <section className={styles.operatorArea}>
      <div className={styles.heading}><div><h1>{activeTab==="admin"?"Race Day Admin":"Reports"}</h1><p>Rivali Uploader workspace. No links to the old Rivali app.</p></div><button type="button" className={styles.trackLink} onClick={()=>void refreshSessions()}>Refresh status</button></div>
      {activeTab==="admin" && <div className={styles.adminOverview}>
        <h2>Session processing and report approvals</h2>
        <p>Review completed sessions before reports are delivered. Job status updates automatically.</p>
        {liveSessions.length===0?<p>No sessions found.</p>:liveSessions.map(item=><div key={item.id} className={styles.sessionRow}>
          <div><strong>{item.racers?.name??"Unassigned driver"}</strong> · {item.karts?.name??"Kart"} · {item.tracks?.name??"Track"}<small>{item.raw_file_name}</small></div>
          <strong>{item.status}</strong><span>{item.report_status??"Awaiting report review"}</span>
          <button type="button" onClick={()=>{setActiveTab("reports");void inspectReport(item.id);}}>Review</button>
        </div>)}
      </div>}
      {activeTab==="reports" && <div className={styles.adminOverview}>
        <h2>Imported XRK reports</h2>
        {liveSessions.length===0?<p>No reports yet.</p>:liveSessions.map(item=><div key={item.id} className={styles.sessionRow}>
          <div><strong>{item.racers?.name??"Unassigned driver"}</strong> · {item.tracks?.name??"Track"}<small>{item.raw_file_name}</small></div>
          <span>{item.status}</span><span>{item.lap_count??0} laps · best {item.best_lap_sec?.toFixed(3)??"Not established"}s</span>
          <button type="button" disabled={item.status!=="completed"} onClick={()=>void inspectReport(item.id)}>View analysis</button>
        </div>)}
        {selectedReport && <div className={styles.reportDetail}><h3>Session analysis</h3>
          {reportError?<p>{reportError}</p>:!reportTelemetry?<p>Loading session telemetry...</p>:<>
            <p><strong>Lap records:</strong> {Array.isArray(reportTelemetry.laps)?reportTelemetry.laps.length:"Unavailable"}</p>
            <p><strong>Recorded channels:</strong> {Array.isArray(reportTelemetry.channel_manifest)?reportTelemetry.channel_manifest.join(", "):"Not recorded"}</p>
            <p><strong>Analysis diagnostic:</strong> {String((reportTelemetry.corner_analysis as Record<string,unknown>|undefined)?.diagnostic??"No verified corner interpretation available")}</p>
            <p><strong>Sector assignments:</strong> {String(((reportTelemetry.corner_analysis as Record<string,unknown>|undefined)?.sector_assignments as Record<string,unknown>|undefined)?.status??"Not evaluated")}</p>
            {(()=>{const report=reportTelemetry.report_analysis as Record<string,unknown>|undefined;
              const interpretation=report?.interpretation as Record<string,unknown>|undefined;
              const facts=report?.facts as Record<string,unknown>|undefined;
              return interpretation?<div style={{padding:"14px",border:"1px solid #53624b",borderRadius:10}}>
                <h3>Rivali interpretation · {String(report?.tier??"standard").replaceAll("_"," ")}</h3>
                <p><strong>Confidence:</strong> {String(report?.confidence??"Low")}</p>
                {([["Summary","summary"],["What the data says","what_data_says"],["What it means","what_it_means"],["Possible causes","possible_causes"],["Confidence reasoning","confidence_reason"],["What to try","what_to_try"],["How to verify","how_to_verify"]] as const).map(([label,key])=>interpretation[key]?<p key={key}><strong>{label}:</strong> {String(interpretation[key])}</p>:null)}
                <p><small>Timing: {String(facts?.lap_timing_diagnostic??"Unverified")} · Track: {String(facts?.corner_mapping_diagnostic??"Unverified")}</small></p>
                <p>Original AiM report remains separate; Rivali does not substitute for Race Studio.</p>
                <a href={`/race-day/uploader/report/${selectedReport}`} target="_blank" rel="noopener noreferrer" style={{color:"#e6f34c"}}>Open printable Rivali report</a>
              </div>:<p>No Rivali interpreted report saved yet. Generate a draft below.</p>;
            })()}
            <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:14}}>
              <button type="button" disabled={generatingReport} onClick={()=>void generateReport(selectedReport,"standard")}>Generate Standard draft</button>
              <button type="button" disabled={generatingReport} onClick={()=>void generateReport(selectedReport,"crew_chief")}>Generate Crew Chief draft</button>
              {liveSessions.find(s=>s.id===selectedReport)?.report_status==="pending_approval"&&
                <button type="button" disabled={approvingReport||generatingReport} onClick={()=>void approveReport(selectedReport)}>Approve interpreted report</button>}
            </div>
            <p>Drafts remain private until operator approval. Payment is not required.</p>
          </>}
        </div>}
      </div>}
    </section>}
    {activeTab==="race" && <>
      <div className={styles.heading}><div><h1>Race Day</h1><p>Upload MyChron XRK data, track processing and manage your karts.</p></div><div className={styles.headingActions}><button type="button" className={styles.trackLink} onClick={()=>setShowMapper(v=>!v)}><MapPinned size={17}/>{showMapper?"Hide Track Editor":"Track Editor"}</button><button type="button" className={styles.newSession} onClick={add}><Plus size={17}/> New Kart</button></div></div>
      <section className={styles.setup}>
        <label>Track<select value={draft.trackId} onChange={e=>setDraft(d=>({...d,trackId:e.target.value}))}><option value="">Select track</option>{currentTracks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Race date<input type="date" value={draft.eventDate} onChange={e=>setDraft(d=>({...d,eventDate:e.target.value}))}/></label>
        {chosenTrack && <div className={styles.trackStatus}><strong>{chosenTrack.name} selected</strong><span>{mapReady?"Track map ready for XRK analysis":"Track saved; mapping incomplete for analysis"}</span><small>Start/Finish: {chosenTrack.start_finish?.length??0} points · Turns: {turnNames.length}/4 · Groove: {Array.isArray(groove)?groove.length:0} points</small><button type="button" className={styles.mapInline} onClick={()=>setShowMapper(true)}>Edit this track below</button></div>}
        <div className={styles.setupNote}><Flag size={16}/> Pre-race entries save in this browser. Uploads are linked directly to your Rivali account, track, driver, and kart. No pass code needed.</div>
      </section>
      {showMapper && <section className={styles.mapperPanel}>
        <div className={styles.mapperHeading}><div><h2>Track Mapper</h2><p>Map the selected track here without leaving Rivali Uploader.</p></div><button type="button" onClick={()=>setShowMapper(false)}>Close mapper</button></div>
        <TrackMapEditor tracks={currentTracks} sessions={sessions.filter(s=>s.tracks?.id===draft.trackId)} selectedTrackId={draft.trackId} onTrackUpdated={updated=>setCurrentTracks(list=>list.map(t=>t.id===updated.id?updated:t))}/>
      </section>}
      <div className={styles.sectionHeader}><div><h2>My Karts</h2><span>{draft.slots.length} / 5 active</span></div><button disabled={draft.slots.length>=5} onClick={add}><Plus size={18}/> Add Kart</button></div>
      <div className={styles.grid}>{draft.slots.map((slot,i)=><article className={styles.card} key={slot.id}>
        <div className={styles.cardTop}><div className={styles.cardName}><span className={styles.number}>{i+1}</span><b>Kart {slot.number||i+1}</b></div><span className={slot.status==="queued"?styles.success:slot.status==="error"?styles.error:styles.wait}>{slot.status==="uploading"?"Uploading":slot.status==="queued"?"Queued":slot.status==="error"?"Needs attention":"Waiting"}</span><button className={styles.remove} title="Remove kart" onClick={()=>remove(slot.id)}><Trash2 size={17}/></button></div>
        <div className={styles.loaded}><label>Saved driver<select value="" onChange={e=>chooseRacer(slot.id,e.target.value)}><option value="">Choose existing driver</option>{racers.map(r=><option key={r.id} value={r.id}>{r.name}{r.primary_class? " · "+r.primary_class:""}</option>)}</select></label><label>Saved kart<select value="" onChange={e=>chooseKart(slot.id,e.target.value)}><option value="">Choose existing kart</option>{karts.map(k=><option key={k.id} value={k.id}>{k.name}{k.chassis_make?" · "+k.chassis_make:""}</option>)}</select></label></div>
        <div className={styles.fields}><label>Driver<input value={slot.driver} onChange={e=>change(slot.id,{driver:e.target.value})} placeholder="Driver name"/></label><label>Kart #<input value={slot.number} onChange={e=>change(slot.id,{number:e.target.value})} placeholder="145"/></label><label>Class<input value={slot.className} onChange={e=>change(slot.id,{className:e.target.value})} placeholder="Animal Medium"/></label></div>
        <div className={styles.fieldsTwo}><label>Run type<select value={slot.sessionType} onChange={e=>change(slot.id,{sessionType:e.target.value})}>{["practice","hot laps","heat","feature"].map(t=><option key={t} value={t}>{t}</option>)}</select></label></div>
        <label className={styles.drop}><UploadCloud size={26}/><strong>{slot.fileName || "Choose XRK file"}</strong><span>{slot.fileName?"Click to replace":"MyChron / Race Studio .xrk Â· max 100 MB"}</span><input type="file" accept=".xrk" onChange={e=>onFile(slot.id,e)}/></label>
        <button className={styles.kartSetupButton} type="button" onClick={()=>{setSelectedKart(slot.id);setActiveTab("setup");}}>Configure Kart Setup</button>
        <button className={styles.upload} disabled={slot.status==="uploading"} onClick={()=>void upload(slot)}><UploadCloud size={18}/>{slot.status==="uploading"?"Uploading...":"Upload & Analyze"}</button>
        <div className={styles.status}><span>{slot.status==="queued"?<CheckCircle2 size={16}/>:slot.status==="error"?<AlertCircle size={16}/>:<ClipboardCheck size={16}/>}</span><p>{slot.sessionId?(liveSessions.find(item=>item.id===slot.sessionId)?.status==="completed"?"Analysis completed. Open Reports to view results.":liveSessions.find(item=>item.id===slot.sessionId)?.status==="failed"?"Processing failed. Open Race Day Admin for details.":slot.message):slot.message || "Waiting for telemetry. Select an XRK file to upload to your Rivali account."}</p></div>
        {slot.sessionId&&<small className={styles.session}>Session: {slot.sessionId}</small>}
      </article>)}</div>
      <div className={styles.workflow}><span>1 · PREPARE KART</span><span>2 · UPLOAD XRK</span><span>3 · ANALYZE</span><span>4 · REVIEW REPORT</span><span>5 · APPROVE & DELIVER</span></div>
      <footer className={styles.footer}><span>Rivali RaceDay Â· 1â€“5 independent kart workflows</span><span>Trackside uploader · GPS analysis is confidence-gated.</span></footer>
    </>}
    </div>
    <DougLiveVoice trackId={draft.trackId} karts={draft.slots.map(s=>({id:s.id,number:s.number,driver:s.driver,className:s.className}))} onSelectKart={id=>{setSelectedKart(id);setActiveTab("setup");}} context={["Track: "+(chosenTrack?.name??"not selected"),"Karts: "+draft.slots.map(x=>[x.number,x.driver,x.className].filter(Boolean).join("/")).join("; "),"Latest sessions: "+liveSessions.slice(0,4).map(x=>x.raw_file_name+" status "+x.status).join("; ")].join("\n")}/>
  </main>;
}

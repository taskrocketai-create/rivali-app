import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request:Request) {
  const supabase=await createClient();
  const {data:auth}=await supabase.auth.getClaims();
  const userId=auth?.claims?.sub;
  if(!userId)return NextResponse.json({error:"Sign in to upload."},{status:401});
  const f=await request.formData();
  const driver=String(f.get("driver")??"").trim(), kartNumber=String(f.get("kartNumber")??"").trim(), className=String(f.get("className")??"").trim();
  const trackId=String(f.get("trackId")??""),date=String(f.get("eventDate")??""),sessionType=String(f.get("sessionType")??"practice");
  const file=f.get("file");
  if(!driver||!kartNumber||!className||!trackId||!/^\d{4}-\d{2}-\d{2}$/.test(date))return NextResponse.json({error:"Complete track, date, driver, kart number and class."},{status:400});
  if(!["practice","hot laps","heat","feature"].includes(sessionType))return NextResponse.json({error:"Invalid session type."},{status:400});
  if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".xrk")||!file.size||file.size>100*1024*1024)return NextResponse.json({error:"Choose an XRK file under 100 MB."},{status:400});
  const admin=supabase;
  const {data:track}=await admin.from("tracks").select("id,start_finish,turns").eq("id",trackId).eq("user_id",userId).maybeSingle();
  if(!track)return NextResponse.json({error:"Track was not found for your account."},{status:404});
  const turns=(track.turns??{}) as Record<string,unknown>;
  const count=Object.keys(turns).filter(k=>/^[1-4]$/.test(k)).length;
  const groove=(turns._rivali as {groove?:unknown[]} | undefined)?.groove;
  const mapReady=Array.isArray(track.start_finish)&&track.start_finish.length>=2&&count===4&&Array.isArray(groove)&&groove.length>=2;
  let {data:racer}=await admin.from("racers").select("id").eq("user_id",userId).eq("name",driver).maybeSingle();
  if(!racer){const q=await admin.from("racers").insert({user_id:userId,name:driver,primary_class:className}).select("id").single();if(q.error||!q.data)return NextResponse.json({error:q.error?.message??"Driver save failed."},{status:500});racer=q.data;}
  let {data:kart}=await admin.from("karts").select("id").eq("user_id",userId).eq("racer_id",racer.id).eq("name",kartNumber).maybeSingle();
  if(!kart){const q=await admin.from("karts").insert({user_id:userId,racer_id:racer.id,name:kartNumber}).select("id").single();if(q.error||!q.data)return NextResponse.json({error:q.error?.message??"Kart save failed."},{status:500});kart=q.data;}
  const {data:baseline}=await admin.from("kart_setup_baselines").select("id,setup,submitted_at")
    .eq("user_id",userId).eq("kart_id",kart.id).eq("status","approved")
    .order("submitted_at",{ascending:false}).limit(1).maybeSingle();
  const id=crypto.randomUUID(),safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_"),path=`${userId}/${id}/${safe}`;
  const {error:uploadError}=await admin.storage.from("telemetry").upload(path,file,{contentType:"application/octet-stream",upsert:false});
  if(uploadError)return NextResponse.json({error:uploadError.message},{status:500});
  const {error:sessionError}=await admin.from("sessions").insert({id,user_id:userId,racer_id:racer.id,kart_id:kart.id,track_id:trackId,session_date:date,session_type:sessionType,raw_file_name:file.name,raw_storage_path:path,setup:{...(baseline?.setup??{}),class_name:className,kart_number:kartNumber,source:"raceday_operator",track_mapping_ready:mapReady,setup_baseline_id:baseline?.id??null,setup_reference_type:baseline?"latest_approved_baseline_unverified_for_run":"none"},conditions:{},handling_feedback:{},status:"queued",report_status:"processing"});
  if(sessionError){await admin.storage.from("telemetry").remove([path]);return NextResponse.json({error:sessionError.message},{status:500});}
  const {error:jobError}=await admin.from("processing_jobs").insert({user_id:userId,session_id:id,status:"queued"});
  if(jobError){await admin.from("sessions").delete().eq("id",id);await admin.storage.from("telemetry").remove([path]);return NextResponse.json({error:jobError.message},{status:500});}
  return NextResponse.json({ok:true,sessionId:id,message:mapReady?"XRK uploaded and analysis queued.":"XRK accepted. Track mapping incomplete; any corner-specific analysis will have limited confidence.",trackMappingReady:mapReady});
}

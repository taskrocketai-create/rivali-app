"""Rivali asynchronous .xrk processor. Run as one worker instance."""
import argparse
import math
import os
import socket
import tempfile
import time
import shutil
from datetime import datetime, timezone
from dataclasses import asdict
import requests

from daq_tools.readers import XRKReader
from supabase import create_client
from engine.mapped_track_analysis import analyze_mapped_track
from engine.session_summary import summarize_session, summary_from_gps_laps
from engine.xrk_raw_samples import extract_samples, rpm_lap_summaries, align_rpm_to_laps
from engine.xrk_channel_inventory import inventory_file
from engine.lateral_grip import compare_lateral_grip
from engine.gps_laps import reconstruct_lap_times
from engine.turn_proposal import propose_turn_segments
from engine.knowledge_selection import select_knowledge
from engine.video_knowledge import distill_transcript, extract_audio_chunks, transcribe_chunks

GPS_LAT_NAMES=("GPS Latitude","GPS Lat","Latitude","Lat","GPS_Latitude")
GPS_LON_NAMES=("GPS Longitude","GPS Long","GPS Lon","Longitude","Lon","GPS_Longitude")
GPS_SPEED_NAMES=("GPS Speed","GPS_Speed","Speed GPS")

def plain(series):
    if hasattr(series,"pint"):
        try:return series.pint.magnitude
        except Exception:pass
    if hasattr(series,"array") and hasattr(series.array,"quantity"):return series.array.quantity.magnitude
    return series

def find_column(data,names):
    lookup={str(column).strip().lower():column for column in data.columns}
    return next((lookup[name.lower()] for name in names if name.lower() in lookup),None)

def gps_trace(data,maximum=5000):
    lat_name,lon_name,speed_name=find_column(data,GPS_LAT_NAMES),find_column(data,GPS_LON_NAMES),find_column(data,GPS_SPEED_NAMES)
    if lat_name is None or lon_name is None:return []
    rows=[]
    speeds=plain(data[speed_name]) if speed_name is not None else [None]*len(data)
    for when,lat_raw,lon_raw,speed_raw in zip(data.index,plain(data[lat_name]),plain(data[lon_name]),speeds):
        try:lat,lon,when=float(lat_raw),float(lon_raw),float(when)
        except (TypeError,ValueError):continue
        if all(math.isfinite(value) for value in (lat,lon,when)) and -90<=lat<=90 and -180<=lon<=180 and (lat or lon):
            point={"lat":lat,"lng":lon,"time":when}
            try:
                speed_kmh=float(speed_raw)
                if math.isfinite(speed_kmh) and speed_kmh>=0:point["speed_mph"]=round(speed_kmh*0.621371,2)
            except (TypeError,ValueError):pass
            rows.append(point)
    if len(rows)>maximum:rows=rows[::math.ceil(len(rows)/maximum)]
    return rows

def condition_match(left, right):
    left, right = left or {}, right or {}
    if left.get("track_condition") and right.get("track_condition") and left["track_condition"] != right["track_condition"]:
        return False
    for key, tolerance in (("air_temp_f", 15), ("humidity_pct", 20)):
        if left.get(key) is not None and right.get(key) is not None and abs(float(left[key]) - float(right[key])) > tolerance:
            return False
    return True

def save_grounded_recommendation(client, session_id, owner_id):
    current = client.table("sessions").select("id,racer_id,kart_id,track_id,session_date,best_lap_sec,setup,conditions").eq("id", session_id).single().execute().data
    history = client.table("sessions").select("id,session_date,best_lap_sec,setup,conditions").eq("racer_id", current["racer_id"]).eq("track_id", current["track_id"]).eq("status", "completed").neq("id", session_id).limit(50).execute().data or []
    matches = [row for row in history if row.get("best_lap_sec") is not None and condition_match(current.get("conditions"), row.get("conditions"))]
    if not matches:
        text = "Use this session as the first condition-matched baseline. Keep changes small and log the next run before assigning the lap result to any one setup adjustment."
        confidence, evidence = "low", [{"session_id": session_id, "role": "new_baseline"}]
    else:
        reference = min(matches, key=lambda row: float(row["best_lap_sec"]))
        delta = float(current["best_lap_sec"]) - float(reference["best_lap_sec"])
        changed = []
        for key in sorted(set((current.get("setup") or {})) | set((reference.get("setup") or {}))):
            now, before = (current.get("setup") or {}).get(key), (reference.get("setup") or {}).get(key)
            if now is not None and before is not None and now != before:
                changed.append(f"{key.replace('_', ' ')} ({before} → {now})")
        differences = ", ".join(changed[:4]) or "no recorded setup fields"
        if delta <= 0:
            text = f"Keep this setup as the working baseline for these conditions. It matched or beat the fastest comparable archived run by {abs(delta):.3f}s. Confirm it with another run before making a larger change."
        else:
            text = f"Use the {reference['session_date']} run as the comparison baseline; it was {delta:.3f}s faster in similar recorded conditions. The main logged differences were {differences}. Test one difference at a time rather than treating correlation as proof."
        confidence = "high" if len(matches) >= 3 else "medium"
        evidence = [{"session_id": session_id, "role": "current", "best_lap_sec": current["best_lap_sec"]}, {"session_id": reference["id"], "role": "condition_matched_reference", "best_lap_sec": reference["best_lap_sec"]}, {"matched_session_count": len(matches)}]
    # Knowledge is globally curated by the Rivali administrator. The worker's
    # server credential reads active items; racer accounts cannot edit them.
    knowledge = client.table("knowledge_items").select("id,title,body,source_url,evidence_level,confidence,track_id,kart_id,class_name,status,retrieval_weight,verification_status,review_metadata").eq("status", "active").order("retrieval_weight", desc=True).limit(1000).execute().data or []
    kart = client.table("karts").select("chassis_make,chassis_model,tire_brand,tire_compound").eq("id", current["kart_id"]).single().execute().data or {}
    track = client.table("tracks").select("surface_type").eq("id", current["track_id"]).single().execute().data or {}
    knowledge_session = {**current, "conditions": {**(current.get("conditions") or {}), "surface_type": track.get("surface_type")}}
    applicable = select_knowledge(knowledge, knowledge_session, kart)
    if applicable:
        selected = applicable[:3]
        text += " Knowledge to review before changing the kart: " + "; ".join(item["title"] for item in selected) + "."
        evidence.extend({"knowledge_item_id": item["id"], "title": item["title"], "source_url": item.get("source_url"), "evidence_level": item["evidence_level"], "confidence": item["confidence"], "retrieval_weight": item.get("retrieval_weight"), "verification_status": item.get("verification_status"), "review_metadata": item.get("review_metadata")} for item in selected)
    setup = current.get("setup") or {}
    driving_style = setup.get("driving_style")
    if driving_style == "full_throttle_brake_drag":
        text += " Driver reports full throttle with brake drag through the corner. Do not treat throttle pickup timing by itself as a fault; prioritize minimum RPM, total RPM drop, RPM recovery, speed loss, and whether the available data supports changing the amount of brake drag."
        evidence.append({"driving_style": driving_style, "interpretation_rule": "preserve_engine_momentum_before_judging_throttle_pickup"})
    elif driving_style == "burp_throttle":
        text += " Driver reports burping the throttle through the corner. Interpret throttle timing against RPM drop, recovery, and lap outcome rather than assuming a later pickup is automatically worse."
        evidence.append({"driving_style": driving_style, "interpretation_rule": "evaluate_burp_against_rpm_and_lap_outcome"})
    elif driving_style == "lift":
        text += " Driver reports lifting through the corner. Compare lift duration and resulting RPM loss with the better laps before suggesting a technique change."
        evidence.append({"driving_style": driving_style, "interpretation_rule": "evaluate_lift_against_rpm_loss_and_lap_outcome"})
    elif driving_style:
        text += " Driving style is marked as variable or other. Avoid making a throttle-technique claim unless the telemetry and driver debrief agree."
        evidence.append({"driving_style": driving_style, "interpretation_rule": "no_assumed_throttle_model"})
    if setup.get("dirty_tire_rule") and setup.get("tire_locked"):
        tire_set = setup.get("tire_set_id") or "the committed tire set"
        text += f" Dirty Tire lock is active for {tire_set}: do not recommend tire changes; use class-legal chassis adjustments only."
        evidence.append({
            "rule": "dirty_tire_lock",
            "tire_set_id": setup.get("tire_set_id"),
            "tire_adjustments_allowed": False,
            "chassis_adjustments_allowed": True,
        })
    client.table("recommendations").upsert({"user_id": owner_id, "session_id": session_id, "recommendation": text, "confidence": confidence, "evidence": evidence}, on_conflict="session_id").execute()

def process_one(client,job_id_override=None):
    print(f"worker={socket.gethostname()} pid={os.getpid()} version=timing-fallback-v2 attempting claim",flush=True)
    response=(client.rpc("claim_reserved_processing_job",{"p_job_id":job_id_override}).execute() if job_id_override is not None else client.rpc("claim_processing_job").execute())
    if not response.data:
        print("no processing job claimed",flush=True)
        return False
    job=response.data[0];job_id,session_id,owner_id=job["job_id"],job["session_id"],job["user_id"];path=None
    print(f"claimed job={job_id} session={session_id} worker={socket.gethostname()} pid={os.getpid()} version=timing-fallback-v2",flush=True)
    try:
        payload=client.storage.from_("telemetry").download(job["raw_storage_path"])
        with tempfile.NamedTemporaryFile(suffix=".xrk",delete=False) as handle:path=handle.name;handle.write(payload)
        summary=summarize_session(path);_header,data=XRKReader.read(path,header_only=False)
        session=client.table("sessions").select("track_id,race_day_pass_id").eq("id",session_id).single().execute().data
        track=client.table("tracks").select("start_finish,turns").eq("id",session["track_id"]).single().execute().data
        timing_source=("raw_xrk_rs3_verified" if any("RS3 lap numbering validated" in warning for warning in summary.warnings) else "raw_xrk_packet_fallback" if any("raw XRK packets" in warning for warning in summary.warnings) else "aim_lap_table");timing_diagnostic=("Lap numbers checked against five RS3 screenshot reference times; raw status flags remain unvalidated." if timing_source=="raw_xrk_rs3_verified" else "Lap times recovered from XRK LAP packets; RS3 numbering and status flags require validation." if timing_source=="raw_xrk_packet_fallback" else "Lap times read from the XRK lap table.")
        if not summary.laps:
            gps_times,timing_diagnostic=reconstruct_lap_times(data,track.get("start_finish"),race_arrow=((track.get("turns") or {}).get("_rivali") or {}).get("race_arrow"))
            summary=summary_from_gps_laps(summary,gps_times,timing_diagnostic)
            timing_source="gps_start_finish" if gps_times else "unavailable"
        try:
            mapped=analyze_mapped_track(data,track)
        except RuntimeError as mapping_error:
            if "Track mapping incomplete" not in str(mapping_error):
                raise
            mapped={"analysis_ready":False,"diagnostic":str(mapping_error)}
        proposal = None
        if not mapped.get("analysis_ready"):
            try:
                proposal = propose_turn_segments(data, track)
            except (ValueError, TypeError, KeyError) as error:
                proposal = {"status":"unavailable","reason":f"GPS turn proposal could not be calculated: {error}"}
            # A missing or unvalidated track map must not erase verified lap timing.
            # Store a neutral, timing-only result; do not infer corners or handling.
            mapped={"analysis_ready":False,"diagnostic":mapped.get("diagnostic") or "Track mapping is not validated.",
                    "turns":[],"corner_pairs":[],"groove":None,"alignment":None}
        # Do not pass proposals through as completed/approved corner analysis.
        if proposal is not None:
            mapped["turn_proposal"] = proposal
        raw_channels = extract_samples(path)
        channel_inventory = inventory_file(path)
        rpm_indexes = [c['index'] for c in channel_inventory['channels'] if c['name'].strip().upper() == 'RPM']
        raw_rpm = raw_channels.get(rpm_indexes[0], []) if len(rpm_indexes) == 1 else []
        grip_indexes = [c['index'] for c in channel_inventory['channels'] if c['name'].strip().lower() in ('lateral grip', 'lat gri')]
        grip_diagnostic = {'status': 'unavailable', 'reason': 'No unique Lateral Grip channel or GPS lateral acceleration'}
        gps_latacc_column = find_column(data, ('GPS LatAcc',))
        if len(grip_indexes) == 1 and gps_latacc_column is not None:
            grip_diagnostic = compare_lateral_grip(raw_channels.get(grip_indexes[0], []), data.index, plain(data[gps_latacc_column]))
        for channel in channel_inventory["channels"]:
            channel["raw_record_count"] = len(raw_channels.get(channel["index"], []))
            channel["raw_decode_status"] = "provisional_uncalibrated" if channel["raw_record_count"] else "no_raw_records_found"
        channel_inventory["note"] = "XRK channel definitions are not proof of samples. Raw counts are provisional until record framing and engineering-unit calibration are validated."
        rpm_by_lap = []
        if raw_rpm and summary.laps:
            try:
                rpm_by_lap = align_rpm_to_laps(rpm_lap_summaries(path, raw_rpm), summary.laps)
            except ValueError as rpm_lap_error:
                print(f"RPM lap alignment unavailable: {rpm_lap_error}", flush=True)
        telemetry={"session_id":session_id,"user_id":owner_id,"laps":[asdict(lap) for lap in summary.laps],"gps_trace":gps_trace(data),"corner_analysis":{"turn_proposal":mapped.get("turn_proposal"),"diagnostic":mapped.get("diagnostic"),"turns":mapped.get("turns"),"corner_pairs":mapped.get("corner_pairs"),"groove":mapped.get("groove"),"alignment":mapped.get("alignment"),"lap_timing":{"source":timing_source,"diagnostic":timing_diagnostic},"channel_inventory":channel_inventory,"lateral_grip_validation":grip_diagnostic,"rpm_by_lap":rpm_by_lap,"rpm_summary":{"source":"raw_xrk_sample","sample_count":len(raw_rpm),"min_rpm":min(v for _,v in raw_rpm),"max_rpm":max(v for _,v in raw_rpm),"validation":"pending_rs3_curve_comparison"} if raw_rpm else None},"channel_manifest":[str(column) for column in data.columns]+(["RPM"] if raw_rpm else [])}
        client.table("session_telemetry").upsert(telemetry).execute()
        session_update={"status":"completed","parse_error":None,"lap_count":summary.lap_count,"best_lap_sec":summary.best_lap_sec,"average_lap_sec":summary.average_lap_sec,"consistency_stdev_sec":summary.consistency_stdev_sec}
        client.table("sessions").update(session_update).eq("id",session_id).execute()
        try:
            if mapped.get("analysis_ready") and timing_source == "aim_lap_table":
                save_grounded_recommendation(client, session_id, owner_id)
        except Exception as recommendation_error:
            print(f"recommendation skipped for {session_id}: {recommendation_error}", flush=True)
        if session.get("race_day_pass_id"):
            client.table("sessions").update({"report_status":"pending_approval"}).eq("id",session_id).execute()
        client.table("processing_jobs").update({"status":"completed","error":None}).eq("id",job_id).execute();print(f"completed session {session_id}",flush=True)
    except Exception as exc:
        message=str(exc)[:2000];client.table("sessions").update({"status":"failed","parse_error":message}).eq("id",session_id).execute();client.table("processing_jobs").update({"status":"failed","error":message}).eq("id",job_id).execute();print(f"failed session {session_id}: {message}",flush=True)
    finally:
        if path and os.path.exists(path):os.unlink(path)
    return True

def process_knowledge_video(client):
    rows = client.table("knowledge_upload_jobs").select("*").eq("status", "queued").order("created_at").limit(1).execute().data or []
    if not rows:
        return False
    job = rows[0]
    job_id = job["id"]
    workspace = tempfile.mkdtemp(prefix="rivali-knowledge-")
    source_path = os.path.join(workspace, "source-video")
    now = lambda: datetime.now(timezone.utc).isoformat()
    try:
        client.table("knowledge_upload_jobs").update({"status": "transcribing", "started_at": now(), "error": None}).eq("id", job_id).eq("status", "queued").execute()
        signed = client.storage.from_("knowledge-video-intake").create_signed_url(job["storage_path"], 3600)
        signed_url = signed.get("signedURL") or signed.get("signedUrl")
        if not signed_url:
            raise RuntimeError("Could not create a temporary download link for this video.")
        with requests.get(signed_url, stream=True, timeout=(20, 300)) as response:
            response.raise_for_status()
            with open(source_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
        audio_paths = extract_audio_chunks(source_path, workspace)
        transcript = transcribe_chunks(audio_paths)
        client.table("knowledge_upload_jobs").update({"status": "extracting"}).eq("id", job_id).execute()
        points = distill_transcript(transcript)
        rows_to_insert = []
        for point in points:
            category = point["category"]
            rows_to_insert.append({
                "user_id": job["uploader_id"],
                "title": point["title"],
                "body": point["body"],
                "source_type": "uploaded_video",
                "source_name": job["original_filename"],
                "source_platform": job.get("source_platform"),
                "source_upload_id": job_id,
                "knowledge_category": category,
                "confidence_note": point["confidence_note"],
                "evidence_level": "opinion" if category == "disputed_or_opinion" else "anecdotal",
                "confidence": "low" if category in ("specific_numeric_recommendation", "disputed_or_opinion") else "medium",
                # Video claims are searchable immediately but never silently promoted to vetted facts.
                "status": "disputed" if category == "disputed_or_opinion" else "draft",
                "tags": ["uploaded-video", category.replace("_", "-")],
            })
        if rows_to_insert:
            client.table("knowledge_items").insert(rows_to_insert).execute()
        client.storage.from_("knowledge-video-intake").remove([job["storage_path"]])
        client.table("knowledge_upload_jobs").update({
            "status": "completed", "knowledge_points_added": len(rows_to_insert),
            "completed_at": now(), "error": None,
        }).eq("id", job_id).execute()
        print(f"completed knowledge upload {job_id}: {len(rows_to_insert)} points", flush=True)
    except Exception as exc:
        message = str(exc)[:2000]
        client.table("knowledge_upload_jobs").update({"status": "failed", "error": message, "completed_at": now()}).eq("id", job_id).execute()
        print(f"failed knowledge upload {job_id}: {message}", flush=True)
    finally:
        # Transcript and extracted audio exist only inside this temporary directory.
        shutil.rmtree(workspace, ignore_errors=True)
    return True

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--once",action="store_true");parser.add_argument("--job-id",type=int);parser.add_argument("--interval",type=int,default=8);args=parser.parse_args();url,secret=os.environ.get("SUPABASE_URL"),os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret:raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    client=create_client(url,secret)
    print(f"Rivali worker startup host={socket.gethostname()} pid={os.getpid()} version=timing-fallback-v2",flush=True)
    while True:
        found=process_one(client,args.job_id) if args.once else (process_knowledge_video(client) or process_one(client))
        if args.once:break
        if not found:time.sleep(args.interval)
if __name__=="__main__":main()

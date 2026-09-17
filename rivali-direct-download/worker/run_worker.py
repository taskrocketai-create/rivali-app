"""Rivali asynchronous .xrk processor. Run as one worker instance."""
import argparse
import math
import os
import tempfile
import time
from dataclasses import asdict

from daq_tools.readers import XRKReader
from supabase import create_client
from engine.corner_analysis import segment_oval, summarize_by_turn
from engine.session_summary import summarize_session

GPS_LAT_NAMES=("GPS Latitude","GPS Lat","Latitude","Lat","GPS_Latitude")
GPS_LON_NAMES=("GPS Longitude","GPS Long","GPS Lon","Longitude","Lon","GPS_Longitude")

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
    lat_name,lon_name=find_column(data,GPS_LAT_NAMES),find_column(data,GPS_LON_NAMES)
    if lat_name is None or lon_name is None:return []
    rows=[]
    for when,lat_raw,lon_raw in zip(data.index,plain(data[lat_name]),plain(data[lon_name])):
        try:lat,lon,when=float(lat_raw),float(lon_raw),float(when)
        except (TypeError,ValueError):continue
        if all(math.isfinite(value) for value in (lat,lon,when)) and -90<=lat<=90 and -180<=lon<=180 and (lat or lon):rows.append({"lat":lat,"lng":lon,"time":when})
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
    knowledge = client.table("knowledge_items").select("id,title,evidence_level,confidence,track_id,kart_id").eq("status", "active").order("updated_at", desc=True).limit(200).execute().data or []
    applicable = [item for item in knowledge if (item.get("track_id") is None or item.get("track_id") == current["track_id"]) and (item.get("kart_id") is None or item.get("kart_id") == current["kart_id"])]
    applicable.sort(key=lambda item: (item.get("track_id") is None, item.get("kart_id") is None, item.get("confidence") != "high"))
    if applicable:
        selected = applicable[:3]
        text += " Knowledge to review before changing the kart: " + "; ".join(item["title"] for item in selected) + "."
        evidence.extend({"knowledge_item_id": item["id"], "title": item["title"], "evidence_level": item["evidence_level"], "confidence": item["confidence"]} for item in selected)
    setup = current.get("setup") or {}
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

def process_one(client):
    response=client.rpc("claim_processing_job").execute()
    if not response.data:return False
    job=response.data[0];job_id,session_id,owner_id=job["job_id"],job["session_id"],job["user_id"];path=None
    try:
        payload=client.storage.from_("telemetry").download(job["raw_storage_path"])
        with tempfile.NamedTemporaryFile(suffix=".xrk",delete=False) as handle:path=handle.name;handle.write(payload)
        summary=summarize_session(path);_header,data=XRKReader.read(path,header_only=False);oval=segment_oval(data)
        telemetry={"session_id":session_id,"user_id":owner_id,"laps":[asdict(lap) for lap in summary.laps],"gps_trace":gps_trace(data),"corner_analysis":{"diagnostic":oval.get("note"),"turns":summarize_by_turn(oval)},"channel_manifest":[str(column) for column in data.columns]}
        client.table("session_telemetry").upsert(telemetry).execute()
        client.table("sessions").update({"status":"completed","parse_error":None,"lap_count":summary.lap_count,"best_lap_sec":summary.best_lap_sec,"average_lap_sec":summary.average_lap_sec,"consistency_stdev_sec":summary.consistency_stdev_sec}).eq("id",session_id).execute()
        try:
            save_grounded_recommendation(client, session_id, owner_id)
        except Exception as recommendation_error:
            print(f"recommendation skipped for {session_id}: {recommendation_error}", flush=True)
        client.table("processing_jobs").update({"status":"completed","error":None}).eq("id",job_id).execute();print(f"completed session {session_id}",flush=True)
    except Exception as exc:
        message=str(exc)[:2000];client.table("sessions").update({"status":"failed","parse_error":message}).eq("id",session_id).execute();client.table("processing_jobs").update({"status":"failed","error":message}).eq("id",job_id).execute();print(f"failed session {session_id}: {message}",flush=True)
    finally:
        if path and os.path.exists(path):os.unlink(path)
    return True

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--once",action="store_true");parser.add_argument("--interval",type=int,default=8);args=parser.parse_args();url,secret=os.environ.get("SUPABASE_URL"),os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret:raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    client=create_client(url,secret)
    while True:
        found=process_one(client)
        if args.once:break
        if not found:time.sleep(args.interval)
if __name__=="__main__":main()

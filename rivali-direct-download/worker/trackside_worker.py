"""Rivali trackside worker.

Adds the V1 report engine on top of the existing XRK processing pipeline while
reusing the established upload, parsing, GPS reconstruction, knowledge and
recommendation helpers from run_worker.py.
"""

import argparse
import os
import tempfile
import time
from dataclasses import asdict

from daq_tools.readers import XRKReader
from supabase import create_client

from engine.corner_analysis import segment_oval, summarize_by_turn
from engine.gps_laps import reconstruct_lap_times
from engine.report_engine import build_report_analysis
from engine.session_summary import summarize_session, summary_from_gps_laps
from run_worker import gps_trace, process_knowledge_video, save_grounded_recommendation


def process_one(client):
    response = client.rpc("claim_processing_job").execute()
    if not response.data:
        return False

    job = response.data[0]
    job_id = job["job_id"]
    session_id = job["session_id"]
    owner_id = job["user_id"]
    path = None

    try:
        session = (
            client.table("sessions")
            .select("id,track_id,setup,conditions")
            .eq("id", session_id)
            .single()
            .execute()
            .data
        )
        latest_debrief_rows = (
            client.table("voice_debriefs")
            .select("transcript,status,created_at")
            .eq("session_id", session_id)
            .eq("status", "completed")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
        driver_debrief = latest_debrief_rows[0].get("transcript") if latest_debrief_rows else None

        payload = client.storage.from_("telemetry").download(job["raw_storage_path"])
        with tempfile.NamedTemporaryFile(suffix=".xrk", delete=False) as handle:
            path = handle.name
            handle.write(payload)

        summary = summarize_session(path)
        _header, data = XRKReader.read(path, header_only=False)
        timing_source = "aim_lap_table"
        timing_diagnostic = "Lap times read from the XRK lap table."

        if not summary.laps:
            track = (
                client.table("tracks")
                .select("start_finish")
                .eq("id", session["track_id"])
                .single()
                .execute()
                .data
            )
            gps_times, timing_diagnostic = reconstruct_lap_times(data, track.get("start_finish"))
            summary = summary_from_gps_laps(summary, gps_times, timing_diagnostic)
            timing_source = "gps_start_finish" if gps_times else "unavailable"

        oval = segment_oval(data)
        turn_summary = summarize_by_turn(oval)
        channel_manifest = [str(column) for column in data.columns]
        corner_analysis = {
            "diagnostic": oval.get("note"),
            "turns": turn_summary,
            "lap_timing": {
                "source": timing_source,
                "diagnostic": timing_diagnostic,
            },
        }

        report_analysis = build_report_analysis(
            summary=summary,
            channel_manifest=channel_manifest,
            corner_analysis=corner_analysis,
            setup=session.get("setup") or {},
            conditions=session.get("conditions") or {},
            driver_debrief=driver_debrief,
        )

        telemetry = {
            "session_id": session_id,
            "user_id": owner_id,
            "laps": [asdict(lap) for lap in summary.laps],
            "gps_trace": gps_trace(data),
            "corner_analysis": corner_analysis,
            "channel_manifest": channel_manifest,
            "report_analysis": report_analysis,
        }
        client.table("session_telemetry").upsert(telemetry).execute()

        client.table("sessions").update(
            {
                "status": "completed",
                "parse_error": None,
                "lap_count": summary.lap_count,
                "best_lap_sec": summary.best_lap_sec,
                "average_lap_sec": summary.average_lap_sec,
                "consistency_stdev_sec": summary.consistency_stdev_sec,
            }
        ).eq("id", session_id).execute()

        try:
            save_grounded_recommendation(client, session_id, owner_id)
        except Exception as recommendation_error:
            print(
                f"recommendation skipped for {session_id}: {recommendation_error}",
                flush=True,
            )

        client.table("processing_jobs").update(
            {"status": "completed", "error": None}
        ).eq("id", job_id).execute()
        print(
            f"completed session {session_id}; report mode={report_analysis['publish_mode']} "
            f"confidence={report_analysis['interpretation_confidence']['score']}",
            flush=True,
        )
    except Exception as exc:
        message = str(exc)[:2000]
        client.table("sessions").update(
            {"status": "failed", "parse_error": message}
        ).eq("id", session_id).execute()
        client.table("processing_jobs").update(
            {"status": "failed", "error": message}
        ).eq("id", job_id).execute()
        print(f"failed session {session_id}: {message}", flush=True)
    finally:
        if path and os.path.exists(path):
            os.unlink(path)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=8)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    secret = os.environ.get("SUPABASE_SECRET_KEY")
    if not url or not secret:
        raise SystemExit("SUPABASE_URL and SUPABASE_SECRET_KEY are required")

    client = create_client(url, secret)
    while True:
        found = process_knowledge_video(client) or process_one(client)
        if args.once:
            break
        if not found:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()

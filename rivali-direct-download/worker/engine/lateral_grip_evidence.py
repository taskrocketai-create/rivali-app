"""Align raw AiM Lateral Grip values to laps for evidence-based analysis.

Lateral Grip is an AiM index [#], not verified acceleration in g.
Knowledge-base interpretation belongs downstream, after this objective layer.
"""
import statistics
from pathlib import Path
from .xrk_lap_decoder import decode_laps
from .xrk_raw_samples import extract_lateral_grip


def lateral_grip_lap_evidence(path):
    """Produce timestamp-aligned telemetry evidence for the report pipeline."""
    laps = decode_laps(Path(path).read_bytes())
    samples = extract_lateral_grip(path)
    result = []
    for lap in laps:
        end = lap["end_timestamp_ms"]
        start = end - round(lap["duration_seconds"] * 1000)
        points = [(t, v) for t, v in samples if start <= t < end]
        if not points:
            result.append({"lap_ordinal": lap["record_ordinal"],
                           "status": "no_samples", "unit": "[#]"})
            continue
        values = [v for _, v in points]
        result.append({
            "lap_ordinal": lap["record_ordinal"],
            "duration_seconds": lap["duration_seconds"],
            "start_ms": start, "end_ms": end,
            "channel": "Lateral Grip", "unit": "[#]",
            "sample_count": len(points),
            "min": round(min(values), 3),
            "max": round(max(values), 3),
            "mean": round(statistics.mean(values), 3),
            "trace": [[t - start, round(v, 3)] for t, v in points],
            "validation": "Recorded index; physical G-force not verified",
        })
    return result


def attach_knowledge_sources(telemetry, knowledge_items):
    """Add only active, corroborated or primary KB evidence to downstream payload.

    This function does not infer a setup change. A separate reasoning stage
    must reference source IDs and distinguish measured findings from hypotheses.
    """
    approved = [
        {"id": item["id"], "title": item["title"],
         "source_name": item.get("source_name"),
         "verification_status": item["verification_status"],
         "body": item["body"]}
        for item in knowledge_items
        if item.get("status") == "active"
        and item.get("verification_status") in ("corroborated", "primary_only")
        and all(k in item for k in ("id", "title", "body"))
    ]
    return {"telemetry": telemetry, "knowledge_sources": approved,
            "recommendations": [],
            "analysis_status": "awaiting_source_grounded_interpretation"}

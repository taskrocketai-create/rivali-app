"""Rank competitive laps without mistaking every slow lap for a caution.

Timing-only screening is deliberately conservative. This module does not
assert official flag status, infer driver fault, or invent sensor evidence.
"""
from __future__ import annotations
import math
import statistics


def compare_competitive_laps(laps, *, max_fast_laps=5, confirmed_caution_numbers=()):
    """Return a JSON-safe top-five vs slower-laps comparison.

    laps: mappings or objects with lap_number and lap_time_sec.
    Explicitly confirmed caution laps are excluded. Extreme outliers are
    marked *suspected interruptions* rather than falsely called cautions.
    A 0.2-second fluctuation remains eligible for normal analysis.
    """
    confirmed = set(confirmed_caution_numbers)
    valid = []
    excluded = []
    for lap in laps:
        number = lap.get("lap_number") if isinstance(lap, dict) else getattr(lap, "lap_number", None)
        raw_time = lap.get("lap_time_sec") if isinstance(lap, dict) else getattr(lap, "lap_time_sec", None)
        try:
            seconds = float(raw_time)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(seconds) or seconds <= 0:
            continue
        record = {"lap_number": number, "lap_time_sec": round(seconds, 3)}
        if number in confirmed:
            excluded.append({**record, "reason": "confirmed_caution"})
        else:
            valid.append(record)

    if not valid:
        return {"status": "insufficient_data", "fast_laps": [], "slower_laps": [],
                "excluded_laps": excluded, "comparison": None,
                "caution_detection": "Official flag status cannot be determined from lap time alone."}

    # The best three laps anchor plausible racing pace. An isolated outlier
    # slower by >30% and at least 1.5 seconds is set aside, never silently
    # labelled an official caution. This is a heuristic, not event truth.
    baseline = statistics.median(sorted(x["lap_time_sec"] for x in valid)[:3])
    eligible = []
    for record in valid:
        delta = record["lap_time_sec"] - baseline
        if delta >= max(1.5, baseline * 0.30):
            excluded.append({**record, "reason": "suspected_interruption",
                             "requires_confirmation": True})
        else:
            eligible.append(record)

    ranked = sorted(eligible, key=lambda item: (item["lap_time_sec"], str(item["lap_number"])))
    fastest = ranked[:max_fast_laps]
    slower = ranked[max_fast_laps:]
    fast_values = [x["lap_time_sec"] for x in fastest]
    slower_values = [x["lap_time_sec"] for x in slower]
    comparison = None
    if fast_values:
        comparison = {
            "fast_group_count": len(fastest),
            "slower_group_count": len(slower),
            "fast_average_sec": round(statistics.mean(fast_values), 3),
            "fast_range_sec": round(max(fast_values) - min(fast_values), 3),
            "fast_stdev_sec": round(statistics.pstdev(fast_values), 3),
            "slower_average_sec": round(statistics.mean(slower_values), 3) if slower else None,
            "slower_stdev_sec": round(statistics.pstdev(slower_values), 3) if slower else None,
            "group_delta_sec": round(statistics.mean(slower_values) - statistics.mean(fast_values), 3) if slower else None,
        }
    return {
        "status": "ready" if slower else "fast_laps_only",
        "fast_laps": fastest,
        "slower_laps": slower,
        "excluded_laps": sorted(excluded, key=lambda item: str(item["lap_number"])),
        "comparison": comparison,
        "caution_detection": "Timing outliers are suspected interruptions, not verified cautions.",
        "interpretation_limit": (
            "Lap-time differences alone cannot distinguish driving, traffic, "
            "track evolution or chassis behavior. Corner and sensor attribution "
            "requires synchronized, calibrated telemetry."
        ),
    }

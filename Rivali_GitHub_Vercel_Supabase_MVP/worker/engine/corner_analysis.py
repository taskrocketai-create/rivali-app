"""
Rivali — corner_analysis.py

Oval-specific version. Unlike a road course (unknown/variable number of
corners, needing clustering to figure out identity), an oval has a
FIXED, guaranteed-repeating structure every single lap:

    front stretch -> Turn 1 -> Turn 2 -> back stretch -> Turn 3 -> Turn 4 -> (repeat)

On most short ovals, Turns 1&2 are actually ONE continuous banked curve
(no straight in between) — "Turn 1" and "Turn 2" are the entry half and
exit half of that same curve, split at the corner's apex (point of
minimum speed). Same for Turns 3&4 at the other end. This means GPS
Radius detection will typically find exactly TWO corner regions per
lap, not four — and this module splits each region in half at its apex
to produce the four named turns.

Because the sequence is fixed and always repeats in the same order,
identity assignment is simple and reliable: the FIRST corner region
detected after the start/finish is Turns 1&2, the SECOND is Turns 3&4.
This is much more robust than the generic road-course approach (no
clustering, no physical-position guessing needed) — PROVIDED each lap
consistently detects exactly 2 regions. Mismatches are flagged rather
than silently mislabeled.

Uses GPS Radius + GPS Speed, both available on any GPS-equipped MyChron
(5, 5S, or 6) — no IMU required.

HONEST STATUS: the core region-detection logic (radius threshold,
contiguous-run grouping, apex-split) is the same tested approach used
successfully on a real road-course .xrk file. The "exactly 2 regions
per lap" oval assumption itself has NOT yet been validated against a
real oval session — the only real file available so far was a road
course with ~14 corners, which doesn't test this code path. Validating
this against a real oval .xrk file is the next concrete step.
"""

from dataclasses import dataclass
from typing import Optional

KMH_TO_MPH = 0.621371


def _kmh_to_mph(value_kmh: float) -> float:
    return value_kmh * KMH_TO_MPH


@dataclass
class TurnResult:
    turn_number: int  # 1, 2, 3, or 4
    lap_estimate: int  # 1-indexed, based on sequential pairing of regions
    entry_speed_mph: float
    exit_speed_mph: float
    min_radius_m: float
    duration_sec: float
    max_lateral_g: Optional[float] = None  # peak sideways force in this
        # half-corner — not just how fast the kart went through, but how
        # hard it was actually working to do it
    lateral_g_sign_consistent: Optional[bool] = None  # False = the sign
        # flipped within this segment, which shouldn't happen in a single
        # continuous turn on an oval — a real signal that the GPS fix or
        # segmentation was noisy here, worth distrusting this instance


@dataclass
class StretchResult:
    name: str  # "front_stretch" or "back_stretch"
    lap_estimate: int
    entry_speed_mph: float  # speed coming off the previous turn
    exit_speed_mph: float   # speed heading into the next turn
    max_speed_mph: float    # top speed reached on this stretch
    duration_sec: float


def _to_plain(series):
    """
    Strip pint units from a daq_tools column, returning plain float
    values. Uses .pint.magnitude first (works on most files), but falls
    back to .array.quantity.magnitude if that fails — confirmed via a
    real uploaded file where .pint.magnitude raised an AttributeError
    despite the column genuinely being pint-typed (a pint-pandas
    accessor quirk, not a data problem). The fallback goes around the
    accessor entirely and reads the underlying PintArray directly.
    """
    if hasattr(series, "pint"):
        try:
            return series.pint.magnitude
        except Exception:
            pass
    if hasattr(series, "array") and hasattr(series.array, "quantity"):
        import pandas as pd
        return pd.Series(series.array.quantity.magnitude, index=series.index)
    return series


def _detect_raw_regions(data, radius_threshold_m: float, min_duration_sec: float,
                          merge_gap_sec: float = 1.5):
    """
    Low-level, track-shape-agnostic detection of contiguous "in a
    corner" regions (radius below threshold). Returns a list of dicts
    with start/end index labels and the region's speed/radius/lateral-G
    series. Does NOT assign any identity — that's oval-specific and done
    by the caller.

    merge_gap_sec: consecutive detected regions separated by less than
    this many seconds get merged into one. Found via real data that GPS
    radius can flicker right around the threshold near a corner apex,
    fragmenting one real corner into several tiny adjacent detections
    (confirmed on a real file: multiple ~0.3-0.9s "regions" only 1-1.5s
    apart, which is far too fast to be separate corners). A real oval
    corner doesn't have the kart popping in and out of it within a
    second or two.
    """
    radius = _to_plain(data["GPS Radius"])
    speed = _to_plain(data["GPS Speed"])
    times = data.index.to_numpy()
    has_latacc = "GPS LatAcc" in data.columns
    latacc = _to_plain(data["GPS LatAcc"]) if has_latacc else None

    in_corner = radius < radius_threshold_m
    run_id = (in_corner != in_corner.shift(fill_value=in_corner.iloc[0])).cumsum()

    raw_groups = []
    for _, group_idx in in_corner.groupby(run_id).groups.items():
        if not in_corner.loc[group_idx].iloc[0]:
            continue
        seg_times = times[data.index.get_indexer(group_idx)]
        duration = float(seg_times[-1] - seg_times[0])
        if duration < min_duration_sec:
            continue
        raw_groups.append({
            "start_time": float(seg_times[0]),
            "end_time": float(seg_times[-1]),
            "group_idx": list(group_idx),
        })

    # Merge consecutive groups separated by a short gap
    merged_groups = []
    for g in raw_groups:
        if merged_groups and (g["start_time"] - merged_groups[-1]["end_time"]) <= merge_gap_sec:
            merged_groups[-1]["end_time"] = g["end_time"]
            merged_groups[-1]["group_idx"].extend(g["group_idx"])
        else:
            merged_groups.append(g)

    regions = []
    for g in merged_groups:
        group_idx = g["group_idx"]
        duration = g["end_time"] - g["start_time"]
        regions.append({
            "start_time": g["start_time"],
            "end_time": g["end_time"],
            "duration": duration,
            "speed": speed.loc[group_idx],
            "radius": radius.loc[group_idx],
            "latacc": latacc.loc[group_idx] if has_latacc else None,
            "group_idx": group_idx,
        })
    return regions, speed, times


def segment_oval(
    data,
    radius_threshold_m: float = 30.0,
    min_corner_duration_sec: float = 0.3,
) -> dict:
    """
    Segment an oval-track session into Turn 1/2/3/4 and front/back
    stretch, using the fixed oval sequence assumption.

    radius_threshold_m default (30m) is a rough starting point for a
    SMALL dirt oval kart track — much tighter than the 100m default that
    made sense for the road-course file this was originally validated
    against. This has NOT been calibrated against a real dirt oval
    session yet and should be tuned once one is available.

    Returns a dict with turns, stretches, and a diagnostic note about
    how many regions-per-lap were actually detected (should be exactly
    2 for a clean result — anything else means some laps had a missed
    or spurious detection).
    """
    if "GPS Radius" not in data.columns or "GPS Speed" not in data.columns:
        return {
            "turns": [], "stretches": [], "regions_per_lap_detected": None,
            "note": "This session's data doesn't include GPS Radius/Speed — "
                    "oval corner analysis requires GPS trace logging enabled.",
        }

    regions, speed, times = _detect_raw_regions(data, radius_threshold_m, min_corner_duration_sec)

    if not regions:
        return {"turns": [], "stretches": [], "regions_per_lap_detected": 0,
                "note": "No corner regions detected — radius_threshold_m may be "
                        "too low for this track/data, or GPS Radius data is missing/invalid."}

    n = len(regions)
    clean_pairing = (n % 2 == 0)

    turns = []
    stretches = []

    for i, region in enumerate(regions):
        lap_estimate = (i // 2) + 1
        is_first_of_pair = (i % 2 == 0)
        turn_pair = (1, 2) if is_first_of_pair else (3, 4)

        seg_speed = region["speed"]
        seg_radius = region["radius"]
        seg_latacc = region["latacc"]
        apex_local_idx = seg_speed.idxmin()
        apex_speed = float(seg_speed.min())

        entry_half = seg_speed.loc[:apex_local_idx]
        exit_half = seg_speed.loc[apex_local_idx:]

        entry_duration = region["duration"] * (len(entry_half) / len(seg_speed)) if len(seg_speed) else 0
        exit_duration = region["duration"] - entry_duration

        entry_max_g, entry_g_consistent = None, None
        exit_max_g, exit_g_consistent = None, None
        if seg_latacc is not None:
            latacc_entry = seg_latacc.loc[:apex_local_idx]
            latacc_exit = seg_latacc.loc[apex_local_idx:]
            if len(latacc_entry):
                entry_max_g = float(latacc_entry.abs().max())
                entry_g_consistent = bool((latacc_entry > 0).all() or (latacc_entry < 0).all())
            if len(latacc_exit):
                exit_max_g = float(latacc_exit.abs().max())
                exit_g_consistent = bool((latacc_exit > 0).all() or (latacc_exit < 0).all())

        turns.append(TurnResult(
            turn_number=turn_pair[0],
            lap_estimate=lap_estimate,
            entry_speed_mph=_kmh_to_mph(float(entry_half.iloc[0])),
            exit_speed_mph=_kmh_to_mph(apex_speed),
            min_radius_m=float(seg_radius.min()),
            duration_sec=entry_duration,
            max_lateral_g=entry_max_g,
            lateral_g_sign_consistent=entry_g_consistent,
        ))
        turns.append(TurnResult(
            turn_number=turn_pair[1],
            lap_estimate=lap_estimate,
            entry_speed_mph=_kmh_to_mph(apex_speed),
            exit_speed_mph=_kmh_to_mph(float(exit_half.iloc[-1])),
            min_radius_m=float(seg_radius.min()),
            duration_sec=exit_duration,
            max_lateral_g=exit_max_g,
            lateral_g_sign_consistent=exit_g_consistent,
        ))

        # Straight between this region's end and the NEXT region's start
        if i + 1 < len(regions):
            next_region = regions[i + 1]
            gap_mask = (times > region["end_time"]) & (times < next_region["start_time"])
            if gap_mask.any():
                gap_speed = speed.loc[gap_mask] if hasattr(speed, "loc") else speed[gap_mask]
                stretch_name = "back_stretch" if is_first_of_pair else "front_stretch"
                stretches.append(StretchResult(
                    name=stretch_name,
                    lap_estimate=lap_estimate,
                    entry_speed_mph=_kmh_to_mph(float(exit_half.iloc[-1])),
                    exit_speed_mph=_kmh_to_mph(float(gap_speed.iloc[-1]) if len(gap_speed) else float(exit_half.iloc[-1])),
                    max_speed_mph=_kmh_to_mph(float(gap_speed.max()) if len(gap_speed) else float(exit_half.iloc[-1])),
                    duration_sec=float(next_region["start_time"] - region["end_time"]),
                ))

    note = (
        f"Detected {n} corner regions -> paired sequentially into "
        f"{n // 2} laps' worth of Turn 1/2/3/4 sets."
    )
    if not clean_pairing:
        note += (
            f" WARNING: {n} is an ODD number of regions — pairing broke down "
            "somewhere (a missed or spurious detection), so turn/lap labels "
            "past that point are likely misaligned. Treat results with caution "
            "and consider adjusting radius_threshold_m or min_corner_duration_sec."
        )

    return {
        "turns": turns,
        "stretches": stretches,
        "regions_per_lap_detected": 2 if clean_pairing else None,
        "clean_pairing": clean_pairing,
        "note": note,
    }


def summarize_by_turn(oval_result: dict) -> dict:
    """Group turn instances by turn_number (1-4) and summarize consistency."""
    turns = oval_result.get("turns", [])
    by_number = {}
    for t in turns:
        by_number.setdefault(t.turn_number, []).append(t)

    summary = {}
    for num in sorted(by_number.keys()):
        instances = by_number[num]
        entry = [t.entry_speed_mph for t in instances]
        exit_ = [t.exit_speed_mph for t in instances]
        entry_dict = {
            "instances": len(instances),
            "entry_speed_mph": {"min": min(entry), "max": max(entry), "avg": sum(entry) / len(entry)},
            "exit_speed_mph": {"min": min(exit_), "max": max(exit_), "avg": sum(exit_) / len(exit_)},
        }

        max_gs = [t.max_lateral_g for t in instances if t.max_lateral_g is not None]
        if max_gs:
            entry_dict["max_lateral_g"] = {
                "min": min(max_gs), "max": max(max_gs), "avg": sum(max_gs) / len(max_gs)
            }
            inconsistent_count = sum(1 for t in instances if t.lateral_g_sign_consistent is False)
            if inconsistent_count:
                entry_dict["sign_inconsistent_instances"] = inconsistent_count
                entry_dict["data_quality_note"] = (
                    f"{inconsistent_count} of {len(instances)} instance(s) showed a "
                    "lateral-G sign flip within a single turn — shouldn't happen in "
                    "one continuous corner on an oval, likely noisy GPS at that moment. "
                    "Worth treating those specific instances with extra skepticism."
                )

        summary[f"turn_{num}"] = entry_dict
    return summary


if __name__ == "__main__":
    import sys
    import json

    if len(sys.argv) != 2:
        print("Usage: python corner_analysis.py path/to/session.xrk")
        sys.exit(1)

    from daq_tools.readers import XRKReader

    header, data = XRKReader.read(sys.argv[1], header_only=False)
    result = segment_oval(data)
    print(result["note"])
    print()
    print(json.dumps(summarize_by_turn(result), indent=2))

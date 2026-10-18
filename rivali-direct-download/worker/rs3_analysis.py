"""Evidence-first RS3-style telemetry analysis primitives.

Inputs must be measured, distance-aligned channels. This module never infers
missing RPM, GPS positions, steering, throttle, or chassis setup.
"""
from __future__ import annotations
from collections import Counter
from math import floor, isfinite, sqrt
from statistics import mean, pstdev


def finite_pairs(x, y):
    return [(float(a), float(b)) for a, b in zip(x, y)
            if a is not None and b is not None
            and isfinite(float(a)) and isfinite(float(b))]


def histogram(values, bins=20):
    """Counts with explicit edges, including the rightmost sample."""
    clean = [float(v) for v in values if v is not None and isfinite(float(v))]
    if not clean:
        return {"edges": [], "counts": [], "unit": "samples"}
    if bins < 1:
        raise ValueError("bins must be positive")
    lo, hi = min(clean), max(clean)
    if lo == hi:
        return {"edges": [lo, hi], "counts": [len(clean)], "unit": "samples"}
    width = (hi - lo) / bins
    counts = [0] * bins
    for v in clean:
        counts[min(bins - 1, floor((v - lo) / width))] += 1
    return {"edges": [lo + i * width for i in range(bins + 1)],
            "counts": counts, "unit": "samples"}


def scatter(x, y, max_points=2000):
    pairs = finite_pairs(x, y)
    if max_points < 2:
        raise ValueError("max_points must be >= 2")
    stride = max(1, (len(pairs) + max_points - 1) // max_points)
    return [{"x": a, "y": b} for a, b in pairs[::stride]]


def lap_statistics(laps):
    """Keep lap numbering as supplied; never silently renumber."""
    valid = [(int(l["lap_number"]), float(l["lap_time_sec"]))
             for l in laps if l.get("lap_time_sec") is not None
             and 3 <= float(l["lap_time_sec"]) <= 180]
    if not valid:
        return {"count": 0, "best": None, "mean": None, "stdev": None}
    durations = [t for _, t in valid]
    number, best = min(valid, key=lambda item: item[1])
    return {"count": len(valid), "best": {"lap_number": number, "seconds": best},
            "mean": mean(durations), "stdev": pstdev(durations)}


def interpolate(distance, values, target):
    pairs = sorted(finite_pairs(distance, values))
    if not pairs or target < pairs[0][0] or target > pairs[-1][0]:
        return None
    for i in range(1, len(pairs)):
        x0, y0 = pairs[i - 1]
        x1, y1 = pairs[i]
        if x0 <= target <= x1 and x1 != x0:
            return y0 + (y1 - y0) * (target - x0) / (x1 - x0)
    return pairs[0][1] if target == pairs[0][0] else None


def distance_overlay(laps, channel, step_m=2.0):
    """Interpolate only measured values, never extrapolate outside a lap."""
    if step_m <= 0:
        raise ValueError("step_m must be positive")
    prepared = []
    for lap in laps:
        dist, vals = lap.get("distance_m", []), lap.get(channel, [])
        pairs = finite_pairs(dist, vals)
        if len(pairs) >= 2:
            prepared.append((lap["lap_number"], [p[0] for p in pairs],
                             [p[1] for p in pairs]))
    if not prepared:
        return {"distance_m": [], "laps": [], "diagnostic": f"No measured {channel} channel"}
    max_common = min(max(dist) for _, dist, _ in prepared)
    grid = [round(i * step_m, 6) for i in range(floor(max_common / step_m) + 1)]
    return {"distance_m": grid,
            "laps": [{"lap_number": number,
                      "values": [interpolate(dist, vals, d) for d in grid]}
                     for number, dist, vals in prepared],
            "diagnostic": None}


def time_delta(distance_m, speed_a_mps, speed_b_mps):
    """Integrate dt=ds/v for aligned measured speed; positive means A slower.
    Reject stops/invalid speeds instead of generating false time gains.
    """
    if not (len(distance_m) == len(speed_a_mps) == len(speed_b_mps)):
        raise ValueError("arrays must have matching lengths")
    result = [0.0]
    for i in range(1, len(distance_m)):
        ds = float(distance_m[i]) - float(distance_m[i - 1])
        va0, va1 = float(speed_a_mps[i - 1]), float(speed_a_mps[i])
        vb0, vb1 = float(speed_b_mps[i - 1]), float(speed_b_mps[i])
        if ds <= 0 or min(va0, va1, vb0, vb1) <= 0:
            raise ValueError("distance must increase and speed must be positive")
        result.append(result[-1] + ds * (0.5 / va0 + 0.5 / va1 -
                                         0.5 / vb0 - 0.5 / vb1))
    return result


def evidence_assessment(channels, track_mapped=False, rs3_laps_validated=False):
    names = {str(x).lower().strip() for x in channels}
    def has(name):
        return name.lower() in names
    return {
        "lap_timing": "validated" if rs3_laps_validated else "provisional",
        "track_sectors": "available" if track_mapped else "blocked_track_mapping",
        "speed_analysis": "available" if has("gps speed") else "missing_channel",
        "rpm_analysis": "available" if has("rpm") else "missing_channel",
        "driver_vs_setup": "insufficient_evidence",
        "recommendation_policy": "Do not prescribe chassis, gearing, or driver changes "
                                 "without corroborated channel evidence and knowledge citations.",
    }

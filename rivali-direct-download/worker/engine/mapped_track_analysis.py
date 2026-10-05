"""Mapped-track telemetry analysis for Rivali.

Uses saved track geometry (turn centers/radii + preferred groove) to label GPS
samples before any driving/setup interpretation is made.
"""
import math

KMH_TO_MPH = 0.621371
GPS_LAT_NAMES = ("GPS Latitude", "GPS Lat", "Latitude", "Lat", "GPS_Latitude")
GPS_LON_NAMES = ("GPS Longitude", "GPS Long", "GPS Lon", "Longitude", "Lon", "GPS_Longitude")
GPS_SPEED_NAMES = ("GPS Speed", "GPS_Speed", "Speed GPS")
GPS_LATACC_NAMES = ("GPS LatAcc", "GPS Lateral Acc", "Lateral G", "GPS Lateral G")


def _plain(series):
    if hasattr(series, "pint"):
        try:
            return series.pint.magnitude
        except Exception:
            pass
    if hasattr(series, "array") and hasattr(series.array, "quantity"):
        return series.array.quantity.magnitude
    return series


def _find_column(data, names):
    lookup = {str(column).strip().lower(): column for column in data.columns}
    return next((lookup[name.lower()] for name in names if name.lower() in lookup), None)


def _distance_m(a, b):
    lat_mid = math.radians((a["lat"] + b["lat"]) / 2.0)
    north = (a["lat"] - b["lat"]) * 111320.0
    east = (a["lng"] - b["lng"]) * 111320.0 * math.cos(lat_mid)
    return math.hypot(north, east)


def _nearest_distance(point, references):
    if not references:
        return None
    return min(_distance_m(point, ref) for ref in references)


def _average(values):
    return sum(values) / len(values) if values else None


def _stats(values):
    clean = [value for value in values if value is not None and math.isfinite(value)]
    if not clean:
        return None
    return {"min": min(clean), "max": max(clean), "avg": _average(clean)}


def analyze_mapped_track(data, track):
    """Analyze GPS samples against the user's saved track map.

    Returns a JSON-safe dict containing mapped turn summaries, groove deviation,
    and an alignment confidence score. If required geometry or GPS channels are
    missing, ``analysis_ready`` is False and no generic oval fallback is used.
    """
    turns_blob = track.get("turns") or {}
    numeric_turns = {str(n): turns_blob.get(str(n)) for n in range(1, 5)}
    metadata = turns_blob.get("_rivali") or {}
    groove = metadata.get("groove") or []
    start_finish = track.get("start_finish") or []

    missing = []
    if len(start_finish) < 2:
        missing.append("start_finish")
    if any(not numeric_turns[str(n)] for n in range(1, 5)):
        missing.append("turns_1_4")
    if len(groove) < 2:
        missing.append("preferred_groove")
    if missing:
        return {
            "analysis_ready": False,
            "diagnostic": "Track mapping incomplete: " + ", ".join(missing),
            "alignment": {"confidence": "low", "score": 0, "reason": "Required track geometry is missing."},
            "turns": {},
            "groove": {},
        }

    lat_name = _find_column(data, GPS_LAT_NAMES)
    lon_name = _find_column(data, GPS_LON_NAMES)
    speed_name = _find_column(data, GPS_SPEED_NAMES)
    latacc_name = _find_column(data, GPS_LATACC_NAMES)
    if lat_name is None or lon_name is None:
        return {
            "analysis_ready": False,
            "diagnostic": "GPS latitude/longitude channels are missing; mapped analysis cannot run.",
            "alignment": {"confidence": "low", "score": 0, "reason": "GPS position channels are missing."},
            "turns": {},
            "groove": {},
        }

    latitudes = _plain(data[lat_name])
    longitudes = _plain(data[lon_name])
    speeds = _plain(data[speed_name]) if speed_name is not None else [None] * len(data)
    latacc = _plain(data[latacc_name]) if latacc_name is not None else [None] * len(data)

    points = []
    for when, lat_raw, lon_raw, speed_raw, latacc_raw in zip(data.index, latitudes, longitudes, speeds, latacc):
        try:
            lat, lng, timestamp = float(lat_raw), float(lon_raw), float(when)
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(value) for value in (lat, lng, timestamp)):
            continue
        if not (-90 <= lat <= 90 and -180 <= lng <= 180) or (lat == 0 and lng == 0):
            continue
        point = {"lat": lat, "lng": lng, "time": timestamp, "speed_mph": None, "lateral_g": None}
        try:
            value = float(speed_raw)
            if math.isfinite(value) and value >= 0:
                point["speed_mph"] = value * KMH_TO_MPH
        except (TypeError, ValueError):
            pass
        try:
            value = float(latacc_raw)
            if math.isfinite(value):
                point["lateral_g"] = value
        except (TypeError, ValueError):
            pass
        points.append(point)

    if len(points) < 10:
        return {
            "analysis_ready": False,
            "diagnostic": "Too few valid GPS samples for mapped track analysis.",
            "alignment": {"confidence": "low", "score": 0, "reason": "Too few valid GPS samples."},
            "turns": {},
            "groove": {},
        }

    groove_refs = [{"lat": float(p["lat"]), "lng": float(p["lng"])} for p in groove if p.get("lat") is not None and p.get("lng") is not None]
    turn_refs = {}
    for number, marker in numeric_turns.items():
        turn_refs[number] = {
            "lat": float(marker["lat"]),
            "lng": float(marker["lng"]),
            "radius_m": max(3.0, float(marker.get("radius_m") or 18.0)),
        }

    groove_distances = []
    mapped_turn_samples = {str(n): [] for n in range(1, 5)}
    points_near_track = 0
    max_turn_radius = max(marker["radius_m"] for marker in turn_refs.values())
    near_track_threshold = max(25.0, min(80.0, max_turn_radius * 2.0))

    for point in points:
        groove_distance = _nearest_distance(point, groove_refs)
        if groove_distance is not None:
            groove_distances.append(groove_distance)
            if groove_distance <= near_track_threshold:
                points_near_track += 1
        candidates = []
        for number, marker in turn_refs.items():
            distance = _distance_m(point, marker)
            if distance <= marker["radius_m"]:
                candidates.append((distance, number))
        if candidates:
            _, number = min(candidates)
            mapped_turn_samples[number].append(point)

    coverage = points_near_track / len(points) if points else 0.0
    median_groove_distance = None
    if groove_distances:
        ordered = sorted(groove_distances)
        median_groove_distance = ordered[len(ordered) // 2]
    turn_coverage = sum(1 for samples in mapped_turn_samples.values() if len(samples) >= 3) / 4.0
    alignment_score = round(max(0.0, min(100.0, (coverage * 70.0) + (turn_coverage * 30.0))))
    confidence = "high" if alignment_score >= 80 else "medium" if alignment_score >= 55 else "low"

    turn_summary = {}
    for number, samples in mapped_turn_samples.items():
        if not samples:
            continue
        speed_values = [sample["speed_mph"] for sample in samples if sample["speed_mph"] is not None]
        lateral_values = [abs(sample["lateral_g"]) for sample in samples if sample["lateral_g"] is not None]
        speed_stats = _stats(speed_values)
        turn_summary[f"turn_{number}"] = {
            "mapped_samples": len(samples),
            "speed_mph": speed_stats,
            "entry_speed_mph": speed_stats,
            "exit_speed_mph": speed_stats,
            "max_lateral_g": _stats(lateral_values),
            "zone_radius_m": turn_refs[number]["radius_m"],
            "source": "saved_track_geometry",
        }

    pair_summary = {}
    for pair_name, numbers in (("t1_t2", ("1", "2")), ("t3_t4", ("3", "4"))):
        samples = mapped_turn_samples[numbers[0]] + mapped_turn_samples[numbers[1]]
        speed_values = [sample["speed_mph"] for sample in samples if sample["speed_mph"] is not None]
        if speed_values:
            pair_summary[pair_name] = {
                "minimum_speed_mph": min(speed_values),
                "average_speed_mph": _average(speed_values),
                "mapped_samples": len(samples),
            }

    return {
        "analysis_ready": True,
        "diagnostic": f"Mapped {len(points)} GPS samples against saved Start/Finish, Turns 1-4, and preferred groove.",
        "alignment": {
            "confidence": confidence,
            "score": alignment_score,
            "track_coverage_pct": round(coverage * 100.0, 1),
            "turn_zone_coverage_pct": round(turn_coverage * 100.0, 1),
            "median_groove_distance_m": round(median_groove_distance, 2) if median_groove_distance is not None else None,
            "reason": "Score combines GPS proximity to the saved groove and coverage of all four mapped turn zones.",
        },
        "turns": turn_summary,
        "corner_pairs": pair_summary,
        "groove": {
            "median_deviation_m": round(median_groove_distance, 2) if median_groove_distance is not None else None,
            "samples_within_reference_band_pct": round(coverage * 100.0, 1),
            "reference_band_m": near_track_threshold,
        },
    }

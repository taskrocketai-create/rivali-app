"""Deterministic trackside report engine for the $40 Rivali report.

This module intentionally separates:
1) measured facts,
2) interpretation,
3) likely contributors,
4) common areas to inspect.

It refuses to produce cause-oriented guidance when the data does not support it.
Percentages are relative evidence weights, not statistical causal probabilities.
"""

from __future__ import annotations

from typing import Any


def _joined_manifest(channel_manifest: list[str]) -> str:
    return " ".join(channel_manifest).lower()


def _has(channel_manifest: list[str], *needles: str) -> bool:
    joined = _joined_manifest(channel_manifest)
    return any(needle.lower() in joined for needle in needles)


def _confidence_label(score: int) -> str:
    if score >= 80:
        return "high"
    if score >= 55:
        return "medium"
    return "low"


def _setup_included(setup: dict[str, Any] | None) -> bool:
    setup = setup or {}
    ignored = {"telemetry_attached", "voice_intake", "class_name", "base_lap_sec"}
    return any(
        key not in ignored and value not in (None, "", False, [], {})
        for key, value in setup.items()
    )


def _track_text(conditions: dict[str, Any] | None) -> str:
    conditions = conditions or {}
    return " ".join(str(value) for value in conditions.values() if value is not None).lower()


def _debrief_text(debrief: str | None) -> str:
    return (debrief or "").strip().lower()


def _turn_observation(turns: dict[str, Any] | None) -> dict[str, Any] | None:
    """Find the turn with the largest repeatability spread.

    This is intentionally an observation about variability, not a claim that it
    is automatically the biggest time-loss area. Current oval segmentation does
    not yet provide enough best-lap-vs-lap delta detail to make that stronger claim.
    """
    turns = turns or {}
    candidates: list[dict[str, Any]] = []
    for key, item in turns.items():
        if not isinstance(item, dict):
            continue
        entry = item.get("entry_speed_mph") or {}
        exit_ = item.get("exit_speed_mph") or {}
        try:
            entry_spread = float(entry.get("max")) - float(entry.get("min"))
            exit_spread = float(exit_.get("max")) - float(exit_.get("min"))
        except (TypeError, ValueError):
            continue
        candidates.append(
            {
                "segment": key.replace("turn_", "Turn "),
                "instances": int(item.get("instances") or 0),
                "entry_speed_spread_mph": round(entry_spread, 2),
                "exit_speed_spread_mph": round(exit_spread, 2),
                "combined_spread_mph": round(entry_spread + exit_spread, 2),
                "entry_avg_mph": round(float(entry.get("avg") or 0), 2),
                "exit_avg_mph": round(float(exit_.get("avg") or 0), 2),
                "data_quality_note": item.get("data_quality_note"),
            }
        )
    if not candidates:
        return None
    return max(candidates, key=lambda item: item["combined_spread_mph"])


def _cause_weights(
    *,
    debrief: str,
    conditions: dict[str, Any] | None,
    setup_included: bool,
    has_brake: bool,
    has_steering: bool,
    has_rpm: bool,
    has_tire_temp: bool,
) -> list[dict[str, Any]]:
    weights = {
        "chassis/setup": 30.0,
        "driver input": 25.0,
        "tires/prep/pressure": 20.0,
        "track/environment": 15.0,
        "mechanical/powertrain": 10.0,
    }

    track = _track_text(conditions)

    if any(word in debrief for word in ("tight", "won't rotate", "wont rotate", "push", "nose won't", "center")):
        weights["chassis/setup"] += 8
        weights["driver input"] += 3
    if any(word in debrief for word in ("loose", "free", "rear", "snapped", "off")):
        weights["tires/prep/pressure"] += 6
        weights["chassis/setup"] += 4
    if any(word in debrief for word in ("wait on throttle", "over slow", "overslow", "brake", "entry")):
        weights["driver input"] += 6
    if any(word in track for word in ("slick", "dry", "drying", "rubbered", "polished", "hot")):
        weights["track/environment"] += 8
        weights["tires/prep/pressure"] += 5
    if any(word in track for word in ("tacky", "wet", "moist", "bite", "heavy")):
        weights["track/environment"] += 5
        weights["chassis/setup"] += 4
    if has_rpm:
        weights["mechanical/powertrain"] += 2
    if not setup_included:
        weights["chassis/setup"] -= 5
        weights["tires/prep/pressure"] -= 3
    if not has_brake:
        weights["driver input"] -= 3
    if not has_steering:
        weights["driver input"] -= 4
        weights["chassis/setup"] -= 2
    if not has_tire_temp:
        weights["tires/prep/pressure"] -= 4

    for key in weights:
        weights[key] = max(1.0, weights[key])
    total = sum(weights.values())
    ranked = sorted(weights.items(), key=lambda item: item[1], reverse=True)
    return [
        {"category": name, "weight_pct": round((value / total) * 100)}
        for name, value in ranked
    ]


def build_report_analysis(
    *,
    summary: Any,
    channel_manifest: list[str],
    corner_analysis: dict[str, Any],
    setup: dict[str, Any] | None,
    conditions: dict[str, Any] | None,
    driver_debrief: str | None,
) -> dict[str, Any]:
    manifest = channel_manifest or []
    lap_count = int(getattr(summary, "lap_count", 0) or 0)
    debrief = _debrief_text(driver_debrief)
    setup_present = _setup_included(setup)

    has_gps = _has(manifest, "gps latitude", "gps longitude", "gps speed", "gps radius")
    has_rpm = _has(manifest, "rpm")
    has_lat_g = _has(manifest, "latacc", "lateral", "lat acc", "g force")
    has_brake = _has(manifest, "brake", "brake pressure")
    has_steering = _has(manifest, "steering")
    has_tire_temp = _has(manifest, "tire temp", "tyre temp", "infrared")

    turns = (corner_analysis or {}).get("turns") or {}
    diagnostic = str((corner_analysis or {}).get("diagnostic") or "")
    turn_observation = _turn_observation(turns)

    data_score = 15
    if lap_count >= 3:
        data_score += 20
    if lap_count >= 6:
        data_score += 10
    if has_gps:
        data_score += 20
    if has_rpm:
        data_score += 10
    if has_lat_g:
        data_score += 10
    if turn_observation:
        data_score += 10
    if debrief:
        data_score += 5
    if "warning" in diagnostic.lower() or "caution" in diagnostic.lower():
        data_score -= 15
    data_score = max(10, min(100, data_score))

    interpretation_score = data_score
    if not debrief:
        interpretation_score -= 8
    if not setup_present:
        interpretation_score -= 6
    if not has_brake:
        interpretation_score -= 5
    if not has_steering:
        interpretation_score -= 8
    if not has_tire_temp:
        interpretation_score -= 4
    if lap_count < 3:
        interpretation_score -= 15
    if "warning" in diagnostic.lower() or "misaligned" in diagnostic.lower():
        interpretation_score -= 20
    interpretation_score = max(5, min(100, interpretation_score))

    missing = []
    if not has_brake:
        missing.append("brake pressure")
    if not has_steering:
        missing.append("steering angle")
    if not has_tire_temp:
        missing.append("tire temperature")
    if not setup_present:
        missing.append("setup details")
    if not debrief:
        missing.append("driver debrief")

    measured = []
    if getattr(summary, "best_lap_sec", None) is not None:
        measured.append(f"Best lap: {float(summary.best_lap_sec):.3f}s")
    if getattr(summary, "consistency_stdev_sec", None) is not None:
        measured.append(f"Lap-time consistency spread (stdev): {float(summary.consistency_stdev_sec):.3f}s")
    fade = getattr(summary, "fade_sec", None)
    if fade is not None and abs(float(fade)) >= 0.05:
        direction = "slower" if float(fade) > 0 else "faster"
        measured.append(f"Second half of run averaged {abs(float(fade)):.3f}s {direction} than first half")
    if turn_observation:
        measured.append(
            f"{turn_observation['segment']} showed the largest repeated speed variation: "
            f"{turn_observation['entry_speed_spread_mph']:.2f} mph entry spread and "
            f"{turn_observation['exit_speed_spread_mph']:.2f} mph exit spread"
        )

    low_confidence = interpretation_score < 55
    cause_weights = [] if low_confidence else _cause_weights(
        debrief=debrief,
        conditions=conditions,
        setup_included=setup_present,
        has_brake=has_brake,
        has_steering=has_steering,
        has_rpm=has_rpm,
        has_tire_temp=has_tire_temp,
    )

    if low_confidence:
        interpretation = (
            "The run contains usable measured observations, but the evidence is not strong enough "
            "to separate driver, chassis, tire, track, or mechanical causes with confidence."
        )
        common_areas = []
    else:
        top = cause_weights[0]
        interpretation = (
            f"The available evidence leans most toward {top['category']} as the first area to investigate. "
            "This is a ranked evidence weight, not proof of cause."
        )
        common_areas = [
            "cross / weight transfer",
            "camber / caster / front geometry",
            "tire pressure / prep / stagger",
            "driver entry speed, brake release and throttle timing",
            "track bite and groove movement",
        ]

    return {
        "engine_version": "trackside-v1.0",
        "data_quality": {"score": data_score, "label": _confidence_label(data_score)},
        "interpretation_confidence": {
            "score": interpretation_score,
            "label": _confidence_label(interpretation_score),
        },
        "publish_mode": "observation_only" if low_confidence else "weighted_interpretation",
        "recommendation_safe_to_publish": not low_confidence,
        "measured_facts": measured,
        "primary_observation": turn_observation,
        "interpretation": interpretation,
        "likely_contributors": cause_weights,
        "common_areas_to_check": common_areas,
        "missing_evidence": missing,
        "driver_debrief_present": bool(debrief),
        "setup_included": setup_present,
        "channel_flags": {
            "gps": has_gps,
            "rpm": has_rpm,
            "lateral_g": has_lat_g,
            "brake_pressure": has_brake,
            "steering_angle": has_steering,
            "tire_temperature": has_tire_temp,
        },
        "guardrail": (
            "Do not state an exact setup cause or adjustment amount unless directly supported by measured data. "
            "When confidence is low, publish observations only."
        ),
    }

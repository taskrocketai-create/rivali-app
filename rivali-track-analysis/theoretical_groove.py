"""Conservative line-model scaffold. Does not label recorded GPS as an optimum.

Without surveyed track boundaries, grip measurements and a calibrated kart model,
no physically defensible unique fastest groove can be calculated. Preserve the
measured route as evidence, expose missing inputs, and require operator review.
"""
import math

REQUIRED = ("inside_boundary", "outside_boundary", "usable_lateral_acceleration_mps2",
            "usable_acceleration_mps2", "usable_braking_mps2")

def _point(value):
    try:
        lat, lon = map(float, value)
        if all(map(math.isfinite, (lat, lon))) and -90 <= lat <= 90 and -180 <= lon <= 180:
            return [lat, lon]
    except (ValueError, TypeError):
        pass
    return None

def theoretical_groove(track=None, dynamics=None, observed=None):
    track = track or {}
    dynamics = dynamics or {}
    missing = [key for key in REQUIRED
               if (key not in track and key not in dynamics) or
               (track.get(key) is None and dynamics.get(key) is None)]
    for boundary in ("inside_boundary", "outside_boundary"):
        if boundary not in missing:
            points=track.get(boundary)
            if not isinstance(points, list) or len(points)<12 or any(_point(p) is None for p in points):
                missing.append(boundary)
    for metric in REQUIRED[2:]:
        if metric not in missing:
            v=dynamics.get(metric)
            if not isinstance(v,(float,int)) or not math.isfinite(v) or v<=0:
                missing.append(metric)
    return {
      "status":"insufficient_inputs" if missing else "model_not_calibrated",
      "optimal_coordinates":None,
      "estimated_lap_time_sec":None,
      "time_saving_sec":None,
      "missing_inputs":missing,
      "method":"Constrained minimum-time path optimization using surveyed track limits and calibrated vehicle dynamics.",
      "knowledge_base_role":"Explain hypotheses and applicable research with source provenance; do not treat prose as measured grip.",
      "message":("Track GPS shows where the kart traveled, not track boundaries. "
                 "A scientifically defensible optimal groove requires boundaries and "
                 "validated tire/surface and kart dynamics. No ideal line or time gain fabricated.")
    }

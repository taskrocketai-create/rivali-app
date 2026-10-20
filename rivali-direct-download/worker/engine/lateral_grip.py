"""Evidence-gated lateral acceleration comparison, not manufacturer calibration."""
import math
import struct

def compare_lateral_grip(raw_samples, gps_times, gps_lateral_g, *, lag_seconds=-9.0, scale=0.0305):
    """Return a diagnostic only. Never infer a production conversion from this."""
    import numpy as np
    if not raw_samples or len(gps_times) < 2:
        return {"status": "unavailable", "reason": "Missing raw or GPS reference samples"}
    raw_time = np.array([t / 1000 for t, _ in raw_samples], dtype=float)
    raw_value = np.array([struct.unpack("<f", struct.pack("<I", v))[0] for _, v in raw_samples])
    gt = np.asarray(gps_times, dtype=float)
    gy = np.asarray(gps_lateral_g, dtype=float)
    if len(gt) != len(gy) or not np.all(np.diff(gt) > 0):
        return {"status": "unavailable", "reason": "Invalid GPS reference timestamps"}
    valid = np.isfinite(raw_value) & (raw_time + lag_seconds >= gt[0]) & (raw_time + lag_seconds <= gt[-1])
    valid &= np.isfinite(np.interp(np.clip(raw_time + lag_seconds, gt[0], gt[-1]), gt, gy))
    valid &= raw_value != 0
    # The current comparison is a diagnostic, not a production time alignment.
    # The lag must be independently verified for each recorder and session.
    if valid.sum() < 100:
        return {"status": "insufficient_data", "sample_count": int(valid.sum())}
    x = raw_value[valid]
    y = np.interp(raw_time[valid] + lag_seconds, gt, gy)
    if np.std(x) == 0 or np.std(y) == 0:
        return {"status": "insufficient_variation", "sample_count": len(x)}
    correlation = float(np.corrcoef(x, y)[0, 1])
    slope, intercept = np.polyfit(x, y, 1)
    # AiM Oval Kart guide displays Lateral Grip in ft/s². Test the
    # physical conversion independently of the fitted regression.
    fixed_g = x / 32.174
    fixed_rmse_g = float(np.sqrt(np.mean((fixed_g - y) ** 2)))
    fixed_bias_g = float(np.mean(fixed_g - y))
    return {
        "status": "provisional_comparison_only",
        "raw_sample_count": len(raw_samples),
        "compared_sample_count": int(len(x)),
        "correlation": round(correlation, 5),
        "documented_display_units": "ft/s² (AiM MyChron 5 Oval Kart guide)",
        "physical_conversion_ft_s2_per_g": 32.174,
        "fixed_conversion_rmse_g": round(fixed_rmse_g, 5),
        "fixed_conversion_bias_g": round(fixed_bias_g, 5),
        "fitted_scale": round(float(slope), 7),
        "fitted_intercept_g": round(float(intercept), 5),
        "time_offset_seconds": lag_seconds,
        "units": "AiM documents Lateral Grip display in ft/s²; raw XRK encoding not manufacturer confirmed",
        "validation": "Not manufacturer calibrated; do not use for grip or setup recommendations",
    }

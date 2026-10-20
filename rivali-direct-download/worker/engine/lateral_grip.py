"""Evidence-gated AiM lateral-grip diagnostic. No automatic setup advice."""
import struct

FT_S2_PER_G = 32.174

def compare_lateral_grip(raw_samples, gps_times, gps_lateral_g, *, lag_seconds=None):
    """Compare decoded float32 candidates against independent GPS reference.

    A per-file lag is selected by held-out correlation, never presumed to
    apply across devices. The result remains provisional until RS3 confirms.
    """
    import numpy as np
    if not raw_samples or len(gps_times) < 2:
        return {"status": "unavailable", "reason": "Missing raw or GPS reference samples"}
    t = np.asarray([a / 1000 for a, _ in raw_samples], dtype=float)
    x = np.asarray([struct.unpack("<f", struct.pack("<I", b))[0] for _, b in raw_samples], dtype=float)
    gt = np.asarray(gps_times, dtype=float)
    gy = np.asarray(gps_lateral_g, dtype=float)
    if len(gt) != len(gy) or not np.all(np.diff(gt) > 0) or not np.all(np.isfinite(gy)):
        return {"status": "unavailable", "reason": "Invalid GPS reference"}
    def pairs(lag):
        valid = np.isfinite(x) & (x != 0) & (t + lag >= gt[0]) & (t + lag <= gt[-1])
        return x[valid], np.interp(t[valid] + lag, gt, gy)
    def correlation(a, b):
        if len(a) < 100 or np.std(a) < 1 or np.std(b) < .03:
            return None
        return float(np.corrcoef(a, b)[0, 1])
    if lag_seconds is None:
        # Use the first half for lag selection and the second for verification.
        # A broad, bounded offset search accommodates device time origins.
        candidates = []
        for lag in np.arange(-20, 20.001, .25):
            a, b = pairs(float(lag))
            midpoint = len(a) // 2
            score = correlation(a[:midpoint], b[:midpoint])
            if score is not None:
                candidates.append((score, float(lag)))
        if not candidates:
            return {"status": "insufficient_data", "reason": "No usable lag candidates"}
        lag_seconds = max(candidates)[1]
        alignment_method = "first_half_correlation_grid_0.25s"
    else:
        alignment_method = "externally_supplied_offset"
    a, b = pairs(lag_seconds)
    if len(a) < 200:
        return {"status": "insufficient_data", "sample_count": len(a)}
    midpoint = len(a) // 2
    holdout = correlation(a[midpoint:], b[midpoint:])
    overall = correlation(a, b)
    if overall is None or holdout is None:
        return {"status": "insufficient_variation", "sample_count": len(a)}
    fixed_g = a / FT_S2_PER_G
    slope, intercept = np.polyfit(a, b, 1)
    return {
        "status": "provisional_comparison_only",
        "raw_sample_count": len(raw_samples),
        "compared_sample_count": len(a),
        "correlation": round(overall, 5),
        "holdout_correlation": round(holdout, 5),
        "alignment_method": alignment_method,
        "time_offset_seconds": lag_seconds,
        "documented_display_units": "ft/s² (AiM MyChron 5 Oval Kart guide)",
        "physical_conversion_ft_s2_per_g": FT_S2_PER_G,
        "fixed_conversion_rmse_g": round(float(np.sqrt(np.mean((fixed_g - b) ** 2))), 5),
        "fixed_conversion_bias_g": round(float(np.mean(fixed_g - b)), 5),
        "fitted_scale": round(float(slope), 7),
        "fitted_intercept_g": round(float(intercept), 5),
        "units": "AiM documents display ft/s²; raw XRK encoding not manufacturer confirmed",
        "validation": "Not manufacturer calibrated; do not use for grip or setup recommendations",
    }

"""Reconstruct lap times from timestamped GPS crossings of a saved start/finish line."""
import math

GPS_LAT_NAMES = ("GPS Latitude", "GPS Lat", "Latitude", "Lat", "GPS_Latitude")
GPS_LON_NAMES = ("GPS Longitude", "GPS Long", "GPS Lon", "Longitude", "Lon", "GPS_Longitude")


def _plain(series):
    if hasattr(series, "pint"):
        try:
            return series.pint.magnitude
        except Exception:
            pass
    if hasattr(series, "array") and hasattr(series.array, "quantity"):
        return series.array.quantity.magnitude
    return series


def _find(data, names):
    lookup = {str(column).strip().lower(): column for column in data.columns}
    return next((lookup[name.lower()] for name in names if name.lower() in lookup), None)


def _point(raw):
    if not isinstance(raw, dict):
        return None
    lat, lng = raw.get("lat"), raw.get("lng", raw.get("lon"))
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def reconstruct_lap_times(data, start_finish, min_lap_sec=5.0, max_lap_sec=180.0):
    """Return same-direction line-crossing lap times and a diagnostic message."""
    if not isinstance(start_finish, list) or len(start_finish) < 2:
        return [], "Track has no saved two-point start/finish line."
    line_a, line_b = _point(start_finish[0]), _point(start_finish[1])
    lat_name, lon_name = _find(data, GPS_LAT_NAMES), _find(data, GPS_LON_NAMES)
    if not line_a or not line_b or lat_name is None or lon_name is None:
        return [], "GPS coordinates or the saved start/finish line are unavailable."

    origin_lat = (line_a[0] + line_b[0]) / 2
    meters_lat = 111_320.0
    meters_lon = meters_lat * math.cos(math.radians(origin_lat))

    def xy(point):
        return point[1] * meters_lon, point[0] * meters_lat

    ax, ay = xy(line_a)
    bx, by = xy(line_b)
    vx, vy = bx - ax, by - ay
    line_len_sq = vx * vx + vy * vy
    if line_len_sq < 4:
        return [], "Saved start/finish line is too short."

    samples = []
    for raw_t, raw_lat, raw_lon in zip(data.index, _plain(data[lat_name]), _plain(data[lon_name])):
        try:
            t, lat, lon = float(raw_t), float(raw_lat), float(raw_lon)
        except (TypeError, ValueError):
            continue
        if all(math.isfinite(value) for value in (t, lat, lon)) and -90 <= lat <= 90 and -180 <= lon <= 180:
            px, py = xy((lat, lon))
            side = vx * (py - ay) - vy * (px - ax)
            projection = ((px - ax) * vx + (py - ay) * vy) / line_len_sq
            samples.append((t, side, projection))

    crossings = {1: [], -1: []}
    for previous, current in zip(samples, samples[1:]):
        t0, side0, projection0 = previous
        t1, side1, projection1 = current
        if side0 == side1 or side0 * side1 > 0:
            continue
        fraction = abs(side0) / (abs(side0) + abs(side1)) if side0 or side1 else 0.5
        projection = projection0 + (projection1 - projection0) * fraction
        if not -0.15 <= projection <= 1.15:
            continue
        crossing_time = t0 + (t1 - t0) * fraction
        direction = 1 if side1 > side0 else -1
        if not crossings[direction] or crossing_time - crossings[direction][-1] >= min_lap_sec:
            crossings[direction].append(crossing_time)

    selected = max(crossings.values(), key=len)
    lap_times = [
        round(end - start, 4)
        for start, end in zip(selected, selected[1:])
        if min_lap_sec <= end - start <= max_lap_sec
    ]
    if not lap_times:
        return [], f"Detected {len(selected)} same-direction start/finish crossing(s), not enough for a complete lap."
    return lap_times, f"Reconstructed {len(lap_times)} lap(s) from {len(selected)} GPS start/finish crossings."

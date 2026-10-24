"""Read XRK 11-byte and 13-byte sample records without calibration."""
from collections import defaultdict
from pathlib import Path
import struct

def extract_samples(path, channels=None):
    """Return raw channel-indexed (timestamp_ms, integer_value) samples."""
    data = Path(path).read_bytes()
    wanted = set(channels) if channels is not None else None
    result = defaultdict(list)
    offset = 0
    while offset + 11 <= len(data):
        if data[offset:offset + 2] != b"(S":
            offset += 1
            continue
        channel = data[offset + 6]
        # A 32-bit payload can contain 0x29 at the 16-bit terminator
        # position. For the tested Lat Gri channel, prefer its 13-byte form.
        if channel == 39 and offset + 13 <= len(data) and data[offset + 12] == 0x29:
            size, fmt = 13, "<I"
        elif data[offset + 10] == 0x29:
            size, fmt = 11, "<H"
        elif offset + 13 <= len(data) and data[offset + 12] == 0x29:
            size, fmt = 13, "<I"
        else:
            offset += 1
            continue
        if wanted is None or channel in wanted:
            timestamp = struct.unpack_from("<I", data, offset + 2)[0]
            value = struct.unpack_from(fmt, data, offset + 8)[0]
            result[channel].append((timestamp, value))
        offset += size
    return dict(result)

def rpm_lap_summaries(path, rpm_samples=None):
    """Aggregate recorded RPM by raw LAP packet boundaries.

    Uses XRK timestamps, not GPS time estimates. Numbering is raw ordinal,
    not necessarily the number displayed in Race Studio 3.
    """
    from .xrk_lap_decoder import decode_laps
    records = decode_laps(Path(path).read_bytes())
    rpm = rpm_samples if rpm_samples is not None else extract_samples(path, channels=[33]).get(33, [])
    summaries = []
    start_index = 0
    for lap in sorted(records, key=lambda record: record["end_timestamp_ms"]):
        end = lap["end_timestamp_ms"]
        start = end - round(lap["duration_seconds"] * 1000)
        while start_index < len(rpm) and rpm[start_index][0] < start:
            start_index += 1
        cursor = start_index
        values = []
        trace = []
        while cursor < len(rpm) and rpm[cursor][0] < end:
            values.append(rpm[cursor][1])
            if (cursor - start_index) % 4 == 0:
                trace.append([round((rpm[cursor][0] - start) / 1000, 3), rpm[cursor][1]])
            cursor += 1
        if values:
            summaries.append({"raw_lap_ordinal": lap["record_ordinal"],
                              "start_timestamp_ms": start, "end_timestamp_ms": end,
                              "sample_count": len(values), "min_rpm": min(values),
                              "max_rpm": max(values), "average_rpm": round(sum(values)/len(values), 1),
                              "trace": trace})
    return summaries

def align_rpm_to_laps(raw_summaries, reported_laps):
    """Match RPM packet summaries to reported laps by lap duration and order.

    Refuse ambiguous matches; never assume raw ordinal equals RS3 lap number.
    """
    aligned = []
    previous_ordinal = -1
    for lap in reported_laps:
        number = lap.lap_number
        duration = lap.lap_time_sec
        candidates = [r for r in raw_summaries
                      if r["raw_lap_ordinal"] > previous_ordinal
                      and abs((r["end_timestamp_ms"] - r["start_timestamp_ms"]) / 1000 - duration) < 0.002]
        if len(candidates) != 1:
            continue
        match = candidates[0]
        previous_ordinal = match["raw_lap_ordinal"]
        aligned.append({"lap_number": number, **match})
    return aligned


def extract_lateral_grip(path):
    """Read recorded AiM 'Lat Gri' trace as float32, without claiming G units.

    The channel number is assigned per XRK file (e.g. MyChron 6 uses 32).
    The 'Lat Gri' values seen in Race Studio have an unspecified [#] unit.
    Return (timestamp_ms, value) pairs; retain zeros so timing is preserved.
    """
    import math
    data = Path(path).read_bytes()
    matches = []
    offset = 0
    while (offset := data.find(b"<hCHS", offset)) >= 0:
        header = data[offset:offset + 150]
        if b"Lat Gri\x00Lateral Grip\x00" in header:
            matches.append(struct.unpack_from("<I", data, offset + 12)[0])
        offset += 5
    channels = set(matches)
    if len(channels) != 1 or not all(0 <= ch < 256 for ch in channels):
        raise ValueError("Could not uniquely identify Lateral Grip channel in XRK header")
    channel = next(iter(channels))
    result = []
    offset = 0
    while (offset := data.find(b"(S", offset)) >= 0:
        if offset + 13 <= len(data) and data[offset + 6] == channel and data[offset + 12] == 0x29:
            stamp = struct.unpack_from("<I", data, offset + 2)[0]
            value = struct.unpack_from("<f", data, offset + 8)[0]
            if math.isfinite(value):
                result.append((stamp, value))
            offset += 13
        else:
            offset += 2
    return result

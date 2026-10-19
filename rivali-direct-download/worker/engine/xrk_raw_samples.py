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
        if data[offset + 10] == 0x29:
            size, fmt = 11, "<H"
        elif offset + 13 <= len(data) and data[offset + 12] == 0x29:
            size, fmt = 13, "<I"
        else:
            offset += 1
            continue
        channel = data[offset + 6]
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
        while cursor < len(rpm) and rpm[cursor][0] < end:
            values.append(rpm[cursor][1])
            cursor += 1
        if values:
            summaries.append({"raw_lap_ordinal": lap["record_ordinal"],
                              "start_timestamp_ms": start, "end_timestamp_ms": end,
                              "sample_count": len(values), "min_rpm": min(values),
                              "max_rpm": max(values), "average_rpm": round(sum(values)/len(values), 1)})
    return summaries

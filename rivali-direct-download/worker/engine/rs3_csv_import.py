"""Read an AiM Race Studio 3 CSV export as supplemental verified telemetry.

This deliberately does not claim that channel definitions are actual samples,
or that a CSV has the same time origin as an XRK. Alignment is a separate step.
"""
import csv
import io
import math
import re
from pathlib import Path

ALIASES = {
    "rpm": "RPM",
    "engine rpm": "RPM",
    "accelerometerx": "AccX",
    "accelerometery": "AccY",
    "accelerometerz": "AccZ",
    "accx": "AccX",
    "accy": "AccY",
    "accz": "AccZ",
    "lateral acceleration": "Lateral-G",
    "lateral g": "Lateral-G",
    "lat g": "Lateral-G",
    "lateral grip": "Lateral Grip",
    "gyroz": "GyrZ",
    "gyrox": "GyrX",
    "gyroy": "GyrY",
    "wheel speed": "Wheel Speed",
    "wheelspeed": "Wheel Speed",
    "gps speed": "GPS Speed",
}
TIME_ALIASES = {"time", "session time", "elapsed time", "time s", "time sec", "timestamp"}


def _normalize(label):
    return re.sub(r"[^a-z0-9 ]+", " ", label.lower()).strip()


def _number(value):
    try:
        v = float(value.strip().replace(",", "."))
        return v if math.isfinite(v) else None
    except (ValueError, AttributeError):
        return None


def _time(value):
    numeric = _number(value)
    if numeric is not None:
        return numeric
    if not isinstance(value, str):
        return None
    pieces = value.strip().split(":")
    if len(pieces) not in (2, 3):
        return None
    try:
        parts = [float(p) for p in pieces]
    except ValueError:
        return None
    if any(not math.isfinite(p) or p < 0 for p in parts):
        return None
    return sum(p * (60 ** i) for i, p in enumerate(reversed(parts)))


def parse_rs3_csv(text):
    if text.startswith("\\ufeff"):
        text = text[1:]
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\\t")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    rows = list(csv.reader(io.StringIO(text), delimiter=delimiter))
    header_idx = None
    for i, row in enumerate(rows[:50]):
        normalized = [_normalize(c) for c in row]
        if any(c in TIME_ALIASES for c in normalized) and len(row) >= 2:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError("No recognized time column in RS3 CSV export")
    headers = rows[header_idx]
    time_idx = next(i for i, h in enumerate(headers) if _normalize(h) in TIME_ALIASES)
    channels = {}
    for i, label in enumerate(headers):
        if i == time_idx:
            continue
        key = _normalize(label)
        channel = ALIASES.get(key)
        if channel:
            channels[i] = {"name": channel, "source_column": label, "samples": []}
    previous_time = None
    for row in rows[header_idx + 1:]:
        if len(row) <= time_idx:
            continue
        t = _time(row[time_idx])
        if t is None or t < 0:
            continue
        if previous_time is not None and t < previous_time:
            raise ValueError("Time column is not monotonic; check CSV export format")
        previous_time = t
        for i, channel in channels.items():
            if i < len(row):
                value = _number(row[i])
                if value is not None:
                    channel["samples"].append({"time_s": t, "value": value})
    found = {v["name"]: {"source_column": v["source_column"],
                         "sample_count": len(v["samples"]),
                         "samples": v["samples"]}
             for v in channels.values() if v["samples"]}
    return {"source": "race_studio_3_csv", "alignment": "unverified",
            "units": "unverified", "channels": found}


def parse_rs3_csv_file(path):
    return parse_rs3_csv(Path(path).read_text(encoding="utf-8-sig"))

"""Strict XRK lap packet extractor for the tested AiM recording.

Usage: python tools/xrk_lap_decoder.py recording.xrk

Raw status codes are deliberately not treated as validity flags. RS3 display
numbers must be calibrated from the source recording; do not subtract one globally.
"""
import json
import struct
import sys
from pathlib import Path

MARKER = b"<hLAP\\x00"


def decode_laps(data: bytes):
    records = []
    cursor = 0
    while (offset := data.find(MARKER, cursor)) != -1:
        cursor = offset + len(MARKER)
        if offset + 32 > len(data):
            raise ValueError(f"Truncated lap packet at {offset}")
        size = struct.unpack_from("<I", data, offset + 6)[0]
        if size != 20 or data[offset + 10:offset + 12] != b"\\x03>":
            raise ValueError(f"Unsupported LAP packet at {offset}: size={size}")
        ordinal = struct.unpack_from("<H", data, offset + 14)[0]
        duration_ms = struct.unpack_from("<I", data, offset + 16)[0]
        end_ms = struct.unpack_from("<I", data, offset + 28)[0]
        records.append({
            "record_ordinal": ordinal,
            "duration_seconds": duration_ms / 1000,
            "status_raw": data[offset + 26],
            "end_timestamp_ms": end_ms,
            "packet_offset": offset,
        })
    if not records:
        raise ValueError("No supported XRK lap packets found")
    if len({r["record_ordinal"] for r in records}) != len(records):
        raise ValueError("Duplicate lap ordinals")
    return records


def main():
    records = decode_laps(Path(sys.argv[1]).read_bytes())
    print(json.dumps({"lap_record_count": len(records), "laps": records,
        "warnings": ["Raw status flags are not decoded",
                     "RS3 lap numbering requires source-specific validation",
                     "GPS and RPM are not decoded by this tool"]}, indent=2))


if __name__ == "__main__":
    main()

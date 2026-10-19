"""Inventory XRK channel definitions without pretending they contain samples.

AiM channel header records describe possible channels. Only a successful
sample decode may mark a channel as measured/available.
"""
from __future__ import annotations
import re
import struct
from pathlib import Path

CHS = b"<hCHS\\x00"
HEADER_BYTES = 112
TARGETS = {"RPM", "AccX", "AccY", "AccZ", "GyrX", "GyrY", "GyrZ",
           "Lat Gri", "WSpd", "eAX", "eAY", "eAZ"}


def inventory(data: bytes, decoded_columns=()):
    decoded = set(decoded_columns)
    records = []
    for match in re.finditer(re.escape(CHS), data):
        start = match.start()
        if start + HEADER_BYTES > len(data):
            raise ValueError("Truncated XRK channel header")
        size = struct.unpack_from("<I", data, start + 6)[0]
        if size != HEADER_BYTES:
            raise ValueError(f"Unsupported XRK channel header size: {size}")
        short = data[start + 36:start + 44].split(b"\\x00", 1)[0].decode("ascii", "replace")
        name = data[start + 44:start + 68].split(b"\\x00", 1)[0].decode("ascii", "replace")
        records.append({"index": len(records), "short_name": short,
                        "name": name, "has_samples": name in decoded or short in decoded,
                        "sample_status": "decoded" if name in decoded or short in decoded
                        else "not_verified"})
    return {"defined_channels": len(records),
            "decoded_channel_count": sum(r["has_samples"] for r in records),
            "priority_channels": [r for r in records if r["short_name"] in TARGETS],
            "channels": records}


def inventory_file(path: str, decoded_columns=()):
    return inventory(Path(path).read_bytes(), decoded_columns)

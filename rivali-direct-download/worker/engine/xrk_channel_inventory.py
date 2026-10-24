"""Inventory XRK channel definitions without pretending they contain samples.

AiM channel header records describe possible channels. Only a successful
sample decode may mark a channel as measured/available.
"""
from __future__ import annotations
import re
import struct
from pathlib import Path

CHS = bytes((60, 104, 67, 72, 83, 0))
HEADER_BYTES = 112
TARGETS = {"RPM", "AccX", "AccY", "AccZ", "GyrX", "GyrY", "GyrZ",
           "Lat Gri", "WSpd", "eAX", "eAY", "eAZ"}


def inventory(data: bytes, decoded_columns=()):
    decoded = set(decoded_columns)
    records = []
    diagnostics = []
    for match in re.finditer(re.escape(CHS), data):
        start = match.start()
        if start + 10 > len(data):
            diagnostics.append({"offset": start, "error": "truncated_header_size"})
            continue
        size = struct.unpack_from("<I", data, start + 6)[0]
        if size < 68 or size > 4096 or start + size > len(data):
            diagnostics.append({"offset": start, "error": "invalid_or_truncated_header", "advertised_size": size})
            continue
        # Channel names are in the shared prefix of known CHS layouts.
        # Retain the advertised record size for forward compatibility.
        short = data[start + 36:start + 44].split(bytes((0,)), 1)[0].decode("ascii", "replace")
        name = data[start + 44:start + 68].split(bytes((0,)), 1)[0].decode("ascii", "replace")
        records.append({"index": len(records), "short_name": short,
                        "name": name, "header_size": size, "has_samples": name in decoded or short in decoded,
                        "sample_status": "decoded" if name in decoded or short in decoded
                        else "not_verified"})
    return {"defined_channels": len(records), "inventory_diagnostics": diagnostics, "inventory_complete": not diagnostics,
            "decoded_channel_count": sum(r["has_samples"] for r in records),
            "priority_channels": [r for r in records if r["short_name"] in TARGETS],
            "channels": records}


def inventory_file(path: str, decoded_columns=()):
    return inventory(Path(path).read_bytes(), decoded_columns)

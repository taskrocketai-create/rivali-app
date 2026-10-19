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

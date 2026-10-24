import struct
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from engine.xrk_raw_samples import extract_lateral_grip


class TestMyChron6LateralGrip(unittest.TestCase):
    def test_dynamic_channel_and_float32(self):
        header = bytearray(150)
        header[:5] = b"<hCHS"
        struct.pack_into("<I", header, 12, 32)
        header[36:36 + len(b"Lat Gri\x00Lateral Grip\x00")] = b"Lat Gri\x00Lateral Grip\x00"
        sample = lambda t, v: b"(S" + struct.pack("<I", t) + bytes((32, 0)) + struct.pack("<f", v) + b")"
        with TemporaryDirectory() as directory:
            path = Path(directory) / "mychron6.xrk"
            path.write_bytes(bytes(header) + sample(200, -11.0) + sample(240, -9.0))
            self.assertEqual(extract_lateral_grip(path), [(200, -11.0), (240, -9.0)])

    def test_missing_channel_is_explicit_error(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / "empty.xrk"
            path.write_bytes(b"no header")
            with self.assertRaises(ValueError):
                extract_lateral_grip(path)

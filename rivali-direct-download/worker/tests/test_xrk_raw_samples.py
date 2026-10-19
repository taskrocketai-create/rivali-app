import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from engine.xrk_raw_samples import extract_samples

class TestXRKRawSamples(unittest.TestCase):
    def test_32bit_payload_with_internal_terminator(self):
        payload = b"(S" + (200).to_bytes(4, "little") + bytes([39, 0]) + bytes([1, 2, 0x29, 4]) + b")"
        with TemporaryDirectory() as folder:
            path = Path(folder) / "collision.xrk"
            path.write_bytes(payload)
            self.assertEqual(extract_samples(path), {39: [(200, int.from_bytes(bytes([1, 2, 0x29, 4]), "little"))]})

    def test_mixed_lengths_and_channel_filter(self):
        short = b"(S" + (100).to_bytes(4, "little") + bytes([33, 0]) + (4567).to_bytes(2, "little") + b")"
        long = b"(S" + (200).to_bytes(4, "little") + bytes([39, 0]) + (123456).to_bytes(4, "little") + b")"
        with TemporaryDirectory() as folder:
            path = Path(folder) / "sample.xrk"
            path.write_bytes(b"noise" + short + long + b"tail")
            self.assertEqual(extract_samples(path), {33: [(100, 4567)], 39: [(200, 123456)]})
            self.assertEqual(extract_samples(path, channels=[33]), {33: [(100, 4567)]})

if __name__ == "__main__":
    unittest.main()

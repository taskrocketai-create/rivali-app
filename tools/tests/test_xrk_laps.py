"""Regression test using the actual Stephen Tri-County XRK recording.

Set RIVALI_XRK_FIXTURE to the local recording path before running.
Run: python -m unittest discover -s tools/tests
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from xrk_lap_decoder import decode_laps


class TriCountyXRKRegression(unittest.TestCase):
    def test_real_recording(self):
        fixture = os.environ.get("RIVALI_XRK_FIXTURE")
        if not fixture:
            self.skipTest("Set RIVALI_XRK_FIXTURE to Stephen's original XRK")
        records = decode_laps(Path(fixture).read_bytes())
        self.assertEqual(len(records), 34)
        fastest = min(records, key=lambda record: record["duration_seconds"])
        self.assertEqual(fastest["record_ordinal"], 9)
        self.assertAlmostEqual(fastest["duration_seconds"], 12.295)
        comparison = next(r for r in records if r["record_ordinal"] == 18)
        self.assertAlmostEqual(comparison["duration_seconds"], 12.312)
        # RS3 displays fastest as lap 8 and comparison as lap 17.
        # Do not globally subtract 1 without confirming packet semantics.


if __name__ == "__main__":
    unittest.main()

"""XRK fallback regression: test against Stephen's original recording.

Run with: RIVALI_XRK_FIXTURE=/path/to/a_0394.xrk python -m unittest discover -s worker/tests
Requires daq_tools installed in the worker environment.
"""
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from engine.session_summary import summarize_session


class XRKFallbackRegression(unittest.TestCase):
    def test_sentinel_only_header_recovers_laps(self):
        fixture = os.environ.get("RIVALI_XRK_FIXTURE")
        if not fixture:
            self.skipTest("RIVALI_XRK_FIXTURE not set")
        self.assertTrue(Path(fixture).is_file())
        header = {"Racer": "Stephen", "Track": "Tri-County", "Laps": [
            {"lap_number": 1, "lap_time": 2147483647}
        ]}
        with patch("daq_tools.readers.XRKReader.read", return_value=(header, None)):
            summary = summarize_session(fixture)
        self.assertEqual(summary.lap_count, 33)
        self.assertAlmostEqual(summary.best_lap_sec, 12.295)
        self.assertEqual(next(x.lap_number for x in summary.laps if x.is_best), 9)
        self.assertTrue(any("raw XRK packets" in x for x in summary.warnings))


if __name__ == "__main__":
    unittest.main()

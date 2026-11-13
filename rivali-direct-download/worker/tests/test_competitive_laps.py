"""Regression tests for competitive lap ranking; stdlib only."""
import unittest
from types import SimpleNamespace
from engine.competitive_laps import compare_competitive_laps


class CompetitiveLapsTests(unittest.TestCase):
    def test_top_five_compared_to_slower_and_tenths_preserved(self):
        times = [11.80, 12.00, 11.82, 12.02, 11.79, 11.85, 12.01]
        laps = [SimpleNamespace(lap_number=i + 1, lap_time_sec=t) for i, t in enumerate(times)]
        result = compare_competitive_laps(laps)
        self.assertEqual(result["status"], "ready")
        self.assertEqual(len(result["fast_laps"]), 5)
        self.assertEqual(len(result["slower_laps"]), 2)
        self.assertEqual(result["excluded_laps"], [])
        self.assertEqual(result["fast_laps"][0]["lap_number"], 5)
        self.assertGreater(result["comparison"]["group_delta_sec"], 0)

    def test_extreme_slow_lap_is_suspected_not_confirmed_caution(self):
        values = [11.8, 11.9, 19.0, 11.85, 12.0, 11.82, 12.1]
        result = compare_competitive_laps([
            {"lap_number": index + 1, "lap_time_sec": value}
            for index, value in enumerate(values)])
        self.assertEqual(result["excluded_laps"][0]["lap_number"], 3)
        self.assertEqual(result["excluded_laps"][0]["reason"], "suspected_interruption")
        self.assertTrue(result["excluded_laps"][0]["requires_confirmation"])

    def test_confirmed_caution_is_excluded(self):
        result = compare_competitive_laps([
            {"lap_number": 1, "lap_time_sec": 11.8},
            {"lap_number": 2, "lap_time_sec": 11.9},
            {"lap_number": 3, "lap_time_sec": 12.0},
        ], confirmed_caution_numbers={2})
        self.assertEqual(result["excluded_laps"][0]["reason"], "confirmed_caution")
        self.assertEqual(len(result["fast_laps"]), 2)

    def test_missing_or_bad_lap_data_does_not_crash(self):
        result = compare_competitive_laps([
            {"lap_number": 1, "lap_time_sec": None},
            {"lap_number": 2, "lap_time_sec": float("nan")},
        ])
        self.assertEqual(result["status"], "insufficient_data")

    def test_not_enough_laps(self):
        result = compare_competitive_laps([
            {"lap_number": 1, "lap_time_sec": 11.8},
        ])
        self.assertEqual(result["status"], "fast_laps_only")


if __name__ == "__main__":
    unittest.main()

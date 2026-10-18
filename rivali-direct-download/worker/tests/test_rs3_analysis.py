import unittest
from rs3_analysis import histogram, scatter, lap_statistics, interpolate, distance_overlay, time_delta, evidence_assessment


class TestRS3Analysis(unittest.TestCase):
    def test_histogram_conserves_samples(self):
        h = histogram([1, 2, 3, 4, 5], bins=2)
        self.assertEqual(sum(h["counts"]), 5)
        self.assertEqual(histogram([])["counts"], [])

    def test_lap_number_not_invented(self):
        stats = lap_statistics([{"lap_number": 8, "lap_time_sec": 12.295},
                                {"lap_number": 9, "lap_time_sec": 12.361}])
        self.assertEqual(stats["best"], {"lap_number": 8, "seconds": 12.295})

    def test_interpolation_and_no_extrapolation(self):
        self.assertEqual(interpolate([0, 10], [40, 50], 5), 45)
        self.assertIsNone(interpolate([0, 10], [40, 50], 20))

    def test_delta_physics(self):
        self.assertAlmostEqual(time_delta([0, 10], [5, 5], [10, 10])[-1], 1.0)
        with self.assertRaises(ValueError):
            time_delta([0, 10], [0, 5], [10, 10])

    def test_missing_channels_do_not_get_fabricated(self):
        self.assertEqual(distance_overlay([{"lap_number": 8, "distance_m": [0, 10]}],
                                          "RPM")["laps"], [])
        status = evidence_assessment(["GPS Speed", "GPS Latitude"])
        self.assertEqual(status["rpm_analysis"], "missing_channel")
        self.assertEqual(status["track_sectors"], "blocked_track_mapping")

    def test_scatter_filters_nonfinite(self):
        self.assertEqual(scatter([1, float("nan"), 3], [2, 4, 6]),
                         [{"x": 1.0, "y": 2.0}, {"x": 3.0, "y": 6.0}])


if __name__ == "__main__":
    unittest.main()

import unittest
from engine.rs3_reference import validate_offset


class RS3ReferenceTests(unittest.TestCase):
    def test_exact_five_matches(self):
        times = [(9, 12.295), (11, 12.316), (18, 12.312), (21, 12.313), (22, 12.314)]
        rows = [{'record_ordinal': n, 'duration_seconds': t} for n, t in times]
        self.assertEqual(validate_offset(rows), -1)

    def test_no_unsupported_offset(self):
        rows = [{'record_ordinal': 9, 'duration_seconds': 12.295}]
        self.assertIsNone(validate_offset(rows))

    def test_reject_wrong_times(self):
        rows = [{'record_ordinal': n, 'duration_seconds': 99.0} for n in (9, 11, 18, 21, 22)]
        self.assertIsNone(validate_offset(rows))


if __name__ == '__main__':
    unittest.main()

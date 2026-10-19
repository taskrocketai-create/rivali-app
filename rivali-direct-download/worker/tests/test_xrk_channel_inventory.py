import unittest
from engine.xrk_channel_inventory import inventory


class ChannelInventoryTests(unittest.TestCase):
    def test_empty(self):
        result = inventory(b'')
        self.assertEqual(result['defined_channels'], 0)
        self.assertEqual(result['decoded_channel_count'], 0)

    def test_channel_definition_is_not_a_sample(self):
        header = bytearray(112)
        header[:6] = b'<hCHS\x00'
        header[6:10] = (112).to_bytes(4, 'little')
        header[36:39] = b'RPM'
        header[44:47] = b'RPM'
        result = inventory(bytes(header))
        self.assertEqual(result['defined_channels'], 1)
        self.assertFalse(result['channels'][0]['has_samples'])
        self.assertEqual(result['channels'][0]['sample_status'], 'not_verified')

    def test_channel_name_null_padding_is_removed(self):
        header = bytearray(112)
        header[:6] = bytes((60, 104, 67, 72, 83, 0))
        header[6:10] = (112).to_bytes(4, 'little')
        header[36:40] = b'ACCX'
        header[44:58] = b'Acceleration X'
        result = inventory(bytes(header), decoded_columns=['Acceleration X'])
        self.assertEqual(result['channels'][0]['name'], 'Acceleration X')
        self.assertTrue(result['channels'][0]['has_samples'])

    def test_extended_channel_header_keeps_name(self):
        header = bytearray(144)
        header[:6] = bytes((60, 104, 67, 72, 83, 0))
        header[6:10] = (144).to_bytes(4, 'little')
        header[44:48] = b'GyrX'
        result = inventory(bytes(header))
        self.assertEqual(result['channels'][0]['header_size'], 144)
        self.assertEqual(result['channels'][0]['name'], 'GyrX')
        self.assertFalse(result['channels'][0]['has_samples'])

    def test_truncated_extended_header_rejected(self):
        header = bytearray(112)
        header[:6] = bytes((60, 104, 67, 72, 83, 0))
        header[6:10] = (144).to_bytes(4, 'little')
        with self.assertRaisesRegex(ValueError, 'truncated'):
            inventory(bytes(header))


if __name__ == '__main__':
    unittest.main()

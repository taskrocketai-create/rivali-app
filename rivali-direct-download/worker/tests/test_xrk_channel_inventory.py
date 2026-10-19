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


if __name__ == '__main__':
    unittest.main()

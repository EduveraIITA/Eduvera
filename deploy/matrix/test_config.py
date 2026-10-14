import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('matrix_config', Path(__file__).with_name('generate-config.py'))
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class ConfigurationTests(unittest.TestCase):
    def test_generated_secrets_are_distinct_and_private(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config.generate('chat.example.test', root)
            registration = json.loads((root / 'runtime/synapse/eduvera-appservice.yaml').read_text())
            self.assertNotEqual(registration['as_token'], registration['hs_token'])
            self.assertEqual(len(registration['as_token']), 64)
            for file in root.rglob('*'):
                if file.is_file():
                    self.assertEqual(stat.S_IMODE(file.stat().st_mode), 0o644 if file.name == 'element-call.json' else 0o600)

    def test_no_public_registration_federation_or_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config.generate('chat.example.test', root)
            home = json.loads((root / 'runtime/synapse/homeserver.yaml').read_text())
            self.assertFalse(home['enable_registration'])
            self.assertFalse(home['allow_guest_access'])
            self.assertFalse(home['user_directory']['enabled'])
            self.assertEqual(home['federation_domain_whitelist'], [])
            self.assertEqual(home['listeners'][0]['resources'][0]['names'], ['client'])

    def test_secrets_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config.generate('chat.example.test', root)
            before = (root / '.env').read_bytes()
            with self.assertRaises(FileExistsError):
                config.generate('chat.example.test', root)
            self.assertEqual(before, (root / '.env').read_bytes())

    def test_invalid_domain_creates_no_config(self):
        for domain in ['https://chat.example.test', 'chat.example.test/path', 'evil\\nTOKEN=x', 'localhost']:
            with tempfile.TemporaryDirectory() as temp:
                with self.assertRaises(ValueError):
                    config.generate(domain, Path(temp))
                self.assertFalse((Path(temp) / 'runtime').exists())

    def test_rtc_is_not_publicly_authorized_for_arbitrary_homeservers(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config.generate('chat.example.test', root)
            livekit = json.loads((root / 'runtime/livekit.yaml').read_text())
            self.assertFalse(livekit['room']['auto_create'])
            self.assertIn('LIVEKIT_FULL_ACCESS_HOMESERVERS=chat.example.test', (root / 'runtime/rtc.env').read_text())
            call = json.loads((root / 'runtime/element-call.json').read_text())
            self.assertNotIn('posthog', call)


if __name__ == '__main__':
    unittest.main()

"""The group file an agent writes, read the way the desktop plugin reads it."""
import json
import tempfile
import unittest
from pathlib import Path

from hermes_bridge.config import Config
from hermes_bridge.sections import normalize, read_inbox


class SectionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.config = Config(host="127.0.0.1", port=0, hermes_url="http://127.0.0.1:1",
                             hermes_home=self.home, state_dir=self.home / "state")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_missing_or_broken_file_is_empty(self):
        self.assertEqual(read_inbox(self.config), {"sections": [], "assign": {}, "digest": ""})
        for text in ("{not json", "[]", "\"Work\""):
            (self.home / "bot-sections.json").write_text(text, encoding="utf-8")
            self.assertEqual(read_inbox(self.config)["digest"], "")
        (self.home / "bot-sections.json").write_bytes(b"\xff\xfe")
        self.assertEqual(read_inbox(self.config)["sections"], [])

    def test_names_keys_and_unassigned_are_normalized(self):
        result = normalize({
            "sections": ["Work", "  Home  ", 3, "", "work", "Unassigned"],
            "assign": {" @News ": "work", "june": "Unassigned", "atlas": "Research",
                       "": "Work", "nova": "", "bad": 7, "@": "Home"},
        })
        self.assertEqual(result["sections"], ["Work", "Home", "Research"])
        self.assertEqual(result["assign"], {"news": "Work", "june": "", "atlas": "Research"})

    def test_digest_changes_with_the_text(self):
        path = self.home / "bot-sections.json"
        path.write_text(json.dumps({"sections": ["工作"], "assign": {"default": "工作"}}), encoding="utf-8")
        first = read_inbox(self.config)
        self.assertEqual(first["sections"], ["工作"])
        self.assertEqual(first["assign"], {"default": "工作"})
        self.assertEqual(len(first["digest"]), 64)
        path.write_text(json.dumps({"sections": ["工作", "生活"]}), encoding="utf-8")
        self.assertNotEqual(read_inbox(self.config)["digest"], first["digest"])


if __name__ == "__main__":
    unittest.main()

"""Session history uses Hermes' pagination without changing the main chat list."""
import unittest
from unittest.mock import Mock

from hermes_bridge.config import Config
from hermes_bridge.hermes import Hermes


class HistoryTest(unittest.TestCase):
    def setUp(self):
        self.hermes = Hermes(Config())

    def test_history_keeps_sources_and_paginates_by_window_not_backfilled_pins(self):
        self.hermes._call = Mock(return_value={
            "data": [
                {"id": "cron_news_20261031_090000", "source": "cron", "last_active": 3},
                {"id": "telegram-1", "source": "telegram", "last_active": 2},
                {"id": "pinned-1", "source": "cli", "pinned": True},
            ], "limit": 2, "offset": 20, "has_more": True,
        })
        page = self.hermes.history("nova", limit=2, offset=20)
        self.assertEqual(page["nextOffset"], 22)
        self.assertEqual([r["source"] for r in page["sessions"]], ["cron", "telegram", "cli"])
        self.assertEqual(page["sessions"][0]["bot"], "nova")
        path = self.hermes._call.call_args.args[2]
        self.assertIn("offset=20", path)
        self.assertNotIn("source=api_server", path)

    def test_history_unknown_sources_are_not_fabricated_and_duplicates_removed(self):
        self.hermes._call = Mock(return_value={"sessions": [
            {"id": "a", "source": "future-channel"}, {"id": "a"}, {"id": "b"}, None,
        ], "has_more": False})
        page = self.hermes.history("default", limit=50, offset=0)
        self.assertIsNone(page["nextOffset"])
        self.assertEqual([r["source"] for r in page["sessions"]], ["future-channel", ""])

    def test_message_pages_preserve_roles_and_cursor(self):
        self.hermes._call = Mock(return_value={"data": [
            {"id": 100, "role": "tool", "content": "tool result", "timestamp": 1},
            {"id": 101, "role": "assistant", "content": [{"type": "text", "text": "news"}]},
        ], "pagination": {"limit": 2, "offset": 50, "returned": 2}})
        page = self.hermes.message_page("nova", "id/needs encoding", limit=2, offset=50)
        self.assertEqual(page["nextOffset"], 52)
        self.assertEqual(page["messages"][0]["role"], "tool")
        self.assertEqual(page["messages"][1]["content"], "news")
        path = self.hermes._call.call_args.args[2]
        self.assertIn("id%2Fneeds%20encoding", path)
        self.assertIn("offset=50", path)
        self.assertIn("order=oldest", path)
        self.hermes._call.return_value = {"data": [], "pagination": {"returned": 0}}
        self.assertIsNone(self.hermes.message_page("nova", "a", 2, 52)["nextOffset"])

    def test_message_cursor_and_fallback_ids_count_non_message_rows(self):
        self.hermes._call = Mock(return_value={"data": [None, {"role": "tool", "content": "ok"}]})
        page = self.hermes.message_page("nova", "a", 2, 50)
        self.assertEqual(page["nextOffset"], 52)
        self.assertEqual(page["messages"][0]["id"], "a:51")
        self.hermes._call.return_value = {"data": {"unexpected": "shape", "more": True}}
        page = self.hermes.message_page("nova", "a", 2, 52)
        self.assertEqual(page["messages"], [])
        self.assertIsNone(page["nextOffset"])


if __name__ == "__main__":
    unittest.main()

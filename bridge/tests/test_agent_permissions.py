"""Agent permissions and summarised role tags, through the phone's API."""
from __future__ import annotations

import unittest
from unittest.mock import patch

import yaml

from hermes_bridge.labeler import clean
import test_bridge


class CleanTest(unittest.TestCase):
    def test_strips_noise(self):
        self.assertEqual(clean("<think>x</think>\n标签：「新闻编辑」。", True), "新闻编辑")
        self.assertEqual(clean('Label: "Research Lead."', False), "Research Lead")
        self.assertLessEqual(len(clean("一" * 50, True)), 12)
        with self.assertRaises(Exception):
            clean("  \n「」", True)


class PermissionApiTest(test_bridge.BridgeTest):
    def setUp(self):
        hot = patch("hermes_bridge.profiles.hot_serve")
        hot.start()
        self.addCleanup(hot.stop)
        super().setUp()

    def settings(self):
        path = self.home / "profiles" / "nova" / "config.yaml"
        return yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {}

    def test_toggle_writes_and_removes_tool_server(self):
        status, body = self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": True})
        self.assertEqual(status, 200, body)
        self.assertTrue(body["permissions"]["crossSpace"])
        self.assertIn("hermes_agents", self.settings().get("mcp_servers", {}))
        status, body = self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": False})
        self.assertEqual(status, 200, body)
        self.assertNotIn("hermes_agents", self.settings().get("mcp_servers") or {})

    def test_rejects_non_bool_and_device_token_on_tool_route(self):
        status, _ = self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": "yes"})
        self.assertEqual(status, 400)
        status, _ = self.call("POST", "/v1/agents/tool", {"name": "list_agents", "arguments": {}})
        self.assertEqual(status, 401)

    def test_instructions_reach_the_turn(self):
        self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": True})
        status, session = self.call("POST", "/v1/sessions", {"bot": "nova", "title": "t"})
        self.assertIn(status, (200, 201), session)
        sid = session["session"]["id"]
        self.stream("nova", sid, {"message": "hi"})
        self.assertIn("mcp__hermes_agents__", str(self.fake.last_turn["body"]))

    def test_manual_tag_is_not_auto(self):
        status, body = self.call("POST", "/v1/bots/nova/tag", {"tag": "新闻编辑"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["bot"]["tag"], "新闻编辑")
        self.assertFalse(body["bot"].get("tagAuto"))
        status, _ = self.call("POST", "/v1/bots/nova/tag", {})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()

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

    def test_message_agent_gets_the_reply_and_labels_the_new_session(self):
        status, body = self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": True})
        self.assertEqual(status, 200, body)
        agent = (self.state / "agent-tools" / "nova.token").read_text(encoding="utf-8").strip()
        status, listed = self.call("POST", "/v1/agents/tool", {"name": "list_agents", "arguments": {}}, token=agent)
        self.assertEqual(status, 200, listed)
        self.assertIn("default", [row["id"] for row in listed["result"]["agents"]])
        status, sent = self.call("POST", "/v1/agents/tool",
                                 {"name": "message_agent", "arguments": {"agent": "default", "message": "状态？"}},
                                 token=agent)
        self.assertEqual(status, 200, sent)
        self.assertEqual(sent["result"]["reply"], "Deploy 412 is green.")
        self.assertIn("another Hermes agent", self.fake.last_turn["body"]["message"])
        status, rows = self.call("GET", "/v1/sessions?bot=default")
        self.assertEqual(status, 200, rows)
        opened = [row for row in rows["sessions"] if row["id"] == sent["result"]["session"]]
        self.assertTrue(opened and opened[0].get("fromAgent"), rows)
        self.assertFalse(any(row.get("fromAgent") for row in rows["sessions"] if row["id"] != sent["result"]["session"]))

    def test_switched_off_agent_cannot_message(self):
        self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": True})
        agent = (self.state / "agent-tools" / "nova.token").read_text(encoding="utf-8").strip()
        self.call("PUT", "/v1/bots/nova/permissions", {"crossSpace": False})
        status, _ = self.call("POST", "/v1/agents/tool",
                              {"name": "message_agent", "arguments": {"agent": "default", "message": "x"}}, token=agent)
        self.assertEqual(status, 401)

    def test_manual_tag_is_not_auto(self):
        status, body = self.call("POST", "/v1/bots/nova/tag", {"tag": "新闻编辑"})
        self.assertEqual(status, 200, body)
        self.assertEqual(body["bot"]["tag"], "新闻编辑")
        self.assertFalse(body["bot"].get("tagAuto"))
        status, _ = self.call("POST", "/v1/bots/nova/tag", {})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()

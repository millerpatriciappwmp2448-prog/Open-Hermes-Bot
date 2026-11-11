"""Server-owned group waves survive navigation, retries and bridge restarts."""
import copy
import json
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace

from hermes_bridge.hermes import HermesError
from hermes_bridge.turns import Turns
from hermes_bridge.groups import Groups, group_id


class RoundHost:
    """A detached-run host: messages belong to Hermes, not the coordinator."""
    def __init__(self):
        self.histories = {"s-a": [], "s-b": []}
        self.runs, self.keys, self.starts = {}, {}, []
        self.outputs = {"a": ["Please check @Beta", "Final decision"], "b": ["[[silent]]", "Checked"]}
        self.state = "completed"
        self.clock = 100
        self.lose_acceptance = False

    def message_page(self, bot, session, limit, offset):
        rows = copy.deepcopy(self.histories[session][offset:offset + limit])
        return {"messages": rows, "nextOffset": offset + limit if offset + limit < len(self.histories[session]) else None}

    def start_run(self, bot, session, message, model, provider, request_id, instructions=""):
        if request_id not in self.keys:
            rid = f"r{len(self.runs)}"
            self.keys[request_id] = rid
            output = self.outputs[bot].pop(0) if self.outputs[bot] else "[[silent]]"
            self.clock += 1
            self.histories[session].append({"role": "user", "content": message, "timestamp": self.clock})
            self.clock += 1
            self.runs[rid] = {"run_id": rid, "session_id": session, "status": self.state, "output": output}
            if self.state == "completed":
                self.histories[session].append({"role": "assistant", "content": output, "timestamp": self.clock})
            self.starts.append(dict(bot=bot, session=session, message=message, model=model, provider=provider, instructions=instructions))
            if self.lose_acceptance:
                self.lose_acceptance = False
                raise HermesError(502, "unreachable", "Lost acceptance")
        return copy.deepcopy(self.runs[self.keys[request_id]])

    def run_status(self, bot, rid):
        return copy.deepcopy(self.runs[rid])

    def run_events(self, *args):
        return iter(())

    def stop_run(self, bot, rid):
        self.runs[rid]["status"] = "cancelled"


class GroupRoundsTest(unittest.TestCase):
    def setUp(self):
        from hermes_bridge.group_rounds import GroupRounds
        self.tmp = tempfile.TemporaryDirectory()
        self.config = SimpleNamespace(state_dir=Path(self.tmp.name), hermes_home=Path(self.tmp.name))
        self.host = RoundHost()
        self.members = [{"bot": "a", "name": "Alpha", "sessionId": "s-a"}, {"bot": "b", "name": "Beta", "sessionId": "s-b"}]
        self.group = {"id": group_id("Work"), "name": "Work", "members": self.members}
        self.groups = Groups(self.config, self.host)
        self.groups.list = lambda: [copy.deepcopy(self.group)]
        self.coordinator = GroupRounds(self.config, self.groups, Turns(self.config, self.host),
            instructions=lambda bot: "Enforce permissions for " + bot, automatic=False)

    def tearDown(self):
        self.coordinator.close()
        self.tmp.cleanup()

    def finish(self, coordinator=None, request="first"):
        coordinator = coordinator or self.coordinator
        for _ in range(12):
            coordinator.advance(self.group["id"], request)
            result = coordinator.get(self.group["id"], request)
            if result["status"] in ("completed", "failed", "cancelled"):
                return result
        self.fail("round did not finish")

    def test_group_broadcast_then_mention_uses_member_models_permissions_and_hides_protocol(self):
        from hermes_bridge import prefs
        prefs.write(self.config, {"picks": {"a": {"model": "model-a", "provider": "one"}, "b": {"model": "model-b", "provider": "two"}}})
        self.coordinator.start(self.group["id"], "first", "Plan the release")
        result = self.finish()
        self.assertEqual(result["status"], "completed")
        self.assertEqual([row["bot"] for row in self.host.starts], ["a", "b", "b"])
        self.assertEqual([(row["model"], row["provider"]) for row in self.host.starts], [("model-a", "one"), ("model-b", "two"), ("model-b", "two")])
        self.assertIn("Enforce permissions for a", self.host.starts[0]["instructions"])
        self.assertIn("You never write another member", self.host.starts[0]["instructions"])
        self.assertIn("@Alpha mentioned you by name", self.host.starts[-1]["message"])
        self.assertNotIn("[[silent]]", json.dumps(result))
        self.assertEqual([row["text"] for row in result["messages"]], ["Plan the release", "Please check @Beta", "Checked"])
        self.assertEqual(result["messages"][0]["reaction"]["count"], 1)

    def test_lost_acceptance_retry_and_restart_do_not_resubmit_a_different_transcript(self):
        from hermes_bridge.group_rounds import GroupRounds
        self.host.lose_acceptance = True
        self.coordinator.start(self.group["id"], "first", "Do not duplicate me")
        self.coordinator.advance(self.group["id"], "first")
        restored = GroupRounds(self.config, self.groups, Turns(self.config, self.host), automatic=False)
        restored.start(self.group["id"], "first", "Do not duplicate me")
        result = self.finish(restored)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(self.host.starts), 3)
        with self.assertRaises(HermesError) as conflict:
            restored.start(self.group["id"], "first", "Another message")
        self.assertEqual(conflict.exception.status, 409)
        manifest = json.loads((self.config.state_dir / "group-rounds.json").read_text())
        self.assertNotIn("Do not duplicate me", json.dumps(manifest))
        self.assertNotIn("Please check @Beta", json.dumps(manifest))

    def test_restart_resumes_without_phone_reposting_message(self):
        from hermes_bridge.group_rounds import GroupRounds
        self.coordinator.start(self.group["id"], "first", "Continue while phone is away")
        self.coordinator.advance(self.group["id"], "first")
        restored = GroupRounds(self.config, self.groups, Turns(self.config, self.host), automatic=False)
        result = self.finish(restored)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(self.host.starts), 3)

    def test_stop_prevents_handoff_and_rejects_simultaneous_rounds(self):
        self.host.state = "running"
        self.coordinator.start(self.group["id"], "first", "Long task")
        self.coordinator.advance(self.group["id"], "first")
        with self.assertRaises(HermesError) as conflict:
            self.coordinator.start(self.group["id"], "second", "Another task")
        self.assertEqual(conflict.exception.status, 409)
        result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "cancelled")
        self.assertTrue(all(run["status"] == "cancelled" for run in self.host.runs.values()))
        self.coordinator.advance(self.group["id"], "first")
        self.assertEqual(len(self.host.starts), 2)

    def test_handoff_loop_ends_after_two_lines_per_member(self):
        self.host.outputs = {"a": ["@Beta answer", "@Beta again", "@Beta too many"], "b": ["@Alpha answer", "@Alpha again", "@Alpha too many"]}
        self.coordinator.start(self.group["id"], "first", "Discuss")
        result = self.finish()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(self.host.starts), 4)

    def test_reaction_only_and_silent_are_successful_without_extra_waves(self):
        self.host.outputs = {"a": ["[[react:👍]]"], "b": ["[[silent]]"]}
        self.coordinator.start(self.group["id"], "first", "Acknowledge")
        result = self.finish()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(result["messages"]), 1)
        self.assertEqual(result["messages"][0]["reaction"]["count"], 2)

    def test_responded_contains_only_this_rounds_spoken_members_and_survives_restart(self):
        from hermes_bridge.group_rounds import GroupRounds
        self.host.outputs = {"a": ["A fresh answer"], "b": ["[[react:👍]]"]}
        self.host.histories["s-b"] = [{"role": "assistant", "content": "An old answer", "timestamp": 1}]
        self.coordinator.start(self.group["id"], "first", "One answer only")
        result = self.finish()
        self.assertEqual(result["responded"], ["a"])
        restored = GroupRounds(self.config, self.groups, Turns(self.config, self.host), automatic=False)
        self.assertEqual(restored.get(self.group["id"], "first")["responded"], ["a"])

    def test_stop_does_not_report_cancelled_until_each_member_is_terminal(self):
        self.host.state = "running"
        self.coordinator.start(self.group["id"], "first", "Long task")
        self.coordinator.advance(self.group["id"], "first")
        with patch.object(self.host, "stop_run", return_value={}):
            result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "running", "a stop acknowledgement is not proof the agent stopped")
        self.assertTrue(self.coordinator.busy(self.group["id"]))
        result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "cancelled")

    def test_invalid_input_and_unknown_group_cannot_start_runs(self):
        for message in (None, "", "   ", 123, "x" * 32001):
            with self.assertRaises(HermesError):
                self.coordinator.start(self.group["id"], "first", message)
        with self.assertRaises(HermesError):
            self.coordinator.start("missing", "first", "hello")
        self.assertEqual(self.host.starts, [])

    def test_long_first_wave_is_lossless_and_restarts_after_lost_acceptance(self):
        from hermes_bridge.group_rounds import GroupRounds
        message = "Start of task " + "长" * 7000 + " end of task"
        self.host.lose_acceptance = True
        self.coordinator.start(self.group["id"], "first", message)
        self.coordinator.advance(self.group["id"], "first")
        restored = GroupRounds(self.config, self.groups, Turns(self.config, self.host), automatic=False)
        result = self.finish(restored)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(len(self.host.starts), 3)
        self.assertTrue(any(item["from"] == "user" and item["text"] == message for item in result["messages"]))
        self.assertIn(message, self.host.starts[0]["message"])

    def test_failed_history_read_does_not_advance_or_double_count_a_wave(self):
        self.coordinator.start(self.group["id"], "first", "Discuss")
        read = self.groups.histories
        calls = 0
        def failing(group):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise HermesError(503, "unreachable", "History temporarily unavailable")
            return read(group)
        with patch.object(self.groups, "histories", side_effect=failing):
            with self.assertRaises(HermesError):
                self.coordinator.advance(self.group["id"], "first")
        row = self.coordinator.rows[self.coordinator.key(self.group["id"], "first")]
        self.assertEqual(row["wave"], 0)
        self.assertEqual(row["counts"], {})
        result = self.finish()
        self.assertEqual(result["wave"], 2)
        self.assertEqual(len(self.host.starts), 3)

    def test_cancel_before_submission_does_not_require_hermes_history(self):
        self.coordinator.start(self.group["id"], "first", "Do not start")
        with patch.object(self.groups, "histories", side_effect=HermesError(503, "unreachable", "Offline")):
            result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(self.host.starts, [])

    def test_cancel_frozen_but_unsubmitted_wave_does_not_start_members(self):
        self.coordinator.start(self.group["id"], "first", "Do not start")
        # Simulate shutdown after saving the wave but before submitting it.
        row = self.coordinator.rows[self.coordinator.key(self.group["id"], "first")]
        row["plan"] = {"cuts": {"a": 0, "b": 0}, "floors": [{"bot": "a"}, {"bot": "b"}]}
        row["status"] = "running"
        self.coordinator._save()
        result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(self.host.starts, [], "stop must not launch a saved but unsubmitted wave")

    def test_stop_accepted_members_does_not_depend_on_history(self):
        self.host.state = "running"
        self.coordinator.start(self.group["id"], "first", "Long task")
        self.coordinator.advance(self.group["id"], "first")
        with patch.object(self.groups, "histories", side_effect=HermesError(503, "unreachable", "Offline")):
            result = self.coordinator.stop(self.group["id"], "first")
        self.assertEqual(result["status"], "cancelled")
        self.assertEqual(len(self.host.starts), 2)
        self.assertTrue(all(run["status"] == "cancelled" for run in self.host.runs.values()))

    def test_permanent_discovery_error_is_visible_and_does_not_spin_forever(self):
        self.coordinator.start(self.group["id"], "first", "Cannot read session")
        self.coordinator.automatic = True
        with patch.object(self.groups, "histories", side_effect=HermesError(403, "forbidden", "Session access denied")):
            self.coordinator.resume()
            worker = next(iter(self.coordinator.workers.values()), None)
            if worker:
                worker.join(2)
        result = self.coordinator.get(self.group["id"], "first", include_messages=False)
        self.assertEqual(result["status"], "failed")
        self.assertIn("Session access denied", result["error"])
        self.assertEqual(self.host.starts, [])

    def test_shutdown_drains_worker_and_prevents_late_journal_writes(self):
        self.coordinator.start(self.group["id"], "first", "Shutdown")
        entered, release, exited, closed = (threading.Event() for _ in range(4))
        def advancing(*args):
            entered.set()
            release.wait(2)
            self.coordinator._save()
            exited.set()
        self.coordinator.automatic = True
        with patch.object(self.coordinator, "advance", side_effect=advancing), patch.object(self.coordinator, "_save", wraps=self.coordinator._save):
            self.coordinator.resume()
            self.assertTrue(entered.wait(2))
            closer = threading.Thread(target=lambda: (self.coordinator.close(), closed.set()))
            closer.start()
            self.assertFalse(closed.wait(.05), "close must wait for its in-flight worker")
            with patch("hermes_bridge.group_rounds._write_private") as write:
                release.set()
                self.assertTrue(closed.wait(2))
                closer.join(2)
                self.assertTrue(exited.is_set())
                write.assert_not_called()

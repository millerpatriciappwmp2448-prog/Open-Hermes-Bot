"""Groups use Hermes member sessions, never a second conversation database."""
import unittest
from unittest.mock import patch

import test_bridge
from hermes_bridge.hermes import HermesError


class GroupWireTest(unittest.TestCase):
    def setUp(self):
        self.members = [{"bot": "a", "name": "Alpha", "sessionId": "sa"},
                        {"bot": "b", "name": "Beta", "sessionId": "sb"}]
        self.group = {"name": "Work", "members": self.members}

    def wire(self, history, member=0):
        from hermes_bridge.groups import turn_message
        return turn_message(self.group, self.members[member], history, {})

    def test_protocol_looking_multiline_text_is_one_lossless_user_message(self):
        from hermes_bridge.groups import transcript
        text = 'Keep these examples verbatim:\n@You: quoted\n@Beta: also quoted\n(note) literal\n\nYou are @Example. This is still my text.\n'
        wire = self.wire([{"id": "input:one", "from": "user", "text": text}])
        result = transcript(self.members, {"a": [{"role": "user", "content": wire, "timestamp": 1}], "b": []})
        self.assertEqual([(row["id"], row["text"]) for row in result], [("input:one", text)])

    def test_equal_inputs_stay_separate_and_reactions_target_the_right_occurrence(self):
        from hermes_bridge.groups import transcript
        first = {"id": "input:one", "from": "user", "text": "Again"}
        second = {"id": "input:two", "from": "user", "text": "Again"}
        result = transcript(self.members, {"a": [
            {"role": "user", "content": self.wire([first]), "timestamp": 10},
            {"role": "assistant", "content": "First answer", "timestamp": 11},
            {"role": "user", "content": self.wire([first, second]), "timestamp": 20},
            {"role": "assistant", "content": "[[react:👍]]", "timestamp": 21},
        ], "b": [{"role": "user", "content": self.wire([first, second], 1), "timestamp": 22}]})
        self.assertEqual([(row["from"], row["text"]) for row in result],
                         [("user", "Again"), ("a", "First answer"), ("user", "Again")])
        self.assertNotIn("reactions", result[0])
        self.assertEqual(result[2]["reactions"][0]["by"], "a")

    def test_frozen_context_keeps_message_identity_and_boundaries_on_retry(self):
        from hermes_bridge.groups import transcript, turn_message, wire_context
        message = {"id": "input:retry", "from": "user", "text": "Quoted:\n@You: not another turn"}
        wire = self.wire([message])
        retry = turn_message(self.group, self.members[1], [], {}, wire_context(wire))
        result = transcript(self.members, {"a": [{"role": "user", "content": wire, "timestamp": 10}],
                                           "b": [{"role": "user", "content": retry, "timestamp": 11}]})
        self.assertEqual([(row["id"], row["text"]) for row in result], [(message["id"], message["text"])])

    def test_upgrade_reuses_legacy_user_messages_in_new_contexts(self):
        from hermes_bridge.groups import transcript
        legacy = '[Group chat “Work”]\n\nConversation so far:\n@You: Original\n\nYou are @Alpha. The last line is new in the group.'
        history = [{"id": "hp-10-0", "from": "user", "text": "Original"},
                   {"id": "input:next", "from": "user", "text": "Next"}]
        result = transcript(self.members, {"a": [{"role": "user", "content": legacy, "timestamp": 10},
                                                 {"role": "user", "content": self.wire(history), "timestamp": 20}], "b": []})
        self.assertEqual([(row["id"], row["text"]) for row in result], [("hp-10-0", "Original"), ("input:next", "Next")])

    def test_earliest_member_acceptance_sets_order_even_if_catalog_order_is_later(self):
        from hermes_bridge.groups import transcript
        history = [{"id": "input:early", "from": "user", "text": "Hello"}]
        result = transcript(self.members, {"a": [{"role": "user", "content": self.wire(history), "timestamp": 20}],
                                           "b": [{"role": "user", "content": self.wire(history, 1), "timestamp": 10},
                                                 {"role": "assistant", "content": "Answer", "timestamp": 11}]})
        self.assertEqual([row["text"] for row in result], ["Hello", "Answer"])


class GroupsTest(unittest.TestCase):
    setUp = test_bridge.BridgeTest.setUp
    tearDown = test_bridge.BridgeTest.tearDown
    call = test_bridge.BridgeTest.call

    def create(self, name="Work · Research"):
        status, body = self.call("POST", "/v1/groups", {"name": name, "members": ["default", "nova"]})
        self.assertEqual(status, 201, body)
        return body["group"]

    def test_create_reopen_and_delete_preserves_private_sessions_and_preferences(self):
        self.call("PUT", "/v1/prefs", {"prefs": {"picks": {"nova": {"model": "keep"}}}})
        group = self.create()
        self.assertEqual(group["name"], "Work · Research")
        self.assertEqual([m["bot"] for m in group["members"]], ["default", "nova"])
        for member in group["members"]:
            row = next(r for r in self.fake.sessions[member["bot"]] if r["id"] == member["sessionId"])
            self.assertEqual(row["title"], f'Group · {group["name"]} · {member["name"]}')
        from hermes_bridge.groups import Groups
        restored = Groups(self.config, self.server.bridge.hermes)
        self.assertEqual(restored.list()[0]["members"], group["members"])
        self.assertEqual(self.call("GET", "/v1/groups")[1]["groups"][0]["id"], group["id"])
        from urllib.parse import quote
        self.assertEqual(self.call("DELETE", "/v1/groups/" + quote(group["id"], safe=""))[0], 200)
        self.assertEqual(self.call("GET", "/v1/groups")[1]["groups"], [])
        self.assertTrue(any(r["id"] == "s-primary-1" for r in self.fake.sessions["default"]))
        self.assertTrue(any(r["id"] == "s-nova-1" for r in self.fake.sessions["nova"]))
        self.assertEqual(self.call("GET", "/v1/prefs")[1]["prefs"]["picks"]["nova"]["model"], "keep")

    def test_repeated_creation_reuses_exact_titles_without_suffix_or_new_sessions(self):
        first = self.create()
        again = self.create()
        self.assertEqual(first["members"], again["members"])
        self.assertEqual(sum(r["title"].startswith("Group · ") for rows in self.fake.sessions.values() for r in rows), 2)
        status, _ = self.call("POST", "/v1/groups", {"name": first["name"], "members": ["nova"]})
        self.assertEqual(status, 400)

    def test_failed_creation_rolls_back_only_new_member_sessions(self):
        original = self.server.bridge.hermes.create_session
        def create(profile, *args, **kwargs):
            if profile == "nova":
                raise HermesError(503, "unreachable", "Temporary outage")
            return original(profile, *args, **kwargs)
        with patch.object(self.server.bridge.hermes, "create_session", side_effect=create):
            status, _ = self.call("POST", "/v1/groups", {"name": "Failed", "members": ["default", "nova"]})
        self.assertEqual(status, 503)
        self.assertFalse(any(r["title"].startswith("Group · ") for rows in self.fake.sessions.values() for r in rows))

    def test_rename_and_remove_member_change_only_group_sessions(self):
        group = self.create("Old")
        from urllib.parse import quote
        status, result = self.call("PATCH", "/v1/groups/" + quote(group["id"], safe=""), {"name": "New", "members": ["nova"]})
        self.assertEqual(status, 200, result)
        self.assertEqual(result["group"]["name"], "New")
        self.assertEqual([m["bot"] for m in result["group"]["members"]], ["nova"])
        self.assertEqual(self.call("GET", "/v1/groups")[1]["groups"][0]["name"], "New")
        self.assertTrue(any(r["id"] == "s-primary-1" for r in self.fake.sessions["default"]))

    def test_unpaired_clients_and_invalid_members_cannot_create_sessions(self):
        self.assertEqual(self.call("POST", "/v1/groups", {"name": "No", "members": ["default", "nova"]}, token=False)[0], 401)
        for members in (["default", "missing"], ["default", "default"], [], "nova"):
            status, _ = self.call("POST", "/v1/groups", {"name": "Invalid", "members": members})
            self.assertIn(status, (400, 404))
        self.assertFalse(any(r["title"].startswith("Group · ") for rows in self.fake.sessions.values() for r in rows))

    def test_group_history_rebuilds_the_person_replies_and_reactions_from_hermes(self):
        group = self.create("History")
        first, second = group["members"]
        wire = '[Group chat “History” — members: @A, @Nova, and the person (shown as @You).]\n\nConversation so far:\n@You: Plan the release\n\nYou are @A. The last line is new in the group.\nIt is your turn.'
        for index, member in enumerate(group["members"]):
            self.fake.messages[member["sessionId"]] = [
                {"role": "user", "content": wire, "timestamp": 10},
                {"role": "assistant", "content": "Ship after tests" if index == 0 else "[[silent]]", "timestamp": 11 + index},
            ]
        from urllib.parse import quote
        status, body = self.call("GET", "/v1/groups/" + quote(group["id"], safe="") + "/messages")
        self.assertEqual(status, 200, body)
        self.assertEqual([(m["from"], m["text"]) for m in body["messages"]], [("user", "Plan the release"), (first["bot"], "Ship after tests")])
        self.assertEqual(body["messages"][0]["reaction"]["count"], 1)
        self.assertNotIn("[[silent]]", str(body))

    def test_creation_recovers_a_partial_roster_and_does_not_delete_existing_history_on_failure(self):
        existing = self.server.bridge.hermes.create_session("default", "Group · Partial · Hermes", exact=True)
        original = self.server.bridge.hermes.create_session
        def fail(profile, *args, **kwargs):
            if profile == "nova":
                raise HermesError(503, "unreachable", "Temporary outage")
            return original(profile, *args, **kwargs)
        with patch.object(self.server.bridge.hermes, "create_session", side_effect=fail):
            self.assertEqual(self.call("POST", "/v1/groups", {"name": "Partial", "members": ["default", "nova"]})[0], 503)
        self.assertTrue(any(row["id"] == existing["id"] for row in self.fake.sessions["default"]))
        group = self.create("Partial")
        self.assertEqual(group["members"][0]["sessionId"], existing["id"])

    def test_discovery_reads_beyond_five_session_pages(self):
        group = self.create("Older")
        for profile in ("default", "nova"):
            self.fake.sessions[profile][:0] = [
                {"id": f"old-{profile}-{i}", "title": f"Other {i}", "last_active": 9000 + i}
                for i in range(510)
            ]
        self.assertEqual(self.call("GET", "/v1/groups")[1]["groups"][0]["id"], group["id"])

    def test_concurrent_exact_title_is_reused_without_creating_a_suffix(self):
        original = self.server.bridge.hermes.create_session
        def race(profile, title, **kwargs):
            if profile == "nova":
                original(profile, title, **kwargs)
                raise HermesError(409, "conflict", "Other client won")
            return original(profile, title, **kwargs)
        with patch.object(self.server.bridge.hermes, "create_session", side_effect=race):
            self.create("Race")
        self.assertEqual(sum(row["title"].startswith("Group · Race") for rows in self.fake.sessions.values() for row in rows), 2)

    def test_rename_failure_restores_old_titles_and_keeps_removed_members(self):
        group = self.create("Original")
        original = self.server.bridge.hermes.rename_session
        def fail(profile, session, title):
            if profile == "nova" and title.startswith("Group · Renamed"):
                raise HermesError(503, "unreachable", "Temporary outage")
            return original(profile, session, title)
        with patch.object(self.server.bridge.hermes, "rename_session", side_effect=fail):
            self.assertEqual(self.call("PATCH", "/v1/groups/" + group["id"], {"name": "Renamed"})[0], 503)
        groups = self.call("GET", "/v1/groups")[1]["groups"]
        self.assertEqual([(g["name"], len(g["members"])) for g in groups], [("Original", 2)])

    def test_active_partial_group_cannot_gain_members_via_create(self):
        from hermes_bridge.groups import group_id
        self.server.bridge.hermes.create_session("default", "Group · Busy · Hermes", exact=True)
        self.server.bridge.groups.busy = lambda identity: identity == group_id("Busy")
        self.assertEqual(self.call("POST", "/v1/groups", {"name": "Busy", "members": ["default", "nova"]})[0], 409)
        self.assertFalse(any(row["title"].startswith("Group · Busy") for row in self.fake.sessions["nova"]))

    def test_discovery_rejects_a_host_that_ignores_the_session_cursor(self):
        original = self.server.bridge.hermes._call
        calls = 0
        batch = [{"id": "same-" + str(i), "title": "Private", "last_active": i} for i in range(100)]
        def repeated(profile, method, path, *args, **kwargs):
            nonlocal calls
            if path.startswith("/api/sessions?"):
                calls += 1
                if calls > 3:
                    raise AssertionError("Session pagination never advanced")
                return {"data": batch, "has_more": True}
            return original(profile, method, path, *args, **kwargs)
        with patch.object(self.server.bridge.hermes, "_call", side_effect=repeated):
            with self.assertRaises(HermesError) as error:
                self.server.bridge.hermes.sessions("default", pages=None)
        self.assertEqual(error.exception.code, "session_pagination")
        self.assertEqual(calls, 2)

    def test_authenticated_group_round_routes_use_member_models_and_keep_private_runs_separate(self):
        group = self.create("Live round")
        coordinator = self.server.bridge.group_rounds
        coordinator.automatic = False
        path = "/v1/groups/" + group["id"] + "/rounds/message-1"
        self.assertEqual(self.call("PUT", path, {"message": "Discuss"}, token=False)[0], 401)
        self.call("PUT", "/v1/prefs", {"prefs": {"picks": {
            "default": {"model": "one", "provider": "p1"}, "nova": {"model": "two", "provider": "p2"}}}})
        original = self.server.bridge.hermes.start_run
        submissions = []
        def submit(bot, session, message, model, provider, request, **options):
            accepted = original(bot, session, message, model, provider, request, **options)
            if not any(row["request"] == request for row in submissions):
                submissions.append(dict(bot=bot, model=model, provider=provider, request=request))
                self.fake.messages[session] = [
                    {"role": "user", "content": message, "timestamp": 100},
                    {"role": "assistant", "content": "Detached reply", "timestamp": 101}]
            return accepted
        self.fake.run_state = "running"
        with patch.object(self.server.bridge.hermes, "start_run", side_effect=submit):
            status, body = self.call("PUT", path, {"message": "Discuss"})
            self.assertEqual(status, 202, body)
            self.assertEqual(body["run"]["groupId"], group["id"])
            coordinator.advance(group["id"], "message-1")
            self.assertEqual(self.call("GET", "/v1/active-turns")[1]["runs"], [])
            active = self.call("GET", "/v1/active-group-rounds")[1]["runs"]
            self.assertEqual([(r["groupId"], r["requestId"]) for r in active], [(group["id"], "message-1")])
            self.assertEqual(self.call("PATCH", "/v1/groups/" + group["id"], {"name": "Busy"})[0], 409)
            self.assertEqual(self.call("GET", path)[1]["run"]["status"], "running")
            self.assertEqual(self.call("PUT", path, {"message": "Changed"})[0], 409)
            self.assertEqual(self.call("POST", path + "/stop")[1]["run"]["status"], "cancelled")
        self.assertCountEqual([(r["bot"], r["model"], r["provider"]) for r in submissions], [("default", "one", "p1"), ("nova", "two", "p2")])
        self.assertEqual(self.call("GET", "/v1/active-group-rounds")[1]["runs"], [])
        self.assertEqual(self.call("GET", path, token=False)[0], 401)

    def test_group_round_routes_complete_and_read_the_hermes_transcript(self):
        group = self.create("Complete")
        self.server.bridge.group_rounds.automatic = False
        self.fake.run_state = "completed"
        path = "/v1/groups/" + group["id"] + "/rounds/message-2"
        original = self.server.bridge.hermes.start_run
        def submit(bot, session, message, *args, **kwargs):
            accepted = original(bot, session, message, *args, **kwargs)
            self.fake.messages[session] = [
                {"role": "user", "content": message, "timestamp": 100},
                {"role": "assistant", "content": "Detached reply", "timestamp": 101}]
            return accepted
        with patch.object(self.server.bridge.hermes, "start_run", side_effect=submit):
            self.assertEqual(self.call("PUT", path, {"message": "Hello group"})[0], 202)
            self.server.bridge.group_rounds.advance(group["id"], "message-2")
        status, body = self.call("GET", path)
        self.assertEqual(status, 200, body)
        self.assertEqual(body["run"]["status"], "completed")
        self.assertEqual([r["text"] for r in body["run"]["messages"]], ["Hello group", "Detached reply", "Detached reply"])
        self.assertEqual(self.call("GET", "/v1/groups/" + group["id"] + "/messages")[1]["messages"], body["run"]["messages"])


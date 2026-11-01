"""The task list rules, checked against what Hermes' own todo tool does."""

from __future__ import annotations

import json
import unittest

from hermes_bridge import todos


def item(item_id: str, status: str = "pending", content: str | None = None, **extra) -> dict:
    return {"id": item_id, "content": content or f"step {item_id}", "status": status, **extra}


def call_row(call_id: str, name: str = "todo_list", arguments: object = "{}") -> dict:
    if not isinstance(arguments, str):
        arguments = json.dumps(arguments)
    return {
        "role": "assistant",
        "content": "",
        "tool_calls": [{"id": call_id, "function": {"name": name, "arguments": arguments}}],
    }


def result_row(call_id: str, payload: object, name: str = "todo_list") -> dict:
    content = payload if isinstance(payload, str) else json.dumps(payload)
    return {"role": "tool", "tool_call_id": call_id, "tool_name": name, "content": content}


class ReplaceTest(unittest.TestCase):
    def test_a_duplicate_id_keeps_the_last_copy_where_it_last_appeared(self):
        out = todos.replace([item("a", content="old"), item("b"), item("a", content="new")])
        self.assertEqual([(row["id"], row["content"]) for row in out], [("b", "step b"), ("a", "new")])

    def test_the_step_in_progress_moves_ahead_of_an_earlier_pending_one(self):
        out = todos.replace([item("a", "completed"), item("b"), item("c", "in_progress")])
        self.assertEqual([row["id"] for row in out], ["a", "c", "b"])

    def test_an_empty_description_refuses_the_whole_write(self):
        self.assertIsNone(todos.replace([item("a"), {"id": "b", "content": "  "}]))

    def test_an_unknown_status_is_pending_and_a_dangling_parent_is_dropped(self):
        out = todos.replace([item("a", "later", parent="ghost")])
        self.assertEqual(out, [{"id": "a", "content": "step a", "status": "pending"}])

    def test_a_parent_cycle_is_broken(self):
        out = todos.replace([item("a", parent="b"), item("b", parent="a")])
        self.assertEqual(sum(1 for row in out if "parent" in row), 1)


class MergeTest(unittest.TestCase):
    def test_a_merge_updates_known_items_and_appends_new_ones(self):
        known = todos.replace([item("a"), item("b")])
        out = todos.merge(known, [{"id": "a", "status": "completed"}, item("c")])
        self.assertEqual(
            [(row["id"], row["status"]) for row in out],
            [("a", "completed"), ("b", "pending"), ("c", "pending")],
        )
        # The known list itself is left alone.
        self.assertEqual(known[0]["status"], "pending")

    def test_a_merge_adding_an_empty_item_is_refused(self):
        self.assertIsNone(todos.merge([], [{"id": "x", "content": ""}]))

    def test_expected_tells_a_read_from_a_write(self):
        self.assertIsNone(todos.expected([], {}))
        self.assertEqual(todos.expected([], {"todos": []}), [])
        merged = todos.expected(todos.replace([item("a")]), {"todos": [{"id": "a", "status": "cancelled"}], "merge": True})
        self.assertEqual(merged[0]["status"], "cancelled")


class CallArgumentsTest(unittest.TestCase):
    def test_a_direct_call_and_its_string_arguments(self):
        self.assertEqual(todos.call_arguments("todo", '{"todos": []}'), {"todos": []})
        self.assertIsNone(todos.call_arguments("shell", {"todos": []}))

    def test_one_todo_call_inside_tool_call_is_read(self):
        wrapper = {"calls": [{"name": "shell", "arguments": {}}, {"name": "todo_list", "arguments": {"todos": [item("a")]}}]}
        self.assertEqual(todos.call_arguments("tool_call", wrapper)["todos"][0]["id"], "a")
        single = {"name": "todo_list", "arguments": json.dumps({"todos": []})}
        self.assertEqual(todos.call_arguments("tool_call", single), {"todos": []})

    def test_a_batch_writing_the_list_twice_is_left_to_the_result(self):
        wrapper = {"calls": [{"name": "todo_list", "arguments": {}}, {"name": "todo", "arguments": {}}]}
        self.assertIsNone(todos.call_arguments("tool_call", wrapper))


class LatestTest(unittest.TestCase):
    def test_the_newest_paired_result_wins_and_errors_are_skipped(self):
        rows = [
            {"role": "user", "content": "go"},
            call_row("c1"),
            result_row("c1", {"todos": [item("a", "completed")], "revision": 3}),
            call_row("c2"),
            result_row("c2", {"error": "boom"}),
        ]
        self.assertEqual(todos.latest(rows), {"todos": [item("a", "completed")], "revision": 3})

    def test_a_result_needs_the_assistant_turn_that_asked_for_it(self):
        rows = [call_row("c1", name="shell"), result_row("c1", {"todos": [item("a")]})]
        self.assertIsNone(todos.latest(rows))

    def test_a_result_at_the_top_of_the_page_is_taken_on_its_name(self):
        self.assertEqual(todos.latest([result_row("c0", {"todos": []})]), {"todos": [], "revision": 0})
        self.assertIsNone(todos.latest([result_row("c0", {"todos": []}, name="shell")]))

    def test_an_empty_list_is_a_real_answer(self):
        rows = [
            call_row("c1"),
            result_row("c1", {"todos": [item("a")], "revision": 1}),
            call_row("c2"),
            result_row("c2", {"todos": [], "revision": 2}),
        ]
        self.assertEqual(todos.latest(rows), {"todos": [], "revision": 2})

    def test_a_todo_call_inside_tool_call_pairs_with_its_result(self):
        wrapper = {"calls": [{"name": "todo_list", "arguments": {}}]}
        rows = [call_row("c1", name="tool_call", arguments=wrapper), result_row("c1", {"todos": [item("a")]}, name="tool_call")]
        self.assertEqual(todos.latest(rows)["todos"][0]["id"], "a")

    def test_an_oversized_result_is_ignored(self):
        huge = json.dumps({"todos": [item("a", content="x" * todos.MAX_RESULT_CHARS)]})
        self.assertIsNone(todos.latest([call_row("c1"), result_row("c1", huge)]))


if __name__ == "__main__":
    unittest.main()

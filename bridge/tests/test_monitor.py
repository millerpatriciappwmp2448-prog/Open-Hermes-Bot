"""Check measured usage, missing data and the authenticated HTTP boundary."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from hermes_bridge.monitor import Monitor, cpu_ticks, cpu_percent, memory_stats, gateway_stats


class MonitorTest(unittest.TestCase):
    def test_cpu_counts_guest_once_and_wait_as_idle(self):
        before = cpu_ticks("cpu 100 0 20 800 30 10 20 20 50 0\ncpu0 1 2 3 4")
        after = cpu_ticks("cpu 110 0 30 860 40 10 30 20 60 0")
        self.assertEqual(before, (1000, 830))
        self.assertEqual(cpu_percent(before, after), 30)
        self.assertIsNone(cpu_percent(before, before))
        self.assertIsNone(cpu_percent(after, before))
        self.assertIsNone(cpu_ticks("cpu nope"))
        self.assertIsNone(cpu_percent(None, after))

    def test_memory_uses_available_including_reclaimable_cache(self):
        self.assertEqual(memory_stats("MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB"),
                         {"totalBytes": 1024000, "usedBytes": 614400, "percent": 60})
        self.assertIsNone(memory_stats("MemTotal: 1000 kB\nMemFree: 100 kB"))
        self.assertIsNone(memory_stats("MemTotal: 1000 kB\nMemAvailable: 1001 kB"))

    def test_missing_metrics_remain_unknown_not_zero(self):
        result = gateway_stats({"version": "1.0", "active_agents": 0, "api_key": "secret",
                                "metrics_today": {"day": "2026-10-31", "requests": 0, "tokens": None}})
        self.assertEqual(result["activeAgents"], 0)
        self.assertEqual(result["usage"]["requests"], 0)
        self.assertIsNone(result["usage"]["tokens"])
        self.assertNotIn("secret", str(result))
        self.assertIsNone(gateway_stats({"metrics_today": {"day": "invalid", "tokens": -1}})["usage"]["day"])
        for value in (True, "123", -1, float("nan"), float("inf")):
            self.assertIsNone(gateway_stats({"active_agents": value})["activeAgents"])

    def test_snapshot_cache_and_unsupported_platform(self):
        with tempfile.TemporaryDirectory() as folder:
            monitor = Monitor(Path(folder), Path(folder) / "absent")
            with patch("hermes_bridge.monitor.shutil.disk_usage", side_effect=OSError):
                first = monitor.snapshot()
                self.assertIsNone(first["cpuPercent"])
                self.assertIsNone(first["memory"])
                self.assertIsNone(first["disk"])
                self.assertIs(first, monitor.snapshot())

    def test_gateway_metrics_are_mapped_without_extra_fields(self):
        result = gateway_stats({"version": "0.21.2", "active_agents": 2,
            "metrics_today": {"day": "2026-10-31", "requests": 14, "messages": 12,
                              "tokens": 12345, "latency_p95_ms": 2200, "config": "private"},
            "platforms": {"private": "not-for-phone"}})
        self.assertEqual(result["usage"], {"day": "2026-10-31", "requests": 14,
            "messages": 12, "tokens": 12345, "latencyP95Ms": 2200})
        self.assertNotIn("private", str(result))

    def test_proc_snapshot_samples_twice_and_reuses_the_cached_reading(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "stat").write_text("cpu 100 0 20 800 30 10 20 20")
            (root / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 400 kB")
            monitor = Monitor(root, root)
            with patch("hermes_bridge.monitor.time.sleep", side_effect=lambda _: (root / "stat").write_text("cpu 110 0 30 860 40 10 30 20")) as sleep:
                first = monitor.snapshot()
                self.assertEqual(first["cpuPercent"], 30)
                self.assertEqual(first["memory"]["percent"], 60)
                self.assertGreater(first["disk"]["totalBytes"], 0)
                self.assertIs(first, monitor.snapshot())
                sleep.assert_called_once_with(0.2)

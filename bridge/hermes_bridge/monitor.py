"""Read-only machine statistics. No subprocesses, provider keys or process lists."""

from __future__ import annotations

import math
import shutil
import threading
import time
from pathlib import Path


def cpu_ticks(text: str) -> tuple[int, int] | None:
    for line in text.splitlines():
        fields = line.split()
        if fields and fields[0] == "cpu":
            try:
                # Guest counters are already included in user/nice, not extra CPU time.
                values = [int(value) for value in fields[1:9]]
                if len(values) < 4 or any(value < 0 for value in values):
                    return None
                return sum(values), values[3] + (values[4] if len(values) > 4 else 0)
            except ValueError:
                return None
    return None


def cpu_percent(before: tuple[int, int] | None, after: tuple[int, int] | None) -> float | None:
    if before is None or after is None:
        return None
    total, idle = after[0] - before[0], after[1] - before[1]
    if total <= 0 or idle < 0 or idle > total:
        return None
    return round((total - idle) * 100 / total, 1)


def memory_stats(text: str) -> dict | None:
    fields = {}
    for line in text.splitlines():
        key, _, value = line.partition(":")
        parts = value.split()
        if key in ("MemTotal", "MemAvailable") and len(parts) == 2 and parts[1] == "kB":
            try:
                fields[key] = int(parts[0]) * 1024
            except ValueError:
                pass
    total, available = fields.get("MemTotal"), fields.get("MemAvailable")
    if total is None or available is None or total <= 0 or not 0 <= available <= total:
        return None
    used = total - available
    return {"totalBytes": total, "usedBytes": used, "percent": round(100 * used / total, 1)}


def nonnegative(value: object) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return value if math.isfinite(value) and value >= 0 else None


def gateway_stats(raw: dict) -> dict:
    """Whitelist an upstream response; never pass runtime config through to a phone."""
    metrics = raw.get("metrics_today")
    metrics = metrics if isinstance(metrics, dict) else {}
    version = raw.get("version")
    day = metrics.get("day")
    try:
        import datetime
        day = datetime.date.fromisoformat(day).isoformat() if isinstance(day, str) else None
    except ValueError:
        day = None
    return {
        "available": True,
        "version": version[:80] if isinstance(version, str) else None,
        "activeAgents": nonnegative(raw.get("active_agents")),
        "usage": {
            "day": day,
            "requests": nonnegative(metrics.get("requests")),
            "messages": nonnegative(metrics.get("messages")),
            "tokens": nonnegative(metrics.get("tokens")),
            "latencyP95Ms": nonnegative(metrics.get("latency_p95_ms")),
        },
    }


class Monitor:
    def __init__(self, disk_path: Path, proc: Path = Path("/proc")) -> None:
        self.disk_path = disk_path
        self.proc = proc
        self._lock = threading.Lock()
        self._cached: dict | None = None
        self._at = 0.0

    def _read(self, name: str) -> str:
        try:
            return (self.proc / name).read_text(encoding="ascii")
        except (OSError, UnicodeError):
            return ""

    def snapshot(self) -> dict:
        # Multiple phones share one short measurement, not one busy loop per device.
        with self._lock:
            if self._cached is not None and time.monotonic() - self._at < 2:
                return self._cached
            before = cpu_ticks(self._read("stat"))
            if before is not None:
                time.sleep(0.2)
            cpu = cpu_percent(before, cpu_ticks(self._read("stat")))
            memory = memory_stats(self._read("meminfo"))
            try:
                disk = shutil.disk_usage(self.disk_path)
                storage = {"totalBytes": disk.total, "usedBytes": disk.used,
                           "percent": round(100 * disk.used / disk.total, 1)} if disk.total else None
            except OSError:
                storage = None
            self._cached = {"sampledAt": time.time(), "cpuPercent": cpu, "memory": memory, "disk": storage}
            self._at = time.monotonic()
            return self._cached

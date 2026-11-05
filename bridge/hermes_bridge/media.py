"""A file the phone attached, and a recording it dictated.

Both land where the desktop app puts them — `~/.hermes/attachments` — so the
transcript and the bot can reach them with a path, not with bytes over a
command line.
"""

from __future__ import annotations

import glob
import json
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import unquote

from .config import Config

SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
AUDIO_TYPES = {
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/m4a": "m4a",
    "audio/x-m4a": "m4a",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/aac": "aac",
}


class MediaError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def safe_name(raw: str) -> str:
    name = os.path.basename(unquote(raw or "").replace("\\", "/")).strip()
    name = SAFE_NAME.sub("-", name).strip(".-")
    if not name:
        name = "file"
    stem, dot, extension = name.rpartition(".")
    if not dot or len(extension) > 8:
        return name[:80]
    return f"{stem[:70]}.{extension.lower()}"


def save_upload(config: Config, filename: str, mime: str, data: bytes) -> dict:
    if not data:
        raise MediaError(400, "empty", "Nothing was attached.")
    config.attachments_dir.mkdir(parents=True, exist_ok=True)
    name = safe_name(filename)
    stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime())
    target = config.attachments_dir / f"{stamp}-{secrets.token_hex(3)}-{name}"
    target.write_bytes(data)
    try:
        target.chmod(0o600)
    except OSError:
        pass
    return {
        "name": name,
        "path": str(target),
        "bytes": len(data),
        "mime": mime or "application/octet-stream",
    }


def _agent_home(config: Config) -> Path:
    explicit = os.environ.get("HERMES_AGENT_HOME", "").strip()
    candidates = [Path(explicit).expanduser()] if explicit else [
        config.hermes_home / "hermes-agent", Path(sys.prefix).parent, Path.cwd(),
    ]
    for candidate in candidates:
        if (candidate / "tools" / "transcription_tools.py").is_file():
            return candidate.absolute()
    raise MediaError(501, "no_transcription", "Hermes transcription tools are unavailable.")


def _hermes_python(agent_home: Path) -> str:
    # Keep the venv path, not its symlink target: resolving it loses packages.
    for relative in (".venv/bin/python", ".venv/Scripts/python.exe"):
        candidate = agent_home / relative
        if candidate.is_file():
            return str(candidate)
    return sys.executable


def _python_path(home: Path) -> str:
    archives = sorted(glob.glob(str(home / "cache" / "uv" / "archive-v0" / "*" / "")))
    return os.pathsep.join(archives)


TRANSCRIBE = """
import json
import os
import sys

agent_home = os.environ.get("HERMES_AGENT_HOME", "")
if agent_home:
    sys.path.insert(0, agent_home)

try:
    from tools import transcription_tools as stt
    loader = getattr(stt, "_load_stt_config", None)
    resolver = getattr(stt, "_get_provider", None)
    cfg = loader() if callable(loader) else {}
    enabled = stt.is_stt_enabled(cfg) if hasattr(stt, "is_stt_enabled") else True
    provider = resolver(cfg) if enabled and callable(resolver) else ("unknown" if enabled else "none")
    available = enabled and provider not in ("none", "")
    if sys.argv[1] == "--status":
        answer = {"available": available, "provider": provider}
    elif not available:
        answer = {"success": False, "code": "no_transcription", "error": "Configure an available STT backend in Hermes."}
    else:
        answer = stt.transcribe_audio(sys.argv[1])
    print(json.dumps(answer, separators=(",", ":")))
except Exception as exc:
    print(json.dumps({"success": False, "transcript": "", "error": str(exc)}, separators=(",", ":")))
"""


def _run_transcription(config: Config, argument: str, timeout: int) -> dict:
    agent_home = _agent_home(config)
    env = {
        **os.environ,
        "HERMES_AGENT_HOME": str(agent_home),
        "HERMES_HOME": str(config.hermes_home),
        "PYTHONIOENCODING": "utf-8",
        "PYTHONPATH": os.pathsep.join(filter(None, [str(agent_home), os.environ.get("PYTHONPATH", ""), _python_path(config.hermes_home)])),
    }
    try:
        result = subprocess.run(
            [_hermes_python(agent_home), "-", argument],
            input=TRANSCRIBE.encode("utf-8"),
            cwd=str(agent_home),
            env=env,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise MediaError(504, "timeout", "The recording took too long to transcribe.") from exc
    except OSError as exc:
        raise MediaError(502, "no_python", f"Could not run Hermes' python: {exc}") from exc

    answer = None
    for line in reversed(result.stdout.decode("utf-8", errors="replace").splitlines()):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            answer = json.loads(line)
        except ValueError:
            continue
        break
    if not isinstance(answer, dict):
        detail = result.stderr.decode("utf-8", errors="replace").strip().splitlines()
        raise MediaError(
            502,
            "transcription_failed",
            detail[-1] if detail else "The recording could not be transcribed.",
        )
    return answer


def voice_status(config: Config) -> dict:
    """Probe Hermes' configured backend without recording or installing models."""
    try:
        answer = _run_transcription(config, "--status", 20)
        return {"available": answer.get("available") is True,
                "provider": str(answer.get("provider") or "none")}
    except MediaError:
        return {"available": False, "provider": "none"}


def transcribe(config: Config, path: Path) -> str:
    """Use Hermes' STT configuration; a configured cloud backend may upload audio."""
    answer = _run_transcription(config, str(path), 180)
    if answer.get("code") == "no_transcription":
        raise MediaError(501, "no_transcription", "Configure an available STT backend in Hermes.")
    if not answer.get("success"):
        raise MediaError(
            502,
            "transcription_failed",
            str(answer.get("error") or "The recording could not be transcribed."),
        )
    transcript = str(answer.get("transcript") or "").strip()
    if not transcript:
        raise MediaError(422, "silence", "Nothing was heard in the recording.")
    return transcript


def audio_extension(mime: str) -> str:
    return AUDIO_TYPES.get((mime or "").split(";")[0].strip().lower(), "m4a")

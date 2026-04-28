"""
Lock file management with PID heartbeat and stale cleanup via psutil.
"""

import json
import os
import time
from pathlib import Path
from typing import Optional

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

STALE_TTL_SECONDS = 30


def _lock_path(locks_dir: Path, project_id: str) -> Path:
    return locks_dir / f"{project_id}.lock"


def acquire_project_lock(locks_dir: Path, project_id: str) -> Optional[Path]:
    """
    Acquire a project lock. Returns lock path if acquired, None if already locked.
    """
    locks_dir.mkdir(parents=True, exist_ok=True)
    lock_file = _lock_path(locks_dir, project_id)

    # Check existing lock
    if lock_file.exists():
        try:
            content = json.loads(lock_file.read_text(encoding="utf-8"))
            pid = content.get("pid")
            ts = content.get("ts", 0)
            age = time.time() - ts

            # Stale lock check
            if age > STALE_TTL_SECONDS:
                # PID check
                if HAS_PSUTIL and pid and psutil.pid_exists(pid):
                    return None  # PID alive but heartbeat stale — rare
                else:
                    # Stale, rimuovo
                    lock_file.unlink()
            else:
                return None  # Fresh lock
        except (json.JSONDecodeError, OSError):
            # Corrupted lock, rimuovo
            try:
                lock_file.unlink()
            except OSError:
                pass

    # Acquire
    lock_file.write_text(
        json.dumps({"pid": os.getpid(), "ts": time.time(), "projectId": project_id}),
        encoding="utf-8",
    )
    return lock_file


def release_project_lock(locks_dir: Path, project_id: str) -> None:
    lock_file = _lock_path(locks_dir, project_id)
    try:
        lock_file.unlink()
    except OSError:
        pass


def refresh_lock_heartbeat(locks_dir: Path, project_id: str) -> None:
    lock_file = _lock_path(locks_dir, project_id)
    if not lock_file.exists():
        return
    try:
        content = json.loads(lock_file.read_text(encoding="utf-8"))
        content["ts"] = time.time()
        lock_file.write_text(json.dumps(content), encoding="utf-8")
    except (json.JSONDecodeError, OSError):
        pass


def cleanup_stale_locks(locks_dir: Path) -> int:
    if not locks_dir.exists():
        return 0
    removed = 0
    for lock_file in locks_dir.glob("*.lock"):
        try:
            content = json.loads(lock_file.read_text(encoding="utf-8"))
            pid = content.get("pid")
            ts = content.get("ts", 0)
            age = time.time() - ts

            is_stale = age > STALE_TTL_SECONDS
            pid_dead = HAS_PSUTIL and pid and not psutil.pid_exists(pid)

            if is_stale or pid_dead:
                lock_file.unlink()
                removed += 1
        except (json.JSONDecodeError, OSError):
            try:
                lock_file.unlink()
                removed += 1
            except OSError:
                pass
    return removed

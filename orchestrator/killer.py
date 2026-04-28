"""
Killer — termina processi tramite PID (cmd.exe spawned).
Usato per i comandi "kill" dalla dashboard.
"""

import logging
import subprocess
import time
from typing import Optional

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

log = logging.getLogger(__name__)


def kill_pid(pid: int, timeout_s: int = 5) -> bool:
    """Try graceful terminate, then forceful kill. Returns True if killed."""
    if HAS_PSUTIL:
        try:
            proc = psutil.Process(pid)
            # Include children (cmd spawns claude)
            children = proc.children(recursive=True)
            for child in children:
                try:
                    child.terminate()
                except psutil.NoSuchProcess:
                    pass
            proc.terminate()

            gone, alive = psutil.wait_procs([proc] + children, timeout=timeout_s)
            for p in alive:
                try:
                    p.kill()
                except psutil.NoSuchProcess:
                    pass
            return True
        except psutil.NoSuchProcess:
            return True
        except Exception as e:
            log.error(f"psutil kill failed for PID {pid}: {e}")

    # Fallback: taskkill Windows
    try:
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
        return True
    except Exception as e:
        log.error(f"taskkill failed for PID {pid}: {e}")
        return False

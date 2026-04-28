"""
Orchestrator heartbeat writer — writes data/orchestrator.health every 3s.
Dashboard UI shows red banner if stale > 10s.
"""

import json
import os
import threading
import time
from pathlib import Path


def start_heartbeat(data_dir: Path, interval_s: int = 3) -> threading.Thread:
    health_file = data_dir / "orchestrator.health"
    stop_flag = threading.Event()

    def writer():
        while not stop_flag.is_set():
            try:
                health_file.write_text(
                    json.dumps({
                        "pid": os.getpid(),
                        "ts": time.time(),
                        "iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    }),
                    encoding="utf-8",
                )
            except OSError:
                pass
            if stop_flag.wait(interval_s):
                break

    t = threading.Thread(target=writer, daemon=True, name="orch-heartbeat")
    t.start()
    t._stop_flag = stop_flag  # type: ignore
    return t

#!/usr/bin/env python3
"""
Kill a single PID (and its children) — wrapper su killer.kill_pid.
Usato dall'endpoint DELETE /api/orchestrator/kill/:projectId per chiudere
la finestra cmd.exe esterna spawnata da spawn_single.py.

Uso: python kill_one.py <pid>
Exit 0 se killato (o già non esistente), 1 altrimenti.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from killer import kill_pid  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: kill_one.py <pid>", file=sys.stderr)
        sys.exit(2)
    try:
        pid = int(sys.argv[1])
    except ValueError:
        print(f"invalid pid: {sys.argv[1]}", file=sys.stderr)
        sys.exit(2)
    ok = kill_pid(pid)
    print(f"killed={ok} pid={pid}")
    sys.exit(0 if ok else 1)

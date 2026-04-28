#!/usr/bin/env python3
"""
Spawn a single Claude session for a specific project.
Used by dashboard API when user clicks "Apri sessione Claude" button.

Reads project config from stdin (JSON) and spawns via spawner.py.
"""

import json
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from spawner import spawn_project_session  # noqa: E402
from session_manager import SessionManager  # noqa: E402
from lock import acquire_project_lock, cleanup_stale_locks  # noqa: E402
from heartbeat import start_heartbeat  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [spawn1] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def main():
    raw = sys.stdin.read()
    payload = json.loads(raw)

    project_id = payload["projectId"]
    title = payload.get("title", project_id)
    data_dir = Path(payload["dataDir"]).resolve()
    kickoff_override = payload.get("kickoffMessage", "")
    tags = payload.get("tags", [])
    # V13.1 BUG1a: account override
    cli_name = payload.get("cliName")  # e.g. 'codex', 'gemini', 'aichat'
    cli_args = payload.get("cliArgs", [])  # extra CLI args
    env_overrides = payload.get("envOverrides", {})  # {VAR_NAME: value}
    # V14: spawn target ('local' | <vpsId>); None = locale di default
    spawn_target = payload.get("spawnTarget")
    spawn_target_meta = payload.get("spawnTargetMeta") or {}  # {ip, keyName} se remoto

    cleanup_stale_locks(data_dir / "locks")

    lock = acquire_project_lock(data_dir / "locks", project_id)
    if not lock:
        print(json.dumps({"spawned": False, "error": "already running (lock held)"}))
        sys.exit(0)

    session_mgr = SessionManager(data_dir)
    start_heartbeat(data_dir)

    project = {
        "projectId": project_id,
        "title": title,
        "decisions": [
            {
                "id": "manual-kickoff",
                "title": f"Apertura sessione manuale — {title}",
                "causa": f"L'utente ha richiesto una sessione AI dedicata per {title} dalla dashboard.",
                "soluzioneProposta": kickoff_override or f"Lavora in autonomia sul progetto {title}. Consulta MOC + task pending nel vault.",
                "comment": "",
                "voiceUsed": False,
            }
        ],
        "comments": [],
        "notes": [],
        "globalComment": "",
        "tags": tags,
        # V13.1 BUG1a: pass CLI override to spawner
        "cliName": cli_name,
        "cliArgs": cli_args,
        "envOverrides": env_overrides,
        # V14: spawn target
        "spawnTarget": spawn_target,
        "spawnTargetMeta": spawn_target_meta,
    }

    result = spawn_project_session(project, data_dir, session_mgr)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log.exception("spawn_single failed")
        print(json.dumps({"spawned": False, "error": str(e)}))
        sys.exit(1)

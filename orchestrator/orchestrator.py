#!/usr/bin/env python3
"""
RM Dashboard Orchestrator — entry point.

Legge un file di risposte dashboard (JSON), analizza le decisioni approvate,
raggruppa per progetto, e apre N terminali CMD reali con una sessione
Claude CLI dedicata per ogni progetto distinto.

Usage:
    python orchestrator.py --response <path.json> --brief <path.json> --data-dir <dir>
    python orchestrator.py --dry-run --response <path.json> --brief <path.json> --data-dir <dir>
"""

import argparse
import json
import sys
import time
from pathlib import Path

# Aggiungo cartella corrente al path per import sibling
sys.path.insert(0, str(Path(__file__).parent))

from planner import plan_executions  # noqa: E402
from spawner import spawn_project_session  # noqa: E402
from session_manager import SessionManager  # noqa: E402
from lock import acquire_project_lock, cleanup_stale_locks  # noqa: E402
from heartbeat import start_heartbeat  # noqa: E402
import logging  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [orch] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)


def parse_args():
    p = argparse.ArgumentParser(description="RM Dashboard Orchestrator")
    p.add_argument("--response", required=True, help="Path to response JSON")
    p.add_argument("--brief", required=True, help="Path to brief JSON")
    p.add_argument("--data-dir", required=True, help="Dashboard data directory")
    p.add_argument("--dry-run", action="store_true", help="Plan only, no spawn")
    p.add_argument("--max-tasks", type=int, default=8, help="Max concurrent tasks")
    return p.parse_args()


def load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    args = parse_args()
    data_dir = Path(args.data_dir).resolve()
    response = load_json(args.response)
    brief = load_json(args.brief)

    log.info("Orchestrator started")
    log.info(f"  Response: {args.response}")
    log.info(f"  Brief: {args.brief}")
    log.info(f"  Data dir: {data_dir}")
    log.info(f"  Dry run: {args.dry_run}")

    # Cleanup stale locks
    cleanup_stale_locks(data_dir / "locks")

    # Plan
    execution_plan = plan_executions(brief, response, data_dir)
    log.info(f"Planned {len(execution_plan)} project session(s):")
    for p in execution_plan:
        log.info(f"  - [{p['projectId']}] {p['title']} ({len(p['decisions'])} decisions)")

    if args.dry_run:
        print(json.dumps({"plan": execution_plan}, indent=2))
        return 0

    # Spawn each project session
    session_mgr = SessionManager(data_dir)
    heartbeat_thread = start_heartbeat(data_dir)

    spawned = []
    skipped = []
    for project in execution_plan:
        lock = acquire_project_lock(data_dir / "locks", project["projectId"])
        if not lock:
            log.warning(f"[{project['projectId']}] already running, skip")
            skipped.append(project["projectId"])
            continue

        try:
            result = spawn_project_session(project, data_dir, session_mgr)
            if result["spawned"]:
                log.info(f"[{project['projectId']}] spawned PID={result['pid']}")
                spawned.append({"projectId": project["projectId"], "pid": result["pid"]})
            else:
                log.error(f"[{project['projectId']}] spawn failed: {result.get('error')}")
        except Exception as e:
            log.exception(f"[{project['projectId']}] spawn exception: {e}")

    log.info(f"Done. Spawned: {len(spawned)}, skipped: {len(skipped)}")

    # Keep orchestrator alive for heartbeat + session monitoring
    try:
        while session_mgr.has_active_sessions():
            time.sleep(3)
            session_mgr.refresh_all()
    except KeyboardInterrupt:
        log.info("Interrupted, shutting down")
        session_mgr.shutdown()

    log.info("Orchestrator finished")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log.exception(f"Orchestrator fatal: {e}")
        sys.exit(1)

"""
SessionManager — tiene traccia dei processi spawned e aggiorna data/tasks/<projectId>.json.
"""

import json
import logging
import time
from pathlib import Path
from typing import Dict, Any

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

log = logging.getLogger(__name__)


class SessionManager:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.tasks_dir = data_dir / "tasks"
        self.tasks_dir.mkdir(parents=True, exist_ok=True)
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def register(self, project_id: str, pid: int, title: str, log_file: str, terminal_title: str = ""):
        now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        task = {
            "projectId": project_id,
            "title": title,
            "status": "running",
            "progress": 0,
            "tokensUsed": 0,
            "startedAt": now,
            "updatedAt": now,
            "pid": pid,
            "terminalTitle": terminal_title or f"Claude-{project_id}",
            "logFile": log_file,
            "currentStep": "Sessione avviata",
            "history": [{"ts": now, "event": "spawned"}],
        }
        self._sessions[project_id] = task
        self._write_task(task)

    def update_status(self, project_id: str, **updates):
        task = self._sessions.get(project_id)
        if not task:
            return
        task.update(updates)
        task["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
        self._write_task(task)

    def refresh_all(self):
        """Check all sessions: mark done if PID dead."""
        for project_id, task in list(self._sessions.items()):
            pid = task.get("pid")
            if not HAS_PSUTIL or not pid:
                continue
            if not psutil.pid_exists(pid):
                status = task.get("status")
                if status == "running":
                    self.update_status(
                        project_id,
                        status="done",
                        progress=1.0,
                        currentStep="Sessione terminata",
                    )
                    log.info(f"[{project_id}] detected PID {pid} terminated, marked done")

    def has_active_sessions(self) -> bool:
        for task in self._sessions.values():
            if task.get("status") in ("running", "paused", "waiting_user"):
                return True
        return False

    def shutdown(self):
        for project_id in list(self._sessions.keys()):
            self.update_status(project_id, status="done", currentStep="Orchestrator shutdown")

    def _write_task(self, task: Dict[str, Any]):
        path = self.tasks_dir / f"{task['projectId']}.json"
        tmp = path.with_suffix(".json.tmp")
        try:
            tmp.write_text(json.dumps(task, indent=2), encoding="utf-8")
            tmp.replace(path)
        except OSError as e:
            log.error(f"Failed to write task {task['projectId']}: {e}")

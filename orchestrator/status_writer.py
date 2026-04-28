"""
StatusWriter — loop di polling sui comandi da dashboard (data/commands/*.json).
Consuma e elimina il file dopo l'esecuzione.
"""

import json
import logging
import time
from pathlib import Path
from typing import Callable, Optional

log = logging.getLogger(__name__)


class CommandConsumer:
    def __init__(self, data_dir: Path, handler: Callable[[dict], None]):
        self.commands_dir = data_dir / "commands"
        self.commands_dir.mkdir(parents=True, exist_ok=True)
        self.handler = handler

    def poll_once(self) -> int:
        """Process all pending commands. Returns count processed."""
        processed = 0
        for cmd_file in sorted(self.commands_dir.glob("*.json")):
            try:
                raw = cmd_file.read_text(encoding="utf-8")
                cmd = json.loads(raw)
                log.info(f"[cmd] {cmd.get('type')} for {cmd.get('projectId')}")
                self.handler(cmd)
                cmd_file.unlink(missing_ok=True)
                processed += 1
            except Exception as e:
                log.error(f"Command processing failed {cmd_file.name}: {e}")
                # Move to failed/ to avoid loop
                failed_dir = self.commands_dir / ".failed"
                failed_dir.mkdir(exist_ok=True)
                try:
                    cmd_file.rename(failed_dir / cmd_file.name)
                except OSError:
                    pass
        return processed

#!/usr/bin/env python3
"""
DeepResearch Spawner — opens a new CMD window with Claude in plan mode,
pre-loaded with /deep-research <query> --mode=<mode>.

Receives JSON payload via stdin, outputs spawn result as JSON to stdout.
"""

import json
import subprocess
import sys
import time
from pathlib import Path
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [deepresearch] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

CREATE_NEW_CONSOLE = 0x00000010


def _clean(s: str) -> str:
    return (
        s.replace('"', "'")
         .replace("^", "-").replace("|", "-")
         .replace("<", "(").replace(">", ")")
    )


def main() -> int:
    raw = sys.stdin.read()
    payload = json.loads(raw)
    title = payload.get("title", "DeepResearch")
    query = payload.get("query", "")
    mode = payload.get("mode", "standard")
    slug = payload.get("slug", "research")

    if not query or len(query) < 3:
        print(json.dumps({"spawned": False, "error": "query required"}))
        return 1
    if mode not in ("quick", "standard", "deep", "ultradeep"):
        mode = "standard"

    # Escape query for cmd embedding
    safe_query = _clean(query)[:500]
    terminal_title = f"DeepRes-{slug[:30]}"

    # Build claude prompt that triggers skill with mode hint
    claude_cmd_hint = f"/deep-research {safe_query}"
    kickoff_msg = (
        f"Usa la skill /deep-research in modalita {mode.upper()} sul topic: {safe_query}. "
        f"Output: PDF + Markdown + HTML in ~/Documents/ come da default della skill. "
        f"Se necessario plan mode, procedi autonomo."
    )

    first_line = _clean(f"===== DEEP RESEARCH: {title} =====")
    second_line = _clean(f"Mode: {mode.upper()} · Topic: {safe_query[:80]}")
    third_line = _clean(f"Digita a Claude: {claude_cmd_hint}")

    cmd_inner = (
        f'title {terminal_title}'
        f' && echo.'
        f' && echo {first_line}'
        f' && echo {second_line}'
        f' && echo.'
        f' && echo {third_line}'
        f' && echo.'
        f' && claude'
    )

    try:
        proc = subprocess.Popen(
            ["cmd.exe", "/k", cmd_inner],
            shell=False,
            creationflags=CREATE_NEW_CONSOLE,
        )
        time.sleep(0.3)
        print(json.dumps({
            "spawned": True,
            "pid": proc.pid,
            "terminalTitle": terminal_title,
            "kickoffMessage": kickoff_msg,
        }))
        return 0
    except Exception as e:
        log.exception("spawn_deepresearch failed")
        print(json.dumps({"spawned": False, "error": str(e)}))
        return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        print(json.dumps({"spawned": False, "error": str(e)}))
        sys.exit(1)

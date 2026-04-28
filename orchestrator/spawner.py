"""
Spawner — apre un terminale CMD reale Windows con una sessione Claude CLI dedicata.

Strategia:
1. Scrive un file kickoff-{projectId}.md con il contesto completo del progetto
2. Scrive un log file che riceverà l'output (via file redirection nel cmd)
3. Lancia 'start cmd /k' con titolo custom, cd al project dir, messaggio iniziale
   che indica all'utente/a Claude di leggere il kickoff file
4. Registra il PID del CMD spawned nel SessionManager
"""

import logging
import os
import subprocess
import time
from pathlib import Path
from typing import Dict, Any

log = logging.getLogger(__name__)


# Root del repo parent (contiene sia la dashboard che i plugin AgencyOS, se presenti)
# Default: parent directory della dashboard stessa (calcolato dal path di questo file)
# Override: imposta env CLAUDE_PROJECT_ROOT al path che vuoi usare come cwd per i terminali spawn.
_DEFAULT_ROOT = str(Path(__file__).resolve().parent.parent.parent)
CLAUDE_PROJECT_ROOT = os.environ.get("CLAUDE_PROJECT_ROOT", _DEFAULT_ROOT)


def _render_kickoff(project: Dict[str, Any], data_dir: Path, brief_id: str = "unknown") -> Path:
    template_path = Path(__file__).parent / "prompts" / "kickoff_template.md"
    template = template_path.read_text(encoding="utf-8")

    # Decisions block
    decisions_md_parts = []
    for i, d in enumerate(project.get("decisions", []), 1):
        block = f"### {i}. {d['title']}\n\n"
        block += f"**Causa**: {d['causa']}\n\n"
        block += f"**Soluzione proposta**: {d['soluzioneProposta']}\n\n"
        if d.get("comment"):
            block += f"**Commento utente**: {d['comment']}\n\n"
        decisions_md_parts.append(block)
    decisions_md = "\n".join(decisions_md_parts) or "_Nessuna decisione approvata_"

    # Comments block
    comments_md = ""
    for c in project.get("comments", []):
        comments_md += f"- **{c['decisionId']}**: {c['comment']}\n"
    if not comments_md:
        comments_md = "_Nessun commento specifico_"

    # Notes section (skip/no con commento)
    notes_section = ""
    notes = project.get("notes", [])
    if notes:
        notes_md = "\n".join(
            f"- _{n['answer']}_ su **{n['decisionTitle']}**: {n['comment']}"
            for n in notes
        )
        notes_section = f"## 📝 Note dall'utente (decisioni skip/no con commento)\n\n{notes_md}\n"

    # Global comment
    global_section = ""
    if project.get("globalComment"):
        global_section = f"## 🗨️ Commento globale dell'utente\n\n{project['globalComment']}\n"

    rendered = template.format(
        project_title=project.get("title", project["projectId"]),
        project_id=project["projectId"],
        date=time.strftime("%Y-%m-%d %H:%M"),
        brief_id=brief_id,
        decisions_md=decisions_md,
        comments_md=comments_md,
        notes_section=notes_section,
        global_comment_section=global_section,
        data_dir=str(data_dir).replace("\\", "/"),
    )

    kickoffs_dir = data_dir / "kickoffs"
    kickoffs_dir.mkdir(parents=True, exist_ok=True)
    kickoff_path = kickoffs_dir / f"kickoff-{project['projectId']}-{int(time.time())}.md"
    kickoff_path.write_text(rendered, encoding="utf-8")
    return kickoff_path


def spawn_project_session(project: Dict[str, Any], data_dir: Path, session_mgr) -> Dict[str, Any]:
    project_id = project["projectId"]
    title = project.get("title", project_id)

    # V13.1 BUG1a: accept CLI override from payload (from accountsStore resolved by backend)
    # Default to claude for backward compat.
    cli_name = project.get("cliName") or "claude"
    cli_args = project.get("cliArgs") or []  # list of strings
    env_overrides = project.get("envOverrides") or {}  # dict key→val for env

    # Sanitize cli_name (only alphanumeric + _ -)
    if not all(c.isalnum() or c in "_-." for c in cli_name):
        log.warning(f"[{project_id}] invalid cliName {cli_name}, falling back to claude")
        cli_name = "claude"

    kickoff_path = _render_kickoff(project, data_dir)
    log_file = data_dir / "logs" / f"{project_id}.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    # Sanitize project_id for use in title (remove anything cmd might misinterpret)
    safe_id = "".join(c for c in project_id if c.isalnum() or c in "-_")[:40] or "session"
    # V13.1 BUG1a: rename terminal title for clarity + use cli_name
    terminal_title = f"SAIO-{cli_name}-{safe_id}"

    # Sanitize messages — strip double quotes and caret/pipe/redirect chars
    def _clean(s: str) -> str:
        return (
            s.replace('"', "'")
             .replace("^", "-")
             .replace("|", "-")
             .replace("<", "(")
             .replace(">", ")")
             .replace("&&", "and")
        )

    first_message = _clean(f"===== SESSIONE {cli_name.upper()} — {title} =====")
    second_message = _clean(f"Kickoff file: {kickoff_path.as_posix()}")
    # V13.1 BUG2: clipboard auto + istruzione Ctrl+V
    third_message = _clean(f"BRIEF pronto in clipboard — appena {cli_name} parte, Ctrl+V + Invio per caricarlo")

    # V13.1 BUG2: pre-load /read kickoff-path into clipboard via Windows clip
    # Uso: echo /read <path> | clip
    # Sanitize path for echo (no quotes)
    clipboard_cmd_raw = f"/read {kickoff_path.as_posix()}"
    # Escape for cmd echo — replace special chars
    clipboard_cmd_safe = _clean(clipboard_cmd_raw)

    # V13.1 BUG1a: build cli command with optional args
    cli_cmd = cli_name
    if cli_args:
        # Clean args (same sanitization as messages)
        safe_args = [_clean(str(a)) for a in cli_args if a]
        if safe_args:
            cli_cmd = f"{cli_name} {' '.join(safe_args)}"

    # V14: spawn target — se !=local + meta valida, lancia ssh remoto invece di cli locale
    spawn_target = project.get("spawnTarget")
    spawn_target_meta = project.get("spawnTargetMeta") or {}
    is_remote_spawn = bool(spawn_target) and spawn_target != "local"

    if is_remote_spawn:
        vps_ip = spawn_target_meta.get("ip")
        vps_user = spawn_target_meta.get("user", "root")
        vps_key_name = spawn_target_meta.get("keyName") or "claude_vps"
        # Sanitize key name (alnum + dot/dash/underscore)
        safe_key = "".join(c for c in vps_key_name if c.isalnum() or c in "._-")
        ssh_key_path = str(Path.home() / ".ssh" / (safe_key or "claude_vps"))
        # Validate IP minimal (accept hostname too se non IP)
        if not vps_ip:
            log.warning(f"[{project_id}] spawnTarget={spawn_target} ma manca ip → fallback a locale")
            is_remote_spawn = False
        else:
            ssh_cmd = (
                f'ssh -i "{ssh_key_path}" -o ConnectTimeout=10 '
                f'-o StrictHostKeyChecking=accept-new -t {vps_user}@{vps_ip} "{cli_cmd}"'
            )
            cmd_inner = (
                f'title {terminal_title}-{spawn_target}'
                f' && echo.'
                f' && echo {first_message}'
                f' && echo {_clean(f"Target remoto: {spawn_target} ({vps_user}@{vps_ip})")}'
                f' && echo {second_message}'
                f' && echo.'
                f' && {ssh_cmd}'
            )
            log.info(f"[{project_id}] V14 remote spawn → {vps_user}@{vps_ip} (key={safe_key})")

    if not is_remote_spawn:
        # Build inner cmd locale: set title + clipboard load + echo hints + launch cli
        cmd_inner = (
            f'title {terminal_title}'
            f' && echo {clipboard_cmd_safe} | clip'
            f' && echo.'
            f' && echo {first_message}'
            f' && echo {second_message}'
            f' && echo.'
            f' && echo {third_message}'
            f' && echo.'
            f' && {cli_cmd}'
        )

    # V13.1 BUG1a: merge env_overrides (API keys) into spawn env
    spawn_env = os.environ.copy()
    if env_overrides and isinstance(env_overrides, dict):
        for k, v in env_overrides.items():
            if isinstance(k, str) and isinstance(v, str) and k.isupper():
                spawn_env[k] = v
                log.info(f"[{project_id}] env override: {k}=***")

    try:
        cwd = CLAUDE_PROJECT_ROOT
        log.info(f"[{project_id}] Spawning — cli={cli_name} args={cli_args} title='{terminal_title}'")
        log.info(f"[{project_id}] cwd={cwd}")
        log.info(f"[{project_id}] kickoff={kickoff_path}")

        CREATE_NEW_CONSOLE = 0x00000010  # Windows constant
        proc = subprocess.Popen(
            ["cmd.exe", "/k", cmd_inner],
            cwd=cwd,
            shell=False,
            creationflags=CREATE_NEW_CONSOLE,
            env=spawn_env,
        )

        # Aspetto 500ms per dare tempo al CMD di aprirsi
        time.sleep(0.5)

        session_mgr.register(
            project_id=project_id,
            pid=proc.pid,
            title=title,
            log_file=str(log_file),
            terminal_title=terminal_title,
        )

        return {
            "spawned": True,
            "pid": proc.pid,
            "kickoffPath": str(kickoff_path),
            "terminalTitle": terminal_title,
            "cliName": cli_name,
        }

    except Exception as e:
        log.exception(f"[{project_id}] spawn failed")
        return {"spawned": False, "error": str(e)}

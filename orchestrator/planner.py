"""
Planner — raggruppa decisioni per projectTarget e costruisce piano esecutivo.
"""

import re
from pathlib import Path
from typing import List, Dict, Any


def _slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", s.lower()).strip("-")
    return s[:64] or "misc"


def plan_executions(brief: Dict[str, Any], response: Dict[str, Any], data_dir: Path) -> List[Dict[str, Any]]:
    """
    Raggruppa le decisioni per projectTarget.
    Solo le decisioni con answer=yes generano sessioni (no/skip/comment-only non spawnano).
    Le decisioni comment-only e skip con commento vengono comunque annotate nel kickoff file
    del progetto correlato (se presente projectTarget).
    """
    decisions_by_id = {d["id"]: d for d in brief.get("decisions", [])}
    entries = response.get("entries", [])

    # Raccolgo solo le entry con answer=yes per spawn + tutte con comment per info
    project_clusters: Dict[str, Dict[str, Any]] = {}
    notes_only: Dict[str, List[Dict[str, Any]]] = {}

    for entry in entries:
        decision = decisions_by_id.get(entry["decisionId"])
        if not decision:
            continue

        target = decision.get("projectTarget") or _slug(decision.get("title", "generic"))
        answer = entry.get("answer")
        comment = entry.get("comment") or ""

        if answer == "yes":
            if target not in project_clusters:
                project_clusters[target] = {
                    "projectId": target,
                    "title": _title_for_project(target),
                    "decisions": [],
                    "comments": [],
                    "notes": [],
                }
            project_clusters[target]["decisions"].append({
                "id": decision["id"],
                "title": decision["title"],
                "causa": decision["causa"],
                "soluzioneProposta": decision["soluzioneProposta"],
                "comment": comment,
                "voiceUsed": entry.get("voiceUsed", False),
            })
            if comment:
                project_clusters[target]["comments"].append({
                    "decisionId": decision["id"],
                    "comment": comment,
                })
        elif answer in ("no", "skip", "comment-only"):
            # Annota come nota al progetto se presente, altrimenti scartata
            if comment or answer != "no":
                notes_only.setdefault(target, []).append({
                    "decisionTitle": decision["title"],
                    "answer": answer,
                    "comment": comment,
                })

    # Merge notes_only nei progetti spawned (se c'è overlap)
    for target, notes in notes_only.items():
        if target in project_clusters:
            project_clusters[target]["notes"].extend(notes)

    # Global comment del brief → aggiunto a TUTTI i progetti spawned
    global_comment = response.get("globalComment") or ""
    for project in project_clusters.values():
        if global_comment:
            project["globalComment"] = global_comment

    return list(project_clusters.values())


def _title_for_project(project_id: str) -> str:
    titles = {
        "herbalife": "Herbalife UK — Progetto dedicato",
        "vps-pipeline": "VPS Pipeline v3.46",
        "zaplater": "ZapLater produzione",
        "onweb24": "OnWeb24 Portal",
        "dashboard": "RM Dashboard",
        "form_qa": "Form QA Google Sheets",
    }
    return titles.get(project_id, project_id.replace("-", " ").title())

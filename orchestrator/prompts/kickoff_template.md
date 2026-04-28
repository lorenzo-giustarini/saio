# Kickoff — {project_title}

**Data**: {date}
**Project ID**: `{project_id}`
**Brief origine**: `{brief_id}`

---

## 🎯 Obiettivo sessione

Sei una sessione Claude dedicata al progetto **{project_title}**. L'utente ha approvato le decisioni sotto dalla dashboard operativa RM. Il tuo compito è:

1. Leggere questo kickoff file completamente
2. Analizzare ogni decisione approvata e proporre il piano di esecuzione dettagliato
3. Chiedere conferma all'utente (lui è in un'altra finestra — rispondi quando lo vedi digitare)
4. Una volta confermato, eseguire in autonomia
5. Aggiornare progressi via file `{data_dir}/tasks/{project_id}.json` (manualmente via Edit se non hai tool automatico)

---

## ✅ Decisioni approvate

{decisions_md}

---

## 💬 Commenti utente per questo progetto

{comments_md}

{notes_section}

{global_comment_section}

---

## 📂 Contesto / File di riferimento

- Vault Obsidian configurato via env `VAULT_PATH` (se presente — altrimenti il vault è esterno al workflow)
- MOC progetto: cerca `MOC-{project_id}.md` nel vault se esiste
- Task file (il tuo report live): `{data_dir}/tasks/{project_id}.json`
- Log file: `{data_dir}/logs/{project_id}.log`

## ⚠️ Regole

- Plan mode obbligatorio per OGNI modifica non banale
- Backup pre-modifica su file critici (hook globale attivo)
- Microtask atomici, no batch
- Se blocchi → scrivi status="waiting_user" nel task JSON
- Se finito → scrivi status="done" e progress=1

## 🚀 Inizia

Leggi questo file completamente, poi parti dalla prima decisione approvata.

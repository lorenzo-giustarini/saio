# V11 Smoke Test — Projects Hierarchy + Lifecycle

Esegui questi step dopo `npm run dev:all` riavviato.

## 0. Prerequisiti

```bash
# Assicurarsi che il server Express sia ripartito (tsx watch su Windows non ricarica)
# Ctrl+C nel terminale dev → npm run dev:all
```

## 1. Verifica migration automatica

```bash
# Dopo restart, projects.json dovrebbe essere stato creato
ls -la data/projects.json data/projects.json.backup-*
# Output atteso: 2 file (master + backup)

# Verifica contenuto: 7 seed projects con folder assegnati
cat data/projects.json | python -c "import sys, json; d=json.load(sys.stdin); print(f'{len(d[\"projects\"])} projects'); [print(f'  {p[\"id\"]}: folder={p.get(\"folder\",\"-\")}') for p in d['projects']]"
# Atteso: dashboard→Internal/Tools, herbalife→Clients/Herbalife, etc.
```

## 2. Verifica schema nuovo in GET

```bash
curl -s http://127.0.0.1:3031/api/projects | python -c "
import sys, json
d = json.load(sys.stdin)
first = d['projects'][0]
assert 'archived' in first, 'missing archived field'
assert 'folder' in first, 'missing folder field'
print('✓ Schema V11 OK')
"
```

## 3. Test archive + restore

```bash
# Archivia herbalife-mx
curl -sX POST http://127.0.0.1:3031/api/projects/herbalife-mx/archive | python -m json.tool
# Atteso: archived=true, archivedAt=<iso>

# Verifica UI: apri http://127.0.0.1:3030/projects
# Herbalife MX dovrebbe sparire da Attivi + apparire in sezione "Archiviati" (click per espandere)

# Ripristina
curl -sX POST http://127.0.0.1:3031/api/projects/herbalife-mx/restore | python -m json.tool
# Atteso: archived=false
```

## 4. Test folder move

```bash
# Sposta dashboard in root
curl -sX POST http://127.0.0.1:3031/api/projects/dashboard/move \
  -H "Content-Type: application/json" \
  -d '{"folder": ""}' | python -m json.tool
# Atteso: folder=undefined o assente

# Rimetti in Internal/Tools
curl -sX POST http://127.0.0.1:3031/api/projects/dashboard/move \
  -H "Content-Type: application/json" \
  -d '{"folder": "Internal/Tools"}' | python -m json.tool
```

## 5. Test completion marker (blu vs grigio)

```bash
# Simula un task attivo poi terminato SENZA marker (dovrebbe andare idle/grigio)
cat > data/tasks/test-completion.json <<EOF
{
  "projectId": "dashboard",
  "title": "Test",
  "status": "running",
  "progress": 0,
  "tokensUsed": 0,
  "startedAt": "2026-04-23T22:00:00.000Z",
  "updatedAt": "2026-04-23T22:00:00.000Z",
  "pid": 99999,
  "history": []
}
EOF

# Query: task viene auto-marcata come idle (PID 99999 non esiste) senza marker
curl -s http://127.0.0.1:3031/api/tasks/test-completion | python -m json.tool
# Atteso: status=idle, sessionOutcome=terminated

# Ora scrivi marker + rispawn task
echo '{"completedAt":"2026-04-23T22:00:00.000Z"}' > data/tasks/test-completion.json.completed
cat > data/tasks/test-completion.json <<EOF
{
  "projectId": "dashboard",
  "title": "Test",
  "status": "running",
  "progress": 0,
  "tokensUsed": 0,
  "startedAt": "2026-04-23T22:00:00.000Z",
  "updatedAt": "2026-04-23T22:00:00.000Z",
  "pid": 99999,
  "history": []
}
EOF

curl -s http://127.0.0.1:3031/api/tasks/test-completion | python -m json.tool
# Atteso: status=done, sessionOutcome=completed (BLU)

# Cleanup
rm data/tasks/test-completion.json data/tasks/test-completion.json.completed
```

## 6. Test POST /complete endpoint

```bash
# Scrivi marker via API
curl -sX POST http://127.0.0.1:3031/api/tasks/dashboard/complete \
  -H "Content-Type: application/json" \
  -d '{"note":"smoke test V11"}' | python -m json.tool
# Atteso: ok=true, markerFile=<path>

# Verifica marker file presente
ls data/tasks/dashboard.json.completed

# Cleanup
rm data/tasks/dashboard.json.completed
```

## 7. Test UI E2E

Apri http://127.0.0.1:3030/projects

**Checklist visuale:**
- [ ] 3 sezioni: "Attivi", "Cartelle", "Archiviati"
- [ ] Sezione "Attivi" mostra ≤4 card
- [ ] Se >4 progetti: bottone "Vedi tutti (N)" → espande tutti
- [ ] Sezione "Cartelle" mostra tree con folder annidati (es. Clients/Herbalife/MX)
- [ ] Click su folder chevron → espande/contrae
- [ ] Sezione "Archiviati" collapsed by default → click header espande
- [ ] Search evidenzia match in tutte e 3 le sezioni

**ProjectDetail checklist:**
- [ ] Barra "Lifecycle" sotto header mostra: Segna completato, Sposta in..., Archivia
- [ ] "Sposta in..." apre dropdown con folder esistenti + "+ Nuova cartella"
- [ ] "Archivia" → AlertDialog conferma → archivia + redirect /projects
- [ ] Se archiviato: bottone "Ripristina" (verde) al posto di "Archivia"

## 8. Cleanup post-smoke

```bash
# Rimuovi backup test se esistono
rm -f data/projects.json.backup-test-*
```

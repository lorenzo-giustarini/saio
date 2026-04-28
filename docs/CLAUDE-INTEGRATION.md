# SAIO — Integrazione per Claude in PTY

> Guida rapida per Claude (me stesso) quando lavora in una sessione spawanata da SAIO (PTY embedded) su un progetto.

## 🎯 Quando usarla

Stai lavorando in una sessione Claude Code **dentro la dashboard SAIO** (workspace isolato in `data/project-workspaces/<projectId>/` — riconoscibile dal fatto che l'utente ti ha lanciato dalla dashboard invece che da terminale manuale). Il server SAIO è sempre su `http://127.0.0.1:3031` e raggiungibile via `curl` dal tuo shell PTY.

## 🛠️ Pattern fondamentali

### 1. Posta una DecisionCard in Inbox quando trovi un bivio strategico

Quando stai per chiedere all'utente una scelta multipla, importante o non reversibile → **non chiedere inline nella chat**. Posta una DecisionCard in Inbox così l'utente può rispondere con la form strutturata (Sì/No/Skip/Comment + voice dictation).

```bash
curl -sX POST http://127.0.0.1:3031/api/briefs/decision \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "<projectId>",
    "sessionId": "<opzionale, es. PTY pid>",
    "decision": {
      "title": "Titolo conciso della scelta",
      "causa": "Perché devi decidere (background/contesto)",
      "effetto": {"si": "cosa succede se sì", "no": "cosa succede se no"},
      "rischi": [{"desc": "...", "probabilita": 0.3, "severita": "medium"}],
      "soluzioneProposta": "Cosa farai appena ricevi la risposta",
      "priority": "normal"
    }
  }'
# Response: { ok: true, briefId: "in-session-<projectId>-<date>-<time>", ... }
```

**⚠️ Salvati il `briefId`** — ti serve per lo step 2.

### 2. Risolvi il brief quando l'utente risponde

**Se l'utente risponde via Inbox form** → il brief viene archiviato automaticamente dal server. Tu non devi fare niente.

**Se l'utente risponde direttamente nella chat PTY** (più comune: "procedi con opzione A"), il brief resta zombi in Inbox. **Devi chiamare resolve tu stesso:**

```bash
curl -sX POST http://127.0.0.1:3031/api/briefs/<briefId>/resolve \
  -H "Content-Type: application/json" \
  -d '{
    "resolvedVia": "chat",
    "resolution": "L'\''utente ha risposto in chat: <sintesi della scelta e motivazione>",
    "resolvedBy": "claude"
  }'
# Response: { ok: true, archivedTo: ".../archive/briefs/...", resolvedVia: "chat" }
```

Idempotente: se è già stato risolto (es. l'utente lo ha chiuso via UI), ricevi 404 — ignora e continua.

### 3. Scopri brief ancora pending per il tuo progetto

All'inizio di una sessione o prima di una decisione importante, controlla se hai brief attivi non risolti:

```bash
curl -s "http://127.0.0.1:3031/api/briefs?pending=true&projectId=<projectId>" | jq
# Response: { briefs: [...], count: N }
```

Se count > 0, hai brief orfani che probabilmente l'utente ha già risolto in chat — consider resolve preventivo se hai il contesto.

## 📐 Regole d'oro

- ✅ **Usa DecisionCard per scelte strutturate** (2+ opzioni, decisioni strategiche, rischi non banali)
- ✅ **Resta inline per domande rapide** di chiarimento ("vuoi che uso typescript o javascript?")
- ✅ **Chiama resolve SEMPRE** quando ricevi risposta in chat per un brief che hai postato
- ✅ **Log sintesi risposta** nel campo `resolution` per auditabilità
- ❌ **NON postare DecisionCard per ogni piccola scelta** — spam di Inbox = brief ignorati
- ❌ **NON lasciare brief orfani** — sempre chiudi il ciclo con resolve

## 🔗 Endpoint completo

| Metodo | Path | Scopo |
|--------|------|-------|
| POST | `/api/briefs/decision` | Crea DecisionCard in-session |
| POST | `/api/briefs/:id/resolve` | Archivia brief risolto altrove |
| GET | `/api/briefs?pending=true&projectId=X` | Lista brief pending per progetto |
| GET | `/api/briefs` | Lista tutti i brief attivi |
| GET | `/api/briefs/:id` | Dettaglio singolo brief |

Tutti gli endpoint sono su `http://127.0.0.1:3031` (loopback only, no auth richiesto in ambiente single-user LAN).

## 🧪 Esempio completo (pattern end-to-end)

Scenario: sto costruendo un componente, devo scegliere tra 3 librerie UI.

```bash
# 1. Posta la decisione
BRIEF_ID=$(curl -sX POST http://127.0.0.1:3031/api/briefs/decision \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "my-client-project",
    "decision": {
      "title": "Quale libreria UI per il form di checkout?",
      "causa": "Devo scegliere tra React Hook Form + Zod, Formik, o TanStack Form. Impatta performance e DX.",
      "effetto": {
        "si": "Procedo con React Hook Form + Zod (raccomandato)",
        "no": "Mi fermo e aspetto tua indicazione su Formik/TanStack"
      },
      "rischi": [{"desc": "Lock-in se serve cambiare poi", "probabilita": 0.2, "severita": "low"}],
      "soluzioneProposta": "React Hook Form + Zod: migliore performance, validation schema riusabile",
      "priority": "normal"
    }
  }' | jq -r .briefId)

echo "Brief aperto: $BRIEF_ID — aspetto risposta..."

# 2. L'utente risponde in chat: "ok vai con hook form"

# 3. Chiudo il brief
curl -sX POST "http://127.0.0.1:3031/api/briefs/$BRIEF_ID/resolve" \
  -H "Content-Type: application/json" \
  -d '{
    "resolvedVia": "chat",
    "resolution": "User approva React Hook Form + Zod (confermato in chat)",
    "resolvedBy": "claude"
  }'
# Inbox pulita, decisione loggata in data/archive/briefs/
```

---

**Ricorda:** SAIO = Smart AI Office. L'utente lavora su 10-20 progetti in parallelo. Ogni brief orfano = cognitive load per lui. Chiudi sempre il ciclo.

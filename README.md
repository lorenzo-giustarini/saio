# SAIO Dashboard

> Operativa dashboard self-hosted per orchestrare sessioni Claude in parallelo
> su progetti distinti, con gestione decisioni Morning/EOD via UI invece di email.
> Single-owner, magic-link auth con 2FA, opzionale Cloudflare Tunnel per accesso pubblico.

## Indice

- [Cosa fa SAIO](#cosa-fa-saio)
- [Quick start (5 minuti)](#quick-start-5-minuti)
- [Setup completo](#setup-completo)
- [Architettura](#architettura)
- [Dipendenze](#dipendenze)
- [Esposizione pubblica via Cloudflare](#esposizione-pubblica-via-cloudflare)
- [Auth recovery](#auth-recovery)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Politica d'uso (abuse policy)](#politica-duso-abuse-policy)
- [Contributing](#contributing)
- [Licenza](#licenza)

---

## Cosa fa SAIO

- **Inbox decisioni**: brief JSON in `data/briefs/` mostrati come card con
  Causa / Effetto / Rischi / Soluzione + bottoni Sì/No/Skip + dettatura vocale italiana
- **Orchestrator multi-terminal**: spawn N terminali Windows CMD reali, uno per
  progetto, ognuno con sessione `claude` CLI dedicata + file kickoff contestuale
- **Task live**: progress, token usati, ETA, controlli Pause/Kill, log drawer
  con tail SSE
- **Progetti attivi**, **Archivio decisioni**, **Metriche** (token chart + vault
  health), **Extras** (MCP status, Costs tracker, Credenziali inventory, ⌘K palette)
- **Auth single-owner**: claim flow al primo run + magic link + TOTP + recovery
  codes + opzionale "Trust this device" 1-30 giorni
- **Multi-VPS error pipeline**: aggregazione errori cron-multi-host + dispatch
  fix automatici
- **Knowledge browser** (opzionale): naviga vault Obsidian se configurato
- **Wizard onboarding**: setup email provider via browser (Gmail / Outlook /
  iCloud / Aruba / Mailgun / SendGrid / dominio custom) con validazione SMTP live

---

## Quick start (5 minuti)

```bash
# 1. Clone + dipendenze
git clone https://github.com/<your-fork>/saio-dashboard.git
cd saio-dashboard
npm install     # auto-trigger postinstall: dependency check report

# 2. (Se mancano dipendenze critiche) installa via wizard automatico
npm run setup:deps    # interactive: detect + install Node/Python/Claude CLI

# 3. Avvia dashboard
npm run dev:all       # Vite (3030) + Express (3031) in parallelo

# 4. Browser → claim flow
# Nel terminale appare un banner CLAIM TOKEN. Apri:
#   http://127.0.0.1:3030/claim?token=<TOKEN>
# (TTL 24h default, configurabile via DASHBOARD_AUTH_CLAIM_TTL_MIN env)

# 5. Wizard guidato apre automaticamente:
#    - scelta email provider (Gmail / dominio / Resend / dev mode)
#    - email entry + magic link → click in inbox
#    - enroll TOTP (scan QR con Google Authenticator/Authy/etc.)
#    - download recovery codes (10 codici single-use)
#    - opzionale "Trust this device" 1-30 giorni
#    → /inbox: dentro la dashboard
```

Se il claim token scade (default 24h): nessun panico, esegui:

```bash
npm run claim:reissue    # rigenera token senza restart server
```

---

## Setup completo

### Email provider (richiesto per magic link)

Il wizard browser ti guida step-by-step. Provider supportati:

| Provider | SMTP | Note |
|----------|------|------|
| **Gmail** (raccomandato) | smtp.gmail.com:587 | richiede 2FA + App Password ([guida inline](https://myaccount.google.com/apppasswords)) |
| **Outlook / Hotmail** | smtp-mail.outlook.com:587 | App Password se 2FA attivo |
| **iCloud Mail** | smtp.mail.me.com:587 | App-specific Password da appleid.apple.com |
| **Yahoo Mail** | smtp.mail.yahoo.com:587 | App Password |
| **Aruba** | smtp.aruba.it:465 | password account Aruba |
| **Register.it** | mail.register.it:465 | password account hosting |
| **Mailgun** | smtp.mailgun.org:587 | username `postmaster@mg.tuodominio.com`, password SMTP (NON API key) |
| **SendGrid** | smtp.sendgrid.net:587 | username `apikey`, password = API key SendGrid |
| **Custom SMTP** | tuo dominio | host/port/user/pass manuali |
| **Resend** | API | richiede dominio verificato + DNS SPF/DKIM |
| **Dev mode** | console | magic link in stdout (no email reali) — solo dev locale |

Validazione live: appena inserisci la password e fai blur dal campo, il backend
prova handshake SMTP + AUTH check. Risultato:
- ✓ verde "Connessione SMTP verificata" → bottone Salva si abilita
- ⚠️ rosso con messaggio specifico (Credenziali errate / Host non trovato / TLS / etc.)

### Hosting SMTP (importante)

Se usi SMTP del **tuo dominio** (cPanel, ChemiCloud, Aruba, Register, Plesk),
l'**email destinataria del claim deve essere una casella dello stesso dominio**.
La maggior parte degli hosting NON è open-relay verso domini esterni. Se vuoi
inviare a destinatari arbitrari, usa Mailgun / SendGrid / Resend (servizi
transazionali progettati per questo).

### TOTP enrollment

Dopo magic link verify, ti viene mostrato un QR code. Scansiona con:
- Google Authenticator
- Authy
- Microsoft Authenticator
- 1Password (TOTP)
- Bitwarden (TOTP)
- qualunque app che supporti TOTP standard (RFC 6238)

Salva i 10 recovery codes in un password manager. Single-use, ti servono se
perdi l'authenticator.

### Trust this device

Opzionale, default OFF. Se selezionato:
- Cookie `saio_trusted` long-lived (1/3/7/15/30 giorni a scelta)
- Bypass TOTP su questo browser per la durata scelta
- Revocabile via logout o admin revoke (se sei guest)

---

## Architettura

```
┌─────────────────────────────────────────────────────┐
│  Browser (3030 Vite + proxy /api → 3031 Express)    │
│  React 19 + TS + Tailwind + shadcn + TanStack Query │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Express backend (3031, bind 127.0.0.1)             │
│  helmet CSP + JWT cookies + magic link + TOTP       │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  Python orchestrator (psutil + watchdog + pywinpty) │
│  Spawn N CMD windows con sessioni Claude CLI live   │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  data/                                              │
│  ├── auth/    (claim, sessions, totp, audit)        │
│  ├── briefs/  (input Claude)                        │
│  ├── responses/                                     │
│  ├── tasks/   (live state)                          │
│  ├── archive/                                       │
│  └── audit/                                         │
└─────────────────────────────────────────────────────┘
```

**Stack tecnico**:
- **Frontend**: Vite 6 + React 19 + TypeScript + Tailwind v3.4 + shadcn/ui
- **Backend**: Express 4 + helmet + Zod + chokidar (filewatch SSE) + cookie-parser
- **Auth**: JWT (jsonwebtoken) + nodemailer (SMTP) / Resend (API) + otplib (TOTP) + bcryptjs (recovery codes)
- **Orchestrator**: Python 3.11+ con psutil/watchdog/pywinpty
- **State**: TanStack Query (polling 5-60s) + SSE push (filewatch)
- **Native deps**: node-pty (xterm in browser via WebSocket)

---

## Dipendenze

| Categoria | Componenti | Auto-install |
|-----------|-----------|--------------|
| **CRITICAL** | Node 20+, npm, Claude CLI | `npm run setup:deps` (postinstall + manuale) |
| **CRITICAL** | node-pty (compile native) | `npm install` (richiede VS Build Tools su Win) |
| **CORE** | Python 3.11+, psutil, watchdog, pywinpty | `setup-deps.ps1`/`.sh` crea venv + pip install |
| **OPTIONAL** | Playwright (browser custom providers) | `npx playwright install` |
| **OPTIONAL** | Cloudflared (deploy pubblico) | wizard browser o script manuale |
| **OPTIONAL** | Obsidian (vault knowledge browser) | install dal sito ufficiale |

**Banner runtime check**: la dashboard mostra automaticamente un banner ambra
in cima se manca qualche dipendenza critical, con comandi copy-paste e link
install.

---

## Esposizione pubblica via Cloudflare

Hai due opzioni per accedere alla dashboard da fuori casa:

### Opzione A: wizard browser (raccomandato)

Dopo il primo claim, in dashboard sidebar trovi "Setup pubblico (Cloudflare)".
Wizard step-by-step ti guida a:
1. Verifica che il dominio sia su Cloudflare DNS
2. Install cloudflared (1-click winget/brew/apt)
3. Login OAuth Cloudflare
4. Crea tunnel + DNS route
5. Verifica connection
6. (Opzionale) Cloudflare Access policy email-allowlist come secondo strato

### Opzione B: PDF download + script manuale

Scarica `docs/SAIO-cloudflare-setup-guide.pdf` (in repo) per istruzioni complete
con screenshots. Per Windows è disponibile anche:

```powershell
pwsh scripts/cloudflare-tunnel-setup.ps1 -Hostname saio.tuodominio.com
pwsh scripts/cloudflare-tunnel-run.ps1
```

### Cloudflare Access policy (raccomandato come 2° strato)

Pre-bootstrap, l'unica difesa è il claim token TTL 24h. Per chiudere quella
finestra con un secondo strato:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**
2. Add Application → **Self-hosted** → host: `saio.tuodominio.com`
3. Policy: include `Emails` → `tu@tuodominio.com`
4. Salva. Cloudflare Access ora blocca chi non è in allowlist PRIMA che la
   request arrivi a SAIO.

---

## Auth recovery

Tutto lo stato auth è in `data/auth/` (gitignored). Non esiste reset web.

### Reset owner (perdita TOTP + recovery codes)

```bash
ssh user@vps
cd /path/to/saio
rm data/auth/owner.json data/auth/totp-secrets.json data/auth/recovery-codes.json \
   data/auth/sessions.json data/auth/allowed-emails.json data/auth/claim-state.json
pm2 restart dashboard   # o systemctl
# Log mostra nuovo CLAIM TOKEN. Vai a https://<tunnel>/claim?token=<NEW>
```

### Reissue claim token senza restart

```bash
npm run claim:reissue
# Genera nuovo token + cancella vecchio. Server in esecuzione vede subito.
```

### Sblocco solo 2FA

```bash
rm data/auth/totp-secrets.json data/auth/recovery-codes.json
pm2 restart dashboard
# Next login per chiunque in allowlist → re-enroll TOTP
```

### Revoke globale sessioni (cookie sospetto leakato)

```bash
echo '{"version":1,"sessions":[]}' > data/auth/sessions.json
pm2 restart dashboard
# Tutti gli utenti vedono 401 → re-login richiesto
```

### Rotazione JWT secret

```bash
rm data/auth/.jwt-secret
echo '{"version":1,"sessions":[]}' > data/auth/sessions.json
pm2 restart dashboard
```

### Ban manuale IP

Edita `data/auth/banned-ips.json`:

```json
{"version":1,"bans":[{"ip":"1.2.3.4","bannedAt":"<ISO>","expiresAt":null,"reason":"manual","failCount":0}]}
```

No restart, file letto su ogni request.

---

## Troubleshooting

### Generale
- **Dev server non parte**: verifica Node 20+ (`node --version`), reinstall `npm install`
- **Orchestrator non spawna terminali**: verifica `claude` in PATH (`Get-Command claude` su Windows, `which claude` su Linux/Mac)
- **Dettatura vocale non funziona**: solo Chrome/Edge (Web Speech API)
- **Task "running" dopo crash**: lock stale puliti dopo 30s via psutil
- **SSE non riceve eventi**: `curl http://127.0.0.1:3031/api/health` deve ritornare 200

### "SESSIONE TERMINATA" sui task / orchestrator non parte

**Causa più frequente**: orchestrator Python crasha al boot per dipendenze mancanti
(`pywinpty` su Windows, `psutil`, `watchdog`).

**Diagnostica** (V15.0 WS19):
```bash
npm run diag:orchestrator
```
Output mostra:
- Python interpreter risolto (venv vs sistema)
- Stato import per ogni dep richiesta
- Tail dell'ultimo log spawn orchestrator
- Suggerimento fix concreto

**Fix automatico via UI**: dopo login, banner giallo in alto su Inbox → bottone
**"Installa Python deps automaticamente"** → crea venv `orchestrator/.venv` e installa
`requirements.txt` con streaming output. Riavvia il backend al termine.

**Fix manuale**:
```bash
# 1. Crea venv + install
npm run setup:deps

# 2. Verifica
npm run diag:orchestrator   # tutti ✓

# 3. Riavvia backend
# Ctrl+C nel terminale corrente
npm run dev:all
```

**Verifica deps al volo**:
```bash
# Win
.\orchestrator\.venv\Scripts\python.exe -c "import psutil, watchdog, winpty; print('ok')"

# POSIX
./orchestrator/.venv/bin/python -c "import psutil, watchdog; print('ok')"
```

**Log spawn orchestrator** (V15.0 WS19): `data/logs/orchestrator-spawn-*.log`
contiene stdout+stderr di ogni spawn detached. Utili per identificare crash:
```bash
ls -lt data/logs/orchestrator-spawn-*.log | head -5
cat data/logs/orchestrator-spawn-<latest>.log
```

### Auth

#### Claim banner non viene stampato
- Verifica `data/auth/owner.json` non esistente
- Se esistente, dashboard è già claimato. Reset via SSH (vedi "Reset owner")

#### Magic link non arriva
- Test prima con DEBUG mode: `DASHBOARD_AUTH_DEBUG_MAGIC_LINK=true npm run dev:server` → link in stdout
- Se DEBUG ok ma SMTP no: verifica credenziali nel wizard (validazione live deve essere ✓ verde)
- Hosting tuo dominio (ChemiCloud/Aruba/cPanel): destinatario DEVE essere casella stesso dominio
- Spam folder destinatario
- Audit log `data/auth/audit.log` mostra esito

#### TOTP code non valido
- Drift orologio: tollera ±30s. Se telefono e server divergono di più, fail
- Su VPS: verifica NTP sync (`timedatectl status`)
- Code cambia ogni 30s. Inserisci CORRENTE
- Recovery codes single-use: una volta usati, non si rigenerano

#### "session_revoked" inatteso
- Cookie scaduto (saio_at = 1h). Frontend prova silent refresh automatico
- Se anche refresh (saio_rt = 7d) scaduto → redirect /login
- Owner ha revocato → 401 immediato

#### Cloudflare Tunnel
- Errore CORS: `DASHBOARD_AUTH_TUNNEL_URL` in `.env.local` deve matchare esattamente l'URL del tunnel (no trailing slash)
- 502 Bad Gateway: backend Express non listening su 127.0.0.1:3031
- 1033/1034 Cloudflare: tunnel down. `cloudflared tunnel info <name>` per status

#### Rate limit / IP ban
- 6 magic-link/15min → 429
- 5 TOTP fail → IP bannato 30min in `data/auth/banned-ips.json`
- Sblocco: edit `banned-ips.json` rimuovendo entry, no restart

### Diagnostic commands

```bash
# Auth state completo
ls -la data/auth/
cat data/auth/owner.json
cat data/auth/claim-state.json | python -m json.tool

# Audit log
tail -20 data/auth/audit.log | python -m json.tool

# Test endpoint health
curl -i http://127.0.0.1:3031/api/health
curl -i http://127.0.0.1:3031/api/auth/claim/status

# Test cloudflared
cloudflared tunnel info saio-dashboard
cloudflared tunnel list

# Test deps runtime
npm run setup:deps -- --check-only
```

---

## FAQ

**Q: Posso avere più owner?**
A: No. Single-owner per design. Per "trasferire" ownership: SSH reset full wipe + nuovo claim.

**Q: Devo configurare per forza email reale?**
A: No in dev (`DASHBOARD_AUTH_DEBUG_MAGIC_LINK=true` stampa link in stdout). Sì in produzione.

**Q: I miei guest possono diventare owner?**
A: No. Guest accedono a `/inbox`, `/projects`, etc. NON vedono `/settings/access`.

**Q: Cosa succede se perdo TOTP + recovery codes?**
A: SSH alla VPS, segui "Reset owner" — wipa data/auth/, restart, nuovo claim.

**Q: Login protetto contro brute force?**
A: Sì. Rate limit 6 TOTP/15min/IP. 5 fail → ban 30min in `banned-ips.json`.

**Q: Come ruoto JWT secret?**
A: SSH → `rm data/auth/.jwt-secret && echo '{"version":1,"sessions":[]}' > data/auth/sessions.json && pm2 restart`. Tutti re-login.

**Q: Funziona offline?**
A: Frontend sì. Magic-link login richiede Internet. Dopo login, cookies offline 7gg.

**Q: Cloudflare Access è obbligatorio?**
A: No. Senza, il claim token TTL 24h + JWT cookie sono l'unica difesa. Access raccomandato come 2° strato in deploy pubblico.

**Q: Obsidian è obbligatorio?**
A: No, opzionale al 95%. Senza vault, solo `/docs` page mostra "vault non configurato". Il resto funziona normale.

**Q: SAIO funziona su Mac/Linux/Windows?**
A: Sì cross-platform. Setup automatico via brew (Mac), apt/dnf/pacman (Linux), winget (Windows).

---

## Garanzie antidistruttive (cosa SAIO non fa mai senza tuo consenso)

V15.0 WS18 introduce vincoli centralizzati per proteggere i tuoi dati:

### File mai toccati senza consenso esplicito
- I tuoi progetti importati con autoscan → SAIO registra solo metadata in `data/projects.json`. **Mai modifica i file dei progetti** automaticamente.
- File con frontmatter YAML (note Obsidian) → preservati, mai sovrascritti.
- `.git/`, `.obsidian/`, `.env*` esistenti → read-only per le sessioni Claude orchestrate.

### Backup automatici pre-modifica
- **Vault Obsidian autoconfig (WS17)**: PRIMA di generare il brief autoconfig,
  SAIO crea uno ZIP completo del vault in `data/backups/obsidian-pre-autoconfig-<ts>.zip`.
  Se il backup fallisce, l'autoconfig NON viene avviato. Path mostrato nel brief
  per rollback facile.
- **`.env.local` write**: backup automatico `.env.local.backup-<ts>` ogni volta
  che il wizard scrive nuove credenziali.
- **Auth reset**: `npm run auth:reset` crea backup `data/backups/auth-pre-reset-<ts>/`
  con tutti i file auth prima di cancellarli. Niente perdita irreversibile.

### Vincoli mandatori per sessioni Claude orchestrate
Ogni brief generato da SAIO include la costante `ANTIDESTRUCTIVE_GUARDRAILS`:
1. Nessun comando distruttivo automatico (rm -rf, git clean -fd, DROP, TRUNCATE) senza conferma esplicita
2. Backup pre-modifica obbligatorio per operazioni > 10 file
3. Conferma utente per azioni massive (> 10 file modificati/eliminati)
4. Working dir constraint: lavora solo nella sotto-cartella indicata
5. Preservazione file utente (frontmatter YAML, .git/, .obsidian/, .env*)
6. Rollback su errore (no "fix" creativi che peggiorano)
7. Limite 4h/1M token per sessione

L'utente vede questi vincoli **PRIMA** di approvare un brief in Inbox.

### Pre-flight git snapshot
Quando l'orchestrator spawna una sessione Claude su un progetto git, SAIO
salva snapshot `git status --porcelain` + commit hash in `data/sessions/<sid>/pre-state.txt`
PRIMA di iniziare, così puoi confrontare lo stato pre/post.

### Reset SAFE
Mai eseguire `rm -rf data/auth/` a mano. Usa invece:

```bash
npm run auth:reset    # interattivo: mostra files che cancella + crea backup pre-reset
```

Cancella SOLO i file auth listati, mai progetti o brief o audit log.

### Cosa SAIO NON installa mai senza consenso
- Python, Claude CLI, Obsidian → installati solo dopo click esplicito utente nel wizard
- VS Build Tools → suggerito solo se npm install fallisce su node-pty
- Tutti i package ID hardcoded nel codice (`Obsidian.Obsidian`, `Cloudflare.cloudflared`, `Python.Python.3.11`) — niente input utente per evitare command injection

---

## Politica d'uso (abuse policy)

SAIO è uno strumento di automazione personale per semplificare workflow di
sviluppo e gestione progetti. **L'utente è responsabile dell'uso che fa di
SAIO** e degli effetti su altri sistemi che SAIO orchestra.

**Non usare SAIO per**:
- Spam, mailing massivi non consensuali, scraping aggressivo
- Bypassare ToS dei provider AI (Anthropic, Google, OpenAI, ecc.) o di altri
  servizi (es. evadere rate limits, condividere account, abusare offerte trial)
- Attività illegali nel paese di residenza dell'utente
- Diffusione di malware o impersonificazione di terzi
- Operazioni che violino privacy o dati personali di terzi senza consenso

**Gli autori di SAIO**:
- Non garantiscono compatibilità con i ToS dei provider integrati
- Non offrono supporto commerciale o di emergenza
- Non si assumono responsabilità per uso improprio o danni derivati
- Non raccolgono telemetria: SAIO è 100% locale, nessun dato esce dal tuo
  sistema (a meno di Cloudflare Tunnel se attivato esplicitamente)

L'integrazione con servizi terzi (Anthropic API, Resend, Cloudflare, Gmail SMTP)
ricade sotto i ToS di quei servizi, che l'utente deve leggere e accettare
direttamente con loro.

---

## Contributing

1. Fork il repo + branch feature dal `main`
2. Codestyle: TypeScript strict, ESLint + tsc --noEmit puliti
3. Pre-commit: `npm run typecheck && npm run lint`
4. Test E2E: `npm run dev:all` su clone fresh, claim flow + login
5. PR descrittiva: cosa cambia, perché, screenshot UI se rilevante
6. Vedi il file `CLAUDE.md` (presente nel repo) per pattern interni e
   convenzioni vault Obsidian

---

## Licenza

**MIT con clausola no-commercial-resell**:
- ✓ Uso personale gratuito
- ✓ Fork + modifiche per uso interno aziendale
- ✓ Contribution upstream
- ✗ Rivendita come SaaS commerciale o servizio pagato (anche freemium)
- ✗ White-label per scopi commerciali

Vedi `LICENSE` per dettagli legali.

---

**Versione corrente**: V15.0 (multi-sprint WS3 → WS14, Aprile 2026).
**Origine**: Revolution Marketing, dashboard interna pre-public release.

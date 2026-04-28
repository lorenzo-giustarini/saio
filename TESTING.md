# SAIO Tauri — Beta Testing Guide (V15.9 WS39)

> **Per chi**: amici beta tester che provano SAIO Tauri su **macOS** o **Ubuntu Linux**.
> **Obiettivo**: verificare che SAIO funzioni correttamente sui vostri OS e segnalare/fixare bug rilevati.
> **Stato**: SAIO Tauri **funziona end-to-end su Windows 10/11**. Linux e macOS hanno il codice pronto (Platform Abstraction Layer) ma servono test reali per validare.

---

## 🎯 Cosa stiamo testando

SAIO è una **dashboard desktop** per orchestrare progetti AI (Claude, Gemini, OpenAI), gestire cron locali, terminali, vault Obsidian. È stato sviluppato originariamente solo per Windows; ora abbiamo portato il codice su macOS + Linux ma **serve verificare che davvero funzioni** su questi OS.

Non temere di fare danni: SAIO è isolato in una cartella, non tocca il sistema (eccetto cron che gestiamo tramite systemd-timer su Linux o launchd su macOS, sempre user-level senza admin).

---

## 📦 Setup prerequisiti

### macOS (13+ Ventura/Sonoma, Apple Silicon o Intel)

1. **Homebrew** (se non lo hai):
   ```bash
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

2. **Node.js 20+** + **Python 3.11** + **Git**:
   ```bash
   brew install node python@3.11 git
   node --version    # deve dire v20.x.x o superiore
   python3 --version # deve dire 3.11.x
   ```

3. **Rust toolchain** (richiesto per build da source — saltare se userai installer .dmg precompilato):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   cargo install tauri-cli --version "^2"
   ```

4. **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```

### Ubuntu Linux (22.04 LTS+)

1. **Aggiorna sistema**:
   ```bash
   sudo apt update && sudo apt upgrade -y
   ```

2. **Setup automatico SAIO** (lancia il nostro script):
   ```bash
   chmod +x scripts/setup-deps-linux.sh
   ./scripts/setup-deps-linux.sh
   ```
   Questo installa Node 20 LTS + Python 3 + Git + build-essential + abilita systemd user lingering.

3. **Webkit dependencies** (per Tauri webview):
   ```bash
   sudo apt install -y libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev patchelf
   ```

4. **Rust toolchain** (saltare se userai .deb/.AppImage):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source $HOME/.cargo/env
   cargo install tauri-cli --version "^2"
   ```

---

## 🚀 Installazione SAIO Tauri

### Opzione A — Da installer precompilato (raccomandato)

Vai alla **GitHub Releases** del progetto e scarica l'installer per il tuo OS:

| OS | File | Note |
|----|------|------|
| macOS Apple Silicon (M1/M2/M3) | `SAIO_1.0.0_aarch64.dmg` | Preferito |
| macOS Intel | `SAIO_1.0.0_x64.dmg` | |
| Ubuntu / Debian | `saio_1.0.0_amd64.deb` | `sudo dpkg -i saio_1.0.0_amd64.deb` |
| Linux portable | `saio_1.0.0_amd64.AppImage` | `chmod +x` poi double-click |

**Importante**: il binario NON è firmato (code signing skipped per ora). Su:
- **macOS**: doppio click su `.dmg` → potrebbe dire "App da sviluppatore non identificato". Soluzione: tasto destro → "Apri" → "Apri lo stesso", oppure terminal: `xattr -d com.apple.quarantine /Applications/SAIO.app`.
- **Windows**: Defender mostra warning "Editor sconosciuto". "Ulteriori informazioni" → "Esegui comunque".
- **Linux**: AppImage funziona out-of-the-box.

### Opzione B — Da sorgente (developers)

```bash
git clone https://github.com/<URL_REPO_BETA>.git saio-tauri
cd saio-tauri
npm install --ignore-scripts
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/<format>/`

---

## ⚙️ Step 0 — Post-install setup (Windows ONLY, one-shot)

**Solo se sei tester Windows**: il toggle ON/OFF dei cron richiede privilegi admin per `schtasks`. Per evitare un popup UAC ad ogni click, registriamo un task scheduler dedicato `RM-Saio-Tauri-Elevator` (RunLevel=Highest, owner = utente corrente). Da quel momento il backend dialoga col task via JSON IPC e il toggle è **zero-UAC**.

### Installer NSIS (`SAIO_1.0.0_x64-setup.exe`) — **NULLA da fare**

L'installer NSIS registra automaticamente `RM-Saio-Tauri-Elevator` durante l'installazione (vedrai 1 prompt UAC standard di NSIS, accetta — la registrazione del task avviene in quello stesso elevated context, ZERO popup extra).

Verifica post-install: apri PowerShell e lancia
```powershell
schtasks /query /tn RM-Saio-Tauri-Elevator
```
Deve listare il task. Se NON lo trova, esegui lo Step manuale qui sotto.

### Installer non usato (build da source / dev mode) — esegui manualmente

Se lavori da clone Git (`saio-tauri/`) e fai `npm run tauri:dev`, devi registrare il task manualmente UNA volta sola. Apri **PowerShell come amministratore** (Start menu → tasto destro → "Esegui come amministratore") e digita (NON copy/paste — alcune chat sostituiscono `.ps1` con un link):

```powershell
cd C:\Users\<tuo_user>\Desktop\saio-tauri
.\scripts\register-elevator.ps1
```

Output atteso: `OK Task registrato. Da ora la dashboard NON chiedera piu UAC per: enable, disable, run, create, delete, rename`.

Verifica: `schtasks /query /tn RM-Saio-Tauri-Elevator` deve listare il task.

> **Linux / macOS**: equivalente NON necessario in questa beta — `pkexec` (Linux) e `osascript -e 'with administrator privileges'` (macOS) chiedono password una volta per sessione, ma è normale. Tracciato come miglioramento post-v1.0.

---

## ✅ Smoke Test — verifica funzionalità base (~10 min)

Apri SAIO (doppio click sull'icona installata o `SAIO.app`).

### 1. **Setup iniziale (claim)**
- Alla prima apertura, dovrebbe portarti a una pagina **`/claim`** che chiede:
  - Email
  - Password (scegli una nuova, NON è collegata a niente di tuo)
  - Claim token (verrà generato automaticamente al primo avvio del backend Express, lo trovi nei log oppure in `~/.config/saio-tauri/data/auth/CLAIM-TOKEN.txt` su Linux, `~/Library/Application Support/saio-tauri/data/auth/CLAIM-TOKEN.txt` su macOS)
- Compila e clicca "Claim".
- Dovrebbe configurare email SMTP (puoi usare Gmail con app password).
- Riceverai un **magic link via email** → cliccalo.
- Setup TOTP: scannerizza QR con Google Authenticator/Authy/1Password → inserisci codice 6 cifre.
- Salva i **recovery codes** mostrati.

✅ Atteso: arrivi alla **dashboard SAIO** con header laterale (Inbox, Task attivi, Progetti, Docs/Vault, Deep Research, Automazioni, Archivio, Metriche, Extras).

### 2. **Pagina Account Provider**
- Sidebar → "Accounts" o cerca dropdown header in alto.
- Atteso: vedi 0-5 account autodetectati basati sulle env vars del tuo sistema:
  - `ANTHROPIC_API_KEY` → genera "Anthropic Plan" (se hai Claude Code installato)
  - `OPENAI_API_KEY` → "OpenAI API"
  - `GEMINI_API_KEY` → "Google API"
  - `FAL_KEY` → "fal.ai API"
- ✅ Atteso: dropdown account funziona, mostra label corretti.

### 3. **Cron page** (test critico cross-platform)
- Sidebar → "Automazioni" → "Cron".
- Atteso vedi lista task scheduler nativi:
  - **Linux**: timer systemd user-level (`~/.config/systemd/user/`)
  - **macOS**: LaunchAgents (`~/Library/LaunchAgents/`)
  - **Windows**: Task Scheduler (`schtasks`)
- **Test create**: clic "+ Nuovo cron" → nome `Obsidian-TEST-DEMO`, schedule `Daily 23:55`, command `echo test`. Crea.
- ✅ Atteso: appare nella lista. Toggle ON/OFF deve funzionare.
- **Test delete**: clic icona cestino. Atteso: scompare.

> **Su Windows**: se al toggle vedi il popup UAC ogni volta, NON hai eseguito Step 0 (registrazione `RM-Saio-Tauri-Elevator`). Tornaci e registralo. Su Linux/macOS la prima volta nella sessione ti chiede la password sudo/keychain — è normale.

### 4. **Crea progetto**
- Sidebar → "Progetti" → "+ Nuovo progetto".
- Nome: `test-cross-platform`, brief: "Verifica funzionalità SAIO su [tuo OS]".
- Atteso: appare nella lista progetti.
- Apri il progetto: dovrebbe spawnare un **terminale Claude Code** (xterm) integrato.
- ✅ Atteso: terminale si apre, claude.exe (o `claude` CLI) parte, prompt visibile.

### 5. **Vault docs**
- Sidebar → "Docs / Vault".
- Atteso: vedi tree del tuo vault `~/.claude/projects/...` (se esiste).
- Click su un file `.md` → renderizza markdown.

### 6. **Verifica console**
- Apri DevTools nella finestra (Ctrl+Shift+I su Linux/Win, Cmd+Option+I su macOS).
- Tab **Console**: dovrebbe essere **VUOTA** (zero errori rossi).
- Tab **Network**: tutte le `/api/*` rispondono **200 OK**.

---

## 🐛 Debug — cosa fare se trovi un bug

### Step 1: Raccogli evidence
1. **Screenshot** dell'errore visivo.
2. **Console errors**: DevTools → Console → click destro → "Save as" log file.
3. **Network errors**: DevTools → Network → filtra "Failed" → screenshot.
4. **Backend log**:
   - **macOS**: `~/Library/Logs/saio-tauri/` o launch da terminal `cargo tauri dev` per vedere log live
   - **Linux**: `~/.config/saio-tauri/logs/` o launch da terminal
   - **Windows**: `%APPDATA%\saio-tauri\logs\`
5. **OS info**: `node --version`, `python3 --version`, `uname -a` (Linux/macOS), `systeminfo` (Win).

### Step 2: Identifica componente

| Sintomo | Probabile componente | File da guardare |
|---------|---------------------|------------------|
| Cron non si crea / non si toggla | PAL TaskScheduler | `server/lib/platform/<linux|macos>/task-scheduler.ts` |
| Account non si aggiungono / atomic-write fail | atomic-write retry | `server/lib/atomic-write.ts` |
| Login/TOTP fallisce | auth flow | `server/routes/auth.ts`, `server/lib/auth/*` |
| Schermata bianca all'avvio | bundle Vite/JS error | DevTools Console + `node_modules/.vite/deps/` integrity |
| Comando admin chiede password ripetutamente | Elevator (sudo/pkexec/osascript) | `server/lib/platform/<linux|macos>/elevator.ts` |
| Spawn terminale Claude non funziona | Shell PTY | `server/lib/platform/<linux|macos>/shell.ts`, `pty-manager.ts` |

### Step 3: Fix + push

1. Fai una **branch feature**:
   ```bash
   git checkout -b fix/<short-description>
   ```

2. Modifica il file rilevante. Tipicamente l'implementazione PAL per il tuo OS è in:
   - `server/lib/platform/linux/*.ts`
   - `server/lib/platform/macos/*.ts`

3. Test locale: `npm run tauri:dev`, riproduci il bug, verifica che il fix lo risolva.

4. Commit con messaggio descrittivo:
   ```bash
   git add <file>
   git commit -m "fix(<os>): <breve descrizione>

   Sintomo: <cosa non funzionava>
   Causa: <root cause identificata>
   Fix: <cosa hai cambiato>
   Tested on: <macOS Sonoma 14.x | Ubuntu 22.04>"
   ```

5. Push:
   ```bash
   git push origin fix/<short-description>
   ```

6. Crea **Pull Request** su GitHub (link torna nel terminale dopo `git push`).

### Step 4: Submission rapida (alternativa)

Se non vuoi/puoi fare PR, mandami via email/Slack/WhatsApp:
- Lista bug trovati con dettaglio (Step 1)
- Eventuale fix che hai fatto come patch (`git diff > fix.patch`)
- OS + versione

Le ricontrollo io e applico al repo principal.

---

## 🧪 Esempio: test e2e completo Linux

Se vuoi essere thorough, esegui questo script di test (~10 min):

```bash
cd saio-tauri
# 1. Verifica build
npm install --ignore-scripts
npm run tauri:dev &
sleep 60
# 2. Verifica processi
pgrep -f saio
ss -ltn | grep -E ':303[01]'
# 3. Test API smoke
TOKEN=$(cat data/auth/CLAIM-TOKEN.txt 2>/dev/null)
curl -s http://127.0.0.1:3031/api/health
# 4. Cron lifecycle test (richiede auth — fallo via UI dopo claim)
# 5. Cleanup
pkill -f saio
```

---

## 📞 Domande / supporto

- **Repository GitHub**: <URL_REPO> (issues + PR)
- **Lorenzo**: <email/Slack>
- **Documentazione architettura**: `ARCHITECTURE.md`

---

## Roadmap noi → v1.0.0 stable

1. **Beta release**: voi tester (Mac + Ubuntu) provate, segnalate bug
2. **Bug fix iteration**: io fixo, voi rivalidate
3. **CI/CD GitHub Actions**: build automatica matrix su push
4. **v1.0.0 stable**: tag git → GitHub Release con installer ufficiali

Buon testing! 🚀

# SAIO Tauri 2 — Architecture

> **Versione**: V15.9 WS39
> **Stack**: Tauri 2 (Rust shell) + Express sidecar + React frontend + Platform Abstraction Layer
> **Target OS**: Windows 10/11, Ubuntu 22.04+, macOS 13+ (Apple Silicon + Intel)

---

## High-level overview

```
┌──────────────────────────────────────────────────────────────────┐
│  SAIO.exe / SAIO.app / SAIO.AppImage  (Tauri 2 desktop app)      │
│                                                                  │
│  ┌─────────────────────┐         ┌──────────────────────────┐   │
│  │  Tauri Rust shell   │  spawn  │  Express sidecar         │   │
│  │  (~300 LOC main.rs) │ ──────> │  (Node.js + TypeScript)  │   │
│  │  - window mgmt      │  IPC    │  - REST API :3031        │   │
│  │  - auto-update      │  HTTP   │  - WebSocket PTY         │   │
│  │  - native dialogs   │ <────── │  - cron / accounts /     │   │
│  └─────────────────────┘         │    deep research / vault  │   │
│            │                      └──────────────────────────┘   │
│            │ loads webview                       │               │
│            v                                     │ uses          │
│  ┌─────────────────────┐                        v               │
│  │  React frontend     │           ┌──────────────────────────┐ │
│  │  (Vite + R19)       │           │  Platform Abstraction    │ │
│  │  - dashboard UI     │           │  Layer (PAL)             │ │
│  │  - cron page        │           │                          │ │
│  │  - accounts page    │           │  ITaskScheduler          │ │
│  │  - terminal (xterm) │           │  IPackageManager         │ │
│  │  - vault docs       │           │  IElevator               │ │
│  └─────────────────────┘           │  IShell, IPaths,         │ │
│                                    │  IInstaller              │ │
│                                    └────────────┬─────────────┘ │
│                                                 │               │
│                            ┌────────────────────┼────────────┐  │
│                            v                    v            v  │
│                   ┌──────────────┐  ┌──────────────┐  ┌────────┐│
│                   │  Win impl    │  │  Linux impl  │  │ macOS  ││
│                   │  schtasks +  │  │  systemd +   │  │ launchd││
│                   │  winget +    │  │  apt/dnf +   │  │ + brew ││
│                   │  elevator    │  │  pkexec      │  │ + osa- ││
│                   │              │  │              │  │ script ││
│                   └──────────────┘  └──────────────┘  └────────┘│
└──────────────────────────────────────────────────────────────────┘
```

---

## Component breakdown

### 1. Tauri Shell (`src-tauri/`)

Rust binary minimo (~300 LOC) responsabile di:

- **Window management**: apre finestra desktop nativa (1280×800, dark theme, custom icon)
- **Sidecar lifecycle**: spawn Express server all'avvio, kill al window close
- **Auto-update**: polling endpoint GitHub Releases via `tauri-plugin-updater`
- **Native dialogs**: file picker, alert (`tauri-plugin-dialog`)
- **Process plugin**: `tauri-plugin-process` per restart graceful

Files:
- `src-tauri/Cargo.toml` — dipendenze Rust (tauri 2, plugins)
- `src-tauri/src/main.rs` — entry point binario
- `src-tauri/src/lib.rs` — `pub fn run()` con setup hooks
- `src-tauri/tauri.conf.json` — config window, bundle, security CSP, updater
- `src-tauri/capabilities/default.json` — permissions allowlist (shell:execute, fs:read, etc.)

### 2. Express Sidecar (`server/`)

Backend Node.js + TypeScript invariato rispetto a SAIO originale, ma:

- **Bundlato in single .js** via esbuild (`scripts/build-sidecar.ts`) per release
- **Node runtime portable** distribuito side-by-side (~50MB) — l'app non richiede Node installato sul target
- **Lifecycle**: lanciato come sidecar Tauri al boot, ucciso al window close

In dev: usa `tsx watch server/index.ts` come sidecar (HMR-aware).

API endpoints invariati: `/api/health`, `/api/accounts`, `/api/projects`, `/api/cron`, ecc.

### 3. Frontend React (`src/`)

Invariato rispetto a SAIO originale. Vite dev server + React 19 + Tailwind. Comunica con sidecar via fetch a `http://127.0.0.1:3031` (porta random in release per evitare conflitti).

### 4. Platform Abstraction Layer (`server/lib/platform/`)

**Cuore del cross-platform**. Interfaces TypeScript con 3 implementazioni native.

#### Interfaces

| Interface | Responsibility | Esempio metodo |
|-----------|----------------|----------------|
| `ITaskScheduler` | Cron locale | `create()`, `enable()`, `delete()` |
| `IPackageManager` | Install/upgrade tools | `upgrade(packageId)` |
| `IElevator` | Privilege escalation | `run(elevatorOp)` |
| `IShell` | PTY + spawn detached | `defaultShell()`, `resolveExecutable()` |
| `IPaths` | Filesystem paths | `home()`, `configDir(app)` |
| `IInstaller` | CLI tool installation | `installCli(spec)` |

Factory `getPlatform()` ritorna `IPlatform` aggregato (tutte le interfaces) basato su `os.platform()`.

#### Implementazioni

| Layer | Win10/11 | Ubuntu | macOS |
|-------|----------|--------|-------|
| Task Scheduler | `schtasks.exe` + elevator zero-UAC | `systemd-timer` user-level (`~/.config/systemd/user/`) | `launchd` LaunchAgents (`~/Library/LaunchAgents/`) |
| Package Manager | `winget` | `apt`/`dnf`/`pacman` (auto-detect) | `brew` (Homebrew) |
| Elevator | Task scheduler `RM-Saio-Tauri-Elevator` (RunLevel=Highest, owner triggered = no UAC) | `pkexec` (PolicyKit) + `sudo -n` | `osascript -e 'do shell script ... with administrator privileges'` |
| Shell | `cmd.exe /k` (ConPTY) | `bash`/`zsh -c` (forkpty) | `zsh -c` (forkpty) |
| Paths | `%APPDATA%`, `%LOCALAPPDATA%` | `$XDG_CONFIG_HOME`, `$XDG_DATA_HOME` | `~/Library/Application Support`, `~/Library/Caches` |

---

## Data flow esempi

### Scenario A: utente clicca "toggle ON" su un cron dalla UI

```
User click toggle
  │
  v
React: POST /api/cron/<name>/enable
  │
  v
Express route cron.ts
  │
  v
getPlatform().taskScheduler.enable(name)
  │
  ├─ Win:   WindowsTaskScheduler.enable() → elevator.run({op: 'task-enable'})
  │            → schtasks /run RM-Saio-Tauri-Elevator
  │            → elevator-windows.ps1 esegue schtasks /change /enable
  │            → result file → API ritorna {ok: true}
  │
  ├─ Linux: LinuxTaskScheduler.enable() → systemctl --user enable --now <name>.timer
  │            → no admin needed, ritorna direttamente
  │
  └─ macOS: MacOSTaskScheduler.enable() → launchctl load -w <name>.plist
               → no admin needed, ritorna direttamente
```

### Scenario B: utente clicca "Aggiorna Claude CLI"

```
User click "Update CLI"
  │
  v
React: POST /api/system/update-cli {tool: 'claude-code'}
  │
  v
getPlatform().packageManager.upgrade('@anthropic-ai/claude-code') (npm)
  oppure
getPlatform().installer.installCli({npmPackage: '@anthropic-ai/claude-code'})
  │
  ├─ Win:   WindowsInstaller → npm install -g (no elevation)
  │
  ├─ Linux: LinuxInstaller → npm install -g
  │
  └─ macOS: MacOSInstaller → npm install -g
```

(Per pacchetti sistema come Git/Node aggiornati via package manager nativo, l'IElevator gestisce sudo/pkexec/elevator come appropriato.)

---

## Bundle size + performance

| Component | Size (approx) | Note |
|-----------|---------------|------|
| Tauri Rust binary | 5-10 MB | dipende da OS, plugin abilitati |
| Node runtime portable | 30-50 MB | Node 20 LTS minified |
| Express bundle (esbuild) | 10-15 MB | tutto SAIO server in single .js |
| Frontend dist (Vite build) | 2-5 MB | gzipped |
| **Totale installer** | **50-90 MB** | (vs Electron ~150-250 MB) |

Startup time: ~1-2s (vs Electron 3-5s).

---

## Distribuzione (vedi CHANGELOG release)

- **Windows**: `SAIO_1.0.0_x64-setup.exe` (NSIS installer, perMachine, IT/EN)
- **macOS Apple Silicon**: `SAIO_1.0.0_aarch64.dmg`
- **macOS Intel**: `SAIO_1.0.0_x64.dmg`
- **Linux .deb**: `saio_1.0.0_amd64.deb` (Ubuntu/Debian)
- **Linux AppImage**: `saio_1.0.0_amd64.AppImage` (portable, qualsiasi distro)

Auto-update via `tauri-plugin-updater` polling `https://github.com/RevolutionMarketing/saio-tauri/releases/latest/download/latest.json`.

---

## Differenze vs SAIO originale

| Aspetto | SAIO orig (`dashboard/`) | SAIO Tauri (`saio-tauri/`) |
|---------|--------------------------|----------------------------|
| OS | Windows 10/11 only | Win10/11 + Ubuntu + macOS |
| UI | Browser localhost:3030 | App desktop nativa |
| Distribuzione | git clone + npm install | Installer .exe/.dmg/.AppImage |
| Auto-update | git pull manuale | tauri-updater integrato |
| Cron storage | Windows Task Scheduler | systemd-timer (Linux), launchd (macOS), schtasks (Win) |
| Task scheduler dedicato | `RM-Dashboard-Cron-Manager` | `RM-Saio-Tauri-Elevator` (separato) |
| Package manager | winget | winget (Win), apt/dnf (Linux), brew (macOS) |
| Elevation | schtasks elevator zero-UAC | + pkexec (Linux) + osascript (macOS) |
| Shell PTY | cmd.exe | + bash/zsh (Unix) |
| Cron scripts | 29 file `.ps1` | 1 file `cron-runner.ts` (Node TS dispatcher) |

SAIO originale **resta intoccato** in `dashboard/` repo `RevolutionMarketing/saio` come fallback safety per uso quotidiano dell'utente.

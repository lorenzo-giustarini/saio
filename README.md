<div align="center">

# SAIO

### Smart AI Office — your AI agency in one window

[![License: PolyForm-NC-1.0.0](https://img.shields.io/badge/License-PolyForm--NC--1.0.0-blue.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri)](https://tauri.app)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)](#installation)
[![Status](https://img.shields.io/badge/status-1.0.0--beta-yellow)](https://github.com/lorenzo-giustarini/saio/releases)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-ea4aaa?logo=github)](https://github.com/sponsors/lorenzo-giustarini)

</div>

---

## Status

**v1.0.0-beta** — production-ready on Windows. Linux and macOS code is complete (full Platform Abstraction Layer) but waiting on community validation. If you run Linux or macOS and want to help, see [TESTING.md](TESTING.md) — it's a 10-minute smoke test.

---

## Why I built SAIO

I'm a marketing agency owner who fell into building tools because I had to. By late 2024 I was running eight separate Claude Code sessions every morning — one terminal for branding work on Client A, another for VPS debugging on Project B, a cron job somewhere for daily reports, a fourth window for vault notes, a fifth for image generation. All of it stitched together with PowerShell scripts that grew brittle every week. The first fifteen minutes of every workday were spent asking "where did I leave that terminal?" before I could do any actual work.

SAIO is the office I wish I'd had. It's one native window where every AI project I'm running lives — each with its own terminal, its own provider keys, its own scheduled jobs, its own context. The mental tax of "which window, which provider, which secret key" disappears. I pick a project from the sidebar and the right CLI is already there, talking to the right model, with my kickoff brief loaded.

It's not a product. It's the workshop where my AI work happens. I'm releasing it under PolyForm Noncommercial because other operators and indie builders kept asking me what I was using, and the honest answer is "a thing I built for myself." If it helps you the way it helps me, I'm glad. If it doesn't, fork it and make it fit your shape.

---

## What you can do with SAIO

SAIO is the headquarters for your personal AI agency. Drop your projects in, point them at the right models, let SAIO take care of the plumbing.

- 🧠 **Run multiple AI projects in parallel** — each in its own native terminal session with isolated provider config (Anthropic Plan, OpenAI API, Google API, fal.ai). Switch the active provider for the whole window with one click.
- 🤖 **Embed any CLI tool** — `claude`, `codex`, `gemini`, `gh`, `npm`, your own scripts — inside a project session that remembers its working directory, its environment, and its history across restarts.
- 📅 **Schedule local cron jobs** — back up your vault, run a weekly report, retrigger a failed pipeline — natively through the OS scheduler (Windows Task Scheduler, Linux systemd, macOS launchd). No extra services, no internet dependency.
- 📝 **Read your Obsidian vault** as living documentation while you work — full Markdown rendering, link resolution, image preview, file tree, all without leaving the dashboard.
- 🔄 **Track decisions with the inbox** — drop JSON briefs in `data/briefs/` and SAIO renders them as cards with Yes / No / Skip buttons and voice input. Decisions become async and reviewable.
- 🔐 **Self-hosted, single-owner** — your AI keys, your projects, your machine. No SaaS account, no telemetry, no data leaves the box. Magic-link login plus TOTP plus recovery codes, all local.
- 🚀 **18 MB, native, fast** — Tauri 2 with a Rust shell, not Electron. Cold start under one second. Memory footprint that doesn't make your fans spin.

The compounding effect comes from one place: you stop wasting cycles on context-switching. Every minute you save on "where did I leave that?" is a minute you spend on the work that actually moves the needle.

---

## Why Tauri instead of Electron

| | SAIO (Tauri) | Typical Electron alternatives |
|---|---|---|
| Bundle size | ~18 MB | ~150 MB |
| RAM footprint | ~80 MB | ~300 MB |
| Native PTY | Yes (ConPTY / forkpty) | Often a web shim |
| Native task scheduler | Yes (schtasks / systemd / launchd) | Usually polyfilled |
| Cold start | Under 1 second | 2–4 seconds |

The trade-off: Tauri renders through the OS webview (Edge WebView2 on Windows, WebKitGTK on Linux, WKWebView on macOS), so behavior can shift slightly between platforms. We test on Chrome-equivalent webviews and report quirks in [TESTING.md](TESTING.md).

## Features at a glance

- Multi-provider AI orchestration with auto-detection from environment variables
- Embedded native PTY terminals for any CLI tool
- OS-native task scheduler integration (no third-party services)
- Project workspaces with isolated terminals, kickoff briefs, and lifecycle (active → archive → delete with confirm)
- Inbox decisions with voice input
- Read-only Obsidian vault renderer
- Self-hosted auth: claim flow + magic link + TOTP + recovery codes + JWT cookie sessions
- Atomic-write hardening for state files (resilient against AV interference on Windows)
- Optional auto-update via tauri-updater pointing to GitHub Releases

## Screenshots

> Screenshots will be added under `docs/screenshots/`. Pull requests welcome — anyone can drop a `dashboard.png`, `cron.png`, or `terminal.png` from their OS.

## Installation

### Pre-built installer (recommended)

Grab the latest installer for your OS from [Releases](https://github.com/lorenzo-giustarini/saio/releases):

| OS | File | Notes |
|----|------|-------|
| Windows 10/11 | `SAIO_<version>_x64-setup.exe` | NSIS installer. Registers the elevator task automatically so cron toggles never prompt for UAC. Defender may flag the unsigned binary — click "More info" → "Run anyway". |
| Ubuntu / Debian | `saio_<version>_amd64.deb` | `sudo dpkg -i saio_<version>_amd64.deb` |
| Linux portable | `saio_<version>_amd64.AppImage` | `chmod +x` then double-click |
| macOS Apple Silicon | `SAIO_<version>_aarch64.dmg` | Drag to Applications. Right-click → Open the first time, or run `xattr -d com.apple.quarantine /Applications/SAIO.app` |
| macOS Intel | `SAIO_<version>_x64.dmg` | Same as above |

### Build from source

See [Building from source](#building-from-source) below.

## Quick start

After installation, launch SAIO. The first run walks you through:

1. **Claim** — a one-time setup form where you pick the owner email plus password and paste the claim token (auto-generated by the backend on first launch — find it in stdout or at `<data-dir>/auth/CLAIM-TOKEN.txt`).
2. **Email provider setup** — enter SMTP credentials so SAIO can send the magic link. Gmail with an [App Password](https://myaccount.google.com/apppasswords) works fine, or use a Resend API key.
3. **Magic link** — open the email SAIO sends to the owner address and click the link.
4. **TOTP enrollment** — scan the QR with Google Authenticator, Authy, or 1Password and enter the six-digit code.
5. **Recovery codes** — save the ten single-use recovery codes somewhere safe.

You're now in the dashboard. The header dropdown shows providers auto-detected from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `FAL_KEY`). Pick one and start working.

### Where SAIO stores data

| OS | Data directory |
|----|----------------|
| Windows | `%APPDATA%\saio\` |
| Linux | `$XDG_CONFIG_HOME/saio/` (default `~/.config/saio/`) |
| macOS | `~/Library/Application Support/saio/` |

Inside: `accounts.json`, `projects.json`, `auth/`, `briefs/`, `responses/`, `tasks/`, `logs/`, `archive/`. Everything is gitignored — your data never leaves your machine.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri Shell (Rust ~300 LOC)                                │
│  • Window management (1280x800, dark, resizable)            │
│  • Sidecar lifecycle (spawn Express on launch, kill on quit)│
│  • Auto-update via tauri-updater                            │
└──────────────────────┬──────────────────────────────────────┘
                       │ spawns
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Sidecar Express Backend (Node.js + TypeScript)             │
│  • REST API on 127.0.0.1:3031                               │
│  • Auth (JWT cookie, magic link, TOTP)                      │
│  • PTY manager (ConPTY / forkpty per project)               │
│  • Cron orchestrator                                        │
│  • Account auto-detection                                   │
└──────────────────────┬──────────────────────────────────────┘
                       │ uses
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Platform Abstraction Layer (server/lib/platform/)          │
│  ┌─────────────┬─────────────┬─────────────┐                │
│  │  Windows    │   Linux     │    macOS    │                │
│  │ schtasks    │ systemd     │ launchd     │ TaskScheduler  │
│  │ winget      │ apt/dnf/yum │ brew        │ PackageManager │
│  │ cmd.exe     │ bash/zsh    │ zsh         │ Shell          │
│  │ schtasks    │ pkexec/sudo │ osascript   │ Elevator       │
│  │ %APPDATA%   │ XDG_*       │ ~/Library/* │ Paths          │
│  └─────────────┴─────────────┴─────────────┘                │
└─────────────────────────────────────────────────────────────┘
                       ▲
                       │ HTTP + Vite proxy
                       │
┌──────────────────────┴──────────────────────────────────────┐
│  Frontend (Vite dev / static bundle)                        │
│  React 19 + TypeScript + TailwindCSS + shadcn/ui            │
│  • Inbox, Tasks, Projects, Cron, Vault, Metrics pages       │
└─────────────────────────────────────────────────────────────┘
```

For the deep dive see [ARCHITECTURE.md](ARCHITECTURE.md).

## Building from source

### Prerequisites (all OSes)

- **Node.js 20+** — `node --version` should report v20 or later
- **Rust 1.77+** — install via [rustup.rs](https://rustup.rs)
- **Tauri CLI 2.x** — `cargo install tauri-cli@^2`
- **Git** plus **Python 3.11+** (some helper scripts rely on Python)

### Windows

- Install **Visual Studio Build Tools 2022** with MSVC v143 plus the Windows 11 SDK from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/downloads/)
- **WebView2 Runtime** is pre-installed on Windows 10 21H1+ and Windows 11. Otherwise grab the [Evergreen Standalone Installer](https://developer.microsoft.com/microsoft-edge/webview2)

```powershell
git clone https://github.com/lorenzo-giustarini/saio.git
cd saio
npm install
cargo tauri dev                       # dev mode with hot reload
# or
cargo tauri build --bundles nsis      # produces SAIO_<ver>_x64-setup.exe
```

### Linux (Ubuntu 22.04+ tested)

```bash
sudo apt update && sudo apt install -y \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    build-essential \
    curl wget file
# Then:
git clone https://github.com/lorenzo-giustarini/saio.git
cd saio
npm install
cargo tauri dev
# or
cargo tauri build --bundles deb appimage
```

There's a helper: `scripts/setup-deps-linux.sh` auto-installs everything (auto-detects apt / dnf / pacman).

### macOS (13+ Ventura/Sonoma)

```bash
xcode-select --install                # Command Line Tools
brew install node python@3.11 git
git clone https://github.com/lorenzo-giustarini/saio.git
cd saio
npm install
cargo tauri dev
# or
cargo tauri build --bundles dmg app
```

There's a helper: `scripts/setup-deps-macos.sh` auto-installs everything via Homebrew.

### Running the checks

```bash
npm run typecheck    # TypeScript strict mode
npm run lint         # ESLint
```

### Common build errors

- **Windows: "linker 'link.exe' not found"** → install Visual Studio Build Tools 2022 with MSVC v143
- **Linux: "package webkit2gtk-4.1 was not found"** → run `scripts/setup-deps-linux.sh`
- **macOS: "xcrun: error: invalid active developer path"** → run `xcode-select --install`
- **All: "antivirus deletes node-pty.node"** → add the repo folder to AV exclusions during build

See [TESTING.md](TESTING.md) for the full smoke-test procedure after install.

## Configuration

### Environment variables (optional)

Copy `.env.example` to `.env.local` and fill in the parts you need:

```bash
# Backend ports (defaults shown)
VITE_PORT=3030
SERVER_PORT=3031

# Vault path for the Obsidian renderer (optional)
VAULT_PATH=/path/to/your/obsidian-vault

# Auth required (true in production, false skips auth — dev only!)
DASHBOARD_AUTH_REQUIRED=true

# Email provider for the magic link (pick ONE: SMTP, Resend, or debug)
DASHBOARD_AUTH_FROM=
DASHBOARD_AUTH_SMTP_HOST=                 # e.g. smtp.gmail.com
DASHBOARD_AUTH_SMTP_PORT=587
DASHBOARD_AUTH_SMTP_USER=
DASHBOARD_AUTH_SMTP_PASS=                 # Gmail App Password (16 chars)

# OR Resend API
DASHBOARD_AUTH_RESEND_API_KEY=

# OR debug mode: prints the magic link to stdout (dev only)
DASHBOARD_AUTH_DEBUG_MAGIC_LINK=false

# AI provider keys (auto-detected at startup)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
FAL_KEY=
```

The auto-detection scan adds an account entry for each key it finds. You can also add custom providers later through the UI.

### Project structure

```
saio/
├── src/                    # React frontend (Vite + TS)
│   ├── pages/              # Inbox, Tasks, Projects, Cron, Vault, ...
│   ├── components/         # Reusable UI (shadcn/ui based)
│   ├── hooks/              # Custom React hooks
│   └── lib/                # API client, utils
├── server/                 # Express backend (TypeScript)
│   ├── routes/             # REST endpoints
│   ├── lib/                # Helpers, atomic-write, auth, ...
│   │   └── platform/       # Platform Abstraction Layer (Win/Linux/macOS)
│   └── index.ts            # Server entry
├── src-tauri/              # Rust shell + Tauri config
│   ├── src/lib.rs          # Sidecar lifecycle
│   ├── tauri.conf.json     # Window, bundle, signer config
│   └── installer-hooks.nsh # NSIS post-install elevator registration
├── scripts/                # Cross-platform helpers (PS1 + bash + TS)
├── .github/                # Issue/PR templates + Actions workflows
├── data/                   # Runtime state (gitignored)
└── docs/                   # Architecture, contributing, security
```

## Help me keep SAIO simple

SAIO is small on purpose. The whole point is that *you* — solo dev, indie hacker, agency operator — can hold the entire codebase in your head and bend it to your workflow. The day SAIO turns into a sprawling enterprise dashboard with twelve plugin systems is the day it stops being useful.

Three things I'd love help with:

- **Try it on Linux or macOS and break it.** I built the Platform Abstraction Layer for all three OSes but I only run Windows daily. The code is there but it needs eyes on it. [TESTING.md](TESTING.md) is a 10-minute smoke test — if something fails, please open an issue with the logs. That single act is worth more than ten new features.
- **Send a fix as a pull request.** Found a bug? Patch it on your fork and open a PR. I read every one. The [CONTRIBUTING.md](CONTRIBUTING.md) guide walks you through fork → branch → commit → PR.
- **Fork it for your team if you need something different.** The PolyForm Noncommercial license explicitly allows that. Your agency, your studio, your team — make a specialized SAIO that fits your specific shape, keep what works, throw out what doesn't. The upstream stays opinionated and lean. Your fork serves you.

When you do open a pull request to upstream, please optimize for: clarity over cleverness, fewer lines over more lines, removing options over adding options. The best contributions delete code or simplify behavior. SAIO only stays useful as long as it stays small.

## Contributing

The full guide is in [CONTRIBUTING.md](CONTRIBUTING.md). Quick version:

1. Fork the repo
2. Create a feature branch (`fix/`, `feat/`, `docs/`, ...)
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
4. Open a pull request to `main`

By contributing you agree to license your work under the same terms as the project.

Beta tester? Read [TESTING.md](TESTING.md) for the smoke-test procedure plus tips on filing useful bug reports.

## Roadmap

See [ROADMAP.md](ROADMAP.md). Highlights:

- v1.0.0-beta (now): Windows working, Linux + macOS code ready, beta tester program open
- v1.0.0: stable release once all three OSes are validated
- v1.1+: Node SEA single-binary distribution, theme system, vault Git auto-sync

## License

Source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).

**TL;DR**: free to use, modify, and redistribute for non-commercial purposes (personal use, research, education, hobby projects, non-profits). Selling the software, bundling it in a paid product, or using it to provide a paid service requires a separate commercial license.

For a commercial license inquiry, contact [lorenzo@revolutionmarketing.us](mailto:lorenzo@revolutionmarketing.us).

## Security

For security issue reports, please follow [SECURITY.md](SECURITY.md). Do **not** open a public issue for security-sensitive problems.

## Code of Conduct

Project participation requires adherence to the [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant 2.1).

## Support the project

SAIO is free and source-available. If it saves you hours every week and you'd like to say thanks, you can support the project on [GitHub Sponsors](https://github.com/sponsors/lorenzo-giustarini).

- **Recurring or one-time** — pick whatever fits.
- **0% platform fee** — every dollar goes to me. GitHub covers the Stripe processing fees for individual sponsors.
- **Tier perks** — sponsors get a thank-you in the README and access to a sponsors-only thread in [Discussions](https://github.com/lorenzo-giustarini/saio/discussions). More importantly, your support directly funds the time I spend on cross-platform validation, release engineering, and bug fixes.

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=github&style=for-the-badge)](https://github.com/sponsors/lorenzo-giustarini)

No pressure though — using SAIO and starring the repo is already meaningful. ⭐

## Credits

- **Author**: Lorenzo Giustarini ([@lorenzo-giustarini](https://github.com/lorenzo-giustarini))
- **Origin**: an internal tool at [Revolution Marketing LLC](https://revolutionmarketing.us)
- **Built on**: [Tauri](https://tauri.app), [React](https://react.dev), [Vite](https://vitejs.dev), [Express](https://expressjs.com), [TailwindCSS](https://tailwindcss.com), [shadcn/ui](https://ui.shadcn.com), [node-pty](https://github.com/microsoft/node-pty)
- **Inspired by**: the very specific frustration of running eight Claude Code terminals at once

If SAIO is useful to you, a star on the repo and feedback in [Discussions](https://github.com/lorenzo-giustarini/saio/discussions) is the best way to say thanks.

---

<div align="center">

**Built with care in 🇮🇹 Italy**

</div>


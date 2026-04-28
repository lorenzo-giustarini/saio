# Contributing to SAIO

Thank you for your interest in contributing to SAIO! This document explains how to report issues, propose features, and submit code changes.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Reporting Bugs](#reporting-bugs)
- [Proposing Features](#proposing-features)
- [Development Setup](#development-setup)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Code Style](#code-style)
- [Commit Message Convention](#commit-message-convention)

---

## Code of Conduct

By participating in this project you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before contributing.

## Reporting Bugs

Found a bug? Before opening a new issue:

1. **Search [existing issues](https://github.com/lorenzo-giustarini/saio/issues)** to see if it has already been reported.
2. **Reproduce on the latest `main`** — the bug may already be fixed.
3. **Open a new issue** using the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
   - OS + version (Win 10/11, Ubuntu 22.04, macOS 13+)
   - SAIO version (or commit SHA if dev build)
   - Exact steps to reproduce
   - Expected vs actual behavior
   - Console errors (DevTools → Console) and backend logs (`~/.config/saio/logs/` on Linux, `~/Library/Logs/saio/` on macOS, `%APPDATA%\saio\logs\` on Windows)
   - Screenshots if visual bug

## Proposing Features

For non-trivial features, open a [feature request issue](.github/ISSUE_TEMPLATE/feature_request.md) **before** writing code so we can discuss scope. Describe:

- **Problem**: what use case does this address?
- **Proposed solution**: how should it work?
- **Alternatives considered**: other approaches you thought about
- **Mockups/sketches** if UI-related

For tiny tweaks (typos, small UX improvements) just open a PR directly.

## Development Setup

### Prerequisites

- **Node.js 20+** + **npm**
- **Rust 1.77+** + **Cargo** (for Tauri 2 shell)
- **Tauri CLI 2.x**: `cargo install tauri-cli@^2`
- **OS-specific build deps**: see [README.md → Building from source](README.md#building-from-source)

### Clone and run

```bash
# Fork via GitHub UI, then:
git clone https://github.com/<your-username>/saio.git
cd saio
npm install
npm run dev          # backend Express + Vite frontend (http://localhost:3030)
# In another terminal:
cargo tauri dev      # opens native desktop window
```

First launch: register elevator task scheduler (Windows zero-UAC cron toggle):

```powershell
# PowerShell as Administrator (one-shot, idempotent)
.\scripts\register-elevator.ps1
```

On Linux/macOS no setup needed — `pkexec` and `osascript` handle privilege escalation natively.

## Submitting a Pull Request

1. **Fork the repo** on GitHub (button top-right on `lorenzo-giustarini/saio`).
2. **Clone your fork** locally.
3. **Create a feature branch** from `main`:
   ```bash
   git checkout -b fix/cron-toggle-mac
   # or
   git checkout -b feat/dark-mode-toggle
   ```
4. **Make your changes**, commit using [Conventional Commits](#commit-message-convention).
5. **Test** locally (`cargo tauri dev`, manually verify the change works on your OS).
6. **Push to your fork**:
   ```bash
   git push origin fix/cron-toggle-mac
   ```
7. **Open a Pull Request** from your fork's branch to `lorenzo-giustarini/saio:main`. Use the [PR template](.github/PULL_REQUEST_TEMPLATE.md):
   - Clear title (`fix(cron): handle launchd plist on macOS`)
   - Description: what + why
   - Linked issue (`Closes #42`)
   - Testing notes (what you tested + on which OS)
   - Screenshots if UI

### Branch naming

| Prefix | Use case |
|--------|----------|
| `fix/` | Bug fix |
| `feat/` | New feature |
| `docs/` | Documentation only |
| `refactor/` | Code restructure (no behavior change) |
| `chore/` | Build/tooling changes |
| `test/` | Test-only changes |

## Code Style

### TypeScript / React

- TypeScript **strict mode** (already configured in `tsconfig.json`)
- Prettier formats automatically (`npm run format`)
- ESLint catches issues (`npm run lint`)
- React function components only (no class components)
- Tailwind for styling, **no inline styles** unless dynamic
- File names: `kebab-case.ts` for utilities, `PascalCase.tsx` for components

### Rust (`src-tauri/`)

- Standard `rustfmt` (`cargo fmt`)
- Clippy clean (`cargo clippy --release`)
- Avoid `unwrap()` / `expect()` in production code — use `?` propagation

### Shell scripts (`scripts/`)

- PowerShell: `$ErrorActionPreference = 'Stop'`, no `Write-Host` for data flow (use `Write-Output`), explicit param types
- Bash: `set -euo pipefail`, `#!/usr/bin/env bash`, ShellCheck clean

## Commit Message Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/) loosely:

```
<type>(<scope>): <short description>

<optional body explaining why>

<optional footer: breaking changes, refs>
```

Examples:

```
fix(windows): handle EPERM on atomic-write rename via Defender lock

Adds retry+backoff (50/200/800ms+jitter) to renameWithRetry().
Resolves issue where saving accounts.json sporadically failed.

Closes #15
```

```
feat(cron): support launchd plist file naming on macOS
```

```
docs: clarify Step 0 elevator setup for Windows beta testers
```

Common types: `feat`, `fix`, `docs`, `refactor`, `chore`, `test`, `style`, `perf`, `build`, `ci`.

## Review Process

- Maintainer reviews PRs typically within a few days
- May request changes (commit conventions, code style, missing tests)
- Once approved: squash + merge to `main`
- Your contribution lands in next release. You become a project [Contributor](https://github.com/lorenzo-giustarini/saio/graphs/contributors)!

## Questions?

- General questions: [GitHub Discussions](https://github.com/lorenzo-giustarini/saio/discussions)
- Security-sensitive: see [SECURITY.md](SECURITY.md)
- Direct contact: [lorenzo@revolutionmarketing.us](mailto:lorenzo@revolutionmarketing.us)

Thanks for helping make SAIO better!

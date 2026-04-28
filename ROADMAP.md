# SAIO Roadmap

> Living document — updated as priorities shift. Open a [Discussion](https://github.com/lorenzo-giustarini/saio/discussions) to propose changes.

## Current status

**v1.0.0-beta** — Windows production-ready, Linux + macOS code complete (Platform Abstraction Layer with 3 OS implementations) but awaiting community validation. Beta tester program open.

## v1.0.0-beta (now)

- ✅ Tauri 2 cross-platform shell (Rust + Webview2/WebKitGTK/WKWebView)
- ✅ Express backend bundled as sidecar process
- ✅ Platform Abstraction Layer for OS-specific operations:
  - Windows: schtasks + winget + cmd.exe (ConPTY) + RM-Saio-Tauri-Elevator zero-UAC
  - Linux: systemd-timer + apt/dnf + bash/zsh + pkexec/sudo
  - macOS: launchd + brew + zsh + osascript admin
- ✅ NSIS installer auto-registers elevator task on first install
- ✅ Auth flow: claim + magic link + TOTP + recovery codes
- ✅ AI provider auto-detection (Anthropic, OpenAI, Google, fal.ai)
- ✅ Embedded terminal sessions (PTY) with provider isolation
- ✅ Native cron page (Win Task Scheduler / Linux systemd / macOS launchd)
- ✅ Project create/archive lifecycle
- ✅ Vault Obsidian docs renderer
- ⏳ Linux build verified by community
- ⏳ macOS build verified by community

## v1.0.0 (target: post-beta validation)

- Full validation on Ubuntu 22.04 LTS + macOS 13+ (Apple Silicon + Intel)
- All beta-reported bugs resolved
- Code signing optional but documented (Win Authenticode + Apple Notarization)
- GitHub Actions release matrix produces stable installers automatically
- Auto-update via tauri-updater pointing to GitHub Releases

## v1.1.x (planned features)

- **Sidecar Node SEA**: single-binary distribution (no separate Node runtime)
- **Custom themes**: light/dark/auto + user-defined accent colors
- **Vault sync**: optional Git auto-sync of Obsidian vault on cron schedule
- **Multi-window support**: detach terminal sessions to separate windows
- **Mobile companion app**: read-only iOS/Android viewer for project status

## v2.0 (long-term ideas, not committed)

- Plugin system for custom AI providers
- Voice input/output for terminal sessions
- Collaborative mode (multiple users on same project, real-time sync)
- Cloud-hosted variant (opt-in)

## What's NOT on the roadmap

- Mobile-only version (SAIO is a desktop tool by design)
- Web-only version without desktop integration (PTY/cron require native APIs)
- Replacing Tauri with Electron (we chose Tauri for the 18MB vs 150MB difference and native PTY)

---

## How priorities are decided

1. **Bug fixes** > feature requests (always)
2. **Cross-platform parity** > Windows-only enhancements
3. **Beta tester feedback** weighted heavily during v1.0.0-beta phase
4. **Security issues** are top priority regardless of phase

## Want to influence the roadmap?

- Open a [feature request](https://github.com/lorenzo-giustarini/saio/issues/new?template=feature_request.md)
- Discuss in [GitHub Discussions](https://github.com/lorenzo-giustarini/saio/discussions)
- Contribute a PR! See [CONTRIBUTING.md](CONTRIBUTING.md)

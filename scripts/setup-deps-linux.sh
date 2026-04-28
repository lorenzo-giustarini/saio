#!/usr/bin/env bash
# setup-deps-linux.sh — Linux dependency installer (V15.9 WS39)
#
# Installa Node.js LTS + Python3 + git + dipendenze base per SAIO Tauri su Linux.
# Auto-detect distro (Debian/Ubuntu apt, Fedora/RHEL dnf, Arch pacman).

set -euo pipefail

echo "============================================================"
echo " SAIO Tauri — Linux dependency installer"
echo "============================================================"

# Detect distro
if command -v apt-get >/dev/null 2>&1; then
    PM="apt"
elif command -v dnf >/dev/null 2>&1; then
    PM="dnf"
elif command -v pacman >/dev/null 2>&1; then
    PM="pacman"
elif command -v zypper >/dev/null 2>&1; then
    PM="zypper"
else
    echo "ERROR: no supported package manager (apt/dnf/pacman/zypper)" >&2
    exit 1
fi
echo "Detected package manager: $PM"

# Helper: install via PM
pm_install() {
    case "$PM" in
        apt) sudo apt-get install -y "$@" ;;
        dnf) sudo dnf install -y "$@" ;;
        pacman) sudo pacman -S --noconfirm "$@" ;;
        zypper) sudo zypper install -y "$@" ;;
    esac
}

# Update package index
case "$PM" in
    apt) sudo apt-get update -y ;;
    dnf) sudo dnf check-update -y || true ;;
esac

# Node.js LTS via NodeSource (Debian/Ubuntu) or distro
if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js LTS..."
    case "$PM" in
        apt)
            curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
            pm_install nodejs
            ;;
        dnf) pm_install nodejs ;;
        pacman) pm_install nodejs npm ;;
        zypper) pm_install nodejs ;;
    esac
fi
echo "Node: $(node --version)"

# Python 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "Installing Python 3..."
    pm_install python3 python3-pip
fi
echo "Python: $(python3 --version)"

# Git
if ! command -v git >/dev/null 2>&1; then pm_install git; fi
echo "Git: $(git --version)"

# Build tools per node-pty native modules
case "$PM" in
    apt) pm_install build-essential ;;
    dnf) pm_install gcc-c++ make ;;
    pacman) pm_install base-devel ;;
esac

# systemd user services (deve essere abilitato per cron user-level)
echo "Enabling systemd user lingering..."
loginctl enable-linger "$USER" 2>/dev/null || true

echo ""
echo "Setup complete. Next: cd saio-tauri && npm install"

#!/usr/bin/env bash
# setup-deps-macos.sh — macOS dependency installer (V15.9 WS39)
#
# Installa Homebrew + Node.js LTS + Python3 + git + dipendenze base.

set -euo pipefail

echo "============================================================"
echo " SAIO Tauri — macOS dependency installer"
echo "============================================================"

# Homebrew
if ! command -v brew >/dev/null 2>&1; then
    echo "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Aggiungi brew al PATH (Apple Silicon: /opt/homebrew, Intel: /usr/local)
    if [[ -d /opt/homebrew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -d /usr/local/Homebrew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi
echo "Brew: $(brew --version | head -1)"

# Node.js LTS
if ! command -v node >/dev/null 2>&1; then
    echo "Installing Node.js LTS..."
    brew install node
fi
echo "Node: $(node --version)"

# Python 3
if ! command -v python3 >/dev/null 2>&1; then
    echo "Installing Python 3..."
    brew install python@3.11
fi
echo "Python: $(python3 --version)"

# Git (di solito già presente con Xcode CLT)
if ! command -v git >/dev/null 2>&1; then
    brew install git
fi
echo "Git: $(git --version)"

# Xcode Command Line Tools (build tools per node-pty)
if ! xcode-select -p >/dev/null 2>&1; then
    echo "Installing Xcode Command Line Tools (potrebbe aprire popup)..."
    xcode-select --install || true
    echo "Aspetta che il popup di installazione completi, poi rilancia."
fi

echo ""
echo "Setup complete. Next: cd saio-tauri && npm install"

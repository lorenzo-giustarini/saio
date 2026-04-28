#!/usr/bin/env bash
# scripts/download-node-portable.sh
# Downloads Node 20 LTS portable for Linux/macOS and places it at
# src-tauri/binaries/node-<target-triple> for Tauri externalBin.
#
# Run: bash scripts/download-node-portable.sh
# Idempotent: skips download if file already exists.

set -euo pipefail

NODE_VER="20.18.1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$REPO_ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

# fetch_one <target-triple> <archive-name>
# Idempotent: skips if the binary exists and is >50 MB.
fetch_one() {
    local triple="$1"
    local archive="$2"
    local dest="$BIN_DIR/node-$triple"

    if [ -f "$dest" ]; then
        local size
        size=$(stat -c%s "$dest" 2>/dev/null || stat -f%z "$dest" 2>/dev/null || echo 0)
        if [ "$size" -gt 50000000 ]; then
            echo "Node portable already exists at $dest (skip)"
            return 0
        fi
    fi

    local url="https://nodejs.org/dist/v${NODE_VER}/${archive}"
    local tmp
    tmp="$(mktemp -d)"
    # shellcheck disable=SC2064
    trap "rm -rf '$tmp'" RETURN

    echo "Downloading Node $NODE_VER for $triple from $url..."
    curl -fsSL "$url" -o "$tmp/$archive"

    case "$archive" in
        *.tar.xz)  tar -xJf "$tmp/$archive" -C "$tmp" ;;
        *.tar.gz)  tar -xzf "$tmp/$archive" -C "$tmp" ;;
    esac

    local node_bin
    node_bin="$(find "$tmp" -type f -name 'node' -path '*/bin/node' | head -1)"
    if [ -z "$node_bin" ]; then
        echo "node binary not found in extracted archive"
        return 1
    fi
    cp "$node_bin" "$dest"
    chmod +x "$dest"
    local size_mb
    size_mb=$(du -m "$dest" | cut -f1)
    echo "Copied node ($size_mb MB) to $dest"
}

# Detect host OS — but for macOS download BOTH arm64 and x64 binaries because
# a single `macos-latest` runner builds for both targets via `--target=...`.
case "$(uname -s)" in
    Linux*)
        case "$(uname -m)" in
            x86_64)  fetch_one "x86_64-unknown-linux-gnu" "node-v${NODE_VER}-linux-x64.tar.xz" ;;
            aarch64) fetch_one "aarch64-unknown-linux-gnu" "node-v${NODE_VER}-linux-arm64.tar.xz" ;;
            *) echo "Unsupported Linux arch: $(uname -m)"; exit 1 ;;
        esac
        ;;
    Darwin*)
        # Always fetch both to support cross-target builds in the matrix
        fetch_one "aarch64-apple-darwin" "node-v${NODE_VER}-darwin-arm64.tar.gz"
        fetch_one "x86_64-apple-darwin"  "node-v${NODE_VER}-darwin-x64.tar.gz"
        ;;
    *)
        echo "Unsupported OS: $(uname -s) (use download-node-portable.ps1 for Windows)"
        exit 1
        ;;
esac

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

# Detect platform
case "$(uname -s)" in
    Linux*)
        case "$(uname -m)" in
            x86_64)  TRIPLE="x86_64-unknown-linux-gnu"; ARCHIVE="node-v${NODE_VER}-linux-x64.tar.xz" ;;
            aarch64) TRIPLE="aarch64-unknown-linux-gnu"; ARCHIVE="node-v${NODE_VER}-linux-arm64.tar.xz" ;;
            *) echo "Unsupported Linux arch: $(uname -m)"; exit 1 ;;
        esac
        ;;
    Darwin*)
        case "$(uname -m)" in
            arm64)  TRIPLE="aarch64-apple-darwin"; ARCHIVE="node-v${NODE_VER}-darwin-arm64.tar.gz" ;;
            x86_64) TRIPLE="x86_64-apple-darwin"; ARCHIVE="node-v${NODE_VER}-darwin-x64.tar.gz" ;;
            *) echo "Unsupported macOS arch: $(uname -m)"; exit 1 ;;
        esac
        ;;
    *)
        echo "Unsupported OS: $(uname -s) (use download-node-portable.ps1 for Windows)"
        exit 1
        ;;
esac

DEST="$BIN_DIR/node-$TRIPLE"

if [ -f "$DEST" ] && [ "$(stat -c%s "$DEST" 2>/dev/null || stat -f%z "$DEST")" -gt 50000000 ]; then
    echo "Node portable already exists at $DEST (skip download)"
    "$DEST" --version
    exit 0
fi

URL="https://nodejs.org/dist/v${NODE_VER}/${ARCHIVE}"
TMP_DIR="$(mktemp -d)"
trap "rm -rf '$TMP_DIR'" EXIT

echo "Downloading Node $NODE_VER for $TRIPLE from $URL..."
curl -fsSL "$URL" -o "$TMP_DIR/$ARCHIVE"

echo "Extracting..."
case "$ARCHIVE" in
    *.tar.xz)  tar -xJf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR" ;;
    *.tar.gz)  tar -xzf "$TMP_DIR/$ARCHIVE" -C "$TMP_DIR" ;;
esac

NODE_BIN="$(find "$TMP_DIR" -type f -name 'node' -path '*/bin/node' | head -1)"
if [ -z "$NODE_BIN" ]; then
    echo "node binary not found in extracted archive"
    exit 1
fi

cp "$NODE_BIN" "$DEST"
chmod +x "$DEST"
SIZE_MB=$(du -m "$DEST" | cut -f1)
echo "Copied node ($SIZE_MB MB) to $DEST"
"$DEST" --version

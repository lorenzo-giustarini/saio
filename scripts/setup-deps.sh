#!/usr/bin/env bash
# V15.0 WS10 — SAIO dependencies setup (macOS / Linux)
# Detect + auto-install: Node, Python 3.11+, Claude CLI, pip deps, Playwright (opzionale).
#
# Uso:
#   bash scripts/setup-deps.sh              # interattivo
#   bash scripts/setup-deps.sh --yes        # accetta tutto
#   bash scripts/setup-deps.sh --check-only # solo report
#
# Skip globale: env SAIO_SKIP_DEPS_CHECK=true

set -e

if [ "$SAIO_SKIP_DEPS_CHECK" = "true" ]; then
  echo "[setup-deps] SAIO_SKIP_DEPS_CHECK=true → skip"
  exit 0
fi

AUTO_YES=0
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --yes|-y) AUTO_YES=1 ;;
    --check-only) CHECK_ONLY=1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
CYAN=$'\033[0;36m'
GRAY=$'\033[0;90m'
WHITE=$'\033[0;37m'
NC=$'\033[0m'

echo ""
echo "${CYAN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo "${CYAN}  SAIO DASHBOARD — Dependency Check & Auto-Install${NC}"
echo "${CYAN}═══════════════════════════════════════════════════════════════════════════${NC}"
echo ""

# Detect package manager (macOS=brew, Linux=apt/dnf/pacman)
OS="$(uname -s)"
PKG_MANAGER=""
if [ "$OS" = "Darwin" ]; then
  if command -v brew &>/dev/null; then
    PKG_MANAGER="brew"
  fi
elif [ "$OS" = "Linux" ]; then
  if command -v apt-get &>/dev/null; then PKG_MANAGER="apt"
  elif command -v dnf &>/dev/null; then PKG_MANAGER="dnf"
  elif command -v pacman &>/dev/null; then PKG_MANAGER="pacman"
  fi
fi

check_cmd() {
  command -v "$1" &>/dev/null
}

# Detect each dep
declare -A FOUND
declare -A VERSION

if check_cmd node; then FOUND[node]=1; VERSION[node]=$(node --version); fi
if check_cmd npm; then FOUND[npm]=1; VERSION[npm]=$(npm --version); fi

# Python: prefer python3.11+, fallback python3
for pycmd in python3.11 python3 python; do
  if check_cmd "$pycmd"; then
    pyver=$($pycmd --version 2>&1 | sed 's/Python //')
    pymajor=$(echo "$pyver" | cut -d. -f1)
    pyminor=$(echo "$pyver" | cut -d. -f2)
    if [ "$pymajor" -ge 3 ] && [ "$pyminor" -ge 11 ]; then
      FOUND[python]=1
      VERSION[python]="$pyver ($pycmd)"
      PYTHON_CMD="$pycmd"
      break
    fi
  fi
done

if check_cmd pip || check_cmd pip3; then FOUND[pip]=1; fi
if check_cmd claude; then FOUND[claude]=1; VERSION[claude]=$(claude --version 2>&1 | head -1); fi
if check_cmd cloudflared; then FOUND[cloudflared]=1; VERSION[cloudflared]=$(cloudflared --version 2>&1 | head -1); fi
if [ -d "$PROJECT_ROOT/node_modules/playwright" ]; then FOUND[playwright]=1; fi

# Report
echo "Stato dipendenze:"
print_dep() {
  local key="$1" required="$2" category="$3"
  if [ "${FOUND[$key]:-0}" = "1" ]; then
    echo "  ${GREEN}✓${NC} $(printf '%-15s' "$key") [$category]  (${VERSION[$key]:-}) "
  elif [ "$required" = "1" ]; then
    echo "  ${RED}✗${NC} $(printf '%-15s' "$key") [$category]  ${RED}MANCANTE${NC}"
  else
    echo "  ${YELLOW}○${NC} $(printf '%-15s' "$key") [$category]  ${GRAY}opzionale${NC}"
  fi
}

print_dep node       1 "CRITICAL"
print_dep npm        1 "CRITICAL"
print_dep python     1 "CORE"
print_dep pip        1 "CORE"
print_dep claude     1 "CRITICAL"
print_dep playwright 0 "OPTIONAL"
print_dep cloudflared 0 "OPTIONAL"
echo ""

if [ "$CHECK_ONLY" = "1" ]; then
  echo "${YELLOW}[setup-deps] Modalità --check-only — niente installazione${NC}"
  exit 0
fi

# Detect missing critical
MISSING=()
for k in node npm python pip claude; do
  [ "${FOUND[$k]:-0}" = "0" ] && MISSING+=("$k")
done

if [ "${#MISSING[@]}" -eq 0 ]; then
  echo "${GREEN}✓ Tutte le dipendenze critiche sono presenti.${NC}"
  echo ""
  exit 0
fi

echo "${YELLOW}⚠️ Mancano ${#MISSING[@]} dipendenze critiche: ${MISSING[*]}${NC}"
echo ""

if [ "$AUTO_YES" = "0" ]; then
  read -p "Vuoi installarle automaticamente? [Y/n] " reply
  if [[ "$reply" =~ ^[NnNo]$ ]]; then
    echo ""
    echo "${WHITE}Installazione manuale:${NC}"
    for dep in "${MISSING[@]}"; do
      case "$dep" in
        node|npm)
          if [ "$PKG_MANAGER" = "brew" ]; then echo "  brew install node"
          elif [ "$PKG_MANAGER" = "apt" ]; then echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install nodejs"
          else echo "  Vedi https://nodejs.org/en/download"; fi
          ;;
        python|pip)
          if [ "$PKG_MANAGER" = "brew" ]; then echo "  brew install python@3.11"
          elif [ "$PKG_MANAGER" = "apt" ]; then echo "  sudo apt install python3.11 python3-pip python3-venv"
          elif [ "$PKG_MANAGER" = "dnf" ]; then echo "  sudo dnf install python3.11 python3-pip"
          else echo "  Vedi https://www.python.org/downloads"; fi
          ;;
        claude)
          echo "  Claude CLI: https://docs.anthropic.com/cli (install dal sito Anthropic)"
          ;;
      esac
    done
    exit 0
  fi
fi

# Auto-install
if [ -z "$PKG_MANAGER" ]; then
  echo "${RED}ERRORE: package manager non rilevato. Installa manualmente.${NC}"
  exit 1
fi

for dep in "${MISSING[@]}"; do
  case "$dep" in
    node|npm)
      echo "${CYAN}→ Install Node.js...${NC}"
      case "$PKG_MANAGER" in
        brew) brew install node ;;
        apt) curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs ;;
        dnf) sudo dnf install -y nodejs ;;
        pacman) sudo pacman -S --noconfirm nodejs npm ;;
      esac
      ;;
    python|pip)
      echo "${CYAN}→ Install Python 3.11...${NC}"
      case "$PKG_MANAGER" in
        brew) brew install python@3.11 ;;
        apt) sudo apt install -y python3.11 python3-pip python3-venv ;;
        dnf) sudo dnf install -y python3.11 python3-pip ;;
        pacman) sudo pacman -S --noconfirm python python-pip ;;
      esac
      ;;
    claude)
      echo "${YELLOW}⚠️ Claude CLI deve essere installato manualmente dal sito Anthropic:${NC}"
      echo "${WHITE}   https://docs.anthropic.com/cli${NC}"
      echo "${GRAY}   (poi ri-esegui questo script per verifica finale)${NC}"
      ;;
  esac
done

echo ""

# Python deps in venv
if [ "${FOUND[python]:-0}" = "1" ] && [ -f "$PROJECT_ROOT/orchestrator/requirements.txt" ]; then
  VENV_PATH="$PROJECT_ROOT/orchestrator/.venv"
  if [ ! -d "$VENV_PATH" ]; then
    if [ "$AUTO_YES" = "0" ]; then
      read -p "Vuoi creare venv Python e installare requirements.txt? [Y/n] " reply
      if [[ "$reply" =~ ^[NnNo]$ ]]; then exit 0; fi
    fi
    echo "${CYAN}→ Creazione venv...${NC}"
    "$PYTHON_CMD" -m venv "$VENV_PATH"
    "$VENV_PATH/bin/pip" install --upgrade pip
    "$VENV_PATH/bin/pip" install -r "$PROJECT_ROOT/orchestrator/requirements.txt"
    echo "${GREEN}✓ venv creato + requirements installati${NC}"
  fi
fi

echo ""
echo "${GREEN}✓ Setup completato. Lancia: npm run dev:all${NC}"
echo ""

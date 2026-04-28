#!/usr/bin/env python3
"""
MCP Discovery — weekly cron that asks Claude CLI (via /autoresearch skill)
to suggest new MCP servers useful for the user's workflows.

Writes output to:
- vault/research/mcp-suggestions-YYYY-MM-DD.md
- data/mcp-suggestions.json (badge metadata)

Triggered by Windows Task Scheduler (MCP-Discovery-Weekly).
"""

import subprocess
import sys
import json
from datetime import datetime
from pathlib import Path
import os

# VAULT_PATH is required — set it as an env var or in .env.local.
# Without a vault configured this script has nothing to write to, so we exit cleanly.
_vault_env = os.environ.get('VAULT_PATH')
if not _vault_env:
    print('[mcp_discovery] VAULT_PATH env var not set — skipping discovery run', file=sys.stderr)
    sys.exit(0)
VAULT_PATH = Path(_vault_env)

# DASHBOARD_DATA_DIR defaults to <dashboard>/data (parent of orchestrator/).
DATA_DIR = Path(os.environ.get(
    'DASHBOARD_DATA_DIR',
    str(Path(__file__).resolve().parent.parent / 'data')
))

def main() -> int:
    today = datetime.now().strftime('%Y-%m-%d')
    output_path = VAULT_PATH / 'research' / f'mcp-suggestions-{today}.md'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    prompt = f"""Usa la skill /autoresearch per trovare nuovi MCP server (Model Context Protocol) che potrebbero essere utili per i miei casi d'uso.

**Contesto vault RM**: consulta {VAULT_PATH}/MEMORY.md per capire cosa uso: OnWeb24 portal (Supabase + Vercel), ZapLater (WhatsApp via WAHA + n8n), Herbalife campagne (Google Ads + Sheets), VPS orchestrator (pipeline v3.46 con 6 istanze), AgencyOS plugin marketplace, dashboard operativa RM.

**MCP già attivi**: n8n-mcp, pabbly-mcp, obsidian-mcp-rs.

**Cerca**:
- MCP ufficiali recenti (github.com/modelcontextprotocol/servers)
- MCP community (smithery.ai, mcp.so, awesome-mcp-servers)
- MCP specifici per: Supabase, Stripe/Paddle, WhatsApp/WAHA, Google Sheets avanzato, Vercel deploy, SSH/VPS management, PDF manipulation, image generation (fal.ai), calendar, email, CRM

**Output**: salva un markdown ben strutturato in {output_path.as_posix()} con:
1. Top 5 MCP proposti (rank by valore per me)
2. Per ciascuno: cosa fa, come si installa (.mcp.json snippet), use case concreto con i miei progetti
3. Sezione "già attivi" con analisi gap
4. Fonti consultate

Lingua italiana, tono operativo, circa 1500-2500 parole. Nessun preambolo."""

    # Call Claude CLI in non-interactive mode
    try:
        result = subprocess.run(
            ['claude', '-p', prompt],
            capture_output=True,
            text=True,
            timeout=15 * 60,
            encoding='utf-8',
            errors='replace',
        )
        if result.returncode != 0:
            print(f'claude CLI exit {result.returncode}', file=sys.stderr)
            print(result.stderr[:500], file=sys.stderr)
            return 1
    except FileNotFoundError:
        print('claude CLI not in PATH', file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print('claude timeout (>15min)', file=sys.stderr)
        return 1

    # Claude may have written the file directly; if not, write its stdout
    if not output_path.exists():
        output_path.write_text(result.stdout, encoding='utf-8')

    # Write badge metadata
    meta = {
        'lastRun': datetime.now().isoformat(),
        'suggestionsPath': str(output_path).replace('\\', '/'),
        'relativePath': f'research/mcp-suggestions-{today}.md',
        'sizeKB': round(output_path.stat().st_size / 1024, 1),
    }
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = DATA_DIR / 'mcp-suggestions.json'
    meta_path.write_text(json.dumps(meta, indent=2), encoding='utf-8')

    print(f'[OK] MCP suggestions written to {output_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())

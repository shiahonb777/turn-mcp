#!/bin/bash
# ============================================================
#  Turn MCP Web — Quick Start  (macOS / Linux)
#  Double-click, or run:  bash start.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "  ${BOLD}Turn MCP Web${NC}  — Starting up…"
echo ""

# ── 1. Check Node.js ─────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo -e "  ${RED}✗ Node.js not found.${NC}"
  echo ""
  echo "  Install Node.js >= 18 from https://nodejs.org"
  echo "  macOS (Homebrew) : brew install node"
  echo "  Linux            : https://nodejs.org/en/download/package-manager"
  echo ""
  read -rp "  Press Enter to exit…"
  exit 1
fi

# Check minimum version (18)
MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$MAJOR" -lt 18 ] 2>/dev/null; then
  echo -e "  ${YELLOW}⚠  Node.js $(node --version) is too old. Required: >= 18.17${NC}"
  echo "  Please upgrade from https://nodejs.org"
  echo ""
  read -rp "  Press Enter to exit…"
  exit 1
fi
echo -e "  ${GREEN}✓${NC}  Node.js $(node --version)"

# ── 2. Install dependencies if absent ────────────────────────
if [ ! -d "node_modules" ] || [ ! -d "node_modules/@modelcontextprotocol" ]; then
  echo ""
  echo -e "  ${CYAN}→${NC}  Installing dependencies (first run only)…"
  if ! npm install; then
    echo -e "  ${RED}✗ npm install failed.${NC}"
    read -rp "  Press Enter to exit…"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC}  Dependencies installed"
fi

# ── 3. Build TypeScript if dist/ is missing ───────────────────
if [ ! -f "dist/server.js" ]; then
  echo ""
  echo -e "  ${CYAN}→${NC}  Building project…"
  if ! npm run build; then
    echo -e "  ${RED}✗ Build failed.${NC}"
    read -rp "  Press Enter to exit…"
    exit 1
  fi
  echo -e "  ${GREEN}✓${NC}  Build complete"
fi

# ── 4. Print info banner ──────────────────────────────────────
echo ""
echo -e "  ${BOLD}┌──────────────────────────────────────────────┐${NC}"
echo -e "  ${BOLD}│${NC}  🌐  Web Console   ${CYAN}http://127.0.0.1:3737/${NC}      ${BOLD}│${NC}"
echo -e "  ${BOLD}│${NC}  🔌  MCP Endpoint  ${CYAN}http://127.0.0.1:3737/mcp${NC}   ${BOLD}│${NC}"
echo -e "  ${BOLD}└──────────────────────────────────────────────┘${NC}"
echo ""
echo -e "  Press  ${BOLD}Ctrl+C${NC}  to stop the server."
echo ""

# ── 5. Kill any existing process on port 3737 ──────────────────────────
OLD_PID=$(lsof -ti tcp:3737 2>/dev/null)
if [ -n "$OLD_PID" ]; then
  echo -e "  ${YELLOW}⚠${NC}  Port 3737 in use (PID $OLD_PID) — stopping old server..."
  kill "$OLD_PID" 2>/dev/null
  sleep 1
  echo -e "  ${GREEN}✓${NC}  Old server stopped"
fi

# ── 6. Open browser after server starts ─────────────────────────────
(
  sleep 1.8
  if command -v open &>/dev/null; then
    open "http://127.0.0.1:3737/"        # macOS
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://127.0.0.1:3737/" &  # Linux
  fi
) &

# ── 7. Run server (exec replaces this shell process with node) ──────────────
# Closing the terminal window sends SIGHUP directly to node, which shuts down gracefully.
exec node dist/server.js

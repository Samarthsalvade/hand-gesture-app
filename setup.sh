#!/bin/bash
# ============================================================
# Hand Gesture App — Setup Script (Mac / Linux)
# Run once from the hand-gesture-app/ folder:
#   chmod +x setup.sh start.sh && ./setup.sh
# ============================================================

set -e
GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'

echo -e "${CYAN}"
echo "  ██╗  ██╗ █████╗ ███╗   ██╗██████╗ "
echo "  ██║  ██║██╔══██╗████╗  ██║██╔══██╗"
echo "  ███████║███████║██╔██╗ ██║██║  ██║"
echo "  ██╔══██║██╔══██║██║╚██╗██║██║  ██║"
echo "  ██║  ██║██║  ██║██║ ╚████║██████╔╝"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝  GESTURE APP"
echo -e "${NC}"

# ── 1. Check Python ────────────────────────────────────────────────────────
echo -e "${CYAN}[1/5] Checking Python...${NC}"

# Find python3.11 or python3.12 first (mediapipe works best there)
PYTHON=""
for cmd in python3.12 python3.11 python3.10 python3; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    MAJOR=$(echo $VER | cut -d. -f1)
    MINOR=$(echo $VER | cut -d. -f2)
    if [ "$MAJOR" -eq 3 ] && [ "$MINOR" -ge 10 ]; then
      PYTHON="$cmd"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  echo -e "${RED}  ERROR: Python 3.10+ not found.${NC}"
  echo "  Install from https://python.org/downloads"
  exit 1
fi

PYTHON_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MINOR=$($PYTHON -c "import sys; print(sys.version_info.minor)")
echo -e "  ✓ Using Python $PYTHON_VER ($PYTHON)"

if [ "$PYTHON_MINOR" -ge 13 ]; then
  echo -e "${YELLOW}  ⚠ Python 3.13 detected. mediapipe 0.10.30+ will be installed (Tasks API).${NC}"
  echo -e "${YELLOW}    Model file (~8MB) downloads automatically on first run.${NC}"
fi

# ── 2. Check Node ──────────────────────────────────────────────────────────
echo -e "${CYAN}[2/5] Checking Node.js...${NC}"
if ! command -v node &>/dev/null; then
  echo -e "${RED}  ERROR: Node.js not found. Install from https://nodejs.org${NC}"
  exit 1
fi
echo -e "  ✓ Node $(node --version) found"

# ── 3. Backend venv ────────────────────────────────────────────────────────
echo -e "${CYAN}[3/5] Setting up Python backend...${NC}"
cd backend

if [ ! -d "venv" ]; then
  echo "  Creating virtual environment with $PYTHON..."
  $PYTHON -m venv venv
fi

echo "  Installing packages (mediapipe may take 1-2 min)..."
source venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
echo -e "  ✓ Backend ready"
deactivate
cd ..

# ── 4. Frontend deps ───────────────────────────────────────────────────────
echo -e "${CYAN}[4/5] Installing React dependencies...${NC}"
cd frontend
npm install --silent
echo -e "  ✓ Frontend ready"
cd ..

# ── 5. Env file ────────────────────────────────────────────────────────────
echo -e "${CYAN}[5/5] Creating config...${NC}"
if [ ! -f "frontend/.env.local" ]; then
  echo "VITE_WS_URL=ws://localhost:8000/ws" > frontend/.env.local
fi
echo -e "  ✓ Config created"

echo ""
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo -e "${GREEN}  Setup complete! Run: ./start.sh${NC}"
echo -e "${GREEN}══════════════════════════════════════${NC}"
echo ""
echo "  Then open: http://localhost:3000"
echo ""
echo -e "  ${YELLOW}Note: On first launch the backend will download${NC}"
echo -e "  ${YELLOW}the hand landmark model (~8MB). This is automatic.${NC}"
echo ""

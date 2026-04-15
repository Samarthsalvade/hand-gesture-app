#!/bin/bash
# ============================================================
# Hand Gesture App - Start Script (Mac / Linux)
# Run from the hand-gesture-app/ root folder:
#   ./start.sh
# Launches backend + frontend concurrently
# Press Ctrl+C to stop both
# ============================================================

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${CYAN}Starting Hand Gesture App...${NC}"
echo ""

# Check venv exists
if [ ! -d "backend/venv" ]; then
  echo "Run ./setup.sh first!"
  exit 1
fi

# Check node_modules exists
if [ ! -d "frontend/node_modules" ]; then
  echo "Run ./setup.sh first!"
  exit 1
fi

# Kill background jobs on Ctrl+C
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill 0
}
trap cleanup SIGINT SIGTERM

# Start backend
echo -e "${GREEN}► Starting backend on http://localhost:8000${NC}"
cd backend
source venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to start
sleep 2

# Start frontend
echo -e "${GREEN}► Starting frontend on http://localhost:3000${NC}"
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo -e "${CYAN}Both servers running!${NC}"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Wait for both
wait $BACKEND_PID $FRONTEND_PID

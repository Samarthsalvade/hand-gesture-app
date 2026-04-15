@echo off
REM ============================================================
REM Hand Gesture App - Setup Script (Windows)
REM Double-click or run from cmd inside hand-gesture-app\
REM ============================================================

echo.
echo  HAND GESTURE APP - Windows Setup
echo  ==================================
echo.

REM ── Check Python ──────────────────────────────────────────
echo [1/5] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found. Install from https://python.org
    echo  Make sure to check "Add Python to PATH" during install
    pause & exit /b 1
)
for /f "tokens=2" %%i in ('python --version') do set PYVER=%%i
echo   OK Python %PYVER% found

REM ── Check Node ────────────────────────────────────────────
echo [2/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)
for /f %%i in ('node --version') do set NODEVER=%%i
echo   OK Node %NODEVER% found

REM ── Backend setup ─────────────────────────────────────────
echo [3/5] Setting up Python backend...
cd backend

if not exist venv (
    echo   Creating virtual environment...
    python -m venv venv
)

echo   Installing Python packages (this takes a few minutes)...
call venv\Scripts\activate.bat
pip install --upgrade pip -q
pip install -r requirements.txt -q
call venv\Scripts\deactivate.bat
echo   OK Backend dependencies installed
cd ..

REM ── Frontend setup ────────────────────────────────────────
echo [4/5] Installing React dependencies...
cd frontend
call npm install --silent
echo   OK Frontend dependencies installed

REM ── Create .env.local ─────────────────────────────────────
if not exist .env.local (
    echo VITE_WS_URL=ws://localhost:8000/ws > .env.local
    echo   OK Created .env.local
)
cd ..

echo.
echo  ========================================
echo   Setup complete!
echo  ========================================
echo.
echo   To start the app, open TWO Command Prompts:
echo.
echo   CMD 1 - Backend:
echo     cd hand-gesture-app\backend
echo     venv\Scripts\activate
echo     uvicorn main:app --reload --port 8000
echo.
echo   CMD 2 - Frontend:
echo     cd hand-gesture-app\frontend
echo     npm run dev
echo.
echo   Then open: http://localhost:3000
echo.
echo   Or just run: start.bat
echo.
pause

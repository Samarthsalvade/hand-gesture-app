<div align="center">

```
██╗  ██╗ █████╗ ███╗   ██╗██████╗      ██████╗ ███████╗███████╗████████╗██╗   ██╗██████╗ ███████╗
██║  ██║██╔══██╗████╗  ██║██╔══██╗    ██╔════╝ ██╔════╝██╔════╝╚══██╔══╝██║   ██║██╔══██╗██╔════╝
███████║███████║██╔██╗ ██║██║  ██║    ██║  ███╗█████╗  ███████╗   ██║   ██║   ██║██████╔╝█████╗
██╔══██║██╔══██║██║╚██╗██║██║  ██║    ██║   ██║██╔══╝  ╚════██║   ██║   ██║   ██║██╔══██╗██╔══╝
██║  ██║██║  ██║██║ ╚████║██████╔╝    ╚██████╔╝███████╗███████║   ██║   ╚██████╔╝██║  ██║███████╗
╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝      ╚═════╝ ╚══════╝╚══════╝   ╚═╝    ╚═════╝ ╚═╝  ╚═╝╚══════╝
```

**Real-time hand gesture recognition with visual effects — powered by MediaPipe & React**

[![Python](https://img.shields.io/badge/Python-3.10%2B-blue?style=flat-square&logo=python)](https://python.org)
[![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square&logo=react)](https://react.dev)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![MediaPipe](https://img.shields.io/badge/MediaPipe-0.10%2B-FF6F00?style=flat-square)](https://mediapipe.dev)
[![Deploy](https://img.shields.io/badge/Deploy-Railway%20%2B%20Vercel-black?style=flat-square)](https://railway.app)

</div>

---

## What is this?

Point your webcam at your hand. Watch magic happen.

This app captures your webcam feed in the browser, streams frames to a Python backend over WebSocket, detects hand landmarks with MediaPipe, and renders real-time visual effects back to the browser — all at ~20 FPS.

```
Browser ──── raw JPEG frames ────► FastAPI + MediaPipe
        ◄─── annotated frame + ────
              gesture data
```

---

## Modes

### ✦ Particles
Colorful physics particles burst from your palm. The more fingers you hold up, the more particles spawn. Gravity and air resistance make them fall naturally.

```
0 fingers  →  calm trickle
5 fingers  →  full explosion
```

### ♫ Music Visualizer
Your hand becomes a conductor. Move it **up/down** to shift frequency (200–1400 Hz). Raise more fingers to increase the amplitude. A waveform ring pulses around your palm.

```
hand high  →  high frequency (treble)
hand low   →  low frequency (bass)
fingers    →  volume / amplitude
```

### ✏ Drawing
Leave colorful trails as you move. Each finger count maps to a different color. Close your fist to stop drawing. Trails fade with alpha as they age.

```
1 finger  →  thin red line
5 fingers →  thick cyan stroke
fist      →  pen up
```

### ⬡ Doctor Strange
Mystical magic circles spin around your hands. Sparks fly from your fingertips. Hold up all **5 fingers** to open a glowing portal.

```
1-2 fingers  →  orange circles
3 fingers    →  yellow circles
4 fingers    →  blue circles
5 fingers    →  purple + PORTAL ✦
```

---

## Gesture Recognition

| Fingers | Gesture     | Detection Method                        |
|---------|-------------|------------------------------------------|
| 0       | Fist        | All fingertips below PIP joints          |
| 1       | One         | Index tip above PIP                      |
| 2       | Peace       | Index + middle up, ring + pinky down     |
| 3       | Three       | Index + middle + ring up                 |
| 4       | Four        | All except thumb                         |
| 5       | High Five   | All fingers extended                     |
| —       | OK Sign     | Thumb tip touches index tip (dist < 4%)  |
| —       | Peace Sign  | Index + middle up, ring down             |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BROWSER (React)                         │
│                                                                 │
│  getUserMedia()  ──►  capture frame  ──►  base64 JPEG          │
│                                               │                 │
│         ◄──── annotated JPEG + hand data ─────┘                 │
│                          │                                      │
│   <img> display    GesturePanel    ModeSelector                 │
└─────────────────────────────│───────────────────────────────────┘
                              │  WebSocket  ws://
┌─────────────────────────────▼───────────────────────────────────┐
│                      BACKEND (FastAPI)                          │
│                                                                 │
│   /ws  WebSocket endpoint                                       │
│     │                                                           │
│     ├── decode base64 → numpy frame                             │
│     ├── MediaPipe HandLandmarker.detect()                       │
│     ├── count fingers, classify gesture                         │
│     ├── apply visual effect (particles/music/drawing/strange)   │
│     ├── draw landmarks + UI overlay via OpenCV                  │
│     └── encode → JPEG → base64 → send back                     │
│                                                                 │
│   /health  GET  ← pinged every 25s to prevent cold starts      │
└─────────────────────────────────────────────────────────────────┘
```

### Hand Landmark Map

```
                 8   12  16  20
                 |   |   |   |
              7  |11  |15  |19
              |  |  | |  | |  |
           6  | 10  |14  |18
            \ | /   |  / |  /
     4        5-----9--13--17
      \       |
    3  \      |
     \  2     |
      \ |     0  (WRIST)
       \|
        1
```

21 landmarks per hand. Each has normalized `x, y, z` coordinates. Finger extension is determined by comparing tip `y` to PIP `y` (tip above PIP = extended).

---

## Quick Start (Local)

### Prerequisites
- Python 3.10, 3.11, or 3.12 — **not 3.13**
- Node.js 18+

> **Python 3.13 users:** mediapipe 0.10.30+ is installed automatically and the hand landmark model (~8 MB) downloads on first run.

### Setup

```bash
# Clone or unzip the project
cd hand-gesture-app

# One-command setup (creates venv, installs everything)
chmod +x setup.sh start.sh
./setup.sh
```

### Run

```bash
# Starts both backend (port 8000) and frontend (port 3000)
./start.sh
```

Open **http://localhost:3000** — allow camera access when prompted.

### Manual (two terminals)

```bash
# Terminal 1 — Backend
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

---

## File Structure

```
hand-gesture-app/
│
├── backend/
│   ├── main.py                  # FastAPI app, WebSocket, /health keep-alive
│   ├── gesture_processor.py     # MediaPipe detection, all visual effects
│   ├── requirements.txt         # Python dependencies
│   ├── Procfile                 # Railway start command
│   └── railway.json             # Railway config
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx              # Root: WebSocket client, camera, frame loop
│   │   └── components/
│   │       ├── VideoCanvas.jsx  # Displays annotated frames from backend
│   │       ├── ModeSelector.jsx # 4 glowing mode buttons
│   │       └── GesturePanel.jsx # Live finger count + gesture display
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
│
├── setup.sh    # One-command setup (Mac/Linux)
├── start.sh    # Starts both servers
└── setup.bat   # Windows setup
```

---

## Deploy Live

### Step 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/hand-gesture-app.git
git push -u origin main
```

### Step 2 — Backend on Railway

1. Go to [railway.app](https://railway.app) → **New Project → Deploy from GitHub**
2. Select your repo
3. **Settings → Source → Root Directory** → `backend`
4. **Settings → Networking → Generate Domain**
5. Copy your URL: `https://your-app.up.railway.app`

> First deploy takes ~3 min (installs mediapipe). On first request the model downloads automatically.

### Step 3 — Wire frontend to backend

```bash
echo "VITE_WS_URL=wss://your-app.up.railway.app/ws" > frontend/.env.production
git add . && git commit -m "add prod env" && git push
```

### Step 4 — Frontend on Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project → Import Git Repo**
2. **Root Directory** → `frontend`
3. Add environment variable:
   - Key: `VITE_WS_URL`
   - Value: `wss://your-app.up.railway.app/ws`
4. Deploy → live at `https://your-app.vercel.app`

---

## Cold Start Prevention

Railway's free tier sleeps inactive services. This app handles it two ways:

**Frontend keep-alive** — `App.jsx` pings `/health` every 25 seconds while the tab is open, keeping the server warm automatically.

**Backend warm-up** — `main.py` loads MediaPipe at startup (not on first request), so the first user gets a fast response.

**To fully eliminate cold starts** — go to Railway **Settings → Sleeping → Disable** (requires Hobby plan, ~$5/mo).

---

## Performance

| Metric | Value |
|--------|-------|
| Detection latency | ~30–50ms per frame |
| Effective FPS | 15–25 FPS |
| JPEG quality | 60% (speed/quality balance) |
| Max hands | 2 |
| Model size | ~8 MB (downloads once) |

To increase FPS, lower JPEG quality in `App.jsx`:
```js
c.toDataURL('image/jpeg', 0.4)  // faster, lower quality
```

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_WS_URL` | `ws://localhost:8000/ws` | WebSocket URL for the backend |
| `PORT` | `8000` | Backend port (set automatically by Railway) |

---

## Troubleshooting

**`mediapipe` install fails**
→ You likely have Python 3.13. The setup script handles this — run `./setup.sh` and it will pick Python 3.12 or 3.11 if available on your system.

**Camera not showing**
→ Allow camera permissions in your browser. On Mac, check System Settings → Privacy → Camera.

**`setup.sh: No such file or directory`**
→ You're inside a nested folder from the zip. Run `ls` — if you see another `hand-gesture-app/` folder, `cd` into it first.

**Backend connects but no frames appear**
→ Check browser console. The WebSocket may be connecting but the backend may be crashing on the model file. Check terminal 1 for Python errors.

**Railway cold start (slow first connection)**
→ The frontend auto-pings `/health` every 25s to prevent this. For zero cold starts, disable sleeping in Railway settings.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Hand detection | MediaPipe HandLandmarker (Tasks API) |
| Visual effects | OpenCV (NumPy drawing) |
| Backend | FastAPI + uvicorn |
| Transport | WebSocket (binary JPEG frames) |
| Frontend | React 18 + Vite |
| Local setup | Python venv + npm |
| Backend hosting | Railway |
| Frontend hosting | Vercel |

---

<div align="center">

Built with MediaPipe · FastAPI · React · OpenCV

</div>
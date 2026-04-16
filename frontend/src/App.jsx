import React, { useRef, useState, useEffect, useCallback } from 'react'
import VideoCanvas from './components/VideoCanvas.jsx'
import GesturePanel from './components/GesturePanel.jsx'
import ModeSelector from './components/ModeSelector.jsx'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'
const PING_URL = WS_URL.replace(/^wss?/, 'http').replace(/^wss/, 'https').replace('/ws', '/health')
const MODES = ['particles', 'music', 'drawing', 'strange']

// How many ms to wait before sending next frame to backend
// Adjust based on your backend speed
const BACKEND_THROTTLE_MS = 80  // ~12 FPS to backend, display at full speed

export default function App() {
  const videoRef        = useRef(null)
  const canvasRef       = useRef(null)  // local canvas for effects
  const wsRef           = useRef(null)
  const animRef         = useRef(null)
  const lastSendRef     = useRef(0)
  const pingRef         = useRef(null)
  const mpRef           = useRef(null)  // MediaPipe JS detector

  const [mode, setMode]                   = useState('particles')
  const [connected, setConnected]         = useState(false)
  const [handData, setHandData]           = useState([])
  const [fps, setFps]                     = useState(0)
  const [localFps, setLocalFps]           = useState(0)
  const [streamActive, setStreamActive]   = useState(false)
  const [error, setError]                 = useState(null)
  const [processedFrame, setProcessedFrame] = useState(null)
  const [mpReady, setMpReady]             = useState(false)
  const [waking, setWaking]               = useState(false)

  const localFrameCount = useRef(0)
  const localFpsTimer   = useRef(Date.now())

  // ── Load MediaPipe JS in browser ─────────────────────────────────────────
  useEffect(() => {
    let detector = null

    const loadMP = async () => {
      try {
        const vision = await import(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
        )
        const { HandLandmarker, FilesetResolver } = vision

        const filesetResolver = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        )

        detector = await HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        })

        mpRef.current = detector
        setMpReady(true)
      } catch (e) {
        console.warn('MediaPipe JS failed, falling back to backend-only:', e)
        setMpReady(false)
      }
    }

    loadMP()
    return () => { if (detector) detector.close() }
  }, [])

  // ── Keep-alive ping ───────────────────────────────────────────────────────
  const startPing = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current)
    pingRef.current = setInterval(() => { fetch(PING_URL).catch(() => {}) }, 25_000)
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    setWaking(true)
    fetch(PING_URL).catch(() => {}).finally(() => setWaking(false))

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onopen  = () => { setConnected(true); setError(null); startPing() }
    ws.onclose = () => { setConnected(false); clearInterval(pingRef.current); setTimeout(connectWS, 3000) }
    ws.onerror = () => setError('Cannot reach backend.')
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type === 'frame_result') {
          setProcessedFrame(data.frame)
          setHandData(data.hands || [])
          setFps(data.fps || 0)
        }
      } catch {}
    }
  }, [startPing])

  // ── Webcam ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: 'user' }, audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setStreamActive(true)
        setError(null)
      }
    } catch (err) { setError(`Camera denied: ${err.message}`) }
  }, [])

  // ── Main loop: local MP detection + throttled backend send ────────────────
  const loop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const ws = wsRef.current
    const mp = mpRef.current

    if (!video || video.readyState < 2 || video.videoWidth === 0) {
      animRef.current = requestAnimationFrame(loop)
      return
    }

    // ── Local FPS counter ────────────────────────────────────────────────
    localFrameCount.current++
    const now = Date.now()
    if (now - localFpsTimer.current >= 1000) {
      setLocalFps(localFrameCount.current)
      localFrameCount.current = 0
      localFpsTimer.current = now
    }

    // ── Draw raw video to local canvas ───────────────────────────────────
    if (canvas) {
      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
    }

    // ── Run MediaPipe locally if available ───────────────────────────────
    if (mp) {
      try {
        const result = mp.detectForVideo(video, performance.now())
        if (result.handedness?.length > 0) {
          const hands = result.handedness.map((h, i) => ({
            handedness: h[0].displayName,
            fingers: countFingers(result.handLandmarks[i], h[0].displayName),
            gesture: '',
            special_gesture: null,
            center: getCenter(result.handLandmarks[i], video.videoWidth, video.videoHeight),
          }))
          hands.forEach(h => { h.gesture = recognizeGesture(h.fingers) })
          setHandData(hands)

          // Draw landmarks on local canvas
          if (canvas) drawLandmarks(canvas, result.handLandmarks)
        } else {
          setHandData([])
        }
      } catch {}
    }

    // ── Throttle: send to backend for effects only ───────────────────────
    if (ws?.readyState === WebSocket.OPEN && now - lastSendRef.current >= BACKEND_THROTTLE_MS) {
      lastSendRef.current = now
      const tmp = document.createElement('canvas')
      tmp.width = video.videoWidth; tmp.height = video.videoHeight
      tmp.getContext('2d').drawImage(video, 0, 0)
      ws.send(JSON.stringify({
        type: 'frame',
        frame: tmp.toDataURL('image/jpeg', 0.5),
        mode,
      }))
    }

    animRef.current = requestAnimationFrame(loop)
  }, [mode])

  useEffect(() => { connectWS(); startCamera() }, [])

  useEffect(() => {
    if (streamActive) {
      animRef.current = requestAnimationFrame(loop)
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [streamActive, loop])

  const handleModeChange = (m) => {
    setMode(m)
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'clear' }))
  }

  const modeColor = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[mode]
  const displayFps = mpReady ? localFps : fps

  return (
    <div style={s.app}>
      <div style={{ ...s.header, borderBottomColor: `${modeColor}55` }}>
        <div style={s.headerLeft}>
          <span style={{ ...s.title, color: modeColor }}>HAND GESTURE CONTROL</span>
          <span style={s.subtitle}>
            {mpReady ? '⚡ local detection' : '☁ server detection'}
          </span>
        </div>
        <div style={s.statusRow}>
          {waking && <span style={s.wakingBadge}>WAKING…</span>}
          <span style={{ ...s.dot, background: connected ? '#00ff88' : '#ff3344',
            boxShadow: connected ? '0 0 8px #00ff8899' : '0 0 8px #ff334499' }} />
          <span style={s.statusText}>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          {displayFps > 0 && (
            <span style={{ ...s.fpsBadge, borderColor: modeColor, color: modeColor }}>
              {displayFps} FPS
            </span>
          )}
        </div>
      </div>

      <div style={s.body}>
        <VideoCanvas
          videoRef={videoRef}
          canvasRef={canvasRef}
          processedFrame={processedFrame}
          streamActive={streamActive}
          mpReady={mpReady}
        />
        <div style={s.panel}>
          <ModeSelector modes={MODES} current={mode} onChange={handleModeChange} />
          <div style={{ ...s.divider, borderColor: `${modeColor}33` }} />
          <GesturePanel handData={handData} mode={mode} />
          {error && (
            <div style={s.errorBox}>
              <span>⚠ {error}</span>
            </div>
          )}
          <div style={s.hintBox}>
            <span style={{ ...s.hintDot, background: modeColor }} />
            <span style={s.hintText}>
              {mode === 'strange'   && '5 fingers activates the portal'}
              {mode === 'particles' && 'more fingers = more particles'}
              {mode === 'music'     && 'hand height controls frequency'}
              {mode === 'drawing'   && 'raise fingers to paint trails'}
            </span>
          </div>
        </div>
      </div>

      <video ref={videoRef} style={{ display: 'none' }} muted playsInline />
    </div>
  )
}

// ── MediaPipe JS helpers ────────────────────────────────────────────────────

function countFingers(landmarks, handedness) {
  if (!landmarks || landmarks.length < 21) return 0
  let count = 0
  // Thumb
  if (handedness === 'Right') {
    if (landmarks[4].x < landmarks[2].x - 0.04) count++
  } else {
    if (landmarks[4].x > landmarks[2].x + 0.04) count++
  }
  // Fingers: tip y < pip y means extended
  const pairs = [[8,6],[12,10],[16,14],[20,18]]
  for (const [tip, pip] of pairs) {
    if (landmarks[tip].y < landmarks[pip].y) count++
  }
  return count
}

function recognizeGesture(n) {
  return {0:'Fist',1:'One',2:'Peace',3:'Three',4:'Four',5:'High Five'}[n] || 'Unknown'
}

function getCenter(landmarks, w, h) {
  if (!landmarks?.length) return [0, 0]
  const cx = Math.round((landmarks[0].x + landmarks[9].x) / 2 * w)
  const cy = Math.round((landmarks[0].y + landmarks[9].y) / 2 * h)
  return [cx, cy]
}

function drawLandmarks(canvas, allHandLandmarks) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height
  const connections = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],
    [0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],
    [5,9],[9,13],[13,17],
  ]
  for (const landmarks of allHandLandmarks) {
    const pts = landmarks.map(l => [l.x * w, l.y * h])
    ctx.strokeStyle = '#00c864'
    ctx.lineWidth = 2
    for (const [a, b] of connections) {
      ctx.beginPath()
      ctx.moveTo(pts[a][0], pts[a][1])
      ctx.lineTo(pts[b][0], pts[b][1])
      ctx.stroke()
    }
    for (const [x, y] of pts) {
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = '#00c864'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
  }
}

const s = {
  app: {
    height: '100vh', display: 'flex', flexDirection: 'column',
    background: '#0a0a0f', color: '#e0e0e0', fontFamily: "'Courier New', monospace",
    overflow: 'hidden',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 24px', background: '#0d0d1a', borderBottom: '1px solid',
    flexShrink: 0,
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: '2px' },
  title: { fontSize: '15px', letterSpacing: '4px', fontWeight: 700 },
  subtitle: { fontSize: '9px', letterSpacing: '3px', color: '#444' },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  statusText: { fontSize: '11px', letterSpacing: '2px', color: '#555' },
  fpsBadge: {
    fontSize: '11px', letterSpacing: '1px', border: '1px solid',
    borderRadius: '4px', padding: '2px 8px',
  },
  wakingBadge: {
    fontSize: '10px', letterSpacing: '2px', color: '#fbbf24',
    border: '1px solid #fbbf2444', borderRadius: '4px', padding: '2px 8px',
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  panel: {
    width: '320px', minWidth: '320px', background: '#0d0d1a',
    borderLeft: '1px solid #1a1a2e', display: 'flex', flexDirection: 'column',
    padding: '20px 16px', gap: '16px', overflowY: 'auto',
  },
  divider: { borderTop: '1px solid', margin: '0 -4px' },
  errorBox: {
    background: '#1a0808', border: '1px solid #ff334466', borderRadius: '8px',
    padding: '12px', fontSize: '11px', color: '#ff8888',
  },
  hintBox: {
    marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 12px', background: '#12121e', borderRadius: '8px',
    border: '1px solid #1e1e32',
  },
  hintDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  hintText: { fontSize: '11px', color: '#555', letterSpacing: '0.5px' },
}
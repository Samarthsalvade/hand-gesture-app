import React, { useRef, useState, useEffect, useCallback } from 'react'
import VideoCanvas from './components/VideoCanvas.jsx'
import GesturePanel from './components/GesturePanel.jsx'
import ModeSelector from './components/ModeSelector.jsx'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'
const PING_URL = WS_URL.replace(/^ws/, 'http').replace('/ws', '/health')
const MODES = ['particles', 'music', 'drawing', 'strange']

export default function App() {
  const videoRef    = useRef(null)
  const wsRef       = useRef(null)
  const animRef     = useRef(null)
  const sendingRef  = useRef(false)
  const pingRef     = useRef(null)

  const [mode, setMode]               = useState('particles')
  const [connected, setConnected]     = useState(false)
  const [handData, setHandData]       = useState([])
  const [fps, setFps]                 = useState(0)
  const [streamActive, setStreamActive] = useState(false)
  const [error, setError]             = useState(null)
  const [processedFrame, setProcessedFrame] = useState(null)
  const [waking, setWaking]           = useState(false)

  // ── Keep-alive ping every 25s to prevent Railway cold start ───────────────
  const startPing = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current)
    pingRef.current = setInterval(() => {
      fetch(PING_URL).catch(() => {})
    }, 25_000)
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Wake the backend first (handles cold start)
    setWaking(true)
    fetch(PING_URL)
      .catch(() => {})
      .finally(() => setWaking(false))

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      setError(null)
      startPing()
    }
    ws.onclose = () => {
      setConnected(false)
      sendingRef.current = false
      clearInterval(pingRef.current)
      setTimeout(connectWS, 3000)
    }
    ws.onerror = () => {
      setError('Cannot reach backend. Start the server or check your Railway URL.')
    }
    ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data)
        if (data.type === 'frame_result') {
          setProcessedFrame(data.frame)
          setHandData(data.hands || [])
          setFps(data.fps || 0)
          sendingRef.current = false
        } else if (data.type === 'error') {
          sendingRef.current = false
        }
      } catch { sendingRef.current = false }
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
    } catch (err) {
      setError(`Camera denied: ${err.message}`)
    }
  }, [])

  // ── Frame sender ──────────────────────────────────────────────────────────
  const sendFrame = useCallback(() => {
    const video = videoRef.current
    const ws    = wsRef.current
    if (!video || !ws || ws.readyState !== WebSocket.OPEN || sendingRef.current ||
        video.readyState < 2 || video.videoWidth === 0) {
      animRef.current = requestAnimationFrame(sendFrame)
      return
    }
    const c = document.createElement('canvas')
    c.width = video.videoWidth; c.height = video.videoHeight
    c.getContext('2d').drawImage(video, 0, 0)
    sendingRef.current = true
    ws.send(JSON.stringify({ type: 'frame', frame: c.toDataURL('image/jpeg', 0.6), mode }))
    animRef.current = requestAnimationFrame(sendFrame)
  }, [mode])

  useEffect(() => {
    connectWS()
    startCamera()
    return () => {
      wsRef.current?.close()
      cancelAnimationFrame(animRef.current)
      clearInterval(pingRef.current)
    }
  }, [])

  useEffect(() => {
    if (streamActive && connected) {
      animRef.current = requestAnimationFrame(sendFrame)
    }
    return () => cancelAnimationFrame(animRef.current)
  }, [streamActive, connected, sendFrame])

  const handleModeChange = (m) => {
    setMode(m)
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'clear' }))
  }

  // ── Mode accent color ─────────────────────────────────────────────────────
  const modeColor = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[mode]

  return (
    <div style={s.app}>
      {/* ── Header ── */}
      <div style={{ ...s.header, borderBottomColor: `${modeColor}55` }}>
        <div style={s.headerLeft}>
          <span style={{ ...s.title, color: modeColor }}>HAND GESTURE CONTROL</span>
          <span style={s.subtitle}>powered by MediaPipe</span>
        </div>
        <div style={s.statusRow}>
          {waking && <span style={s.wakingBadge}>WAKING…</span>}
          <span style={{ ...s.dot, background: connected ? '#00ff88' : '#ff3344',
            boxShadow: connected ? '0 0 8px #00ff8899' : '0 0 8px #ff334499' }} />
          <span style={s.statusText}>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          {fps > 0 && <span style={{ ...s.fpsBadge, borderColor: modeColor, color: modeColor }}>
            {fps.toFixed(1)} FPS
          </span>}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={s.body}>
        {/* Video */}
        <VideoCanvas videoRef={videoRef} processedFrame={processedFrame} streamActive={streamActive} />

        {/* Right panel */}
        <div style={s.panel}>
          <ModeSelector modes={MODES} current={mode} onChange={handleModeChange} />

          <div style={{ ...s.divider, borderColor: `${modeColor}33` }} />

          <GesturePanel handData={handData} mode={mode} />

          {error && (
            <div style={s.errorBox}>
              <span style={s.errorIcon}>⚠</span>
              <span>{error}</span>
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
  subtitle: { fontSize: '9px', letterSpacing: '3px', color: '#333' },
  statusRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  dot: { width: 10, height: 10, borderRadius: '50%', display: 'inline-block', flexShrink: 0 },
  statusText: { fontSize: '11px', letterSpacing: '2px', color: '#555' },
  fpsBadge: {
    fontSize: '11px', letterSpacing: '1px', border: '1px solid', borderRadius: '4px',
    padding: '2px 8px',
  },
  wakingBadge: {
    fontSize: '10px', letterSpacing: '2px', color: '#fbbf24',
    border: '1px solid #fbbf2444', borderRadius: '4px', padding: '2px 8px',
    animation: 'pulse 1s infinite',
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
    padding: '12px', fontSize: '11px', color: '#ff8888', lineHeight: 1.6,
    display: 'flex', gap: '8px', alignItems: 'flex-start',
  },
  errorIcon: { fontSize: '14px', flexShrink: 0 },
  hintBox: {
    marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '8px',
    padding: '10px 12px', background: '#12121e', borderRadius: '8px',
    border: '1px solid #1e1e32',
  },
  hintDot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  hintText: { fontSize: '11px', color: '#555', letterSpacing: '0.5px', lineHeight: 1.5 },
}
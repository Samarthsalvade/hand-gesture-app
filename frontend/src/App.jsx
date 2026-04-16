import React, { useRef, useState, useEffect, useCallback } from 'react'
import VideoCanvas from './components/VideoCanvas.jsx'
import GesturePanel from './components/GesturePanel.jsx'
import ModeSelector from './components/ModeSelector.jsx'

const WS_URL   = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'
const PING_URL = WS_URL.replace(/^wss?/, 'http').replace(/^wss/, 'https').replace('/ws', '/health')
const MODES    = ['particles', 'music', 'drawing', 'strange']
const BACKEND_THROTTLE_MS = 80

// Stabilize hand data — only update UI if state held for N consecutive frames
const STABLE_FRAMES_REQUIRED = 4

export default function App() {
  const videoRef      = useRef(null)
  const canvasRef     = useRef(null)
  const wsRef         = useRef(null)
  const animRef       = useRef(null)
  const lastSendRef   = useRef(0)
  const pingRef       = useRef(null)
  const mpRef         = useRef(null)
  const overlayImg    = useRef(null)

  // Stabilization buffers
  const handBuffer    = useRef([])   // last N raw detections
  const stableHands   = useRef([])   // last committed stable state

  const [mode, setMode]             = useState('particles')
  const [connected, setConnected]   = useState(false)
  const [handData, setHandData]     = useState([])
  const [localFps, setLocalFps]     = useState(0)
  const [streamActive, setStreamActive] = useState(false)
  const [error, setError]           = useState(null)
  const [mpReady, setMpReady]       = useState(false)
  const [waking, setWaking]         = useState(false)
  const [isMobile, setIsMobile]     = useState(false)
  const [showPanel, setShowPanel]   = useState(false) // mobile panel toggle

  const localFrameCount = useRef(0)
  const localFpsTimer   = useRef(Date.now())

  // ── Detect mobile ─────────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Load MediaPipe JS ─────────────────────────────────────────────────────
  useEffect(() => {
    let detector = null
    const load = async () => {
      try {
        const vision = await import(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs'
        )
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
        )
        detector = await vision.HandLandmarker.createFromOptions(filesetResolver, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        })
        mpRef.current = detector
        setMpReady(true)
      } catch (e) {
        console.warn('MediaPipe JS unavailable:', e)
      }
    }
    load()
    return () => { detector?.close() }
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
        if (data.type === 'effect_overlay') {
          const img = new Image()
          img.onload = () => { overlayImg.current = img }
          img.src = data.overlay
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

  // ── Stabilize hand detections ─────────────────────────────────────────────
  const pushHandBuffer = useCallback((rawHands) => {
    const buf = handBuffer.current
    buf.push(rawHands)
    if (buf.length > STABLE_FRAMES_REQUIRED) buf.shift()

    // Only update UI if last N frames all agree on hand count
    if (buf.length < STABLE_FRAMES_REQUIRED) return
    const counts = buf.map(h => h.length)
    const allSame = counts.every(c => c === counts[0])
    if (!allSame) return  // still flickering — don't update

    // Also stabilize finger counts per hand
    const stable = rawHands.map((hand, i) => {
      const fingerCounts = buf.map(b => b[i]?.fingers ?? -1).filter(f => f >= 0)
      const majority = fingerCounts.sort((a,b) =>
        fingerCounts.filter(v=>v===b).length - fingerCounts.filter(v=>v===a).length
      )[0]
      return { ...hand, fingers: majority ?? hand.fingers,
               gesture: recognizeGesture(majority ?? hand.fingers) }
    })

    // Only trigger re-render if something actually changed
    const prev = stableHands.current
    const changed = stable.length !== prev.length ||
      stable.some((h,i) => h.fingers !== prev[i]?.fingers || h.handedness !== prev[i]?.handedness)
    if (changed) {
      stableHands.current = stable
      setHandData(stable)
    }
  }, [])

  // ── Main render loop ──────────────────────────────────────────────────────
  const loop = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      animRef.current = requestAnimationFrame(loop)
      return
    }

    // FPS
    localFrameCount.current++
    const now = Date.now()
    if (now - localFpsTimer.current >= 1000) {
      setLocalFps(localFrameCount.current)
      localFrameCount.current = 0
      localFpsTimer.current = now
    }

    const w = video.videoWidth, h = video.videoHeight
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    // Local MP detection
    const mp = mpRef.current
    if (mp) {
      try {
        const result = mp.detectForVideo(video, performance.now())
        if (result.handLandmarks?.length > 0) {
          drawLandmarks(ctx, result.handLandmarks, w, h)
          const raw = result.handedness.map((hn, i) => {
            const fingers = countFingers(result.handLandmarks[i], hn[0].displayName)
            return {
              handedness: hn[0].displayName, fingers,
              gesture: recognizeGesture(fingers),
              special_gesture: null,
              center: getCenter(result.handLandmarks[i], w, h),
            }
          })
          pushHandBuffer(raw)
        } else {
          pushHandBuffer([])
        }
      } catch {}
    }

    // Composite effect overlay
    if (overlayImg.current) {
      ctx.drawImage(overlayImg.current, 0, 0, w, h)
    }

    // Throttled backend send
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN && now - lastSendRef.current >= BACKEND_THROTTLE_MS) {
      lastSendRef.current = now
      const tmp = document.createElement('canvas')
      tmp.width = w; tmp.height = h
      tmp.getContext('2d').drawImage(video, 0, 0)
      ws.send(JSON.stringify({ type: 'frame', frame: tmp.toDataURL('image/jpeg', 0.5), mode }))
    }

    animRef.current = requestAnimationFrame(loop)
  }, [mode, pushHandBuffer])

  useEffect(() => { connectWS(); startCamera() }, [])

  useEffect(() => {
    if (streamActive) animRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(animRef.current)
  }, [streamActive, loop])

  const handleModeChange = (m) => {
    setMode(m)
    overlayImg.current = null
    if (wsRef.current?.readyState === WebSocket.OPEN)
      wsRef.current.send(JSON.stringify({ type: 'clear' }))
    if (isMobile) setShowPanel(false)
  }

  const modeColor = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[mode]
  const modeName  = { particles:'✦ Particles', music:'♫ Music', drawing:'✏ Drawing', strange:'⬡ Strange' }[mode]

  // ── MOBILE LAYOUT ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={m.app}>
        {/* Header */}
        <div style={{ ...m.header, borderBottomColor: `${modeColor}55` }}>
          <span style={{ ...m.title, color: modeColor }}>HAND GESTURE</span>
          <div style={m.headerRight}>
            <span style={{ ...m.dot,
              background: connected ? '#00ff88' : '#ff3344',
              boxShadow: connected ? '0 0 6px #00ff88' : '0 0 6px #ff3344' }} />
            {localFps > 0 && (
              <span style={{ ...m.fpsBadge, borderColor: modeColor, color: modeColor }}>
                {localFps} FPS
              </span>
            )}
          </div>
        </div>

        {/* Full-screen camera */}
        <div style={m.cameraWrap}>
          <canvas ref={canvasRef} style={m.canvas} />
          {!streamActive && (
            <div style={m.camPlaceholder}>
              <div style={m.camIcon}>◉</div>
              <div style={m.camText}>Starting camera…</div>
            </div>
          )}
          {/* Inline gesture badge */}
          {handData.length > 0 && (
            <div style={m.gestureBadge}>
              {handData.map((h,i) => (
                <span key={i} style={{ ...m.gestureChip, borderColor: modeColor, color: modeColor }}>
                  {h.special_gesture || h.gesture} · {h.fingers}✋
                </span>
              ))}
            </div>
          )}
          {/* Corner decorations */}
          <div style={{ ...m.corner, top:8, left:8,   borderTop:`2px solid ${modeColor}`, borderLeft:`2px solid ${modeColor}` }} />
          <div style={{ ...m.corner, top:8, right:8,  borderTop:`2px solid ${modeColor}`, borderRight:`2px solid ${modeColor}` }} />
          <div style={{ ...m.corner, bottom:72, left:8,  borderBottom:`2px solid ${modeColor}`, borderLeft:`2px solid ${modeColor}` }} />
          <div style={{ ...m.corner, bottom:72, right:8, borderBottom:`2px solid ${modeColor}`, borderRight:`2px solid ${modeColor}` }} />
        </div>

        {/* Bottom bar: mode switcher */}
        <div style={{ ...m.bottomBar, borderTopColor: `${modeColor}44` }}>
          {MODES.map(md => {
            const active = md === mode
            const mc = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[md]
            const icons = { particles:'✦', music:'♫', drawing:'✏', strange:'⬡' }
            return (
              <button key={md} onClick={() => handleModeChange(md)} style={{
                ...m.modeBtn,
                color: active ? mc : '#444',
                borderTop: active ? `2px solid ${mc}` : '2px solid transparent',
                background: active ? `${mc}15` : 'transparent',
              }}>
                <span style={m.modeBtnIcon}>{icons[md]}</span>
                <span style={m.modeBtnLabel}>{md.toUpperCase()}</span>
              </button>
            )
          })}
        </div>

        <video ref={videoRef} style={{ display:'none' }} muted playsInline />
      </div>
    )
  }

  // ── DESKTOP LAYOUT ────────────────────────────────────────────────────────
  return (
    <div style={s.app}>
      <div style={{ ...s.header, borderBottomColor: `${modeColor}55` }}>
        <div style={s.headerLeft}>
          <span style={{ ...s.title, color: modeColor }}>HAND GESTURE CONTROL</span>
          <span style={s.subtitle}>
            {mpReady ? '⚡ local detection · effects from cloud' : '☁ server detection'}
          </span>
        </div>
        <div style={s.statusRow}>
          {waking && <span style={s.wakingBadge}>WAKING…</span>}
          <span style={{ ...s.dot,
            background: connected ? '#00ff88' : '#ff3344',
            boxShadow: connected ? '0 0 8px #00ff8899' : '0 0 8px #ff334499' }} />
          <span style={s.statusText}>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          {localFps > 0 && (
            <span style={{ ...s.fpsBadge, borderColor: modeColor, color: modeColor }}>
              {localFps} FPS
            </span>
          )}
        </div>
      </div>

      <div style={s.body}>
        <div style={s.cameraWrap}>
          <canvas ref={canvasRef} style={s.canvas} />
          {!streamActive && (
            <div style={s.placeholder}>
              <div style={s.placeholderIcon}>◉</div>
              <div style={s.placeholderText}>Starting camera…</div>
            </div>
          )}
          <div style={{ ...s.corner, top:8, left:8,   borderTop:'2px solid #00e5ff', borderLeft:'2px solid #00e5ff' }} />
          <div style={{ ...s.corner, top:8, right:8,  borderTop:'2px solid #00e5ff', borderRight:'2px solid #00e5ff' }} />
          <div style={{ ...s.corner, bottom:8, left:8,  borderBottom:'2px solid #00e5ff', borderLeft:'2px solid #00e5ff' }} />
          <div style={{ ...s.corner, bottom:8, right:8, borderBottom:'2px solid #00e5ff', borderRight:'2px solid #00e5ff' }} />
        </div>

        <div style={s.panel}>
          <ModeSelector modes={MODES} current={mode} onChange={handleModeChange} />
          <div style={{ ...s.divider, borderColor: `${modeColor}33` }} />
          <GesturePanel handData={handData} mode={mode} />
          {error && <div style={s.errorBox}>⚠ {error}</div>}
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

      <video ref={videoRef} style={{ display:'none' }} muted playsInline />
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countFingers(lm, handedness) {
  if (!lm || lm.length < 21) return 0
  let count = 0
  if (handedness === 'Right') { if (lm[4].x < lm[2].x - 0.04) count++ }
  else                        { if (lm[4].x > lm[2].x + 0.04) count++ }
  for (const [tip, pip] of [[8,6],[12,10],[16,14],[20,18]])
    if (lm[tip].y < lm[pip].y) count++
  return count
}

function recognizeGesture(n) {
  return {0:'Fist',1:'One',2:'Peace',3:'Three',4:'Four',5:'High Five'}[n] || 'Unknown'
}

function getCenter(lm, w, h) {
  if (!lm?.length) return [0,0]
  return [Math.round((lm[0].x+lm[9].x)/2*w), Math.round((lm[0].y+lm[9].y)/2*h)]
}

function drawLandmarks(ctx, allLandmarks, w, h) {
  const connections = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
  ]
  for (const lm of allLandmarks) {
    const pts = lm.map(l => [l.x*w, l.y*h])
    ctx.strokeStyle = '#00c864'; ctx.lineWidth = 2
    for (const [a,b] of connections) {
      ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke()
    }
    for (const [x,y] of pts) {
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2)
      ctx.fillStyle = '#fff'; ctx.fill()
      ctx.strokeStyle = '#00c864'; ctx.lineWidth = 1.5; ctx.stroke()
    }
  }
}

// ── Desktop styles ────────────────────────────────────────────────────────────
const s = {
  app: { height:'100vh', display:'flex', flexDirection:'column', background:'#0a0a0f',
         color:'#e0e0e0', fontFamily:"'Courier New', monospace", overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'12px 24px', background:'#0d0d1a', borderBottom:'1px solid', flexShrink:0 },
  headerLeft: { display:'flex', flexDirection:'column', gap:'2px' },
  title: { fontSize:'15px', letterSpacing:'4px', fontWeight:700 },
  subtitle: { fontSize:'9px', letterSpacing:'3px', color:'#444' },
  statusRow: { display:'flex', alignItems:'center', gap:'10px' },
  dot: { width:10, height:10, borderRadius:'50%', flexShrink:0 },
  statusText: { fontSize:'11px', letterSpacing:'2px', color:'#555' },
  fpsBadge: { fontSize:'11px', letterSpacing:'1px', border:'1px solid', borderRadius:'4px', padding:'2px 8px' },
  wakingBadge: { fontSize:'10px', letterSpacing:'2px', color:'#fbbf24',
                 border:'1px solid #fbbf2444', borderRadius:'4px', padding:'2px 8px' },
  body: { flex:1, display:'flex', overflow:'hidden' },
  cameraWrap: { flex:1, position:'relative', background:'#050508',
                display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' },
  canvas: { width:'100%', height:'100%', objectFit:'contain' },
  placeholder: { position:'absolute', display:'flex', flexDirection:'column', alignItems:'center', gap:'16px' },
  placeholderIcon: { fontSize:'48px', color:'#1a1a2e' },
  placeholderText: { fontSize:'12px', letterSpacing:'3px', color:'#2a2a3e' },
  corner: { position:'absolute', width:20, height:20, opacity:0.6 },
  panel: { width:'320px', minWidth:'320px', background:'#0d0d1a', borderLeft:'1px solid #1a1a2e',
           display:'flex', flexDirection:'column', padding:'20px 16px', gap:'16px', overflowY:'auto' },
  divider: { borderTop:'1px solid', margin:'0 -4px' },
  errorBox: { background:'#1a0808', border:'1px solid #ff334466', borderRadius:'8px',
              padding:'12px', fontSize:'11px', color:'#ff8888' },
  hintBox: { marginTop:'auto', display:'flex', alignItems:'center', gap:'8px',
             padding:'10px 12px', background:'#12121e', borderRadius:'8px', border:'1px solid #1e1e32' },
  hintDot: { width:6, height:6, borderRadius:'50%', flexShrink:0 },
  hintText: { fontSize:'11px', color:'#555', letterSpacing:'0.5px' },
}

// ── Mobile styles ─────────────────────────────────────────────────────────────
const m = {
  app: { height:'100dvh', display:'flex', flexDirection:'column', background:'#0a0a0f',
         color:'#e0e0e0', fontFamily:"'Courier New', monospace", overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'8px 16px', background:'#0d0d1a', borderBottom:'1px solid', flexShrink:0 },
  title: { fontSize:'13px', letterSpacing:'3px', fontWeight:700 },
  headerRight: { display:'flex', alignItems:'center', gap:'8px' },
  dot: { width:8, height:8, borderRadius:'50%', flexShrink:0 },
  fpsBadge: { fontSize:'10px', border:'1px solid', borderRadius:'4px', padding:'2px 6px' },
  cameraWrap: { flex:1, position:'relative', background:'#050508', overflow:'hidden' },
  canvas: { width:'100%', height:'100%', objectFit:'cover' },
  camPlaceholder: { position:'absolute', inset:0, display:'flex', flexDirection:'column',
                    alignItems:'center', justifyContent:'center', gap:'12px' },
  camIcon: { fontSize:'40px', color:'#1a1a2e' },
  camText: { fontSize:'11px', letterSpacing:'3px', color:'#2a2a3e' },
  gestureBadge: { position:'absolute', top:12, left:'50%', transform:'translateX(-50%)',
                  display:'flex', gap:'8px', flexWrap:'wrap', justifyContent:'center' },
  gestureChip: { fontSize:'12px', letterSpacing:'1px', fontWeight:700,
                 background:'#0d0d1acc', border:'1px solid', borderRadius:'20px',
                 padding:'4px 14px', backdropFilter:'blur(8px)',
                 fontFamily:"'Courier New', monospace" },
  corner: { position:'absolute', width:16, height:16, opacity:0.7 },
  bottomBar: { display:'flex', background:'#0d0d1a', borderTop:'1px solid',
               flexShrink:0, paddingBottom:'env(safe-area-inset-bottom)' },
  modeBtn: { flex:1, display:'flex', flexDirection:'column', alignItems:'center',
             justifyContent:'center', gap:'3px', padding:'10px 4px',
             cursor:'pointer', transition:'all 0.2s',
             fontFamily:"'Courier New', monospace" },
  modeBtnIcon: { fontSize:'16px' },
  modeBtnLabel: { fontSize:'8px', letterSpacing:'1px', fontWeight:700 },
}
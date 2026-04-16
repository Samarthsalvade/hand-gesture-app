import React, { useRef, useState, useEffect, useCallback } from 'react'
import GesturePanel from './components/GesturePanel.jsx'
import ModeSelector from './components/ModeSelector.jsx'

const WS_URL   = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws'
const PING_URL = WS_URL.replace(/^wss?/, 'http').replace(/^wss/, 'https').replace('/ws', '/health')
const MODES    = ['particles', 'music', 'drawing', 'strange']
const BACKEND_THROTTLE_MS = 80

export default function App() {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const wsRef       = useRef(null)
  const animRef     = useRef(null)
  const lastSendRef = useRef(0)
  const pingRef     = useRef(null)
  const mpRef       = useRef(null)
  const overlayImg  = useRef(null)

  const [mode, setMode]             = useState('particles')
  const [connected, setConnected]   = useState(false)
  const [handData, setHandData]     = useState([])
  const [localFps, setLocalFps]     = useState(0)
  const [streamActive, setStreamActive] = useState(false)
  const [error, setError]           = useState(null)
  const [mpReady, setMpReady]       = useState(false)
  const [waking, setWaking]         = useState(false)
  const [isMobile, setIsMobile]     = useState(false)

  const fpsCount = useRef(0)
  const fpsTimer = useRef(Date.now())

  // ── Mobile detection ───────────────────────────────────────────────────────
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // ── Load MediaPipe JS ──────────────────────────────────────────────────────
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
          minHandDetectionConfidence: 0.55,
          minHandPresenceConfidence: 0.55,
          minTrackingConfidence: 0.55,
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

  // ── Keep-alive ─────────────────────────────────────────────────────────────
  const startPing = useCallback(() => {
    if (pingRef.current) clearInterval(pingRef.current)
    pingRef.current = setInterval(() => { fetch(PING_URL).catch(() => {}) }, 25_000)
  }, [])

  // ── WebSocket ──────────────────────────────────────────────────────────────
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

  // ── Webcam ─────────────────────────────────────────────────────────────────
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

  // ── Main render loop ───────────────────────────────────────────────────────
  const loop = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2 || video.videoWidth === 0) {
      animRef.current = requestAnimationFrame(loop)
      return
    }

    fpsCount.current++
    const now = Date.now()
    if (now - fpsTimer.current >= 1000) {
      setLocalFps(fpsCount.current)
      fpsCount.current = 0
      fpsTimer.current = now
    }

    const w = video.videoWidth, h = video.videoHeight
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')

    // Mirror flip
    ctx.save()
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    ctx.restore()

    // MediaPipe detection — update handData every frame, no smoothing
    const mp = mpRef.current
    if (mp) {
      try {
        const result = mp.detectForVideo(video, performance.now())
        if (result.handLandmarks?.length > 0) {
          drawLandmarksMirrored(ctx, result.handLandmarks, w, h)
          const hands = result.handedness.map((hn, i) => {
            const fingers = countFingers(result.handLandmarks[i], hn[0].displayName)
            return {
              handedness:      hn[0].displayName,
              fingers,
              gesture:         recognizeGesture(fingers),
              special_gesture: detectSpecial(result.handLandmarks[i]),
              center:          getCenter(result.handLandmarks[i], w, h),
            }
          })
          setHandData(hands)
        } else {
          setHandData([])
        }
      } catch {}
    }

    // Composite effect overlay
    if (overlayImg.current) {
      ctx.save()
      ctx.translate(w, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(overlayImg.current, 0, 0, w, h)
      ctx.restore()
    }

    // Send to backend (throttled)
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN && now - lastSendRef.current >= BACKEND_THROTTLE_MS) {
      lastSendRef.current = now
      const tmp = document.createElement('canvas')
      tmp.width = w; tmp.height = h
      tmp.getContext('2d').drawImage(video, 0, 0)
      ws.send(JSON.stringify({ type: 'frame', frame: tmp.toDataURL('image/jpeg', 0.5), mode }))
    }

    animRef.current = requestAnimationFrame(loop)
  }, [mode])

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
  }

  const modeColor = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[mode]

  // ── MOBILE LAYOUT ──────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={mob.app}>
        <div style={{ ...mob.header, borderBottomColor: `${modeColor}55` }}>
          <span style={{ ...mob.title, color: modeColor }}>HAND GESTURE</span>
          <div style={mob.headerRight}>
            {waking && <span style={mob.waking}>WAKING…</span>}
            <span style={{ ...mob.dot, background: connected ? '#00ff88' : '#ff3344',
              boxShadow: connected ? '0 0 6px #00ff88' : '0 0 6px #ff3344' }} />
            {localFps > 0 && (
              <span style={{ ...mob.fps, borderColor: modeColor, color: modeColor }}>
                {localFps} FPS
              </span>
            )}
          </div>
        </div>

        <div style={mob.cameraWrap}>
          <canvas ref={canvasRef} style={mob.canvas} />
          {!streamActive && (
            <div style={mob.placeholder}>
              <div style={{ fontSize:'40px', color:'#1a1a2e' }}>◉</div>
              <div style={{ fontSize:'11px', letterSpacing:'3px', color:'#2a2a3e' }}>Starting camera…</div>
            </div>
          )}
          {handData.length > 0 && (
            <div style={mob.badgeRow}>
              {handData.map((h, i) => (
                <div key={i} style={{ ...mob.badge, borderColor: modeColor }}>
                  <span style={{ ...mob.badgeGesture, color: modeColor }}>
                    {h.special_gesture || h.gesture}
                  </span>
                  <div style={mob.badgePips}>
                    {[0,1,2,3,4].map(idx => (
                      <div key={idx} style={{
                        ...mob.pip,
                        background: idx < h.fingers
                          ? ['#ff6b6b','#ffa94d','#ffd43b','#69db7c','#74c0fc'][idx]
                          : '#1e1e32',
                      }} />
                    ))}
                    <span style={mob.pipCount}>{h.fingers}/5</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {[{top:8,left:8,borderTop:`2px solid ${modeColor}`,borderLeft:`2px solid ${modeColor}`},
            {top:8,right:8,borderTop:`2px solid ${modeColor}`,borderRight:`2px solid ${modeColor}`},
            {bottom:72,left:8,borderBottom:`2px solid ${modeColor}`,borderLeft:`2px solid ${modeColor}`},
            {bottom:72,right:8,borderBottom:`2px solid ${modeColor}`,borderRight:`2px solid ${modeColor}`},
          ].map((cs, i) => (
            <div key={i} style={{ position:'absolute', width:16, height:16, opacity:0.7, ...cs }} />
          ))}
        </div>

        <div style={{ ...mob.tabBar, borderTopColor: `${modeColor}44` }}>
          {MODES.map(md => {
            const active = md === mode
            const mc = { particles:'#a78bfa', music:'#34d399', drawing:'#f472b6', strange:'#fbbf24' }[md]
            return (
              <button key={md} onClick={() => handleModeChange(md)} style={{
                ...mob.tab,
                color: active ? mc : '#444',
                borderTop: `2px solid ${active ? mc : 'transparent'}`,
                background: active ? `${mc}18` : 'transparent',
              }}>
                <span style={{ fontSize:'18px', lineHeight:1 }}>
                  {{'particles':'✦','music':'♫','drawing':'✏','strange':'⬡'}[md]}
                </span>
                <span style={{ fontSize:'9px', letterSpacing:'1px', fontWeight:700 }}>
                  {md.toUpperCase()}
                </span>
              </button>
            )
          })}
        </div>

        <video ref={videoRef} style={{ display:'none' }} muted playsInline />
      </div>
    )
  }

  // ── DESKTOP LAYOUT ─────────────────────────────────────────────────────────
  return (
    <div style={desk.app}>
      <div style={{ ...desk.header, borderBottomColor: `${modeColor}55` }}>
        <div style={desk.headerLeft}>
          <span style={{ ...desk.title, color: modeColor }}>HAND GESTURE CONTROL</span>
          <span style={desk.subtitle}>
            {mpReady ? '⚡ local detection · effects from cloud' : '☁ server detection'}
          </span>
        </div>
        <div style={desk.statusRow}>
          {waking && <span style={desk.wakingBadge}>WAKING…</span>}
          <span style={{ ...desk.dot, background: connected ? '#00ff88' : '#ff3344',
            boxShadow: connected ? '0 0 8px #00ff8899' : '0 0 8px #ff334499' }} />
          <span style={desk.statusText}>{connected ? 'CONNECTED' : 'OFFLINE'}</span>
          {localFps > 0 && (
            <span style={{ ...desk.fpsBadge, borderColor: modeColor, color: modeColor }}>
              {localFps} FPS
            </span>
          )}
        </div>
      </div>

      <div style={desk.body}>
        <div style={desk.cameraWrap}>
          <canvas ref={canvasRef} style={desk.canvas} />
          {!streamActive && (
            <div style={desk.placeholder}>
              <div style={{ fontSize:'48px', color:'#1a1a2e' }}>◉</div>
              <div style={{ fontSize:'12px', letterSpacing:'3px', color:'#2a2a3e' }}>Starting camera…</div>
            </div>
          )}
          {[{top:8,left:8,borderTop:'2px solid #00e5ff',borderLeft:'2px solid #00e5ff'},
            {top:8,right:8,borderTop:'2px solid #00e5ff',borderRight:'2px solid #00e5ff'},
            {bottom:8,left:8,borderBottom:'2px solid #00e5ff',borderLeft:'2px solid #00e5ff'},
            {bottom:8,right:8,borderBottom:'2px solid #00e5ff',borderRight:'2px solid #00e5ff'},
          ].map((cs, i) => (
            <div key={i} style={{ position:'absolute', width:20, height:20, opacity:0.6, ...cs }} />
          ))}
        </div>

        <div style={desk.panel}>
          <ModeSelector modes={MODES} current={mode} onChange={handleModeChange} />
          <div style={{ ...desk.divider, borderColor: `${modeColor}33` }} />
          <GesturePanel handData={handData} mode={mode} />
          {error && <div style={desk.errorBox}>⚠ {error}</div>}
          <div style={desk.hintBox}>
            <span style={{ ...desk.hintDot, background: modeColor }} />
            <span style={desk.hintText}>
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

// ── Helpers ────────────────────────────────────────────────────────────────────

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
  return {0:'Fist',1:'One',2:'Peace',3:'Three',4:'Four',5:'High Five'}[n] ?? 'Unknown'
}

function detectSpecial(lm) {
  if (!lm) return null
  if (Math.hypot(lm[4].x-lm[8].x, lm[4].y-lm[8].y) < 0.04) return 'OK Sign'
  if (lm[8].y < lm[6].y && lm[12].y < lm[10].y && lm[16].y > lm[14].y) return 'Peace Sign'
  return null
}

function getCenter(lm, w, h) {
  if (!lm?.length) return [0, 0]
  return [Math.round((1-(lm[0].x+lm[9].x)/2)*w), Math.round((lm[0].y+lm[9].y)/2*h)]
}

function drawLandmarksMirrored(ctx, allLandmarks, w, h) {
  const CONN = [
    [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],
    [0,9],[9,10],[10,11],[11,12],[0,13],[13,14],[14,15],[15,16],
    [0,17],[17,18],[18,19],[19,20],[5,9],[9,13],[13,17],
  ]
  for (const lm of allLandmarks) {
    const pts = lm.map(l => [(1-l.x)*w, l.y*h])
    ctx.strokeStyle = '#00c864'; ctx.lineWidth = 2
    for (const [a,b] of CONN) {
      ctx.beginPath(); ctx.moveTo(...pts[a]); ctx.lineTo(...pts[b]); ctx.stroke()
    }
    for (const [x,y] of pts) {
      ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2)
      ctx.fillStyle='#fff'; ctx.fill()
      ctx.strokeStyle='#00c864'; ctx.lineWidth=1.5; ctx.stroke()
    }
  }
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const desk = {
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
  placeholder: { position:'absolute', display:'flex', flexDirection:'column',
                 alignItems:'center', gap:'16px' },
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

const mob = {
  app: { height:'100dvh', display:'flex', flexDirection:'column', background:'#0a0a0f',
         color:'#e0e0e0', fontFamily:"'Courier New', monospace", overflow:'hidden' },
  header: { display:'flex', alignItems:'center', justifyContent:'space-between',
            padding:'8px 16px', background:'#0d0d1a', borderBottom:'1px solid', flexShrink:0 },
  title: { fontSize:'13px', letterSpacing:'3px', fontWeight:700 },
  headerRight: { display:'flex', alignItems:'center', gap:'8px' },
  dot: { width:8, height:8, borderRadius:'50%', flexShrink:0 },
  fps: { fontSize:'10px', border:'1px solid', borderRadius:'4px', padding:'2px 6px' },
  waking: { fontSize:'9px', letterSpacing:'2px', color:'#fbbf24' },
  cameraWrap: { flex:1, position:'relative', background:'#050508', overflow:'hidden' },
  canvas: { width:'100%', height:'100%', objectFit:'cover' },
  placeholder: { position:'absolute', inset:0, display:'flex', flexDirection:'column',
                 alignItems:'center', justifyContent:'center', gap:'12px' },
  badgeRow: { position:'absolute', top:14, left:'50%', transform:'translateX(-50%)',
              display:'flex', gap:'10px', flexWrap:'wrap', justifyContent:'center' },
  badge: { background:'rgba(10,10,15,0.82)', border:'1px solid', borderRadius:'12px',
           padding:'8px 14px', backdropFilter:'blur(10px)',
           display:'flex', flexDirection:'column', alignItems:'center', gap:'6px', minWidth:110 },
  badgeGesture: { fontSize:'14px', fontWeight:700, letterSpacing:'1px',
                  fontFamily:"'Courier New', monospace" },
  badgePips: { display:'flex', alignItems:'center', gap:'5px' },
  pip: { width:11, height:11, borderRadius:'50%', transition:'all 0.15s' },
  pipCount: { fontSize:'10px', color:'#555', marginLeft:'4px' },
  tabBar: { display:'flex', background:'#0d0d1a', borderTop:'1px solid',
            flexShrink:0, paddingBottom:'env(safe-area-inset-bottom)' },
  tab: { flex:1, display:'flex', flexDirection:'column', alignItems:'center',
         justifyContent:'center', gap:'3px', padding:'10px 4px',
         cursor:'pointer', transition:'all 0.2s', fontFamily:"'Courier New', monospace",
         border:'none' },
}
import React, { useEffect, useRef } from 'react'

export default function VideoCanvas({ videoRef, canvasRef, processedFrame, streamActive, mpReady }) {
  const imgRef = useRef(null)

  useEffect(() => {
    if (imgRef.current && processedFrame && !mpReady) {
      imgRef.current.src = processedFrame
    }
  }, [processedFrame, mpReady])

  return (
    <div style={styles.container}>
      {/* If MediaPipe JS is running locally, show the local canvas */}
      {mpReady ? (
        <canvas
          ref={canvasRef}
          style={styles.frame}
        />
      ) : processedFrame ? (
        // Fall back to server-annotated frame
        <img ref={imgRef} alt="frame" style={styles.frame} />
      ) : (
        <div style={styles.placeholder}>
          <div style={styles.placeholderIcon}>◉</div>
          <div style={styles.placeholderText}>
            {streamActive ? 'Connecting…' : 'Starting camera…'}
          </div>
        </div>
      )}

      {/* Corner decorations */}
      <div style={{ ...styles.corner, top: 8, left: 8, borderTop: '2px solid #00e5ff', borderLeft: '2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, top: 8, right: 8, borderTop: '2px solid #00e5ff', borderRight: '2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, bottom: 8, left: 8, borderBottom: '2px solid #00e5ff', borderLeft: '2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, bottom: 8, right: 8, borderBottom: '2px solid #00e5ff', borderRight: '2px solid #00e5ff' }} />
    </div>
  )
}

const styles = {
  container: {
    flex: 1, position: 'relative', background: '#050508',
    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  frame: { width: '100%', height: '100%', objectFit: 'contain' },
  placeholder: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px',
  },
  placeholderIcon: { fontSize: '48px', color: '#1a1a2e' },
  placeholderText: { fontSize: '12px', letterSpacing: '3px', color: '#2a2a3e' },
  corner: { position: 'absolute', width: 20, height: 20, opacity: 0.6 },
}
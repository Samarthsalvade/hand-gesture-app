import React, { useEffect, useRef } from 'react'

export default function VideoCanvas({ videoRef, processedFrame, streamActive }) {
  const imgRef = useRef(null)

  useEffect(() => {
    if (imgRef.current && processedFrame) {
      imgRef.current.src = processedFrame
    }
  }, [processedFrame])

  return (
    <div style={styles.container}>
      {/* Processed annotated frame from backend */}
      {processedFrame ? (
        <img
          ref={imgRef}
          alt="Processed frame"
          style={styles.frame}
        />
      ) : (
        <div style={styles.placeholder}>
          <div style={styles.placeholderIcon}>◉</div>
          <div style={styles.placeholderText}>
            {streamActive ? 'Connecting to backend...' : 'Starting camera...'}
          </div>
          <div style={styles.scanline} />
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
    flex: 1,
    position: 'relative',
    background: '#050508',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  frame: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
  placeholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    color: '#333',
  },
  placeholderIcon: {
    fontSize: '48px',
    color: '#1a1a2e',
    animation: 'pulse 2s ease-in-out infinite',
  },
  placeholderText: {
    fontSize: '12px',
    letterSpacing: '3px',
    color: '#2a2a3e',
  },
  corner: {
    position: 'absolute',
    width: 20,
    height: 20,
    opacity: 0.6,
  },
  scanline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '2px',
    background: 'linear-gradient(transparent, #00e5ff22, transparent)',
    animation: 'scan 4s linear infinite',
  },
}

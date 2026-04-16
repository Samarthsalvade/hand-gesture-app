import React from 'react'

export default function VideoCanvas({ canvasRef, streamActive }) {
  return (
    <div style={styles.container}>
      <canvas ref={canvasRef} style={styles.canvas} />
      {!streamActive && (
        <div style={styles.placeholder}>
          <div style={styles.icon}>◉</div>
          <div style={styles.text}>Starting camera…</div>
        </div>
      )}
      <div style={{ ...styles.corner, top:8, left:8,   borderTop:'2px solid #00e5ff', borderLeft:'2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, top:8, right:8,  borderTop:'2px solid #00e5ff', borderRight:'2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, bottom:8, left:8,  borderBottom:'2px solid #00e5ff', borderLeft:'2px solid #00e5ff' }} />
      <div style={{ ...styles.corner, bottom:8, right:8, borderBottom:'2px solid #00e5ff', borderRight:'2px solid #00e5ff' }} />
    </div>
  )
}

const styles = {
  container: { flex:1, position:'relative', background:'#050508',
               display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden' },
  canvas: { width:'100%', height:'100%', objectFit:'contain' },
  placeholder: { position:'absolute', display:'flex', flexDirection:'column',
                 alignItems:'center', gap:'16px' },
  icon: { fontSize:'48px', color:'#1a1a2e' },
  text: { fontSize:'12px', letterSpacing:'3px', color:'#2a2a3e' },
  corner: { position:'absolute', width:20, height:20, opacity:0.6 },
}
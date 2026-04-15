import React from 'react'

const MODES_META = {
  particles: { color: '#a78bfa', glow: '#a78bfa44', icon: '✦', desc: 'Particle burst' },
  music:     { color: '#34d399', glow: '#34d39944', icon: '♫', desc: 'Audio visualizer' },
  drawing:   { color: '#f472b6', glow: '#f472b644', icon: '✏', desc: 'Paint trails' },
  strange:   { color: '#fbbf24', glow: '#fbbf2444', icon: '⬡', desc: 'Magic circles' },
}

export default function ModeSelector({ modes, current, onChange }) {
  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>SELECT MODE</div>
      <div style={styles.grid}>
        {modes.map((mode) => {
          const meta = MODES_META[mode]
          const active = mode === current
          return (
            <button
              key={mode}
              onClick={() => onChange(mode)}
              style={{
                ...styles.btn,
                border: active ? `2px solid ${meta.color}` : '2px solid #252535',
                background: active ? `${meta.color}22` : '#12121e',
                color: active ? meta.color : '#6b6b8a',
                boxShadow: active ? `0 0 18px ${meta.glow}, inset 0 0 12px ${meta.glow}` : 'none',
                transform: active ? 'scale(1.03)' : 'scale(1)',
              }}
            >
              <span style={{ ...styles.icon, color: active ? meta.color : '#3a3a55' }}>
                {meta.icon}
              </span>
              <span style={styles.modeName}>{mode.toUpperCase()}</span>
              <span style={{ ...styles.modeDesc, color: active ? `${meta.color}bb` : '#3a3a55' }}>
                {meta.desc}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  sectionLabel: {
    fontSize: '10px', letterSpacing: '3px', color: '#555', fontWeight: 600,
  },
  grid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px',
  },
  btn: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: '4px', padding: '16px 8px', borderRadius: '10px', cursor: 'pointer',
    transition: 'all 0.2s ease', fontFamily: "'Courier New', monospace",
    minHeight: '90px',
  },
  icon: { fontSize: '22px', lineHeight: 1 },
  modeName: { fontSize: '13px', fontWeight: 700, letterSpacing: '2px' },
  modeDesc: { fontSize: '10px', letterSpacing: '0.5px', fontWeight: 400 },
}
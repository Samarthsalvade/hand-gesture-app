import React from 'react'

const FINGER_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#74c0fc']
const GESTURE_ICONS = {
  'Fist': '✊', 'One': '☝', 'Peace': '✌', 'Three': '🤟',
  'Four': '🖖', 'High Five': '🖐', 'OK Sign': '👌', 'Peace Sign': '✌', 'Unknown': '?',
}

export default function GesturePanel({ handData, mode }) {
  return (
    <div style={styles.container}>
      <div style={styles.sectionLabel}>HAND TRACKING</div>
      {(!handData || handData.length === 0) ? (
        <div style={styles.emptyCard}>
          <div style={styles.emptyIcon}>✋</div>
          <div style={styles.emptyText}>Show your hand</div>
          <div style={styles.emptySubtext}>to the camera</div>
        </div>
      ) : (
        handData.map((hand, i) => {
          const gesture = hand.special_gesture || hand.gesture
          return (
            <div key={i} style={styles.card}>
              <div style={styles.cardHeader}>
                <span style={styles.handLabel}>{hand.handedness.toUpperCase()} HAND</span>
                <span style={styles.gestureIcon}>{GESTURE_ICONS[gesture] || '?'}</span>
              </div>
              <div style={styles.gestureName}>{gesture}</div>
              <div style={styles.fingerRow}>
                {[0,1,2,3,4].map(idx => (
                  <div key={idx} style={{
                    ...styles.fingerPip,
                    background: idx < hand.fingers ? FINGER_COLORS[idx] : '#1e1e32',
                    boxShadow: idx < hand.fingers ? `0 0 8px ${FINGER_COLORS[idx]}88` : 'none',
                  }} />
                ))}
                <span style={styles.fingerCount}>{hand.fingers} / 5</span>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', gap: '10px' },
  sectionLabel: { fontSize: '10px', letterSpacing: '3px', color: '#555', fontWeight: 600 },
  emptyCard: {
    background: '#12121e', border: '2px dashed #252535', borderRadius: '10px',
    padding: '24px 16px', display: 'flex', flexDirection: 'column',
    alignItems: 'center', gap: '4px',
  },
  emptyIcon: { fontSize: '28px', opacity: 0.25 },
  emptyText: { fontSize: '13px', color: '#3a3a55', fontWeight: 600, letterSpacing: '1px' },
  emptySubtext: { fontSize: '11px', color: '#2a2a40', letterSpacing: '1px' },
  card: {
    background: '#12121e', border: '2px solid #1e1e32', borderRadius: '10px',
    padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
  },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  handLabel: { fontSize: '11px', letterSpacing: '2px', color: '#00e5ff', fontWeight: 700 },
  gestureIcon: { fontSize: '20px' },
  gestureName: {
    fontSize: '16px', color: '#e0e0e0', fontWeight: 700, letterSpacing: '1px',
  },
  fingerRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  fingerPip: {
    width: 14, height: 14, borderRadius: '50%', transition: 'all 0.15s ease',
  },
  fingerCount: { fontSize: '12px', color: '#555', marginLeft: '4px', letterSpacing: '1px' },
}
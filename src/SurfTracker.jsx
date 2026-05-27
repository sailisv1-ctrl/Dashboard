import { useState, useEffect } from 'react'
import { createTidePredictor } from '@neaps/tide-predictor'
import './SurfTracker.css'

const LAT = -8.8291
const LNG = 115.0849

const BALI_TIDE_CONSTITUENTS = [
  { name: 'K1', amplitude: 0.320, phase: 295 },
  { name: 'O1', amplitude: 0.172, phase: 256 },
  { name: 'M2', amplitude: 0.181, phase: 256 },
  { name: 'S2', amplitude: 0.111, phase: 294 },
  { name: 'N2', amplitude: 0.037, phase: 228 },
  { name: 'P1', amplitude: 0.098, phase: 297 },
  { name: 'Q1', amplitude: 0.034, phase: 233 },
  { name: 'K2', amplitude: 0.031, phase: 294 },
]

function windDir(deg) {
  return ['N','NE','E','SE','S','SW','W','NW'][Math.round(deg / 45) % 8]
}
function formatTime(d) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}
function windScore(speed, dir) {
  let d = dir >= 100 && dir <= 160 ? 10 : dir >= 70 && dir < 100 ? 8 : dir > 160 && dir <= 185 ? 6
        : dir >= 45 && dir < 70 ? 5 : dir > 185 && dir <= 220 ? 3 : dir > 220 && dir <= 280 ? 1 : 4
  let s = speed <= 10 ? 10 : speed <= 20 ? 8 : speed <= 30 ? 5 : speed <= 40 ? 3 : 1
  return Math.round(d * 0.6 + s * 0.4)
}
function tideScore(ex) { return (!ex || !ex.length) ? 5 : ex[0].high ? 9 : 5 }
function weatherScore(code, rain) {
  if (rain > 5) return 2; if (rain > 1) return 4
  if (code === 0) return 10; if (code <= 2) return 8; if (code <= 45) return 6
  if (code <= 67) return 3; if (code >= 95) return 1; return 5
}
function waveScore(h, p) {
  let s = h < 0.3 ? 1 : h < 0.7 ? 3 : h < 1.2 ? 6 : h < 2.0 ? 9 : h < 3.0 ? 8 : h < 4.5 ? 5 : 2
  return Math.min(10, Math.round(s + (p >= 16 ? 1.5 : p >= 12 ? 1 : p >= 8 ? 0.5 : 0)))
}
function waveSize(h) {
  // Thresholds relative to a 1.8m (6ft) person
  if (h < 0.2)  return 'Ankle high'
  if (h < 0.5)  return 'Knee high'
  if (h < 0.85) return 'Waist high'
  if (h < 1.2)  return 'Chest high'
  if (h < 1.6)  return 'Shoulder high'
  if (h < 1.95) return 'Head high'
  if (h < 2.6)  return 'Overhead'
  if (h < 3.8)  return 'Double overhead'
  return 'XXL'
}
function overallScore(w, wv, t, wx) {
  return Math.min(10, Math.max(1, Math.round(w * 0.40 + wv * 0.25 + t * 0.20 + wx * 0.15)))
}
function scoreColor(s) {
  return s >= 8 ? '#06d6c7' : s >= 6 ? '#84cc16' : s >= 4 ? '#f59e0b' : '#ef4444'
}
function scoreLabel(s) {
  return s >= 9 ? 'Excellent' : s >= 7 ? 'Good' : s >= 5 ? 'Fair' : s >= 3 ? 'Poor' : 'Terrible'
}
function uvInfo(i) {
  if (i <= 2)  return { label: 'Low',       color: '#22c55e', advice: 'No protection needed' }
  if (i <= 5)  return { label: 'Moderate',  color: '#84cc16', advice: 'Wear SPF 30+' }
  if (i <= 7)  return { label: 'High',      color: '#f59e0b', advice: 'SPF 50+, seek shade at midday' }
  if (i <= 10) return { label: 'Very High', color: '#ef4444', advice: 'SPF 50+, rash vest required' }
  return               { label: 'Extreme',  color: '#a855f7', advice: 'Avoid 10am–2pm outdoors' }
}

export default function SurfTracker() {
  const [weather, setWeather] = useState(null)
  const [waves,   setWaves]   = useState(null)
  const [tideEx,  setTideEx]  = useState(null)
  const [tideTl,  setTideTl]  = useState(null)
  const [updated, setUpdated] = useState(null)

  async function fetchWeather() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
      `&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
      `&hourly=uv_index&daily=uv_index_max&forecast_days=1` +
      `&wind_speed_unit=kmh&timezone=Asia%2FMakassar`
    const r = await fetch(url); if (!r.ok) throw new Error('Weather API failed')
    return r.json()
  }
  async function fetchWaves() {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LNG}` +
      `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
      `&timezone=Asia%2FMakassar`
    const r = await fetch(url); if (!r.ok) throw new Error('Marine API failed')
    return r.json()
  }
  function calcTides() {
    const pred  = createTidePredictor(BALI_TIDE_CONSTITUENTS)
    const now   = new Date()
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end   = new Date(now); end.setHours(23, 59, 59, 999)
    return {
      extremes: pred.getExtremesPrediction({ start, end }),
      timeline: pred.getTimelinePrediction({ start, end, numHours: 24 }),
    }
  }
  async function load() {
    const [wr, mr] = await Promise.allSettled([fetchWeather(), fetchWaves()])
    if (wr.status === 'fulfilled') setWeather(wr.value)
    if (mr.status === 'fulfilled') setWaves(mr.value)
    const { extremes, timeline } = calcTides()
    setTideEx(extremes); setTideTl(timeline)
    setUpdated(new Date())
  }
  useEffect(() => { load() }, [])

  const cur  = weather?.current
  const wav  = waves?.current
  const uvH  = weather?.hourly?.uv_index
  const uvMx = weather?.daily?.uv_index_max?.[0]
  const uv   = uvMx != null ? uvInfo(uvMx) : null

  const wSc  = cur  ? windScore(cur.wind_speed_10m, cur.wind_direction_10m) : null
  const tSc  = tideEx ? tideScore(tideEx) : null
  const wxSc = cur  ? weatherScore(cur.weather_code, cur.precipitation) : null
  const wvSc = wav  ? waveScore(wav.wave_height, wav.swell_wave_period ?? wav.wave_period) : null
  const surf = (wSc !== null && tSc !== null && wxSc !== null && wvSc !== null)
    ? overallScore(wSc, wvSc, tSc, wxSc) : null

  const isOff = cur && cur.wind_direction_10m >= 100 && cur.wind_direction_10m <= 160
  const isOn  = cur && cur.wind_direction_10m > 220 && cur.wind_direction_10m <= 280

  return (
    <div className="surf-tracker">
      <div className="surf-header">
        <h1>Surf Tracker</h1>
        <span className="location">Uluwatu, Bali</span>
        {updated && <span className="updated">Updated {updated.toLocaleTimeString()}</span>}
      </div>

      {!cur && <div className="loading">Loading surf data...</div>}

      {cur && (
        <>
          {/* 4 equal cards */}
          <div className="cards-grid">

            {/* 1 — Surf Score */}
            <div className="card score-card">
              <div className="card-label">Surf Score</div>
              <SurfGauge score={surf ?? 0} label={surf !== null ? scoreLabel(surf) : '—'} />
              <div className="bars">
                {[['Waves', wvSc], ['Wind', wSc], ['Tide', tSc], ['Weather', wxSc]].map(([name, val]) => (
                  <div key={name} className="bar-row">
                    <span className="bar-name">{name}</span>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(val ?? 0) * 10}%`, background: scoreColor(val ?? 0) }} />
                    </div>
                    <span className="bar-num">{val ?? 0}</span>
                  </div>
                ))}
              </div>
              <div className="score-note">
                {windDir(cur.wind_direction_10m)} · {cur.wind_speed_10m} km/h · {isOff ? 'offshore' : isOn ? 'onshore' : 'cross-shore'}
              </div>
            </div>

            {/* 2 — Wind */}
            <div className="card wind-card">
              <div className="card-label">Wind</div>
              <Compass direction={cur.wind_direction_10m} />
              <div className="wind-speed">{cur.wind_speed_10m}<span className="unit"> km/h</span></div>
              <div className="wind-detail">{windDir(cur.wind_direction_10m)} · {cur.wind_direction_10m}°</div>
              <div className="wind-type" style={{ color: isOff ? '#06d6c7' : isOn ? '#ef4444' : '#f59e0b' }}>
                {isOff ? 'Offshore' : isOn ? 'Onshore' : 'Cross-shore'}
              </div>
            </div>

            {/* 3 — Waves */}
            <div className="card">
              <div className="card-label">Waves</div>
              {wav ? (
                <>
                  <div className="big-num">{wav.wave_height?.toFixed(1)}<span className="unit"> m</span></div>
                  <div className="wave-size">{waveSize(wav.wave_height)}</div>
                  <div className="sub-detail">
                    {wav.swell_wave_period?.toFixed(0) ?? wav.wave_period?.toFixed(0)}s period · {windDir(wav.swell_wave_direction ?? wav.wave_direction)} swell
                  </div>
                  <WaveViz height={wav.wave_height} />
                </>
              ) : <div className="sub-detail" style={{ paddingTop: 8 }}>Loading...</div>}
            </div>

            {/* 4 — UV + Temp */}
            <div className="card uv-card">
              <div className="card-label">UV Index</div>
              <div className="big-num" style={{ color: uv?.color }}>{uvMx?.toFixed(1)}</div>
              <div className="uv-lbl" style={{ color: uv?.color }}>{uv?.label}</div>
              <div className="sub-detail">{uv?.advice}</div>
              {uvH && <UVCurve hourlyUV={uvH} />}
              <div className="temp-block">
                <div className="temp-val">{cur.temperature_2m}°</div>
                <div className="sub-detail">Bali temp</div>
              </div>
            </div>

          </div>

          {/* Full-width tide card */}
          <div className="card tide-full-card">
            <div className="card-label">Tide Curve — Today</div>
            <div className="tide-extremes">
              {(tideEx || []).map((e, i) => (
                <div key={i} className="tide-extreme-item">
                  <span style={{ color: e.high ? '#06d6c7' : '#818cf8', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                    {e.high ? '▲ High' : '▼ Low'}
                  </span>
                  <span className="sub-detail">{formatTime(e.time)}</span>
                  <span style={{ color: '#c4cfe0', fontWeight: 600, fontSize: '0.85rem' }}>{e.level.toFixed(2)} m</span>
                </div>
              ))}
            </div>
            {tideTl && <TideCurve timeline={tideTl} extremes={tideEx} />}
          </div>
        </>
      )}
    </div>
  )
}

// ── Surf Gauge ────────────────────────────────────────────────────────────────
function SurfGauge({ score, label }) {
  const S = 156, cx = 78, cy = 78, r = 60, sw = 11
  const circ  = 2 * Math.PI * r
  const arc   = (Math.min(score, 10) / 10) * circ
  const color = scoreColor(score)

  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`}
      style={{ display: 'block', margin: '4px auto 8px', overflow: 'visible' }}>
      <defs>
        <linearGradient id="rG" gradientUnits="userSpaceOnUse" x1={cx} y1={cy - r} x2={cx} y2={cy + r}>
          <stop offset="0%"   stopColor="#06d6c7" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id="rBg" cx="50%" cy="50%" r="50%">
          <stop offset="0%"   stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0"    />
        </radialGradient>
        <filter id="rGlow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Soft inner glow */}
      <circle cx={cx} cy={cy} r={r - 8} fill="url(#rBg)" />
      {/* Track ring */}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e1e4a" strokeWidth={sw} />
      {/* Filled arc */}
      <circle cx={cx} cy={cy} r={r} fill="none"
        stroke="url(#rG)" strokeWidth={sw} strokeLinecap="round"
        strokeDasharray={`${arc} ${circ - arc}`}
        transform={`rotate(-90 ${cx} ${cy})`}
        filter="url(#rGlow)" />
      {/* Score number */}
      <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="middle"
        fontSize="40" fontWeight="800" fill={color} fontFamily="-apple-system,sans-serif">{score}</text>
      {/* Label */}
      <text x={cx} y={cy + 26} textAnchor="middle" dominantBaseline="middle"
        fontSize="7.5" fontWeight="700" fill="#6b7a9a" letterSpacing="2.5"
        fontFamily="-apple-system,sans-serif">{label.toUpperCase()}</text>
    </svg>
  )
}

// ── Compass ──────────────────────────────────────────────────────────────────
function Compass({ direction }) {
  // Large enough SVG so N/E/S/W labels always stay inside the viewBox
  const W = 120, H = 120, cx = 60, cy = 60, r = 36
  const rad = (direction - 90) * (Math.PI / 180)
  const ax  = cx + Math.cos(rad) * 22
  const ay  = cy + Math.sin(rad) * 22
  const isOff = direction >= 100 && direction <= 160
  const isOn  = direction > 220 && direction <= 280
  const color = isOff ? '#06d6c7' : isOn ? '#ef4444' : '#f59e0b'

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', margin: '8px auto' }}>
      <defs>
        <filter id="arrowGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={r}      fill="none" stroke="#3a4a6a" strokeWidth="2.5" />
      {/* Inner dashed ring */}
      <circle cx={cx} cy={cy} r={r - 10} fill="none" stroke="#2a3a5a" strokeWidth="1" strokeDasharray="3 5" />
      {/* Cardinal labels — placed at r+16 from center */}
      {['N','E','S','W'].map((lbl, i) => {
        const a   = i * 90 * (Math.PI / 180) - Math.PI / 2
        const lx  = cx + Math.cos(a) * (r + 16)
        const ly  = cy + Math.sin(a) * (r + 16)
        const isN = lbl === 'N'
        return (
          <text key={lbl} x={lx} y={ly}
            textAnchor="middle" dominantBaseline="middle"
            fontSize="11" fontWeight="800"
            fill={isN ? '#ffffff' : '#8b9ab8'}
            fontFamily="-apple-system,sans-serif">
            {lbl}
          </text>
        )
      })}
      {/* Arrow */}
      <line x1={cx} y1={cy} x2={ax} y2={ay}
        stroke={color} strokeWidth="3.5" strokeLinecap="round" filter="url(#arrowGlow)" />
      <circle cx={ax} cy={ay} r="5.5" fill={color} filter="url(#arrowGlow)" />
      {/* Center */}
      <circle cx={cx} cy={cy} r="4" fill="#0f0f28" stroke={color} strokeWidth="2" />
    </svg>
  )
}

// ── UV Curve (sunrise–sunset only) ───────────────────────────────────────────
function UVCurve({ hourlyUV }) {
  if (!hourlyUV?.length) return null

  // Crop to daylight: find first/last hour where UV > 0.3
  const indices = hourlyUV.map((v, i) => v > 0.3 ? i : -1).filter(i => i >= 0)
  if (!indices.length) return null
  const startH = Math.max(0, indices[0] - 1)
  const endH   = Math.min(23, indices[indices.length - 1] + 1)
  const slice  = hourlyUV.slice(startH, endH + 1)

  const W = 400, H = 84
  const pad = { l: 6, r: 6, t: 10, b: 22 }
  const cW  = W - pad.l - pad.r
  const cH  = H - pad.t - pad.b
  const maxV = Math.max(...slice, 1)
  const now  = new Date()
  const curH = now.getHours() + now.getMinutes() / 60

  const pts = slice.map((v, i) => ({
    x: pad.l + (i / (slice.length - 1)) * cW,
    y: pad.t + cH - (v / (maxV * 1.1)) * cH,
    v,
  }))

  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2
    d += ` C ${mx} ${pts[i-1].y}, ${mx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`
  }

  // Current-time x within the cropped window
  const curFrac = (curH - startH) / (endH - startH)
  const nowX    = curFrac >= 0 && curFrac <= 1 ? pad.l + curFrac * cW : null

  // Hour labels at window edges + midpoint
  const labelHours = [startH, Math.round((startH + endH) / 2), endH]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 84, marginTop: 10 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="uvG2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </linearGradient>
        <filter id="uvLn" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={`${d} L ${pts[pts.length-1].x} ${H-pad.b} L ${pts[0].x} ${H-pad.b} Z`} fill="url(#uvG2)" />
      <path d={d} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" filter="url(#uvLn)" />
      {pts.map((p, i) => p.v > 0 && <circle key={i} cx={p.x} cy={p.y} r="2.5" fill={
        p.v <= 2 ? '#22c55e' : p.v <= 5 ? '#84cc16' : p.v <= 7 ? '#f59e0b' : p.v <= 10 ? '#ef4444' : '#a855f7'
      } />)}
      {nowX && <line x1={nowX} y1={pad.t} x2={nowX} y2={H-pad.b} stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.8" />}
      {labelHours.map((h, i) => {
        const x = i === 0 ? pad.l : i === 2 ? W - pad.r : W / 2
        const label = h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`
        return <text key={h} x={x} y={H - 2} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fontSize="11" fontWeight="600" fill="#7a8faf" fontFamily="-apple-system,sans-serif">{label}</text>
      })}
    </svg>
  )
}

// ── Tide Curve ────────────────────────────────────────────────────────────────
function TideCurve({ timeline, extremes }) {
  if (!timeline || timeline.length < 2) return null
  const W = 800, H = 110
  const pad = { l: 8, r: 8, t: 12, b: 20 }
  const cW  = W - pad.l - pad.r
  const cH  = H - pad.t - pad.b
  const lvls  = timeline.map(t => t.level).filter(l => !isNaN(l))
  const minL  = Math.min(...lvls), maxL = Math.max(...lvls)
  const range = maxL - minL || 1
  const toX   = i => pad.l + (i / (timeline.length - 1)) * cW
  const toY   = l => pad.t + cH - ((l - minL) / range) * cH
  const pts   = timeline.map((t, i) => ({ x: toX(i), y: isNaN(t.level) ? toY(0) : toY(t.level) }))
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) {
    const mx = (pts[i-1].x + pts[i].x) / 2
    d += ` C ${mx} ${pts[i-1].y}, ${mx} ${pts[i].y}, ${pts[i].x} ${pts[i].y}`
  }
  const now      = new Date()
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
  const totalMs  = 24 * 3600 * 1000
  const nowX     = pad.l + ((now - dayStart) / totalMs) * cW
  const exPts    = (extremes || []).map(e => {
    const x = pad.l + ((new Date(e.time) - dayStart) / totalMs) * cW
    const y = isNaN(e.level) ? toY(0) : toY(e.level)
    return { x, y, high: e.high, time: e.time, level: e.level }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 110, marginTop: 12 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="tG2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06d6c7" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#06d6c7" stopOpacity="0" />
        </linearGradient>
        <filter id="tLn" x="-5%" y="-20%" width="110%" height="140%">
          <feGaussianBlur stdDeviation="1.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <path d={`${d} L ${pts[pts.length-1].x} ${H-pad.b} L ${pts[0].x} ${H-pad.b} Z`} fill="url(#tG2)" />
      <path d={d} fill="none" stroke="#06d6c7" strokeWidth="2" strokeLinecap="round" filter="url(#tLn)" />
      {exPts.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="4.5" fill={p.high ? '#06d6c7' : '#818cf8'} stroke="#08081a" strokeWidth="1.5" />)}
      <line x1={nowX} y1={pad.t} x2={nowX} y2={H-pad.b} stroke="#8b5cf6" strokeWidth="1.5" strokeDasharray="4 3" opacity="0.8" />
      {[0, 6, 12, 18, 23].map(h => (
        <text key={h} x={pad.l + (h / 23) * cW} y={H - 4} textAnchor="middle" fontSize="9" fill="#4a5a7a" fontFamily="-apple-system,sans-serif">
          {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`}
        </text>
      ))}
    </svg>
  )
}

// ── Wave Height Visualizer ────────────────────────────────────────────────────
function WaveViz({ height }) {
  const W = 130, H = 140
  const ground  = H - 6
  const HUMAN_M = 1.8
  const scale   = 70 / HUMAN_M        // human = 70 px tall
  const humanPx = 70
  const wavePx  = Math.min(height * scale, ground - 4)

  // Human geometry
  const hx       = 36
  const headR    = 6
  const headCy   = ground - humanPx + headR   // center of head circle
  const shouldY  = headCy + headR + 3
  const shouldW  = 9
  const armBotY  = shouldY + 17
  const torsoBot = shouldY + 25
  const hipW     = 7
  const kneeY    = torsoBot + 18
  const footY    = ground

  // Bar
  const barX    = 78
  const barW    = 24
  const barTop  = ground - wavePx
  const barColor = height < 0.6 ? '#22c55e'
                 : height < 1.2 ? '#84cc16'
                 : height < 2.0 ? '#f59e0b'
                 : height < 3.0 ? '#ef4444' : '#a855f7'

  // Reference line at exact head-top height
  const refY = ground - humanPx
  const c = '#4a5a82'   // human stroke color

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}
      style={{ display: 'block', marginTop: 12 }} preserveAspectRatio="xMidYMax meet">
      <defs>
        <linearGradient id="wvG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={barColor} stopOpacity="0.9" />
          <stop offset="100%" stopColor={barColor} stopOpacity="0.2" />
        </linearGradient>
        <filter id="wvGlow" x="-40%" y="-15%" width="180%" height="130%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Ground line */}
      <line x1="6" y1={ground} x2={W - 6} y2={ground} stroke="#2a3a5a" strokeWidth="1" />

      {/* Head-height reference dashed line */}
      <line x1={hx - 22} y1={refY} x2={barX + barW + 2} y2={refY}
        stroke="#2a3a5a" strokeWidth="0.8" strokeDasharray="3 3" />
      <text x={barX + barW + 5} y={refY + 3.5} fontSize="7" fill="#4a5a7a"
        fontFamily="-apple-system,sans-serif">1.8m</text>

      {/* Human outline */}
      <circle cx={hx} cy={headCy} r={headR} fill="none" stroke={c} strokeWidth="1.5" />
      <line x1={hx}          y1={headCy + headR} x2={hx}              y2={shouldY}   stroke={c} strokeWidth="1.5" />
      <line x1={hx-shouldW}  y1={shouldY}        x2={hx+shouldW}      y2={shouldY}   stroke={c} strokeWidth="1.5" />
      <line x1={hx-shouldW}  y1={shouldY}        x2={hx-shouldW - 2}  y2={armBotY}   stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={hx+shouldW}  y1={shouldY}        x2={hx+shouldW + 2}  y2={armBotY}   stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={hx}          y1={shouldY}        x2={hx}              y2={torsoBot}  stroke={c} strokeWidth="1.5" />
      <line x1={hx-hipW}     y1={torsoBot}       x2={hx+hipW}         y2={torsoBot}  stroke={c} strokeWidth="1.5" />
      <line x1={hx-hipW+2}   y1={torsoBot}       x2={hx-hipW}         y2={kneeY}     stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={hx-hipW}     y1={kneeY}          x2={hx-hipW+2}       y2={footY}     stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={hx+hipW-2}   y1={torsoBot}       x2={hx+hipW}         y2={kneeY}     stroke={c} strokeWidth="1.5" strokeLinecap="round" />
      <line x1={hx+hipW}     y1={kneeY}          x2={hx+hipW-2}       y2={footY}     stroke={c} strokeWidth="1.5" strokeLinecap="round" />

      {/* Wave bar */}
      {wavePx > 2 && <>
        <rect x={barX} y={barTop} width={barW} height={wavePx}
          rx="5" fill="url(#wvG)" filter="url(#wvGlow)" />
        <rect x={barX} y={barTop} width={barW} height={wavePx}
          rx="5" fill="none" stroke={barColor} strokeWidth="0.8" opacity="0.5" />
        {wavePx > 18 && (
          <text x={barX + barW / 2} y={barTop + 11} textAnchor="middle"
            fontSize="8" fontWeight="700" fill="#fff" opacity="0.85"
            fontFamily="-apple-system,sans-serif">{height.toFixed(1)}m</text>
        )}
      </>}
    </svg>
  )
}

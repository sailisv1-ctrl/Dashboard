import { useState, useEffect } from 'react'
import './SurfTracker.css'

const LAT = -8.8291
const LNG = 115.0849
const STORMGLASS_KEY = 'b5f3656c-5960-11f1-88c4-0242ac120004-b5f365c6-5960-11f1-88c4-0242ac120004'

function windDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function weatherLabel(code) {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly Cloudy'
  if (code <= 45) return 'Overcast'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code >= 95) return 'Thunderstorm'
  return 'Cloudy'
}

// Uluwatu faces WSW — offshore winds blow FROM the SE/E (90–170°)
function windScore(speed, direction) {
  let dirScore
  if (direction >= 100 && direction <= 160) dirScore = 10      // perfect SE offshore
  else if (direction >= 70 && direction < 100) dirScore = 8    // E offshore
  else if (direction > 160 && direction <= 185) dirScore = 6   // SSE, slight cross
  else if (direction >= 45 && direction < 70) dirScore = 5     // NE, cross-offshore
  else if (direction > 185 && direction <= 220) dirScore = 3   // S/SSW turning onshore
  else if (direction > 220 && direction <= 280) dirScore = 1   // SW/W fully onshore
  else dirScore = 4                                             // N/NW cross-shore

  let speedScore
  if (speed <= 10) speedScore = 10
  else if (speed <= 20) speedScore = 8
  else if (speed <= 30) speedScore = 5
  else if (speed <= 40) speedScore = 3
  else speedScore = 1

  return Math.round(dirScore * 0.6 + speedScore * 0.4)
}

// Low-to-mid tide is best for Uluwatu's Racetrack
function tideScore(tides) {
  if (!tides || tides.length === 0) return 5
  const next = tides[0]
  // If the next extreme is HIGH → we're currently at LOW (best)
  // If the next extreme is LOW → we're currently at HIGH (moderate)
  if (next.type === 'high') return 9
  return 5
}

function weatherScore(code, precipitation) {
  if (precipitation > 5) return 2
  if (precipitation > 1) return 4
  if (code === 0) return 10        // clear sky
  if (code <= 2) return 8          // partly cloudy
  if (code <= 45) return 6         // overcast/fog
  if (code <= 67) return 3         // rain
  if (code >= 95) return 1         // thunderstorm
  return 5
}

// Ideal at Uluwatu: 1.2–2.5m (head high to double overhead), SW swell, long period
function waveScore(height, period) {
  let hScore
  if (height < 0.3) hScore = 1
  else if (height < 0.7) hScore = 3
  else if (height < 1.2) hScore = 6
  else if (height < 2.0) hScore = 9
  else if (height < 3.0) hScore = 8
  else if (height < 4.5) hScore = 5
  else hScore = 2

  // longer swell period = cleaner, more powerful waves
  const periodBonus = period >= 16 ? 1.5 : period >= 12 ? 1 : period >= 8 ? 0.5 : 0
  return Math.min(10, Math.round(hScore + periodBonus))
}

function waveSize(height) {
  if (height < 0.3) return 'Flat'
  if (height < 0.6) return 'Knee high'
  if (height < 0.9) return 'Waist high'
  if (height < 1.2) return 'Shoulder high'
  if (height < 1.8) return 'Head high'
  if (height < 2.5) return 'Overhead'
  if (height < 3.5) return 'Double overhead'
  return 'XXL'
}

function overallScore(wScore, waveScoreVal, tScore, wxScore) {
  return Math.min(10, Math.max(1, Math.round(
    wScore * 0.40 + waveScoreVal * 0.25 + tScore * 0.20 + wxScore * 0.15
  )))
}

function scoreColor(score) {
  if (score >= 8) return '#22c55e'
  if (score >= 6) return '#84cc16'
  if (score >= 4) return '#f59e0b'
  return '#ef4444'
}

function scoreLabel(score) {
  if (score >= 9) return 'Excellent'
  if (score >= 7) return 'Good'
  if (score >= 5) return 'Fair'
  if (score >= 3) return 'Poor'
  return 'Terrible'
}

function uvInfo(index) {
  if (index <= 2) return { label: 'Low', color: '#22c55e', advice: 'No protection needed' }
  if (index <= 5) return { label: 'Moderate', color: '#84cc16', advice: 'Wear SPF 30+' }
  if (index <= 7) return { label: 'High', color: '#f59e0b', advice: 'SPF 50+, seek shade at midday' }
  if (index <= 10) return { label: 'Very High', color: '#ef4444', advice: 'SPF 50+, rash vest, limit midday exposure' }
  return { label: 'Extreme', color: '#a855f7', advice: 'SPF 50+, full rash vest, avoid 10am–2pm' }
}

export default function SurfTracker() {
  const [tides, setTides] = useState(null)
  const [weather, setWeather] = useState(null)
  const [waves, setWaves] = useState(null)
  const [error, setError] = useState(null)
  const [lastUpdated, setLastUpdated] = useState(null)

  async function fetchTides() {
    const now = new Date()
    const end = new Date()
    end.setHours(23, 59, 59)
    const url = `https://api.stormglass.io/v2/tide/extremes/point?lat=${LAT}&lng=${LNG}&start=${now.toISOString()}&end=${end.toISOString()}`
    const res = await fetch(url, { headers: { Authorization: STORMGLASS_KEY } })
    if (!res.ok) throw new Error(`Tide API error: ${res.status}`)
    const data = await res.json()
    return data.data
  }

  async function fetchWeatherAndWind() {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LNG}` +
      `&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=uv_index_max&wind_speed_unit=kmh&timezone=Asia%2FMakassar`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`)
    return res.json()
  }

  async function fetchWaves() {
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${LAT}&longitude=${LNG}` +
      `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period` +
      `&timezone=Asia%2FMakassar`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Marine API error: ${res.status}`)
    return res.json()
  }

  async function loadData() {
    try {
      const [tideData, weatherData, waveData] = await Promise.all([
        fetchTides(), fetchWeatherAndWind(), fetchWaves()
      ])
      setTides(tideData)
      setWeather(weatherData)
      setWaves(waveData)
      setLastUpdated(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const current = weather?.current
  const currentWave = waves?.current
  const nextTides = tides?.slice(0, 4) || []
  const uvIndex = weather?.daily?.uv_index_max?.[0]

  const wScore = current ? windScore(current.wind_speed_10m, current.wind_direction_10m) : null
  const tScore = tides ? tideScore(tides) : null
  const wxScore = current ? weatherScore(current.weather_code, current.precipitation) : null
  const wvScore = currentWave
    ? waveScore(currentWave.wave_height, currentWave.swell_wave_period ?? currentWave.wave_period)
    : null
  const surfScore = wScore !== null && tScore !== null && wxScore !== null && wvScore !== null
    ? overallScore(wScore, wvScore, tScore, wxScore)
    : null

  const uv = uvIndex != null ? uvInfo(uvIndex) : null

  return (
    <div className="surf-tracker">
      <div className="surf-header">
        <h1>Surf Tracker</h1>
        <span className="location">Uluwatu, Bali</span>
        {lastUpdated && (
          <span className="updated">Updated {lastUpdated.toLocaleTimeString()}</span>
        )}
      </div>

      {error && <div className="error">{error}</div>}
      {!current && !error && <div className="loading">Loading surf data...</div>}

      {surfScore !== null && (
        <div className="score-banner" style={{ borderColor: scoreColor(surfScore) }}>
          <div className="score-left">
            <div className="score-number" style={{ color: scoreColor(surfScore) }}>
              {surfScore}
              <span className="score-denom">/10</span>
            </div>
            <div className="score-label" style={{ color: scoreColor(surfScore) }}>
              {scoreLabel(surfScore)}
            </div>
          </div>
          <div className="score-breakdown">
            <div className="score-row">
              <span>Waves</span>
              <ScoreBar value={wvScore ?? 0} />
            </div>
            <div className="score-row">
              <span>Wind</span>
              <ScoreBar value={wScore} />
            </div>
            <div className="score-row">
              <span>Tide</span>
              <ScoreBar value={tScore} />
            </div>
            <div className="score-row">
              <span>Weather</span>
              <ScoreBar value={wxScore} />
            </div>
          </div>
          <div className="score-note">
            {windDirection(current.wind_direction_10m)} winds at {current.wind_speed_10m} km/h —&nbsp;
            {current.wind_direction_10m >= 100 && current.wind_direction_10m <= 160
              ? 'offshore ✓'
              : current.wind_direction_10m > 220 && current.wind_direction_10m <= 280
              ? 'onshore ✗'
              : 'cross-shore ~'}
          </div>
        </div>
      )}

      {current && (
        <div className="metrics-grid">
          <div className="metric-card weather">
            <h2>Weather</h2>
            <div className="metric-value">{current.temperature_2m}°C</div>
            <div className="metric-condition">{weatherLabel(current.weather_code)}</div>
            <div className="metric-detail">Precipitation: {current.precipitation} mm</div>
          </div>

          <div className="metric-card wind">
            <h2>Wind</h2>
            <div className="metric-value">{current.wind_speed_10m} km/h</div>
            <div className="metric-detail">
              {windDirection(current.wind_direction_10m)} ({current.wind_direction_10m}°)
            </div>
          </div>

          {currentWave && (
            <div className="metric-card waves">
              <h2>Waves</h2>
              <div className="metric-value">{currentWave.wave_height?.toFixed(1)} m</div>
              <div className="wave-size-label">{waveSize(currentWave.wave_height)}</div>
              <div className="metric-detail">
                Period: {currentWave.swell_wave_period?.toFixed(0) ?? currentWave.wave_period?.toFixed(0)}s
                &nbsp;·&nbsp;
                {windDirection(currentWave.swell_wave_direction ?? currentWave.wave_direction)} swell
              </div>
            </div>
          )}

          <div className="metric-card tides">
            <h2>Tides</h2>
            {nextTides.length === 0 && <div className="metric-detail">Loading...</div>}
            {nextTides.map((tide, i) => (
              <div key={i} className="tide-row">
                <span className={`tide-type ${tide.type.toLowerCase()}`}>
                  {tide.type === 'high' ? '▲ High' : '▼ Low'}
                </span>
                <span className="tide-time">{formatTime(tide.time)}</span>
                <span className="tide-height">{tide.height?.toFixed(2)} m</span>
              </div>
            ))}
          </div>

          {uv && (
            <div className="metric-card uv">
              <h2>UV Index</h2>
              <div className="metric-value" style={{ color: uv.color }}>{uvIndex}</div>
              <div className="uv-label" style={{ color: uv.color }}>{uv.label}</div>
              <div className="metric-detail">{uv.advice}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScoreBar({ value }) {
  return (
    <div className="score-bar-wrap">
      <div className="score-bar-fill" style={{
        width: `${value * 10}%`,
        background: scoreColor(value),
      }} />
      <span className="score-bar-num">{value}</span>
    </div>
  )
}

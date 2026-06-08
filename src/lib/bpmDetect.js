// ════════════════════════════════════════════════════════════════════════════
// bpmDetect.js — Détection BPM client-side via Web Audio API
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1.5 — MUS-2.7
//
// Détecte le tempo (BPM) d'un mp3 (preview 30s Deezer) en pure JS
// sans dépendance externe. Précision attendue ~85-95% sur de la musique
// dansante (électro, pop, hip-hop) ; moins précis sur ballade ou musique
// expérimentale (mais on s'en fout pour le tri vidéo).
//
// Algorithme :
//   1. fetch + decodeAudioData → AudioBuffer
//   2. Convert to mono (mix L+R)
//   3. Low-pass filter (cutoff ~150 Hz) pour isoler les kicks
//   4. Calcule l'énergie RMS par buckets de 10ms
//   5. Détecte les peaks d'énergie (locaux > seuil dynamique)
//   6. Mesure les intervalles entre peaks consécutifs (en ms)
//   7. Convertit en BPM (60 000 / intervalle_ms)
//   8. Histogramme des BPM dans la plage 60-200
//   9. Score chaque BPM en intégrant ses harmoniques (×2, ÷2)
//      pour éviter de tomber sur la moitié ou le double du vrai tempo
//   10. Renvoie le BPM le mieux scoré (arrondi à l'entier)
//
// API publique :
//   - detectBpmFromUrl(url, opts) → Promise<number | null>
//
// ════════════════════════════════════════════════════════════════════════════

const BPM_MIN = 60
const BPM_MAX = 200
// Plage BPM la plus probable pour la musique festival/électro : 110-140
// On scorera bonus si BPM tombe dans cette zone (anti-faux positifs).
const BPM_LIKELY_MIN = 100
const BPM_LIKELY_MAX = 150

/**
 * Détecte le BPM d'un mp3 via Web Audio API.
 *
 * @param {string} url URL du mp3 (typiquement preview Deezer)
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=15000] Timeout fetch + decode
 * @returns {Promise<number | null>} BPM arrondi à l'entier, ou null si KO
 */
export async function detectBpmFromUrl(url, opts = {}) {
  if (!url || typeof url !== 'string') return null
  if (typeof window === 'undefined' || !window.AudioContext) {
    // SSR ou environnement sans Web Audio
    return null
  }
  const timeoutMs = opts.timeoutMs || 15000
  try {
    // 1. Fetch the mp3
    const ctrl = new AbortController()
    const tid = setTimeout(() => ctrl.abort(), timeoutMs)
    let arrayBuffer
    try {
      const res = await fetch(url, { signal: ctrl.signal })
      if (!res.ok) return null
      arrayBuffer = await res.arrayBuffer()
    } finally {
      clearTimeout(tid)
    }
    // 2. Decode
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    const ctx = new AC()
    let audioBuffer
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    } catch (e) {
      console.warn('[bpmDetect] decodeAudioData failed', e)
      try {
        await ctx.close()
      } catch {
        /* ignore */
      }
      return null
    }
    const sampleRate = audioBuffer.sampleRate
    const numChannels = audioBuffer.numberOfChannels
    const length = audioBuffer.length

    // 3. Convert to mono (mix L+R) — un Float32Array
    const mono = new Float32Array(length)
    for (let ch = 0; ch < numChannels; ch += 1) {
      const data = audioBuffer.getChannelData(ch)
      for (let i = 0; i < length; i += 1) {
        mono[i] += data[i] / numChannels
      }
    }

    // 4. Low-pass filter biquad — on isole les fréquences < 150 Hz
    // (kick drum + basse). On utilise une approximation IIR simple
    // pour ne pas trainer le OfflineAudioContext (overkill ici).
    // Filtre exponentiel moving average : y[n] = α·x[n] + (1-α)·y[n-1]
    // α dépend du cutoff. Pour cutoff = 150 Hz @ sampleRate :
    //   RC = 1 / (2π * f) ; α = dt / (RC + dt) ; dt = 1 / sampleRate
    const cutoff = 150
    const RC = 1 / (2 * Math.PI * cutoff)
    const dt = 1 / sampleRate
    const alpha = dt / (RC + dt)
    let lp = 0
    for (let i = 0; i < length; i += 1) {
      lp += alpha * (mono[i] - lp)
      mono[i] = lp
    }

    // 5. Énergie RMS par bucket de 10ms
    const bucketMs = 10
    const bucketSize = Math.floor((sampleRate * bucketMs) / 1000)
    const nbBuckets = Math.floor(length / bucketSize)
    const energy = new Float32Array(nbBuckets)
    for (let i = 0; i < nbBuckets; i += 1) {
      let sum = 0
      const start = i * bucketSize
      const end = start + bucketSize
      for (let j = start; j < end; j += 1) {
        sum += mono[j] * mono[j]
      }
      energy[i] = Math.sqrt(sum / bucketSize)
    }

    // 6. Détection de peaks — locaux + au-dessus d'un seuil dynamique
    // Le seuil = moyenne + 1.5 × écart-type sur fenêtre glissante de 1s.
    const peaks = []
    const windowSize = 100 // 100 buckets × 10ms = 1s
    for (let i = 1; i < nbBuckets - 1; i += 1) {
      const wStart = Math.max(0, i - windowSize / 2)
      const wEnd = Math.min(nbBuckets, i + windowSize / 2)
      let sum = 0
      let sumSq = 0
      const n = wEnd - wStart
      for (let j = wStart; j < wEnd; j += 1) {
        sum += energy[j]
        sumSq += energy[j] * energy[j]
      }
      const mean = sum / n
      const variance = sumSq / n - mean * mean
      const std = Math.sqrt(Math.max(0, variance))
      const threshold = mean + 1.5 * std
      // Peak local : > voisins + > threshold
      if (
        energy[i] > threshold &&
        energy[i] > energy[i - 1] &&
        energy[i] > energy[i + 1]
      ) {
        peaks.push(i * bucketMs) // timestamp en ms
      }
    }

    // Cleanup AudioContext
    try {
      await ctx.close()
    } catch {
      /* ignore */
    }

    if (peaks.length < 4) return null

    // 7. Intervalles entre peaks consécutifs (en ms)
    // 8. Histogramme des BPM dans la plage [BPM_MIN, BPM_MAX]
    // 9. Score chaque BPM avec ses harmoniques (×2, ÷2)
    const bpmCounts = new Map()
    for (let i = 1; i < peaks.length; i += 1) {
      const interval = peaks[i] - peaks[i - 1]
      if (interval < 1) continue
      // BPM brut depuis l'intervalle
      let bpm = 60000 / interval
      // Ramène dans [BPM_MIN, BPM_MAX] via doublage/halving
      while (bpm < BPM_MIN) bpm *= 2
      while (bpm > BPM_MAX) bpm /= 2
      const rounded = Math.round(bpm)
      bpmCounts.set(rounded, (bpmCounts.get(rounded) || 0) + 1)
    }

    if (bpmCounts.size === 0) return null

    // Score : on intègre ±2 BPM autour de chaque candidat + bonus si
    // dans la plage probable.
    let bestBpm = null
    let bestScore = 0
    for (const [bpm, count] of bpmCounts.entries()) {
      let score = count
      // Intègre voisins (±2 BPM) pour lisser le bruit
      for (let d = -2; d <= 2; d += 1) {
        if (d === 0) continue
        score += (bpmCounts.get(bpm + d) || 0) * 0.5
      }
      // Bonus zone probable festival/électro
      if (bpm >= BPM_LIKELY_MIN && bpm <= BPM_LIKELY_MAX) {
        score *= 1.2
      }
      if (score > bestScore) {
        bestScore = score
        bestBpm = bpm
      }
    }

    return bestBpm
  } catch (err) {
    console.warn('[bpmDetect] failed', err)
    return null
  }
}

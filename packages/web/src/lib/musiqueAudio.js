// ════════════════════════════════════════════════════════════════════════════
// musiqueAudio — fichier de travail d'une proposition (socle du berceau)
// ════════════════════════════════════════════════════════════════════════════
//
// Aucune API ne donne le morceau complet en fichier : Spotify et YouTube ne
// servent qu'un flux chiffré, dont le code ne peut rien extraire. Pour
// couper, dessiner une forme d'onde et enchaîner deux morceaux avec un fondu
// croisé, il faut le fichier. On le dépose donc à la main.
//
// Ce fichier est une copie de TRAVAIL, distincte du master des autorisations.
//
// Voir supabase/migrations/20260824a_musique_audio.sql.
// ════════════════════════════════════════════════════════════════════════════

import { supabase } from './supabase'

export const AUDIO_BUCKET = 'projet-musique-audio'
export const AUDIO_ACCEPT = '.mp3,.m4a,.aac,.wav,.ogg,audio/*'
// Un MP3 de qualité correcte dépasse rarement 20 Mo ; au-delà c'est un WAV
// qu'on n'a aucune raison de manipuler pour maquetter.
export const AUDIO_MAX_BYTES = 25 * 1024 * 1024
// Assez de points pour lire la dynamique d'un morceau, assez peu pour tenir
// dans une colonne jsonb sans peser (≈ 2 Ko).
export const PEAKS_RESOLUTION = 800

/* ─── Helpers purs ──────────────────────────────────────────────────────── */

/** Normalise un texte pour comparer un nom de fichier à un titre. */
export function normalizeForMatch(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.[a-z0-9]{2,4}$/, '') // extension
    .replace(/^\d+[\s.\-_]+/, '') // numéro de piste en tête
    .replace(/\((?:official|audio|video|clip|hd|hq|lyrics?)[^)]*\)/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Apparie un nom de fichier à une proposition. Un dépôt groupé de cent
 * morceaux ne peut pas se rattacher à la main : on reconnaît « Artiste -
 * Titre.mp3 », mais aussi un titre seul, et on refuse dès que deux
 * propositions sont également plausibles — mieux vaut demander que se
 * tromper de morceau.
 *
 * @returns {{ proposition: object|null, ambigu: boolean }}
 */
export function matchFileToProposition(filename, propositions = []) {
  const needle = normalizeForMatch(filename)
  if (!needle) return { proposition: null, ambigu: false }

  const scored = []
  for (const p of propositions) {
    const titre = normalizeForMatch(p.titre)
    const artiste = normalizeForMatch(p.artiste_text || p.artiste?.nom || '')
    if (!titre) continue

    let score = 0
    // Le nom contient le titre : condition nécessaire.
    if (needle.includes(titre)) {
      score = titre.length
      // …et l'artiste : quasi certain.
      if (artiste && needle.includes(artiste)) score += artiste.length + 100
    }
    if (score > 0) scored.push({ p, score })
  }

  if (scored.length === 0) return { proposition: null, ambigu: false }
  scored.sort((a, b) => b.score - a.score)
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    return { proposition: null, ambigu: true }
  }
  return { proposition: scored[0].p, ambigu: false }
}

/**
 * Réduit un signal décodé en `resolution` amplitudes 0-255. On garde le pic
 * absolu de chaque tranche : une moyenne écraserait la dynamique et
 * donnerait une forme d'onde plate, inutile pour repérer un drop.
 */
export function buildPeaks(channelData, resolution = PEAKS_RESOLUTION) {
  const total = channelData?.length || 0
  if (!total) return []
  const bucket = Math.max(1, Math.floor(total / resolution))
  const peaks = []
  for (let i = 0; i < resolution; i += 1) {
    const start = i * bucket
    if (start >= total) break
    const end = Math.min(total, start + bucket)
    let max = 0
    for (let j = start; j < end; j += 1) {
      const v = Math.abs(channelData[j])
      if (v > max) max = v
    }
    peaks.push(Math.min(255, Math.round(max * 255)))
  }
  return peaks
}

/**
 * Portion de forme d'onde correspondant à une coupe. Les pics couvrent le
 * morceau entier ; un bloc n'en montre que sa tranche, sinon on afficherait
 * la même vignette pour deux coupes très différentes.
 */
export function slicePeaks(peaks, inMs, outMs, dureeMs) {
  if (!Array.isArray(peaks) || peaks.length === 0 || !dureeMs) return []
  const debut = Math.max(0, Math.floor((inMs / dureeMs) * peaks.length))
  const fin = Math.min(peaks.length, Math.ceil((outMs / dureeMs) * peaks.length))
  if (fin <= debut) return []
  return peaks.slice(debut, fin)
}

/** Format court d'une durée en millisecondes : « 3:07 ». */
export function formatMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00'
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ─── Décodage ──────────────────────────────────────────────────────────── */

/**
 * Décode le fichier pour en tirer sa durée réelle et sa forme d'onde. Le
 * buffer est relâché aussitôt : décoder dix morceaux d'affilée sans le faire
 * saturerait la mémoire (une minute de PCM pèse ~20 Mo).
 */
export async function analyseAudioFile(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext
  if (!AudioCtx) return { duree_ms: null, peaks: [] }
  const ctx = new AudioCtx()
  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer())
    return {
      duree_ms: Math.round(buffer.duration * 1000),
      peaks: buildPeaks(buffer.getChannelData(0)),
    }
  } catch (err) {
    // Format exotique ou fichier corrompu : on dépose quand même, sans
    // forme d'onde. Mieux vaut un morceau lisible sans vignette que rien.
    console.warn('[musiqueAudio] décodage', err)
    return { duree_ms: null, peaks: [] }
  } finally {
    ctx.close?.()
  }
}

/* ─── Storage ───────────────────────────────────────────────────────────── */

function extOf(name) {
  const m = /\.([a-z0-9]{2,4})$/i.exec(name || '')
  return m ? m[1].toLowerCase() : 'mp3'
}

export async function uploadPropositionAudio({ projectId, proposition, file, userId = null }) {
  if (!projectId || !proposition?.id) throw new Error('projet et proposition requis')
  if (file.size > AUDIO_MAX_BYTES) {
    throw new Error(
      `${file.name} : ${Math.round(file.size / 1024 / 1024)} Mo, au-delà de la limite de ${Math.round(AUDIO_MAX_BYTES / 1024 / 1024)} Mo`,
    )
  }

  const analyse = await analyseAudioFile(file)
  const path = `${projectId}/${proposition.id}-${Date.now()}.${extOf(file.name)}`

  const { error: upErr } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: false })
  if (upErr) throw upErr

  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .update({
      audio_path: path,
      audio_filename: file.name,
      audio_mime: file.type || null,
      audio_size_bytes: file.size,
      audio_duree_ms: analyse.duree_ms,
      audio_peaks: analyse.peaks.length ? analyse.peaks : null,
      audio_uploaded_at: new Date().toISOString(),
      audio_uploaded_by: userId,
    })
    .eq('id', proposition.id)
    .select('*')
    .single()
  if (error) {
    // La ligne n'a pas suivi : on ne laisse pas un fichier orphelin.
    await supabase.storage.from(AUDIO_BUCKET).remove([path])
    throw error
  }

  // Remplacement : l'ancien fichier n'a plus de référence.
  if (proposition.audio_path && proposition.audio_path !== path) {
    await supabase.storage.from(AUDIO_BUCKET).remove([proposition.audio_path])
  }
  return data
}

export async function deletePropositionAudio(proposition) {
  if (!proposition?.id) return null
  const { data, error } = await supabase
    .from('projet_musique_propositions')
    .update({
      audio_path: null,
      audio_filename: null,
      audio_mime: null,
      audio_size_bytes: null,
      audio_duree_ms: null,
      audio_peaks: null,
      audio_uploaded_at: null,
      audio_uploaded_by: null,
    })
    .eq('id', proposition.id)
    .select('*')
    .single()
  if (error) throw error
  if (proposition.audio_path) {
    await supabase.storage.from(AUDIO_BUCKET).remove([proposition.audio_path])
  }
  return data
}

/** URL signée (1 h) — le bucket est privé, ce sont des fichiers sous droits. */
export async function getPropositionAudioUrl(proposition) {
  if (!proposition?.audio_path) return null
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(proposition.audio_path, 3600)
  if (error) throw error
  return data.signedUrl
}

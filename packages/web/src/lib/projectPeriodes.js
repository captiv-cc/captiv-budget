// ════════════════════════════════════════════════════════════════════════════
// projectPeriodes.js — modèle structuré des périodes clés d'un projet (PROJ-PERIODES)
// ════════════════════════════════════════════════════════════════════════════
//
// Objectif : single source of truth pour les périodes saisies dans
// ProjetTab (prépa / tournage / envoi V1 / livraison master / deadline).
//
// Format en base (jsonb) :
//   project.metadata.periodes = {
//     prepa: { ranges: [{ start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }, ...] },
//     tournage: { ranges: [...] },
//     envoi_v1: { ranges: [...] },
//     livraison_master: { ranges: [...] },
//     deadline: { ranges: [...] },
//   }
//
// `start` et `end` sont inclusifs (`end >= start`). `end === start` = un seul
// jour. Plusieurs ranges = jours non contigus (ex: tournage les 12, 14, 17).
//
// Migration soft : si `metadata.periodes` est absent, on parse au best-effort
// les anciens champs texte libre (`tournage_dates`, `prepa_dates`, …) et on
// renvoie un objet structuré équivalent. Les erreurs de parsing renvoient un
// objet vide (pas de crash, fallback graceful).
//
// Propagation :
//   - Tournage → events read-only dans le planning (cf. projectPeriodSync.js)
//   - Toutes les périodes → bande arrière-plan dans LivrablePipelineView
//   - PDF Vue ensemble → fond cellule vert sur jours de tournage
// ════════════════════════════════════════════════════════════════════════════

/** Liste ordonnée des clés de périodes structurées. */
export const PERIODE_KEYS = [
  'prepa',
  'tournage',
  'envoi_v1',
  'livraison_master',
  'deadline',
]

/** Métadonnées d'affichage par clé (label, couleur, champ legacy associé). */
export const PERIODE_META = {
  prepa: {
    label: 'Prépa',
    color: 'var(--blue)',
    bg: 'var(--blue-bg)',
    legacyDatesKey: 'prepa_dates',
    legacyJoursKey: 'prepa_jours',
  },
  tournage: {
    label: 'Tournage',
    color: 'var(--green)',
    bg: 'var(--green-bg)',
    legacyDatesKey: 'tournage_dates',
    legacyJoursKey: 'tournage_jours',
  },
  envoi_v1: {
    label: 'Envoi V1',
    color: 'var(--orange)',
    bg: 'var(--orange-bg)',
    legacyDatesKey: 'envoi_v1',
    legacyJoursKey: null,
  },
  livraison_master: {
    label: 'Livraison MASTER',
    color: 'var(--red)',
    bg: 'var(--red-bg)',
    legacyDatesKey: 'livraison_master',
    legacyJoursKey: null,
  },
  deadline: {
    label: 'Deadline',
    color: 'var(--red)',
    bg: 'var(--red-bg)',
    legacyDatesKey: 'deadline',
    legacyJoursKey: null,
  },
}

/** Forme initiale (vide) d'une période. */
export function emptyPeriode() {
  return { ranges: [] }
}

/** True si la période a au moins un range valide. */
export function hasAnyRange(periode) {
  if (!periode || !Array.isArray(periode.ranges)) return false
  return periode.ranges.some((r) => r && r.start && r.end)
}

/** Compte le nombre de jours total couvert par les ranges (inclusif). */
export function countDays(periode) {
  if (!periode || !Array.isArray(periode.ranges)) return 0
  let total = 0
  for (const r of periode.ranges) {
    if (!r?.start || !r?.end) continue
    const s = isoToDate(r.start)
    const e = isoToDate(r.end)
    if (!s || !e || e < s) continue
    total += Math.round((e - s) / (24 * 3600 * 1000)) + 1
  }
  return total
}

/**
 * Renvoie tous les jours (ISO YYYY-MM-DD) couverts par les ranges, sans
 * doublons. Utile pour peindre des cellules ou créer des events all-day.
 */
export function expandDays(periode) {
  const out = new Set()
  if (!periode || !Array.isArray(periode.ranges)) return []
  for (const r of periode.ranges) {
    if (!r?.start || !r?.end) continue
    const s = isoToDate(r.start)
    const e = isoToDate(r.end)
    if (!s || !e || e < s) continue
    for (
      let t = s.getTime();
      t <= e.getTime();
      t += 24 * 3600 * 1000
    ) {
      out.add(dateToIso(new Date(t)))
    }
  }
  return Array.from(out).sort()
}

/** Format FR d'un range : "12/05" si 1 jour, "12-14/05" si même mois,
 *  "30/05 → 02/06" sinon. */
export function formatRangeFr(range) {
  if (!range?.start || !range?.end) return ''
  const s = isoToDate(range.start)
  const e = isoToDate(range.end)
  if (!s || !e) return ''
  if (range.start === range.end) return fmtDayMonth(s)
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${String(s.getDate()).padStart(2, '0')}–${fmtDayMonth(e)}`
  }
  return `${fmtDayMonth(s)} → ${fmtDayMonth(e)}`
}

/** Format FR d'une période complète : "12-14/05 + 17/05 (4j)" */
export function formatPeriodeFr(periode) {
  if (!hasAnyRange(periode)) return ''
  const parts = (periode.ranges || [])
    .filter((r) => r?.start && r?.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
    .map(formatRangeFr)
    .filter(Boolean)
  if (parts.length === 0) return ''
  const days = countDays(periode)
  return `${parts.join(' + ')} (${days}j)`
}

// ─── Parsing best-effort des chaînes libres legacy ────────────────────────────

/**
 * Parse une chaîne libre saisie dans l'ancien input texte (champ legacy).
 * Cas gérés (best-effort) :
 *   - "12/05/2026"               → 1 range 1 jour
 *   - "12-14/05/2026"            → 1 range continu
 *   - "12/05/2026 - 14/05/2026"  → 1 range continu
 *   - "12-14-17/05/2026"         → 3 ranges 1-jour (12, 14, 17 mai)
 *   - "12, 15, 17 mai 2026"      → 3 ranges 1-jour
 *   - "30/05 → 02/06/2026"       → 1 range cross-mois
 *   - "13-14/05/2026 + 16/05"    → 2 ranges
 *
 * Tout ce qui n'est pas reconnu → pas de range, mais on garde le texte
 * dans `notes` pour permettre une migration manuelle plus tard.
 */
export function parseFreeText(text, defaultYear = null) {
  const out = emptyPeriode()
  if (!text || typeof text !== 'string') return out
  const trimmed = text.trim()
  if (!trimmed) return out

  // 1) ISO-like d'abord (YYYY-MM-DD)
  const isoSingle = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (isoSingle) {
    out.ranges.push({ start: trimmed, end: trimmed })
    return out
  }
  const isoRange = /^(\d{4}-\d{2}-\d{2})\s*[-→to→]\s*(\d{4}-\d{2}-\d{2})$/i.exec(trimmed)
  if (isoRange) {
    out.ranges.push({ start: isoRange[1], end: isoRange[2] })
    return out
  }

  // 2) Format FR : "12/05/2026", "12-14/05/2026", "12-14-17/05/2026", "13-14/05/2026 + 16/05"
  // On split sur " + " et " et " pour gérer plusieurs périodes
  const fragments = trimmed.split(/\s*(?:\+|et)\s*/i).filter(Boolean)
  let referenceMonth = null
  let referenceYear = defaultYear
  for (const frag of fragments) {
    const range = parseFrenchFragment(frag, referenceMonth, referenceYear)
    if (range) {
      out.ranges.push(range)
      // Mémorise le mois/année du fragment précédent pour le suivant
      // (ex: "13-14/05/2026 + 16/05" → 16/05/2026)
      const sd = isoToDate(range.start)
      if (sd) {
        referenceMonth = sd.getMonth() + 1
        referenceYear = sd.getFullYear()
      }
    }
  }

  return out
}

/**
 * Parse un fragment unitaire ("12/05/2026", "12-14/05/2026", "12-14-17/05/2026",
 * "16/05" — dans ce dernier cas on hérite mois/année du fragment précédent).
 */
function parseFrenchFragment(frag, referenceMonth, referenceYear) {
  const t = frag.trim()
  if (!t) return null

  // 1) Date complète "12/05/2026"
  const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t)
  if (m1) {
    const iso = mkIso(m1[1], m1[2], m1[3])
    return iso ? { start: iso, end: iso } : null
  }

  // 2) Range continu "12-14/05/2026"
  const m2 = /^(\d{1,2})-(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t)
  if (m2) {
    const start = mkIso(m2[1], m2[3], m2[4])
    const end = mkIso(m2[2], m2[3], m2[4])
    return start && end ? { start, end } : null
  }

  // 3) Liste de jours discontinus "12-14-17/05/2026" → 1er + dernier (range
  // approximatif). Pour gérer comme jours discrets, le caller doit splitter
  // au niveau supérieur. Ici on prend le premier au dernier comme range.
  const m3 = /^((?:\d{1,2}-)+\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(t)
  if (m3) {
    const days = m3[1].split('-').map(Number).filter((n) => n > 0)
    if (days.length >= 2) {
      const start = mkIso(days[0], m3[2], m3[3])
      const end = mkIso(days[days.length - 1], m3[2], m3[3])
      return start && end ? { start, end } : null
    }
  }

  // 4) Date courte "16/05" — utilise mois/année de référence
  const m4 = /^(\d{1,2})\/(\d{1,2})$/.exec(t)
  if (m4 && referenceYear) {
    const iso = mkIso(m4[1], m4[2], referenceYear)
    return iso ? { start: iso, end: iso } : null
  }

  // 5) Range court "12-14/05" — utilise année de référence
  const m5 = /^(\d{1,2})-(\d{1,2})\/(\d{1,2})$/.exec(t)
  if (m5 && referenceYear) {
    const start = mkIso(m5[1], m5[3], referenceYear)
    const end = mkIso(m5[2], m5[3], referenceYear)
    return start && end ? { start, end } : null
  }

  // 6) Jour seul "16" — hérite mois/année
  const m6 = /^(\d{1,2})$/.exec(t)
  if (m6 && referenceMonth && referenceYear) {
    const iso = mkIso(m6[1], referenceMonth, referenceYear)
    return iso ? { start: iso, end: iso } : null
  }

  return null
}

/** Construit un ISO YYYY-MM-DD à partir de jour/mois/année (numbers ou strings). */
function mkIso(d, m, y) {
  const day = parseInt(d, 10)
  const month = parseInt(m, 10)
  let year = parseInt(y, 10)
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null
  if (year < 100) year += year < 50 ? 2000 : 1900
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isoToDate(iso) {
  if (!iso || typeof iso !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10))
  return Number.isNaN(d.getTime()) ? null : d
}

function dateToIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtDayMonth(d) {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Extraction depuis project.metadata ──────────────────────────────────────

/**
 * Extrait les 5 périodes structurées depuis project.metadata.
 * Si `metadata.periodes` existe, l'utilise tel quel.
 * Sinon (legacy), parse au best-effort les chaînes libres.
 */
export function extractPeriodes(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return defaultPeriodes()
  }

  const result = defaultPeriodes()

  // Source structurée (priorité)
  if (metadata.periodes && typeof metadata.periodes === 'object') {
    for (const key of PERIODE_KEYS) {
      const p = metadata.periodes[key]
      if (p && Array.isArray(p.ranges)) {
        result[key] = { ranges: p.ranges.filter((r) => r?.start && r?.end) }
      }
    }
  }

  // Fallback : parser les chaînes legacy si la période n'est pas remplie
  for (const key of PERIODE_KEYS) {
    if (hasAnyRange(result[key])) continue
    const meta = PERIODE_META[key]
    if (!meta?.legacyDatesKey) continue
    const raw = metadata[meta.legacyDatesKey]
    if (typeof raw === 'string' && raw.trim()) {
      result[key] = parseFreeText(raw)
    }
  }

  return result
}

/** Renvoie un objet périodes vide pour toutes les clés. */
export function defaultPeriodes() {
  const out = {}
  for (const key of PERIODE_KEYS) out[key] = emptyPeriode()
  return out
}

/**
 * Sérialise les périodes structurées dans metadata, et synchronise les
 * champs legacy correspondants (jours + chaîne formatée) pour rétro-compat
 * avec le code existant qui lit `metadata.tournage_dates`, etc.
 */
export function serializePeriodesIntoMetadata(metadata, periodes) {
  const out = { ...(metadata || {}) }
  out.periodes = {}
  for (const key of PERIODE_KEYS) {
    const p = periodes?.[key]
    out.periodes[key] = {
      ranges: hasAnyRange(p) ? p.ranges : [],
    }

    // Maintien des champs legacy pour rétro-compat avec ReadView etc.
    const meta = PERIODE_META[key]
    if (meta.legacyDatesKey) {
      out[meta.legacyDatesKey] = formatPeriodeFr(p) || ''
    }
    if (meta.legacyJoursKey) {
      const days = countDays(p)
      out[meta.legacyJoursKey] = days > 0 ? `${days}j` : ''
    }
  }
  return out
}

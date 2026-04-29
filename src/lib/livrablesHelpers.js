// ════════════════════════════════════════════════════════════════════════════
// livrablesHelpers — Helpers PURS pour l'Outil Livrables (LIV-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Fichier 100 % synchrone, 0 dépendance Supabase. Tout est testable unitairement
// avec Vitest sans mock — c'est le pendant des helpers `groupItemsByBlock`,
// `computeRecapByLoueur` etc. de `materiel.js`.
//
// On y range :
//   - constantes UI (statuts, kinds, couleurs par défaut)
//   - groupBy / indexBy (versions, étapes par livrable)
//   - compteurs (total, en retard, livrés, validés)
//   - sélection du "prochain livrable" (date la plus proche, non livré)
//   - liste des monteurs distincts (assignee_profile_id + assignee_external)
//   - calcul du prochain numero auto pour un nouveau livrable
//   - normalisation/tri des livrables et blocs
//
// Convention : aucune fonction ne mute son entrée. On retourne toujours un
// nouveau tableau / Map / objet.
// ════════════════════════════════════════════════════════════════════════════

// ─── Constantes statuts & kinds ─────────────────────────────────────────────

/**
 * Statuts d'un livrable. Miroir du CHECK constraint côté DB
 * (`livrables.statut`). Ordre = ordre logique du pipeline.
 */
export const LIVRABLE_STATUTS = {
  brief:      { key: 'brief',      label: 'Brief',         color: 'var(--txt-3)',                   bg: 'var(--bg-2)' },
  en_cours:   { key: 'en_cours',   label: 'En cours',      color: 'var(--blue, #3b82f6)',           bg: 'var(--blue-bg, rgba(59,130,246,.12))' },
  a_valider:  { key: 'a_valider',  label: 'À valider',     color: 'var(--orange, #f59e0b)',         bg: 'var(--orange-bg, rgba(245,158,11,.12))' },
  valide:     { key: 'valide',     label: 'Validé',        color: 'var(--green, #22c55e)',          bg: 'var(--green-bg, rgba(34,197,94,.12))' },
  livre:      { key: 'livre',      label: 'Livré',         color: 'var(--green, #22c55e)',          bg: 'var(--green-bg, rgba(34,197,94,.12))' },
  archive:    { key: 'archive',    label: 'Archivé',       color: 'var(--txt-3)',                   bg: 'var(--bg-2)' },
}

/** Statuts considérés "terminé" (n'entrent pas dans le compteur "en retard"). */
export const LIVRABLE_STATUTS_TERMINES = new Set(['livre', 'archive'])

/** Statuts considérés "en cours / actifs" (affichés par défaut). */
export const LIVRABLE_STATUTS_ACTIFS = new Set(['brief', 'en_cours', 'a_valider', 'valide'])

/**
 * Statuts de validation d'une version envoyée au client.
 * Miroir du CHECK constraint côté DB (`livrable_versions.statut_validation`).
 */
export const LIVRABLE_VERSION_STATUTS = {
  en_attente:           { key: 'en_attente',           label: 'En attente',           color: 'var(--txt-3)',                   bg: 'var(--bg-2)' },
  retours_a_integrer:   { key: 'retours_a_integrer',   label: 'Retours à intégrer',   color: 'var(--orange, #f59e0b)',         bg: 'var(--orange-bg, rgba(245,158,11,.12))' },
  valide:               { key: 'valide',               label: 'Validé',               color: 'var(--green, #22c55e)',          bg: 'var(--green-bg, rgba(34,197,94,.12))' },
  rejete:               { key: 'rejete',               label: 'Rejeté',               color: 'var(--red, #ef4444)',            bg: 'var(--red-bg, rgba(239,68,68,.12))' },
}

/**
 * Kinds d'étapes post-prod (swimlanes Vague 2 + code couleur).
 * Miroir du CHECK constraint côté DB (`livrable_etapes.kind`).
 */
export const LIVRABLE_ETAPE_KINDS = {
  production: { key: 'production', label: 'Production', color: '#0ea5e9' }, // sky-500
  da:         { key: 'da',         label: 'DA',         color: '#a855f7' }, // purple-500
  montage:    { key: 'montage',    label: 'Montage',    color: '#22c55e' }, // green-500
  sound:      { key: 'sound',      label: 'Son',        color: '#eab308' }, // yellow-500
  delivery:   { key: 'delivery',   label: 'Livraison',  color: '#ef4444' }, // red-500
  feedback:   { key: 'feedback',   label: 'Feedback',   color: '#f59e0b' }, // amber-500
  autre:      { key: 'autre',      label: 'Autre',      color: '#94a3b8' }, // slate-400
}

/**
 * Kinds de phases projet globales.
 * Miroir du CHECK constraint côté DB (`projet_phases.kind`).
 */
export const PROJET_PHASE_KINDS = {
  prod:     { key: 'prod',     label: 'Pré-prod',  color: '#0ea5e9' },
  tournage: { key: 'tournage', label: 'Tournage',  color: '#ef4444' },
  montage:  { key: 'montage',  label: 'Montage',   color: '#22c55e' },
  delivery: { key: 'delivery', label: 'Livraison', color: '#a855f7' },
  off:      { key: 'off',      label: 'OFF',       color: '#94a3b8' },
  autre:    { key: 'autre',    label: 'Autre',     color: '#64748b' },
}

/** Couleurs proposées par défaut pour un nouveau bloc (pickers UI). */
export const LIVRABLE_BLOCK_COLOR_PRESETS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#a855f7', // purple
  '#eab308', // yellow
  '#ef4444', // red
  '#f97316', // orange
  '#ec4899', // pink
  '#64748b', // slate
]

/**
 * Ratios de format proposés en presets. Le 7e choix UI (« Autre… ») bascule
 * sur un input texte libre, ce qui couvre les cas exotiques (4096x2048,
 * letterbox custom, etc.). On stocke toujours la chaîne brute dans
 * `livrables.format`.
 */
export const LIVRABLE_FORMATS = ['16:9', '9:16', '1:1', '4:5', '5:4', '4:3']

// ─── Durée — parser / formatter ─────────────────────────────────────────────

/**
 * Parse une saisie utilisateur de durée en chaîne normalisée.
 * Règles :
 *   - vide → { ok: true, normalized: null }
 *   - 1-2 chiffres seuls           → secondes (`00:XX`)
 *   - 3 chiffres seuls (`MSS`)     → `0M:SS`        (ex `130` → `01:30`)
 *   - 4 chiffres seuls (`MMSS`)    → `MM:SS`        (ex `0130` → `01:30`)
 *   - 5 chiffres seuls (`HMMSS`)   → `H:MM:SS`
 *   - 6 chiffres seuls (`HHMMSS`)  → `HH:MM:SS`
 *   - `M:SS` / `MM:SS`             → `MM:SS`
 *   - `H:MM:SS` / `HH:MM:SS`       → `HH:MM:SS`
 * Validation : segments minutes/secondes ∈ [0..59]. Le premier segment
 * (heures, ou minutes si pas d'heures) est libre (jusqu'à 99).
 *
 * @param {string|null|undefined} raw
 * @returns {{ ok: boolean, normalized: string|null, error?: string }}
 */
export function parseDuree(raw) {
  if (raw == null) return { ok: true, normalized: null }
  const s = String(raw).trim()
  if (s === '') return { ok: true, normalized: null }

  // Saisie purement numérique (pas de `:`) → on déduit le format selon la
  // longueur, en padant à gauche si besoin.
  if (/^\d+$/.test(s)) {
    const pad2 = (n) => String(n).padStart(2, '0')
    if (s.length <= 2) {
      // 0-99 secondes → mm:ss (rejette > 59)
      const sec = parseInt(s, 10)
      if (sec > 59) return { ok: false, normalized: null, error: 'Secondes > 59' }
      return { ok: true, normalized: `00:${pad2(sec)}` }
    }
    if (s.length === 3) {
      const m = parseInt(s.slice(0, 1), 10)
      const sec = parseInt(s.slice(1), 10)
      if (sec > 59) return { ok: false, normalized: null, error: 'Secondes > 59' }
      return { ok: true, normalized: `${pad2(m)}:${pad2(sec)}` }
    }
    if (s.length === 4) {
      const m = parseInt(s.slice(0, 2), 10)
      const sec = parseInt(s.slice(2), 10)
      if (sec > 59) return { ok: false, normalized: null, error: 'Secondes > 59' }
      return { ok: true, normalized: `${pad2(m)}:${pad2(sec)}` }
    }
    if (s.length === 5) {
      const h = parseInt(s.slice(0, 1), 10)
      const m = parseInt(s.slice(1, 3), 10)
      const sec = parseInt(s.slice(3), 10)
      if (m > 59 || sec > 59) return { ok: false, normalized: null, error: 'Min/sec > 59' }
      return { ok: true, normalized: `${pad2(h)}:${pad2(m)}:${pad2(sec)}` }
    }
    if (s.length === 6) {
      const h = parseInt(s.slice(0, 2), 10)
      const m = parseInt(s.slice(2, 4), 10)
      const sec = parseInt(s.slice(4), 10)
      if (m > 59 || sec > 59) return { ok: false, normalized: null, error: 'Min/sec > 59' }
      return { ok: true, normalized: `${pad2(h)}:${pad2(m)}:${pad2(sec)}` }
    }
    return { ok: false, normalized: null, error: 'Trop de chiffres' }
  }

  // Saisie avec `:`
  const segs = s.split(':')
  if (segs.length === 2) {
    const [m, sec] = segs
    if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(sec)) {
      return { ok: false, normalized: null, error: 'Format mm:ss attendu' }
    }
    const mn = parseInt(m, 10)
    const sn = parseInt(sec, 10)
    if (sn > 59) return { ok: false, normalized: null, error: 'Secondes > 59' }
    return {
      ok: true,
      normalized: `${String(mn).padStart(2, '0')}:${String(sn).padStart(2, '0')}`,
    }
  }
  if (segs.length === 3) {
    const [h, m, sec] = segs
    if (!/^\d{1,2}$/.test(h) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(sec)) {
      return { ok: false, normalized: null, error: 'Format hh:mm:ss attendu' }
    }
    const hn = parseInt(h, 10)
    const mn = parseInt(m, 10)
    const sn = parseInt(sec, 10)
    if (mn > 59 || sn > 59) return { ok: false, normalized: null, error: 'Min/sec > 59' }
    return {
      ok: true,
      normalized: `${String(hn).padStart(2, '0')}:${String(mn).padStart(2, '0')}:${String(sn).padStart(2, '0')}`,
    }
  }
  return { ok: false, normalized: null, error: 'Format mm:ss ou hh:mm:ss' }
}

/**
 * Convertit une durée normalisée en nombre total de secondes (utile pour les
 * stats / tris). Renvoie null si vide ou invalide.
 */
export function dureeToSeconds(normalized) {
  if (!normalized) return null
  const segs = String(normalized).split(':').map((x) => parseInt(x, 10))
  if (segs.some((x) => Number.isNaN(x))) return null
  if (segs.length === 2) return segs[0] * 60 + segs[1]
  if (segs.length === 3) return segs[0] * 3600 + segs[1] * 60 + segs[2]
  return null
}

// ─── Avatar monteur — couleur déterministe ─────────────────────────────────

/**
 * Hash (djb2) ultra-simple sur une chaîne. Stable cross-run, suffisant pour
 * dériver une couleur d'avatar.
 */
function hashStr(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

/**
 * Palette de fonds d'avatar (10 teintes). Volontairement contrastée vis-à-vis
 * de `--bg-elev` en dark mode et lisible en clair (texte blanc sur fond mid).
 */
export const MONTEUR_AVATAR_COLORS = [
  '#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444',
  '#0ea5e9', '#10b981', '#ec4899', '#f97316', '#6366f1',
]

/**
 * Renvoie initiales (1-2 lettres uppercase) + couleur de fond stable pour un
 * nom de monteur (texte libre ou nom complet d'un profile).
 *
 * @param {string|null} name
 * @returns {{ initials: string, color: string } | null} - null si pas de nom
 */
export function monteurAvatar(name) {
  const trimmed = (name || '').trim()
  if (!trimmed) return null
  // Initiales : première lettre du premier et du dernier mot.
  const parts = trimmed.split(/\s+/).filter(Boolean)
  let initials = ''
  if (parts.length === 1) {
    initials = parts[0].slice(0, 2).toUpperCase()
  } else {
    initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  const color = MONTEUR_AVATAR_COLORS[hashStr(trimmed.toLowerCase()) % MONTEUR_AVATAR_COLORS.length]
  return { initials, color }
}

// ─── Tri & groupBy ──────────────────────────────────────────────────────────

/**
 * Trie des éléments par sort_order croissant (tie-break sur created_at).
 * Pure : retourne un nouveau tableau.
 */
export function sortBySortOrder(rows = []) {
  return rows.slice().sort((a, b) => {
    const sa = a?.sort_order ?? 0
    const sb = b?.sort_order ?? 0
    if (sa !== sb) return sa - sb
    const ca = a?.created_at || ''
    const cb = b?.created_at || ''
    return ca.localeCompare(cb)
  })
}

/**
 * Groupe les livrables par block_id → Map<blockId, livrable[]>.
 * Préserve l'ordre d'entrée (utile si déjà trié par sort_order).
 */
export function groupLivrablesByBlock(livrables = []) {
  const map = new Map()
  for (const l of livrables) {
    if (!l?.block_id) continue
    const arr = map.get(l.block_id) || []
    arr.push(l)
    map.set(l.block_id, arr)
  }
  return map
}

/** Indexe les versions par livrable_id → Map<livrableId, version[]>. */
export function indexVersionsByLivrable(versions = []) {
  const map = new Map()
  for (const v of versions) {
    if (!v?.livrable_id) continue
    const arr = map.get(v.livrable_id) || []
    arr.push(v)
    map.set(v.livrable_id, arr)
  }
  return map
}

/** Indexe les étapes par livrable_id → Map<livrableId, etape[]>. */
export function indexEtapesByLivrable(etapes = []) {
  const map = new Map()
  for (const e of etapes) {
    if (!e?.livrable_id) continue
    const arr = map.get(e.livrable_id) || []
    arr.push(e)
    map.set(e.livrable_id, arr)
  }
  return map
}

// ─── Compteurs & dérivés ────────────────────────────────────────────────────

/**
 * Vrai si un livrable est "en retard" : date_livraison < today ET statut non
 * terminé (livré / archive).
 * @param {Object} livrable
 * @param {Date}   [now=new Date()] - injectable pour les tests
 */
export function isLivrableEnRetard(livrable, now = new Date()) {
  if (!livrable?.date_livraison) return false
  if (LIVRABLE_STATUTS_TERMINES.has(livrable.statut)) return false
  // Comparaison à minuit local : on considère que J est en retard à partir
  // de J+1 00:00, pas dès J 00:01.
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const due = new Date(livrable.date_livraison + 'T00:00:00')
  return due < today
}

/**
 * Calcule les compteurs affichés en header de l'outil Livrables.
 *
 * @param {Array}  livrables     - tous les livrables non supprimés du projet
 * @param {Date}   [now=new Date()]
 * @returns {{
 *   total:    number,
 *   actifs:   number,   // hors livrés / archivés
 *   enRetard: number,
 *   livres:   number,
 *   valides:  number,
 *   prochain: Object|null,  // livrable le plus proche dans le futur, non terminé
 * }}
 */
export function computeCompteurs(livrables = [], now = new Date()) {
  let actifs = 0
  let enRetard = 0
  let livres = 0
  let valides = 0
  let prochain = null
  let prochainTs = Infinity

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  for (const l of livrables) {
    if (!l) continue
    if (l.statut === 'livre') livres++
    if (l.statut === 'valide') valides++
    if (LIVRABLE_STATUTS_ACTIFS.has(l.statut)) actifs++
    if (isLivrableEnRetard(l, now)) enRetard++

    // Prochain livrable : on cherche la date la plus proche >= today, parmi
    // les non-terminés. Les sans-date sont ignorés.
    if (l.date_livraison && !LIVRABLE_STATUTS_TERMINES.has(l.statut)) {
      const due = new Date(l.date_livraison + 'T00:00:00')
      if (due.getTime() >= today.getTime()) {
        if (due.getTime() < prochainTs) {
          prochainTs = due.getTime()
          prochain = l
        }
      }
    }
  }

  return {
    total: livrables.length,
    actifs,
    enRetard,
    livres,
    valides,
    prochain,
  }
}

/**
 * Liste les monteurs distincts apparaissant dans les livrables :
 *   - assignee_profile_id (interne) → on enrichit via `profilesById` si fourni
 *   - assignee_external   (texte libre) → entrée brute
 *
 * @param {Array} livrables
 * @param {Map<string, Object>} [profilesById] - Map id → {id, full_name, email, ...}
 * @returns {Array<{ key: string, label: string, profile?: Object, isExternal: boolean }>}
 */
export function listMonteurs(livrables = [], profilesById = new Map()) {
  const seen = new Map() // key → entry, dedupe sur key
  for (const l of livrables) {
    if (l?.assignee_profile_id) {
      const key = `p:${l.assignee_profile_id}`
      if (!seen.has(key)) {
        const profile = profilesById.get(l.assignee_profile_id)
        const fullName = profile
          ? (profile.full_name || profile.email || 'Membre inconnu')
          : 'Membre'
        seen.set(key, { key, label: fullName, profile: profile || null, isExternal: false })
      }
    }
    if (l?.assignee_external) {
      const trimmed = l.assignee_external.trim()
      if (!trimmed) continue
      const key = `x:${trimmed.toLowerCase()}`
      if (!seen.has(key)) {
        seen.set(key, { key, label: trimmed, isExternal: true })
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) =>
    a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }),
  )
}

// ─── Numérotation auto ──────────────────────────────────────────────────────

/**
 * Calcule le statut cible d'un livrable en fonction de ses versions (LIV-8).
 * Règle :
 *   - Si le livrable est dans un statut terminé (`livre` ou `archive`), on
 *     ne touche pas — l'utilisateur a fait une action explicite à respecter.
 *   - Si aucune version → pas de changement (on rend `livrable.statut` tel quel).
 *   - Sinon, on regarde la version la plus récente (`sort_order` max) :
 *       - `statut_validation === 'valide'`  → livrable cible = `valide`
 *       - sinon                              → livrable cible = `a_valider`
 *
 * Cas d'usage : appelé après chaque addVersion / updateVersion (statut) /
 * deleteVersion pour synchroniser le statut du livrable parent.
 *
 * @param {Object} livrable        - { statut, ... }
 * @param {Array}  versions        - versions du livrable (peut être vide)
 * @returns {string} le statut cible (peut être identique au statut courant)
 */
export function computeLivrableStatutFromVersions(livrable, versions = []) {
  if (!livrable) return null
  if (LIVRABLE_STATUTS_TERMINES.has(livrable.statut)) return livrable.statut
  if (!versions || versions.length === 0) return livrable.statut

  let latest = null
  let maxOrder = -Infinity
  for (const v of versions) {
    const o = v?.sort_order ?? 0
    if (o > maxOrder) {
      maxOrder = o
      latest = v
    }
  }
  if (!latest) return livrable.statut
  return latest.statut_validation === 'valide' ? 'valide' : 'a_valider'
}

/**
 * Calcule le prochain `numero` auto pour un livrable d'un bloc donné.
 * Pattern : préfixe du bloc + premier index libre (>= 1).
 *
 *   bloc.prefixe = 'A'
 *   livrables existants dans ce bloc : ['A1', 'A3', 'A4']
 *   → renvoie 'A2'
 *
 * Si aucun préfixe → renvoie l'index sous forme de chaîne ('1', '2'...).
 * Ignore les numeros qui ne matchent pas le pattern préfixe + entier (ex
 * "A1*", "A-rec") — ils ne consomment pas d'index.
 *
 * @param {Object} block        - { prefixe, ... }
 * @param {Array}  blockLivrables - livrables du même bloc (peut inclure les supprimés
 *                                  selon ce que l'appelant veut éviter)
 */
export function nextLivrableNumero(block, blockLivrables = []) {
  const prefix = (block?.prefixe || '').trim()
  // Regex match prefix + digits exact (autorise espace optionnel entre).
  const escaped = prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  const re = prefix
    ? new RegExp(`^\\s*${escaped}\\s*(\\d+)\\s*$`, 'i')
    : /^\s*(\d+)\s*$/
  const used = new Set()
  for (const l of blockLivrables) {
    const m = re.exec(l?.numero || '')
    if (m) used.add(parseInt(m[1], 10))
  }
  let n = 1
  while (used.has(n)) n++
  return `${prefix}${n}`
}

// ─── Filtres (LIV-15) ────────────────────────────────────────────────────────

/**
 * Filtre une liste de livrables selon un objet `filters`. Toutes les clés
 * sont optionnelles ; absentes/vides → pas de filtrage sur cet axe.
 *
 * @param {Array}  livrables
 * @param {Object} filters
 * @param {Set<string>}  [filters.statuts]      - multi-select sur `livrable.statut`
 * @param {Set<string>}  [filters.monteurs]     - keys retournées par `listMonteurs`
 *                                                (`p:<profileId>` ou `x:<lower(label)>`)
 * @param {Set<string>}  [filters.formats]      - multi-select sur `livrable.format`
 * @param {Set<string>}  [filters.blockIds]     - multi-select sur `livrable.block_id`
 * @param {boolean}      [filters.enRetard]     - true → seulement les en retard
 * @param {boolean}      [filters.mesLivrables] - true → seulement les livrables
 *                                                où `assignee_profile_id === ctx.userId`
 * @param {Object} [ctx]
 * @param {string} [ctx.userId] - id du user courant (pour `mesLivrables`)
 * @param {Date}   [ctx.now]    - fixé pour les tests temporels
 * @returns {Array} nouveau tableau filtré (pure)
 */
export function filterLivrables(livrables = [], filters = {}, ctx = {}) {
  const {
    statuts,
    monteurs,
    formats,
    blockIds,
    enRetard,
    mesLivrables,
  } = filters
  const { userId, now } = ctx

  return livrables.filter((l) => {
    if (!l) return false
    // Statut (multi)
    if (statuts && statuts.size > 0 && !statuts.has(l.statut)) return false
    // Format (multi) — null → match seulement si "Aucun" est dans le filtre
    if (formats && formats.size > 0) {
      const fKey = l.format || '__none__'
      if (!formats.has(fKey)) return false
    }
    // Bloc (multi)
    if (blockIds && blockIds.size > 0 && !blockIds.has(l.block_id)) return false
    // Monteur — match sur `assignee_profile_id` OU `assignee_external` :
    // les keys du Set sont au format `p:<id>` ou `x:<lower(label)>`.
    if (monteurs && monteurs.size > 0) {
      const profileKey = l.assignee_profile_id ? `p:${l.assignee_profile_id}` : null
      const externalKey = l.assignee_external
        ? `x:${l.assignee_external.trim().toLowerCase()}`
        : null
      // Cas spécial "Aucun monteur" → key '__none__' si ni profile ni external
      const noneKey = !profileKey && !externalKey ? '__none__' : null
      if (
        (!profileKey || !monteurs.has(profileKey)) &&
        (!externalKey || !monteurs.has(externalKey)) &&
        (!noneKey || !monteurs.has(noneKey))
      ) {
        return false
      }
    }
    // En retard (date_livraison < today + statut non terminé)
    if (enRetard && !isLivrableEnRetard(l, now)) return false
    // Mes livrables (lié au user courant via assignee_profile_id)
    if (mesLivrables && (!userId || l.assignee_profile_id !== userId)) return false
    return true
  })
}

/**
 * Filtre actif si au moins un critère est défini (Set non vide ou bool true).
 * Utilisé pour afficher le bouton "Effacer les filtres".
 */
export function hasActiveFilter(filters = {}) {
  if (filters.statuts && filters.statuts.size > 0) return true
  if (filters.monteurs && filters.monteurs.size > 0) return true
  if (filters.formats && filters.formats.size > 0) return true
  if (filters.blockIds && filters.blockIds.size > 0) return true
  if (filters.enRetard) return true
  if (filters.mesLivrables) return true
  return false
}

// ─── Validation / sanitization ──────────────────────────────────────────────

/**
 * Whitelist des champs éditables d'un livrable côté UI.
 * Centralisée ici (et en miroir dans `livrables.updateLivrable`) pour éviter
 * les divergences entre le patch optimistic et le patch serveur.
 */
export const LIVRABLE_EDITABLE_FIELDS = [
  'block_id',
  'numero',
  'nom',
  'format',
  'duree',
  'version_label',
  'statut',
  'projet_dav',
  'assignee_profile_id',
  'assignee_external',
  'date_livraison',
  'lien_frame',
  'lien_drive',
  'devis_lot_id',
  'notes',
  'sort_order',
]

/**
 * Garde uniquement les champs whitelistés d'un patch.
 * Pure / synchrone — utilisé partout où on construit un payload.
 */
export function pickAllowed(patch = {}, allowed = []) {
  const out = {}
  for (const k of allowed) if (k in patch) out[k] = patch[k]
  return out
}

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
 * @param {Map<string, Object>} [profilesById] - Map id → {id, nom, prenom...}
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
          ? [profile.prenom, profile.nom].filter(Boolean).join(' ').trim() ||
            profile.email ||
            'Membre inconnu'
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

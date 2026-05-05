// ════════════════════════════════════════════════════════════════════════════
// sessions.js — Sessions Équipe (multi-séjours d'un membre sur un projet)
// ════════════════════════════════════════════════════════════════════════════
//
// Concept : un membre a 1 à N "sessions" sur un projet. Chaque session = un
// séjour cohérent avec une plage de dates et un lieu principal. Cas typique :
//   - 1 session : la majorité (90%). Hugo arrive lundi, repart vendredi.
//   - 2+ sessions : projet à phases distinctes ou tournage découpé. Ex :
//     "Essais Paris" + "Tournage Mtp", ou "Tournage Lyon" + "Tournage Toulouse".
//
// Phase 0a (cette migration) : la table `projet_membres_sessions` existe et
// est seedée (1 session par membre existant). L'UI Équipe n'utilise pas
// encore les sessions — elles sont juste lues en arrière-plan, prêtes pour
// la bascule UI en Phase 0b.
//
// Source de vérité actuelle (Phase 0a) :
//   • `projet_membres.arrival_date / departure_date / presence_days` reste
//     LA source. La table sessions est synchronisée par le seed initial.
//   • La bascule (sessions = source) viendra en Phase 0b avec l'UI multi-sessions.
//
// Helpers exportés ici sont 100% PURE (pas de fetch). Les fetchs Supabase
// se feront via un futur `useSessions` hook quand l'UI les consommera.
// ════════════════════════════════════════════════════════════════════════════

// Palette couleurs pour les sessions. Choisie pour bonne distinction visuelle
// même en daltonisme et compatible dark/light mode (les valeurs sont des
// hex sans # — le front les wrappe avec rgba/opacité selon contexte).
//
// Attribution déterministe : `paletteAt(sortOrder)` cycle sur la palette.
// L'admin peut surcharger via le champ `couleur` sur la session.
export const SESSION_PALETTE = Object.freeze([
  '378ADD',  // bleu — session 1 par défaut
  '1D9E75',  // teal
  'BA7517',  // amber
  '7F77DD',  // purple
  'D85A30',  // coral
  'D4537E',  // pink
  '639922',  // green
  '5F5E5A',  // gray
])

/**
 * Couleur déterministe à partir d'un sort_order.
 * Utilisé en fallback quand `session.couleur` est null.
 * @param {number} sortOrder 1-indexed
 * @returns {string} hex sans #, ex. '378ADD'
 */
export function paletteAt(sortOrder) {
  const idx = Math.max(0, (sortOrder || 1) - 1) % SESSION_PALETTE.length
  return SESSION_PALETTE[idx]
}

/**
 * Couleur effective d'une session : prend la valeur custom si renseignée,
 * sinon retombe sur la palette.
 */
export function effectiveCouleur(session) {
  if (!session) return SESSION_PALETTE[0]
  return session.couleur || paletteAt(session.sort_order)
}

/**
 * Label effectif d'une session :
 *   - le `label` saisi si présent
 *   - sinon "Sans nom" (placeholder neutre)
 *
 * Avant Phase A/3 le fallback était "Session N" basé sur sort_order,
 * mais comme sort_order est calculé MAX(project)+1 globalement, ça
 * donnait des "Session 14" / "Session 15" qui n'avaient aucun sens
 * pour l'admin. "Sans nom" est plus honnête : la session n'a pas de
 * nom, on incite à la renommer.
 */
export function effectiveLabel(session) {
  if (!session) return ''
  const trimmed = (session.label || '').trim()
  if (trimmed) return trimmed
  return 'Sans nom'
}

/**
 * Lieu effectif d'une session :
 *   - le nom du lieu structuré (via `lieu_principal_id`) si fourni en arg
 *   - sinon le `lieu_principal_text`
 *   - sinon ''
 *
 * @param {Object} session
 * @param {Object} [lieuById] Map<id, {nom}> si on a chargé les lieux structurés
 */
export function effectiveLieu(session, lieuById = null) {
  if (!session) return ''
  if (session.lieu_principal_id && lieuById?.[session.lieu_principal_id]) {
    return lieuById[session.lieu_principal_id].nom || ''
  }
  return (session.lieu_principal_text || '').trim()
}

/**
 * Trouve la session active d'un membre à une date donnée.
 * Une session est active à une date `iso` si :
 *   - iso ∈ presence_days, OU
 *   - arrival_date ≤ iso ≤ departure_date
 *
 * Si plusieurs sessions matchent (rare, ex. dates qui se chevauchent
 * suite à une saisie incomplète), on retourne la première par sort_order.
 *
 * @param {Array} sessions Sessions d'UN membre (pas tout le projet)
 * @param {string} iso Date ISO 'YYYY-MM-DD'
 * @returns {Object|null} la session active ou null
 */
export function getActiveSessionForDay(sessions, iso) {
  if (!Array.isArray(sessions) || sessions.length === 0 || !iso) return null
  const sorted = [...sessions].sort(
    (a, b) => (a.sort_order || 0) - (b.sort_order || 0),
  )
  for (const s of sorted) {
    // 1. Match prioritaire par presence_days (plus précis)
    if (Array.isArray(s.presence_days) && s.presence_days.includes(iso)) {
      return s
    }
  }
  for (const s of sorted) {
    // 2. Fallback par range arrival ↔ departure (capture les jours transit)
    const arr = s.arrival_date || null
    const dep = s.departure_date || null
    if (arr && dep && iso >= arr && iso <= dep) return s
    if (arr && !dep && iso === arr) return s
    if (!arr && dep && iso === dep) return s
  }
  return null
}

/**
 * Agrège les sessions d'un membre en {arrival_date, departure_date,
 * presence_days[]} compatibles avec le schéma `projet_membres` actuel.
 *
 * Utilisé pour :
 *   - Maintenir `projet_membres.*` synchronisés depuis les sessions
 *     (Phase 0b — la bascule de source de vérité)
 *   - Calculer les dérivés à la volée pour l'affichage si on ne fait pas
 *     confiance au cache
 *
 * @param {Array} sessions Sessions d'UN membre
 * @returns {{arrival_date: string|null, departure_date: string|null, presence_days: string[]}}
 */
export function aggregateSessionsToMembre(sessions) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return { arrival_date: null, departure_date: null, presence_days: [] }
  }
  let arrival = null
  let departure = null
  const presenceSet = new Set()
  for (const s of sessions) {
    if (s.arrival_date && (!arrival || s.arrival_date < arrival)) {
      arrival = s.arrival_date
    }
    if (s.departure_date && (!departure || s.departure_date > departure)) {
      departure = s.departure_date
    }
    if (Array.isArray(s.presence_days)) {
      for (const d of s.presence_days) {
        if (typeof d === 'string') presenceSet.add(d)
      }
    }
  }
  return {
    arrival_date: arrival,
    departure_date: departure,
    presence_days: [...presenceSet].sort(),
  }
}

/**
 * Indique si un membre a plusieurs sessions actives (pour décider d'afficher
 * les chips colorées au lieu de la date simple dans la crew list).
 *
 * Critère : 2+ sessions non-annulées.
 */
export function hasMultipleSessions(sessions) {
  if (!Array.isArray(sessions)) return false
  const active = sessions.filter((s) => s?.statut !== 'annule')
  return active.length >= 2
}

/**
 * Trie les sessions par sort_order croissant. Ne mute pas l'array d'entrée.
 *
 * À utiliser pour : la création (auto-incrément max+1), la palette
 * (paletteAt déterministe), un éventuel drag-reorder futur. Pour les
 * affichages utilisateur, préférer `sortSessionsByDate` qui présente
 * les sessions dans l'ordre chronologique réel (humainement plus lisible).
 */
export function sortSessions(sessions) {
  if (!Array.isArray(sessions)) return []
  return [...sessions].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
}

/**
 * Première date observée d'une session : `arrival_date` si fourni, sinon
 * la 1ʳᵉ date triée des `presence_days`. Renvoie null si rien.
 */
export function firstDateOfSession(session) {
  if (!session) return null
  if (session.arrival_date) return session.arrival_date
  if (Array.isArray(session.presence_days) && session.presence_days.length) {
    return [...session.presence_days].sort()[0]
  }
  return null
}

/**
 * Trie les sessions par 1ʳᵉ date observée (chronologique). Sessions sans
 * date à la fin, départagées par sort_order. Ne mute pas l'array.
 *
 * À utiliser pour TOUS les affichages utilisateur (chips crew list,
 * légende grille, sélecteur modale, cards drawer) : c'est l'ordre
 * naturel pour un humain qui lit un planning.
 */
export function sortSessionsByDate(sessions) {
  if (!Array.isArray(sessions)) return []
  return [...sessions].sort((a, b) => {
    const ad = firstDateOfSession(a)
    const bd = firstDateOfSession(b)
    if (!ad && !bd) return (a.sort_order || 0) - (b.sort_order || 0)
    if (!ad) return 1 // sessions sans date en queue
    if (!bd) return -1
    return ad.localeCompare(bd)
  })
}

/**
 * Construit une Map<membreId, sessions[]> à partir d'une liste plate de
 * sessions. Utile quand on charge les sessions de tout un projet en 1 query
 * et qu'on veut les regrouper par membre côté UI.
 */
export function groupSessionsByMembre(sessions) {
  const map = new Map()
  if (!Array.isArray(sessions)) return map
  for (const s of sessions) {
    if (!s?.membre_id) continue
    if (!map.has(s.membre_id)) map.set(s.membre_id, [])
    map.get(s.membre_id).push(s)
  }
  // Tri cohérent par sort_order pour chaque membre
  for (const [k, list] of map) {
    map.set(k, sortSessions(list))
  }
  return map
}

/**
 * Phase A — détection d'une session existante par (label, lieu).
 *
 * Sur le shape unifié (= participation enrichie par useCrew), `label` et
 * `lieu_principal_text` viennent de la session globale partagée.
 *
 * Matching tolérant :
 *   - case-insensitive
 *   - trim + collapse whitespace
 *   - normalisation diacritics (NFKD) → "Zénith" === "Zenith"
 *   - si la cible n'a PAS de lieu, on match juste sur le label (utile
 *     quand l'admin tape juste un nom dans le mini-form sans préciser
 *     le lieu — on lui propose quand même les sessions existantes)
 *   - si la cible a un lieu, on match label ET lieu
 *
 * Retourne la 1ʳᵉ session matchant ou null. Le caller peut extraire le
 * `session_id` pour appeler joinSession dessus.
 */
function normalizeForMatch(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .toLowerCase()
    // Normalise les accents : "é" → "e"
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    // Compresse les whitespace internes
    .replace(/\s+/g, ' ')
}

export function findMatchingSession(sessions, label, lieu) {
  const targetLabel = normalizeForMatch(label)
  if (!targetLabel) return null // sans label, pas de matching possible
  const targetLieu = normalizeForMatch(lieu)
  if (!Array.isArray(sessions)) return null
  for (const s of sessions) {
    const sLabel = normalizeForMatch(s.label)
    if (sLabel !== targetLabel) continue
    // Si la cible n'a pas de lieu → match sur le label seul (l'admin
    // n'a peut-être pas pensé à saisir le lieu, on lui propose la
    // session existante).
    if (!targetLieu) return s
    // Accepte les 2 shapes possibles : participation (`lieu_principal_text`)
    // ou template (`lieu`, renommé côté TechListView pour compacité).
    const sLieu = normalizeForMatch(s.lieu_principal_text ?? s.lieu)
    if (sLieu !== targetLieu) continue
    return s
  }
  return null
}

/**
 * Pour la grille de présence partagée : retourne pour chaque membre une Map
 * <iso, sessionId|null> qui indique quelle session est active chaque jour.
 * Permet ensuite de color-coder la grille jour par jour (cf. plan UI).
 *
 * @param {Array} sessions Sessions d'UN membre
 * @param {string[]} days Liste de jours ISO à analyser (la plage de la grille)
 * @returns {Map<string, string|null>}
 */
export function buildDayToSessionMap(sessions, days) {
  const out = new Map()
  if (!Array.isArray(days)) return out
  for (const iso of days) {
    const s = getActiveSessionForDay(sessions, iso)
    out.set(iso, s ? s.id : null)
  }
  return out
}

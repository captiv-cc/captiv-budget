// ════════════════════════════════════════════════════════════════════════════
// derouleImportMatch — Diff intelligent entre une prog IA fraîchement
//                     extraite et les créneaux existants du jour.
// ════════════════════════════════════════════════════════════════════════════
//
// Cas d'usage : Festival envoie une timetable V2 la veille du show.
// L'utilisateur ré-uploade le PDF/image dans l'import IA. Au lieu de
// tout re-créer (ce qui dupliquerait), on détecte automatiquement :
//   - les MAJ : créneaux dont les horaires (ou lieu) ont changé
//   - les NOUVEAUX : artistes ajoutés dans la V2
//   - les ABSENTS : artistes présents en BDD mais retirés de la V2
//                   (proposés à la suppression, DÉCOCHÉS par défaut)
//   - les INCHANGÉS : pas d'action
//
// Stratégie de matching (fuzzy léger) :
//   - normalize : lowercase + retrait accents + trim + retrait symboles
//     décoratifs (©, ™, [parenthèses], ⓒ, etc.)
//   - clé primaire : (titre_normalisé, scene_normalisée)
//   - si plusieurs candidats : on prend le plus proche en heure_debut
//
// Choix Hugo (validés) :
//   - Absents listés mais décochés par défaut (safety)
//   - Matching fuzzy léger (pas IA, prévisible)
//   - Propagation cadreurs : toggle global ON/OFF côté UI
//
// API :
//   normalizeTitle(s) → string
//   analyzeImportDiff({ extracted, existing, lanes }) →
//     { updates[], creates[], deletes[], unchanged[] }
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalise un titre/scène pour le matching :
 *   - lowercase
 *   - retire diacritiques (é → e, ç → c)
 *   - retire symboles décoratifs courants (©, ™, ⓒ, etc.)
 *   - trim et compresse les espaces
 *   - retire le contenu entre parenthèses (souvent des annotations type
 *     "[Caisson Gauche : KEPLER invite]") pour matcher la racine.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeTitle(s) {
  if (!s || typeof s !== 'string') return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques
    .toLowerCase()
    .replace(/[©®™ⓒ]/g, '') // © ® ™ ⓒ
    .replace(/\[[^\]]*\]/g, '') // contenu entre []
    .replace(/\([^)]*\)/g, '') // contenu entre ()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Trouve le lane lieu correspondant à une scène (par libelle normalisé).
 */
function findLieuLane(lanes, sceneNorm) {
  if (!sceneNorm) return null
  return (
    lanes.find(
      (l) => l.type === 'lieu' && normalizeTitle(l.libelle || '') === sceneNorm,
    ) || null
  )
}

/**
 * Diff entre la prog extraite par l'IA et les créneaux existants en BDD.
 *
 * @param {object} args
 * @param {Array<{titre, scene, debut_min, fin_min}>} args.extracted -
 *   shows extraits (déjà avec debut_min/fin_min calculés, cf. ImportPreviewModal)
 * @param {Array<object>} args.existing - créneaux du jour (depuis BDD)
 * @param {Array<object>} args.lanes - lanes du déroulé (pour lookup scene)
 *
 * @returns {{
 *   updates: Array<{
 *     existing: object,
 *     extracted: object,
 *     extractedIdx: number,
 *     deltaStart: number,
 *     deltaEnd: number,
 *     fields: { heure_debut_min?, heure_fin_min?, lane_id?, lieu_text? },
 *   }>,
 *   creates: Array<{ extracted: object, extractedIdx: number }>,
 *   deletes: Array<{ existing: object }>,
 *   unchanged: Array<{ existing: object, extracted: object, extractedIdx: number }>,
 * }}
 */
export function analyzeImportDiff({ extracted, existing, lanes }) {
  const result = { updates: [], creates: [], deletes: [], unchanged: [] }
  if (!Array.isArray(extracted) || extracted.length === 0) {
    return result
  }
  // On ne s'intéresse qu'aux créneaux des lanes LIEU pour le diff. Les
  // créneaux cadreurs (lane type='personne') sont traités séparément via
  // la propagation soft-link, à part. Les créneaux globaux (REPAS, etc.)
  // restent inchangés.
  const lieuLaneIds = new Set(
    (lanes || []).filter((l) => l.type === 'lieu').map((l) => l.id),
  )
  const lieuExisting = (existing || [])
    .filter((c) => c && lieuLaneIds.has(c.lane_id))
    .map((c) => {
      const lane = lanes.find((l) => l.id === c.lane_id)
      return {
        ...c,
        _titreNorm: normalizeTitle(c.titre || ''),
        _sceneNorm: normalizeTitle(lane?.libelle || c.lieu_text || ''),
      }
    })

  const usedExistingIds = new Set()

  extracted.forEach((ex, idx) => {
    const titreNorm = normalizeTitle(ex.titre || '')
    const sceneNorm = normalizeTitle(ex.scene || '')

    // 1. Candidats par (titre + scene)
    let candidates = lieuExisting.filter(
      (c) =>
        !usedExistingIds.has(c.id) &&
        c._titreNorm === titreNorm &&
        c._sceneNorm === sceneNorm,
    )
    // 2. Fallback : titre seul (cas où la scène a été renommée dans la V2)
    if (candidates.length === 0) {
      candidates = lieuExisting.filter(
        (c) => !usedExistingIds.has(c.id) && c._titreNorm === titreNorm,
      )
    }
    // 3. Si toujours zéro candidat → nouveau
    if (candidates.length === 0) {
      result.creates.push({ extracted: ex, extractedIdx: idx })
      return
    }
    // 4. Sélection : le plus proche en heure_debut
    candidates.sort((a, b) => {
      const da = Math.abs((a.heure_debut_min ?? 0) - (ex.debut_min ?? 0))
      const db = Math.abs((b.heure_debut_min ?? 0) - (ex.debut_min ?? 0))
      return da - db
    })
    const best = candidates[0]
    usedExistingIds.add(best.id)

    // 5. Calcul du delta
    const deltaStart = (ex.debut_min ?? 0) - (best.heure_debut_min ?? 0)
    const deltaEnd = (ex.fin_min ?? 0) - (best.heure_fin_min ?? 0)
    // Changement de lane lieu si la scène extraite diffère
    const targetLane = findLieuLane(lanes, sceneNorm)
    const laneChanged = targetLane && targetLane.id !== best.lane_id
    // lieu_text : on ne met à jour que si le lane est inchangé (sinon le
    // lieu sera implicitement la lane elle-même)

    if (deltaStart === 0 && deltaEnd === 0 && !laneChanged) {
      result.unchanged.push({ existing: best, extracted: ex, extractedIdx: idx })
      return
    }

    const fields = {}
    if (deltaStart !== 0) fields.heure_debut_min = ex.debut_min
    if (deltaEnd !== 0) fields.heure_fin_min = ex.fin_min
    if (laneChanged) fields.lane_id = targetLane.id

    result.updates.push({
      existing: best,
      extracted: ex,
      extractedIdx: idx,
      deltaStart,
      deltaEnd,
      fields,
    })
  })

  // 6. Existants non matchés = candidats à la suppression
  result.deletes = lieuExisting
    .filter((c) => !usedExistingIds.has(c.id))
    .map((c) => ({ existing: c }))

  return result
}

/**
 * Formatte un delta en minutes en chaîne lisible :
 *   +30min, -1h15, +2h, etc.
 */
export function formatDelta(min) {
  if (typeof min !== 'number' || min === 0) return ''
  const sign = min > 0 ? '+' : '−'
  const abs = Math.abs(min)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  if (h === 0) return `${sign}${m}min`
  if (m === 0) return `${sign}${h}h`
  return `${sign}${h}h${String(m).padStart(2, '0')}`
}

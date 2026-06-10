// ════════════════════════════════════════════════════════════════════════════
// matosCheckFilter.js — Helpers purs pour le filtre loueur + progress (MAT-10)
// ════════════════════════════════════════════════════════════════════════════
//
// Extrait de CheckSession.jsx + useCheckTokenSession.js, sans dépendance
// React / Supabase, pour être testable en isolation (vitest).
//
// La sémantique est celle décidée avec Hugo (2026-04-22) :
//
//   • FILTRE LOUEUR (inclusif)
//     Un item passe le filtre actif si :
//       – activeLoueurId === null  (mode "Tous")
//       – OU l'item est un additif (added_during_check === true)
//       – OU l'item n'a aucun loueur attaché (évite les disparitions
//         silencieuses quand le tagging n'est pas exhaustif)
//       – OU l'item est taggé avec le loueur actif
//
//   • PROGRESSION D'UN BLOC
//     `checked` et `total` excluent les items retirés (removed_at IS NOT NULL).
//     Rationale : si on a 10 items et qu'on retire la caméra PLV100, on
//     affiche 9/9 pas 9/10 (l'UI devient "verte" sur un bloc entièrement
//     traité, même si un item a été remplacé).
//
//   • COMPTEURS PAR LOUEUR
//     Reflètent ce que chaque chip affichera si on tape dessus (même
//     sémantique inclusive que itemMatchesLoueur).
// ════════════════════════════════════════════════════════════════════════════

/**
 * Retourne true si l'item passe le filtre loueur actif.
 *
 * @param {object} item                 - Ligne matos_items (shape RPC)
 * @param {Map<string, Array>} loueursByItem - Index item_id → [loueurs]
 * @param {string|null} activeLoueurId  - id du loueur filtré, ou null pour "Tous"
 * @returns {boolean}
 */
export function itemMatchesLoueur(item, loueursByItem, activeLoueurId) {
  if (activeLoueurId === null || activeLoueurId === undefined) return true
  if (item?.added_during_check) return true
  const itLoueurs = loueursByItem?.get?.(item.id) || []
  if (itLoueurs.length === 0) return true
  return itLoueurs.some((l) => l?.id === activeLoueurId)
}

/**
 * Calcule la progression d'une liste d'items.
 * Les items retirés (removed_at truthy) sont exclus du total ET du compteur.
 *
 * MAT-13 : le paramètre `{ phase }` route la colonne utilisée pour "checké" :
 *   - phase='essais' (défaut) → `pre_check_at`
 *   - phase='rendu'            → `post_check_at`
 * Les items retirés restent exclus dans les deux cas (rationale identique).
 *
 * @param {Array} items - items du bloc (filtrés ou non)
 * @param {object} [opts]
 * @param {('essais'|'rendu')} [opts.phase='essais']
 * @returns {{ total: number, checked: number, ratio: number, allChecked: boolean }}
 */
export function computeBlockProgress(items, { phase = 'essais' } = {}) {
  const active = (items || []).filter((it) => !it?.removed_at)
  const total = active.length
  const checkedKey = phase === 'rendu' ? 'post_check_at' : 'pre_check_at'
  const checked = active.filter((it) => Boolean(it?.[checkedKey])).length
  const ratio = total > 0 ? checked / total : 0
  return {
    total,
    checked,
    ratio,
    allChecked: total > 0 && checked === total,
  }
}

/**
 * Applique le filtre loueur à un index `itemsByBlock` (Map<blockId, items[]>).
 * Retourne l'index d'origine si `activeLoueurId === null` (aucun filtre).
 *
 * @param {Map<string, Array>} itemsByBlock
 * @param {Map<string, Array>} loueursByItem
 * @param {string|null} activeLoueurId
 * @returns {Map<string, Array>}
 */
export function filterItemsByBlock(itemsByBlock, loueursByItem, activeLoueurId) {
  if (activeLoueurId === null || activeLoueurId === undefined) return itemsByBlock
  const out = new Map()
  for (const [blockId, arr] of itemsByBlock) {
    out.set(
      blockId,
      arr.filter((it) => itemMatchesLoueur(it, loueursByItem, activeLoueurId)),
    )
  }
  return out
}

/**
 * Calcule la progression par bloc en appliquant `computeBlockProgress` à
 * chaque entrée de l'index. Utilisé par useCheckTokenSession (global) ET par
 * CheckSession (sur la slice filtrée).
 *
 * MAT-13 : param `{ phase }` propagé à `computeBlockProgress`. Défaut 'essais'.
 *
 * @param {Iterable<{ id: string }>} blocks
 * @param {Map<string, Array>} itemsByBlock
 * @param {object} [opts]
 * @param {('essais'|'rendu')} [opts.phase='essais']
 * @returns {Map<string, { total, checked, ratio, allChecked }>}
 */
export function computeProgressByBlock(blocks, itemsByBlock, { phase = 'essais' } = {}) {
  const map = new Map()
  for (const block of blocks || []) {
    const arr = itemsByBlock?.get?.(block.id) || []
    map.set(block.id, computeBlockProgress(arr, { phase }))
  }
  return map
}

/**
 * Compte le nombre d'items visibles sous chaque filtre loueur (+ "all"),
 * pour alimenter les badges de LoueurFilterBar.
 *
 * La sémantique est identique à `itemMatchesLoueur`, appliquée en boucle
 * pour chaque loueur. "all" reflète le total absolu hors retirés.
 *
 * @param {Array<{ id: string }>} loueurs
 * @param {Map<string, Array>} itemsByBlock
 * @param {Map<string, Array>} loueursByItem
 * @returns {Map<string|'all', number>}
 */
export function computeLoueurCounts(loueurs, itemsByBlock, loueursByItem) {
  const map = new Map()

  // all = total absolu (items actifs, tous blocs confondus)
  let allTotal = 0
  for (const arr of itemsByBlock?.values?.() || []) {
    for (const it of arr) {
      if (it?.removed_at) continue
      allTotal += 1
    }
  }
  map.set('all', allTotal)

  // Par loueur : inline la sémantique de itemMatchesLoueur pour éviter
  // l'overhead d'appels de fonction dans la double boucle.
  for (const l of loueurs || []) {
    let n = 0
    for (const arr of itemsByBlock?.values?.() || []) {
      for (const it of arr) {
        if (it?.removed_at) continue
        if (it?.added_during_check) {
          n += 1
          continue
        }
        const itLoueurs = loueursByItem?.get?.(it.id) || []
        if (itLoueurs.length === 0) {
          n += 1
          continue
        }
        if (itLoueurs.some((x) => x?.id === l.id)) n += 1
      }
    }
    map.set(l.id, n)
  }
  return map
}

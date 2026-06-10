/**
 * lots.js — Helpers partagés pour la gestion des lots (devis_lots)
 *
 * Les lots sont des contrats commerciaux indépendants au sein d'un projet.
 * Ex : sur un festival, on peut avoir un lot "Aftermovie" et un lot
 * "Social media", chacun avec ses propres versions de devis et factures.
 */

// ─── Constantes ──────────────────────────────────────────────────────────────
export const DEFAULT_LOT_TITLE = 'Principal'

// 5 statuts dérivés depuis les devis du lot (jamais stockés en DB)
export const LOT_STATUS = {
  brouillon: {
    key: 'brouillon',
    label: 'Brouillon',
    color: 'var(--txt-3)',
    bg: 'var(--bg-elev)',
  },
  propose: {
    key: 'propose',
    label: 'Proposé',
    color: 'var(--blue)',
    bg: 'var(--blue-bg)',
  },
  accepte: {
    key: 'accepte',
    label: 'Accepté',
    color: 'var(--green)',
    bg: 'var(--green-bg)',
  },
  refuse: {
    key: 'refuse',
    label: 'Refusé',
    color: 'var(--red)',
    bg: 'var(--red-bg)',
  },
  archive: {
    key: 'archive',
    label: 'Archivé',
    color: 'var(--txt-3)',
    bg: 'var(--bg-elev)',
  },
}

// ─── Calcul du statut d'un lot (dérivé, non stocké) ──────────────────────────
// Règles, du plus fort au plus faible :
//   archived = true                                    → 'archive'
//   ≥ 1 devis accepte                                   → 'accepte'
//   ≥ 1 devis envoye                                    → 'propose'
//   ≥ 1 devis et tous refuse                            → 'refuse'
//   autres cas (aucun devis, brouillons uniquement, …)  → 'brouillon'
export function computeLotStatus(lot, lotDevis = []) {
  if (lot?.archived) return 'archive'
  if (lotDevis.some((d) => d.status === 'accepte')) return 'accepte'
  if (lotDevis.some((d) => d.status === 'envoye')) return 'propose'
  if (lotDevis.length && lotDevis.every((d) => d.status === 'refuse')) return 'refuse'
  return 'brouillon'
}

// ─── Sélection du devis de référence d'un lot ────────────────────────────────
// Le refDevis = celui qui sert de base pour budget/factures/équipe.
// Règle : dernier devis accepté (version la plus haute parmi ceux acceptés),
//         sinon version la plus haute toutes statuts confondus.
export function pickRefDevis(lotDevis = []) {
  if (!lotDevis.length) return null
  const acceptes = lotDevis.filter((d) => d.status === 'accepte')
  const pool = acceptes.length ? acceptes : lotDevis
  return pool.reduce((a, b) => ((b.version_number || 0) > (a.version_number || 0) ? b : a))
}

// ─── Groupage des devis par lot ──────────────────────────────────────────────
export function groupDevisByLot(lots, devisList) {
  const map = {}
  for (const lot of lots) map[lot.id] = []
  for (const d of devisList) {
    if (!map[d.lot_id]) map[d.lot_id] = []
    map[d.lot_id].push(d)
  }
  // Tri par version_number ASC pour chaque lot
  for (const lotId of Object.keys(map)) {
    map[lotId].sort((a, b) => (a.version_number || 0) - (b.version_number || 0))
  }
  return map
}

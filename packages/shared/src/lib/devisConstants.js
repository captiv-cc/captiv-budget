/**
 * Constantes métier du moteur devis — partagées web + mobile.
 *
 * Extraites de packages/web/src/features/devis/constants.js (chantier app
 * bi-mode) : tout ce qui est PUR y vit désormais. Le web ré-exporte depuis
 * ici et conserve uniquement REGIME_TYPES (icônes lucide, spécifique web).
 */

import { CATS } from './cotisations.js'

// ─── Couleurs de repli pour blocs non-canoniques ────────────────────────────
export const CAT_ACCENT_COLORS = [
  '#00c875',
  '#4d9fff',
  '#ff9f0a',
  '#9c5ffd',
  '#ff5ac4',
  '#ff4757',
  '#ffce00',
]

// ─── Normalisation des régimes legacy ───────────────────────────────────────
// Anciens taux cotisation_config → régimes actuels.
export const REGIME_COMPAT = {
  'Prestation facturée': 'Externe',
  'Auto-entrepreneur': 'Externe',
  'Salarié CDD': 'Externe',
}

export const normalizeRegime = (r) => REGIME_COMPAT[r] ?? (CATS.includes(r) ? r : 'Frais')

// ─── Mapping catégorie catalogue → régime devis par défaut ─────────────────
export const CAT_TO_REGIME = {
  Humain: 'Externe',
  Production: 'Frais',
  'Post-production': 'Frais',
  'Moyen technique': 'Technique',
  VHR: 'Frais',
  Frais: 'Frais',
  Autre: 'Frais',
}

/** Détermine le régime d'un produit catalogue : regime explicite > catégorie > fallback.
 *  "Prestation facturée" est ignoré car c'est le default DB, pas un choix intentionnel. */
export const regimeFromProduit = (p) => {
  if (p.regime && p.regime !== 'Prestation facturée') return normalizeRegime(p.regime)
  if (p.categorie && CAT_TO_REGIME[p.categorie]) return CAT_TO_REGIME[p.categorie]
  return 'Frais'
}

// ─── Métadonnées régimes — type + abréviation pour les sélecteurs ───────────
export const REGIME_META = {
  'Intermittent Technicien': { type: 'humain', abbr: 'Int. Tech.' },
  'Intermittent Artiste': { type: 'humain', abbr: 'Int. Art.' },
  'Ext. Intermittent': { type: 'humain', abbr: 'Ext. Int.' },
  Externe: { type: 'humain', abbr: 'Externe' },
  Interne: { type: 'humain', abbr: 'Interne' },
  Technique: { type: 'materiel', abbr: 'Tech.' },
  Frais: { type: 'frais', abbr: 'Frais' },
}

// ─── Templates vides pour init et reset ────────────────────────────────────
export const EMPTY_LINE = {
  id: null,
  ref: '',
  produit: '',
  description: '',
  regime: 'Frais',
  use_line: true,
  nb: 1,
  quantite: 1,
  unite: 'F',
  tarif_ht: 0,
  cout_ht: null,
  remise_pct: 0,
  sort_order: 0,
}

export const EMPTY_GLOBAL = {
  marge_globale_pct: 0,
  assurance_pct: 0,
  remise_globale_pct: 0,
  remise_globale_montant: 0,
}

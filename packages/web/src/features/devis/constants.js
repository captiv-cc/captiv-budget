/**
 * Constantes du moteur DevisEditor.
 *
 * La partie PURE (normalizeRegime, EMPTY_LINE, regimeFromProduit, …) vit
 * désormais dans packages/shared/src/lib/devisConstants.js (partagée avec le
 * mobile). Ne reste ici que REGIME_TYPES, qui dépend des icônes lucide-react
 * (spécifique web).
 */

import { Users, Wrench, Tag } from 'lucide-react'

export * from '@captiv/shared/lib/devisConstants'

// ─── Types de régime — icône, label (sans couleur distinctive) ─────────────
export const REGIME_TYPES = {
  humain: { Icon: Users, label: 'Humain' },
  materiel: { Icon: Wrench, label: 'Matériel' },
  frais: { Icon: Tag, label: 'Frais' },
}

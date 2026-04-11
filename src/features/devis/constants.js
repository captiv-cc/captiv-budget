/**
 * Constantes partagées du moteur DevisEditor — Chantier refacto.
 *
 * Extraites de src/pages/DevisEditor.jsx (ne touche à aucune logique :
 * uniquement des données statiques que plusieurs sous-composants vont
 * réutiliser après extraction).
 */

import { Users, Wrench, Tag } from 'lucide-react'
import { CATS } from '../../lib/cotisations'

// ─── Couleurs de repli pour blocs non-canoniques ────────────────────────────
export const CAT_ACCENT_COLORS = [
  '#00c875', '#4d9fff', '#ff9f0a', '#9c5ffd',
  '#ff5ac4', '#ff4757', '#ffce00',
]

// ─── Normalisation des régimes legacy ───────────────────────────────────────
// Anciens taux cotisation_config → régimes actuels.
export const REGIME_COMPAT = {
  'Prestation facturée': 'Externe',
  'Auto-entrepreneur':   'Externe',
  'Salarié CDD':         'Externe',
}

export const normalizeRegime = (r) =>
  REGIME_COMPAT[r] ?? (CATS.includes(r) ? r : 'Frais')

// ─── Métadonnées régimes — type + abréviation pour RegimeSelect ────────────
export const REGIME_META = {
  'Intermittent Technicien': { type: 'humain',   abbr: 'Int. Tech.' },
  'Intermittent Artiste':    { type: 'humain',   abbr: 'Int. Art.'  },
  'Externe':                 { type: 'humain',   abbr: 'Externe'    },
  'Interne':                 { type: 'humain',   abbr: 'Interne'    },
  'Technique':               { type: 'materiel', abbr: 'Tech.'      },
  'Frais':                   { type: 'frais',    abbr: 'Frais'      },
}

// ─── Types de régime — icône, label (sans couleur distinctive) ─────────────
export const REGIME_TYPES = {
  humain:   { Icon: Users,  label: 'Humain'   },
  materiel: { Icon: Wrench, label: 'Matériel' },
  frais:    { Icon: Tag,    label: 'Frais'    },
}

// ─── Templates vides pour init et reset ────────────────────────────────────
export const EMPTY_LINE = {
  id: null, ref: '', produit: '', description: '',
  regime: 'Frais', use_line: true,
  nb: 1, quantite: 1, unite: 'F',
  tarif_ht: 0, cout_ht: null, remise_pct: 0, sort_order: 0,
}

export const EMPTY_GLOBAL = {
  marge_globale_pct: 0,
  assurance_pct: 0,
  remise_globale_pct: 0,
  remise_globale_montant: 0,
}

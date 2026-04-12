// ─── Blocs canoniques du devis ────────────────────────────────────────────────
// Fichier partagé entre DevisEditor, EquipeTab, et tout futur module budgétaire.
// La clé `key` est la valeur stockée dans devis_categories.name en base.

export const BLOCS_CANONIQUES = [
  {
    key: 'pre_production',
    label: 'PRÉ-PRODUCTION',
    defaultRegime: 'Intermittent Technicien',
    color: '#9c5ffd',
  },
  {
    key: 'interpretation',
    label: 'INTERPRÉTATION',
    defaultRegime: 'Intermittent Artiste',
    color: '#ff5ac4',
  },
  {
    key: 'production',
    label: 'PRODUCTION',
    defaultRegime: 'Intermittent Technicien',
    color: '#00c875',
  },
  {
    key: 'moyens_techniques',
    label: 'MOYENS TECHNIQUES',
    defaultRegime: 'Technique',
    color: '#4d9fff',
  },
  { key: 'vhr', label: 'VHR', defaultRegime: 'Frais', color: '#ff9f0a' },
  {
    key: 'post_production',
    label: 'POST PRODUCTION',
    defaultRegime: 'Intermittent Technicien',
    color: '#ff4757',
  },
  { key: 'divers', label: 'DIVERS', defaultRegime: 'Frais', color: '#ffce00' },
]

/**
 * Retourne les infos canoniques d'une catégorie à partir de son name (clé DB).
 * Si la clé ne correspond à aucun bloc canonique, retourne un objet générique.
 */
export function getBlocInfo(catName) {
  const idx = BLOCS_CANONIQUES.findIndex((b) => b.key === catName)
  if (idx === -1)
    return {
      isCanonical: false,
      canonicalIdx: 999,
      key: catName,
      label: catName || 'Autre',
      color: '#888',
      defaultRegime: 'Frais',
    }
  return { isCanonical: true, canonicalIdx: idx, ...BLOCS_CANONIQUES[idx] }
}

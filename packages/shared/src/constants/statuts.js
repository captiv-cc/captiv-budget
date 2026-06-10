// ════════════════════════════════════════════════════════════════════════════
// Constantes statuts — partagées web + mobile
// ════════════════════════════════════════════════════════════════════════════
//
// Source unique de vérité pour les statuts utilisés à travers tout le DESK.
// Ne PAS hardcoder les strings ailleurs : importer ces constantes.
//
// ════════════════════════════════════════════════════════════════════════════

// ─── Statuts créneau (planning festival) ────────────────────────────────────
export const STATUT_CRENEAU = {
  PLANIFIE: 'planifie',
  EN_COURS: 'en_cours',
  FAIT: 'fait',
  ANNULE: 'annule',
}

export const STATUT_CRENEAU_LABEL = {
  [STATUT_CRENEAU.PLANIFIE]: 'Planifié',
  [STATUT_CRENEAU.EN_COURS]: 'En cours',
  [STATUT_CRENEAU.FAIT]: 'Fait',
  [STATUT_CRENEAU.ANNULE]: 'Annulé',
}

// Couleur affichage statut créneau (hex, marche web + mobile)
export const STATUT_CRENEAU_COLOR = {
  [STATUT_CRENEAU.PLANIFIE]: '#A1A1AA', // gris neutre
  [STATUT_CRENEAU.EN_COURS]: '#3B82F6', // bleu
  [STATUT_CRENEAU.FAIT]: '#10B981', // vert
  [STATUT_CRENEAU.ANNULE]: '#EF4444', // rouge
}

// ─── Statuts livrable ───────────────────────────────────────────────────────
export const STATUT_LIVRABLE = {
  A_DEMARRER: 'a_demarrer',
  A_CAPTER: 'a_capter',
  CAPTE: 'capte',
  EN_MONTAGE: 'en_montage',
  EN_RETOUCHE: 'en_retouche',
  VALIDE: 'valide',
}

export const STATUT_LIVRABLE_LABEL = {
  [STATUT_LIVRABLE.A_DEMARRER]: 'À démarrer',
  [STATUT_LIVRABLE.A_CAPTER]: 'À capter',
  [STATUT_LIVRABLE.CAPTE]: 'Capté',
  [STATUT_LIVRABLE.EN_MONTAGE]: 'En montage',
  [STATUT_LIVRABLE.EN_RETOUCHE]: 'En retouche',
  [STATUT_LIVRABLE.VALIDE]: 'Validé',
}

export const STATUT_LIVRABLE_COLOR = {
  [STATUT_LIVRABLE.A_DEMARRER]: '#71717A', // gris
  [STATUT_LIVRABLE.A_CAPTER]: '#3B82F6', // bleu
  [STATUT_LIVRABLE.CAPTE]: '#22C55E', // vert clair
  [STATUT_LIVRABLE.EN_MONTAGE]: '#A855F7', // violet
  [STATUT_LIVRABLE.EN_RETOUCHE]: '#F59E0B', // orange
  [STATUT_LIVRABLE.VALIDE]: '#10B981', // vert
}

// ─── Types créneau ──────────────────────────────────────────────────────────
export const TYPE_CRENEAU = {
  CAPTATION: 'captation',
  INTERVIEW: 'interview',
  BRIEF: 'brief',
  REPAS: 'repas',
  REPOS: 'repos',
  DEPLACEMENT: 'deplacement',
  AFTERMOVIE: 'aftermovie',
  DRONE: 'drone',
  INDISPO: 'indispo',
  AUTRE: 'autre',
}

export const TYPE_CRENEAU_LABEL = {
  [TYPE_CRENEAU.CAPTATION]: 'Captation',
  [TYPE_CRENEAU.INTERVIEW]: 'Interview',
  [TYPE_CRENEAU.BRIEF]: 'Brief',
  [TYPE_CRENEAU.REPAS]: 'Repas',
  [TYPE_CRENEAU.REPOS]: 'Repos',
  [TYPE_CRENEAU.DEPLACEMENT]: 'Déplacement',
  [TYPE_CRENEAU.AFTERMOVIE]: 'Aftermovie',
  [TYPE_CRENEAU.DRONE]: 'Drone',
  [TYPE_CRENEAU.INDISPO]: 'Indispo',
  [TYPE_CRENEAU.AUTRE]: 'Autre',
}

export const TYPE_CRENEAU_COLOR = {
  [TYPE_CRENEAU.CAPTATION]: '#3B82F6', // bleu
  [TYPE_CRENEAU.INTERVIEW]: '#F59E0B', // orange
  [TYPE_CRENEAU.BRIEF]: '#A855F7', // violet
  [TYPE_CRENEAU.REPAS]: '#71717A', // gris
  [TYPE_CRENEAU.REPOS]: '#71717A', // gris
  [TYPE_CRENEAU.DEPLACEMENT]: '#71717A', // gris
  [TYPE_CRENEAU.AFTERMOVIE]: '#A855F7', // violet
  [TYPE_CRENEAU.DRONE]: '#06B6D4', // cyan
  [TYPE_CRENEAU.INDISPO]: '#52525B', // gris foncé
  [TYPE_CRENEAU.AUTRE]: '#71717A',
}

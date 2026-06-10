// ════════════════════════════════════════════════════════════════════════════
// fixtures — données mock pour développement sans Supabase
// ════════════════════════════════════════════════════════════════════════════
//
// Utiliser en V1 pour que tous les écrans s'affichent même sans backend prêt.
// Activer/désactiver via process.env.EXPO_PUBLIC_USE_FIXTURES=1 dans .env.
//
// Quand le backend mobile sera branché (Phase 3+), remplacer les hooks par
// de vraies requêtes Supabase.
//
// ════════════════════════════════════════════════════════════════════════════

import { STATUT_CRENEAU, STATUT_LIVRABLE, TYPE_CRENEAU } from '@captiv/shared'

// ─── Utilisateur courant (toi, Hugo) ──────────────────────────────────────
export const fixtureUser = {
  id: 'user_hugo',
  email: 'hugo@captiv.cc',
  nom: 'Hugo Martin',
  role: 'cadreur',
  avatar_initiales: 'HM',
  avatar_color: '#3B82F6',
}

// ─── Projet en cours ──────────────────────────────────────────────────────
export const fixtureProjet = {
  id: 'proj_marsatac_2026',
  nom: 'MARSATAC 2026',
  date_debut: '2026-06-12',
  date_fin: '2026-06-14',
  lieu: 'Friche Belle de Mai, Marseille',
  jour_actuel: 1,
  jours_total: 3,
}

// ─── Créneaux samedi 14 juin (jour 2) ─────────────────────────────────────
const aujourdhui = new Date()
aujourdhui.setHours(0, 0, 0, 0)

function dateAt(hour, minute = 0, dayOffset = 0) {
  const d = new Date(aujourdhui)
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export const fixtureCreneaux = [
  {
    id: 'c1',
    titre: 'Préparation soirée',
    type: TYPE_CRENEAU.BRIEF,
    statut: STATUT_CRENEAU.PLANIFIE,
    start: dateAt(14, 0),
    end: dateAt(16, 0),
    duree_min: 120,
    lieu: 'QG production',
    lane: 'moi',
    equipe: [{ user_id: 'user_hugo', role: 'Lead' }],
    headliner: false,
    brief: 'Briefing équipe avant la soirée. Recap planning + ajustements de dernière minute.',
  },
  {
    id: 'c2',
    titre: 'Phoenix',
    type: TYPE_CRENEAU.INTERVIEW,
    statut: STATUT_CRENEAU.PLANIFIE,
    start: dateAt(17, 0),
    end: dateAt(18, 0),
    duree_min: 60,
    lieu: 'Backstage Garance',
    lane: 'moi',
    equipe: [
      { user_id: 'user_hugo', role: 'Cam principale' },
      { user_id: 'user_julie', role: 'Prod' },
    ],
    headliner: false,
    brief: 'Interview en backstage avant le live. Préparer 3 questions ouvertes.',
  },
  {
    id: 'c3',
    titre: 'The Blaze',
    type: TYPE_CRENEAU.CAPTATION,
    statut: STATUT_CRENEAU.PLANIFIE,
    start: dateAt(20, 0),
    end: dateAt(21, 0),
    duree_min: 60,
    lieu: 'Scène Garance',
    lieu_distance_m: 340,
    lane: 'moi',
    equipe: [
      { user_id: 'user_hugo', role: 'Cam principale' },
      { user_id: 'user_samuel', role: 'Drone' },
      { user_id: 'user_julie', role: 'Prod' },
    ],
    headliner: true,
    brief:
      'Plan large + zoom drops. Synchro drone Samuel — préviens 30s avant le break. Crashs only 3 first songs.',
    warnings: ['Crashs only sur les 3 premiers morceaux'],
    sources: [
      { label: 'Rider', url: 'https://example.com/rider' },
      { label: 'Setlist', url: 'https://example.com/setlist' },
    ],
  },
  {
    id: 'c4',
    titre: 'Pause catering',
    type: TYPE_CRENEAU.REPAS,
    statut: STATUT_CRENEAU.PLANIFIE,
    start: dateAt(22, 0),
    end: dateAt(23, 0),
    duree_min: 60,
    lieu: 'Catering',
    lane: 'moi',
    equipe: [],
    headliner: false,
  },
]

// ─── Lanes pour la vue Timeline ───────────────────────────────────────────
export const fixtureLanes = [
  { id: 'moi', label: 'MOI', type: 'cadreur', user_id: 'user_hugo' },
  { id: 'chateau', label: 'CHATEAU', type: 'scene' },
  { id: 'virage', label: 'VIRAGE', type: 'scene' },
  { id: 'enclave', label: 'ENCLAVE', type: 'scene' },
]

export const fixtureCreneauxTimeline = [
  {
    id: 'cm1',
    lane_id: 'moi',
    titre: 'Prep soirée',
    type_creneau: TYPE_CRENEAU.BRIEF,
    start: dateAt(17, 0),
    end: dateAt(17, 45),
  },
  {
    id: 'cm2',
    lane_id: 'moi',
    titre: 'Phoenix',
    sous_titre: 'Interview',
    type_creneau: TYPE_CRENEAU.INTERVIEW,
    start: dateAt(18, 0),
    end: dateAt(18, 45),
  },
  {
    id: 'cm3',
    lane_id: 'moi',
    titre: 'The Blaze',
    sous_titre: 'Captation',
    type_creneau: TYPE_CRENEAU.CAPTATION,
    headliner: true,
    start: dateAt(20, 0),
    end: dateAt(21, 0),
  },
  {
    id: 'cm4',
    lane_id: 'moi',
    titre: 'REPAS',
    type_creneau: TYPE_CRENEAU.REPAS,
    start: dateAt(22, 0),
    end: dateAt(22, 45),
  },
  { id: 'ct1', lane_id: 'chateau', titre: 'OUVERT…', start: dateAt(17, 0), end: dateAt(17, 45) },
  { id: 'ct2', lane_id: 'chateau', titre: 'CREAMY G', start: dateAt(17, 50), end: dateAt(18, 35) },
  { id: 'ct3', lane_id: 'chateau', titre: 'MENACE', start: dateAt(18, 50), end: dateAt(19, 35) },
  { id: 'ct4', lane_id: 'chateau', titre: 'MERYL', start: dateAt(20, 30), end: dateAt(21, 30) },
  { id: 'ct5', lane_id: 'chateau', titre: 'LA MANO', start: dateAt(22, 0), end: dateAt(22, 45) },
  { id: 'cv1', lane_id: 'virage', titre: 'KAYLA', start: dateAt(17, 0), end: dateAt(17, 50) },
  { id: 'cv2', lane_id: 'virage', titre: 'JEUNE MO', start: dateAt(18, 30), end: dateAt(19, 30) },
  { id: 'cv3', lane_id: 'virage', titre: 'METAH', start: dateAt(19, 50), end: dateAt(20, 35) },
  { id: 'cv4', lane_id: 'virage', titre: 'INO CASA', start: dateAt(20, 50), end: dateAt(21, 35) },
  { id: 'cv5', lane_id: 'virage', titre: 'LA RVFL', start: dateAt(22, 30), end: dateAt(23, 30) },
]

// ─── Livrables (mes affectés) ─────────────────────────────────────────────
export const fixtureBlocs = [
  { id: 'b1', code: 'R', label: 'RECAP', couleur: '#10B981' },
  { id: 'b2', code: 'S', label: 'SNACK CONTENT', couleur: '#3B82F6' },
  { id: 'b3', code: 'C', label: 'CAPSULES', couleur: '#A855F7' },
]

export const fixtureLivrables = [
  {
    id: 'l1',
    bloc_id: 'b1',
    numero: 'R1',
    nom: 'Récap J1 — Vendredi',
    format: '9:16',
    duree: '00:45',
    livraison: '2026-06-12',
    statut: STATUT_LIVRABLE.VALIDE,
  },
  {
    id: 'l2',
    bloc_id: 'b1',
    numero: 'R2',
    nom: 'Récap J2 — Samedi',
    format: '9:16',
    duree: '00:45',
    livraison: '2026-06-13',
    statut: STATUT_LIVRABLE.A_DEMARRER,
  },
  {
    id: 'l3',
    bloc_id: 'b1',
    numero: 'R3',
    nom: 'Récap J3 — Dimanche',
    format: '9:16',
    duree: '00:45',
    livraison: '2026-06-14',
    statut: STATUT_LIVRABLE.A_DEMARRER,
  },
  {
    id: 'l4',
    bloc_id: 'b2',
    numero: 'S1',
    nom: 'Snack Ouverture Portes',
    format: '9:16',
    duree: '00:15',
    livraison: '2026-06-12',
    statut: STATUT_LIVRABLE.EN_MONTAGE,
  },
  {
    id: 'l5',
    bloc_id: 'b2',
    numero: 'S2',
    nom: 'Snack J1',
    format: '9:16',
    duree: '00:15',
    livraison: '2026-06-12',
    statut: STATUT_LIVRABLE.A_CAPTER,
  },
  {
    id: 'l6',
    bloc_id: 'b3',
    numero: 'C1',
    nom: 'Crédit Mutuel × Riffx',
    format: '16:9',
    duree: '01:00',
    livraison: null,
    statut: STATUT_LIVRABLE.A_DEMARRER,
  },
]

// ─── Notifications ────────────────────────────────────────────────────────
function ago(min) {
  return new Date(Date.now() - min * 60_000).toISOString()
}

export const fixtureNotifications = [
  {
    id: 'n1',
    type: 'creneau_assigne',
    titre: 'Nouveau créneau assigné',
    corps: 'Captation The Blaze — Scène Garance, 20h',
    lu: false,
    created_at: ago(5),
    deep_link: 'captivdesk://creneau/c3',
  },
  {
    id: 'n2',
    type: 'creneau_modifie',
    titre: 'Créneau modifié',
    corps: 'Interview Phoenix décalée : 17h30',
    lu: false,
    created_at: ago(32),
    deep_link: 'captivdesk://creneau/c2',
  },
  {
    id: 'n3',
    type: 'mention',
    titre: '@Julie t\'a mentionné',
    corps: "Pense à la cam B pour The Blaze",
    lu: false,
    created_at: ago(60),
    deep_link: 'captivdesk://creneau/c3',
  },
  {
    id: 'n4',
    type: 'creneau_annule',
    titre: 'Créneau annulé · Drone',
    corps: 'Vendredi 19h — météo',
    lu: true,
    created_at: ago(60 * 18),
  },
  {
    id: 'n5',
    type: 'livrable_valide',
    titre: 'Livrable validé',
    corps: 'Aftermovie J1 approuvé client',
    lu: true,
    created_at: ago(60 * 20),
  },
]

// ─── Settings utilisateur ─────────────────────────────────────────────────
export const fixtureSettings = {
  push_notifications: true,
  rappel_creneau_delai_min: 15, // valeur par défaut
}

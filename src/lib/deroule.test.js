// Tests unitaires des helpers purs de lib/deroule.js
// (CRUD côté Supabase pas testés ici — couverts par smoke tests UI plus tard)
//
// V0.5 : les créneaux et déroulés stockent les heures en INTEGER minutes
// depuis 00:00 du jour J (range 0-1680 = 28h max = 04:00 J+1).

import { describe, it, expect } from 'vitest'
import {
  CRENEAU_TYPES,
  CRENEAU_TYPE_COLORS,
  DEFAULT_LANE_LIBELLES,
  MAX_LANES,
  MAX_MIN,
  timeToMinutes,
  minutesToTime,
  formatMinHHMM,
  formatMinTimeInput,
  snapToStep,
  creneauDureeMin,
  creneauxOverlap,
  findMembreOverlaps,
  effectiveCouleurCreneau,
  sortCreneauxByTime,
  defaultLaneLibelle,
  membresPresentsJour,
  suggestPresenceCreneaux,
} from './deroule'

// ─── Constantes ────────────────────────────────────────────────────────────

describe('CRENEAU_TYPES', () => {
  it('contient tous les types attendus', () => {
    expect(CRENEAU_TYPES).toEqual([
      'install', 'repas', 'prise', 'pause', 'transport',
      'brief', 'live', 'autre',
    ])
  })
})

describe('CRENEAU_TYPE_COLORS', () => {
  it('a une couleur hex valide pour chaque type', () => {
    for (const type of CRENEAU_TYPES) {
      const color = CRENEAU_TYPE_COLORS[type]
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })
})

describe('MAX_LANES', () => {
  it('est égal à 5', () => {
    expect(MAX_LANES).toBe(5)
  })
})

describe('MAX_MIN', () => {
  it('est égal à 1680 (28h = 04:00 J+1)', () => {
    expect(MAX_MIN).toBe(1680)
  })
})

// ─── timeToMinutes / minutesToTime ─────────────────────────────────────────

describe('timeToMinutes', () => {
  it('parse HH:MM correctement', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  it('parse HH:MM:SS en ignorant les secondes', () => {
    expect(timeToMinutes('09:30:45')).toBe(570)
  })

  it('retourne NaN pour les formats invalides', () => {
    expect(timeToMinutes('foo')).toBeNaN()
    expect(timeToMinutes('')).toBeNaN()
    expect(timeToMinutes(null)).toBeNaN()
  })

  it('accepte les heures > 23 (le caller filtre)', () => {
    expect(timeToMinutes('25:00')).toBe(1500)
  })
})

describe('minutesToTime', () => {
  it('formate correctement', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(1439)).toBe('23:59')
  })

  it('roundtrip avec timeToMinutes', () => {
    const samples = ['00:00', '09:30', '14:45', '23:59']
    for (const t of samples) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t)
    }
  })
})

// ─── formatMinHHMM (V0.5 — affichage heures > 24h) ─────────────────────────

describe('formatMinHHMM', () => {
  it('formate les heures du jour J normalement', () => {
    expect(formatMinHHMM(0)).toBe('00:00')
    expect(formatMinHHMM(540)).toBe('09:00')
    expect(formatMinHHMM(1439)).toBe('23:59')
  })

  it('ajoute "+1j" pour les heures > 24h', () => {
    expect(formatMinHHMM(1440)).toBe('00:00 +1j')
    expect(formatMinHHMM(1500)).toBe('01:00 +1j')
    expect(formatMinHHMM(1560)).toBe('02:00 +1j')
    expect(formatMinHHMM(1680)).toBe('04:00 +1j')
  })

  it('retourne 00:00 pour les valeurs invalides', () => {
    expect(formatMinHHMM(-1)).toBe('00:00')
    expect(formatMinHHMM(NaN)).toBe('00:00')
    expect(formatMinHHMM('foo')).toBe('00:00')
    expect(formatMinHHMM(null)).toBe('00:00')
  })
})

// ─── formatMinTimeInput (sans suffixe — pour <input type="time">) ──────────

describe('formatMinTimeInput', () => {
  it('formate les heures du jour J normalement', () => {
    expect(formatMinTimeInput(0)).toBe('00:00')
    expect(formatMinTimeInput(540)).toBe('09:00')
    expect(formatMinTimeInput(1439)).toBe('23:59')
  })

  it('prend modulo 24h pour les heures > 24h (caller gère le toggle lendemain)', () => {
    expect(formatMinTimeInput(1440)).toBe('00:00')
    expect(formatMinTimeInput(1500)).toBe('01:00')
    expect(formatMinTimeInput(1680)).toBe('04:00')
  })

  it('retourne 00:00 pour les valeurs invalides', () => {
    expect(formatMinTimeInput(-1)).toBe('00:00')
    expect(formatMinTimeInput(null)).toBe('00:00')
  })
})

// ─── snapToStep ────────────────────────────────────────────────────────────

describe('snapToStep', () => {
  it('snap au pas de 15 min', () => {
    // 577 → 570 (= 9h30, distance 7) vs 585 (= 9h45, distance 8) : 570 plus proche
    expect(snapToStep(577, 15)).toBe(570)
    // 572 → 570 (= 9h30, distance 2) vs 585 (distance 13) : 570 plus proche
    expect(snapToStep(572, 15)).toBe(570)
    // 578 (au-delà de la moitié de step depuis 570) → 585
    expect(snapToStep(578, 15)).toBe(585)
  })

  it('snap au pas de 5 min', () => {
    expect(snapToStep(572, 5)).toBe(570)
    expect(snapToStep(573, 5)).toBe(575)
  })

  it('retourne la valeur inchangée pour step <= 0', () => {
    expect(snapToStep(577, 0)).toBe(577)
  })
})

// ─── creneauDureeMin ───────────────────────────────────────────────────────

describe('creneauDureeMin (V0.5 — INT minutes)', () => {
  it('retourne la durée correcte', () => {
    expect(creneauDureeMin({ heure_debut_min: 540, heure_fin_min: 600 })).toBe(60)
    expect(creneauDureeMin({ heure_debut_min: 540, heure_fin_min: 570 })).toBe(30)
    expect(creneauDureeMin({ heure_debut_min: 840, heure_fin_min: 1020 })).toBe(180)
  })

  it('gère les créneaux qui dépassent minuit', () => {
    // Live 22:00 → 02:00 J+1 = 1320 → 1560 = 240 min
    expect(creneauDureeMin({ heure_debut_min: 1320, heure_fin_min: 1560 })).toBe(240)
  })

  it('retourne 0 si invalide', () => {
    expect(creneauDureeMin({})).toBe(0)
    expect(creneauDureeMin(null)).toBe(0)
    expect(creneauDureeMin({ heure_debut_min: 'foo', heure_fin_min: 600 })).toBe(0)
    expect(creneauDureeMin({ heure_debut_min: 600, heure_fin_min: 540 })).toBe(0)
    expect(creneauDureeMin({ heure_debut_min: 600, heure_fin_min: 600 })).toBe(0)
  })
})

// ─── creneauxOverlap ───────────────────────────────────────────────────────

describe('creneauxOverlap (V0.5 — INT minutes)', () => {
  it('détecte un chevauchement classique', () => {
    expect(creneauxOverlap(
      { heure_debut_min: 540, heure_fin_min: 600 },   // 09:00-10:00
      { heure_debut_min: 570, heure_fin_min: 630 },   // 09:30-10:30
    )).toBe(true)
  })

  it('détecte un créneau dans un autre', () => {
    expect(creneauxOverlap(
      { heure_debut_min: 540, heure_fin_min: 720 },   // 09:00-12:00
      { heure_debut_min: 600, heure_fin_min: 660 },   // 10:00-11:00
    )).toBe(true)
  })

  it('ne flag pas deux créneaux qui se touchent', () => {
    expect(creneauxOverlap(
      { heure_debut_min: 540, heure_fin_min: 600 },   // 09:00-10:00
      { heure_debut_min: 600, heure_fin_min: 660 },   // 10:00-11:00
    )).toBe(false)
  })

  it('détecte overlap qui passe minuit', () => {
    expect(creneauxOverlap(
      { heure_debut_min: 1380, heure_fin_min: 1560 }, // 23:00-26:00 (02:00 J+1)
      { heure_debut_min: 1500, heure_fin_min: 1620 }, // 01:00 J+1 - 03:00 J+1
    )).toBe(true)
  })

  it('retourne false pour des inputs invalides', () => {
    expect(creneauxOverlap({}, {})).toBe(false)
    expect(creneauxOverlap(null, null)).toBe(false)
  })
})

// ─── findMembreOverlaps ────────────────────────────────────────────────────

describe('findMembreOverlaps', () => {
  it('retourne les paires de créneaux où le membre est en conflit', () => {
    const creneaux = [
      { id: 'c1', heure_debut_min: 540, heure_fin_min: 720, member_ids: ['M1'] },
      { id: 'c2', heure_debut_min: 600, heure_fin_min: 840, member_ids: ['M1', 'M2'] },
      { id: 'c3', heure_debut_min: 840, heure_fin_min: 1020, member_ids: ['M1'] },
    ]
    const conflicts = findMembreOverlaps('M1', creneaux)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0][0].id).toBe('c1')
    expect(conflicts[0][1].id).toBe('c2')
  })

  it('gère inputs vides ou null', () => {
    expect(findMembreOverlaps(null, [])).toEqual([])
    expect(findMembreOverlaps('M1', null)).toEqual([])
  })
})

// ─── effectiveCouleurCreneau ───────────────────────────────────────────────

describe('effectiveCouleurCreneau', () => {
  it('utilise couleur override si présente et valide', () => {
    expect(effectiveCouleurCreneau({ couleur: '#FF0000', type: 'install' }))
      .toBe('#FF0000')
  })

  it('ajoute # si manquant', () => {
    expect(effectiveCouleurCreneau({ couleur: 'FF0000', type: 'install' }))
      .toBe('#FF0000')
  })

  it('fallback sur la couleur du type si pas d\'override', () => {
    expect(effectiveCouleurCreneau({ type: 'install' }))
      .toBe(CRENEAU_TYPE_COLORS.install)
  })

  it('fallback sur autre si type inconnu', () => {
    expect(effectiveCouleurCreneau({ type: 'inconnu' }))
      .toBe(CRENEAU_TYPE_COLORS.autre)
    expect(effectiveCouleurCreneau({}))
      .toBe(CRENEAU_TYPE_COLORS.autre)
  })

  it('rejette les couleurs invalides comme override', () => {
    expect(effectiveCouleurCreneau({ couleur: 'xyz', type: 'install' }))
      .toBe(CRENEAU_TYPE_COLORS.install)
    expect(effectiveCouleurCreneau({ couleur: '', type: 'install' }))
      .toBe(CRENEAU_TYPE_COLORS.install)
  })
})

// ─── sortCreneauxByTime (V0.5 — INT minutes) ───────────────────────────────

describe('sortCreneauxByTime', () => {
  it('trie par heure_debut_min croissant', () => {
    const creneaux = [
      { id: 'c1', heure_debut_min: 840 },
      { id: 'c2', heure_debut_min: 540 },
      { id: 'c3', heure_debut_min: 660 },
    ]
    const sorted = sortCreneauxByTime(creneaux)
    expect(sorted.map((c) => c.id)).toEqual(['c2', 'c3', 'c1'])
  })

  it('utilise sort_order comme tiebreaker', () => {
    const creneaux = [
      { id: 'c1', heure_debut_min: 540, sort_order: 2 },
      { id: 'c2', heure_debut_min: 540, sort_order: 1 },
    ]
    const sorted = sortCreneauxByTime(creneaux)
    expect(sorted.map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('ne mute pas l\'array source', () => {
    const creneaux = [
      { id: 'c1', heure_debut_min: 840 },
      { id: 'c2', heure_debut_min: 540 },
    ]
    const before = creneaux.map((c) => c.id)
    sortCreneauxByTime(creneaux)
    expect(creneaux.map((c) => c.id)).toEqual(before)
  })

  it('gère array vide ou null', () => {
    expect(sortCreneauxByTime([])).toEqual([])
    expect(sortCreneauxByTime(null)).toEqual([])
    expect(sortCreneauxByTime(undefined)).toEqual([])
  })
})

// ─── defaultLaneLibelle ────────────────────────────────────────────────────

describe('defaultLaneLibelle', () => {
  it('retourne les libellés par défaut', () => {
    expect(defaultLaneLibelle(0)).toBe('Global')
    expect(defaultLaneLibelle(1)).toBe('Équipe A')
    expect(defaultLaneLibelle(4)).toBe('Équipe D')
  })

  it('fallback générique pour sort_order inconnu', () => {
    expect(defaultLaneLibelle(5)).toBe('Lane 6')
  })

  it('garde la map cohérente avec la constante', () => {
    expect(DEFAULT_LANE_LIBELLES[0]).toBe('Global')
  })
})

// ─── membresPresentsJour ───────────────────────────────────────────────────

describe('membresPresentsJour', () => {
  const membres = [
    { id: 'M1', presence_days: ['2026-05-13', '2026-05-14'] },
    { id: 'M2', presence_days: ['2026-05-13'] },
    { id: 'M3', presence_days: [] },
    { id: 'M4' },
    { id: 'M5', presence_days: ['2026-05-14'] },
  ]

  it('retourne les membres présents un jour donné', () => {
    const r = membresPresentsJour(membres, '2026-05-13')
    expect(r.map((m) => m.id).sort()).toEqual(['M1', 'M2'])
  })

  it('gère inputs vides', () => {
    expect(membresPresentsJour([], '2026-05-13')).toEqual([])
    expect(membresPresentsJour(null, '2026-05-13')).toEqual([])
    expect(membresPresentsJour(membres, null)).toEqual([])
  })
})

// ─── suggestPresenceCreneaux (V0.5 — produit INT minutes) ──────────────────

describe('suggestPresenceCreneaux', () => {
  it('génère des créneaux Présence avec horaires en INT minutes', () => {
    const membres = [
      {
        id: 'M1', prenom: 'Alice', nom: 'A',
        presence_days: ['2026-05-13'],
        arrival_time: '08:30', departure_time: '19:00',
      },
      {
        id: 'M2', prenom: 'Bob', nom: 'B',
        presence_days: ['2026-05-13'],
        arrival_time: '10:00', departure_time: '14:00',
      },
    ]
    const creneaux = suggestPresenceCreneaux(membres, '2026-05-13', 'LANE_GLOBAL')
    expect(creneaux).toHaveLength(2)
    expect(creneaux[0]).toMatchObject({
      heure_debut_min: 510,    // 08:30
      heure_fin_min: 1140,     // 19:00
      lane_id: 'LANE_GLOBAL',
      multi_lane: false,
      titre: 'Présence Alice A',
      type: 'autre',
      member_ids: ['M1'],
    })
    expect(creneaux[1].titre).toBe('Présence Bob B')
    expect(creneaux[1].heure_debut_min).toBe(600)   // 10:00
    expect(creneaux[1].heure_fin_min).toBe(840)     // 14:00
  })

  it('skip les membres sans horaires définis', () => {
    const membres = [
      { id: 'M1', presence_days: ['2026-05-13'] },
    ]
    expect(suggestPresenceCreneaux(membres, '2026-05-13', 'L0')).toEqual([])
  })

  it('défauts si arrival/departure manquant', () => {
    const membres = [
      {
        id: 'M1', prenom: 'Alice', nom: 'A',
        presence_days: ['2026-05-13'],
        arrival_time: '08:30',
      },
    ]
    const creneaux = suggestPresenceCreneaux(membres, '2026-05-13', 'L0')
    expect(creneaux).toHaveLength(1)
    expect(creneaux[0].heure_debut_min).toBe(510)   // 08:30
    expect(creneaux[0].heure_fin_min).toBe(1080)    // 18:00 default
  })

  it('skip les membres pas présents ce jour', () => {
    const membres = [
      {
        id: 'M1',
        presence_days: ['2026-05-12'],
        arrival_time: '08:30', departure_time: '19:00',
      },
    ]
    expect(suggestPresenceCreneaux(membres, '2026-05-13', 'L0')).toEqual([])
  })

  it('gère prenom/nom manquants', () => {
    const membres = [
      {
        id: 'M1',
        presence_days: ['2026-05-13'],
        arrival_time: '08:30', departure_time: '19:00',
      },
    ]
    const creneaux = suggestPresenceCreneaux(membres, '2026-05-13', 'L0')
    expect(creneaux[0].titre).toBe('Présence')
  })
})

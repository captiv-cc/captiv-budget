// Tests unitaires des helpers purs de lib/deroule.js
// (CRUD côté Supabase pas testés ici — couverts par smoke tests UI plus tard)

import { describe, it, expect } from 'vitest'
import {
  CRENEAU_TYPES,
  CRENEAU_TYPE_COLORS,
  DEFAULT_LANE_LIBELLES,
  MAX_LANES,
  timeToMinutes,
  minutesToTime,
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

// ─── timeToMinutes ─────────────────────────────────────────────────────────

describe('timeToMinutes', () => {
  it('parse HH:MM correctement', () => {
    expect(timeToMinutes('00:00')).toBe(0)
    expect(timeToMinutes('09:30')).toBe(570)
    expect(timeToMinutes('23:59')).toBe(1439)
  })

  it('parse HH:MM:SS en ignorant les secondes', () => {
    expect(timeToMinutes('09:30:45')).toBe(570)
    expect(timeToMinutes('09:30:00')).toBe(570)
  })

  it('accepte les heures 0-padded ou non', () => {
    expect(timeToMinutes('9:30')).toBe(570)
    expect(timeToMinutes('09:30')).toBe(570)
  })

  it('retourne NaN pour les formats invalides', () => {
    expect(timeToMinutes('foo')).toBeNaN()
    expect(timeToMinutes('25:60')).toBeNaN()
    expect(timeToMinutes('')).toBeNaN()
    expect(timeToMinutes(null)).toBeNaN()
    expect(timeToMinutes(undefined)).toBeNaN()
    expect(timeToMinutes(123)).toBeNaN()
  })

  it('accepte les heures > 23 (le caller filtre)', () => {
    expect(timeToMinutes('25:00')).toBe(1500)
  })
})

// ─── minutesToTime ─────────────────────────────────────────────────────────

describe('minutesToTime', () => {
  it('formate les minutes en HH:MM zero-padded', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(570)).toBe('09:30')
    expect(minutesToTime(1439)).toBe('23:59')
  })

  it('floor les fractions de minute', () => {
    expect(minutesToTime(570.7)).toBe('09:30')
  })

  it('gère 0 et grandes valeurs', () => {
    expect(minutesToTime(0)).toBe('00:00')
    expect(minutesToTime(1500)).toBe('25:00')
  })

  it('retourne 00:00 pour les valeurs invalides', () => {
    expect(minutesToTime(-1)).toBe('00:00')
    expect(minutesToTime(NaN)).toBe('00:00')
    expect(minutesToTime('foo')).toBe('00:00')
    expect(minutesToTime(null)).toBe('00:00')
  })

  it('roundtrip avec timeToMinutes', () => {
    const samples = ['00:00', '09:30', '14:45', '23:59']
    for (const t of samples) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t)
    }
  })
})

// ─── snapToStep ────────────────────────────────────────────────────────────

describe('snapToStep', () => {
  it('snap au pas de 15 min', () => {
    expect(snapToStep(577, 15)).toBe(585) // 09:37 → 09:45
    expect(snapToStep(572, 15)).toBe(570) // 09:32 → 09:30
    expect(snapToStep(0, 15)).toBe(0)
  })

  it('snap au pas de 5 min', () => {
    expect(snapToStep(572, 5)).toBe(570) // 09:32 → 09:30
    expect(snapToStep(573, 5)).toBe(575) // 09:33 → 09:35
  })

  it('snap au pas de 30 min', () => {
    expect(snapToStep(585, 30)).toBe(600) // 09:45 → 10:00
    expect(snapToStep(584, 30)).toBe(570) // 09:44 → 09:30
  })

  it('retourne la valeur inchangée pour step <= 0 ou inputs invalides', () => {
    expect(snapToStep(577, 0)).toBe(577)
    expect(snapToStep(577, -5)).toBe(577)
    expect(snapToStep(NaN, 15)).toBeNaN()
  })

  it('snap exact préserve la valeur', () => {
    expect(snapToStep(570, 15)).toBe(570)
    expect(snapToStep(570, 5)).toBe(570)
  })
})

// ─── creneauDureeMin ───────────────────────────────────────────────────────

describe('creneauDureeMin', () => {
  it('retourne la durée correcte', () => {
    expect(creneauDureeMin({ heure_debut: '09:00', heure_fin: '10:00' })).toBe(60)
    expect(creneauDureeMin({ heure_debut: '09:00', heure_fin: '09:30' })).toBe(30)
    expect(creneauDureeMin({ heure_debut: '14:00', heure_fin: '17:00' })).toBe(180)
  })

  it('retourne 0 si invalide', () => {
    expect(creneauDureeMin({})).toBe(0)
    expect(creneauDureeMin(null)).toBe(0)
    expect(creneauDureeMin({ heure_debut: 'foo', heure_fin: '10:00' })).toBe(0)
    expect(creneauDureeMin({ heure_debut: '10:00', heure_fin: '09:00' })).toBe(0)
    expect(creneauDureeMin({ heure_debut: '10:00', heure_fin: '10:00' })).toBe(0)
  })
})

// ─── creneauxOverlap ───────────────────────────────────────────────────────

describe('creneauxOverlap', () => {
  it('détecte un chevauchement classique', () => {
    expect(creneauxOverlap(
      { heure_debut: '09:00', heure_fin: '10:00' },
      { heure_debut: '09:30', heure_fin: '10:30' },
    )).toBe(true)
  })

  it('détecte un créneau dans un autre', () => {
    expect(creneauxOverlap(
      { heure_debut: '09:00', heure_fin: '12:00' },
      { heure_debut: '10:00', heure_fin: '11:00' },
    )).toBe(true)
  })

  it('ne flag pas deux créneaux qui se touchent', () => {
    expect(creneauxOverlap(
      { heure_debut: '09:00', heure_fin: '10:00' },
      { heure_debut: '10:00', heure_fin: '11:00' },
    )).toBe(false)
  })

  it('ne flag pas deux créneaux disjoints', () => {
    expect(creneauxOverlap(
      { heure_debut: '09:00', heure_fin: '10:00' },
      { heure_debut: '14:00', heure_fin: '15:00' },
    )).toBe(false)
  })

  it('symétrique', () => {
    const a = { heure_debut: '09:00', heure_fin: '10:00' }
    const b = { heure_debut: '09:30', heure_fin: '10:30' }
    expect(creneauxOverlap(a, b)).toBe(creneauxOverlap(b, a))
  })

  it('retourne false pour des inputs invalides', () => {
    expect(creneauxOverlap({}, {})).toBe(false)
    expect(creneauxOverlap(null, null)).toBe(false)
    expect(creneauxOverlap(
      { heure_debut: 'foo', heure_fin: '10:00' },
      { heure_debut: '09:00', heure_fin: '10:00' },
    )).toBe(false)
  })
})

// ─── findMembreOverlaps ────────────────────────────────────────────────────

describe('findMembreOverlaps', () => {
  it('retourne les paires de créneaux où le membre est en conflit', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '09:00', heure_fin: '12:00', member_ids: ['M1'] },
      { id: 'c2', heure_debut: '10:00', heure_fin: '14:00', member_ids: ['M1', 'M2'] },
      { id: 'c3', heure_debut: '14:00', heure_fin: '17:00', member_ids: ['M1'] },
    ]
    const conflicts = findMembreOverlaps('M1', creneaux)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0][0].id).toBe('c1')
    expect(conflicts[0][1].id).toBe('c2')
  })

  it('retourne tableau vide si aucun conflit', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '09:00', heure_fin: '12:00', member_ids: ['M1'] },
      { id: 'c2', heure_debut: '14:00', heure_fin: '17:00', member_ids: ['M1'] },
    ]
    expect(findMembreOverlaps('M1', creneaux)).toEqual([])
  })

  it('ignore les créneaux sans le membre', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '09:00', heure_fin: '12:00', member_ids: ['M2'] },
      { id: 'c2', heure_debut: '10:00', heure_fin: '14:00', member_ids: ['M2'] },
    ]
    expect(findMembreOverlaps('M1', creneaux)).toEqual([])
  })

  it('gère inputs vides ou null', () => {
    expect(findMembreOverlaps(null, [])).toEqual([])
    expect(findMembreOverlaps('M1', null)).toEqual([])
    expect(findMembreOverlaps('M1', [])).toEqual([])
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
    expect(effectiveCouleurCreneau({ type: 'live' }))
      .toBe(CRENEAU_TYPE_COLORS.live)
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

// ─── sortCreneauxByTime ────────────────────────────────────────────────────

describe('sortCreneauxByTime', () => {
  it('trie par heure_debut croissant', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '14:00' },
      { id: 'c2', heure_debut: '09:00' },
      { id: 'c3', heure_debut: '11:00' },
    ]
    const sorted = sortCreneauxByTime(creneaux)
    expect(sorted.map((c) => c.id)).toEqual(['c2', 'c3', 'c1'])
  })

  it('utilise sort_order comme tiebreaker', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '09:00', sort_order: 2 },
      { id: 'c2', heure_debut: '09:00', sort_order: 1 },
    ]
    const sorted = sortCreneauxByTime(creneaux)
    expect(sorted.map((c) => c.id)).toEqual(['c2', 'c1'])
  })

  it('ne mute pas l\'array source', () => {
    const creneaux = [
      { id: 'c1', heure_debut: '14:00' },
      { id: 'c2', heure_debut: '09:00' },
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
    expect(defaultLaneLibelle(2)).toBe('Équipe B')
    expect(defaultLaneLibelle(3)).toBe('Équipe C')
    expect(defaultLaneLibelle(4)).toBe('Équipe D')
  })

  it('fallback générique pour sort_order inconnu', () => {
    expect(defaultLaneLibelle(5)).toBe('Lane 6')
    expect(defaultLaneLibelle(99)).toBe('Lane 100')
  })

  it('garde la map cohérente avec la constante', () => {
    expect(DEFAULT_LANE_LIBELLES[0]).toBe('Global')
    expect(DEFAULT_LANE_LIBELLES[4]).toBe('Équipe D')
  })
})

// ─── membresPresentsJour ───────────────────────────────────────────────────

describe('membresPresentsJour', () => {
  const membres = [
    { id: 'M1', nom: 'A', presence_days: ['2026-05-13', '2026-05-14'] },
    { id: 'M2', nom: 'B', presence_days: ['2026-05-13'] },
    { id: 'M3', nom: 'C', presence_days: [] },
    { id: 'M4', nom: 'D' /* presence_days undef */ },
    { id: 'M5', nom: 'E', presence_days: ['2026-05-14'] },
  ]

  it('retourne les membres présents un jour donné', () => {
    const r = membresPresentsJour(membres, '2026-05-13')
    expect(r.map((m) => m.id).sort()).toEqual(['M1', 'M2'])
  })

  it('retourne tableau vide si jour sans personne', () => {
    expect(membresPresentsJour(membres, '2026-12-25')).toEqual([])
  })

  it('gère membres sans presence_days', () => {
    const r = membresPresentsJour(membres, '2026-05-14')
    expect(r.map((m) => m.id).sort()).toEqual(['M1', 'M5'])
  })

  it('gère inputs vides', () => {
    expect(membresPresentsJour([], '2026-05-13')).toEqual([])
    expect(membresPresentsJour(null, '2026-05-13')).toEqual([])
    expect(membresPresentsJour(membres, null)).toEqual([])
    expect(membresPresentsJour(membres, '')).toEqual([])
  })
})

// ─── suggestPresenceCreneaux ───────────────────────────────────────────────

describe('suggestPresenceCreneaux', () => {
  it('génère des créneaux Présence pour les membres avec horaires', () => {
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
      heure_debut: '08:30',
      heure_fin: '19:00',
      lane_id: 'LANE_GLOBAL',
      multi_lane: false,
      titre: 'Présence Alice A',
      type: 'autre',
      member_ids: ['M1'],
    })
    expect(creneaux[1].titre).toBe('Présence Bob B')
  })

  it('skip les membres sans horaires définis', () => {
    const membres = [
      {
        id: 'M1', prenom: 'Sans', nom: 'Heures',
        presence_days: ['2026-05-13'],
      },
    ]
    expect(suggestPresenceCreneaux(membres, '2026-05-13', 'L0')).toEqual([])
  })

  it('inclut les membres avec arrival OU departure (pas besoin des deux)', () => {
    const membres = [
      {
        id: 'M1', prenom: 'Alice', nom: 'A',
        presence_days: ['2026-05-13'],
        arrival_time: '08:30',
      },
    ]
    const creneaux = suggestPresenceCreneaux(membres, '2026-05-13', 'L0')
    expect(creneaux).toHaveLength(1)
    expect(creneaux[0].heure_debut).toBe('08:30')
    expect(creneaux[0].heure_fin).toBe('18:00') // default departure
  })

  it('skip les membres pas présents ce jour', () => {
    const membres = [
      {
        id: 'M1', prenom: 'Alice', nom: 'A',
        presence_days: ['2026-05-12'], // pas le 13
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

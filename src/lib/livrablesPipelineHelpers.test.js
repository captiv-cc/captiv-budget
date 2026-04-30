/**
 * Tests unitaires — LIV-22a : helpers purs de la vue Pipeline / Gantt.
 */
import { describe, it, expect } from 'vitest'
import {
  PIPELINE_KIND_ORDER,
  computeWindowFromEtapes,
  etapesToTimelineEvents,
  filterEtapesForLivrable,
  groupEtapesByEventType,
  groupEtapesByKind,
  groupEtapesByLivrable,
} from './livrablesPipelineHelpers.js'

const FAKE_NOW = new Date('2026-04-30T10:00:00Z')

describe('etapesToTimelineEvents', () => {
  it('exclut les étapes sans date_debut', () => {
    const etapes = [
      { id: 'a', date_debut: null, kind: 'montage' },
      { id: 'b', date_debut: '2026-05-01', kind: 'montage' },
    ]
    const res = etapesToTimelineEvents(etapes)
    expect(res).toHaveLength(1)
    expect(res[0].id).toBe('b')
  })

  it('si date_fin manque → date_fin = date_debut (durée 1 jour)', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-01', date_fin: null, kind: 'da' }]
    const res = etapesToTimelineEvents(etapes)
    const start = new Date(res[0].starts_at)
    const end = new Date(res[0].ends_at)
    const diffMs = end.getTime() - start.getTime()
    expect(diffMs).toBe(24 * 3600 * 1000)
  })

  it('starts_at à minuit, ends_at à minuit jour suivant (exclusive)', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-01', date_fin: '2026-05-03', kind: 'montage' }]
    const res = etapesToTimelineEvents(etapes)
    expect(new Date(res[0].starts_at).getHours()).toBe(0)
    expect(new Date(res[0].ends_at).getDate()).toBe(4) // 3 mai + 1 = 4 mai
    const diffDays =
      (new Date(res[0].ends_at).getTime() - new Date(res[0].starts_at).getTime()) /
      (24 * 3600 * 1000)
    expect(diffDays).toBe(3)
  })

  it('enrichit avec les infos du livrable parent', () => {
    const livrablesById = new Map([
      ['L1', { id: 'L1', numero: '1', nom: 'Teaser', block_id: 'B1', sort_order: 0 }],
    ])
    const etapes = [{ id: 'a', date_debut: '2026-05-01', livrable_id: 'L1', kind: 'montage' }]
    const res = etapesToTimelineEvents(etapes, livrablesById)
    expect(res[0].livrable_numero).toBe('1')
    expect(res[0].livrable_nom).toBe('Teaser')
    expect(res[0].livrable_block_id).toBe('B1')
  })

  it('kind par défaut = "autre" si manquant', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-01', kind: null }]
    const res = etapesToTimelineEvents(etapes)
    expect(res[0].kind).toBe('autre')
  })

  it('skip les étapes avec date invalide', () => {
    const etapes = [{ id: 'a', date_debut: 'pas-une-date' }]
    const res = etapesToTimelineEvents(etapes)
    expect(res).toHaveLength(0)
  })

  it('eventTypesById : enrichit avec event_type ({ id, label, color })', () => {
    const eventTypesById = new Map([
      ['T1', { id: 'T1', label: 'Dérush', color: '#ff0000', slug: 'derush' }],
    ])
    const etapes = [{ id: 'a', date_debut: '2026-05-01', event_type_id: 'T1', kind: 'autre' }]
    const res = etapesToTimelineEvents(etapes, new Map(), eventTypesById)
    expect(res[0].event_type).toEqual({ id: 'T1', label: 'Dérush', color: '#ff0000' })
  })

  it('event_type = null si event_type_id absent', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-01', kind: 'montage' }]
    const res = etapesToTimelineEvents(etapes)
    expect(res[0].event_type).toBeNull()
  })

  it('event_type = null si event_type_id non trouvé dans la Map', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-01', event_type_id: 'INCONNU' }]
    const res = etapesToTimelineEvents(etapes, new Map(), new Map())
    expect(res[0].event_type).toBeNull()
  })

  it('eventType sans label tombe sur le slug', () => {
    const eventTypesById = new Map([
      ['T1', { id: 'T1', label: null, color: '#abc', slug: 'mon-type' }],
    ])
    const etapes = [{ id: 'a', date_debut: '2026-05-01', event_type_id: 'T1' }]
    const res = etapesToTimelineEvents(etapes, new Map(), eventTypesById)
    expect(res[0].event_type.label).toBe('mon-type')
  })
})

describe('computeWindowFromEtapes', () => {
  it('fenêtre par défaut si vide [today-7 ; today+30]', () => {
    const w = computeWindowFromEtapes([], { now: FAKE_NOW })
    expect(w.daysCount).toBe(37)
  })

  it('fenêtre par défaut si toutes invalides', () => {
    const w = computeWindowFromEtapes([{ id: 'x', date_debut: null }], { now: FAKE_NOW })
    expect(w.daysCount).toBe(37)
  })

  it('englobe min/max + padding 7 jours', () => {
    const etapes = [
      { id: 'a', date_debut: '2026-05-10', date_fin: '2026-05-12' },
      { id: 'b', date_debut: '2026-05-20', date_fin: '2026-05-25' },
    ]
    const w = computeWindowFromEtapes(etapes, { paddingDays: 7, now: FAKE_NOW })
    // start = 2026-05-10 - 7 j = 2026-05-03
    expect(w.start.getDate()).toBe(3)
    expect(w.start.getMonth()).toBe(4) // mai = 4 (0-indexed)
    // end = (2026-05-25 + 1) + 7 j = 2026-06-02
    expect(w.end.getDate()).toBe(2)
    expect(w.end.getMonth()).toBe(5) // juin
  })

  it('respecte paddingDays personnalisé', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-15' }]
    const w = computeWindowFromEtapes(etapes, { paddingDays: 0, now: FAKE_NOW })
    expect(w.start.getDate()).toBe(15)
  })

  it('extraDates : étend la fenêtre pour englober une deadline', () => {
    const etapes = [{ id: 'a', date_debut: '2026-05-10', date_fin: '2026-05-12' }]
    // Deadline 2026-06-15 → bien plus tard que les étapes
    const w = computeWindowFromEtapes(etapes, {
      paddingDays: 0,
      extraDates: ['2026-06-15'],
      now: FAKE_NOW,
    })
    // end >= 2026-06-16 (lendemain de la deadline)
    expect(w.end.getMonth()).toBe(5) // juin
    expect(w.end.getDate()).toBeGreaterThanOrEqual(16)
  })

  it('extraDates accepte des Date natives', () => {
    const w = computeWindowFromEtapes([], {
      paddingDays: 0,
      extraDates: [new Date(2026, 5, 1)], // 2026-06-01
      now: FAKE_NOW,
    })
    // start <= 2026-06-01 (la fenêtre par défaut empty est pas appliquée car
    // on a une extraDate)
    expect(w.start.getMonth()).toBeLessThanOrEqual(5)
  })

  it('includeToday: true → today est dans la fenêtre', () => {
    const etapes = [{ id: 'a', date_debut: '2026-06-01', date_fin: '2026-06-03' }]
    const w = computeWindowFromEtapes(etapes, {
      paddingDays: 0,
      includeToday: true,
      now: FAKE_NOW, // 2026-04-30
    })
    // start <= 2026-04-30 (today doit être dans la fenêtre)
    const todayTs = new Date(2026, 3, 30).getTime()
    expect(w.start.getTime()).toBeLessThanOrEqual(todayTs)
  })

  it('extraDates ignore les valeurs invalides', () => {
    const w = computeWindowFromEtapes([{ id: 'a', date_debut: '2026-05-15' }], {
      paddingDays: 0,
      extraDates: [null, '', 'pas-une-date', undefined],
      now: FAKE_NOW,
    })
    expect(w.start.getDate()).toBe(15)
  })
})

describe('groupEtapesByLivrable', () => {
  const livrables = [
    { id: 'L1', numero: '1', nom: 'Teaser', block_id: 'B1', sort_order: 0 },
    { id: 'L2', numero: '2', nom: 'MASTER', block_id: 'B1', sort_order: 1 },
    { id: 'L3', numero: '3', nom: 'Bonus', block_id: 'B2', sort_order: 0 },
  ]
  const blockOrderById = new Map([
    ['B1', 0],
    ['B2', 1],
  ])
  const events = [
    { id: 'e1', livrable_id: 'L1', kind: 'montage' },
    { id: 'e2', livrable_id: 'L2', kind: 'montage' },
    { id: 'e3', livrable_id: 'L1', kind: 'da' },
    { id: 'e4', livrable_id: 'L3', kind: 'sound' },
  ]

  it('groupe par livrable', () => {
    const lanes = groupEtapesByLivrable(events, livrables, blockOrderById)
    expect(lanes).toHaveLength(3)
    expect(lanes.find((l) => l.key === 'L1').events).toHaveLength(2)
  })

  it('ordre : block_id puis livrable.sort_order', () => {
    const lanes = groupEtapesByLivrable(events, livrables, blockOrderById)
    expect(lanes.map((l) => l.key)).toEqual(['L1', 'L2', 'L3'])
  })

  it('label = "numero · nom"', () => {
    const lanes = groupEtapesByLivrable(events, livrables, blockOrderById)
    expect(lanes[0].label).toBe('1 · Teaser')
  })

  it('skip les events orphelins (livrable inexistant)', () => {
    const orphan = [...events, { id: 'eX', livrable_id: 'INCONNU' }]
    const lanes = groupEtapesByLivrable(orphan, livrables, blockOrderById)
    expect(lanes).toHaveLength(3)
  })

  it('skip les livrables sans étape (default includeEmpty=false)', () => {
    const lanes = groupEtapesByLivrable([events[0]], livrables, blockOrderById)
    expect(lanes).toHaveLength(1)
    expect(lanes[0].key).toBe('L1')
  })

  it('avec includeEmpty=true : tous les livrables, même sans étape', () => {
    const lanes = groupEtapesByLivrable([events[0]], livrables, blockOrderById, {
      includeEmpty: true,
    })
    expect(lanes).toHaveLength(3)
    expect(lanes.map((l) => l.key)).toEqual(['L1', 'L2', 'L3'])
    // L2 et L3 ont des events vides
    expect(lanes.find((l) => l.key === 'L2').events).toEqual([])
    expect(lanes.find((l) => l.key === 'L3').events).toEqual([])
  })

  it('avec includeEmpty=true : tri respecté même si tous les livrables vides', () => {
    const lanes = groupEtapesByLivrable([], livrables, blockOrderById, {
      includeEmpty: true,
    })
    expect(lanes.map((l) => l.key)).toEqual(['L1', 'L2', 'L3'])
  })

  it('blocksById : préfixe le numero avec le préfixe du bloc parent', () => {
    const blocksById = new Map([
      ['B1', { id: 'B1', prefixe: 'A' }],
      ['B2', { id: 'B2', prefixe: 'B' }],
    ])
    const lanes = groupEtapesByLivrable(events, livrables, blockOrderById, {
      blocksById,
    })
    expect(lanes.find((l) => l.key === 'L1').label).toBe('A1 · Teaser')
    expect(lanes.find((l) => l.key === 'L2').label).toBe('A2 · MASTER')
    expect(lanes.find((l) => l.key === 'L3').label).toBe('B3 · Bonus')
  })

  it('blocksById : déduplique si le numero contient déjà le préfixe', () => {
    const livrablesPrefixed = [
      { id: 'L1', numero: 'A1', nom: 'Teaser', block_id: 'B1', sort_order: 0 },
    ]
    const blocksById = new Map([['B1', { id: 'B1', prefixe: 'A' }]])
    const lanes = groupEtapesByLivrable(
      [{ id: 'e1', livrable_id: 'L1', kind: 'montage' }],
      livrablesPrefixed,
      blockOrderById,
      { blocksById },
    )
    // Pas de "AA1", on garde "A1"
    expect(lanes[0].label).toBe('A1 · Teaser')
  })

  it('sans blocksById : fallback sur numero brut (rétro-compat)', () => {
    const lanes = groupEtapesByLivrable(events, livrables, blockOrderById)
    expect(lanes[0].label).toBe('1 · Teaser')
  })
})

describe('groupEtapesByKind', () => {
  it('respecte l\'ordre canonique PIPELINE_KIND_ORDER', () => {
    const events = [
      { id: 'a', kind: 'montage' },
      { id: 'b', kind: 'production' },
      { id: 'c', kind: 'sound' },
      { id: 'd', kind: 'da' },
    ]
    const lanes = groupEtapesByKind(events)
    expect(lanes.map((l) => l.key)).toEqual(['production', 'da', 'montage', 'sound'])
  })

  it('exclut les kinds vides', () => {
    const events = [{ id: 'a', kind: 'montage' }]
    const lanes = groupEtapesByKind(events)
    expect(lanes).toHaveLength(1)
    expect(lanes[0].key).toBe('montage')
  })

  it('inclut les kinds non canoniques à la fin', () => {
    const events = [
      { id: 'a', kind: 'montage' },
      { id: 'b', kind: 'mystery_kind' },
    ]
    const lanes = groupEtapesByKind(events)
    expect(lanes.map((l) => l.key)).toEqual(['montage', 'mystery_kind'])
  })

  it('label et color depuis LIVRABLE_ETAPE_KINDS', () => {
    const events = [{ id: 'a', kind: 'montage' }]
    const lanes = groupEtapesByKind(events)
    expect(lanes[0].label).toBe('Montage')
    expect(lanes[0].color).toBeTruthy()
  })
})

describe('filterEtapesForLivrable', () => {
  const events = [
    { id: 'a', livrable_id: 'L1' },
    { id: 'b', livrable_id: 'L2' },
    { id: 'c', livrable_id: 'L1' },
  ]

  it('filtre sur livrable_id', () => {
    expect(filterEtapesForLivrable(events, 'L1').map((e) => e.id)).toEqual(['a', 'c'])
  })

  it('renvoie [] si livrableId vide', () => {
    expect(filterEtapesForLivrable(events, null)).toEqual([])
    expect(filterEtapesForLivrable(events, '')).toEqual([])
  })
})

describe('groupEtapesByEventType', () => {
  const eventTypesById = new Map([
    ['T_DERUSH', { id: 'T_DERUSH', label: 'Dérush', color: '#ff0000' }],
    ['T_MONTAGE', { id: 'T_MONTAGE', label: 'Montage', color: '#00ff00' }],
    ['T_ETALO', { id: 'T_ETALO', label: 'Étalonnage', color: '#0000ff' }],
  ])

  it('1 lane par event_type utilisé', () => {
    const events = [
      { id: 'e1', starts_at: '2026-05-10T00:00:00.000Z', event_type: { id: 'T_DERUSH', label: 'Dérush', color: '#ff0000' } },
      { id: 'e2', starts_at: '2026-05-12T00:00:00.000Z', event_type: { id: 'T_MONTAGE', label: 'Montage', color: '#00ff00' } },
      { id: 'e3', starts_at: '2026-05-15T00:00:00.000Z', event_type: { id: 'T_DERUSH', label: 'Dérush', color: '#ff0000' } },
    ]
    const lanes = groupEtapesByEventType(events, eventTypesById)
    expect(lanes).toHaveLength(2)
    expect(lanes.find((l) => l.key === 'T_DERUSH').events).toHaveLength(2)
    expect(lanes.find((l) => l.key === 'T_MONTAGE').events).toHaveLength(1)
  })

  it('tri par première apparition (date_debut min)', () => {
    const events = [
      { id: 'e1', starts_at: '2026-05-20T00:00:00.000Z', event_type: { id: 'T_MONTAGE', label: 'Montage', color: '#00ff00' } },
      { id: 'e2', starts_at: '2026-05-10T00:00:00.000Z', event_type: { id: 'T_DERUSH', label: 'Dérush', color: '#ff0000' } },
      { id: 'e3', starts_at: '2026-05-25T00:00:00.000Z', event_type: { id: 'T_ETALO', label: 'Étalonnage', color: '#0000ff' } },
    ]
    const lanes = groupEtapesByEventType(events, eventTypesById)
    // Dérush (10/05) avant Montage (20/05) avant Étalo (25/05)
    expect(lanes.map((l) => l.key)).toEqual(['T_DERUSH', 'T_MONTAGE', 'T_ETALO'])
  })

  it('"Sans type" toujours en queue', () => {
    const events = [
      { id: 'e1', starts_at: '2026-05-01T00:00:00.000Z', _etape: { event_type_id: null } },
      { id: 'e2', starts_at: '2026-05-15T00:00:00.000Z', event_type: { id: 'T_MONTAGE', label: 'Montage', color: '#00ff00' } },
    ]
    const lanes = groupEtapesByEventType(events, eventTypesById)
    // L'étape sans type est la 1ère chronologiquement, mais la lane "untyped"
    // doit rester en queue.
    expect(lanes.map((l) => l.key)).toEqual(['T_MONTAGE', 'untyped'])
    expect(lanes.find((l) => l.key === 'untyped').label).toBe('Sans type')
  })

  it('utilise event_type embarqué (label + color) en priorité sur la Map', () => {
    const events = [
      {
        id: 'e1',
        starts_at: '2026-05-10T00:00:00.000Z',
        event_type: { id: 'T_DERUSH', label: 'Dérush prod', color: '#aa0000' },
      },
    ]
    // La Map dit "Dérush" / "#ff0000" mais l'event embarque "Dérush prod" / "#aa0000"
    const lanes = groupEtapesByEventType(events, eventTypesById)
    expect(lanes[0].label).toBe('Dérush prod')
    expect(lanes[0].color).toBe('#aa0000')
  })

  it('fallback sur la Map si event_type pas embarqué', () => {
    const events = [
      { id: 'e1', starts_at: '2026-05-10T00:00:00.000Z', _etape: { event_type_id: 'T_MONTAGE' } },
    ]
    const lanes = groupEtapesByEventType(events, eventTypesById)
    expect(lanes[0].label).toBe('Montage')
    expect(lanes[0].color).toBe('#00ff00')
  })

  it('liste vide → []', () => {
    expect(groupEtapesByEventType([], eventTypesById)).toEqual([])
  })

  it('exclut minDate de la sortie (interne au tri)', () => {
    const events = [
      { id: 'e1', starts_at: '2026-05-10T00:00:00.000Z', event_type: { id: 'T_DERUSH', label: 'Dérush', color: '#ff0000' } },
    ]
    const lanes = groupEtapesByEventType(events, eventTypesById)
    expect(lanes[0]).not.toHaveProperty('minDate')
  })
})

describe('PIPELINE_KIND_ORDER', () => {
  it('contient les 7 kinds dans l\'ordre du pipeline post-prod', () => {
    expect(PIPELINE_KIND_ORDER).toEqual([
      'production',
      'da',
      'montage',
      'sound',
      'delivery',
      'feedback',
      'autre',
    ])
  })
})

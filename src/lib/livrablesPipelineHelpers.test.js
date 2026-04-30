/**
 * Tests unitaires — LIV-22a : helpers purs de la vue Pipeline / Gantt.
 */
import { describe, it, expect } from 'vitest'
import {
  PIPELINE_KIND_ORDER,
  computeWindowFromEtapes,
  etapesToTimelineEvents,
  filterEtapesForLivrable,
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

  it('skip les livrables sans étape', () => {
    const lanes = groupEtapesByLivrable([events[0]], livrables, blockOrderById)
    expect(lanes).toHaveLength(1)
    expect(lanes[0].key).toBe('L1')
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

/**
 * Tests unitaires — LIV-4 : helpers purs livrablesPlanningSync.js
 * Vitest 2, pas de mock Supabase — on teste uniquement les fonctions pures
 * (la partie I/O est testée manuellement via l'app + backfillMirrorEvents).
 *
 * Couverture :
 *   - Dates : dateToDayStartIso / dateToDayEndExclusiveIso / isoToDate
 *             / isoExclusiveToDateInclusive
 *   - Classification : isEventMirror / isEtapeMirrorEvent / isPhaseMirrorEvent
 *   - Couleurs : etapeEventColor / phaseEventColor (override > kind > fallback)
 *   - Payloads : buildEtapeEventPayload / buildPhaseEventPayload
 *   - Patches : buildEtapeEventPatch / buildPhaseEventPatch (champs partiels)
 *   - Reverse : eventPatchToEtapePatch / eventPatchToPhasePatch
 *   - Diff : etapePatchAffectsEvent / phasePatchAffectsEvent
 *   - Should : shouldEtapeHaveEvent / shouldPhaseHaveEvent
 */
import { describe, it, expect } from 'vitest'
import {
  EVENT_SOURCE_MANUAL,
  EVENT_SOURCE_LIVRABLE_ETAPE,
  EVENT_SOURCE_PROJET_PHASE,
  dateToDayStartIso,
  dateToDayEndExclusiveIso,
  isoToDate,
  isoExclusiveToDateInclusive,
  isEventMirror,
  isEtapeMirrorEvent,
  isPhaseMirrorEvent,
  etapeEventColor,
  phaseEventColor,
  buildEtapeEventPayload,
  buildPhaseEventPayload,
  buildEtapeEventPatch,
  buildPhaseEventPatch,
  eventPatchToEtapePatch,
  eventPatchToPhasePatch,
  etapePatchAffectsEvent,
  phasePatchAffectsEvent,
  shouldEtapeHaveEvent,
  shouldPhaseHaveEvent,
} from './livrablesPlanningSync.js'

// ═══ Dates ═════════════════════════════════════════════════════════════════

describe('dateToDayStartIso', () => {
  it('convertit YYYY-MM-DD → ISO 00:00:00Z', () => {
    expect(dateToDayStartIso('2026-04-20')).toBe('2026-04-20T00:00:00.000Z')
  })

  it('tronque un timestamp DB (garde la date)', () => {
    expect(dateToDayStartIso('2026-04-20T15:30:00Z')).toBe('2026-04-20T00:00:00.000Z')
  })

  it('retourne null pour null / undefined / chaîne vide', () => {
    expect(dateToDayStartIso(null)).toBeNull()
    expect(dateToDayStartIso(undefined)).toBeNull()
    expect(dateToDayStartIso('')).toBeNull()
  })

  it('retourne null pour format invalide', () => {
    expect(dateToDayStartIso('20-04-2026')).toBeNull()
    expect(dateToDayStartIso('abc')).toBeNull()
  })
})

describe('dateToDayEndExclusiveIso', () => {
  it('convertit YYYY-MM-DD → ISO du jour SUIVANT 00:00:00Z', () => {
    expect(dateToDayEndExclusiveIso('2026-04-20')).toBe('2026-04-21T00:00:00.000Z')
  })

  it('gère le changement de mois', () => {
    expect(dateToDayEndExclusiveIso('2026-04-30')).toBe('2026-05-01T00:00:00.000Z')
  })

  it('gère le changement d\'année', () => {
    expect(dateToDayEndExclusiveIso('2026-12-31')).toBe('2027-01-01T00:00:00.000Z')
  })

  it('retourne null pour null / invalide', () => {
    expect(dateToDayEndExclusiveIso(null)).toBeNull()
    expect(dateToDayEndExclusiveIso('invalid')).toBeNull()
  })
})

describe('isoToDate', () => {
  it('extrait YYYY-MM-DD d\'un ISO timestamp', () => {
    expect(isoToDate('2026-04-20T00:00:00Z')).toBe('2026-04-20')
    expect(isoToDate('2026-04-20T15:30:45.123Z')).toBe('2026-04-20')
  })

  it('retourne null pour null / format invalide', () => {
    expect(isoToDate(null)).toBeNull()
    expect(isoToDate('')).toBeNull()
    expect(isoToDate('pas une date')).toBeNull()
  })
})

describe('isoExclusiveToDateInclusive', () => {
  it('soustrait 1 jour si l\'ISO est exactement à minuit UTC', () => {
    // 21 avril 00:00Z (exclusive) → 20 avril inclus
    expect(isoExclusiveToDateInclusive('2026-04-21T00:00:00.000Z')).toBe('2026-04-20')
  })

  it('garde la date telle quelle si l\'ISO n\'est pas à minuit (event non-all_day)', () => {
    expect(isoExclusiveToDateInclusive('2026-04-21T15:30:00Z')).toBe('2026-04-21')
  })

  it('gère le changement de mois en arrière', () => {
    expect(isoExclusiveToDateInclusive('2026-05-01T00:00:00Z')).toBe('2026-04-30')
  })

  it('retourne null pour ISO invalide', () => {
    expect(isoExclusiveToDateInclusive(null)).toBeNull()
    expect(isoExclusiveToDateInclusive('nope')).toBeNull()
  })
})

// Round-trip : date → starts_at/ends_at → date retrouvée
describe('roundtrip dates all_day', () => {
  it('date_debut → starts_at → isoToDate rend la date d\'origine', () => {
    const iso = dateToDayStartIso('2026-04-20')
    expect(isoToDate(iso)).toBe('2026-04-20')
  })

  it('date_fin → ends_at exclusif → isoExclusiveToDateInclusive rend la date d\'origine', () => {
    const iso = dateToDayEndExclusiveIso('2026-04-22')
    expect(isoExclusiveToDateInclusive(iso)).toBe('2026-04-22')
  })
})

// ═══ Classification events ═════════════════════════════════════════════════

describe('isEventMirror / isEtapeMirrorEvent / isPhaseMirrorEvent', () => {
  it('détecte les events miroir d\'étape', () => {
    const e = { source: EVENT_SOURCE_LIVRABLE_ETAPE }
    expect(isEventMirror(e)).toBe(true)
    expect(isEtapeMirrorEvent(e)).toBe(true)
    expect(isPhaseMirrorEvent(e)).toBe(false)
  })

  it('détecte les events miroir de phase', () => {
    const e = { source: EVENT_SOURCE_PROJET_PHASE }
    expect(isEventMirror(e)).toBe(true)
    expect(isEtapeMirrorEvent(e)).toBe(false)
    expect(isPhaseMirrorEvent(e)).toBe(true)
  })

  it('les events manuels ne sont pas miroir', () => {
    const e = { source: EVENT_SOURCE_MANUAL }
    expect(isEventMirror(e)).toBe(false)
    expect(isEtapeMirrorEvent(e)).toBe(false)
    expect(isPhaseMirrorEvent(e)).toBe(false)
  })

  it('accepte null/undefined sans planter', () => {
    expect(isEventMirror(null)).toBe(false)
    expect(isEventMirror(undefined)).toBe(false)
    expect(isEtapeMirrorEvent(null)).toBe(false)
    expect(isPhaseMirrorEvent(null)).toBe(false)
  })
})

// ═══ Couleurs ═════════════════════════════════════════════════════════════

describe('etapeEventColor', () => {
  it('retourne la couleur override si définie', () => {
    expect(etapeEventColor({ couleur: '#ff00ff', kind: 'montage' })).toBe('#ff00ff')
  })

  it('retourne la couleur du kind si pas d\'override', () => {
    expect(etapeEventColor({ kind: 'montage' })).toBe('#22c55e')
    expect(etapeEventColor({ kind: 'da' })).toBe('#a855f7')
  })

  it('retourne fallback slate si kind inconnu', () => {
    expect(etapeEventColor({ kind: 'inconnu' })).toBe('#94a3b8')
    expect(etapeEventColor({})).toBe('#94a3b8')
    expect(etapeEventColor(null)).toBe('#94a3b8')
  })
})

describe('phaseEventColor', () => {
  it('retourne la couleur override si définie', () => {
    expect(phaseEventColor({ couleur: '#123456', kind: 'tournage' })).toBe('#123456')
  })

  it('retourne la couleur du kind si pas d\'override', () => {
    expect(phaseEventColor({ kind: 'tournage' })).toBe('#ef4444')
    expect(phaseEventColor({ kind: 'prod' })).toBe('#0ea5e9')
  })

  it('retourne fallback slate-600 si kind inconnu', () => {
    expect(phaseEventColor({ kind: 'xxx' })).toBe('#64748b')
    expect(phaseEventColor(null)).toBe('#64748b')
  })
})

// ═══ Build payloads ═══════════════════════════════════════════════════════

describe('buildEtapeEventPayload', () => {
  const baseEtape = {
    id: 'et-1',
    nom: 'Montage V2',
    kind: 'montage',
    date_debut: '2026-04-20',
    date_fin: '2026-04-22',
    couleur: null,
  }

  it('construit le payload complet pour un INSERT', () => {
    const out = buildEtapeEventPayload(baseEtape, 'proj-1')
    expect(out).toEqual({
      project_id:        'proj-1',
      title:             'Montage V2',
      description:       null, // LIV-9 — etape.notes (vide ici) → description event
      type_id:           null, // LIV-9 — etape.event_type_id (vide ici)
      starts_at:         '2026-04-20T00:00:00.000Z',
      ends_at:           '2026-04-23T00:00:00.000Z',
      all_day:           true,
      source:            EVENT_SOURCE_LIVRABLE_ETAPE,
      livrable_etape_id: 'et-1',
      color_override:    '#22c55e', // couleur du kind montage
    })
  })

  it('LIV-9 — propage notes → description et event_type_id → type_id', () => {
    const out = buildEtapeEventPayload(
      {
        ...baseEtape,
        notes: 'Brief client : pas de motion',
        event_type_id: 'evt-type-derush',
      },
      'proj-1',
    )
    expect(out.description).toBe('Brief client : pas de motion')
    expect(out.type_id).toBe('evt-type-derush')
  })

  it('utilise la couleur override si présente', () => {
    const out = buildEtapeEventPayload({ ...baseEtape, couleur: '#000fff' }, 'proj-1')
    expect(out.color_override).toBe('#000fff')
  })

  it('tombe sur un titre par défaut si nom vide', () => {
    const out = buildEtapeEventPayload({ ...baseEtape, nom: '' }, 'proj-1')
    expect(out.title).toBe('Étape livrable')
  })

  it('retourne null si projectId manquant', () => {
    expect(buildEtapeEventPayload(baseEtape, null)).toBeNull()
  })

  it('retourne null si dates manquantes', () => {
    expect(buildEtapeEventPayload({ ...baseEtape, date_debut: null }, 'proj-1')).toBeNull()
    expect(buildEtapeEventPayload({ ...baseEtape, date_fin: null }, 'proj-1')).toBeNull()
  })

  it('retourne null si étape nulle', () => {
    expect(buildEtapeEventPayload(null, 'proj-1')).toBeNull()
  })
})

describe('buildPhaseEventPayload', () => {
  const basePhase = {
    id: 'ph-1',
    nom: 'Tournage Paris',
    kind: 'tournage',
    date_debut: '2026-05-01',
    date_fin: '2026-05-05',
  }

  it('construit le payload complet', () => {
    const out = buildPhaseEventPayload(basePhase, 'proj-1')
    expect(out).toEqual({
      project_id:      'proj-1',
      title:           'Tournage Paris',
      starts_at:       '2026-05-01T00:00:00.000Z',
      ends_at:         '2026-05-06T00:00:00.000Z',
      all_day:         true,
      source:          EVENT_SOURCE_PROJET_PHASE,
      projet_phase_id: 'ph-1',
      color_override:  '#ef4444',
    })
  })

  it('tombe sur un titre par défaut si nom vide', () => {
    const out = buildPhaseEventPayload({ ...basePhase, nom: null }, 'proj-1')
    expect(out.title).toBe('Phase projet')
  })

  it('retourne null si dates manquantes', () => {
    expect(buildPhaseEventPayload({ ...basePhase, date_debut: null }, 'proj-1')).toBeNull()
  })
})

// ═══ Build patches (UPDATE partiels) ═══════════════════════════════════════

describe('buildEtapeEventPatch', () => {
  it('produit uniquement les champs touchés par le patch étape', () => {
    // Seul `nom` change
    expect(buildEtapeEventPatch({ nom: 'Nouveau titre' })).toEqual({
      title: 'Nouveau titre',
    })
  })

  it('convertit les dates au format ISO', () => {
    expect(buildEtapeEventPatch({ date_debut: '2026-04-20', date_fin: '2026-04-22' })).toEqual({
      starts_at: '2026-04-20T00:00:00.000Z',
      ends_at:   '2026-04-23T00:00:00.000Z',
    })
  })

  it('recalcule color_override si kind OU couleur change', () => {
    expect(buildEtapeEventPatch({ kind: 'montage' })).toEqual({
      color_override: '#22c55e',
    })
    expect(buildEtapeEventPatch({ couleur: '#abcdef' })).toEqual({
      color_override: '#abcdef',
    })
  })

  it('retourne patch vide si rien ne change', () => {
    expect(buildEtapeEventPatch({})).toEqual({})
  })

  it('accepte null sans planter', () => {
    expect(buildEtapeEventPatch(null)).toEqual({})
  })

  it('gère un nom vide en fallback titre', () => {
    expect(buildEtapeEventPatch({ nom: '' })).toEqual({
      title: 'Étape livrable',
    })
  })
})

describe('buildPhaseEventPatch', () => {
  it('produit uniquement les champs touchés', () => {
    expect(buildPhaseEventPatch({ nom: 'Tournage' })).toEqual({
      title: 'Tournage',
    })
  })

  it('convertit les dates', () => {
    expect(buildPhaseEventPatch({ date_debut: '2026-05-01', date_fin: '2026-05-05' })).toEqual({
      starts_at: '2026-05-01T00:00:00.000Z',
      ends_at:   '2026-05-06T00:00:00.000Z',
    })
  })

  it('fallback titre si nom explicitement null', () => {
    // nom:null signifie "l'utilisateur a effacé le nom" → fallback au défaut
    expect(buildPhaseEventPatch({ nom: null })).toEqual({
      title: 'Phase projet',
    })
  })

  it('patch vide si rien ne change', () => {
    expect(buildPhaseEventPatch({})).toEqual({})
  })
})

// ═══ Reverse (planning → LIV) ═════════════════════════════════════════════

describe('eventPatchToEtapePatch', () => {
  it('convertit starts_at/ends_at en date_debut/date_fin', () => {
    expect(
      eventPatchToEtapePatch({
        starts_at: '2026-04-20T00:00:00Z',
        ends_at:   '2026-04-23T00:00:00Z',
      }),
    ).toEqual({
      date_debut: '2026-04-20',
      date_fin:   '2026-04-22',
    })
  })

  it('convertit title en nom', () => {
    expect(eventPatchToEtapePatch({ title: 'Nouveau' })).toEqual({ nom: 'Nouveau' })
  })

  it('convertit color_override en couleur', () => {
    expect(eventPatchToEtapePatch({ color_override: '#fff' })).toEqual({ couleur: '#fff' })
  })

  it('nullifie couleur si color_override absent mais présent comme null', () => {
    expect(eventPatchToEtapePatch({ color_override: null })).toEqual({ couleur: null })
  })

  it('skip les champs non renseignés', () => {
    expect(eventPatchToEtapePatch({})).toEqual({})
  })

  it('skip title si null', () => {
    expect(eventPatchToEtapePatch({ title: null })).toEqual({})
  })
})

describe('eventPatchToPhasePatch', () => {
  it('convertit starts_at/ends_at en date_debut/date_fin', () => {
    expect(
      eventPatchToPhasePatch({
        starts_at: '2026-05-01T00:00:00Z',
        ends_at:   '2026-05-06T00:00:00Z',
      }),
    ).toEqual({
      date_debut: '2026-05-01',
      date_fin:   '2026-05-05',
    })
  })

  it('convertit title + color_override', () => {
    expect(
      eventPatchToPhasePatch({ title: 'Post-prod', color_override: '#abc' }),
    ).toEqual({ nom: 'Post-prod', couleur: '#abc' })
  })
})

// ═══ Diff detection ════════════════════════════════════════════════════════

describe('etapePatchAffectsEvent', () => {
  it('true si champ synced est dans le patch', () => {
    expect(etapePatchAffectsEvent({ nom: 'x' })).toBe(true)
    expect(etapePatchAffectsEvent({ kind: 'montage' })).toBe(true)
    expect(etapePatchAffectsEvent({ date_debut: '2026-04-20' })).toBe(true)
    expect(etapePatchAffectsEvent({ date_fin: '2026-04-22' })).toBe(true)
    expect(etapePatchAffectsEvent({ couleur: '#fff' })).toBe(true)
    // LIV-9 — notes synchronisée vers events.description
    expect(etapePatchAffectsEvent({ notes: 'x' })).toBe(true)
    // LIV-9 — event_type_id synchronisé vers events.type_id
    expect(etapePatchAffectsEvent({ event_type_id: 'evt-type-x' })).toBe(true)
  })

  it('false si seuls des champs hors-scope sont touchés', () => {
    expect(etapePatchAffectsEvent({ assignee_profile_id: 'abc' })).toBe(false)
    expect(etapePatchAffectsEvent({ assignee_external: 'Hugo' })).toBe(false)
    expect(etapePatchAffectsEvent({ is_event: false })).toBe(false)
  })

  it('false pour patch vide', () => {
    expect(etapePatchAffectsEvent({})).toBe(false)
    expect(etapePatchAffectsEvent()).toBe(false)
  })
})

describe('phasePatchAffectsEvent', () => {
  it('true sur les champs synced, false sur les autres', () => {
    expect(phasePatchAffectsEvent({ nom: 'x' })).toBe(true)
    expect(phasePatchAffectsEvent({ date_debut: '2026-05-01' })).toBe(true)
    expect(phasePatchAffectsEvent({ notes: 'x' })).toBe(false)
    expect(phasePatchAffectsEvent({})).toBe(false)
  })
})

// ═══ Should have event ═════════════════════════════════════════════════════

describe('shouldEtapeHaveEvent', () => {
  it('true si is_event + dates complètes', () => {
    expect(
      shouldEtapeHaveEvent({
        is_event:   true,
        date_debut: '2026-04-20',
        date_fin:   '2026-04-22',
      }),
    ).toBe(true)
  })

  it('false si is_event=false', () => {
    expect(
      shouldEtapeHaveEvent({
        is_event:   false,
        date_debut: '2026-04-20',
        date_fin:   '2026-04-22',
      }),
    ).toBe(false)
  })

  it('false si une date manque', () => {
    expect(shouldEtapeHaveEvent({ is_event: true, date_debut: '2026-04-20' })).toBe(false)
    expect(shouldEtapeHaveEvent({ is_event: true, date_fin: '2026-04-22' })).toBe(false)
  })

  it('false si étape null/undefined', () => {
    expect(shouldEtapeHaveEvent(null)).toBe(false)
    expect(shouldEtapeHaveEvent(undefined)).toBe(false)
  })
})

describe('shouldPhaseHaveEvent', () => {
  it('true si dates complètes (pas de flag is_event sur les phases)', () => {
    expect(
      shouldPhaseHaveEvent({
        date_debut: '2026-05-01',
        date_fin:   '2026-05-05',
      }),
    ).toBe(true)
  })

  it('false si une date manque', () => {
    expect(shouldPhaseHaveEvent({ date_debut: '2026-05-01' })).toBe(false)
    expect(shouldPhaseHaveEvent({ date_fin: '2026-05-05' })).toBe(false)
  })

  it('false si phase null', () => {
    expect(shouldPhaseHaveEvent(null)).toBe(false)
  })
})

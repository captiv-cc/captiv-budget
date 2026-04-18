/**
 * Tests unitaires — planning.js (fonctions pures uniquement)
 * Les wrappers CRUD Supabase ne sont pas testés ici : ils passeront par
 * des tests d'intégration plus tard (projet CI/CD).
 */
import { describe, it, expect } from 'vitest'
import {
  resolveEventColor,
  eventsOverlap,
  memberIdentitiesOf,
  buildMemberMap,
  eventKey,
  findEventConflicts,
  findConflictsForEvent,
  EVENT_MEMBER_STATUS,
  SYSTEM_EVENT_TYPE_SLUGS,
  PLANNING_VIEW_KINDS,
  PLANNING_VIEW_KINDS_LIST,
  BUILTIN_PLANNING_VIEWS,
  defaultViewConfig,
  filterEventsByConfig,
  groupEventsByConfig,
  GROUP_BY_OPTIONS,
  GROUP_BY_FIELD_MAP,
  SORTABLE_EVENT_FIELDS,
  eventSortValue,
  sortEventsByField,
  formatDuration,
  packEventIntervals,
  layoutTimelineLanes,
  TIMELINE_ZOOMS,
  TIMELINE_ZOOM_ORDER,
  TIMELINE_DENSITIES,
  TIMELINE_MILESTONE_MAX_MS,
  isMilestone,
  PLANNING_VIEW_PRESETS,
  PLANNING_VIEW_PRESETS_BY_KEY,
  layoutMonthBars,
} from './planning'

describe('resolveEventColor', () => {
  it('utilise color_override si présent', () => {
    expect(resolveEventColor({ color_override: '#FF0000', type: { color: '#00FF00' } })).toBe('#FF0000')
  })
  it('retombe sur la couleur du type si pas de surcharge', () => {
    expect(resolveEventColor({ color_override: null, type: { color: '#00FF00' } })).toBe('#00FF00')
  })
  it('retombe sur le fallback si ni surcharge ni type', () => {
    expect(resolveEventColor({})).toBe('var(--txt-3)')
    expect(resolveEventColor({}, '#123456')).toBe('#123456')
  })
  it('gère null/undefined sans planter', () => {
    expect(resolveEventColor(null)).toBe('var(--txt-3)')
    expect(resolveEventColor(undefined)).toBe('var(--txt-3)')
  })
})

describe('eventsOverlap', () => {
  const mk = (s, e) => ({ starts_at: s, ends_at: e })
  it('détecte un chevauchement partiel', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z')
    const b = mk('2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z')
    expect(eventsOverlap(a, b)).toBe(true)
  })
  it('retourne false si A finit pile quand B commence', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')
    const b = mk('2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z')
    expect(eventsOverlap(a, b)).toBe(false)
  })
  it('détecte un inclusion complète', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T18:00:00Z')
    const b = mk('2026-05-01T12:00:00Z', '2026-05-01T14:00:00Z')
    expect(eventsOverlap(a, b)).toBe(true)
  })
  it('retourne false pour des événements disjoints', () => {
    const a = mk('2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')
    const b = mk('2026-05-02T09:00:00Z', '2026-05-02T10:00:00Z')
    expect(eventsOverlap(a, b)).toBe(false)
  })
  it('retourne false pour null/undefined', () => {
    expect(eventsOverlap(null, {})).toBe(false)
    expect(eventsOverlap({}, null)).toBe(false)
  })
})

describe('memberIdentitiesOf', () => {
  it('retourne [] si pas de membre', () => {
    expect(memberIdentitiesOf({})).toEqual([])
    expect(memberIdentitiesOf({ members: [] })).toEqual([])
  })
  it('encode profile_id et crew_member_id', () => {
    const ev = {
      members: [
        { profile_id: 'p1', status: 'pending' },
        { crew_member_id: 'c1', status: 'confirmed' },
      ],
    }
    expect(memberIdentitiesOf(ev)).toEqual(['p:p1', 'c:c1'])
  })
  it('exclut les membres déclinés', () => {
    const ev = {
      members: [
        { profile_id: 'p1', status: 'declined' },
        { profile_id: 'p2', status: 'confirmed' },
      ],
    }
    expect(memberIdentitiesOf(ev)).toEqual(['p:p2'])
  })
})

describe('buildMemberMap', () => {
  it('retourne un Map vide pour une entrée non-array', () => {
    expect(buildMemberMap(null)).toBeInstanceOf(Map)
    expect(buildMemberMap(null).size).toBe(0)
    expect(buildMemberMap(undefined).size).toBe(0)
    expect(buildMemberMap('nope').size).toBe(0)
  })

  it('indexe les profils et intervenants via les members joints', () => {
    const events = [
      {
        members: [
          { profile_id: 'p1', status: 'pending', profile: { full_name: 'Alice' } },
          { crew_member_id: 'c1', status: 'confirmed', crew: { person_name: 'Bob' } },
        ],
      },
    ]
    const map = buildMemberMap(events)
    expect(map.get('p:p1')).toBe('Alice')
    expect(map.get('c:c1')).toBe('Bob')
    expect(map.size).toBe(2)
  })

  it('dédoublonne quand un même membre apparaît sur plusieurs events', () => {
    const events = [
      { members: [{ profile_id: 'p1', status: 'confirmed', profile: { full_name: 'Alice' } }] },
      { members: [{ profile_id: 'p1', status: 'confirmed', profile: { full_name: 'Alice (alt)' } }] },
    ]
    const map = buildMemberMap(events)
    expect(map.size).toBe(1)
    // Premier nom rencontré gagne (Map.set + if !has)
    expect(map.get('p:p1')).toBe('Alice')
  })

  it('ignore les declined', () => {
    const events = [
      {
        members: [
          { profile_id: 'p1', status: 'declined', profile: { full_name: 'Alice' } },
          { profile_id: 'p2', status: 'confirmed', profile: { full_name: 'Dana' } },
        ],
      },
    ]
    const map = buildMemberMap(events)
    expect(map.has('p:p1')).toBe(false)
    expect(map.get('p:p2')).toBe('Dana')
  })

  it('tombe sur un label par défaut quand profile.full_name est manquant', () => {
    const events = [
      { members: [{ profile_id: 'px', status: 'confirmed' }] },
      { members: [{ crew_member_id: 'cx', status: 'confirmed' }] },
    ]
    const map = buildMemberMap(events)
    expect(map.get('p:px')).toBe('Profil sans nom')
    expect(map.get('c:cx')).toBe('Intervenant sans nom')
  })
})

describe('eventKey', () => {
  it('retourne id seul pour un événement normal', () => {
    expect(eventKey({ id: 'e1' })).toBe('e1')
  })
  it('retourne id|occurrenceKey pour une occurrence virtuelle', () => {
    expect(eventKey({ id: 'e1', _occurrence_key: '2026-05-01' })).toBe('e1|2026-05-01')
  })
  it('retourne null pour une entrée nulle', () => {
    expect(eventKey(null)).toBe(null)
  })
})

describe('findEventConflicts', () => {
  const mk = (id, s, e, memberIds = []) => ({
    id,
    starts_at: s,
    ends_at: e,
    members: memberIds.map((mid) => ({ profile_id: mid, status: 'pending' })),
  })

  it('retourne une Map vide si <2 événements', () => {
    expect(findEventConflicts([]).size).toBe(0)
    expect(findEventConflicts([mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', ['u1'])]).size).toBe(0)
  })

  it('ne signale pas les événements qui se chevauchent mais ne partagent aucun membre', () => {
    const a = mk('a', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', ['u1'])
    const b = mk('b', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u2'])
    expect(findEventConflicts([a, b]).size).toBe(0)
  })

  it('ne signale pas les événements disjoints même s\'ils partagent un membre', () => {
    const a = mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', ['u1'])
    const b = mk('b', '2026-05-02T09:00:00Z', '2026-05-02T10:00:00Z', ['u1'])
    expect(findEventConflicts([a, b]).size).toBe(0)
  })

  it('signale un conflit quand chevauchement ET membre partagé', () => {
    const a = mk('a', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', ['u1', 'u2'])
    const b = mk('b', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u2', 'u3'])
    const result = findEventConflicts([a, b])
    expect(result.size).toBe(2)
    expect(result.get('a')).toHaveLength(1)
    expect(result.get('a')[0].other.id).toBe('b')
    expect(result.get('a')[0].sharedIdentities).toEqual(['p:u2'])
    expect(result.get('b')).toHaveLength(1)
    expect(result.get('b')[0].other.id).toBe('a')
  })

  it('gère correctement 3 événements concurrents', () => {
    const a = mk('a', '2026-05-01T09:00:00Z', '2026-05-01T12:00:00Z', ['u1'])
    const b = mk('b', '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z', ['u1'])
    const c = mk('c', '2026-05-01T10:30:00Z', '2026-05-01T13:00:00Z', ['u1'])
    const result = findEventConflicts([a, b, c])
    expect(result.size).toBe(3)
    expect(result.get('a')).toHaveLength(2)
    expect(result.get('b')).toHaveLength(2)
    expect(result.get('c')).toHaveLength(2)
  })

  it('ignore les membres déclinés', () => {
    const a = {
      id: 'a',
      starts_at: '2026-05-01T09:00:00Z',
      ends_at: '2026-05-01T11:00:00Z',
      members: [{ profile_id: 'u1', status: 'declined' }],
    }
    const b = {
      id: 'b',
      starts_at: '2026-05-01T10:00:00Z',
      ends_at: '2026-05-01T12:00:00Z',
      members: [{ profile_id: 'u1', status: 'pending' }],
    }
    expect(findEventConflicts([a, b]).size).toBe(0)
  })

  it('distingue les occurrences via _occurrence_key', () => {
    const a = { ...mk('m', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', ['u1']), _occurrence_key: '2026-05-01' }
    const b = mk('b', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u1'])
    const c = { ...mk('m', '2026-05-08T09:00:00Z', '2026-05-08T11:00:00Z', ['u1']), _occurrence_key: '2026-05-08' }
    const result = findEventConflicts([a, b, c])
    expect(result.size).toBe(2) // a et b en conflit, pas c
    expect(result.has('m|2026-05-01')).toBe(true)
    expect(result.has('b')).toBe(true)
    expect(result.has('m|2026-05-08')).toBe(false)
  })
})

describe('findConflictsForEvent', () => {
  const mk = (id, s, e, memberIds = []) => ({
    id,
    starts_at: s,
    ends_at: e,
    members: memberIds.map((mid) => ({ profile_id: mid, status: 'pending' })),
  })

  it('retourne [] si target n\'a pas de membre', () => {
    const target = mk('t', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', [])
    const others = [mk('o', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u1'])]
    expect(findConflictsForEvent(target, others)).toEqual([])
  })

  it('exclut le target lui-même du scan', () => {
    const target = mk('t', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', ['u1'])
    expect(findConflictsForEvent(target, [target])).toEqual([])
  })

  it('retourne les conflits croisés', () => {
    const target = mk('t', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', ['u1'])
    const others = [
      mk('o1', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u1']),  // conflit
      mk('o2', '2026-05-02T10:00:00Z', '2026-05-02T12:00:00Z', ['u1']),  // pas de chevauchement
      mk('o3', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', ['u2']),  // pas de membre partagé
    ]
    const result = findConflictsForEvent(target, others)
    expect(result).toHaveLength(1)
    expect(result[0].other.id).toBe('o1')
    expect(result[0].sharedIdentities).toEqual(['p:u1'])
  })
})

describe('Constantes planning', () => {
  it('expose 4 statuts membres', () => {
    expect(Object.keys(EVENT_MEMBER_STATUS)).toEqual([
      'pending', 'confirmed', 'declined', 'tentative',
    ])
  })
  it('expose 13 slugs système (= nb de types par défaut seedés)', () => {
    expect(SYSTEM_EVENT_TYPE_SLUGS).toHaveLength(13)
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('tournage')
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('montage')
    expect(SYSTEM_EVENT_TYPE_SLUGS).toContain('autre')
  })
})

// ─── PL-3.5 : vues multi-lentilles ───────────────────────────────────────────

describe('PLANNING_VIEW_KINDS', () => {
  it('expose exactement 7 kinds (3 calendar + 4 avancés)', () => {
    expect(PLANNING_VIEW_KINDS_LIST).toHaveLength(7)
    const calendars = PLANNING_VIEW_KINDS_LIST.filter((k) => k.group === 'calendar')
    const advanced  = PLANNING_VIEW_KINDS_LIST.filter((k) => k.group === 'advanced')
    expect(calendars).toHaveLength(3)
    expect(advanced).toHaveLength(4)
  })

  it('les 3 vues calendar_* sont marquées implemented=true', () => {
    expect(PLANNING_VIEW_KINDS.calendar_month.implemented).toBe(true)
    expect(PLANNING_VIEW_KINDS.calendar_week.implemented).toBe(true)
    expect(PLANNING_VIEW_KINDS.calendar_day.implemented).toBe(true)
  })

  it('les 4 vues avancées (table/kanban/timeline/swimlanes) sont livrées (PL-3.5 étapes 3-6)', () => {
    expect(PLANNING_VIEW_KINDS.table.implemented).toBe(true)
    expect(PLANNING_VIEW_KINDS.kanban.implemented).toBe(true)
    expect(PLANNING_VIEW_KINDS.timeline.implemented).toBe(true)
    expect(PLANNING_VIEW_KINDS.swimlanes.implemented).toBe(true)
  })

  it('chaque kind expose key/label/icon/group cohérents', () => {
    for (const k of PLANNING_VIEW_KINDS_LIST) {
      expect(k.key).toBeTruthy()
      expect(k.label).toBeTruthy()
      expect(k.icon).toBeTruthy()
      expect(['calendar', 'advanced']).toContain(k.group)
      // Cohérence key <-> clé de l'objet (pas d'alias silencieux)
      expect(PLANNING_VIEW_KINDS[k.key]).toBe(k)
    }
  })
})

describe('defaultViewConfig', () => {
  it('expose la shape attendue (filters, groupBy, sortBy, hiddenFields, showWeekends)', () => {
    const cfg = defaultViewConfig('calendar_month')
    expect(cfg).toHaveProperty('filters')
    expect(cfg.filters).toEqual({
      typeIds: [], lotIds: [], memberIds: [], statusMember: [], search: '',
    })
    expect(cfg.groupBy).toBeNull()
    expect(cfg.sortBy).toEqual({ field: 'starts_at', direction: 'asc' })
    expect(cfg.hiddenFields).toEqual([])
    expect(cfg.showWeekends).toBe(true)
  })

  it('positionne groupBy=type pour kanban', () => {
    expect(defaultViewConfig('kanban').groupBy).toBe('type')
  })

  it('positionne groupBy=member pour swimlanes', () => {
    expect(defaultViewConfig('swimlanes').groupBy).toBe('member')
  })

  it('positionne groupBy=lot et windowDays=30 pour timeline', () => {
    const cfg = defaultViewConfig('timeline')
    expect(cfg.groupBy).toBe('lot')
    expect(cfg.windowDays).toBe(30)
  })

  it('timeline v2 : inclut zoomLevel / density / showTodayLine', () => {
    const cfg = defaultViewConfig('timeline')
    expect(cfg.zoomLevel).toBe('day')
    expect(cfg.density).toBe('comfortable')
    expect(cfg.showTodayLine).toBe(true)
  })

  it('retourne toujours un nouvel objet (pas de partage de référence)', () => {
    const a = defaultViewConfig('calendar_month')
    const b = defaultViewConfig('calendar_month')
    expect(a).not.toBe(b)
    expect(a.filters).not.toBe(b.filters)
    a.filters.typeIds.push('mutation')
    expect(b.filters.typeIds).toEqual([])
  })
})

describe('BUILTIN_PLANNING_VIEWS', () => {
  it('expose 3 vues calendrier en fallback', () => {
    expect(BUILTIN_PLANNING_VIEWS).toHaveLength(3)
    const kinds = BUILTIN_PLANNING_VIEWS.map((v) => v.kind)
    expect(kinds).toEqual(['calendar_month', 'calendar_week', 'calendar_day'])
  })

  it('la vue Mois est marquée is_default=true', () => {
    const mois = BUILTIN_PLANNING_VIEWS.find((v) => v.kind === 'calendar_month')
    expect(mois.is_default).toBe(true)
    const autres = BUILTIN_PLANNING_VIEWS.filter((v) => v.kind !== 'calendar_month')
    for (const v of autres) expect(v.is_default).toBe(false)
  })

  it('chaque vue built-in expose _builtin=true et un id préfixé "builtin:"', () => {
    for (const v of BUILTIN_PLANNING_VIEWS) {
      expect(v._builtin).toBe(true)
      expect(v.id.startsWith('builtin:')).toBe(true)
    }
  })

  it('chaque vue built-in a une config initialisée (shape defaultViewConfig)', () => {
    for (const v of BUILTIN_PLANNING_VIEWS) {
      expect(v.config).toHaveProperty('filters')
      expect(v.config).toHaveProperty('sortBy')
    }
  })
})

// Helpers de test : fabrique d'événements minimalistes ──────────────────────
function mkEvent(overrides = {}) {
  return {
    id:          overrides.id          || 'e1',
    title:       overrides.title       || 'Event',
    description: overrides.description || '',
    type_id:     overrides.type_id     || null,
    lot_id:      overrides.lot_id      || null,
    location_id: overrides.location_id || null,
    starts_at:   overrides.starts_at   || '2026-04-20T10:00:00Z',
    ends_at:     overrides.ends_at     || '2026-04-20T12:00:00Z',
    members:     overrides.members     || [],
    ...overrides,
  }
}

describe('filterEventsByConfig', () => {
  const tournage = mkEvent({ id: 't', type_id: 'TYPE_T', lot_id: 'LOT_A', title: 'Tournage jour 1' })
  const montage  = mkEvent({ id: 'm', type_id: 'TYPE_M', lot_id: 'LOT_B', title: 'Montage rush' })
  const reunion  = mkEvent({ id: 'r', type_id: 'TYPE_R', lot_id: null,    title: 'Réunion équipe', description: 'Point hebdo' })
  const all = [tournage, montage, reunion]

  it('retourne la liste inchangée si aucun filtre n\'est actif', () => {
    const out = filterEventsByConfig(all, {})
    expect(out).toBe(all)
  })

  it('retourne la liste inchangée pour une config null/undefined', () => {
    expect(filterEventsByConfig(all, null)).toBe(all)
    expect(filterEventsByConfig(all, undefined)).toBe(all)
  })

  it('filtre par typeIds (OR interne)', () => {
    const out = filterEventsByConfig(all, { filters: { typeIds: ['TYPE_T', 'TYPE_M'] } })
    expect(out.map((e) => e.id)).toEqual(['t', 'm'])
  })

  it('filtre par lotIds', () => {
    const out = filterEventsByConfig(all, { filters: { lotIds: ['LOT_A'] } })
    expect(out.map((e) => e.id)).toEqual(['t'])
  })

  it('filtre par lot "__none__" (events sans lot)', () => {
    const out = filterEventsByConfig(all, { filters: { lotIds: ['__none__'] } })
    expect(out.map((e) => e.id)).toEqual(['r'])
  })

  it('combine lotIds + __none__ (lot A OU sans lot)', () => {
    const out = filterEventsByConfig(all, { filters: { lotIds: ['LOT_A', '__none__'] } })
    expect(out.map((e) => e.id)).toEqual(['t', 'r'])
  })

  it('filtre par recherche plein texte (casse + accents ignorés)', () => {
    const out = filterEventsByConfig(all, { filters: { search: 'reunion' } })
    expect(out.map((e) => e.id)).toEqual(['r'])
  })

  it('filtre par recherche sur la description', () => {
    const out = filterEventsByConfig(all, { filters: { search: 'hebdo' } })
    expect(out.map((e) => e.id)).toEqual(['r'])
  })

  it('combine type + lot + search (AND entre filtres)', () => {
    const out = filterEventsByConfig(all, {
      filters: { typeIds: ['TYPE_T', 'TYPE_R'], lotIds: ['LOT_A'], search: 'jour' },
    })
    expect(out.map((e) => e.id)).toEqual(['t'])
  })

  it('filtre par memberIds (identité p:/c:)', () => {
    const evA = mkEvent({ id: 'a', members: [{ profile_id: 'u1', status: 'pending' }] })
    const evB = mkEvent({ id: 'b', members: [{ crew_member_id: 'c1', status: 'confirmed' }] })
    const evC = mkEvent({ id: 'c', members: [] })
    const out = filterEventsByConfig([evA, evB, evC], { filters: { memberIds: ['p:u1'] } })
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('filtre par statusMember (au moins un membre au statut)', () => {
    const evA = mkEvent({ id: 'a', members: [{ profile_id: 'u1', status: 'confirmed' }] })
    const evB = mkEvent({ id: 'b', members: [{ profile_id: 'u1', status: 'pending' }] })
    const out = filterEventsByConfig([evA, evB], { filters: { statusMember: ['confirmed'] } })
    expect(out.map((e) => e.id)).toEqual(['a'])
  })

  it('gère une entrée non-array sans planter', () => {
    expect(filterEventsByConfig(null, { filters: { typeIds: ['X'] } })).toEqual([])
    expect(filterEventsByConfig(undefined, { filters: { typeIds: ['X'] } })).toEqual([])
  })

  it('préserve l\'ordre original des événements', () => {
    const out = filterEventsByConfig(all, { filters: { typeIds: ['TYPE_R', 'TYPE_T'] } })
    // ordre original : t puis r
    expect(out.map((e) => e.id)).toEqual(['t', 'r'])
  })

  // ─── PL-5 : typeCategories & typeSlugs ────────────────────────────────────
  // Events enrichis avec le join EVENT_SELECT → `type.category` et `type.slug`.
  const tournagePrep = mkEvent({
    id: 'tp', type_id: 'T1', title: 'Repérages',
    type: { id: 'T1', slug: 'reperages', label: 'Repérages', category: 'pre_prod' },
  })
  const tournagePrinc = mkEvent({
    id: 'tx', type_id: 'T2', title: 'Tournage jour 3',
    type: { id: 'T2', slug: 'tournage', label: 'Tournage', category: 'tournage' },
  })
  const postMontage = mkEvent({
    id: 'pm', type_id: 'T3', title: 'Montage',
    type: { id: 'T3', slug: 'montage', label: 'Montage', category: 'post_prod' },
  })
  const divers = mkEvent({
    id: 'd', type_id: 'T4', title: 'Réu',
    type: { id: 'T4', slug: 'reunion', label: 'Réunion', category: 'autre' },
  })
  const enriched = [tournagePrep, tournagePrinc, postMontage, divers]

  it('filtre par typeCategories (pre_prod/tournage/post_prod/autre)', () => {
    const out = filterEventsByConfig(enriched, {
      filters: { typeCategories: ['pre_prod', 'tournage'] },
    })
    expect(out.map((e) => e.id)).toEqual(['tp', 'tx'])
  })

  it('filtre par typeSlugs (système)', () => {
    const out = filterEventsByConfig(enriched, {
      filters: { typeSlugs: ['montage', 'reunion'] },
    })
    expect(out.map((e) => e.id)).toEqual(['pm', 'd'])
  })

  it('typeIds / typeCategories / typeSlugs sont en OR dans le bloc type', () => {
    // typeIds match tp (T1) ; typeCategories match postMontage (post_prod) ;
    // typeSlugs match divers (reunion) — on doit récupérer les trois.
    const out = filterEventsByConfig(enriched, {
      filters: {
        typeIds: ['T1'],
        typeCategories: ['post_prod'],
        typeSlugs: ['reunion'],
      },
    })
    expect(out.map((e) => e.id)).toEqual(['tp', 'pm', 'd'])
  })

  it('combine bloc type (OR interne) AND autres filtres', () => {
    // typeCategories = tournage → [tx] ; lotIds = ['LOT_X'] intersecte vide.
    const withLot = enriched.map((e) => ({ ...e, lot_id: 'LOT_X' }))
    const out = filterEventsByConfig(withLot, {
      filters: { typeCategories: ['tournage'], lotIds: ['LOT_X'] },
    })
    expect(out.map((e) => e.id)).toEqual(['tx'])
  })

  it('typeCategories sur event sans relation `type` jointe → exclu (pas de match)', () => {
    const orphan = mkEvent({ id: 'o', type_id: 'T5' }) // pas de ev.type
    const out = filterEventsByConfig([...enriched, orphan], {
      filters: { typeCategories: ['pre_prod', 'tournage', 'post_prod', 'autre'] },
    })
    expect(out.map((e) => e.id)).toEqual(['tp', 'tx', 'pm', 'd'])
  })
})

describe('PLANNING_VIEW_PRESETS (PL-5)', () => {
  it('expose exactement 4 presets', () => {
    expect(PLANNING_VIEW_PRESETS).toHaveLength(4)
  })

  it('a les 4 clés attendues (stable cross-org)', () => {
    const keys = PLANNING_VIEW_PRESETS.map((p) => p.key).sort()
    expect(keys).toEqual([
      'post_production',
      'previsionnel',
      'production_macro',
      'tournage_equipe',
    ])
  })

  it('tous les presets pointent vers un kind implémenté', () => {
    for (const p of PLANNING_VIEW_PRESETS) {
      expect(PLANNING_VIEW_KINDS[p.kind]?.implemented).toBe(true)
    }
  })

  it('tous les presets ont un bloc filters complet (typeIds/typeCategories/typeSlugs/...)', () => {
    for (const p of PLANNING_VIEW_PRESETS) {
      const f = p.config?.filters || {}
      expect(Array.isArray(f.typeIds)).toBe(true)
      expect(Array.isArray(f.typeCategories)).toBe(true)
      expect(Array.isArray(f.typeSlugs)).toBe(true)
      expect(Array.isArray(f.lotIds)).toBe(true)
      expect(Array.isArray(f.memberIds)).toBe(true)
      expect(Array.isArray(f.statusMember)).toBe(true)
      expect(typeof f.search).toBe('string')
    }
  })

  it('Tournage filtre sur pre_prod + tournage (swimlanes équipe)', () => {
    const p = PLANNING_VIEW_PRESETS_BY_KEY.tournage_equipe
    expect(p.kind).toBe('swimlanes')
    expect(p.config.groupBy).toBe('member')
    expect(p.config.filters.typeCategories.sort()).toEqual(['pre_prod', 'tournage'])
  })

  it('Post-production filtre sur post_prod uniquement', () => {
    const p = PLANNING_VIEW_PRESETS_BY_KEY.post_production
    expect(p.kind).toBe('timeline')
    expect(p.config.filters.typeCategories).toEqual(['post_prod'])
  })

  it('Production macro = timeline sans catégorie (vue complète)', () => {
    const p = PLANNING_VIEW_PRESETS_BY_KEY.production_macro
    expect(p.kind).toBe('timeline')
    expect(p.config.groupBy).toBe('lot')
    expect(p.config.filters.typeCategories).toEqual([])
    expect(p.config.windowDays).toBe(90)
  })

  it('PLANNING_VIEW_PRESETS_BY_KEY est un lookup O(1) cohérent', () => {
    for (const p of PLANNING_VIEW_PRESETS) {
      expect(PLANNING_VIEW_PRESETS_BY_KEY[p.key]).toBe(p)
    }
  })
})

describe('groupEventsByConfig', () => {
  const a = mkEvent({ id: 'a', type_id: 'T1', lot_id: 'L1', location_id: 'LOC1',
    members: [{ profile_id: 'u1', status: 'confirmed' }] })
  const b = mkEvent({ id: 'b', type_id: 'T1', lot_id: 'L2', location_id: null,
    members: [{ profile_id: 'u2', status: 'pending' }] })
  const c = mkEvent({ id: 'c', type_id: 'T2', lot_id: 'L1', location_id: 'LOC1',
    members: [] })
  const all = [a, b, c]

  it('retourne un seul bucket "__all__" si groupBy est null', () => {
    const out = groupEventsByConfig(all, { groupBy: null })
    expect([...out.keys()]).toEqual(['__all__'])
    expect(out.get('__all__')).toBe(all)
  })

  it('groupe par type_id', () => {
    const out = groupEventsByConfig(all, { groupBy: 'type' })
    expect(out.get('T1').map((e) => e.id)).toEqual(['a', 'b'])
    expect(out.get('T2').map((e) => e.id)).toEqual(['c'])
  })

  it('groupe par lot_id (avec __null__ pour les sans-lot)', () => {
    const orphan = mkEvent({ id: 'o', lot_id: null })
    const out = groupEventsByConfig([a, orphan], { groupBy: 'lot' })
    expect(out.get('L1').map((e) => e.id)).toEqual(['a'])
    expect(out.get('__null__').map((e) => e.id)).toEqual(['o'])
  })

  it('groupe par location_id', () => {
    const out = groupEventsByConfig(all, { groupBy: 'location' })
    expect(out.get('LOC1').map((e) => e.id)).toEqual(['a', 'c'])
    expect(out.get('__null__').map((e) => e.id)).toEqual(['b'])
  })

  it('groupe par statut dominant (confirmed > tentative > pending > declined)', () => {
    const mix = mkEvent({ id: 'x', members: [
      { profile_id: 'u1', status: 'pending' },
      { profile_id: 'u2', status: 'confirmed' },
    ]})
    const solo = mkEvent({ id: 'y', members: [{ profile_id: 'u3', status: 'tentative' }] })
    const orphan = mkEvent({ id: 'z', members: [] })
    const out = groupEventsByConfig([mix, solo, orphan], { groupBy: 'status' })
    expect(out.get('confirmed').map((e) => e.id)).toEqual(['x'])
    expect(out.get('tentative').map((e) => e.id)).toEqual(['y'])
    expect(out.get('__null__').map((e) => e.id)).toEqual(['z'])
  })

  it('groupe par membre (un event peut apparaître dans plusieurs buckets)', () => {
    const evA = mkEvent({ id: 'ev', members: [
      { profile_id: 'u1', status: 'pending' },
      { crew_member_id: 'c1', status: 'confirmed' },
    ]})
    const orphan = mkEvent({ id: 'orphan', members: [] })
    const out = groupEventsByConfig([evA, orphan], { groupBy: 'member' })
    expect(out.get('p:u1').map((e) => e.id)).toEqual(['ev'])
    expect(out.get('c:c1').map((e) => e.id)).toEqual(['ev'])
    expect(out.get('__null__').map((e) => e.id)).toEqual(['orphan'])
  })

  it('gère entrées vides / null sans planter', () => {
    const empty = groupEventsByConfig([], { groupBy: 'type' })
    expect([...empty.keys()]).toEqual([])
    const nullInput = groupEventsByConfig(null, { groupBy: 'type' })
    expect([...nullInput.keys()]).toEqual([])
  })
})

describe('GROUP_BY_OPTIONS', () => {
  it('expose une option "Aucun groupement" avec key=null', () => {
    const none = GROUP_BY_OPTIONS.find((o) => o.key === null)
    expect(none).toBeDefined()
    expect(none.label).toMatch(/aucun/i)
  })

  it('expose type/lot/member/status/location', () => {
    const keys = GROUP_BY_OPTIONS.map((o) => o.key)
    for (const k of ['type', 'lot', 'member', 'status', 'location']) {
      expect(keys).toContain(k)
    }
  })
})

// ─── PL-3.5 étape 4 : Kanban drop-field map ─────────────────────────────────

describe('GROUP_BY_FIELD_MAP', () => {
  it('mappe type/lot/location vers le champ events.* correspondant', () => {
    expect(GROUP_BY_FIELD_MAP.type).toBe('type_id')
    expect(GROUP_BY_FIELD_MAP.lot).toBe('lot_id')
    expect(GROUP_BY_FIELD_MAP.location).toBe('location_id')
  })

  it('n\u2019inclut pas member/status (non droppables via drag&drop simple)', () => {
    expect(GROUP_BY_FIELD_MAP.member).toBeUndefined()
    expect(GROUP_BY_FIELD_MAP.status).toBeUndefined()
  })

  it('tous les champs cibles sont bien des champs scalaires de events', () => {
    // La cohérence est critique : le handler onMoveCard utilisera ces noms
    // tels quels dans updateEvent(masterId, { [field]: nextValue }).
    for (const field of Object.values(GROUP_BY_FIELD_MAP)) {
      expect(field).toMatch(/_id$/)
    }
  })
})

// ─── PL-3.5 étape 3 : Table view (tri + durée) ──────────────────────────────

describe('SORTABLE_EVENT_FIELDS', () => {
  it('expose au moins 8 champs triables avec key + label', () => {
    expect(SORTABLE_EVENT_FIELDS.length).toBeGreaterThanOrEqual(8)
    for (const f of SORTABLE_EVENT_FIELDS) {
      expect(f.key).toBeTruthy()
      expect(f.label).toBeTruthy()
    }
  })

  it('contient les champs clés (starts_at, ends_at, title, duration, type, lot, location, member_count)', () => {
    const keys = SORTABLE_EVENT_FIELDS.map((f) => f.key)
    for (const k of ['starts_at', 'ends_at', 'title', 'duration', 'type', 'lot', 'location', 'member_count']) {
      expect(keys).toContain(k)
    }
  })
})

describe('eventSortValue', () => {
  const ev = mkEvent({
    id: 'x', title: 'Tournage', type_id: 'T1', lot_id: 'L1', location_id: 'P1',
    starts_at: '2026-04-20T08:00:00Z', ends_at: '2026-04-20T12:00:00Z',
    members: [
      { profile_id: 'u1', status: 'confirmed' },
      { profile_id: 'u2', status: 'declined' }, // ignoré
    ],
  })
  const ctx = {
    typeMap:     { T1: { label: 'Tournage', color: '#F00' } },
    lotMap:      { L1: { title: 'Film principal' } },
    locationMap: { P1: { name: 'Studio Paris' } },
  }

  it('starts_at → timestamp numérique', () => {
    expect(eventSortValue(ev, 'starts_at')).toBe(new Date('2026-04-20T08:00:00Z').getTime())
  })

  it('duration → différence ms', () => {
    expect(eventSortValue(ev, 'duration')).toBe(4 * 60 * 60 * 1000)
  })

  it('title → lowercased', () => {
    expect(eventSortValue(ev, 'title')).toBe('tournage')
  })

  it('type → label lowercased via typeMap', () => {
    expect(eventSortValue(ev, 'type', ctx)).toBe('tournage')
  })

  it('lot → title lowercased via lotMap', () => {
    expect(eventSortValue(ev, 'lot', ctx)).toBe('film principal')
  })

  it('location → name lowercased via locationMap', () => {
    expect(eventSortValue(ev, 'location', ctx)).toBe('studio paris')
  })

  it('member_count exclut les membres declined', () => {
    expect(eventSortValue(ev, 'member_count')).toBe(1)
  })

  it('retourne null pour un champ inconnu', () => {
    expect(eventSortValue(ev, 'unknown')).toBeNull()
  })

  it('retourne null pour un event null/undefined', () => {
    expect(eventSortValue(null, 'title')).toBeNull()
    expect(eventSortValue(undefined, 'title')).toBeNull()
  })
})

describe('sortEventsByField', () => {
  const a = mkEvent({ id: 'a', title: 'Beta',  starts_at: '2026-04-20T10:00:00Z', ends_at: '2026-04-20T11:00:00Z' })
  const b = mkEvent({ id: 'b', title: 'Alpha', starts_at: '2026-04-21T10:00:00Z', ends_at: '2026-04-21T13:00:00Z' })
  const c = mkEvent({ id: 'c', title: 'Gamma', starts_at: '2026-04-19T10:00:00Z', ends_at: '2026-04-19T10:30:00Z' })

  it('tri ascendant par starts_at', () => {
    const out = sortEventsByField([a, b, c], { field: 'starts_at', direction: 'asc' })
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('tri descendant par starts_at', () => {
    const out = sortEventsByField([a, b, c], { field: 'starts_at', direction: 'desc' })
    expect(out.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('tri alpha par titre', () => {
    const out = sortEventsByField([a, b, c], { field: 'title', direction: 'asc' })
    expect(out.map((e) => e.id)).toEqual(['b', 'a', 'c'])
  })

  it('tri par durée (asc = plus court d\'abord)', () => {
    const out = sortEventsByField([a, b, c], { field: 'duration', direction: 'asc' })
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'b'])
  })

  it('valeurs manquantes toujours en bas (quelle que soit la direction)', () => {
    const missingTitle = mkEvent({ id: 'm', title: '' })
    const asc = sortEventsByField([missingTitle, a, b], { field: 'title', direction: 'asc' })
    expect(asc[asc.length - 1].id).toBe('m')
    const desc = sortEventsByField([missingTitle, a, b], { field: 'title', direction: 'desc' })
    expect(desc[desc.length - 1].id).toBe('m')
  })

  it('tri stable : les égalités préservent l\'ordre original', () => {
    const e1 = mkEvent({ id: '1', title: 'Same', starts_at: '2026-04-20T10:00:00Z', ends_at: '2026-04-20T11:00:00Z' })
    const e2 = mkEvent({ id: '2', title: 'Same', starts_at: '2026-04-20T10:00:00Z', ends_at: '2026-04-20T11:00:00Z' })
    const e3 = mkEvent({ id: '3', title: 'Same', starts_at: '2026-04-20T10:00:00Z', ends_at: '2026-04-20T11:00:00Z' })
    const out = sortEventsByField([e1, e2, e3], { field: 'title', direction: 'asc' })
    expect(out.map((e) => e.id)).toEqual(['1', '2', '3'])
  })

  it('ne mute pas le tableau d\'entrée', () => {
    const input = [a, b, c]
    const snapshot = [...input]
    sortEventsByField(input, { field: 'title', direction: 'asc' })
    expect(input).toEqual(snapshot)
  })

  it('retourne la liste originale (copie) si sortBy absent ou sans field', () => {
    expect(sortEventsByField([a, b], null).map((e) => e.id)).toEqual(['a', 'b'])
    expect(sortEventsByField([a, b], {}).map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('gère une entrée non-array (null) sans planter', () => {
    expect(sortEventsByField(null, { field: 'title' })).toEqual([])
  })
})

describe('formatDuration', () => {
  it('retourne "—" pour valeurs invalides', () => {
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(-100)).toBe('—')
    expect(formatDuration(NaN)).toBe('—')
  })

  it('formate minutes si < 1h', () => {
    expect(formatDuration(30 * 60 * 1000)).toBe('30min')
    expect(formatDuration(45 * 60 * 1000)).toBe('45min')
  })

  it('formate h + min si < 24h', () => {
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe('2h')
    expect(formatDuration(2.5 * 60 * 60 * 1000)).toBe('2h 30min')
  })

  it('formate j + h si >= 24h (min masquées pour lisibilité)', () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe('1j')
    expect(formatDuration((24 + 2) * 60 * 60 * 1000)).toBe('1j 2h')
    expect(formatDuration(3 * 24 * 60 * 60 * 1000)).toBe('3j')
  })
})

// ─── PL-3.5 étape 5 : Timeline (packing + layout lanes) ─────────────────────

describe('packEventIntervals', () => {
  const mk = (id, s, e) => ({ id, starts_at: s, ends_at: e })

  it('retourne une liste vide pour []/null/undefined', () => {
    expect(packEventIntervals([])).toEqual([])
    expect(packEventIntervals(null)).toEqual([])
    expect(packEventIntervals(undefined)).toEqual([])
  })

  it('place un event seul dans une seule sub-row', () => {
    const rows = packEventIntervals([mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')])
    expect(rows).toHaveLength(1)
    expect(rows[0].map((e) => e.id)).toEqual(['a'])
  })

  it('place des events non-chevauchants dans la MÊME sub-row', () => {
    const rows = packEventIntervals([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z'),
      mk('b', '2026-05-01T10:30:00Z', '2026-05-01T11:30:00Z'),
      mk('c', '2026-05-01T12:00:00Z', '2026-05-01T13:00:00Z'),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('crée une 2e sub-row pour un chevauchement partiel', () => {
    const rows = packEventIntervals([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z'),
      mk('b', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z'), // chevauche a
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0][0].id).toBe('a')
    expect(rows[1][0].id).toBe('b')
  })

  it('autorise deux events adjacents (fin = début) dans la même row', () => {
    const rows = packEventIntervals([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z'),
      mk('b', '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('minimise le nombre de sub-rows (first-fit)', () => {
    // a,b,c se chevauchent tous → 3 sub-rows
    const rows = packEventIntervals([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T12:00:00Z'),
      mk('b', '2026-05-01T10:00:00Z', '2026-05-01T13:00:00Z'),
      mk('c', '2026-05-01T11:00:00Z', '2026-05-01T14:00:00Z'),
    ])
    expect(rows).toHaveLength(3)
  })

  it('reply en first-fit : un event long laisse ses successeurs non-overlap retomber sur la row 0', () => {
    const rows = packEventIntervals([
      mk('long', '2026-05-01T09:00:00Z', '2026-05-01T18:00:00Z'),
      mk('mid',  '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'), // overlap long
      mk('late', '2026-05-01T19:00:00Z', '2026-05-01T20:00:00Z'), // post-long
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].map((e) => e.id)).toEqual(['long', 'late'])
    expect(rows[1].map((e) => e.id)).toEqual(['mid'])
  })

  it('n\u2019altère pas la liste passée en entrée', () => {
    const input = [
      mk('b', '2026-05-01T10:00:00Z', '2026-05-01T11:00:00Z'),
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z'),
    ]
    const snapshot = input.map((e) => e.id)
    packEventIntervals(input)
    expect(input.map((e) => e.id)).toEqual(snapshot)
  })
})

describe('layoutTimelineLanes', () => {
  const mk = (id, s, e, extra = {}) => ({
    id, starts_at: s, ends_at: e, ...extra,
  })

  it('retourne une lane unique __all__ si pas de groupBy', () => {
    const out = layoutTimelineLanes(
      [mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z')],
      { groupBy: null },
    )
    expect(out).toHaveLength(1)
    expect(out[0].key).toBe('__all__')
    expect(out[0].events).toHaveLength(1)
    expect(out[0].rows).toHaveLength(1)
  })

  it('groupe par lot avec packing intra-lane', () => {
    const out = layoutTimelineLanes([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z', { lot_id: 'L1' }),
      mk('b', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', { lot_id: 'L1' }),
      mk('c', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { lot_id: 'L2' }),
    ], { groupBy: 'lot' })
    // 2 lanes distincts L1 / L2
    expect(out).toHaveLength(2)
    const laneL1 = out.find((l) => l.key === 'L1')
    const laneL2 = out.find((l) => l.key === 'L2')
    // L1 : 2 events overlap → 2 sub-rows
    expect(laneL1.rows).toHaveLength(2)
    // L2 : 1 event → 1 sub-row
    expect(laneL2.rows).toHaveLength(1)
  })

  it('range la lane __null__ en fin de liste', () => {
    const out = layoutTimelineLanes([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { lot_id: 'L1' }),
      mk('b', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { lot_id: null }),
      mk('c', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { lot_id: 'L2' }),
    ], { groupBy: 'lot' })
    expect(out[out.length - 1].key).toBe('__null__')
  })

  it('ne plante pas sur une liste vide', () => {
    expect(layoutTimelineLanes([], { groupBy: 'lot' })).toEqual([])
    expect(layoutTimelineLanes(null, { groupBy: 'lot' })).toEqual([])
  })

  it('groupe par type : chaque event dans sa lane', () => {
    const out = layoutTimelineLanes([
      mk('a', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { type_id: 'T1' }),
      mk('b', '2026-05-01T09:00:00Z', '2026-05-01T10:00:00Z', { type_id: 'T2' }),
      mk('c', '2026-05-02T09:00:00Z', '2026-05-02T10:00:00Z', { type_id: 'T1' }),
    ], { groupBy: 'type' })
    expect(out).toHaveLength(2)
    const laneT1 = out.find((l) => l.key === 'T1')
    expect(laneT1.events).toHaveLength(2)
    // Les 2 events T1 ne se chevauchent pas → 1 seule sub-row
    expect(laneT1.rows).toHaveLength(1)
  })
})

// ── Gantt v2 (zoom / densité / milestones) ────────────────────────────────

describe('TIMELINE_ZOOMS', () => {
  it('expose les trois niveaux de zoom attendus', () => {
    expect(Object.keys(TIMELINE_ZOOMS).sort()).toEqual(['day', 'month', 'week'])
  })

  it('chaque zoom a un dayWidth numérique strictement positif', () => {
    for (const z of Object.values(TIMELINE_ZOOMS)) {
      expect(typeof z.dayWidth).toBe('number')
      expect(z.dayWidth).toBeGreaterThan(0)
    }
  })

  it('dayWidth décroît monotonement de day > week > month (plus on dézoome, plus serré)', () => {
    expect(TIMELINE_ZOOMS.day.dayWidth).toBeGreaterThan(TIMELINE_ZOOMS.week.dayWidth)
    expect(TIMELINE_ZOOMS.week.dayWidth).toBeGreaterThan(TIMELINE_ZOOMS.month.dayWidth)
  })

  it('TIMELINE_ZOOM_ORDER contient les 3 clés dans l\u2019ordre du plus fin au plus large', () => {
    expect(TIMELINE_ZOOM_ORDER).toEqual(['day', 'week', 'month'])
  })
})

describe('TIMELINE_DENSITIES', () => {
  it('expose comfortable et compact', () => {
    expect(Object.keys(TIMELINE_DENSITIES).sort()).toEqual(['comfortable', 'compact'])
  })

  it('comfortable a une rowHeight plus grande que compact', () => {
    expect(TIMELINE_DENSITIES.comfortable.rowHeight).toBeGreaterThan(TIMELINE_DENSITIES.compact.rowHeight)
  })
})

describe('isMilestone', () => {
  const mk = (starts, ends) => ({ starts_at: starts, ends_at: ends })

  it('retourne true pour un event de durée nulle', () => {
    expect(isMilestone(mk('2026-05-01T09:00:00Z', '2026-05-01T09:00:00Z'))).toBe(true)
  })

  it('retourne true pour un event de 30 min', () => {
    expect(isMilestone(mk('2026-05-01T09:00:00Z', '2026-05-01T09:30:00Z'))).toBe(true)
  })

  it('retourne true pour un event de 2h (≤ seuil 5h)', () => {
    expect(isMilestone(mk('2026-05-01T09:00:00Z', '2026-05-01T11:00:00Z'))).toBe(true)
  })

  it('retourne true pour un event de pile 5h (seuil inclusif)', () => {
    expect(isMilestone(mk('2026-05-01T09:00:00Z', '2026-05-01T14:00:00Z'))).toBe(true)
  })

  it('retourne false pour un event de 6h', () => {
    expect(isMilestone(mk('2026-05-01T09:00:00Z', '2026-05-01T15:00:00Z'))).toBe(false)
  })

  it('retourne false pour un event d\u2019une journée entière', () => {
    expect(isMilestone(mk('2026-05-01T00:00:00Z', '2026-05-02T00:00:00Z'))).toBe(false)
  })

  it('retourne false pour des entrées invalides sans lancer', () => {
    expect(isMilestone(null)).toBe(false)
    expect(isMilestone(undefined)).toBe(false)
    expect(isMilestone({})).toBe(false)
    expect(isMilestone({ starts_at: 'pas-une-date', ends_at: 'nope' })).toBe(false)
  })

  it('TIMELINE_MILESTONE_MAX_MS vaut exactement 5h en millisecondes', () => {
    expect(TIMELINE_MILESTONE_MAX_MS).toBe(5 * 60 * 60 * 1000)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// layoutMonthBars — barres continues multi-jours dans la grille mensuelle
// ───────────────────────────────────────────────────────────────────────────
describe('layoutMonthBars', () => {
  // Construit une grille 6×7 commençant le lundi 2026-03-30 (pour mois = avril 2026)
  // Ligne 0 : 30/03 → 05/04
  // Ligne 1 : 06/04 → 12/04
  // Ligne 2 : 13/04 → 19/04
  // Ligne 3 : 20/04 → 26/04
  // Ligne 4 : 27/04 → 03/05
  // Ligne 5 : 04/05 → 10/05
  function makeGrid() {
    const cells = []
    const start = new Date(2026, 2, 30) // 30 mars 2026 (mois 0-indexé)
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      cells.push(d)
    }
    return cells
  }

  function mkEvent(id, startIso, endIso, extra = {}) {
    return { id, starts_at: startIso, ends_at: endIso, ...extra }
  }

  it('retourne 6 lignes même sans event', () => {
    const rows = layoutMonthBars(makeGrid(), [])
    expect(rows).toHaveLength(6)
    rows.forEach((r, i) => {
      expect(r.rowIdx).toBe(i)
      expect(r.bars).toEqual([])
      expect(r.overflowByCol).toEqual([0, 0, 0, 0, 0, 0, 0])
    })
  })

  it('event sur un seul jour → une barre startCol === endCol, pas de continuation', () => {
    const ev = mkEvent('a', '2026-04-15T10:00:00Z', '2026-04-15T12:00:00Z')
    const rows = layoutMonthBars(makeGrid(), [ev])
    // Ligne 2 : 13/04..19/04, donc le 15/04 est col 2
    expect(rows[2].bars).toHaveLength(1)
    expect(rows[2].bars[0].startCol).toBe(2)
    expect(rows[2].bars[0].endCol).toBe(2)
    expect(rows[2].bars[0].continuesLeft).toBe(false)
    expect(rows[2].bars[0].continuesRight).toBe(false)
    expect(rows[2].bars[0].laneIndex).toBe(0)
  })

  it('event de 3 jours dans la même semaine → une seule barre continue', () => {
    // Ven 17/04 → Dim 19/04 (col 4, 5, 6 de la ligne 2)
    const ev = mkEvent('live', '2026-04-17T09:00:00Z', '2026-04-19T12:00:00Z', { title: 'LIVE' })
    const rows = layoutMonthBars(makeGrid(), [ev])
    // Seule la ligne 2 doit avoir la barre
    expect(rows[2].bars).toHaveLength(1)
    expect(rows[2].bars[0].startCol).toBe(4)
    expect(rows[2].bars[0].endCol).toBe(6)
    expect(rows[2].bars[0].continuesLeft).toBe(false)
    expect(rows[2].bars[0].continuesRight).toBe(false)
    // Les autres lignes n'ont rien
    expect(rows[0].bars).toHaveLength(0)
    expect(rows[1].bars).toHaveLength(0)
    expect(rows[3].bars).toHaveLength(0)
  })

  it('event qui traverse 2 semaines → 2 segments avec flags de continuation', () => {
    // Jeu 16/04 → Mar 21/04 : couvre ligne 2 (16..19) et ligne 3 (20..21)
    const ev = mkEvent('camp', '2026-04-16T09:00:00Z', '2026-04-21T12:00:00Z', { title: 'Camp' })
    const rows = layoutMonthBars(makeGrid(), [ev])
    // Ligne 2 : col 3 (jeu) → col 6 (dim), continuesRight
    expect(rows[2].bars).toHaveLength(1)
    expect(rows[2].bars[0].startCol).toBe(3)
    expect(rows[2].bars[0].endCol).toBe(6)
    expect(rows[2].bars[0].continuesLeft).toBe(false)
    expect(rows[2].bars[0].continuesRight).toBe(true)
    // Ligne 3 : col 0 (lun) → col 1 (mar), continuesLeft
    expect(rows[3].bars).toHaveLength(1)
    expect(rows[3].bars[0].startCol).toBe(0)
    expect(rows[3].bars[0].endCol).toBe(1)
    expect(rows[3].bars[0].continuesLeft).toBe(true)
    expect(rows[3].bars[0].continuesRight).toBe(false)
  })

  it('event qui traverse 3 semaines → 3 segments avec flags au milieu', () => {
    // Dim 05/04 (fin ligne 0) → Lun 20/04 (début ligne 3)
    // Touche les lignes 0, 1, 2, 3
    const ev = mkEvent('long', '2026-04-05T12:00:00Z', '2026-04-20T12:00:00Z', { title: 'Long' })
    const rows = layoutMonthBars(makeGrid(), [ev])
    expect(rows[0].bars).toHaveLength(1)
    expect(rows[0].bars[0].startCol).toBe(6) // 05/04 = dim = col 6
    expect(rows[0].bars[0].continuesRight).toBe(true)
    expect(rows[0].bars[0].continuesLeft).toBe(false)

    expect(rows[1].bars).toHaveLength(1)
    expect(rows[1].bars[0].startCol).toBe(0)
    expect(rows[1].bars[0].endCol).toBe(6)
    expect(rows[1].bars[0].continuesLeft).toBe(true)
    expect(rows[1].bars[0].continuesRight).toBe(true)

    expect(rows[2].bars).toHaveLength(1)
    expect(rows[2].bars[0].startCol).toBe(0)
    expect(rows[2].bars[0].endCol).toBe(6)
    expect(rows[2].bars[0].continuesLeft).toBe(true)
    expect(rows[2].bars[0].continuesRight).toBe(true)

    expect(rows[3].bars).toHaveLength(1)
    expect(rows[3].bars[0].endCol).toBe(0) // 20/04 = lun = col 0
    expect(rows[3].bars[0].continuesLeft).toBe(true)
    expect(rows[3].bars[0].continuesRight).toBe(false)
  })

  it('deux events qui se chevauchent → lanes différentes', () => {
    // A : 14/04..16/04 (col 1..3)
    // B : 15/04..17/04 (col 2..4) — chevauche A → lane 1
    const a = mkEvent('a', '2026-04-14T12:00:00Z', '2026-04-16T12:00:00Z', { title: 'A' })
    const b = mkEvent('b', '2026-04-15T12:00:00Z', '2026-04-17T12:00:00Z', { title: 'B' })
    const rows = layoutMonthBars(makeGrid(), [a, b])
    const row = rows[2]
    expect(row.bars).toHaveLength(2)
    const byTitle = Object.fromEntries(row.bars.map((b) => [b.event.title, b]))
    expect(byTitle.A.laneIndex).toBe(0)
    expect(byTitle.B.laneIndex).toBe(1)
  })

  it('trois events disjoints → tous en lane 0 (packé gauche→droite)', () => {
    const a = mkEvent('a', '2026-04-13T12:00:00Z', '2026-04-13T14:00:00Z', { title: 'A' })
    const b = mkEvent('b', '2026-04-15T12:00:00Z', '2026-04-15T14:00:00Z', { title: 'B' })
    const c = mkEvent('c', '2026-04-17T12:00:00Z', '2026-04-17T14:00:00Z', { title: 'C' })
    const rows = layoutMonthBars(makeGrid(), [a, b, c])
    const row = rows[2]
    expect(row.bars).toHaveLength(3)
    // Trié par startCol : A, B, C
    expect(row.bars.map((b) => b.event.title)).toEqual(['A', 'B', 'C'])
    expect(row.bars.every((b) => b.laneIndex === 0)).toBe(true)
  })

  it('overflow : 4 events simultanés avec maxLanes=3 → 1 overflow par jour couvert', () => {
    // Tous sur 15/04 (col 2 de ligne 2)
    const evs = [
      mkEvent('1', '2026-04-15T09:00:00Z', '2026-04-15T10:00:00Z', { title: '1' }),
      mkEvent('2', '2026-04-15T10:00:00Z', '2026-04-15T11:00:00Z', { title: '2' }),
      mkEvent('3', '2026-04-15T11:00:00Z', '2026-04-15T12:00:00Z', { title: '3' }),
      mkEvent('4', '2026-04-15T12:00:00Z', '2026-04-15T13:00:00Z', { title: '4' }),
    ]
    const rows = layoutMonthBars(makeGrid(), evs, 3)
    const row = rows[2]
    expect(row.bars).toHaveLength(3)
    // Overflow = 1 sur la col 2 uniquement
    expect(row.overflowByCol).toEqual([0, 0, 1, 0, 0, 0, 0])
  })

  it('overflow sur plusieurs jours : barre longue overflow → N jours comptés', () => {
    // 3 barres longues 14..16 (col 1..3) saturent les 3 lanes
    const base = ['a', 'b', 'c'].map((id, i) =>
      mkEvent(id, '2026-04-14T12:00:00Z', '2026-04-16T12:00:00Z', { title: id.toUpperCase() + i }),
    )
    // 4ème event chevauchant → overflow sur col 1, 2 et 3
    const extra = mkEvent('x', '2026-04-14T12:00:00Z', '2026-04-16T12:00:00Z', { title: 'X' })
    const rows = layoutMonthBars(makeGrid(), [...base, extra], 3)
    const row = rows[2]
    expect(row.bars).toHaveLength(3)
    expect(row.overflowByCol[0]).toBe(0)
    expect(row.overflowByCol[1]).toBe(1)
    expect(row.overflowByCol[2]).toBe(1)
    expect(row.overflowByCol[3]).toBe(1)
    expect(row.overflowByCol[4]).toBe(0)
  })

  it('ignore les events sans dates valides', () => {
    const bad = [
      { id: 'x' },
      { id: 'y', starts_at: 'pas-une-date', ends_at: 'nope' },
      { id: 'z', starts_at: null, ends_at: null },
    ]
    const rows = layoutMonthBars(makeGrid(), bad)
    rows.forEach((r) => expect(r.bars).toHaveLength(0))
  })

  it('entrées non-tableaux → renvoie 6 lignes vides sans crasher', () => {
    const rows = layoutMonthBars(null, undefined)
    expect(rows).toHaveLength(6)
    rows.forEach((r) => {
      expect(r.bars).toEqual([])
      expect(r.overflowByCol).toEqual([0, 0, 0, 0, 0, 0, 0])
    })
  })

  it('grille incomplète (< 42 cells) → 6 lignes vides', () => {
    const rows = layoutMonthBars([new Date(), new Date()], [])
    expect(rows).toHaveLength(6)
    rows.forEach((r) => expect(r.bars).toEqual([]))
  })

  it('event entièrement hors de la grille → aucune barre rendue', () => {
    // 15/02/2026 : hors de la grille (30/03 → 10/05)
    const ev = mkEvent('old', '2026-02-15T09:00:00Z', '2026-02-15T10:00:00Z')
    const rows = layoutMonthBars(makeGrid(), [ev])
    rows.forEach((r) => expect(r.bars).toHaveLength(0))
  })

  it('respecte maxLanes=1 (usage hypothétique compact)', () => {
    const a = mkEvent('a', '2026-04-14T12:00:00Z', '2026-04-16T12:00:00Z', { title: 'A' })
    const b = mkEvent('b', '2026-04-15T12:00:00Z', '2026-04-17T12:00:00Z', { title: 'B' })
    const rows = layoutMonthBars(makeGrid(), [a, b], 1)
    expect(rows[2].bars).toHaveLength(1)
    expect(rows[2].bars[0].event.title).toBe('A')
    // B est overflow sur col 2, 3, 4
    expect(rows[2].overflowByCol[2]).toBe(1)
    expect(rows[2].overflowByCol[3]).toBe(1)
    expect(rows[2].overflowByCol[4]).toBe(1)
  })

  it('packing efficace : long puis court disjoints → tous en lane 0', () => {
    // Barre longue 13..15, puis barre courte 17 → col 4 libre pour lane 0
    const long = mkEvent('long', '2026-04-13T12:00:00Z', '2026-04-15T12:00:00Z', { title: 'Long' })
    const short = mkEvent('short', '2026-04-17T12:00:00Z', '2026-04-17T14:00:00Z', { title: 'Short' })
    const rows = layoutMonthBars(makeGrid(), [long, short])
    const row = rows[2]
    expect(row.bars).toHaveLength(2)
    expect(row.bars.every((b) => b.laneIndex === 0)).toBe(true)
  })
})

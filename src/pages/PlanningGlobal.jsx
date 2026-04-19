/**
 * PlanningGlobal — Vue cross-projets de tous les événements accessibles.
 *
 * Périmètre (PG-4 livré) :
 *   - Porte les 4 vues (Mois / Semaine-Jour / Timeline-Gantt / Kanban + Table
 *     + Swimlanes) avec la même structure que PlanningTab.
 *   - Vues sauvegardées scope='global' (project_id = NULL dans planning_views)
 *     + CRUD complet (create / duplicate / rename / delete / config) via les
 *     handlers câblés au PlanningViewSelector et au PlanningViewConfigDrawer.
 *   - 4 presets globaux (Mois / Gantt 3 mois / Tournages à venir / Kanban par
 *     type) via PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY.
 *   - Les events sont listés via listEventsAcrossOrg — RLS garantit que chaque
 *     utilisateur ne voit que les projets dont il est membre.
 *   - Chaque event affiche le titre du projet en préfixe ("ZLAN 2026 · LIVE")
 *     pour distinguer visuellement les projets sans recoder le chip.
 *   - Clic sur un event → EventEditorModal EN PLACE (vue/édition). Le modal
 *     inclut un lien "Voir dans le projet →" pour rebondir vers le planning
 *     du projet parent si besoin du contexte complet.
 *
 * Pas livré ici :
 *   - Polish mobile + empty/loading states + tests (PG-5).
 *
 * Si aucune vue globale DB n'existe, on tombe sur BUILTIN_PLANNING_VIEWS du
 * lib (Mois/Semaine/Jour) — la première personnalisation (add / duplicate /
 * preset) crée une vue DB en scope=global (project_id=NULL).
 *
 * RLS : on délègue à la politique sur `events`. Un prestataire ne voit que
 * les events des projets où il est membre ; un admin voit tout l'org.
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import { CalendarDays, Plus, X, FolderOpen } from 'lucide-react'
import toast from 'react-hot-toast'

import {
  listEventsAcrossOrg,
  listEventTypes,
  listLocations,
  updateEvent,
  detachOccurrence,
  findEventConflicts,
  filterEventsByConfig,
  buildMemberMap,
  defaultViewConfig,
  listGlobalPlanningViews,
  createPlanningView,
  updatePlanningView,
  patchPlanningViewConfig,
  deletePlanningView,
  duplicatePlanningView,
  PLANNING_VIEW_KINDS,
  PLANNING_VIEW_PRESETS_GLOBAL,
  PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY,
} from '../lib/planning'
import { supabase } from '../lib/supabase'
import { expandEvents } from '../lib/rrule'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { useAuth } from '../contexts/AuthContext'
import { notify } from '../lib/notify'

import PlanningViewSelector from '../features/planning/PlanningViewSelector'
import PlanningViewConfigDrawer from '../features/planning/PlanningViewConfigDrawer'
import PlanningViewActionModal from '../features/planning/PlanningViewActionModal'
import MonthCalendar from '../features/planning/MonthCalendar'
import TimelineCalendar from '../features/planning/TimelineCalendar'
import PlanningTableView from '../features/planning/PlanningTableView'
import PlanningKanbanView from '../features/planning/PlanningKanbanView'
import PlanningTimelineView from '../features/planning/PlanningTimelineView'
import EventEditorModal from '../features/planning/EventEditorModal'
import EventMoveScopeModal from '../features/planning/EventMoveScopeModal'
import {
  addDays,
  addMonths,
  daysToIsoRange,
  fmtDateLongFR,
  fmtShortRangeFR,
  fmtWeekRangeFR,
  getConsecutiveDays,
  getWeekDays,
  startOfDay,
  startOfMonth,
  startOfWeekMonday,
} from '../features/planning/dateUtils'

// ─── Built-in views globales (non persistées, fallback avant 1re DB view) ────
//
// Les 3 views calendar_* de planning.js sont reprises à l'identique, auxquelles
// on ajoute les 4 advanced (timeline, kanban, table, swimlanes) pour livrer
// d'emblée toutes les vues disponibles. Servent de fallback quand la DB n'a
// aucune vue en scope=global (project_id=NULL). Dès que l'utilisateur crée/
// duplique/applique un preset, les vues DB prennent le relais et les built-ins
// disparaissent (pattern identique à PlanningTab + seedDefaultPlanningViewsForProject,
// mais sans auto-seed côté org pour l'instant).
const BUILTIN_PLANNING_VIEWS_GLOBAL = [
  {
    id: 'builtin:global:calendar_month',
    name: 'Mois',
    kind: 'calendar_month',
    icon: 'Calendar',
    sort_order: 10,
    is_default: true,
    is_shared: true,
    _builtin: true,
    config: defaultViewConfig('calendar_month'),
  },
  {
    id: 'builtin:global:calendar_week',
    name: 'Semaine',
    kind: 'calendar_week',
    icon: 'CalendarDays',
    sort_order: 20,
    _builtin: true,
    config: defaultViewConfig('calendar_week'),
  },
  {
    id: 'builtin:global:calendar_day',
    name: 'Jour',
    kind: 'calendar_day',
    icon: 'CalendarClock',
    sort_order: 30,
    _builtin: true,
    config: defaultViewConfig('calendar_day'),
  },
  {
    id: 'builtin:global:timeline',
    name: 'Timeline (Gantt)',
    kind: 'timeline',
    icon: 'GanttChart',
    sort_order: 40,
    _builtin: true,
    // groupBy='type' par défaut en global : les lots étant scoping projet,
    // grouper par lot cross-projets génère des dizaines de lanes pas très
    // utiles. Par type, on voit toutes les réunions/tournages/etc. de tous
    // les projets d'un coup — lecture plus lisible en MVP. L'utilisateur
    // pourra basculer sur 'project' une fois PG-3 livré.
    config: { ...defaultViewConfig('timeline'), groupBy: 'type' },
  },
  {
    id: 'builtin:global:kanban',
    name: 'Kanban',
    kind: 'kanban',
    icon: 'LayoutGrid',
    sort_order: 50,
    _builtin: true,
    config: defaultViewConfig('kanban'), // groupBy='type' par défaut
  },
  {
    id: 'builtin:global:table',
    name: 'Tableau',
    kind: 'table',
    icon: 'Table2',
    sort_order: 60,
    _builtin: true,
    config: defaultViewConfig('table'),
  },
  {
    id: 'builtin:global:swimlanes',
    name: 'Swimlanes équipe',
    kind: 'swimlanes',
    icon: 'Rows3',
    sort_order: 70,
    _builtin: true,
    config: defaultViewConfig('swimlanes'), // groupBy='member'
  },
]

const KIND_TO_VIEWMODE = {
  calendar_month: 'month',
  calendar_week:  'week',
  calendar_day:   'day',
}
function viewModeFromKind(kind) {
  return KIND_TO_VIEWMODE[kind] || 'month'
}

/**
 * Retourne `baseName`, ou `baseName 2`, `baseName 3`, … si le nom est déjà
 * pris par une vue de `pool`. Casse-insensible, trim-aware. Dupliqué depuis
 * PlanningTab pour éviter un import croisé sur un utilitaire aussi petit.
 */
function uniquifyViewName(baseName, pool = []) {
  const trimmed = (baseName || '').trim()
  if (!trimmed) return 'Sans titre'
  const norm = (s) => (s || '').trim().toLowerCase()
  const taken = new Set(pool.map((v) => norm(v.name)))
  if (!taken.has(norm(trimmed))) return trimmed
  for (let i = 2; i < 100; i++) {
    const candidate = `${trimmed} ${i}`
    if (!taken.has(norm(candidate))) return candidate
  }
  return `${trimmed} ${Date.now()}`
}

export default function PlanningGlobal() {
  const bp = useBreakpoint()
  const { org } = useAuth() || {}
  const orgId = org?.id || null

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [rawEvents, setRawEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false) // true après 1er fetch events
  const [error, setError] = useState(null)

  // Types + Locations + Lots + Projets org-scoped, chargés une seule fois.
  // Requis par le modal, par les views (lookup maps pour labels de groupement)
  // et par le drawer de config (PG-3 : filtre "Projets").
  const [eventTypes, setEventTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [lots, setLots] = useState([])
  // `rawProjects` = liste brute issue de la requête (tous les projets attachés,
  // indépendamment des permissions planning). On en dérive ensuite `projects`
  // (projets avec canRead) et `editableProjects` (projets avec canEdit) via
  // les RPC can_read_outil / can_edit_outil — cf. PERM-6.
  const [rawProjects, setRawProjects] = useState([])
  const [planningPermsByProjectId, setPlanningPermsByProjectId] = useState({})
  const [permsReady, setPermsReady] = useState(false) // PERM-6 : true après 1re résolution RPC
  const [projectsReady, setProjectsReady] = useState(false) // PG-5a : true après 1er load

  // View switcher — PG-4 : vues persistées en DB (project_id=NULL = scope global).
  // État initial = built-ins locaux (fallback immédiat) ; loadViews() remplace
  // par les vues DB dès le premier fetch. Si la DB est vide, on reste sur les
  // built-ins tant que l'utilisateur n'a rien créé (Add / Preset / Duplicate).
  const [views, setViews] = useState(() => [...BUILTIN_PLANNING_VIEWS_GLOBAL])
  const [activeViewId, setActiveViewId] = useState(
    () => BUILTIN_PLANNING_VIEWS_GLOBAL[0].id,
  )

  // activeView = vue DB ou built-in selon l'état de la liste.
  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) || views[0] || null,
    [views, activeViewId],
  )
  const viewMode = viewModeFromKind(activeView?.kind)

  // Modal édition — ouvert au clic sur un event, projectLink pour rebondir.
  const [selectedEvent, setSelectedEvent] = useState(null)
  const [selectedProject, setSelectedProject] = useState(null) // { id, title }

  // Modale scope pour drag/resize d'une occurrence récurrente.
  // pendingMove = { event, newStart, newEnd, mode: 'move'|'resize' } | null
  const [pendingMove, setPendingMove] = useState(null)

  // ── Drawer de config ─────────────────────────────────────────────────────
  // Ouvert via le bouton ⚙ du PlanningViewSelector. Édite directement la vue
  // DB active (patchPlanningViewConfig). Sur un built-in, on invite à dupliquer.
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)

  // Modal d'action (rename / delete) sur une vue planning (PG-4d). null = fermé.
  // Forme : { mode: 'rename' | 'delete', view: PlanningView, busy: boolean }
  const [viewActionModal, setViewActionModal] = useState(null)

  // ── Création cross-projet (PG-3e) ────────────────────────────────────────
  // Flow : clic "Nouvel événement" → picker projet (si >1) → EventEditorModal
  // en mode création. `newEventProject` est le projet cible choisi.
  const [projectPickerOpen, setProjectPickerOpen] = useState(false)
  const [newEventProject, setNewEventProject] = useState(null) // { id, title }

  // ── Fenêtre de chargement ───────────────────────────────────────────────────
  // Timeline/Swimlanes/Table/Kanban : ±6 mois autour de la date courante (sert
  // de superset pour le scrubber sans re-fetch DB).
  // Semaine / Jour : fenêtre glissante 3/5/7 jours selon bp.
  // Mois : grille 6 semaines autour du mois courant.
  const isGanttKind =
    activeView?.kind === 'timeline' || activeView?.kind === 'swimlanes'
  const timelineWindowDays = isGanttKind
    ? (Number.isFinite(activeView?.config?.windowDays) ? activeView.config.windowDays : 30)
    : 0

  const weekDaysCount = bp.isMobile ? 3 : bp.isTablet ? 5 : 7

  const timelineDays = useMemo(() => {
    if (viewMode === 'week') {
      if (weekDaysCount === 3) return getConsecutiveDays(currentDate, 3)
      if (weekDaysCount === 5) return getWeekDays(currentDate).slice(0, 5)
      return getWeekDays(currentDate)
    }
    if (viewMode === 'day') return getConsecutiveDays(currentDate, 1)
    return []
  }, [viewMode, currentDate, weekDaysCount])

  const windowRange = useMemo(() => {
    if (activeView?.kind === 'table' || activeView?.kind === 'kanban') {
      const from = addMonths(startOfMonth(currentDate), -6)
      const to   = addMonths(startOfMonth(currentDate), +6)
      return { from: from.toISOString(), to: to.toISOString() }
    }
    if (isGanttKind) {
      const from = addMonths(startOfMonth(currentDate), -6)
      const to   = addMonths(startOfMonth(currentDate), +6)
      return { from: from.toISOString(), to: to.toISOString() }
    }
    if (viewMode === 'month') {
      const gridStart = startOfWeekMonday(startOfMonth(currentDate))
      const gridEnd = new Date(gridStart)
      gridEnd.setDate(gridEnd.getDate() + 42)
      return { from: gridStart.toISOString(), to: gridEnd.toISOString() }
    }
    if (viewMode === 'week' || viewMode === 'day') {
      return daysToIsoRange(timelineDays)
    }
    return { from: null, to: null }
  }, [currentDate, viewMode, activeView?.kind, isGanttKind, timelineDays])

  // ── Chargement one-shot : types / locations / lots / projets ────────────
  // Les lots sont chargés à plat (tous projets confondus, RLS filtre). Utilisés
  // comme lookup map dans Kanban/Timeline/Table pour les labels de colonnes.
  // Projets (PG-3) : id + title, non archivés, triés alphabétiquement —
  // alimente le filtre "Projets" du drawer et le picker "Nouvel événement".
  useEffect(() => {
    let cancelled = false
    Promise.all([
      listEventTypes({ includeArchived: false }),
      listLocations({ includeArchived: false }),
      supabase
        .from('devis_lots')
        .select('id, title, sort_order, archived, project_id')
        .order('sort_order', { ascending: true }),
      supabase
        .from('projects')
        .select('id, title, archived_at')
        .is('archived_at', null)
        .order('title', { ascending: true }),
    ])
      .then(([types, locs, lotsRes, projRes]) => {
        if (cancelled) return
        setEventTypes(types || [])
        setLocations(locs || [])
        const lotsData = lotsRes?.data || []
        if (lotsRes?.error) {
          console.error('[PlanningGlobal] load lots:', lotsRes.error)
        }
        setLots(lotsData.filter((l) => !l.archived))
        const projData = projRes?.data || []
        if (projRes?.error) {
          console.error('[PlanningGlobal] load projects:', projRes.error)
        }
        setRawProjects(projData)
      })
      .catch((err) => {
        console.error('[PlanningGlobal] load types/locations/lots/projets:', err)
        if (cancelled) return
        toast.error('Types/lieux/projets indisponibles — édition limitée')
      })
      .finally(() => {
        if (!cancelled) setProjectsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── PERM-6 : résolution des permissions planning par projet ──────────────
  // Pour chaque projet attaché, on interroge les helpers SQL can_read_outil /
  // can_edit_outil via RPC. Les rôles internes (admin/charge_prod/coord.)
  // bypassent côté SQL — les fonctions renvoient true pour eux. Les
  // prestataires sont résolus via leur template + overrides (même règle que
  // côté UI, source de vérité unique).
  //
  // Coût : 2 × N requêtes (N = nombre de projets attachés). Les RPC sont
  // rapides (fonctions SQL STABLE) et on les fait en parallèle. Pour >50
  // projets on pourra passer à un RPC de batch plus tard.
  useEffect(() => {
    if (!rawProjects.length) {
      setPlanningPermsByProjectId({})
      setPermsReady(true)
      return
    }
    let cancelled = false
    setPermsReady(false)
    ;(async () => {
      try {
        const entries = await Promise.all(
          rawProjects.map(async (p) => {
            const [readRes, editRes] = await Promise.all([
              supabase.rpc('can_read_outil', { pid: p.id, outil: 'planning' }),
              supabase.rpc('can_edit_outil', { pid: p.id, outil: 'planning' }),
            ])
            return [
              p.id,
              {
                canRead: readRes.data === true,
                canEdit: editRes.data === true,
              },
            ]
          }),
        )
        if (cancelled) return
        setPlanningPermsByProjectId(Object.fromEntries(entries))
      } catch (err) {
        console.error('[PlanningGlobal] resolve planning perms:', err)
        // Fail-safe : en cas d'erreur (RPC KO), on laisse l'objet vide.
        // Les projets seront alors tous masqués du picker et de la liste,
        // ce qui est plus safe que de tout exposer.
        if (!cancelled) setPlanningPermsByProjectId({})
      } finally {
        if (!cancelled) setPermsReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [rawProjects])

  // Projets visibles (canRead sur planning) — alimente le filtre "Projets" du
  // drawer et le empty state "Aucun projet accessible".
  const projects = useMemo(
    () => rawProjects.filter((p) => planningPermsByProjectId[p.id]?.canRead),
    [rawProjects, planningPermsByProjectId],
  )

  // Projets sur lesquels l'utilisateur peut créer un événement (canEdit) —
  // alimente le picker "Nouvel événement".
  const editableProjects = useMemo(
    () => rawProjects.filter((p) => planningPermsByProjectId[p.id]?.canEdit),
    [rawProjects, planningPermsByProjectId],
  )

  // ── Chargement des events sur la fenêtre courante ────────────────────────
  const loadEvents = useCallback(async () => {
    if (!windowRange.from || !windowRange.to) return
    setLoading(true)
    setError(null)
    try {
      const data = await listEventsAcrossOrg({
        from: windowRange.from,
        to: windowRange.to,
      })
      setRawEvents(data || [])
    } catch (err) {
      console.error('[PlanningGlobal] fetch failed:', err)
      setError(err)
      toast.error('Erreur lors du chargement des événements')
    } finally {
      setLoading(false)
      setHasLoadedOnce(true)
    }
  }, [windowRange.from, windowRange.to])

  useEffect(() => { loadEvents() }, [loadEvents])

  // ── Expansion des occurrences sur la fenêtre visible ─────────────────────
  const expandedEvents = useMemo(() => {
    const from = new Date(windowRange.from)
    const to = new Date(windowRange.to)
    return expandEvents(rawEvents, from, to)
  }, [rawEvents, windowRange])

  // ── Filtrage par la config de la vue active ──────────────────────────────
  // PG-3 ajoutera un filtre par projet ; pour l'instant, les filtres de type/
  // lot/member/catégorie fonctionnent déjà tels quels (leurs UUIDs viennent
  // des events, pas du projet courant).
  const viewFilteredEvents = useMemo(
    () => filterEventsByConfig(expandedEvents, activeView?.config),
    [expandedEvents, activeView?.config],
  )

  // ── Titre préfixé avec le nom du projet parent ───────────────────────────
  // On ajoute `_origTitle` pour permettre au modal de retrouver le vrai titre
  // sans préfixe lorsqu'on clique sur un event (évite la duplication au save).
  const displayEvents = useMemo(() => {
    return viewFilteredEvents.map((ev) => {
      const projectTitle = ev.project?.title
      if (!projectTitle) return ev
      return {
        ...ev,
        _origTitle: ev.title,
        title: `${projectTitle} · ${ev.title || 'Sans titre'}`,
      }
    })
  }, [viewFilteredEvents])

  // ── Conflits équipe cross-projets ────────────────────────────────────────
  // Calculés sur l'ensemble des events (pas sur displayEvents) : un conflit
  // entre un event filtré et un autre hors filtre doit rester signalé.
  const conflicts = useMemo(
    () => findEventConflicts(expandedEvents),
    [expandedEvents],
  )

  // Map membre → nom, dérivée des events visibles (pour swimlanes).
  const memberMap = useMemo(
    () => buildMemberMap(displayEvents),
    [displayEvents],
  )

  // ── Navigation (reçue par chaque view via onPrev/onNext/onToday) ─────────
  function goPrev() {
    setCurrentDate((d) => {
      if (isGanttKind) return addDays(d, -timelineWindowDays)
      if (viewMode === 'month') return addMonths(d, -1)
      if (viewMode === 'week') return addDays(d, -weekDaysCount)
      return addDays(d, -1)
    })
  }
  function goNext() {
    setCurrentDate((d) => {
      if (isGanttKind) return addDays(d, timelineWindowDays)
      if (viewMode === 'month') return addMonths(d, +1)
      if (viewMode === 'week') return addDays(d, weekDaysCount)
      return addDays(d, 1)
    })
  }
  function goToday() { setCurrentDate(new Date()) }

  function handleJumpToDate(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    setCurrentDate(d)
  }

  // ── View switcher ────────────────────────────────────────────────────────
  function handleSelectView(view) {
    if (!view?.id) return
    setActiveViewId(view.id)
  }

  // ── PG-4 : CRUD vues DB scope=global (project_id = NULL) ──────────────────
  //
  // loadViews() charge toutes les vues globales de l'org. Si la DB en retourne
  // au moins une, on bascule sur les vues DB (les built-ins disparaissent) ;
  // sinon, on reste sur les 7 built-ins locaux. Idem PlanningTab + seed.
  const loadViews = useCallback(async () => {
    try {
      const list = await listGlobalPlanningViews()
      // listGlobalPlanningViews renvoie BUILTIN_PLANNING_VIEWS (3 vues) si la
      // DB est vide ; on préfère ici nos BUILTIN_PLANNING_VIEWS_GLOBAL (7 vues)
      // pour garder les 4 kinds avancés accessibles dès la 1re visite.
      const hasDbGlobal = (list || []).some((v) => !v._builtin)
      const next = hasDbGlobal ? list : [...BUILTIN_PLANNING_VIEWS_GLOBAL]
      setViews(next)

      // Sélection initiale : on priorise une vue calendar_month (comme PlanningTab).
      setActiveViewId((currentId) => {
        // Si la vue actuellement active existe toujours dans la nouvelle liste,
        // on la conserve (stabilité UX : rafraîchir ne doit pas jump la vue).
        if (currentId && next.some((v) => v.id === currentId)) return currentId
        const monthViews = next.filter((v) => v.kind === 'calendar_month')
        const defaultView =
          monthViews.find((v) => v.is_default) ||
          monthViews[0] ||
          next.find((v) => v.is_default) ||
          next[0]
        return defaultView?.id || null
      })
    } catch (e) {
      console.error('[PlanningGlobal] load views:', e)
      setViews([...BUILTIN_PLANNING_VIEWS_GLOBAL])
      setActiveViewId(BUILTIN_PLANNING_VIEWS_GLOBAL[0].id)
    }
  }, [])

  useEffect(() => { loadViews() }, [loadViews])

  // Crée une nouvelle vue DB (scope=global). Si l'utilisateur n'a que des
  // built-ins, on persiste à la fois la nouvelle vue ET les built-ins touchés
  // du même kind ne seront plus affichés (la logique de loadViews bascule sur
  // DB dès qu'une vue globale existe).
  const handleAddView = useCallback(async (kind) => {
    if (!PLANNING_VIEW_KINDS[kind]?.implemented) {
      notify.info('Cette vue arrive bientôt — reste branché.')
      return
    }
    if (!orgId) {
      notify.error('Organisation indisponible — impossible de créer la vue.')
      return
    }
    try {
      const baseLabel = PLANNING_VIEW_KINDS[kind].label
      const name = uniquifyViewName(baseLabel, views)
      const sameKindExists = views.some((v) => !v._builtin && v.kind === kind)
      const created = await createPlanningView({
        project_id: null,
        org_id:     orgId,
        kind,
        name,
        is_shared:  true,
      })
      notify.success('Vue créée')
      await loadViews()
      setActiveViewId(created.id)
      // Option A (cohérent avec PlanningTab) : si une vue du même kind existait
      // déjà, on ouvre le drawer pour inviter la perso.
      if (sameKindExists) setConfigDrawerOpen(true)
    } catch (e) {
      console.error('[PlanningGlobal] create view:', e)
      notify.error(e.message || 'Erreur lors de la création de la vue')
    }
  }, [views, orgId, loadViews])

  // Crée une vue à partir d'un preset global (Mois / Gantt 3m / Tournages /
  // Kanban). Même mécanique que handleAddView, avec config pré-remplie.
  const handleAddPreset = useCallback(async (presetKey) => {
    const preset = PLANNING_VIEW_PRESETS_GLOBAL_BY_KEY[presetKey]
    if (!preset) {
      // Le PlanningViewSelector propose aussi les presets projet
      // (PLANNING_VIEW_PRESETS) ; s'ils ne matchent pas en global, fallback
      // silencieux. PG-4 : on n'expose que les presets globaux via l'init
      // de PLANNING_VIEW_PRESETS (importé par le selector) — mais tolérer
      // un key projet évite une régression si le selector est étendu.
      notify.error('Preset inconnu')
      return
    }
    if (!PLANNING_VIEW_KINDS[preset.kind]?.implemented) {
      notify.info('Cette vue arrive bientôt — reste branché.')
      return
    }
    if (!orgId) {
      notify.error('Organisation indisponible — impossible de créer la vue.')
      return
    }
    try {
      const name = uniquifyViewName(preset.label, views)
      const created = await createPlanningView({
        project_id: null,
        org_id:     orgId,
        kind:       preset.kind,
        name,
        config:     preset.config,
        is_shared:  true,
      })
      notify.success(`Vue « ${preset.label} » créée`)
      await loadViews()
      setActiveViewId(created.id)
    } catch (e) {
      console.error('[PlanningGlobal] create preset:', e)
      notify.error(e.message || 'Erreur lors de la création de la vue')
    }
  }, [views, orgId, loadViews])

  // Duplique une vue (built-in ou DB) en scope=global. Pour les built-ins on
  // force project_id=null explicite (overrides.project_id doit être lu via
  // 'in' dans duplicatePlanningView — fix PG-4a).
  const handleDuplicateView = useCallback(async (view) => {
    if (!view) return
    if (!orgId) {
      notify.error('Organisation indisponible — impossible de dupliquer.')
      return
    }
    try {
      const name = uniquifyViewName(
        `${view.name || PLANNING_VIEW_KINDS[view.kind]?.label || 'Vue'} (copie)`,
        views,
      )
      const created = await duplicatePlanningView(view, {
        project_id: null,
        org_id:     orgId,
        name,
      })
      notify.success('Vue dupliquée')
      await loadViews()
      setActiveViewId(created.id)
    } catch (e) {
      console.error('[PlanningGlobal] duplicate view:', e)
      notify.error(e.message || 'Erreur lors de la duplication')
    }
  }, [views, orgId, loadViews])

  // Entry points : ouvrent le modal intégré.
  const handleRenameView = useCallback((view) => {
    if (!view || view._builtin) return
    setViewActionModal({ mode: 'rename', view, busy: false })
  }, [])

  const handleDeleteView = useCallback((view) => {
    if (!view || view._builtin) return
    setViewActionModal({ mode: 'delete', view, busy: false })
  }, [])

  const handleConfirmRename = useCallback(async (nextName) => {
    const target = viewActionModal?.view
    if (!target || !nextName) return
    setViewActionModal((m) => (m ? { ...m, busy: true } : m))
    try {
      await updatePlanningView(target.id, { name: nextName })
      notify.success('Vue renommée')
      await loadViews()
      setViewActionModal(null)
    } catch (e) {
      console.error('[PlanningGlobal] rename view:', e)
      notify.error(e.message || 'Erreur lors du renommage')
      setViewActionModal((m) => (m ? { ...m, busy: false } : m))
    }
  }, [viewActionModal, loadViews])

  const handleConfirmDelete = useCallback(async () => {
    const target = viewActionModal?.view
    if (!target) return
    setViewActionModal((m) => (m ? { ...m, busy: true } : m))
    try {
      await deletePlanningView(target.id)
      notify.success('Vue supprimée')
      await loadViews()
      setViewActionModal(null)
      if (target.id === activeViewId) setConfigDrawerOpen(false)
    } catch (e) {
      console.error('[PlanningGlobal] delete view:', e)
      notify.error(e.message || 'Erreur lors de la suppression')
      setViewActionModal((m) => (m ? { ...m, busy: false } : m))
    }
  }, [viewActionModal, activeViewId, loadViews])

  const handleCancelViewAction = useCallback(() => {
    if (viewActionModal?.busy) return
    setViewActionModal(null)
  }, [viewActionModal])

  // Drawer de config : ouvre, ferme, sauvegarde.
  const handleOpenConfig = useCallback(() => {
    setConfigDrawerOpen(true)
  }, [])

  const handleCloseConfigDrawer = useCallback(() => {
    setConfigDrawerOpen(false)
  }, [])

  // Sauvegarde de la config de la vue active. Pour un built-in, on auto-clone
  // vers une vue DB (project_id=null) puis on applique la config : c'est la
  // même UX que "dupliquer avant modifier" mais sans forcer l'utilisateur à
  // cliquer un bouton supplémentaire.
  const handleSaveConfig = useCallback(async (nextConfig) => {
    if (!activeView) return
    if (!orgId) {
      notify.error('Organisation indisponible — impossible d\u2019enregistrer.')
      return
    }
    try {
      if (activeView._builtin) {
        // Auto-clone : on promeut le built-in en vue DB avec la config modifiée.
        const name = uniquifyViewName(activeView.name || 'Vue', views)
        const created = await createPlanningView({
          project_id: null,
          org_id:     orgId,
          kind:       activeView.kind,
          name,
          config:     nextConfig,
          is_shared:  true,
        })
        notify.success('Vue enregistrée')
        await loadViews()
        setActiveViewId(created.id)
        setConfigDrawerOpen(false)
        return
      }
      const updated = await patchPlanningViewConfig(activeView.id, nextConfig)
      notify.success('Vue mise à jour')
      setViews((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
      setConfigDrawerOpen(false)
    } catch (e) {
      console.error('[PlanningGlobal] save view config:', e)
      notify.error(e.message || 'Erreur lors de l\u2019enregistrement')
    }
  }, [activeView, views, orgId, loadViews])

  const handleDuplicateFromDrawer = useCallback(async () => {
    if (!activeView) return
    await handleDuplicateView(activeView)
    setConfigDrawerOpen(false)
  }, [activeView, handleDuplicateView])

  const handleRenameFromDrawer = useCallback(async () => {
    if (!activeView) return
    handleRenameView(activeView)
  }, [activeView, handleRenameView])

  const handleDeleteFromDrawer = useCallback(async () => {
    if (!activeView) return
    handleDeleteView(activeView)
    setConfigDrawerOpen(false)
  }, [activeView, handleDeleteView])

  // ── Création cross-projet (PG-3e) ────────────────────────────────────────
  // Clic "Nouvel événement" → si 0 projet éditable, erreur ; si 1 seul,
  // ouverture directe du modal ; sinon, ouverture du picker.
  // Depuis PERM-6 : on filtre sur `editableProjects` (canEdit sur planning)
  // et non plus sur `projects` (canRead) — un user avec lecture seule ne
  // doit pas voir de projet proposé à la création.
  const handleClickNewEvent = useCallback(() => {
    if (!editableProjects.length) {
      toast.error('Aucun projet avec permission « Planning — Éditer »')
      return
    }
    if (editableProjects.length === 1) {
      setNewEventProject({
        id: editableProjects[0].id,
        title: editableProjects[0].title || '',
      })
      return
    }
    setProjectPickerOpen(true)
  }, [editableProjects])

  const handlePickProject = useCallback((project) => {
    setNewEventProject({ id: project.id, title: project.title || '' })
    setProjectPickerOpen(false)
  }, [])

  const handleCloseNewEventModal = useCallback(() => {
    setNewEventProject(null)
  }, [])

  const handleNewEventSaved = useCallback(async () => {
    setNewEventProject(null)
    await loadEvents()
  }, [loadEvents])

  // ── Clic sur un event : ouvre le modal en place ──────────────────────────
  const handleEventClick = useCallback((ev) => {
    const projectId = ev?.project?.id
    if (!projectId) {
      toast.error('Projet introuvable pour cet événement')
      return
    }
    // Event "propre" pour le modal : on restaure le title d'origine et on
    // conserve toutes les autres clés (incl. _master_id / _is_occurrence /
    // _occurrence_key / rrule / members) pour que le modal gère correctement
    // les occurrences virtuelles.
    const cleanedEvent = {
      ...ev,
      title: ev._origTitle ?? ev.title,
    }
    setSelectedEvent(cleanedEvent)
    setSelectedProject({
      id: projectId,
      title: ev.project?.title || '',
    })
  }, [])

  // Clic sur un jour / slot : no-op pour PG-2 (créer un event demande de
  // choisir un projet → PG-3). handleDayOrSlotClick est accepté par les vues
  // mais on l'ignore volontairement.
  const handleDayOrSlotClick = useCallback(() => {
    /* intentionnellement vide */
  }, [])

  // Fermeture du modal (Annuler / X / clic hors cadre).
  const closeModal = useCallback(() => {
    setSelectedEvent(null)
    setSelectedProject(null)
  }, [])

  const handleSaved = useCallback(async () => {
    closeModal()
    await loadEvents()
  }, [closeModal, loadEvents])

  // ── Drag & drop / resize (identique à PlanningTab) ───────────────────────
  //
  // PERM-6 : on vérifie canEdit sur le projet parent avant d'autoriser la
  // mutation. Si l'utilisateur n'a que canRead, on notifie et on return —
  // l'UI n'affiche alors aucun side-effect (pas de saut vers une ancienne
  // position puisqu'on n'a pas fait d'optimistic update).
  function canEditEventProject(ev) {
    const pid = ev?.project?.id || ev?.project_id
    return pid ? planningPermsByProjectId[pid]?.canEdit === true : false
  }

  function handleEventMove(ev, newStart, newEnd) {
    if (!canEditEventProject(ev)) {
      notify.error('Permission « Planning — Éditer » requise sur ce projet.')
      return
    }
    if (ev._is_occurrence) {
      setPendingMove({ event: ev, newStart, newEnd, mode: 'move' })
      return
    }
    applyMove(ev, newStart, newEnd, 'all')
  }

  function handleEventResize(ev, newEnd) {
    if (!canEditEventProject(ev)) {
      notify.error('Permission « Planning — Éditer » requise sur ce projet.')
      return
    }
    const start = new Date(ev.starts_at)
    if (ev._is_occurrence) {
      setPendingMove({ event: ev, newStart: start, newEnd, mode: 'resize' })
      return
    }
    applyMove(ev, start, newEnd, 'all')
  }

  async function applyMove(ev, newStart, newEnd, scope) {
    const masterId = ev._master_id || ev.id
    const corePayload = {
      starts_at: newStart.toISOString(),
      ends_at: newEnd.toISOString(),
    }

    // Optimistic update (comme PlanningTab) pour éviter que l'event "saute"
    // le temps du round-trip DB.
    if (!ev._is_occurrence || scope === 'all') {
      setRawEvents((prev) => prev.map((row) => {
        if (row.id !== masterId) return row
        if (ev._is_occurrence && scope === 'all') {
          const loadedStart = new Date(ev.starts_at).getTime()
          const loadedEnd = new Date(ev.ends_at).getTime()
          const dS = newStart.getTime() - loadedStart
          const dE = newEnd.getTime() - loadedEnd
          return {
            ...row,
            starts_at: new Date(new Date(ev._master_starts_at).getTime() + dS).toISOString(),
            ends_at: new Date(new Date(ev._master_ends_at).getTime() + dE).toISOString(),
          }
        }
        return { ...row, starts_at: corePayload.starts_at, ends_at: corePayload.ends_at }
      }))
    }

    try {
      if (ev._is_occurrence && scope === 'this') {
        await detachOccurrence(
          { ...ev, id: masterId },
          ev._occurrence_key,
          corePayload,
        )
        notify.success('Occurrence déplacée')
      } else if (ev._is_occurrence && scope === 'all') {
        const loadedStart = new Date(ev.starts_at).getTime()
        const loadedEnd = new Date(ev.ends_at).getTime()
        const deltaStart = newStart.getTime() - loadedStart
        const deltaEnd = newEnd.getTime() - loadedEnd
        const masterStart = new Date(new Date(ev._master_starts_at).getTime() + deltaStart)
        const masterEnd = new Date(new Date(ev._master_ends_at).getTime() + deltaEnd)
        await updateEvent(masterId, {
          starts_at: masterStart.toISOString(),
          ends_at: masterEnd.toISOString(),
        })
        notify.success('Série mise à jour')
      } else {
        await updateEvent(masterId, corePayload)
        notify.success('Événement déplacé')
      }
      await loadEvents()
    } catch (e) {
      console.error('[PlanningGlobal] applyMove error:', e)
      notify.error(e.message || 'Erreur lors du déplacement')
      await loadEvents()
    } finally {
      setPendingMove(null)
    }
  }

  // ── Drag & drop Kanban (déplace une carte d'une colonne à l'autre) ───────
  async function handleMoveCard(ev, groupBy, nextKey) {
    if (!canEditEventProject(ev)) {
      notify.error('Permission « Planning — Éditer » requise sur ce projet.')
      return
    }
    if (!ev || !groupBy) return
    // Mapping local (évite un import circulaire) — identique à planning.js.
    const FIELD = { type: 'type_id', lot: 'lot_id', location: 'location_id' }
    const field = FIELD[groupBy]
    if (!field) return

    const nextValue = nextKey === '__null__' ? null : nextKey
    const currentValue = ev[field] ?? null
    if (currentValue === nextValue) return

    const masterId = ev._master_id || ev.id

    setRawEvents((prev) => prev.map((row) => {
      if (row.id !== masterId) return row
      const patch = { [field]: nextValue }
      if (field === 'type_id') patch.type = null
      if (field === 'lot_id') patch.lot = null
      if (field === 'location_id') patch.location = null
      return { ...row, ...patch }
    }))

    try {
      await updateEvent(masterId, { [field]: nextValue })
      notify.success('Carte déplacée')
      await loadEvents()
    } catch (e) {
      console.error('[PlanningGlobal] handleMoveCard error:', e)
      notify.error(e.message || 'Erreur lors du déplacement')
      await loadEvents()
    }
  }

  // Handler clic sur un jour dans la vue Mois → zoom vers la vue Jour centrée
  // sur la date cliquée, comme dans PlanningTab.
  function handleMonthDayClick(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    const dayView = views.find((v) => v.kind === 'calendar_day')
    if (dayView) {
      setCurrentDate(d)
      setActiveViewId(dayView.id)
    }
  }

  function handleWeekDayClick(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    const dayView = views.find((v) => v.kind === 'calendar_day')
    if (dayView) {
      setCurrentDate(d)
      setActiveViewId(dayView.id)
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  const timelineLabel =
    viewMode === 'week'
      ? (weekDaysCount < 7 ? fmtShortRangeFR(timelineDays) : fmtWeekRangeFR(currentDate))
      : viewMode === 'day'
        ? fmtDateLongFR(currentDate)
        : ''

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Header — pattern PlanningTab : titre à gauche, view switcher + bouton
          "Nouvel événement" à droite. Le sous-titre est masqué sur mobile
          pour économiser la place ; le bouton devient icon-only au même
          breakpoint. */}
      <header
        className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 gap-3"
        style={{
          borderBottom: '1px solid var(--brd-sub)',
          background: 'var(--bg-surf)',
        }}
      >
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <CalendarDays className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-base font-bold truncate"
              style={{ color: 'var(--txt)' }}
            >
              Planning
            </h1>
            <p className="hidden sm:block text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              Tous les événements, tous projets confondus
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PlanningViewSelector
            views={views}
            activeViewId={activeViewId}
            onChange={handleSelectView}
            onAddView={handleAddView}
            onAddPreset={handleAddPreset}
            presets={PLANNING_VIEW_PRESETS_GLOBAL}
            onDuplicate={handleDuplicateView}
            onRename={handleRenameView}
            onDelete={handleDeleteView}
            onOpenConfig={handleOpenConfig}
            compact={bp.isMobile}
          />
          {/* Bouton "Nouvel événement" — masqué si aucun projet n'autorise la
              création (PERM-6). `editableProjects` = projets avec canEdit sur
              planning (prestataire sans "Éditer" n'en a aucun). */}
          {editableProjects.length > 0 && (
            <button
              type="button"
              onClick={handleClickNewEvent}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{
                background: 'var(--blue)',
                color: '#fff',
              }}
              title="Créer un nouvel événement"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Nouvel événement</span>
            </button>
          )}
        </div>
      </header>

      {/* Zone principale — routage par kind, exact pattern PlanningTab.
          Padding identique à PlanningTab (p-3 sm:p-4 md:p-6) pour que les
          blocs (calendrier / kanban / timeline / table) aient des marges
          visuelles autour, comme sur la vue projet. */}
      <div className="flex-1 min-h-0 relative overflow-auto p-3 sm:p-4 md:p-6">
        {error ? (
          <div className="flex items-center justify-center h-64 p-6">
            <div className="text-center max-w-sm">
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--red)' }}>
                Impossible de charger le planning
              </p>
              <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                {String(error?.message || error)}
              </p>
            </div>
          </div>
        ) : projectsReady && permsReady && projects.length === 0 ? (
          // PG-5a + PERM-6 : état distinct du "aucun event". Deux cas :
          //   1. Aucun projet attaché (rawProjects vide)
          //   2. Projets attachés mais aucun avec permission « Planning Lire »
          //      (prestataire sans lecture sur planning sur tous ses projets)
          // On adapte la copie en fonction pour rester honnête sur la cause.
          <div className="flex items-center justify-center h-full p-6">
            <div className="text-center max-w-sm">
              <div
                className="mx-auto mb-3 w-12 h-12 rounded-xl flex items-center justify-center"
                style={{ background: 'var(--blue-bg)' }}
              >
                <FolderOpen className="w-5 h-5" style={{ color: 'var(--blue)' }} />
              </div>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt)' }}>
                {rawProjects.length === 0
                  ? 'Aucun projet accessible'
                  : 'Aucun planning accessible'}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--txt-3)' }}>
                {rawProjects.length === 0
                  ? (<>Le planning affiche les événements de vos projets. Créez un
                      projet ou demandez l&apos;accès à un projet existant pour
                      commencer à planifier.</>)
                  : (<>Vos projets n&apos;ont pas la permission
                      «&nbsp;Planning Lire&nbsp;» pour votre compte. Demandez
                      à un administrateur d&apos;activer cette permission.</>)}
              </p>
            </div>
          </div>
        ) : !hasLoadedOnce && loading ? (
          // PG-5a : skeleton plein écran pendant le tout premier fetch.
          // Évite le "flash" de grille vide avant que les events n'arrivent.
          // Les refresh ultérieurs montrent le badge "Chargement…" top-right.
          <PlanningGlobalSkeleton kind={activeView?.kind} />
        ) : (
          <>
            {/* NB : on ne court-circuite plus le rendu quand rawEvents est vide.
                Chaque vue gère son propre empty state interne (grille vide +
                navigation), ce qui est notamment indispensable pour la vue
                Jour : sa fenêtre DB = 24h, donc un dimanche sans event
                cachait toute la grille horaire et les contrôles de nav. */}
            {activeView?.kind === 'calendar_month' && (
              <MonthCalendar
                currentDate={currentDate}
                events={displayEvents}
                conflicts={conflicts}
                onEventClick={handleEventClick}
                onDayClick={handleMonthDayClick}
                onEventMove={handleEventMove}
                onPrev={goPrev}
                onNext={goNext}
                onToday={goToday}
              />
            )}

            {(activeView?.kind === 'calendar_week' ||
              activeView?.kind === 'calendar_day') && (
              <TimelineCalendar
                days={timelineDays}
                events={displayEvents}
                conflicts={conflicts}
                headerLabel={timelineLabel}
                onEventClick={handleEventClick}
                onSlotClick={handleDayOrSlotClick}
                onEventMove={handleEventMove}
                onEventResize={handleEventResize}
                onDayClick={viewMode === 'week' ? handleWeekDayClick : undefined}
                onPrev={goPrev}
                onNext={goNext}
                onToday={goToday}
              />
            )}

            {activeView?.kind === 'table' && (
              <PlanningTableView
                events={displayEvents}
                groupBy={activeView?.config?.groupBy || null}
                sortBy={activeView?.config?.sortBy || { field: 'starts_at', direction: 'asc' }}
                eventTypes={eventTypes}
                lots={lots}
                locations={locations}
                conflicts={conflicts}
                onEventClick={handleEventClick}
              />
            )}

            {activeView?.kind === 'kanban' && (
              <PlanningKanbanView
                events={displayEvents}
                groupBy={activeView?.config?.groupBy || 'type'}
                eventTypes={eventTypes}
                lots={lots}
                locations={locations}
                conflicts={conflicts}
                onEventClick={handleEventClick}
                onMoveCard={handleMoveCard}
              />
            )}

            {activeView?.kind === 'timeline' && (
              <PlanningTimelineView
                events={displayEvents}
                groupBy={activeView?.config?.groupBy || 'type'}
                windowStart={startOfDay(currentDate)}
                windowDays={timelineWindowDays}
                zoomLevel={activeView?.config?.zoomLevel || 'day'}
                density={activeView?.config?.density || 'comfortable'}
                showTodayLine={activeView?.config?.showTodayLine !== false}
                eventTypes={eventTypes}
                lots={lots}
                locations={locations}
                conflicts={conflicts}
                onEventClick={handleEventClick}
                onEventMove={handleEventMove}
                onEventResize={handleEventResize}
                onDayClick={handleDayOrSlotClick}
                onPrev={goPrev}
                onNext={goNext}
                onToday={goToday}
                onJumpToDate={handleJumpToDate}
              />
            )}

            {activeView?.kind === 'swimlanes' && (
              <PlanningTimelineView
                events={displayEvents}
                groupBy="member"
                windowStart={startOfDay(currentDate)}
                windowDays={timelineWindowDays}
                zoomLevel={activeView?.config?.zoomLevel || 'day'}
                density={activeView?.config?.density || 'comfortable'}
                showTodayLine={activeView?.config?.showTodayLine !== false}
                eventTypes={eventTypes}
                lots={lots}
                locations={locations}
                memberMap={memberMap}
                conflicts={conflicts}
                onEventClick={handleEventClick}
                onEventMove={handleEventMove}
                onEventResize={handleEventResize}
                onDayClick={handleDayOrSlotClick}
                onPrev={goPrev}
                onNext={goNext}
                onToday={goToday}
                onJumpToDate={handleJumpToDate}
              />
            )}

            {loading && (
              <div
                className="absolute top-3 right-3 text-[11px] px-2 py-1 rounded"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  border: '1px solid var(--brd)',
                }}
              >
                Chargement…
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal vue/édition — ouvert en place au clic sur un event. Le lien
          "Voir dans le projet →" (via projectLink) permet de rebondir vers le
          planning du projet parent si besoin.
          PERM-6 : readOnly passé selon canEdit sur le projet parent. */}
      {selectedEvent && selectedProject && (
        <EventEditorModal
          event={selectedEvent}
          projectId={selectedProject.id}
          lots={lots.filter((l) => l.project_id === selectedProject.id)}
          eventTypes={eventTypes}
          locations={locations}
          readOnly={!planningPermsByProjectId[selectedProject.id]?.canEdit}
          onClose={closeModal}
          onSaved={handleSaved}
          projectLink={{
            label: selectedProject.title,
            to: `/projets/${selectedProject.id}/planning`,
          }}
        />
      )}

      {/* Drawer de config (PG-4) — édite la config de la vue active, avec
          persistance DB via patchPlanningViewConfig. Pour un built-in, le
          handleSaveConfig auto-clone la vue en DB (scope=global) avant
          d'appliquer les changements, donc on stripe _builtin pour rendre les
          champs éditables. Les CTA rename/duplicate/delete du footer du
          drawer ne sont exposées que pour les vues DB (via flag _builtin). */}
      {configDrawerOpen && activeView && (
        <PlanningViewConfigDrawer
          view={{ ...activeView, _builtin: false }}
          eventTypes={eventTypes}
          lots={lots}
          projects={projects}
          onClose={handleCloseConfigDrawer}
          onSave={handleSaveConfig}
          onDuplicate={activeView._builtin ? undefined : handleDuplicateFromDrawer}
          onRename={activeView._builtin ? undefined : handleRenameFromDrawer}
          onDelete={activeView._builtin ? undefined : handleDeleteFromDrawer}
        />
      )}

      {/* Modal rename/delete d'une vue planning (PG-4d) */}
      {viewActionModal && (
        <PlanningViewActionModal
          mode={viewActionModal.mode}
          view={viewActionModal.view}
          busy={viewActionModal.busy}
          onConfirm={viewActionModal.mode === 'rename'
            ? handleConfirmRename
            : handleConfirmDelete}
          onCancel={handleCancelViewAction}
        />
      )}

      {/* Modale de scope drag/resize d'une occurrence */}
      {pendingMove && (
        <EventMoveScopeModal
          title={pendingMove.mode === 'resize' ? "Redimensionner l'événement" : "Déplacer l'événement"}
          description={
            pendingMove.mode === 'resize'
              ? "Cet événement fait partie d'une série récurrente. Redimensionner :"
              : "Cet événement fait partie d'une série récurrente. Appliquer le déplacement :"
          }
          onThis={() => applyMove(pendingMove.event, pendingMove.newStart, pendingMove.newEnd, 'this')}
          onAll={() => applyMove(pendingMove.event, pendingMove.newStart, pendingMove.newEnd, 'all')}
          onCancel={() => setPendingMove(null)}
        />
      )}

      {/* Picker projet (PG-3e) — affiché lorsqu'on clique "Nouvel événement"
          avec plusieurs projets éditables (PERM-6 : on limite aux projets
          avec canEdit sur planning, cf. `editableProjects`).
          Contenu minimal : une liste cliquable ; pour >20 projets, l'input
          de filtre interne suffit. */}
      {projectPickerOpen && (
        <ProjectPickerModal
          projects={editableProjects}
          onPick={handlePickProject}
          onCancel={() => setProjectPickerOpen(false)}
        />
      )}

      {/* Modal de création (PG-3e) — ouvert une fois un projet choisi.
          Réutilise EventEditorModal en mode "new" (event non fourni).
          initialDate = jour courant affiché pour un défaut intuitif. */}
      {newEventProject && (
        <EventEditorModal
          event={null}
          initialDate={currentDate}
          projectId={newEventProject.id}
          lots={lots.filter((l) => l.project_id === newEventProject.id)}
          eventTypes={eventTypes}
          locations={locations}
          onClose={handleCloseNewEventModal}
          onSaved={handleNewEventSaved}
          projectLink={{
            label: newEventProject.title,
            to: `/projets/${newEventProject.id}/planning`,
          }}
        />
      )}
    </div>
  )
}

// ─── ProjectPickerModal ──────────────────────────────────────────────────────
// Modale minimaliste pour choisir un projet avant création d'un événement.
// Inline car spécifique à PlanningGlobal ; si on la réutilise ailleurs, on
// l'extrait dans src/features/planning/.
function ProjectPickerModal({ projects, onPick, onCancel }) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return projects
    return projects.filter((p) => (p.title || '').toLowerCase().includes(s))
  }, [projects, search])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.35)' }}
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Choisir un projet"
        className="w-full max-w-sm rounded-xl shadow-2xl flex flex-col"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          maxHeight: '80vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              Nouvel événement — choisir un projet
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Fermer"
            className="p-1 rounded hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {projects.length > 6 && (
          <div className="px-4 pt-3">
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer les projets…"
              className="w-full px-3 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-6 text-xs" style={{ color: 'var(--txt-3)' }}>
              Aucun projet ne correspond.
            </div>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    className="w-full text-left px-3 py-2 rounded text-sm hover:bg-[var(--bg-elev)]"
                    style={{ color: 'var(--txt)' }}
                  >
                    {p.title || '(sans titre)'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          className="px-4 py-2 text-[11px]"
          style={{
            borderTop: '1px solid var(--brd)',
            color: 'var(--txt-3)',
            paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)',
          }}
        >
          L&apos;événement sera créé dans le projet sélectionné.
        </div>
      </div>
    </div>
  )
}

// ─── PlanningGlobalSkeleton ─────────────────────────────────────────────────
// Skeleton plein écran montré pendant le tout premier fetch d'events (avant
// hasLoadedOnce=true). Adapte la structure au kind de la vue active pour
// éviter un flash visuel quand les données arrivent : grille mois (7×6),
// colonnes semaine (7), ou simples lignes horizontales (Gantt / Kanban /
// Table / Swimlanes). Utilise animate-pulse de Tailwind pour l'animation.
function PlanningGlobalSkeleton({ kind }) {
  const pulseStyle = { background: 'var(--bg-elev)', borderRadius: 6 }
  const mutedStyle = { background: 'var(--bg-elev-2)', borderRadius: 6 }

  if (kind === 'calendar_month') {
    return (
      <div className="p-4 sm:p-6 animate-pulse" aria-label="Chargement du mois">
        <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-6" style={mutedStyle} />
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2">
          {Array.from({ length: 42 }).map((_, i) => (
            <div key={i} className="h-20 sm:h-24" style={pulseStyle} />
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'calendar_week' || kind === 'calendar_day') {
    const cols = kind === 'calendar_day' ? 1 : 7
    return (
      <div className="p-4 sm:p-6 animate-pulse" aria-label="Chargement">
        <div className={`grid gap-1 sm:gap-2 mb-3`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="h-8" style={mutedStyle} />
          ))}
        </div>
        <div className={`grid gap-1 sm:gap-2`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="h-[60vh]" style={pulseStyle} />
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'kanban') {
    return (
      <div className="p-4 sm:p-6 animate-pulse flex gap-3 overflow-hidden" aria-label="Chargement du kanban">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex-1 min-w-[240px] flex flex-col gap-2">
            <div className="h-6" style={mutedStyle} />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-16" style={pulseStyle} />
            ))}
          </div>
        ))}
      </div>
    )
  }

  // timeline / swimlanes / table : lignes horizontales empilées.
  return (
    <div className="p-4 sm:p-6 animate-pulse" aria-label="Chargement">
      <div className="h-6 mb-3 w-1/3" style={mutedStyle} />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="w-24 sm:w-32 h-10" style={mutedStyle} />
            <div className="flex-1 h-10" style={pulseStyle} />
          </div>
        ))}
      </div>
    </div>
  )
}

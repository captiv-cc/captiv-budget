/**
 * PlanningTab — Onglet planning d'un projet.
 *
 * PL-2 : vue mensuelle.
 * PL-3 : vues semaine / jour, gestion des membres convoqués (dans la modale),
 *        filtre par lot.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, Calendar as CalendarIcon, Share2 } from 'lucide-react'
import { notify } from '../../lib/notify'
import { useProjet } from '../ProjetLayout'
import MonthCalendar from '../../features/planning/MonthCalendar'
import TimelineCalendar from '../../features/planning/TimelineCalendar'
import EventEditorModal from '../../features/planning/EventEditorModal'
import EventMoveScopeModal from '../../features/planning/EventMoveScopeModal'
import PlanningViewSelector from '../../features/planning/PlanningViewSelector'
import PlanningViewConfigDrawer from '../../features/planning/PlanningViewConfigDrawer'
import PlanningViewActionModal from '../../features/planning/PlanningViewActionModal'
import PlanningTableView from '../../features/planning/PlanningTableView'
import PlanningKanbanView from '../../features/planning/PlanningKanbanView'
import PlanningTimelineView from '../../features/planning/PlanningTimelineView'
import ICalExportDrawer from '../../features/planning/ICalExportDrawer'
import LotScopeSelector from '../../components/LotScopeSelector'
import { useBreakpoint } from '../../hooks/useBreakpoint'
import {
  listEventsByProject,
  listEventTypes,
  listLocations,
  updateEvent,
  detachOccurrence,
  findEventConflicts,
  listPlanningViews,
  createPlanningView,
  updatePlanningView,
  patchPlanningViewConfig,
  deletePlanningView,
  duplicatePlanningView,
  seedDefaultPlanningViewsForProject,
  filterEventsByConfig,
  buildMemberMap,
  BUILTIN_PLANNING_VIEWS,
  PLANNING_VIEW_KINDS,
  PLANNING_VIEW_PRESETS_BY_KEY,
  GROUP_BY_FIELD_MAP,
} from '../../lib/planning'
import { expandEvents } from '../../lib/rrule'
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
} from '../../features/planning/dateUtils'

// Mapping kind → viewMode interne (les 3 kinds calendar_* sont rendus par
// MonthCalendar/TimelineCalendar ; les autres afficheront un placeholder
// "Bientôt" jusqu'aux paliers dédiés.
const KIND_TO_VIEWMODE = {
  calendar_month: 'month',
  calendar_week:  'week',
  calendar_day:   'day',
}

function viewModeFromKind(kind) {
  return KIND_TO_VIEWMODE[kind] || 'month'
}

// NB: l'ancien stockage localStorage (`captiv:planning:activeView:{projectId}`)
// restaurait la dernière vue consultée par projet. On l'a retiré (avril 2026)
// pour que l'onglet Planning ouvre toujours sur la vue marquée `is_default`
// (par défaut : Mois). Rationale : les utilisateurs perçoivent Planning comme
// une "page" et attendent un point d'entrée stable — pas une vue contextuelle
// qui dépend de leur dernière interaction. Si un jour on veut réactiver la
// persistance, la conserver via sessionStorage (pas localStorage) serait moins
// intrusif : elle se reset au prochain onglet/session.

/**
 * Retourne `baseName`, ou `baseName 2`, `baseName 3`, … si le nom est déjà
 * pris par une vue de `pool`. Casse-insensible, trim-aware.
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

export default function PlanningTab() {
  const { project, projectId, lots = [] } = useProjet() || {}
  const bp = useBreakpoint()

  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [lotScope, setLotScope] = useState('__all__')
  const [events, setEvents] = useState([])
  const [eventTypes, setEventTypes] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)

  // ── Vues multi-lentilles (PL-3.5) ────────────────────────────────────────
  const [views, setViews] = useState(() => [...BUILTIN_PLANNING_VIEWS])
  const [activeViewId, setActiveViewId] = useState(() => BUILTIN_PLANNING_VIEWS[0].id)
  const [configDrawerOpen, setConfigDrawerOpen] = useState(false)
  // Modal d'action (rename / delete) sur une vue planning. null = fermé.
  // Forme : { mode: 'rename' | 'delete', view: PlanningView, busy: boolean }
  const [viewActionModal, setViewActionModal] = useState(null)

  // Drawer "Exporter en iCal" — PL-8 v1. Ouverture via le bouton Share2 dans
  // la toolbar. Les tokens sont scopés au projet courant.
  const [icalDrawerOpen, setIcalDrawerOpen] = useState(false)

  const activeView = useMemo(
    () => views.find((v) => v.id === activeViewId) || views[0] || BUILTIN_PLANNING_VIEWS[0],
    [views, activeViewId],
  )
  const viewMode = viewModeFromKind(activeView?.kind)

  // Modale édition
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [editorInitialDate, setEditorInitialDate] = useState(null)

  // Modale de scope pour drag/resize d'une occurrence récurrente
  // pendingMove = { event, newStart, newEnd, mode: 'move'|'resize' } | null
  const [pendingMove, setPendingMove] = useState(null)

  // ── Lots actifs (pour le sélecteur de scope et le form) ──────────────────
  const activeLots = useMemo(
    () => (lots || []).filter((l) => !l.archived),
    [lots],
  )

  // ── Fenêtre de chargement selon la vue ───────────────────────────────────
  // timeline + swimlanes partagent le même composant Gantt → même config.
  const isGanttKind =
    activeView?.kind === 'timeline' || activeView?.kind === 'swimlanes'
  const timelineWindowDays = isGanttKind
    ? (Number.isFinite(activeView?.config?.windowDays) ? activeView.config.windowDays : 30)
    : 0

  // Vue Semaine responsive : 3 jours sur mobile, 5 sur tablet (Mon–Ven),
  // 7 jours classiques sur desktop. Objectif : événements lisibles sur les
  // petits écrans sans chips tronqués à 4 caractères (cf. UI review avril
  // 2026). Nav prev/next shifte d'autant de jours que la taille de vue.
  const weekDaysCount = bp.isMobile ? 3 : bp.isTablet ? 5 : 7

  // Jours effectivement affichés dans la vue timeline (week/day).
  // - Week mobile : 3 jours consécutifs à partir de `currentDate`
  //   (fenêtre glissante, pas d'ancrage lundi sur mobile)
  // - Week tablet : 5 jours à partir du lundi (Mon–Ven)
  // - Week desktop : 7 jours Mon–Sun (comportement historique)
  // - Day : 1 jour
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
    // Table view : plage large ±6 mois autour de `currentDate` pour donner
    // une vue d'ensemble sans charger toute la base.
    if (activeView?.kind === 'table' || activeView?.kind === 'kanban') {
      const from = addMonths(startOfMonth(currentDate), -6)
      const to   = addMonths(startOfMonth(currentDate), +6)
      return { from: from.toISOString(), to: to.toISOString() }
    }
    // Timeline / Swimlanes : plage ±6 mois (comme table/kanban) pour que le
    // scrubber d'ensemble puisse naviguer sans re-fetch DB à chaque drag. La
    // fenêtre VISIBLE reste `windowDays` (gérée par PlanningTimelineView via
    // `windowStart` + `windowDays`) ; on charge simplement un superset.
    if (activeView?.kind === 'timeline' || activeView?.kind === 'swimlanes') {
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
      // La plage de fetch suit exactement les jours affichés — sur mobile
      // semaine (3 jours) on ne fetch donc pas la semaine entière ; en
      // contrepartie chaque nav prev/next re-fetch, ce qui reste marginal.
      return daysToIsoRange(timelineDays)
    }
    return { from: null, to: null }
  }, [currentDate, viewMode, activeView?.kind, timelineDays])

  // ── Chargement des types d'événements & lieux (une fois) ─────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [types, locs] = await Promise.all([
          listEventTypes({ includeArchived: false }),
          listLocations({ includeArchived: false }),
        ])
        setEventTypes(types)
        setLocations(locs)
      } catch (e) {
        console.error('[Planning] load types/locations:', e)
        notify.error('Erreur de chargement des types / lieux')
      }
    })()
  }, [])

  // ── Chargement des vues du projet (PL-3.5) ───────────────────────────────
  const loadViews = useCallback(async () => {
    if (!projectId) {
      setViews([...BUILTIN_PLANNING_VIEWS])
      return
    }
    try {
      const list = await listPlanningViews(projectId)
      const next = (list && list.length) ? list : [...BUILTIN_PLANNING_VIEWS]
      setViews(next)

      // Sélection initiale (avril 2026) : on priorise toujours une vue de kind
      // `calendar_month` (= "Mois"). Rationale produit : les utilisateurs
      // attendent un point d'entrée stable et "calendaire" sur Planning, pas
      // une vue Kanban ou Table qui dépend du dernier `is_default` sauvegardé.
      // Ordre de priorité :
      //   1. Une vue kind=calendar_month (généralement "Mois" seedée ou créée
      //      manuellement). S'il y en a plusieurs, on prend celle is_default,
      //      sinon la première dans l'ordre de sort_order.
      //   2. La vue marquée is_default=true (cas où Mois a été supprimé).
      //   3. La première vue du tableau (fallback ultime).
      // localStorage a été retiré (cf. commentaire devant storageKeyForProject).
      const monthViews = next.filter((v) => v.kind === 'calendar_month')
      const defaultView =
        monthViews.find((v) => v.is_default) ||
        monthViews[0] ||
        next.find((v) => v.is_default) ||
        next[0]
      setActiveViewId(defaultView?.id || null)
    } catch (e) {
      console.error('[Planning] load views:', e)
      // En cas d'erreur (RLS, offline, …) on tombe sur les built-ins pour
      // ne pas bloquer l'utilisateur.
      setViews([...BUILTIN_PLANNING_VIEWS])
      setActiveViewId(BUILTIN_PLANNING_VIEWS[0].id)
    }
  }, [projectId])

  useEffect(() => { loadViews() }, [loadViews])

  // La persistance localStorage de la vue active a été supprimée (avril 2026).
  // L'onglet Planning ouvre toujours sur la vue `is_default` — voir loadViews
  // ci-dessus et le commentaire devant storageKeyForProject pour le rationale.

  function handleSelectView(view) {
    if (!view?.id) return
    setActiveViewId(view.id)
  }

  async function handleAddView(kind) {
    if (!PLANNING_VIEW_KINDS[kind]?.implemented) {
      notify.info('Cette vue arrive bientôt — reste branché.')
      return
    }
    if (!projectId || !project?.org_id) {
      notify.error('Projet introuvable — impossible de créer la vue.')
      return
    }
    try {
      // Si le projet n'a encore que les vues built-in (non persistées), on
      // promeut d'abord les 3 calendriers par défaut en base pour éviter que
      // le premier add custom ne "mange" les Mois/Semaine/Jour fallback.
      const onlyBuiltin = views.length > 0 && views.every((v) => v._builtin)
      let reloaded = null
      if (onlyBuiltin) {
        try {
          await seedDefaultPlanningViewsForProject(projectId)
          reloaded = await listPlanningViews(projectId)
          setViews(reloaded)
        } catch (seedErr) {
          console.warn('[Planning] seed defaults failed:', seedErr)
        }
      }

      // Si on vient de seeder et que le kind demandé EST un des kinds seedés,
      // on n'ajoute pas une duplication — on active simplement la vue seedée.
      if (onlyBuiltin && reloaded &&
          ['calendar_month','calendar_week','calendar_day'].includes(kind)) {
        const seeded = reloaded.find((v) => v.kind === kind && v.project_id === projectId)
        if (seeded) {
          notify.success('Vues par défaut initialisées')
          setActiveViewId(seeded.id)
          return
        }
      }

      // Nom par défaut + auto-suffixe si collision (Mois, Mois 2, Mois 3, …).
      const baseLabel = PLANNING_VIEW_KINDS[kind].label
      const pool = reloaded || views
      const name = uniquifyViewName(baseLabel, pool)

      // Détecte si une vue du même kind existe déjà en DB (avant création).
      // Sert à décider si on ouvre le drawer automatiquement après (Option A),
      // pour inviter l'utilisateur à différencier sa nouvelle vue.
      const sameKindExists = pool.some(
        (v) => !v._builtin && v.kind === kind && v.project_id === projectId,
      )

      const created = await createPlanningView({
        project_id: projectId,
        org_id:     project.org_id,
        kind,
        name,
        is_shared:  true,
      })
      notify.success('Vue créée')
      await loadViews()
      setActiveViewId(created.id)

      // Option A : si une vue du même kind existait déjà, la nouvelle est a
      // priori un clone en attente de personnalisation → on ouvre le drawer.
      if (sameKindExists) {
        setConfigDrawerOpen(true)
      }
    } catch (e) {
      console.error('[Planning] create view:', e)
      notify.error(e.message || 'Erreur lors de la création de la vue')
    }
  }

  // ── Presets PL-5 ────────────────────────────────────────────────────────
  // Crée une vue à partir d'un preset (Production / Prévisionnelle /
  // Tournage / Post-production). Réutilise la même mécanique d'auto-seed des
  // built-ins que handleAddView pour ne pas perdre les Mois/Semaine/Jour si
  // le projet n'a encore aucune vue persistée.
  async function handleAddPreset(presetKey) {
    const preset = PLANNING_VIEW_PRESETS_BY_KEY[presetKey]
    if (!preset) {
      notify.error('Preset inconnu')
      return
    }
    if (!PLANNING_VIEW_KINDS[preset.kind]?.implemented) {
      notify.info('Cette vue arrive bientôt — reste branché.')
      return
    }
    if (!projectId || !project?.org_id) {
      notify.error('Projet introuvable — impossible de créer la vue.')
      return
    }
    try {
      // Auto-seed des built-ins si le projet n'a encore que les fallbacks.
      const onlyBuiltin = views.length > 0 && views.every((v) => v._builtin)
      let reloaded = null
      if (onlyBuiltin) {
        try {
          await seedDefaultPlanningViewsForProject(projectId)
          reloaded = await listPlanningViews(projectId)
          setViews(reloaded)
        } catch (seedErr) {
          console.warn('[Planning] seed defaults failed:', seedErr)
        }
      }

      const pool = reloaded || views
      const name = uniquifyViewName(preset.label, pool)

      const created = await createPlanningView({
        project_id: projectId,
        org_id:     project.org_id,
        kind:       preset.kind,
        name,
        config:     preset.config,
        is_shared:  true,
      })
      notify.success(`Vue « ${preset.label} » créée`)
      await loadViews()
      setActiveViewId(created.id)
    } catch (e) {
      console.error('[Planning] create preset:', e)
      notify.error(e.message || 'Erreur lors de la création de la vue')
    }
  }

  async function handleDuplicateView(view) {
    if (!projectId || !project?.org_id) return
    try {
      const created = await duplicatePlanningView(view, {
        project_id: projectId,
        org_id:     project.org_id,
      })
      notify.success('Vue dupliquée')
      await loadViews()
      setActiveViewId(created.id)
    } catch (e) {
      console.error('[Planning] duplicate view:', e)
      notify.error(e.message || 'Erreur lors de la duplication')
    }
  }

  // Entry points : ouvrent le modal intégré (remplace window.prompt/confirm).
  function handleRenameView(view) {
    if (!view || view._builtin) return
    setViewActionModal({ mode: 'rename', view, busy: false })
  }

  function handleDeleteView(view) {
    if (!view || view._builtin) return
    setViewActionModal({ mode: 'delete', view, busy: false })
  }

  // Confirmation depuis le modal → exécute l'appel DB puis ferme le modal.
  async function handleConfirmRename(nextName) {
    const target = viewActionModal?.view
    if (!target || !nextName) return
    setViewActionModal((m) => (m ? { ...m, busy: true } : m))
    try {
      await updatePlanningView(target.id, { name: nextName })
      notify.success('Vue renommée')
      await loadViews()
      setViewActionModal(null)
    } catch (e) {
      console.error('[Planning] rename view:', e)
      notify.error(e.message || 'Erreur lors du renommage')
      setViewActionModal((m) => (m ? { ...m, busy: false } : m))
    }
  }

  async function handleConfirmDelete() {
    const target = viewActionModal?.view
    if (!target) return
    setViewActionModal((m) => (m ? { ...m, busy: true } : m))
    try {
      await deletePlanningView(target.id)
      notify.success('Vue supprimée')
      await loadViews()
      setViewActionModal(null)
      // Si on supprimait la vue active, referme aussi le drawer (la vue
      // n'existe plus, le drawer ciblait cette vue).
      if (target.id === activeViewId) setConfigDrawerOpen(false)
    } catch (e) {
      console.error('[Planning] delete view:', e)
      notify.error(e.message || 'Erreur lors de la suppression')
      setViewActionModal((m) => (m ? { ...m, busy: false } : m))
    }
  }

  function handleCancelViewAction() {
    if (viewActionModal?.busy) return
    setViewActionModal(null)
  }

  // ── Drawer de config (PL-3.5 étape 2) ────────────────────────────────────
  function handleOpenConfig() {
    setConfigDrawerOpen(true)
  }

  function handleCloseConfigDrawer() {
    setConfigDrawerOpen(false)
  }

  async function handleSaveConfig(nextConfig) {
    if (!activeView || activeView._builtin) return
    try {
      const updated = await patchPlanningViewConfig(activeView.id, nextConfig)
      notify.success('Vue mise à jour')
      // Mise à jour optimiste de la liste pour éviter un reload complet.
      setViews((prev) => prev.map((v) => (v.id === updated.id ? updated : v)))
      setConfigDrawerOpen(false)
    } catch (e) {
      console.error('[Planning] save view config:', e)
      notify.error(e.message || 'Erreur lors de l\u2019enregistrement')
    }
  }

  // Duplication depuis le drawer : on crée une copie modifiable, on la
  // sélectionne, puis on ferme le drawer (l'utilisateur le rouvrira sur la
  // nouvelle vue s'il veut la personnaliser).
  async function handleDuplicateFromDrawer() {
    if (!activeView) return
    await handleDuplicateView(activeView)
    setConfigDrawerOpen(false)
  }

  // Renommer depuis le drawer : même flow que la barre d'onglets, le drawer
  // reste ouvert avec la vue renommée (qui est déjà l'active view).
  async function handleRenameFromDrawer() {
    if (!activeView) return
    await handleRenameView(activeView)
  }

  // Supprimer depuis le drawer : on ferme le drawer après, puisque la vue
  // n'existe plus (loadViews repasse sur une autre vue active).
  async function handleDeleteFromDrawer() {
    if (!activeView) return
    await handleDeleteView(activeView)
    setConfigDrawerOpen(false)
  }

  // Tri depuis la table view : patch local immédiat + persist DB si applicable.
  // Pour les vues built-in, on ne persiste pas (pas modifiables) — le tri
  // sera perdu au prochain reload, ce qui est cohérent avec leur statut.
  async function handleSortChange(nextSortBy) {
    if (!activeView) return
    const nextConfig = { ...(activeView.config || {}), sortBy: nextSortBy }
    // Maj locale immédiate pour éviter la latence perçue
    setViews((prev) => prev.map((v) => (v.id === activeView.id ? { ...v, config: nextConfig } : v)))
    if (activeView._builtin) return
    try {
      await patchPlanningViewConfig(activeView.id, { sortBy: nextSortBy })
    } catch (e) {
      console.error('[Planning] persist sort:', e)
      // Erreur non bloquante — l'état local reste à jour, l'utilisateur
      // peut retenter au prochain clic.
    }
  }

  // Timeline : changement de zoom / densité / affichage de la ligne "today".
  // Même flow que handleSortChange — optimistic local + persist DB sauf builtin.
  // Le patch est un objet partiel (ex. { zoomLevel: 'week' }) mergé dans config.
  async function handleTimelineConfigChange(patch) {
    if (!activeView || !patch) return
    const nextConfig = { ...(activeView.config || {}), ...patch }
    setViews((prev) => prev.map((v) => (v.id === activeView.id ? { ...v, config: nextConfig } : v)))
    if (activeView._builtin) return
    try {
      await patchPlanningViewConfig(activeView.id, patch)
    } catch (e) {
      console.error('[Planning] persist timeline config:', e)
    }
  }

  // ── Drag & drop Kanban : déplace une carte d'une colonne à l'autre ───────
  //
  // nextKey peut être :
  //   - un uuid (type_id, lot_id, location_id cible)
  //   - '__null__' pour retirer la valeur (lot/location uniquement ; type_id
  //     est NOT NULL côté DB donc refusé en amont par la vue)
  //
  // Pour les occurrences d'une série récurrente, la mutation s'applique
  // toujours au master (changer le type/lot est une modification sémantique
  // de la série entière — cohérent avec le scope "Toute la série" du modal
  // drag-resize). Si on voulait plus tard permettre un détachement, il
  // faudrait ouvrir un EventMoveScopeModal comme pour les dates.
  async function handleMoveCard(ev, groupBy, nextKey) {
    if (!ev || !groupBy) return
    const field = GROUP_BY_FIELD_MAP[groupBy]
    if (!field) return

    const nextValue = nextKey === '__null__' ? null : nextKey
    const currentValue = ev[field] ?? null
    if (currentValue === nextValue) return

    const masterId = ev._master_id || ev.id

    // Optimistic update : mute le master localement AVANT l'appel DB.
    setEvents((prev) => prev.map((row) => {
      if (row.id !== masterId) return row
      const patch = { [field]: nextValue }
      // Si le champ muté est un type_id, on invalide aussi la relation
      // embarquée (`row.type`) pour que le re-render picke la bonne couleur
      // jusqu'au reload DB qui la reconstruit.
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
      console.error('[Planning] handleMoveCard error:', e)
      notify.error(e.message || 'Erreur lors du déplacement')
      // Rollback via reload DB
      await loadEvents()
    }
  }

  // ── Chargement des événements sur la fenêtre courante ────────────────────
  const loadEvents = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const data = await listEventsByProject(projectId, windowRange)
      setEvents(data)
    } catch (e) {
      console.error('[Planning] load events:', e)
      notify.error('Erreur de chargement des événements')
    } finally {
      setLoading(false)
    }
  }, [projectId, windowRange])

  useEffect(() => { loadEvents() }, [loadEvents])

  // ── Expansion des occurrences (récurrence) sur la fenêtre visible ────────
  const expandedEvents = useMemo(() => {
    const from = new Date(windowRange.from)
    const to = new Date(windowRange.to)
    return expandEvents(events, from, to)
  }, [events, windowRange])

  // ── Filtrage côté client ─────────────────────────────────────────────────
  // 1. Filtres de la vue active (PL-3.5 étape 2) — persistés en DB.
  // 2. Override lotScope (toolbar) : restreint davantage si ≠ __all__.
  // Les deux sont combinés en AND.
  const viewFilteredEvents = useMemo(
    () => filterEventsByConfig(expandedEvents, activeView?.config),
    [expandedEvents, activeView?.config],
  )
  const visibleEvents = useMemo(() => {
    if (lotScope === '__all__') return viewFilteredEvents
    return viewFilteredEvents.filter((ev) => ev.lot_id === lotScope)
  }, [viewFilteredEvents, lotScope])

  // ── Carte des conflits équipe (PL-3) ─────────────────────────────────────
  // Calculé sur l'intégralité des événements expanded (pas sur visibleEvents) :
  // un conflit entre un événement d'un lot filtré et un autre visible doit
  // rester signalé, même si l'autre partie est hors filtre.
  const conflicts = useMemo(
    () => findEventConflicts(expandedEvents),
    [expandedEvents],
  )

  // ── Index 'p:<uuid>' / 'c:<uuid>' → nom d'affichage (PL-3.5 swimlanes) ───
  // Dérivé des events visibles pour ne garder que les membres pertinents du
  // scope courant (lot filter inclus). Les declined sont déjà ignorés dans
  // buildMemberMap.
  const memberMap = useMemo(
    () => buildMemberMap(visibleEvents),
    [visibleEvents],
  )

  // ── Navigation adaptée à la vue courante ─────────────────────────────────
  // Pour la vue Semaine, on shift du nombre de jours affichés (3/5/7 selon bp).
  // Ainsi sur mobile on avance/recule par fenêtre de 3 jours, sans saut brutal.
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

  // Jump to arbitrary date depuis le scrubber timeline. On snap au début de
  // jour pour rester aligné avec la grille timeline (les autres vues ne
  // l'utilisent pas aujourd'hui).
  function handleJumpToDate(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    setCurrentDate(d)
  }

  // ── Handlers ouverture éditeur ───────────────────────────────────────────
  function handleEventClick(ev) {
    setEditingEvent(ev)
    setEditorInitialDate(null)
    setEditorOpen(true)
  }
  function handleDayOrSlotClick(date) {
    setEditingEvent(null)
    setEditorInitialDate(date)
    setEditorOpen(true)
  }

  // Handler dédié clic sur un jour dans la vue Mois (avril 2026).
  // Ancien comportement : ouvrir l'éditeur pour créer un event sur ce jour.
  // Nouveau : basculer vers la vue "Jour" (kind=calendar_day) ciblée sur la
  // date cliquée. Pattern mobile : la Mois sert de vue d'ensemble, la Jour
  // sert de vue détail — tap sur un jour = zoom.
  // La création d'un event reste accessible via le bouton "+" en header, ou
  // en tapant un créneau horaire une fois dans la vue Jour.
  // Fallback : si l'utilisateur a supprimé toutes les vues de kind
  // calendar_day, on retombe sur l'ancien comportement (ouvre l'éditeur).
  function handleMonthDayClick(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    const dayView = views.find((v) => v.kind === 'calendar_day')
    if (dayView) {
      setCurrentDate(d)
      setActiveViewId(dayView.id)
    } else {
      handleDayOrSlotClick(d)
    }
  }

  // Handler clic sur un en-tête de jour dans la vue Semaine.
  // Même pattern que handleMonthDayClick : on zoome vers la vue Jour centrée
  // sur la date cliquée. Utile surtout sur mobile où seuls 3 jours sont
  // visibles ; permet d'accéder au détail d'un jour en un tap.
  function handleWeekDayClick(date) {
    if (!date) return
    const d = startOfDay(date instanceof Date ? date : new Date(date))
    if (!Number.isFinite(d.getTime())) return
    const dayView = views.find((v) => v.kind === 'calendar_day')
    if (dayView) {
      setCurrentDate(d)
      setActiveViewId(dayView.id)
    }
    // Fallback : pas de vue Jour disponible → on reste sur Semaine.
  }
  function handleNewEvent() {
    setEditingEvent(null)
    const today = new Date()
    // Pré-remplit au jour courant visible (ou today s'il est dans la plage).
    let initDate
    if (viewMode === 'month') {
      const sameMonth =
        today.getMonth() === currentDate.getMonth() &&
        today.getFullYear() === currentDate.getFullYear()
      initDate = sameMonth ? today : startOfMonth(currentDate)
    } else if (viewMode === 'week') {
      const weekDays = getWeekDays(currentDate)
      const todayInWeek = weekDays.find((d) => d.toDateString() === today.toDateString())
      initDate = todayInWeek || weekDays[0]
    } else {
      initDate = startOfDay(currentDate)
      initDate.setHours(9, 0, 0, 0)
    }
    setEditorInitialDate(initDate)
    setEditorOpen(true)
  }

  // Handler "+" d'une colonne Kanban : crée un event pré-rempli avec le champ
  // correspondant au groupement (type_id / lot_id / location_id) pour éviter
  // à l'utilisateur de re-choisir la colonne dans l'éditeur.
  // On passe l'info via un "event synthétique" (sans id/_master_id) → le modal
  // détecte isNew=true mais lit typeId/lotId/locationId depuis nos valeurs.
  function handleAddEventInColumn(groupBy, colKey) {
    if (!groupBy) return
    const field = GROUP_BY_FIELD_MAP[groupBy]
    if (!field) return
    // 'Sans type' refusé côté DB (type_id NOT NULL).
    if (groupBy === 'type' && colKey === '__null__') return
    const value = colKey === '__null__' ? null : colKey
    const synthetic = { [field]: value }
    setEditingEvent(synthetic)
    // On garde initDate sur today-dans-la-fenêtre — cohérent avec handleNewEvent.
    const today = new Date()
    setEditorInitialDate(today)
    setEditorOpen(true)
  }

  function closeEditor() {
    setEditorOpen(false)
    setEditingEvent(null)
    setEditorInitialDate(null)
  }
  async function handleSaved() {
    closeEditor()
    await loadEvents()
  }

  // ── Drag & drop / resize (PL-5) ──────────────────────────────────────────
  //
  // handleEventMove et handleEventResize reçoivent un event qui peut être une
  // occurrence virtuelle (avec _master_id / _master_starts_at / …). On ouvre
  // alors la modale de scope ; sinon on applique directement la modif.
  function handleEventMove(ev, newStart, newEnd) {
    if (ev._is_occurrence) {
      setPendingMove({ event: ev, newStart, newEnd, mode: 'move' })
      return
    }
    applyMove(ev, newStart, newEnd, 'all')
  }

  function handleEventResize(ev, newEnd) {
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

    // ── Optimistic update : on met à jour l'état local AVANT l'appel DB pour
    //    éviter que l'event "saute" à l'ancienne position le temps du round-trip.
    //    Cas géré :
    //      - Non-récurrent      → on remplace starts_at/ends_at du master
    //      - Récurrent + scope 'all' → on applique le delta au master
    //      - Récurrent + scope 'this' (détach) → pas d'optimistic (un nouvel
    //        event va être créé et l'exdate ajouté) ; le reload DB suffira.
    if (!ev._is_occurrence || scope === 'all') {
      setEvents((prev) => prev.map((row) => {
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
        // Détache cette seule occurrence avec les nouvelles dates
        await detachOccurrence(
          { ...ev, id: masterId },
          ev._occurrence_key,
          corePayload,
        )
        notify.success('Occurrence déplacée')
      } else if (ev._is_occurrence && scope === 'all') {
        // Applique le delta au master pour préserver l'ancrage de la série
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
      console.error('[Planning] applyMove error:', e)
      notify.error(e.message || 'Erreur lors du déplacement')
      // En cas d'erreur, on recharge pour restaurer l'état réel
      await loadEvents()
    } finally {
      setPendingMove(null)
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  if (!project) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--txt-3)' }}>
        Projet introuvable.
      </div>
    )
  }

  const noTypes = !loading && eventTypes.length === 0
  // timelineDays est déjà calculé en useMemo plus haut (responsive 3/5/7).
  // Le label suit la même logique : format court sur mobile/tablet (moins
  // de place dans le header), format complet sur desktop.
  const timelineLabel =
    viewMode === 'week'
      ? (weekDaysCount < 7 ? fmtShortRangeFR(timelineDays) : fmtWeekRangeFR(currentDate))
      : viewMode === 'day'
        ? fmtDateLongFR(currentDate)
        : ''

  // Adapte le sélecteur de scope au contrat attendu par LotScopeSelector
  const lotsForSelector = activeLots.map((l) => ({ id: l.id, title: l.title || 'Lot' }))

  return (
    <div className="p-3 sm:p-4 md:p-6 flex flex-col gap-3 md:gap-4 h-full">
      {/* Header — toujours en row (mobile & desktop) : titre + icône à gauche,
          controls (sélecteur de vue + "+") serrés à droite.
          Le sous-titre est masqué en mobile pour éviter de pousser les controls
          à la ligne — cf. UI review avril 2026. */}
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <CalendarIcon className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              Planning
            </h1>
            {/* Sous-titre caché sur mobile pour gagner de la place verticale */}
            <p className="hidden sm:block text-xs" style={{ color: 'var(--txt-3)' }}>
              Vue calendrier des événements du projet
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* View switcher (PL-3.5 : sélecteur de vues multi-lentilles) */}
          <PlanningViewSelector
            views={views}
            activeViewId={activeViewId}
            onChange={handleSelectView}
            onAddView={handleAddView}
            onAddPreset={handleAddPreset}
            onDuplicate={handleDuplicateView}
            onRename={handleRenameView}
            onDelete={handleDeleteView}
            onOpenConfig={handleOpenConfig}
            compact={bp.isMobile}
          />

          {/* Exporter en iCal (PL-8 v1) — icon-only, ouvre le drawer. Masqué
              tant que le projet n'est pas chargé (pas d'org_id). */}
          {project?.org_id && (
            <button
              type="button"
              onClick={() => setIcalDrawerOpen(true)}
              aria-label="Exporter en iCal"
              title="Exporter en iCal"
              className="p-2 rounded-lg shrink-0 hover:bg-[var(--bg-elev)]"
              style={{ color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
            >
              <Share2 className="w-4 h-4" />
            </button>
          )}

          {/* Nouveau event : icon-only sur mobile, full label sur sm+ */}
          <button
            type="button"
            onClick={handleNewEvent}
            disabled={noTypes}
            aria-label="Nouvel événement"
            className="px-2.5 sm:px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50 shrink-0"
            style={{ background: 'var(--blue)', color: '#fff' }}
            title={noTypes ? "Ajoute d'abord des types dans Paramètres" : 'Nouvel événement'}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Nouvel événement</span>
          </button>
        </div>
      </div>

      {/* Scope lots (masqué si moins de 2 lots actifs) */}
      {lotsForSelector.length >= 2 && (
        <LotScopeSelector
          lotsWithRef={lotsForSelector}
          scope={lotScope}
          onChange={setLotScope}
        />
      )}

      {noTypes && (
        <div
          className="rounded-xl px-4 py-3 text-xs"
          style={{
            background: 'var(--orange-bg)',
            color: 'var(--orange)',
            border: '1px solid var(--orange)',
          }}
        >
          Aucun type d&apos;événement disponible. Rends-toi dans
          <strong> Paramètres → Types d&apos;événements </strong>
          pour créer ou réactiver au moins un type.
        </div>
      )}

      {/* Vue active (routage par kind) */}
      <div className="flex-1 min-h-0 relative">
        {activeView?.kind === 'calendar_month' && (
          <MonthCalendar
            currentDate={currentDate}
            events={visibleEvents}
            conflicts={conflicts}
            onEventClick={handleEventClick}
            /* Clic sur un jour → bascule vers la vue Jour (cf. handler). */
            onDayClick={handleMonthDayClick}
            onEventMove={handleEventMove}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
          />
        )}

        {(activeView?.kind === 'calendar_week' || activeView?.kind === 'calendar_day') && (
          <TimelineCalendar
            days={timelineDays}
            events={visibleEvents}
            conflicts={conflicts}
            headerLabel={timelineLabel}
            onEventClick={handleEventClick}
            onSlotClick={handleDayOrSlotClick}
            onEventMove={handleEventMove}
            onEventResize={handleEventResize}
            /* Tap sur un en-tête de jour (vue Semaine uniquement) →
               bascule vers la vue Jour. Pas de handler en vue Jour :
               on y est déjà. */
            onDayClick={viewMode === 'week' ? handleWeekDayClick : undefined}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
          />
        )}

        {activeView?.kind === 'table' && (
          <PlanningTableView
            events={visibleEvents}
            groupBy={activeView?.config?.groupBy || null}
            sortBy={activeView?.config?.sortBy || { field: 'starts_at', direction: 'asc' }}
            onSortChange={handleSortChange}
            eventTypes={eventTypes}
            lots={activeLots}
            locations={locations}
            conflicts={conflicts}
            onEventClick={handleEventClick}
          />
        )}

        {activeView?.kind === 'kanban' && (
          <PlanningKanbanView
            events={visibleEvents}
            groupBy={activeView?.config?.groupBy || null}
            eventTypes={eventTypes}
            lots={activeLots}
            locations={locations}
            conflicts={conflicts}
            onEventClick={handleEventClick}
            onMoveCard={handleMoveCard}
            onOpenConfig={() => setConfigDrawerOpen(true)}
            onAddEventInColumn={handleAddEventInColumn}
          />
        )}

        {activeView?.kind === 'timeline' && (
          <PlanningTimelineView
            events={visibleEvents}
            groupBy={activeView?.config?.groupBy || 'lot'}
            windowStart={startOfDay(currentDate)}
            windowDays={timelineWindowDays}
            zoomLevel={activeView?.config?.zoomLevel || 'day'}
            density={activeView?.config?.density || 'comfortable'}
            showTodayLine={activeView?.config?.showTodayLine !== false}
            eventTypes={eventTypes}
            lots={activeLots}
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
            onOpenConfig={() => setConfigDrawerOpen(true)}
            onConfigChange={handleTimelineConfigChange}
          />
        )}

        {activeView?.kind === 'swimlanes' && (
          <PlanningTimelineView
            events={visibleEvents}
            groupBy="member"
            windowStart={startOfDay(currentDate)}
            windowDays={timelineWindowDays}
            zoomLevel={activeView?.config?.zoomLevel || 'day'}
            density={activeView?.config?.density || 'comfortable'}
            showTodayLine={activeView?.config?.showTodayLine !== false}
            eventTypes={eventTypes}
            lots={activeLots}
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
            onOpenConfig={() => setConfigDrawerOpen(true)}
            onConfigChange={handleTimelineConfigChange}
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
      </div>

      {/* Drawer "Exporter en iCal" (PL-8 v1) */}
      <ICalExportDrawer
        open={icalDrawerOpen}
        onClose={() => setIcalDrawerOpen(false)}
        scope="project"
        projectId={projectId}
        projectTitle={project?.title}
        orgId={project?.org_id}
      />

      {/* Modale édition */}
      {editorOpen && (
        <EventEditorModal
          event={editingEvent}
          initialDate={editorInitialDate}
          projectId={projectId}
          lots={activeLots}
          eventTypes={eventTypes}
          locations={locations}
          onClose={closeEditor}
          onSaved={handleSaved}
        />
      )}

      {/* Drawer de configuration de vue (PL-3.5 étape 2) */}
      {configDrawerOpen && activeView && (
        <PlanningViewConfigDrawer
          view={activeView}
          eventTypes={eventTypes}
          lots={activeLots}
          onClose={handleCloseConfigDrawer}
          onSave={handleSaveConfig}
          onDuplicate={handleDuplicateFromDrawer}
          onRename={handleRenameFromDrawer}
          onDelete={handleDeleteFromDrawer}
        />
      )}

      {/* Modal rename/delete d'une vue planning (PL-3.5) */}
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
    </div>
  )
}

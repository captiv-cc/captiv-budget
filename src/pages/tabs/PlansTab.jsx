// ════════════════════════════════════════════════════════════════════════════
// PlansTab — Liste des plans techniques d'un projet
// ════════════════════════════════════════════════════════════════════════════
//
// Tab "Plans" : stocke et affiche les plans techniques d'un projet (caméra,
// lumière, son, masse, …) consultables facilement en terrain depuis mobile.
//
// Layout :
//   - Header (titre + stats + bouton Ajouter si canEdit)
//   - Filtres : chips horizontaux par catégorie + search input
//   - Grille de cards de plans (responsive 1/2/3 col)
//   - Empty state
//
// Click sur card : ouvre la URL signée du fichier dans un nouvel onglet (V1).
// Le PlanViewer modal full-screen avec pinch-zoom + multi-pages arrive en
// 4/5 du chantier — clic sur card l'ouvrira via URL state ?plan=<id>.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Calendar,
  Edit3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  List as ListIcon,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import usePlans from '../../hooks/usePlans'
import { useProjet } from '../ProjetLayout'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { getSignedUrl, formatFileSize, normalizeSearch } from '../../lib/plans'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import PlanFormModal from '../../features/plans/PlanFormModal'
import PlansShareModal from '../../features/plans/PlansShareModal'
import PlanViewer from '../../features/plans/PlanViewer'

const OUTIL_KEY = 'plans'

export default function PlansTab() {
  const { id: projectId } = useParams()
  const ctx = useProjet()
  const project = ctx?.project
  const { org } = useAuth()
  const orgId = org?.id
  const { can } = useProjectPermissions(projectId)
  const canEdit = can(OUTIL_KEY, 'edit')

  const {
    plans,
    categories,
    categoriesById,
    allTags,
    loading,
    actions,
  } = usePlans({ projectId, orgId })

  // ── Filtres / recherche ────────────────────────────────────────────────
  const [activeCategoryId, setActiveCategoryId] = useState('all')
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  // ── Mode d'affichage : grille (cards avec vignettes) ou liste (compact) ──
  // Persisté en localStorage. Si jamais défini, auto-default à "list" quand
  // le projet a > 20 plans (gestion à grande échelle plus confortable).
  const VIEW_MODE_KEY = 'plans-view-mode'
  const [viewMode, setViewModeState] = useState(() => {
    if (typeof localStorage === 'undefined') return 'grid'
    const stored = localStorage.getItem(VIEW_MODE_KEY)
    if (stored === 'grid' || stored === 'list') return stored
    return null // résolu après le 1er render via effect ci-dessous (auto)
  })
  // Auto-default selon nombre de plans, une seule fois (si pas de pref user).
  useEffect(() => {
    if (viewMode != null) return
    if (loading) return
    const activeCount = plans.filter((p) => !p.is_archived).length
    setViewModeState(activeCount > 20 ? 'list' : 'grid')
  }, [viewMode, loading, plans])
  const setViewMode = useCallback((mode) => {
    setViewModeState(mode)
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(VIEW_MODE_KEY, mode)
      } catch {
        /* noop */
      }
    }
  }, [])
  const effectiveViewMode = viewMode || 'grid'

  const filteredPlans = useMemo(() => {
    let list = plans
    if (!showArchived) list = list.filter((p) => !p.is_archived)
    if (activeCategoryId !== 'all') {
      list = list.filter((p) => p.category_id === activeCategoryId)
    }
    if (search.trim()) {
      const q = normalizeSearch(search)
      list = list.filter((p) => {
        const inName = normalizeSearch(p.name).includes(q)
        const inTags = (p.tags || []).some((t) => normalizeSearch(t).includes(q))
        const inDesc = normalizeSearch(p.description).includes(q)
        return inName || inTags || inDesc
      })
    }
    return list
  }, [plans, activeCategoryId, search, showArchived])

  // Compteurs par catégorie pour les chips.
  const countByCategory = useMemo(() => {
    const map = new Map()
    for (const p of plans) {
      if (p.is_archived) continue
      const k = p.category_id || '__uncat__'
      map.set(k, (map.get(k) || 0) + 1)
    }
    return map
  }, [plans])

  // ── Modales ─────────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)

  function openCreate() {
    setEditingPlan(null)
    setFormOpen(true)
  }

  function openEdit(plan) {
    setEditingPlan(plan)
    setFormOpen(true)
  }

  // Plans actifs (non archivés) — utilisés par la modale de partage pour la
  // checklist de sélection. On évite un double load en passant cette liste
  // déjà calculée dans usePlans.
  const activePlans = useMemo(
    () => plans.filter((p) => !p.is_archived),
    [plans],
  )
  const activeCategories = useMemo(
    () => categories.filter((c) => !c.is_archived),
    [categories],
  )

  // ── Drag & drop reorder ────────────────────────────────────────────────
  // Le D&D opère sur toute la liste des plans actifs (sort_order global). On
  // n'active le D&D que sur la vue "Toutes" sans search ni archived, sinon
  // l'ordre perçu après filtrage serait incohérent (un drop sur l'index 2 de
  // la vue filtrée changerait le sort_order absolu, donnant des ordres
  // surprenants quand l'user retire le filtre).
  const canReorder =
    canEdit &&
    activeCategoryId === 'all' &&
    !search.trim() &&
    !showArchived
  const [dragState, setDragState] = useState(null) // { id, targetId, side: 'before'|'after' }

  const handleDragStart = useCallback((id) => {
    setDragState({ id, targetId: null, side: null })
  }, [])
  const handleDragOver = useCallback((targetId, side) => {
    setDragState((prev) => {
      if (!prev) return prev
      if (prev.targetId === targetId && prev.side === side) return prev
      return { ...prev, targetId, side }
    })
  }, [])
  const handleDragLeave = useCallback((targetId) => {
    setDragState((prev) => {
      if (!prev || prev.targetId !== targetId) return prev
      return { ...prev, targetId: null, side: null }
    })
  }, [])
  const handleDragEnd = useCallback(() => {
    setDragState(null)
  }, [])
  const handleDrop = useCallback(
    async () => {
      const ds = dragState
      setDragState(null)
      if (!ds?.id || !ds?.targetId || ds.id === ds.targetId) return
      // Construit le nouvel ordre à partir de la liste filtrée affichée
      // (qui est l'ordre actuel canonique puisque canReorder est true).
      const ids = filteredPlans.map((p) => p.id)
      const fromIdx = ids.indexOf(ds.id)
      const toIdx = ids.indexOf(ds.targetId)
      if (fromIdx < 0 || toIdx < 0) return
      const insertIdx = ds.side === 'after' ? toIdx + 1 : toIdx
      const newOrder = [...ids]
      newOrder.splice(fromIdx, 1)
      const adjustedInsert = insertIdx > fromIdx ? insertIdx - 1 : insertIdx
      newOrder.splice(adjustedInsert, 0, ds.id)
      try {
        await actions.reorderPlans(newOrder)
      } catch (err) {
        console.error('[PlansTab] reorder error', err)
        notify.error('Réorganisation échouée : ' + (err?.message || err))
      }
    },
    [dragState, filteredPlans, actions],
  )

  // ── PlanViewer (URL state ?plan=<id>) ──────────────────────────────────
  // L'état "plan ouvert" vit dans l'URL. Avantages :
  //   - le bouton back natif ferme la modale (mobile + desktop + swipe-back iOS)
  //   - URL partageable (envoyer le lien direct sur le plan caméra)
  //   - deeplink fonctionne (ouvre la tab + le plan d'un coup)
  const [searchParams, setSearchParams] = useSearchParams()
  const openedPlanId = searchParams.get('plan')

  const handleOpenPlan = useCallback(
    (plan) => {
      const next = new URLSearchParams(searchParams)
      next.set('plan', plan.id)
      setSearchParams(next, { replace: false })
    },
    [searchParams, setSearchParams],
  )

  const handleCloseViewer = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('plan')
    setSearchParams(next, { replace: false })
  }, [searchParams, setSearchParams])

  async function handleArchive(plan) {
    const ok = await confirm({
      title: `Archiver « ${plan.name} » ?`,
      message: 'Le plan disparaîtra de la liste mais ses anciennes versions sont conservées. Tu pourras le restaurer depuis "Afficher les archivés".',
      confirmLabel: 'Archiver',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.archivePlan(plan.id)
      notify.success('Plan archivé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleRestore(plan) {
    try {
      await actions.restorePlan(plan.id)
      notify.success('Plan restauré')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleHardDelete(plan) {
    const ok = await confirm({
      title: 'Supprimer définitivement',
      message: `« ${plan.name} » et toutes ses versions seront effacés. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.hardDeletePlan(plan.id)
      notify.success('Plan supprimé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  // ── Rendu ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-4 sm:px-6 py-6">
        <div className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-6 py-4 sm:py-6">
      {/* Header — aligné sur le pattern MaterielHeader (grosse icône + stats + actions) */}
      <header className="flex items-start gap-3 mb-5">
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <MapIcon className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--txt)' }}>
            Plans
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {plans.filter((p) => !p.is_archived).length} plan
            {plans.filter((p) => !p.is_archived).length > 1 ? 's' : ''}
            {categories.filter((c) => !c.is_archived).length > 0 &&
              ` · ${categories.filter((c) => !c.is_archived).length} catégorie${categories.filter((c) => !c.is_archived).length > 1 ? 's' : ''}`}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1.5 shrink-0">
            {activePlans.length > 0 && (
              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-2)',
                  border: '1px solid var(--brd)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                  e.currentTarget.style.color = 'var(--txt)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elev)'
                  e.currentTarget.style.color = 'var(--txt-2)'
                }}
                title="Partager les plans (lien public)"
              >
                <Share2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Partager</span>
              </button>
            )}
            <button
              type="button"
              onClick={openCreate}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{ background: 'var(--blue)', color: 'white' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Ajouter un plan</span>
              <span className="sm:hidden">Ajouter</span>
            </button>
          </div>
        )}
      </header>

      {/* Filtres : chips catégories + search */}
      {plans.length > 0 && (
        <div className="space-y-2 mb-4">
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-md"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd)',
            }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par nom, tag, description…"
              className="flex-1 text-sm bg-transparent outline-none"
              style={{ color: 'var(--txt)' }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="p-0.5"
                style={{ color: 'var(--txt-3)' }}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Chips catégories */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto pb-1"
            style={{ scrollbarWidth: 'thin' }}
          >
            <CategoryChip
              active={activeCategoryId === 'all'}
              onClick={() => setActiveCategoryId('all')}
              label="Toutes"
              count={plans.filter((p) => !p.is_archived).length}
            />
            {categories.map((c) => {
              const count = countByCategory.get(c.id) || 0
              if (count === 0) return null
              return (
                <CategoryChip
                  key={c.id}
                  active={activeCategoryId === c.id}
                  onClick={() => setActiveCategoryId(c.id)}
                  label={c.label}
                  count={count}
                  color={c.color}
                />
              )
            })}
          </div>

          {/* Toggle archivés + mode d'affichage */}
          <div className="flex items-center justify-between gap-3">
            <ViewModeToggle mode={effectiveViewMode} onChange={setViewMode} />
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              <span style={{ color: 'var(--txt-3)' }}>Afficher les archivés</span>
            </label>
          </div>
        </div>
      )}

      {/* Grille de plans (mode grid) ou liste compacte (mode list) */}
      {filteredPlans.length === 0 ? (
        <EmptyState canEdit={canEdit} hasFilters={search || activeCategoryId !== 'all'} onCreate={openCreate} />
      ) : effectiveViewMode === 'list' ? (
        <ul
          className="rounded-lg overflow-hidden"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
          }}
        >
          {filteredPlans.map((plan, idx) => (
            <PlanListItem
              key={plan.id}
              plan={plan}
              category={plan.category_id ? categoriesById.get(plan.category_id) : null}
              canEdit={canEdit}
              isLast={idx === filteredPlans.length - 1}
              onOpen={() => handleOpenPlan(plan)}
              onEdit={() => openEdit(plan)}
              onArchive={() => handleArchive(plan)}
              onRestore={() => handleRestore(plan)}
              onDelete={() => handleHardDelete(plan)}
              draggable={canReorder}
              isDragging={dragState?.id === plan.id}
              insertSide={
                dragState?.targetId === plan.id ? dragState.side : null
              }
              onDragStart={() => handleDragStart(plan.id)}
              onDragOver={(side) => handleDragOver(plan.id, side)}
              onDragLeave={() => handleDragLeave(plan.id)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-3">
          {filteredPlans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              category={plan.category_id ? categoriesById.get(plan.category_id) : null}
              canEdit={canEdit}
              onOpen={() => handleOpenPlan(plan)}
              onEdit={() => openEdit(plan)}
              onArchive={() => handleArchive(plan)}
              onRestore={() => handleRestore(plan)}
              onDelete={() => handleHardDelete(plan)}
              draggable={canReorder}
              isDragging={dragState?.id === plan.id}
              insertSide={
                dragState?.targetId === plan.id ? dragState.side : null
              }
              onDragStart={() => handleDragStart(plan.id)}
              onDragOver={(side) => handleDragOver(plan.id, side)}
              onDragLeave={() => handleDragLeave(plan.id)}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))}
        </ul>
      )}

      {/* Modale create / edit */}
      <PlanFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        mode={editingPlan ? 'edit' : 'create'}
        plan={editingPlan}
        categories={categories.filter((c) => !c.is_archived)}
        allTags={allTags}
        projectMetadata={project?.metadata || null}
        actions={actions}
      />

      {/* Viewer plein écran (ouvert via URL state ?plan=<id>) */}
      <PlanViewer planId={openedPlanId} onClose={handleCloseViewer} />

      {/* Modale de partage (5c) — gestion des tokens publics */}
      <PlansShareModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        projectId={projectId}
        plans={activePlans}
        categories={activeCategories}
      />
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════════════
 * Sub-components
 * ═════════════════════════════════════════════════════════════════════════════
 */

function CategoryChip({ active, onClick, label, count, color }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap shrink-0 transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
        color: active ? 'var(--blue)' : 'var(--txt-2)',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
      }}
    >
      {color && (
        <span
          className="w-2 h-2 rounded-full"
          style={{ background: color }}
          aria-hidden="true"
        />
      )}
      {label}
      <span
        className="text-[10px] px-1 rounded"
        style={{ background: 'var(--bg-hov)', color: 'var(--txt-3)' }}
      >
        {count}
      </span>
    </button>
  )
}

/* ─── ViewModeToggle — bascule entre vue Grille et vue Liste ──────────────── */

function ViewModeToggle({ mode, onChange }) {
  return (
    <div
      className="inline-flex items-center rounded-md p-0.5"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      <ViewModeButton
        active={mode === 'grid'}
        onClick={() => onChange('grid')}
        Icon={LayoutGrid}
        label="Grille"
        title="Vue grille — vignettes"
      />
      <ViewModeButton
        active={mode === 'list'}
        onClick={() => onChange('list')}
        Icon={ListIcon}
        label="Liste"
        title="Vue liste — compacte (recommandé pour gros volumes)"
      />
    </div>
  )
}

function ViewModeButton({ active, onClick, Icon, label, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded transition-colors"
      style={{
        background: active ? 'var(--bg-surf)' : 'transparent',
        color: active ? 'var(--blue)' : 'var(--txt-3)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
      }}
    >
      <Icon className="w-3 h-3" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

/* ─── PlanListItem — ligne compacte (mode liste) ──────────────────────────── */

function PlanListItem({
  plan,
  category,
  canEdit,
  isLast,
  onOpen,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  draggable = false,
  isDragging = false,
  insertSide = null,
  onDragStart = null,
  onDragOver = null,
  onDragLeave = null,
  onDrop = null,
  onDragEnd = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const FileIcon = plan.file_type === 'pdf' ? FileText : ImageIcon
  const archived = plan.is_archived
  const rowRef = useRef(null)
  const menuRef = useRef(null)

  // En mode liste, l'insertion D&D est verticale (above/below). On garde
  // la même nomenclature ('before'/'after') pour rester compatible avec
  // la logique du parent (handleDrop ignore la sémantique géométrique).
  function handleNativeDragOver(e) {
    if (!draggable || !onDragOver) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return
    const midY = rect.top + rect.height / 2
    const side = e.clientY < midY ? 'before' : 'after'
    onDragOver(side)
  }

  // Fermeture menu au clic extérieur.
  useEffect(() => {
    if (!menuOpen) return undefined
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  return (
    <li
      ref={rowRef}
      className="relative flex items-center gap-3 px-3 py-2 transition-colors"
      style={{
        background: 'transparent',
        borderBottom: isLast ? 'none' : '1px solid var(--brd-sub)',
        opacity: isDragging ? 0.4 : archived ? 0.6 : 1,
        cursor: draggable ? 'grab' : 'default',
      }}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (e) => {
              e.dataTransfer.effectAllowed = 'move'
              try {
                e.dataTransfer.setData('text/plain', plan.id)
              } catch {
                /* noop */
              }
              onDragStart?.()
            }
          : undefined
      }
      onDragOver={draggable ? handleNativeDragOver : undefined}
      onDragLeave={draggable ? () => onDragLeave?.() : undefined}
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault()
              onDrop?.()
            }
          : undefined
      }
      onDragEnd={draggable ? () => onDragEnd?.() : undefined}
      onMouseEnter={(e) => {
        if (!isDragging) e.currentTarget.style.background = 'var(--bg-elev)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Ligne d'insertion horizontale (avant/après la row cible) */}
      {insertSide && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{
            height: 2,
            background: 'var(--blue)',
            boxShadow: '0 0 6px var(--blue)',
            ...(insertSide === 'before' ? { top: -1 } : { bottom: -1 }),
          }}
        />
      )}

      {/* Pastille catégorie */}
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ background: category?.color || 'var(--txt-3)' }}
        title={category?.label || 'Sans catégorie'}
      />

      {/* Nom + meta — clic ouvre le viewer */}
      <button
        type="button"
        onClick={onOpen}
        className="flex-1 min-w-0 text-left flex items-center gap-2"
        title="Ouvrir le plan"
      >
        <FileIcon
          className="w-3.5 h-3.5 shrink-0"
          style={{ color: 'var(--txt-3)' }}
        />
        <span
          className="text-sm font-semibold truncate"
          style={{ color: archived ? 'var(--txt-3)' : 'var(--txt)' }}
        >
          {plan.name}
        </span>
        {plan.current_version > 1 && (
          <span
            className="text-[10px] font-bold uppercase shrink-0 px-1 rounded"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
            }}
            title={`Version ${plan.current_version}`}
          >
            V{plan.current_version}
          </span>
        )}
      </button>

      {/* Catégorie + type + taille — masquables en mobile */}
      <div
        className="hidden sm:flex items-center gap-3 shrink-0 text-[11px]"
        style={{ color: 'var(--txt-3)' }}
      >
        {category && (
          <span className="truncate max-w-[120px]">{category.label}</span>
        )}
        <span className="uppercase font-semibold tabular-nums">
          {plan.file_type}
        </span>
        {plan.file_size > 0 && (
          <span className="tabular-nums">{formatFileSize(plan.file_size)}</span>
        )}
      </div>

      {/* Actions (admin) */}
      {canEdit && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="p-1.5 rounded transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Actions"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div
              className="absolute right-0 mt-1 z-20 rounded-md overflow-hidden min-w-[160px] shadow-lg"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
            >
              <MenuItem
                onClick={() => {
                  onOpen?.()
                  setMenuOpen(false)
                }}
                icon={ExternalLink}
                label="Ouvrir"
              />
              <MenuItem
                onClick={() => {
                  onEdit?.()
                  setMenuOpen(false)
                }}
                icon={Edit3}
                label="Modifier"
              />
              {!archived ? (
                <MenuItem
                  onClick={() => {
                    onArchive?.()
                    setMenuOpen(false)
                  }}
                  icon={Layers}
                  label="Archiver"
                />
              ) : (
                <>
                  <MenuItem
                    onClick={() => {
                      onRestore?.()
                      setMenuOpen(false)
                    }}
                    icon={RotateCcw}
                    label="Restaurer"
                  />
                  <MenuItem
                    onClick={() => {
                      onDelete?.()
                      setMenuOpen(false)
                    }}
                    icon={Trash2}
                    label="Supprimer définitivement"
                    tone="danger"
                  />
                </>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function PlanCard({
  plan,
  category,
  canEdit,
  onOpen,
  onEdit,
  onArchive,
  onRestore,
  onDelete,
  // Drag & drop reorder (optionnel — actif si draggable=true).
  draggable = false,
  isDragging = false,
  insertSide = null, // 'before' | 'after' | null
  onDragStart = null,
  onDragOver = null,
  onDragLeave = null,
  onDrop = null,
  onDragEnd = null,
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const FileIcon = plan.file_type === 'pdf' ? FileText : ImageIcon
  const archived = plan.is_archived
  const cardRef = useRef(null)

  // Calcule la position d'insertion (before/after) selon la position du
  // curseur par rapport à la card cible. Pattern aligné sur le D&D des
  // blocs matériel : ligne d'insertion directionnelle pour clarifier.
  function handleNativeDragOver(e) {
    if (!draggable || !onDragOver) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    // Sur grille 2/3 cols, "before/after" = horizontal. La card est plus
    // large que haute (ratio 4:3 vignette + meta), donc on prend le X.
    const midX = rect.left + rect.width / 2
    const side = e.clientX < midX ? 'before' : 'after'
    onDragOver(side)
  }

  // Vignette : signed URL générée à la volée (cache 10 min via Supabase).
  // Si pas de thumbnail_path (vieux plan ou génération échouée), on fallback
  // sur l'icône fichier classique. Pas de bloquant.
  const [thumbUrl, setThumbUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!plan.thumbnail_path) {
      setThumbUrl(null)
      return undefined
    }
    getSignedUrl(plan.thumbnail_path)
      .then((url) => {
        if (!cancelled) setThumbUrl(url)
      })
      .catch(() => {
        if (!cancelled) setThumbUrl(null)
      })
    return () => {
      cancelled = true
    }
  }, [plan.thumbnail_path])

  return (
    <li
      ref={cardRef}
      className="relative rounded-lg overflow-hidden transition-all flex flex-col"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        opacity: isDragging ? 0.4 : archived ? 0.6 : 1,
        cursor: draggable ? 'grab' : 'default',
      }}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (e) => {
              // Suppression de l'image fantôme par défaut sur certains
              // browsers — on garde l'opacité 0.4 sur la card source
              // comme indication.
              e.dataTransfer.effectAllowed = 'move'
              try {
                e.dataTransfer.setData('text/plain', plan.id)
              } catch {
                /* noop */
              }
              onDragStart?.()
            }
          : undefined
      }
      onDragOver={draggable ? handleNativeDragOver : undefined}
      onDragLeave={draggable ? () => onDragLeave?.() : undefined}
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault()
              onDrop?.()
            }
          : undefined
      }
      onDragEnd={draggable ? () => onDragEnd?.() : undefined}
    >
      {/* Ligne d'insertion directionnelle (avant ou après la card cible).
          Affichée sur tout le côté gauche ou droit — claire à 1px près
          pour ne pas jouer sur le layout. */}
      {insertSide && (
        <div
          className="absolute top-0 bottom-0 z-10 pointer-events-none"
          style={{
            width: 3,
            background: 'var(--blue)',
            boxShadow: '0 0 8px var(--blue)',
            ...(insertSide === 'before' ? { left: -2 } : { right: -2 }),
          }}
        />
      )}
      {/* Vignette en haut, pleine largeur, ratio 4:3 — clic = ouvrir le plan.
          - cursor zoom-in pour signaler l'interaction
          - max-height 280px pour cap mobile 1 col (la grille est en 2 col par
            défaut désormais, mais on garde la safety au cas où layout change)
          - group + group-hover:scale sur l'image pour effet "vivant" au hover
          - Si pas de thumbnail (génération échouée ou plan ancien), on
            affiche l'icône fichier centrée dans la même zone, sur fond
            coloré teinté de la catégorie. */}
      <button
        type="button"
        onClick={onOpen}
        className="relative w-full overflow-hidden flex items-center justify-center group"
        style={{
          aspectRatio: '4 / 3',
          maxHeight: '280px',
          background: thumbUrl
            ? '#ffffff'
            : category
              ? `${category.color}1f`
              : 'var(--bg-elev)',
          borderBottom: '1px solid var(--brd-sub)',
          cursor: 'zoom-in',
        }}
        title="Ouvrir le plan"
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={plan.name}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            loading="lazy"
            onError={() => setThumbUrl(null)}
          />
        ) : (
          <FileIcon
            className="w-12 h-12 transition-transform duration-200 group-hover:scale-110"
            style={{
              color: category ? category.color : 'var(--txt-2)',
              opacity: 0.6,
            }}
          />
        )}
        {/* Badge version en overlay top-right */}
        {plan.current_version > 1 && (
          <span
            className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded shadow-sm"
            style={{
              background: 'rgba(0,0,0,0.6)',
              color: 'white',
              backdropFilter: 'blur(4px)',
            }}
            title={`Version ${plan.current_version}`}
          >
            V{plan.current_version}
          </span>
        )}
        {/* Badge type fichier en overlay bottom-right */}
        <span
          className="absolute bottom-2 right-2 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shadow-sm"
          style={{
            background: 'rgba(0,0,0,0.6)',
            color: 'white',
            backdropFilter: 'blur(4px)',
          }}
        >
          {plan.file_type}
        </span>
      </button>

      {/* Bloc texte sous la vignette */}
      <div className="p-3 flex-1 flex flex-col gap-1.5 min-w-0">
        <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
          {plan.name}
        </h3>
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
          style={{ color: 'var(--txt-3)' }}
        >
          {category && (
            <span className="inline-flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: category.color }}
              />
              {category.label}
              {category.is_archived && (
                <span style={{ color: 'var(--orange)' }}>(archivée)</span>
              )}
            </span>
          )}
          <span>{formatFileSize(plan.file_size)}</span>
          {plan.applicable_dates?.length > 0 && (
            <span
              className="inline-flex items-center gap-0.5"
              title={plan.applicable_dates.join(', ')}
            >
              <Calendar className="w-3 h-3" />
              {formatDatesShort(plan.applicable_dates)}
            </span>
          )}
        </div>
        {plan.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {plan.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
              >
                {t}
              </span>
            ))}
            {plan.tags.length > 4 && (
              <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                +{plan.tags.length - 4}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{
          borderTop: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
        }}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-1 text-[11px] font-medium"
          style={{ color: 'var(--blue)' }}
        >
          <ExternalLink className="w-3 h-3" />
          Ouvrir
        </button>
        {canEdit && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
              className="p-1 rounded"
              style={{ color: 'var(--txt-3)' }}
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 bottom-full mb-1 z-10 rounded-lg shadow-lg overflow-hidden"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  minWidth: 160,
                }}
              >
                {!archived && (
                  <MenuItem icon={Edit3} label="Modifier" onClick={onEdit} />
                )}
                {!archived && (
                  <MenuItem icon={Trash2} label="Archiver" onClick={onArchive} tone="warning" />
                )}
                {archived && (
                  <MenuItem icon={RotateCcw} label="Restaurer" onClick={onRestore} />
                )}
                {archived && (
                  <MenuItem icon={Trash2} label="Supprimer définitivement" onClick={onDelete} tone="danger" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function MenuItem({ icon: Icon, label, onClick, tone }) {
  const color =
    tone === 'danger' ? 'var(--red)' : tone === 'warning' ? 'var(--orange)' : 'var(--txt-2)'
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault() // empêche le blur du parent avant onClick
        onClick()
      }}
      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors"
      style={{ color }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function EmptyState({ canEdit, hasFilters, onCreate }) {
  if (hasFilters) {
    return (
      <div
        className="rounded-xl p-8 flex flex-col items-center text-center"
        style={{
          background: 'var(--bg-surf)',
          border: '1px dashed var(--brd)',
        }}
      >
        <Search className="w-6 h-6 mb-2" style={{ color: 'var(--txt-3)' }} />
        <h3 className="text-sm font-bold mb-0.5" style={{ color: 'var(--txt)' }}>
          Aucun résultat
        </h3>
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Essaie de modifier ta recherche ou de retirer un filtre.
        </p>
      </div>
    )
  }
  return (
    <div
      className="rounded-xl p-8 flex flex-col items-center text-center"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd)',
      }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'var(--blue-bg)' }}
      >
        <Layers className="w-6 h-6" style={{ color: 'var(--blue)' }} />
      </div>
      <h3 className="text-base font-bold mb-1" style={{ color: 'var(--txt)' }}>
        Aucun plan dans ce projet
      </h3>
      <p className="text-xs mb-4 max-w-md" style={{ color: 'var(--txt-3)' }}>
        Démarrez en ajoutant votre premier plan technique : caméra, lumière,
        son, plan de masse… Tous les formats classiques sont supportés
        (PDF, PNG, JPG).
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
          style={{ background: 'var(--blue)', color: 'white' }}
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter un plan
        </button>
      )}
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Affichage compact d'un tableau de dates pour la card.
 *  - 1 → "12/05"
 *  - 2-3 → "12, 13/05"
 *  - 4+ contigus → "12 → 17/05"
 *  - 4+ non contigus → "5 jours"
 */
function formatDatesShort(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return ''
  const sorted = [...dates].sort()
  if (sorted.length === 1) return ddmm(sorted[0])
  const allContiguous = sorted.every((iso, i) => {
    if (i === 0) return true
    const prev = new Date(sorted[i - 1])
    const cur = new Date(iso)
    return Math.round((cur - prev) / 86400000) === 1
  })
  if (allContiguous && sorted.length >= 4) {
    return `${ddmm(sorted[0]).slice(0, 2)} → ${ddmm(sorted.at(-1))}`
  }
  if (sorted.length <= 3) return sorted.map(ddmm).join(', ')
  return `${sorted.length} jours`
}

function ddmm(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

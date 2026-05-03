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

import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Calendar,
  Edit3,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Layers,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import usePlans from '../../hooks/usePlans'
import { useProjet } from '../ProjetLayout'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { getSignedUrl, formatFileSize } from '../../lib/plans'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import PlanFormModal from '../../features/plans/PlanFormModal'

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

  const filteredPlans = useMemo(() => {
    let list = plans
    if (!showArchived) list = list.filter((p) => !p.is_archived)
    if (activeCategoryId !== 'all') {
      list = list.filter((p) => p.category_id === activeCategoryId)
    }
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      list = list.filter((p) => {
        const inName = (p.name || '').toLowerCase().includes(q)
        const inTags = (p.tags || []).some((t) => t.toLowerCase().includes(q))
        const inDesc = (p.description || '').toLowerCase().includes(q)
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

  function openCreate() {
    setEditingPlan(null)
    setFormOpen(true)
  }

  function openEdit(plan) {
    setEditingPlan(plan)
    setFormOpen(true)
  }

  // ── Actions card ────────────────────────────────────────────────────────
  async function handleOpenPlan(plan) {
    try {
      const url = await getSignedUrl(plan.storage_path)
      if (!url) throw new Error('URL non disponible')
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      notify.error('Impossible d\u2019ouvrir le plan : ' + (err?.message || err))
    }
  }

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
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md shrink-0"
            style={{ background: 'var(--blue)', color: 'white' }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Ajouter un plan</span>
            <span className="sm:hidden">Ajouter</span>
          </button>
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

          {/* Toggle archivés */}
          <div className="flex items-center justify-end">
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

      {/* Grille de plans */}
      {filteredPlans.length === 0 ? (
        <EmptyState canEdit={canEdit} hasFilters={search || activeCategoryId !== 'all'} onCreate={openCreate} />
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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

function PlanCard({ plan, category, canEdit, onOpen, onEdit, onArchive, onRestore, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const FileIcon = plan.file_type === 'pdf' ? FileText : ImageIcon
  const archived = plan.is_archived

  return (
    <li
      className="rounded-lg overflow-hidden transition-all"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        opacity: archived ? 0.6 : 1,
      }}
    >
      {/* Click area = ouvrir le plan */}
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left p-3 flex items-start gap-3"
      >
        <div
          className="w-10 h-10 rounded-md flex items-center justify-center shrink-0"
          style={{
            background: category ? `${category.color}1f` : 'var(--bg-elev)',
          }}
        >
          <FileIcon
            className="w-5 h-5"
            style={{ color: category ? category.color : 'var(--txt-2)' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-1.5">
            <h3 className="flex-1 text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {plan.name}
            </h3>
            {plan.current_version > 1 && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{
                  background: 'var(--bg-hov)',
                  color: 'var(--txt-3)',
                }}
                title={`Version ${plan.current_version}`}
              >
                V{plan.current_version}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]"
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
            <span className="uppercase">{plan.file_type}</span>
            <span>{formatFileSize(plan.file_size)}</span>
            {plan.applicable_dates?.length > 0 && (
              <span className="inline-flex items-center gap-0.5" title={plan.applicable_dates.join(', ')}>
                <Calendar className="w-3 h-3" />
                {formatDatesShort(plan.applicable_dates)}
              </span>
            )}
          </div>
          {plan.tags?.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
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
      </button>

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

/**
 * PlanningViewSelector — sélecteur de vue planning (PL-3.5).
 *
 * Architecture :
 *   - Remplace l'ancien switch "Mois | Semaine | Jour" par un sélecteur
 *     de vues paramétrables (kind + config).
 *   - Les vues sont chargées via listPlanningViews(projectId) ; un fallback
 *     built-in (3 vues calendrier) est utilisé tant qu'aucune vue DB
 *     n'existe pour le projet.
 *   - Les kinds dont `implemented === false` apparaissent dans le menu
 *     "Ajouter une vue" avec un badge "Bientôt" et ne sont pas
 *     sélectionnables. Les kinds implémentés (calendrier + table) sont
 *     proposés comme boutons cliquables.
 *
 * Responsive (2026-04) :
 *   - Prop `compact` (bool) — déclenchée par le parent via useBreakpoint().
 *   - Compact = true : le bandeau horizontal est remplacé par un seul
 *     bouton "Vues" qui ouvre un drawer latéral plein hauteur listant
 *     toutes les vues + les actions (config, renommer, dupliquer, supprimer,
 *     ajouter une vue). Adapté aux écrans mobiles <640px.
 *   - Compact = false : rendu historique en bandeau horizontal.
 *
 * Interactions :
 *   - Clic gauche sur une vue       → active la vue.
 *   - Clic droit sur une vue custom → ouvre le menu d'actions (renommer,
 *     dupliquer, supprimer). Les vues built-in n'ont pas d'actions.
 *   - Icône Settings / Filter       → ouvre le drawer de config.
 *   - Bouton +                      → menu d'ajout (kinds + templates).
 *
 * Les actions renommer/dupliquer/supprimer sont également disponibles
 * depuis le footer du drawer pour la découvrabilité.
 *
 * Props :
 *   - views       : Array<PlanningView>
 *   - activeViewId: string|null
 *   - onChange    : (view) => void
 *   - onAddView   : (kind) => void        (optionnel — si absent, bouton caché)
 *   - onAddPreset : (presetKey) => void   (optionnel — PL-5 presets spécialisés)
 *   - presets     : Array<Preset>         (optionnel — override la liste des
 *                                          presets proposés ; défaut =
 *                                          PLANNING_VIEW_PRESETS, PG-4 permet
 *                                          de passer PLANNING_VIEW_PRESETS_GLOBAL
 *                                          dans PlanningGlobal.)
 *   - onDuplicate : (view) => void        (optionnel)
 *   - onRename    : (view) => void        (optionnel)
 *   - onDelete    : (view) => void        (optionnel)
 *   - onOpenConfig: (view) => void        (optionnel)
 *   - compact     : bool                  (optionnel — force le mode drawer)
 */
import { useRef, useState, useEffect } from 'react'
import {
  Calendar,
  CalendarDays,
  CalendarClock,
  GanttChart,
  Table2,
  LayoutGrid,
  Rows3,
  Plus,
  Copy,
  Pencil,
  Trash2,
  Lock,
  Settings,
  Filter as FilterIcon,
  ChevronDown,
  X,
} from 'lucide-react'
import { PLANNING_VIEW_KINDS_LIST, PLANNING_VIEW_PRESETS } from '../../lib/planning'

const ICON_MAP = {
  Calendar,
  CalendarDays,
  CalendarClock,
  GanttChart,
  Table2,
  LayoutGrid,
  Rows3,
}

function ViewIcon({ name, className, style }) {
  const Cmp = ICON_MAP[name] || Calendar
  return <Cmp className={className} style={style} />
}

/**
 * Indique si une config de vue a au moins un filtre actif (utile pour afficher
 * une pastille sur le bouton Config).
 *
 * PL-5 : typeCategories (pre_prod/tournage/post_prod/autre) et typeSlugs
 * (système) sont aussi comptés — les presets Tournage/Post-prod utilisent
 * typeCategories pour rester portables entre orgs, il faut que la pastille
 * bleue s'affiche aussi dans ces cas-là.
 */
function hasActiveFilter(config) {
  const f = config?.filters || {}
  const nonEmpty = (v) => Array.isArray(v) ? v.length > 0 : Boolean(v)
  return nonEmpty(f.typeIds)
    || nonEmpty(f.typeCategories)
    || nonEmpty(f.typeSlugs)
    || nonEmpty(f.lotIds)
    || nonEmpty(f.memberIds)
    || nonEmpty(f.statusMember)
    || nonEmpty(f.projectIds)
    || nonEmpty(f.search)
    || Boolean(config?.groupBy)
}

export default function PlanningViewSelector({
  views = [],
  activeViewId = null,
  onChange,
  onAddView,
  onAddPreset,
  presets = PLANNING_VIEW_PRESETS,
  onDuplicate,
  onRename,
  onDelete,
  onOpenConfig,
  compact = false,
}) {
  const [menuOpenId, setMenuOpenId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const wrapperRef = useRef(null)

  // Ferme les menus en cliquant à l'extérieur (mode non-compact uniquement — le
  // drawer compact a son propre overlay avec onClick).
  useEffect(() => {
    if (compact) return undefined
    function onDoc(e) {
      if (!wrapperRef.current) return
      if (!wrapperRef.current.contains(e.target)) {
        setMenuOpenId(null)
        setAddOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [compact])

  // Ferme le drawer si on passe en mode non-compact (rotation portrait →
  // paysage sur tablette, ou redim. devtools).
  useEffect(() => {
    if (!compact) setDrawerOpen(false)
  }, [compact])

  // Tri : "Mois" (kind = calendar_month) est systématiquement épinglé en
  // premier, quel que soit son sort_order. S'il y a plusieurs vues de kind
  // calendar_month (ex. un clone renommé), elles sont triées entre elles par
  // sort_order puis par nom. Le reste suit la même logique.
  const sorted = [...views].sort((a, b) => {
    const aMonth = a.kind === 'calendar_month' ? 0 : 1
    const bMonth = b.kind === 'calendar_month' ? 0 : 1
    if (aMonth !== bMonth) return aMonth - bMonth
    const so = (a.sort_order ?? 999) - (b.sort_order ?? 999)
    if (so !== 0) return so
    return (a.name || '').localeCompare(b.name || '')
  })

  const activeView = sorted.find((v) => v.id === activeViewId) || sorted[0] || null
  const activeHasFilter = activeView ? hasActiveFilter(activeView.config) : false

  // ─── Mode compact (mobile) : bouton + drawer latéral ─────────────────────
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="px-3 py-2 rounded-lg text-xs font-medium flex items-center gap-2 shrink-0"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            color: 'var(--txt-2)',
          }}
          aria-label="Choisir une vue"
        >
          {activeView ? (
            <ViewIcon
              name={activeView.icon}
              className="w-3.5 h-3.5"
              style={{ color: activeView.color || 'var(--txt-2)' }}
            />
          ) : (
            <Calendar className="w-3.5 h-3.5" />
          )}
          <span className="truncate max-w-[120px]">
            {activeView ? activeView.name : 'Vues'}
          </span>
          {activeHasFilter && (
            <span
              aria-label="Filtre actif"
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: 'var(--blue)' }}
            />
          )}
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </button>

        {drawerOpen && (
          <div
            className="fixed inset-0 z-50 flex"
            role="dialog"
            aria-modal="true"
            aria-label="Vues planning"
          >
            {/* Overlay */}
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(0,0,0,0.35)' }}
              onClick={() => setDrawerOpen(false)}
            />
            {/* Panel */}
            <div
              className="relative ml-auto w-[85%] max-w-sm h-full flex flex-col"
              style={{
                background: 'var(--bg-surf)',
                borderLeft: '1px solid var(--brd)',
                boxShadow: '-8px 0 24px rgba(0,0,0,0.2)',
              }}
            >
              {/* Header drawer */}
              <div
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: '1px solid var(--brd-sub)' }}
              >
                <h2 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                  Vues planning
                </h2>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Fermer"
                  className="w-7 h-7 rounded-md flex items-center justify-center"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Liste des vues — scrollable */}
              <div className="flex-1 overflow-y-auto py-2">
                {sorted.map((view) => {
                  const isActive = view.id === activeViewId
                  const builtin = Boolean(view._builtin)
                  const viewHasFilter = hasActiveFilter(view.config)
                  return (
                    <div key={view.id} className="flex items-stretch">
                      <button
                        type="button"
                        onClick={() => {
                          onChange?.(view)
                          setDrawerOpen(false)
                        }}
                        className="flex-1 text-left px-4 py-2.5 text-sm flex items-center gap-3"
                        style={{
                          background: isActive ? 'var(--bg-elev)' : 'transparent',
                          color: isActive ? 'var(--txt)' : 'var(--txt-2)',
                          borderLeft: isActive ? '3px solid var(--blue)' : '3px solid transparent',
                        }}
                      >
                        <ViewIcon
                          name={view.icon}
                          className="w-4 h-4 shrink-0"
                          style={{ color: view.color || (isActive ? 'var(--blue)' : 'var(--txt-3)') }}
                        />
                        <span className="flex-1 truncate">{view.name}</span>
                        {view.is_default && (
                          <span
                            className="text-[9px] uppercase tracking-wide px-1 rounded"
                            style={{ background: 'var(--brd)', color: 'var(--txt-3)' }}
                          >
                            déf
                          </span>
                        )}
                        {builtin && (
                          <Lock className="w-3 h-3 opacity-50" aria-label="Built-in" />
                        )}
                        {viewHasFilter && (
                          <span
                            aria-label="Filtre actif"
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: 'var(--blue)' }}
                          />
                        )}
                      </button>
                    </div>
                  )
                })}
              </div>

              {/* Footer : actions vue active + ajouter */}
              <div
                className="shrink-0 p-3 flex flex-col gap-2"
                style={{
                  borderTop: '1px solid var(--brd-sub)',
                  background: 'var(--bg-elev)',
                  paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
                }}
              >
                {activeView && onOpenConfig && (
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerOpen(false)
                      onOpenConfig(activeView)
                    }}
                    className="w-full px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-2"
                    style={{
                      background: activeHasFilter ? 'var(--blue-bg)' : 'var(--bg-surf)',
                      color: activeHasFilter ? 'var(--blue)' : 'var(--txt-2)',
                      border: '1px solid var(--brd)',
                    }}
                  >
                    {activeHasFilter ? (
                      <FilterIcon className="w-3.5 h-3.5" />
                    ) : (
                      <Settings className="w-3.5 h-3.5" />
                    )}
                    Filtres & groupement
                  </button>
                )}

                {activeView && !activeView._builtin && (
                  <div className="flex gap-2">
                    {onRename && (
                      <button
                        type="button"
                        onClick={() => { setDrawerOpen(false); onRename(activeView) }}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
                      >
                        <Pencil className="w-3.5 h-3.5" /> Renommer
                      </button>
                    )}
                    {onDuplicate && (
                      <button
                        type="button"
                        onClick={() => { setDrawerOpen(false); onDuplicate(activeView) }}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
                      >
                        <Copy className="w-3.5 h-3.5" /> Dupliquer
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => { setDrawerOpen(false); onDelete(activeView) }}
                        className="px-3 py-2 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5"
                        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--red)' }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Ajout de vue — un bouton par kind (pas de popover imbriqué
                    sur mobile : flux linéaire plus lisible) */}
                {onAddView && (
                  <details
                    className="rounded-lg"
                    style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
                  >
                    <summary
                      className="cursor-pointer px-3 py-2 text-xs font-medium flex items-center gap-2 list-none"
                      style={{ color: 'var(--txt-2)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Ajouter une vue
                    </summary>
                    <div className="px-2 pb-2 flex flex-col gap-0.5">
                      <div
                        className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        Calendrier
                      </div>
                      {PLANNING_VIEW_KINDS_LIST
                        .filter((k) => k.group === 'calendar')
                        .map((k) => (
                          <button
                            key={k.key}
                            type="button"
                            onClick={() => { setDrawerOpen(false); onAddView(k.key) }}
                            className="text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                            style={{ color: 'var(--txt-2)' }}
                          >
                            <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                            {k.label}
                          </button>
                        ))}
                      <div
                        className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        Avancé
                      </div>
                      {PLANNING_VIEW_KINDS_LIST
                        .filter((k) => k.group === 'advanced')
                        .map((k) => (k.implemented ? (
                          <button
                            key={k.key}
                            type="button"
                            onClick={() => { setDrawerOpen(false); onAddView(k.key) }}
                            className="text-left px-2 py-1.5 text-xs rounded flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                            style={{ color: 'var(--txt-2)' }}
                          >
                            <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                            {k.label}
                          </button>
                        ) : (
                          <div
                            key={k.key}
                            className="px-2 py-1.5 text-xs flex items-center justify-between gap-2 opacity-55"
                          >
                            <span className="flex items-center gap-2">
                              <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                              {k.label}
                            </span>
                            <span
                              className="text-[9px] uppercase tracking-wide px-1 rounded"
                              style={{ background: 'var(--brd)', color: 'var(--txt-3)' }}
                            >
                              Bientôt
                            </span>
                          </div>
                        )))}

                      {onAddPreset && presets.length > 0 && (
                        <>
                          <div
                            className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wide"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            Presets
                          </div>
                          {presets.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => { setDrawerOpen(false); onAddPreset(p.key) }}
                              className="text-left px-2 py-1.5 text-xs rounded flex items-start gap-2 hover:bg-[var(--bg-elev)]"
                              style={{ color: 'var(--txt-2)' }}
                            >
                              <ViewIcon name={p.icon} className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span className="flex flex-col">
                                <span>{p.label}</span>
                                <span
                                  className="text-[10px] leading-tight"
                                  style={{ color: 'var(--txt-3)' }}
                                >
                                  {p.description}
                                </span>
                              </span>
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </details>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ─── Mode non-compact (tablet + desktop) : bandeau horizontal historique ──
  return (
    <div
      ref={wrapperRef}
      className="flex items-center gap-1 flex-wrap"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        borderRadius: 10,
        padding: 2,
      }}
    >
      {sorted.map((view) => {
        const isActive = view.id === activeViewId
        const builtin = Boolean(view._builtin)
        const canActions = !builtin && (onDuplicate || onRename || onDelete)
        const menuOpen = menuOpenId === view.id
        return (
          <div key={view.id} className="relative flex items-center">
            <button
              type="button"
              onClick={() => onChange?.(view)}
              onContextMenu={(e) => {
                if (!canActions) return
                e.preventDefault()
                setMenuOpenId(menuOpen ? null : view.id)
              }}
              className="px-2.5 py-1.5 rounded text-xs font-medium transition flex items-center gap-1.5"
              style={{
                background: isActive ? 'var(--bg-surf)' : 'transparent',
                color: isActive ? 'var(--txt)' : 'var(--txt-3)',
                boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
              }}
              title={canActions ? `${view.name} — clic droit pour les actions` : view.name}
            >
              <ViewIcon
                name={view.icon}
                className="w-3.5 h-3.5"
                style={{ color: view.color || (isActive ? 'var(--txt)' : 'var(--txt-3)') }}
              />
              <span>{view.name}</span>
              {view.is_default && (
                <span
                  className="ml-1 text-[9px] uppercase tracking-wide px-1 rounded"
                  style={{ background: 'var(--brd)', color: 'var(--txt-3)' }}
                  aria-label="Vue par défaut"
                >
                  déf
                </span>
              )}
              {builtin && (
                <Lock
                  className="w-3 h-3 opacity-50"
                  aria-label="Vue built-in non modifiable"
                />
              )}
            </button>

            {menuOpen && canActions && (
              <div
                role="menu"
                className="absolute top-full mt-1 left-0 z-30 rounded-lg py-1 min-w-[170px] text-xs"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
                }}
              >
                {onRename && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                    onClick={() => { setMenuOpenId(null); onRename(view) }}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Renommer
                  </button>
                )}
                {onDuplicate && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                    onClick={() => { setMenuOpenId(null); onDuplicate(view) }}
                  >
                    <Copy className="w-3.5 h-3.5" /> Dupliquer
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--red-bg)]"
                    style={{ color: 'var(--red)' }}
                    onClick={() => { setMenuOpenId(null); onDelete(view) }}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Supprimer
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {onOpenConfig && activeView && (
        <button
          type="button"
          aria-label={`Configurer la vue ${activeView.name}`}
          title="Filtres & groupement"
          onClick={() => onOpenConfig(activeView)}
          className="px-2 py-1.5 rounded text-xs font-medium transition relative"
          style={{
            color: activeHasFilter ? 'var(--blue)' : 'var(--txt-3)',
            background: activeHasFilter ? 'var(--blue-bg)' : 'transparent',
          }}
        >
          {activeHasFilter ? (
            <FilterIcon className="w-3.5 h-3.5" />
          ) : (
            <Settings className="w-3.5 h-3.5" />
          )}
          {activeHasFilter && (
            <span
              aria-label="Filtre actif"
              className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ background: 'var(--blue)' }}
            />
          )}
        </button>
      )}

      {onAddView && (
        <div className="relative flex items-center">
          <button
            type="button"
            aria-label="Ajouter une vue"
            onClick={() => setAddOpen((v) => !v)}
            className="px-2 py-1.5 rounded text-xs font-medium transition flex items-center gap-1"
            style={{ color: 'var(--txt-3)' }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {addOpen && (
            <div
              role="menu"
              className="absolute top-full mt-1 right-0 z-30 rounded-lg py-1 min-w-[220px] text-xs"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
                boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              }}
            >
              <div
                className="px-3 py-1 text-[10px] uppercase tracking-wide"
                style={{ color: 'var(--txt-3)' }}
              >
                Calendrier
              </div>
              {PLANNING_VIEW_KINDS_LIST
                .filter((k) => k.group === 'calendar')
                .map((k) => (
                  <button
                    key={k.key}
                    type="button"
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                    onClick={() => { setAddOpen(false); onAddView(k.key) }}
                  >
                    <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                    {k.label}
                  </button>
                ))}
              <div
                className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide"
                style={{ color: 'var(--txt-3)' }}
              >
                Avancé
              </div>
              {PLANNING_VIEW_KINDS_LIST
                .filter((k) => k.group === 'advanced')
                .map((k) => (k.implemented ? (
                  <button
                    key={k.key}
                    type="button"
                    className="w-full text-left px-3 py-1.5 flex items-center gap-2 hover:bg-[var(--bg-elev)]"
                    onClick={() => { setAddOpen(false); onAddView(k.key) }}
                  >
                    <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                    {k.label}
                  </button>
                ) : (
                  <div
                    key={k.key}
                    className="w-full text-left px-3 py-1.5 flex items-center justify-between gap-2 cursor-not-allowed opacity-55"
                  >
                    <span className="flex items-center gap-2">
                      <ViewIcon name={k.icon} className="w-3.5 h-3.5" />
                      {k.label}
                    </span>
                    <span
                      className="text-[9px] uppercase tracking-wide px-1 rounded"
                      style={{ background: 'var(--brd)', color: 'var(--txt-3)' }}
                    >
                      Bientôt
                    </span>
                  </div>
                )))}
              {/* Presets PL-5 — vues spécialisées (Production / Prévisionnelle /
                  Tournage / Post-production). Réutilisent les composants
                  existants avec des configs pré-câblées. Cachée si onAddPreset
                  n'est pas fourni (compat avec consommateurs sans presets). */}
              {onAddPreset && presets.length > 0 && (
                <>
                  <div
                    className="px-3 py-1 mt-1 text-[10px] uppercase tracking-wide"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Presets
                  </div>
                  {presets.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      className="w-full text-left px-3 py-1.5 flex items-start gap-2 hover:bg-[var(--bg-elev)]"
                      onClick={() => { setAddOpen(false); onAddPreset(p.key) }}
                      title={p.description}
                    >
                      <ViewIcon name={p.icon} className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="flex flex-col">
                        <span>{p.label}</span>
                        <span
                          className="text-[10px] leading-tight"
                          style={{ color: 'var(--txt-3)' }}
                        >
                          {p.description}
                        </span>
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * PlanningViewConfigDrawer — panneau latéral d'édition de la config d'une vue
 * planning (PL-3.5 étape 2).
 *
 * Expose :
 *   - Filtres (types, lots, recherche)
 *   - Groupement (aucun / type / lot / statut / lieu / membre)
 *   - Options d'affichage (showWeekends — uniquement pour les vues calendar)
 *
 * Les vues built-in sont en lecture seule : on propose explicitement la
 * duplication pour éviter toute confusion. Les modifs sur une vue DB sont
 * locales tant qu'elles ne sont pas enregistrées (pattern "draft + save").
 *
 * Props :
 *   - view        : PlanningView | null
 *   - eventTypes  : Array<EventType>
 *   - lots        : Array<Lot>
 *   - onClose     : () => void
 *   - onSave      : (nextConfig) => Promise<void> | void
 *   - onDuplicate : () => void           (CTA principal pour vues built-in,
 *                                         et action meta pour vues custom)
 *   - onRename    : () => void           (vues custom uniquement)
 *   - onDelete    : () => void           (vues custom uniquement)
 */
import { useEffect, useMemo, useState } from 'react'
import {
  X, Copy, Lock, Filter, Layers as LayersIcon, Search, Check,
  Pencil, Trash2,
} from 'lucide-react'
import {
  defaultViewConfig,
  GROUP_BY_OPTIONS,
  EVENT_MEMBER_STATUS,
  EVENT_TYPE_CATEGORIES,
} from '../../lib/planning'

function toggleInArray(arr, value) {
  if (!Array.isArray(arr)) return [value]
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value]
}

export default function PlanningViewConfigDrawer({
  view,
  eventTypes = [],
  lots = [],
  onClose,
  onSave,
  onDuplicate,
  onRename,
  onDelete,
}) {
  const builtin = Boolean(view?._builtin)
  const kind = view?.kind || 'calendar_month'
  const isCalendar = kind.startsWith('calendar_')

  // Draft local — on ne touche pas à la vue tant qu'on n'a pas cliqué "Enregistrer".
  const [draft, setDraft] = useState(() => ({
    ...defaultViewConfig(kind),
    ...(view?.config || {}),
    filters: {
      ...defaultViewConfig(kind).filters,
      ...((view?.config || {}).filters || {}),
    },
  }))
  const [saving, setSaving] = useState(false)

  // Si la vue change en amont (sélection d'une autre vue pendant que le
  // drawer est ouvert), on re-synchronise le draft.
  useEffect(() => {
    setDraft({
      ...defaultViewConfig(kind),
      ...(view?.config || {}),
      filters: {
        ...defaultViewConfig(kind).filters,
        ...((view?.config || {}).filters || {}),
      },
    })
  }, [view?.id, kind, view?.config])

  const activeTypes = useMemo(
    () => (eventTypes || []).filter((t) => !t.archived),
    [eventTypes],
  )
  const activeLots = useMemo(
    () => (lots || []).filter((l) => !l.archived),
    [lots],
  )

  function updateFilter(key, value) {
    setDraft((d) => ({ ...d, filters: { ...(d.filters || {}), [key]: value } }))
  }

  async function handleSave() {
    if (builtin) return
    try {
      setSaving(true)
      await onSave?.(draft)
    } finally {
      setSaving(false)
    }
  }

  if (!view) return null

  const filters = draft.filters || {}
  const typeIds        = filters.typeIds        || []
  const typeCategories = filters.typeCategories || []
  const typeSlugs      = filters.typeSlugs      || []
  const lotIds         = filters.lotIds         || []
  const statusMember   = filters.statusMember   || []
  const search         = filters.search         || ''

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.18)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label={`Configuration de la vue ${view.name}`}
        className="h-full w-full sm:max-w-md flex flex-col"
        style={{
          background: 'var(--bg-surf)',
          borderLeft: '1px solid var(--brd)',
          // iOS : respecte l'encoche et la barre home
          paddingBottom: 0,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ────────────────────────────────────────────────────── */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--brd)' }}
        >
          <div>
            <div className="text-xs uppercase tracking-wide" style={{ color: 'var(--txt-3)' }}>
              Configurer la vue
            </div>
            <div className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--txt)' }}>
              {view.name}
              {builtin && <Lock className="w-3.5 h-3.5 opacity-60" aria-label="Vue built-in" />}
            </div>
          </div>
          <button
            type="button"
            aria-label="Fermer"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-elev)]"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Barre d'actions meta (vues custom uniquement) ──────────────
            Comme le bouton "..." a été retiré des onglets pour éviter le
            shift au hover, on expose les actions rename/duplicate/delete
            ici pour la découvrabilité. Les actions restent accessibles
            par clic-droit sur l'onglet. */}
        {!builtin && (onRename || onDuplicate || onDelete) && (
          <div
            className="px-4 py-2 flex items-center gap-1 text-xs"
            style={{ borderBottom: '1px solid var(--brd)', color: 'var(--txt-3)' }}
          >
            {onRename && (
              <button
                type="button"
                onClick={onRename}
                className="px-2 py-1 rounded flex items-center gap-1.5 hover:bg-[var(--bg-elev)]"
              >
                <Pencil className="w-3.5 h-3.5" />
                Renommer
              </button>
            )}
            {onDuplicate && (
              <button
                type="button"
                onClick={onDuplicate}
                className="px-2 py-1 rounded flex items-center gap-1.5 hover:bg-[var(--bg-elev)]"
              >
                <Copy className="w-3.5 h-3.5" />
                Dupliquer
              </button>
            )}
            <div className="flex-1" />
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="px-2 py-1 rounded flex items-center gap-1.5 hover:bg-[var(--red-bg)]"
                style={{ color: 'var(--red)' }}
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
            )}
          </div>
        )}

        {/* ── Bandeau built-in ─────────────────────────────────────────── */}
        {builtin && (
          <div
            className="px-4 py-3 text-xs flex items-start gap-2"
            style={{
              background: 'var(--blue-bg)',
              color: 'var(--blue)',
              borderBottom: '1px solid var(--brd)',
            }}
          >
            <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <div>
              Cette vue est intégrée et en lecture seule. Duplique-la pour la
              personnaliser (filtres, groupement, options).
            </div>
          </div>
        )}

        {/* ── Corps : sections scroll ──────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

          {/* Recherche texte */}
          <Section icon={<Search className="w-3.5 h-3.5" />} title="Recherche texte">
            <input
              type="text"
              value={search}
              placeholder="Titre, description…"
              onChange={(e) => updateFilter('search', e.target.value)}
              disabled={builtin}
              className="w-full px-3 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </Section>

          {/* Filtres Types d'événement */}
          <Section icon={<Filter className="w-3.5 h-3.5" />} title="Types d'événement">
            {activeTypes.length === 0 ? (
              <EmptyHint>Aucun type disponible.</EmptyHint>
            ) : (
              <ChipGrid>
                {activeTypes.map((t) => {
                  const active = typeIds.includes(t.id)
                  return (
                    <Chip
                      key={t.id}
                      active={active}
                      disabled={builtin}
                      color={t.color}
                      onClick={() => updateFilter('typeIds', toggleInArray(typeIds, t.id))}
                    >
                      {t.label}
                    </Chip>
                  )
                })}
              </ChipGrid>
            )}
            <HintRow
              hint={typeIds.length ? `${typeIds.length} type(s) sélectionné(s)` : 'Tous les types'}
              onClear={typeIds.length && !builtin ? () => updateFilter('typeIds', []) : null}
            />
          </Section>

          {/* Catégories de type (PL-5) ─ stable cross-org, alimentée par
              ev.type.category ∈ {pre_prod, tournage, post_prod, autre}.
              OR avec typeIds et typeSlugs au sein du bloc "type". */}
          <Section icon={<Filter className="w-3.5 h-3.5" />} title="Catégories de type">
            <ChipGrid>
              {Object.values(EVENT_TYPE_CATEGORIES).map((cat) => {
                const active = typeCategories.includes(cat.key)
                return (
                  <Chip
                    key={cat.key}
                    active={active}
                    disabled={builtin}
                    onClick={() => updateFilter('typeCategories', toggleInArray(typeCategories, cat.key))}
                  >
                    {cat.label}
                  </Chip>
                )
              })}
            </ChipGrid>
            <HintRow
              hint={typeCategories.length ? `${typeCategories.length} catégorie(s)` : 'Toutes catégories'}
              onClear={typeCategories.length && !builtin ? () => updateFilter('typeCategories', []) : null}
            />
            {typeSlugs.length > 0 && (
              <div
                className="mt-2 text-[11px] flex items-center justify-between gap-2"
                style={{ color: 'var(--txt-3)' }}
              >
                <span>
                  + {typeSlugs.length} slug(s) système filtré(s) (preset)
                </span>
                {!builtin && (
                  <button
                    type="button"
                    onClick={() => updateFilter('typeSlugs', [])}
                    className="text-[11px] underline"
                  >
                    Effacer
                  </button>
                )}
              </div>
            )}
          </Section>

          {/* Filtres Lots */}
          <Section icon={<Filter className="w-3.5 h-3.5" />} title="Lots du devis">
            {activeLots.length === 0 ? (
              <EmptyHint>Aucun lot actif sur ce projet.</EmptyHint>
            ) : (
              <ChipGrid>
                {activeLots.map((l) => {
                  const active = lotIds.includes(l.id)
                  return (
                    <Chip
                      key={l.id}
                      active={active}
                      disabled={builtin}
                      onClick={() => updateFilter('lotIds', toggleInArray(lotIds, l.id))}
                    >
                      {l.title || 'Lot'}
                    </Chip>
                  )
                })}
                <Chip
                  active={lotIds.includes('__none__')}
                  disabled={builtin}
                  onClick={() => updateFilter('lotIds', toggleInArray(lotIds, '__none__'))}
                  italic
                >
                  Sans lot
                </Chip>
              </ChipGrid>
            )}
            <HintRow
              hint={lotIds.length ? `${lotIds.length} lot(s) sélectionné(s)` : 'Tous les lots'}
              onClear={lotIds.length && !builtin ? () => updateFilter('lotIds', []) : null}
            />
          </Section>

          {/* Filtres Statuts de convocation */}
          <Section icon={<Filter className="w-3.5 h-3.5" />} title="Statut des convocations">
            <ChipGrid>
              {Object.values(EVENT_MEMBER_STATUS).map((s) => {
                const active = statusMember.includes(s.key)
                return (
                  <Chip
                    key={s.key}
                    active={active}
                    disabled={builtin}
                    color={s.color}
                    onClick={() => updateFilter('statusMember', toggleInArray(statusMember, s.key))}
                  >
                    {s.label}
                  </Chip>
                )
              })}
            </ChipGrid>
            <HintRow
              hint={statusMember.length ? `${statusMember.length} statut(s)` : 'Tous statuts'}
              onClear={statusMember.length && !builtin ? () => updateFilter('statusMember', []) : null}
            />
          </Section>

          {/* Groupement */}
          <Section icon={<LayersIcon className="w-3.5 h-3.5" />} title="Groupement">
            <select
              value={draft.groupBy || ''}
              onChange={(e) => setDraft((d) => ({ ...d, groupBy: e.target.value || null }))}
              disabled={builtin}
              className="w-full px-3 py-2 rounded text-sm"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            >
              {GROUP_BY_OPTIONS.map((opt) => (
                <option key={opt.key || 'none'} value={opt.key || ''}>
                  {opt.label}
                </option>
              ))}
            </select>
            {isCalendar && draft.groupBy && (
              <div
                className="mt-2 text-[11px]"
                style={{ color: 'var(--orange)' }}
              >
                Le groupement n&apos;est pas encore appliqué sur les vues calendrier.
                Il sera actif sur les vues Kanban et Swimlanes (à venir).
              </div>
            )}
          </Section>

          {/* Options d'affichage (calendar-only pour l'instant) */}
          {isCalendar && (
            <Section title="Options d'affichage">
              <ToggleRow
                label="Afficher les week-ends"
                checked={draft.showWeekends !== false}
                disabled={builtin}
                onChange={(v) => setDraft((d) => ({ ...d, showWeekends: v }))}
              />
            </Section>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div
          className="px-4 py-3 flex items-center justify-between gap-2"
          style={{
            borderTop: '1px solid var(--brd)',
            paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)',
          }}
        >
          {builtin ? (
            <>
              <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                Vue built-in non modifiable
              </span>
              <button
                type="button"
                onClick={onDuplicate}
                className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5"
                style={{ background: 'var(--blue)', color: '#fff' }}
              >
                <Copy className="w-3.5 h-3.5" />
                Dupliquer pour personnaliser
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-xs font-medium"
                style={{ color: 'var(--txt-3)' }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-3 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                style={{ background: 'var(--blue)', color: '#fff' }}
              >
                <Check className="w-3.5 h-3.5" />
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sous-composants internes ────────────────────────────────────────────────

function Section({ icon, title, children }) {
  return (
    <div>
      <div
        className="text-[11px] uppercase tracking-wide mb-2 flex items-center gap-1.5"
        style={{ color: 'var(--txt-3)' }}
      >
        {icon}
        {title}
      </div>
      {children}
    </div>
  )
}

function ChipGrid({ children }) {
  return <div className="flex flex-wrap gap-1.5">{children}</div>
}

function Chip({ active, disabled, color, italic, onClick, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="px-2 py-1 rounded text-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: active ? (color || 'var(--blue)') : 'var(--bg-elev)',
        color: active ? '#fff' : 'var(--txt)',
        border: active ? '1px solid transparent' : '1px solid var(--brd)',
        fontStyle: italic ? 'italic' : 'normal',
      }}
    >
      {children}
    </button>
  )
}

function HintRow({ hint, onClear }) {
  return (
    <div className="mt-1.5 flex items-center justify-between">
      <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>{hint}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-[11px] underline"
          style={{ color: 'var(--txt-3)' }}
        >
          Effacer
        </button>
      )}
    </div>
  )
}

function EmptyHint({ children }) {
  return (
    <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>{children}</div>
  )
}

function ToggleRow({ label, checked, disabled, onChange }) {
  return (
    <label
      className={`flex items-center justify-between text-sm ${disabled ? 'opacity-60' : ''}`}
      style={{ color: 'var(--txt)' }}
    >
      <span>{label}</span>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  )
}

/**
 * Onglet Types d'événements — Chantier XC-1
 *
 * CRUD sur `event_types` (table org-scoped, seedée avec 13 types système).
 *
 * Règles UI :
 *   - Les types `is_system = true` ne peuvent pas être supprimés, uniquement
 *     archivés (garde-fou applicatif en complément de la migration).
 *   - Les types `is_system = false` (créés par l'admin) peuvent être édités,
 *     archivés OU supprimés définitivement si non utilisés (pour l'instant on
 *     ne vérifie pas l'usage — à faire quand PL-2 sera branché).
 *   - Archivage réversible (bouton Restaurer) et filtre "Afficher archivés".
 *   - Une création attribue automatiquement org_id et is_system = false
 *     (délégué au helper createEventType du module lib/planning.js).
 *
 * Accessible uniquement aux admins (route gardée via Settings).
 */

import { useEffect, useState, useCallback } from 'react'
import {
  Plus,
  Edit3,
  Trash2,
  Archive,
  ArchiveRestore,
  Lock,
  Loader2,
  X,
  Save,
  Eye,
  EyeOff,
  // Icônes utilisées par défaut pour les types
  Camera,
  Film,
  Palette,
  AudioWaveform,
  Wand2,
  PackageCheck,
  CheckCircle2,
  Circle,
  ClipboardList,
  MapPin,
  Users,
  Users2,
  Sparkles,
  Calendar,
  Clock,
  Star,
  Coffee,
  Mic,
  Music,
  Video,
  Monitor,
  FileText,
  Briefcase,
} from 'lucide-react'
import { notify } from '../../lib/notify'
import { useAuth } from '../../contexts/AuthContext'
import {
  listEventTypes,
  createEventType,
  updateEventType,
  archiveEventType,
  restoreEventType,
  deleteEventType,
  EVENT_TYPE_CATEGORIES,
} from '../../lib/planning'

// ─── Palette de couleurs suggérées pour l'éditeur ────────────────────────────
const SUGGESTED_COLORS = [
  '#A855F7', '#8B5CF6', '#7C3AED', '#6D28D9',
  '#EF4444', '#F97316', '#F59E0B', '#EAB308',
  '#84CC16', '#22C55E', '#10B981', '#059669',
  '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6',
  '#6366F1', '#EC4899', '#F43F5E', '#64748B',
]

// ─── Registre d'icônes disponibles (lucide-react) ────────────────────────────
// Clé = nom exporté par lucide ; valeur = composant. On limite à un set curé
// pour ne pas charger toute la lib dans un sélecteur.
const ICON_REGISTRY = {
  Camera,
  Film,
  Palette,
  AudioWaveform,
  Wand2,
  PackageCheck,
  CheckCircle2,
  Circle,
  ClipboardList,
  MapPin,
  Users,
  Users2,
  Sparkles,
  Calendar,
  Clock,
  Star,
  Coffee,
  Mic,
  Music,
  Video,
  Monitor,
  FileText,
  Briefcase,
}

function IconByName({ name, className = 'w-4 h-4' }) {
  const Cmp = ICON_REGISTRY[name] || Circle
  return <Cmp className={className} />
}

// ─── Composant principal ─────────────────────────────────────────────────────
export default function EventTypesTab() {
  const { org } = useAuth()
  const orgId = org?.id || null
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [types, setTypes] = useState([])
  const [editing, setEditing] = useState(null) // type en cours d'édition
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listEventTypes({ includeArchived: true })
      setTypes(data)
    } catch (e) {
      console.error('[EventTypes] load error:', e)
      notify.error('Erreur de chargement des types')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const visibleTypes = showArchived ? types : types.filter((t) => !t.archived)

  // Regroupement par catégorie pour un affichage structuré
  const byCategory = visibleTypes.reduce((acc, t) => {
    const k = t.category || 'autre'
    if (!acc[k]) acc[k] = []
    acc[k].push(t)
    return acc
  }, {})
  // Ordre des catégories
  const CAT_ORDER = ['pre_prod', 'tournage', 'post_prod', 'autre']

  async function handleArchive(type) {
    setBusy(true)
    try {
      await archiveEventType(type.id)
      notify.success(`« ${type.label} » archivé`)
      await load()
    } catch (e) {
      console.error(e)
      notify.error(e.message || 'Archivage impossible')
    } finally {
      setBusy(false)
    }
  }

  async function handleRestore(type) {
    setBusy(true)
    try {
      await restoreEventType(type.id)
      notify.success(`« ${type.label} » restauré`)
      await load()
    } catch (e) {
      console.error(e)
      notify.error(e.message || 'Restauration impossible')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(type) {
    if (type.is_system) {
      notify.error('Les types système ne peuvent pas être supprimés — archive-les à la place.')
      return
    }
    if (!confirm(`Supprimer définitivement « ${type.label} » ?\nCette action est irréversible.`)) return
    setBusy(true)
    try {
      await deleteEventType(type.id)
      notify.success('Type supprimé')
      await load()
    } catch (e) {
      console.error(e)
      notify.error(e.message || 'Suppression impossible (type peut-être utilisé).')
    } finally {
      setBusy(false)
    }
  }

  function startCreate() {
    setEditing({
      id: null,
      label: '',
      color: SUGGESTED_COLORS[0],
      icon: 'Circle',
      category: 'autre',
      default_all_day: false,
      default_duration_min: null,
      sort_order: 1000,
      is_system: false,
      archived: false,
      slug: null,
    })
    setIsNew(true)
  }

  function startEdit(type) {
    setEditing({ ...type })
    setIsNew(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  return (
    <div>
      {/* Header section */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--txt)' }}>
            Types d&apos;événements
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Personnalise les types utilisés dans le planning (couleur, icône, catégorie).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md"
            style={{
              background: showArchived ? 'var(--bg-elev)' : 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            title={showArchived ? 'Masquer les archivés' : 'Afficher les archivés'}
          >
            {showArchived ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showArchived ? 'Masquer archivés' : 'Afficher archivés'}
          </button>
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            <Plus className="w-4 h-4" /> Nouveau type
          </button>
        </div>
      </div>

      {/* Listes par catégorie */}
      {CAT_ORDER.filter((c) => (byCategory[c] || []).length > 0).map((cat) => (
        <div key={cat} className="mb-6">
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: 'var(--txt-3)' }}
          >
            {EVENT_TYPE_CATEGORIES[cat]?.label || cat}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {byCategory[cat]
              .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
              .map((t) => (
                <EventTypeCard
                  key={t.id}
                  type={t}
                  busy={busy}
                  onEdit={() => startEdit(t)}
                  onArchive={() => handleArchive(t)}
                  onRestore={() => handleRestore(t)}
                  onDelete={() => handleDelete(t)}
                />
              ))}
          </div>
        </div>
      ))}

      {visibleTypes.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--txt-3)' }}>
          <ClipboardList className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">
            {showArchived ? 'Aucun type disponible.' : 'Aucun type actif. Affiche les archivés ou crée-en un.'}
          </p>
        </div>
      )}

      {/* Modal édition */}
      {editing && (
        <EventTypeEditorModal
          type={editing}
          isNew={isNew}
          orgId={orgId}
          onClose={() => { setEditing(null); setIsNew(false) }}
          onSaved={async () => {
            setEditing(null); setIsNew(false)
            await load()
          }}
        />
      )}
    </div>
  )
}

// ─── Carte type ──────────────────────────────────────────────────────────────
function EventTypeCard({ type, busy, onEdit, onArchive, onRestore, onDelete }) {
  const isArchived = type.archived
  const isSystem = type.is_system

  return (
    <div
      className="rounded-xl p-3"
      style={{
        border: '1px solid var(--brd)',
        background: 'var(--bg-surf)',
        opacity: isArchived ? 0.6 : 1,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${type.color}22`, color: type.color }}
        >
          <IconByName name={type.icon} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {type.label}
            </h3>
            {isSystem && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(100,100,100,.15)', color: 'var(--txt-3)' }}
                title="Type système — archivable mais non supprimable"
              >
                <Lock className="w-3 h-3" /> Système
              </span>
            )}
            {isArchived && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(100,100,100,.15)', color: 'var(--txt-3)' }}
              >
                <Archive className="w-3 h-3" /> Archivé
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-2 mt-1 text-[11px]"
            style={{ color: 'var(--txt-3)' }}
          >
            <span>{EVENT_TYPE_CATEGORIES[type.category]?.label || type.category}</span>
            {type.default_all_day && (
              <>
                <span>·</span>
                <span>Journée entière par défaut</span>
              </>
            )}
            {type.default_duration_min && (
              <>
                <span>·</span>
                <span>{type.default_duration_min} min par défaut</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-2 mt-3 pt-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}
      >
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
          style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
          title="Éditer"
        >
          <Edit3 className="w-3.5 h-3.5" /> Éditer
        </button>
        {isArchived ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRestore}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
            style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
            title="Restaurer"
          >
            <ArchiveRestore className="w-3.5 h-3.5" />
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onArchive}
            className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            title="Archiver"
          >
            <Archive className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          disabled={busy || isSystem}
          onClick={onDelete}
          className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
          style={{
            background: isSystem ? 'transparent' : 'rgba(255,59,48,.1)',
            color: isSystem ? 'var(--txt-3)' : 'var(--red)',
            opacity: isSystem ? 0.4 : 1,
            cursor: isSystem ? 'not-allowed' : 'pointer',
          }}
          title={isSystem ? 'Type système — non supprimable' : 'Supprimer définitivement'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Modal édition / création ────────────────────────────────────────────────
function EventTypeEditorModal({ type, isNew, orgId, onClose, onSaved }) {
  const [label, setLabel] = useState(type.label || '')
  const [color, setColor] = useState(type.color || SUGGESTED_COLORS[0])
  const [icon, setIcon] = useState(type.icon || 'Circle')
  const [category, setCategory] = useState(type.category || 'autre')
  const [defaultAllDay, setDefaultAllDay] = useState(Boolean(type.default_all_day))
  const [defaultDurationMin, setDefaultDurationMin] = useState(
    type.default_duration_min ? String(type.default_duration_min) : '',
  )
  const [sortOrder, setSortOrder] = useState(
    type.sort_order != null ? String(type.sort_order) : '1000',
  )
  const [saving, setSaving] = useState(false)

  const isSystem = Boolean(type.is_system)

  async function save() {
    if (!label.trim()) {
      notify.error('Le nom est obligatoire.')
      return
    }
    setSaving(true)
    try {
      const payload = {
        label: label.trim(),
        color,
        icon,
        category,
        default_all_day: defaultAllDay,
        default_duration_min: defaultDurationMin ? Number(defaultDurationMin) : null,
        sort_order: sortOrder ? Number(sortOrder) : 1000,
      }
      if (isNew) {
        if (!orgId) {
          notify.error("Organisation introuvable — impossible de créer le type.")
          return
        }
        await createEventType({ ...payload, org_id: orgId })
        notify.success('Type créé')
      } else {
        await updateEventType(type.id, payload)
        notify.success('Type enregistré')
      }
      onSaved()
    } catch (e) {
      console.error(e)
      notify.error(e.message || "Erreur à l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: `${color}22`, color }}
            >
              <IconByName name={icon} className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {isNew ? 'Nouveau type d’événement' : `Éditer : ${type.label}`}
              </h3>
              {isSystem && (
                <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                  Type système — libellé modifiable, couleur et icône aussi.
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto">
          {/* Libellé */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
              Nom *
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex : Briefing client"
              className="w-full text-sm px-3 py-2 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
          </div>

          {/* Catégorie */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
              Catégorie
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.values(EVENT_TYPE_CATEGORIES).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className="text-xs font-medium px-2.5 py-1.5 rounded-md"
                  style={{
                    background: category === c.key ? 'var(--blue-bg)' : 'var(--bg-elev)',
                    color: category === c.key ? 'var(--blue)' : 'var(--txt-2)',
                    border: '1px solid var(--brd)',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Couleur */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
              Couleur
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {SUGGESTED_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-md"
                  style={{
                    background: c,
                    border: color === c ? '2px solid var(--txt)' : '2px solid transparent',
                  }}
                  title={c}
                  aria-label={`Couleur ${c}`}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 rounded-md cursor-pointer"
                style={{ border: '1px solid var(--brd)' }}
                title="Couleur personnalisée"
              />
            </div>
          </div>

          {/* Icône */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
              Icône
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {Object.keys(ICON_REGISTRY).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setIcon(name)}
                  className="w-8 h-8 rounded-md flex items-center justify-center"
                  style={{
                    background: icon === name ? `${color}22` : 'var(--bg-elev)',
                    color: icon === name ? color : 'var(--txt-2)',
                    border: icon === name ? `1px solid ${color}` : '1px solid var(--brd)',
                  }}
                  title={name}
                  aria-label={name}
                >
                  <IconByName name={name} className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          {/* Journée entière par défaut */}
          <div className="flex items-center gap-2">
            <input
              id="ev-all-day"
              type="checkbox"
              checked={defaultAllDay}
              onChange={(e) => setDefaultAllDay(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="ev-all-day" className="text-xs" style={{ color: 'var(--txt-2)' }}>
              Journée entière par défaut (ex. tournage)
            </label>
          </div>

          {/* Durée par défaut */}
          {!defaultAllDay && (
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
                Durée par défaut (minutes)
              </label>
              <input
                type="number"
                min={0}
                step={15}
                placeholder="Laisser vide pour libre"
                value={defaultDurationMin}
                onChange={(e) => setDefaultDurationMin(e.target.value)}
                className="w-40 text-sm px-3 py-2 rounded-md"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>
          )}

          {/* Ordre d'affichage */}
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
              Ordre d&apos;affichage
            </label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="w-28 text-sm px-3 py-2 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
              Plus petit = affiché en premier dans sa catégorie.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-xs font-medium px-3 py-2 rounded-md"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !label.trim()}
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md"
            style={{
              background: 'var(--blue)',
              color: '#fff',
              opacity: saving || !label.trim() ? 0.6 : 1,
            }}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isNew ? 'Créer' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}

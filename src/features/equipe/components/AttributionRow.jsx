// ════════════════════════════════════════════════════════════════════════════
// AttributionRow — Une ligne de la techlist (= 1 attribution principale)
// ════════════════════════════════════════════════════════════════════════════
//
// Depuis EQUIPE-P1.5 : 1 ligne = 1 row projet_membres principale (parent_membre_id
// IS NULL). Les rows rattachées sont représentées par un badge "+ N rôle".
//
// Mise en avant :
//   - Le POSTE (devis_line.produit ou specialite) en gros, blanc, gras
//   - Le NOM de la personne en sous-titre
//   - Avatar + initiales à gauche
//
// Inline edits :
//   - secteur, hebergement, chauffeur, presence_days : PERSONA-LEVEL
//     → propagent à toutes les rows de la même persona via onUpdatePersona
//   - movinmotion_statut : PER-ROW → onUpdateRow
//
// Actions :
//   - Drag (HTML5 native) : déplace la ligne entre catégories (change la
//     `category` de cette row uniquement, choix Y validé)
//   - Menu kebab : Rattacher à un autre poste, Détacher (si rattaché),
//     Retirer de l'équipe
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Phone,
  Mail,
  MapPin,
  Car,
  Home,
  Calendar,
  Trash2,
  ChevronDown,
  Link2,
  MoreVertical,
  GitMerge,
  GitBranch,
  GripVertical,
} from 'lucide-react'
import {
  fullNameFromPersona,
  initialsFromPersona,
  effectiveSecteur,
  condensePresenceDays,
  CREW_STATUTS,
} from '../../../lib/crew'
import { confirm } from '../../../lib/confirm'

// Couleurs de statut alignées sur EquipeTab.jsx (STEPS)
const STATUT_STYLES = {
  non_applicable: { color: 'var(--txt-3)', bg: 'var(--bg-elev)' },
  a_integrer:     { color: 'var(--blue)', bg: 'var(--blue-bg)' },
  integre:        { color: 'var(--purple)', bg: 'var(--purple-bg)' },
  contrat_signe:  { color: 'var(--green)', bg: 'var(--green-bg)' },
  paie_en_cours:  { color: 'var(--green)', bg: 'var(--green-bg)' },
  paie_terminee:  { color: 'var(--amber)', bg: 'var(--amber-bg)' },
}

export default function AttributionRow({
  row,                    // techlist row enrichie (cf. listTechlistRows)
  showSensitive = false,
  canEdit = true,
  onUpdateRow,            // (rowId, fields) => Promise — per-row update
  onUpdatePersona,        // (personaKey, fields) => Promise — persona-level
  onRemoveRow,            // async () => Promise
  onOpenPresence,         // () => void — ouvre la modale calendrier
  onAttach,               // () => void — ouvre la modale rattacher
  onDetach,               // async () => Promise — détache (si row rattachée)
  onDragStart,            // HTML5 drag start
  onDragEnd,              // HTML5 drag end
  isDragging = false,
}) {
  const persona = row.persona || {}
  const fullName = fullNameFromPersona(persona)
  const initials = initialsFromPersona(persona)
  const secteur = effectiveSecteur(persona)
  const presenceLabel = condensePresenceDays(persona.presence_days)

  // Le poste vient en priorité de la ligne de devis (= ce qui a été vendu),
  // puis de la spécialité saisie sur le projet_membre, puis du contact.
  const posteFromDevis = row.devis_line?.produit || null
  const poste =
    posteFromDevis ||
    row.specialite ||
    persona.contact?.specialite ||
    '—'

  // Édition possible du poste UNIQUEMENT si pas de devis_line. Si la row est
  // attachée à une ligne de devis, le poste est figé sur le produit du devis
  // (pour modifier, il faut éditer le devis lui-même).
  const canEditPoste = canEdit && !posteFromDevis

  const nbAttached = row.attached?.length || 0

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Retirer cette attribution',
      message: nbAttached > 0
        ? `Retirer ${fullName} de "${poste}" ? Les ${nbAttached} ligne(s) rattachée(s) seront détachées et redeviendront principales.`
        : `Retirer ${fullName} de "${poste}" ?`,
      confirmLabel: 'Retirer',
      destructive: true,
    })
    if (ok) await onRemoveRow?.()
  }

  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        if (!canEdit) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', row.id)
        onDragStart?.(row)
      }}
      onDragEnd={() => onDragEnd?.()}
      className="grid items-center gap-2 px-3 py-2.5 transition-all"
      style={{
        gridTemplateColumns:
          'auto minmax(0, 2.2fr) 1fr 1fr auto auto auto auto auto',
        background: 'var(--bg-row)',
        borderBottom: '1px solid var(--brd-sub)',
        opacity: isDragging ? 0.4 : 1,
        cursor: canEdit ? 'grab' : 'default',
      }}
    >
      {/* Drag handle visuel */}
      <div
        style={{ color: 'var(--txt-3)', opacity: canEdit ? 0.5 : 0 }}
        title="Glisser pour reclasser"
      >
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* Poste + nom (le poste est mis en avant) */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{
            background: persona.couleur ? `#${persona.couleur}` : 'var(--blue-bg)',
            color: persona.couleur ? '#fff' : 'var(--blue)',
          }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          {/* Le POSTE en avant — éditable si pas issu d'une ligne de devis */}
          <div
            className="text-sm font-semibold truncate flex items-center gap-1.5"
            style={{ color: 'var(--txt)' }}
          >
            <PosteInline
              value={poste}
              canEdit={canEditPoste}
              onSave={(v) =>
                onUpdateRow?.(row.id, { specialite: v.trim() || null })
              }
            />
            {nbAttached > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{
                  background: 'var(--purple-bg)',
                  color: 'var(--purple)',
                  border: '1px solid var(--purple-brd)',
                }}
                title={`${nbAttached} rôle(s) rattaché(s) à cette ligne`}
              >
                <GitMerge className="w-2.5 h-2.5 inline mr-0.5" />
                +{nbAttached}
              </span>
            )}
          </div>
          {/* Le NOM en sous-titre */}
          <div className="text-[11px] truncate" style={{ color: 'var(--txt-2)' }}>
            {fullName}
          </div>
          {showSensitive && (persona.contact?.email || persona.contact?.telephone) && (
            <div
              className="flex items-center gap-2 mt-0.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              {persona.contact.telephone && (
                <a
                  href={`tel:${persona.contact.telephone}`}
                  className="flex items-center gap-0.5 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="w-2.5 h-2.5" />
                  {persona.contact.telephone}
                </a>
              )}
              {persona.contact.email && (
                <a
                  href={`mailto:${persona.contact.email}`}
                  className="flex items-center gap-0.5 hover:underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{persona.contact.email}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Secteur (persona-level) */}
      <InlineText
        value={secteur || ''}
        placeholder="Secteur"
        icon={<MapPin className="w-3 h-3" />}
        canEdit={canEdit}
        onSave={(v) => onUpdatePersona?.(row.persona_key, { secteur: v.trim() || null })}
      />

      {/* Hébergement (persona-level) */}
      <InlineText
        value={persona.hebergement || ''}
        placeholder="Hébergement"
        icon={<Home className="w-3 h-3" />}
        canEdit={canEdit}
        onSave={(v) => onUpdatePersona?.(row.persona_key, { hebergement: v.trim() || null })}
      />

      {/* Chauffeur (persona-level) */}
      <button
        type="button"
        onClick={() => canEdit && onUpdatePersona?.(row.persona_key, { chauffeur: !persona.chauffeur })}
        disabled={!canEdit}
        className="p-1.5 rounded-md transition-colors"
        style={{
          background: persona.chauffeur ? 'var(--amber-bg)' : 'transparent',
          color: persona.chauffeur ? 'var(--amber)' : 'var(--txt-3)',
          border: persona.chauffeur ? '1px solid var(--amber-brd)' : '1px solid transparent',
          cursor: canEdit ? 'pointer' : 'default',
        }}
        title={persona.chauffeur ? 'Chauffeur' : 'Pas chauffeur'}
        onMouseEnter={(e) => {
          if (canEdit && !persona.chauffeur) {
            e.currentTarget.style.color = 'var(--amber)'
            e.currentTarget.style.background = 'var(--amber-bg)'
          }
        }}
        onMouseLeave={(e) => {
          if (canEdit && !persona.chauffeur) {
            e.currentTarget.style.color = 'var(--txt-3)'
            e.currentTarget.style.background = 'transparent'
          }
        }}
      >
        <Car className="w-3.5 h-3.5" />
      </button>

      {/* Présence (persona-level — bouton ouvre modale) */}
      <button
        type="button"
        onClick={onOpenPresence}
        disabled={!canEdit || !onOpenPresence}
        className="text-xs px-2 py-1 rounded-md flex items-center gap-1.5 transition-colors min-w-[72px] justify-center"
        style={{
          background: presenceLabel ? 'var(--green-bg)' : 'var(--bg-elev)',
          color: presenceLabel ? 'var(--green)' : 'var(--txt-3)',
          border: presenceLabel ? '1px solid var(--green-brd)' : '1px solid var(--brd-sub)',
          cursor: canEdit && onOpenPresence ? 'pointer' : 'default',
        }}
        title="Jours de présence"
        onMouseEnter={(e) => {
          if (canEdit && onOpenPresence) e.currentTarget.style.opacity = '0.85'
        }}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
      >
        <Calendar className="w-3 h-3 shrink-0" />
        <span className="truncate text-[11px]">
          {presenceLabel || '—'}
        </span>
      </button>

      {/* Lien vers la ligne de devis (read-only) */}
      <div
        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
        style={{
          background: row.devis_line_id ? 'var(--blue-bg)' : 'transparent',
          color: row.devis_line_id ? 'var(--blue)' : 'var(--txt-3)',
          border: row.devis_line_id ? '1px solid var(--blue-brd)' : '1px solid var(--brd-sub)',
        }}
        title={
          row.devis_line_id
            ? 'Attribution liée à une ligne de devis'
            : 'Attribution libre (sans ligne de devis)'
        }
      >
        <Link2 className="w-2.5 h-2.5 inline" />
      </div>

      {/* Statut MovinMotion (per-row) */}
      <StatutDropdown
        statut={row.movinmotion_statut}
        canEdit={canEdit}
        onChange={(s) => onUpdateRow?.(row.id, { movinmotion_statut: s })}
      />

      {/* Menu actions */}
      <RowMenu
        canEdit={canEdit}
        canAttach={Boolean(onAttach)}
        canDetach={Boolean(row.parent_membre_id) && Boolean(onDetach)}
        onAttach={onAttach}
        onDetach={onDetach}
        onDelete={handleDelete}
      />
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

/**
 * PosteInline — Affichage / édition du poste (titre de la ligne).
 * Édition débloquée seulement si pas de devis_line (sinon le poste est
 * figé sur devis_line.produit, pour cohérence avec la facturation).
 */
function PosteInline({ value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value === '—' ? '' : value)

  if (!editing && !editing && draft !== (value === '—' ? '' : value)) {
    setDraft(value === '—' ? '' : value)
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== (value === '—' ? '' : value)) onSave?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(value === '—' ? '' : value)
            setEditing(false)
          }
        }}
        placeholder="Poste / spécialité"
        className="text-sm font-semibold px-1.5 py-0.5 rounded outline-none flex-1 min-w-0"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--blue)',
        }}
      />
    )
  }

  if (!canEdit) {
    return <span className="truncate" title={value}>{value}</span>
  }

  // Cliquable pour éditer
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="truncate text-left transition-colors hover:underline decoration-dotted"
      style={{
        color: value === '—' ? 'var(--txt-3)' : 'var(--txt)',
        background: 'transparent',
      }}
      title={value === '—' ? 'Cliquer pour saisir un poste' : `${value} (cliquer pour modifier)`}
    >
      {value}
    </button>
  )
}

function InlineText({ value, placeholder, icon, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  // Quand value change depuis le parent (optimistic update terminé), resync.
  if (!editing && draft !== value) {
    setDraft(value)
  }

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1 text-[11px] truncate" style={{ color: 'var(--txt-2)' }}>
        {icon && <span style={{ color: 'var(--txt-3)' }}>{icon}</span>}
        <span className="truncate">{value || '—'}</span>
      </div>
    )
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== value) onSave?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        placeholder={placeholder}
        className="text-xs px-1.5 py-1 rounded outline-none w-full"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--blue)',
        }}
      />
    )
  }

  // Vide → placeholder italique discret. Rempli → texte normal.
  const isEmpty = !value
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-[11px] truncate text-left px-1.5 py-1 rounded transition-colors w-full"
      style={{
        color: isEmpty ? 'var(--txt-3)' : 'var(--txt-2)',
        fontStyle: isEmpty ? 'italic' : 'normal',
        opacity: isEmpty ? 0.55 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon && <span style={{ color: 'var(--txt-3)', opacity: isEmpty ? 0.6 : 1 }}>{icon}</span>}
      <span className="truncate">{value || placeholder}</span>
    </button>
  )
}

function StatutDropdown({ statut, canEdit, onChange }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const cur = CREW_STATUTS.find((s) => s.key === statut) || CREW_STATUTS[0]
  const style = STATUT_STYLES[statut] || STATUT_STYLES.non_applicable

  function handleOpen() {
    if (!canEdit) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownH = CREW_STATUTS.length * 32 + 8
      const top = spaceBelow < dropdownH ? rect.top - dropdownH - 4 : rect.bottom + 4
      setPos({ top, left: rect.left })
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={!canEdit}
        className="text-[11px] px-2 py-1 rounded-md flex items-center gap-1 transition-opacity"
        style={{
          background: style.bg,
          color: style.color,
          border: `1px solid ${style.color}`,
          cursor: canEdit ? 'pointer' : 'default',
          minWidth: '88px',
        }}
        title={cur.label}
      >
        <span className="truncate flex-1 text-left">{cur.label}</span>
        {canEdit && <ChevronDown className="w-3 h-3 shrink-0" />}
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 rounded-md shadow-lg overflow-hidden"
              style={{
                top: pos.top,
                left: pos.left,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                minWidth: 140,
              }}
            >
              {CREW_STATUTS.map((s) => {
                const sStyle = STATUT_STYLES[s.key]
                const isCurrent = s.key === statut
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      onChange?.(s.key)
                      setOpen(false)
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors"
                    style={{
                      color: sStyle.color,
                      background: isCurrent ? 'var(--bg-hov)' : 'transparent',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isCurrent ? 'var(--bg-hov)' : 'transparent')
                    }
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: sStyle.color }}
                    />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

function RowMenu({ canEdit, canAttach, canDetach, onAttach, onDetach, onDelete }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function handleOpen() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const top = rect.bottom + 4
      const left = rect.right - 200
      setPos({ top, left })
    }
    setOpen(true)
  }

  if (!canEdit) return <div className="w-6" />

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        className="p-1.5 rounded-md transition-colors"
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
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 rounded-md shadow-lg overflow-hidden"
              style={{
                top: pos.top,
                left: pos.left,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                minWidth: 200,
              }}
            >
              {canAttach && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onAttach?.()
                  }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors"
                  style={{ color: 'var(--txt)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <GitMerge className="w-3 h-3" />
                  Rattacher à un autre poste
                </button>
              )}
              {canDetach && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDetach?.()
                  }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors"
                  style={{ color: 'var(--txt)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <GitBranch className="w-3 h-3" />
                  Détacher
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onDelete?.()
                }}
                className="w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors border-t"
                style={{ color: 'var(--red)', borderColor: 'var(--brd-sub)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Trash2 className="w-3 h-3" />
                Retirer de l&rsquo;équipe
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

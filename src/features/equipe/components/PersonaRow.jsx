// ════════════════════════════════════════════════════════════════════════════
// PersonaRow — Une ligne de la techlist
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche une persona (1 personne sur le projet, qui peut avoir N rows
// projet_membres regroupées par useCrew → groupByPerson).
//
// Inline edit pour les attributs persona-level :
//   - secteur (ville d'origine, override projet)
//   - chauffeur (toggle)
//   - hebergement (texte libre)
//   - presence_days (via PresenceCalendarModal — déclenchée par bouton)
//   - statut MovinMotion (cycle au clic via dropdown)
//
// Affiche aussi (read-only ici) :
//   - nom + initiales (avatar coloré)
//   - spécialité (depuis la 1ère row)
//   - n° de lignes attribuées (bouton ouvre une drawer Vue par membre — TODO Phase 1.5)
//   - téléphone / email (si showSensitive=true)
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

export default function PersonaRow({
  persona,
  showSensitive = false,
  canEdit = true,
  onUpdatePersona,           // (key, fields) => Promise
  onRemovePersona,           // async () => Promise — supprime toutes les rows
  onOpenPresence,            // () => void — ouvre la modale calendrier
  onOpenDetail,              // () => void — ouvre la drawer Vue par membre (Phase 1.5)
}) {
  const fullName = fullNameFromPersona(persona)
  const initials = initialsFromPersona(persona)
  const secteur = effectiveSecteur(persona)
  const presenceLabel = condensePresenceDays(persona.presence_days)

  // Récup spécialité depuis la 1ère row si présente
  const specialite =
    persona.contact?.specialite ||
    persona.members?.[0]?.specialite ||
    null

  // Compteur de lignes de devis attribuées
  const nbDevisLines = (persona.members || []).filter((m) => m.devis_line_id).length

  const handleEdit = (fields) => onUpdatePersona?.(persona.key, fields)

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Retirer de l\u2019équipe',
      message: `Retirer ${fullName} de l\u2019équipe de ce projet ? Cette action supprimera ${persona.members.length} attribution${persona.members.length > 1 ? 's' : ''}.`,
      confirmLabel: 'Retirer',
      destructive: true,
    })
    if (ok) await onRemovePersona?.()
  }

  return (
    <div
      className="grid items-center gap-2 px-3 py-2.5 transition-colors"
      style={{
        gridTemplateColumns:
          'minmax(0, 2fr) 1fr 1fr auto auto auto auto auto auto',
        background: 'var(--bg-row)',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      {/* Avatar + nom + spécialité */}
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
        <div className="min-w-0">
          <button
            type="button"
            onClick={onOpenDetail}
            disabled={!onOpenDetail}
            className="text-sm font-semibold truncate transition-colors text-left"
            style={{
              color: 'var(--txt)',
              cursor: onOpenDetail ? 'pointer' : 'default',
            }}
            onMouseEnter={(e) => {
              if (onOpenDetail) e.currentTarget.style.color = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--txt)'
            }}
            title={fullName}
          >
            {fullName}
          </button>
          {specialite && (
            <div className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
              {specialite}
            </div>
          )}
          {showSensitive && (persona.contact?.email || persona.contact?.telephone) && (
            <div
              className="flex items-center gap-2 mt-0.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              {persona.contact.telephone && (
                <a
                  href={`tel:${persona.contact.telephone}`}
                  className="flex items-center gap-0.5 hover:underline"
                >
                  <Phone className="w-2.5 h-2.5" />
                  {persona.contact.telephone}
                </a>
              )}
              {persona.contact.email && (
                <a
                  href={`mailto:${persona.contact.email}`}
                  className="flex items-center gap-0.5 hover:underline truncate"
                >
                  <Mail className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{persona.contact.email}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Secteur (ville) inline edit */}
      <InlineText
        value={secteur || ''}
        placeholder="Secteur"
        icon={<MapPin className="w-3 h-3" />}
        canEdit={canEdit}
        onSave={(v) => handleEdit({ secteur: v.trim() || null })}
      />

      {/* Hébergement inline edit */}
      <InlineText
        value={persona.hebergement || ''}
        placeholder="Hébergement"
        icon={<Home className="w-3 h-3" />}
        canEdit={canEdit}
        onSave={(v) => handleEdit({ hebergement: v.trim() || null })}
      />

      {/* Chauffeur toggle */}
      <button
        type="button"
        onClick={() => canEdit && handleEdit({ chauffeur: !persona.chauffeur })}
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

      {/* Présence (bouton ouvre modale) */}
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

      {/* Lignes devis (read-only badge) */}
      <div
        className="text-[10px] px-1.5 py-0.5 rounded font-mono"
        style={{
          background: nbDevisLines > 0 ? 'var(--blue-bg)' : 'transparent',
          color: nbDevisLines > 0 ? 'var(--blue)' : 'var(--txt-3)',
          border: nbDevisLines > 0 ? '1px solid var(--blue-brd)' : '1px solid var(--brd-sub)',
        }}
        title={
          nbDevisLines > 0
            ? `${nbDevisLines} ligne${nbDevisLines > 1 ? 's' : ''} de devis attribuée${nbDevisLines > 1 ? 's' : ''}`
            : 'Aucune ligne de devis'
        }
      >
        <Link2 className="w-2.5 h-2.5 inline mr-0.5" />
        {nbDevisLines}
      </div>

      {/* Statut MovinMotion */}
      <StatutDropdown
        statut={persona.movinmotion_statut}
        canEdit={canEdit}
        onChange={(s) => handleEdit({ movinmotion_statut: s })}
      />

      {/* Menu actions */}
      <RowMenu
        canEdit={canEdit}
        onDelete={handleDelete}
        onOpenDetail={onOpenDetail}
      />
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

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

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-[11px] truncate text-left px-1.5 py-1 rounded transition-colors w-full"
      style={{ color: value ? 'var(--txt-2)' : 'var(--txt-3)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon && <span style={{ color: 'var(--txt-3)' }}>{icon}</span>}
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
      // Position dropdown sous le trigger, fallback au-dessus si pas de place
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
            <div
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
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

function RowMenu({ canEdit, onDelete, onOpenDetail }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  function handleOpen() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      // Aligné à droite du trigger
      const top = rect.bottom + 4
      const left = rect.right - 160 // largeur ~160
      setPos({ top, left })
    }
    setOpen(true)
  }

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
                minWidth: 160,
              }}
            >
              {onOpenDetail && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onOpenDetail?.()
                  }}
                  className="w-full text-left px-3 py-2 text-xs transition-colors"
                  style={{ color: 'var(--txt)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  Voir le détail
                </button>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onDelete?.()
                  }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-1.5 transition-colors"
                  style={{ color: 'var(--red)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <Trash2 className="w-3 h-3" />
                  Retirer de l&rsquo;équipe
                </button>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

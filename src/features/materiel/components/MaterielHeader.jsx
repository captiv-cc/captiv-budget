// ════════════════════════════════════════════════════════════════════════════
// MaterielHeader — en-tête de la page Matériel
// ════════════════════════════════════════════════════════════════════════════
//
// Structure :
//
//   ┌───────────────────────────────────────────────────────────────────┐
//   │ 📦 Matériel                                                        │
//   │    X items · checklist Y/Z · 🟢 n / 🟡 n / 🔴 n                    │
//   │                                                                    │
//   │                                                                    │
//   │                         [VersionSwitcher] [Dupliquer] [+Version]   │
//   │                                          [Détails]  [Récap loueurs]│
//   └───────────────────────────────────────────────────────────────────┘
//
// Les pastilles de flags + compteurs sont compactes, alignées à gauche.
// Les actions sont groupées à droite et restent visibles en read-only (sauf
// Dupliquer/Nouvelle version qui disparaissent si !canEdit).
//
// Props :
//   - totalItems, flagCounts, checklistProgress
//   - versions, activeVersion
//   - onSelectVersion, onCreateVersion, onDuplicateVersion,
//     onRestoreVersion, onRenameVersion, onDeleteVersion
//   - detailed, onToggleDetailed
//   - onOpenRecap
//   - onExportGlobal, onExportByLoueur, onExportChecklist (MAT-7)
//   - onPreviewBilan, onCloseEssais, onReopenEssais  (MAT-12)
//   - canEdit
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  FileSearch,
  Lock,
  LockOpen,
  Package,
  Plus,
  Share2,
  Users,
} from 'lucide-react'
import { MATOS_FLAGS } from '../../../lib/materiel'
import VersionSwitcher from './VersionSwitcher'
import ExportPdfMenu from './ExportPdfMenu'

export default function MaterielHeader({
  totalItems = 0,
  flagCounts = {},
  checklistProgress = {},
  versions = [],
  activeVersion = null,
  onSelectVersion,
  onCreateVersion,
  onDuplicateVersion,
  onRestoreVersion,
  onRenameVersion,
  onDeleteVersion,
  detailed = false,
  onToggleDetailed,
  onOpenRecap,
  onOpenShare,
  onOpenChantierMode,
  onExportGlobal,
  onExportByLoueur,
  onExportChecklist,
  onPreviewBilan,
  onCloseEssais,
  onReopenEssais,
  canEdit = true,
}) {
  const closedAt = activeVersion?.closed_at || null
  const closedByName = activeVersion?.closed_by_name || null
  const done =
    (checklistProgress?.pre?.done || 0) +
    (checklistProgress?.post?.done || 0) +
    (checklistProgress?.prod?.done || 0)
  const total =
    (checklistProgress?.pre?.total || 0) +
    (checklistProgress?.post?.total || 0) +
    (checklistProgress?.prod?.total || 0)

  return (
    <div
      className="flex flex-col gap-3 px-5 py-4"
      style={{ borderBottom: '1px solid var(--brd-sub)' }}
    >
      {/* Ligne 1 : titre + compteurs + flags */}
      <div className="flex items-center gap-3 flex-wrap">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Package className="w-5 h-5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="min-w-0">
          <h1 className="text-lg font-bold" style={{ color: 'var(--txt)' }}>
            Matériel
          </h1>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {totalItems} {totalItems > 1 ? 'éléments' : 'élément'} · checklist{' '}
            {done}/{total}
          </p>
        </div>

        {/* Flags */}
        <div className="flex items-center gap-2 flex-wrap ml-0 sm:ml-4">
          <FlagPill flag="ok" count={flagCounts?.ok || 0} />
          <FlagPill flag="attention" count={flagCounts?.attention || 0} />
          <FlagPill flag="probleme" count={flagCounts?.probleme || 0} />
        </div>
      </div>

      {/* Ligne 2 : version + actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <VersionSwitcher
          versions={versions}
          activeVersion={activeVersion}
          onSelect={onSelectVersion}
          onRestore={onRestoreVersion}
          onRename={onRenameVersion}
          onDelete={onDeleteVersion}
          canEdit={canEdit}
        />

        {canEdit && activeVersion && (
          <button
            type="button"
            onClick={onDuplicateVersion}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
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
            title="Dupliquer la version active dans une nouvelle version"
          >
            <Copy className="w-3 h-3" />
            Dupliquer
          </button>
        )}

        {canEdit && (
          <button
            type="button"
            onClick={onCreateVersion}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--blue-bg)'
              e.currentTarget.style.color = 'var(--blue)'
              e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-elev)'
              e.currentTarget.style.color = 'var(--txt-2)'
              e.currentTarget.style.borderColor = 'var(--brd)'
            }}
            title="Créer une nouvelle version vide"
          >
            <Plus className="w-3 h-3" />
            Nouvelle version
          </button>
        )}

        {/* Actions à droite */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => onToggleDetailed?.(!detailed)}
            className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: detailed ? 'var(--blue-bg)' : 'var(--bg-elev)',
              color: detailed ? 'var(--blue)' : 'var(--txt-2)',
              border: `1px solid ${detailed ? 'var(--blue)' : 'var(--brd)'}`,
            }}
            title={detailed ? 'Masquer les détails (checklist + remarques)' : 'Afficher les détails (checklist + remarques)'}
          >
            {detailed ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            Détails
          </button>

          <ExportPdfMenu
            onExportGlobal={onExportGlobal}
            onExportByLoueur={onExportByLoueur}
            onExportChecklist={onExportChecklist}
            disabled={!activeVersion}
          />

          {canEdit && activeVersion && (
            <EssaisDropdown
              onOpenChantierMode={onOpenChantierMode}
              onOpenShare={onOpenShare}
            />
          )}

          {/* MAT-12 : Prévisualisation bilan (sans clôture) — visible même
              en read-only pour que n'importe quel membre puisse vérifier le
              rendu avant de demander la clôture à un admin. */}
          {activeVersion && !closedAt && onPreviewBilan && (
            <button
              type="button"
              onClick={onPreviewBilan}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--blue-bg)'
                e.currentTarget.style.color = 'var(--blue)'
                e.currentTarget.style.borderColor = 'var(--blue)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-elev)'
                e.currentTarget.style.color = 'var(--txt-2)'
                e.currentTarget.style.borderColor = 'var(--brd)'
              }}
              title="Prévisualiser le bilan PDF (ZIP global + par loueur) sans clôturer"
            >
              <FileSearch className="w-3 h-3" />
              Aperçu bilan
            </button>
          )}

          {/* MAT-12 : Clôture essais — bouton ou badge + ré-ouverture */}
          {canEdit && activeVersion && !closedAt && (
            <button
              type="button"
              onClick={onCloseEssais}
              className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--blue-bg)'
                e.currentTarget.style.color = 'var(--blue)'
                e.currentTarget.style.borderColor = 'var(--blue)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-elev)'
                e.currentTarget.style.color = 'var(--txt-2)'
                e.currentTarget.style.borderColor = 'var(--brd)'
              }}
              title="Clôturer les essais et générer le bilan PDF"
            >
              <Lock className="w-3 h-3" />
              Clôturer
            </button>
          )}

          {activeVersion && closedAt && (
            <ClotureBadge
              closedAt={closedAt}
              closedByName={closedByName}
              canEdit={canEdit}
              onReopen={onReopenEssais}
            />
          )}

          <button
            type="button"
            onClick={onOpenRecap}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-all"
            style={{
              background: 'var(--blue)',
              color: 'white',
              border: '1px solid var(--blue)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            title="Voir le récap par loueur"
          >
            <Users className="w-3 h-3" />
            Récap loueurs
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Dropdown "Essais" — point d'entrée unique pour les deux workflows terrain :
 *   - Checklist : ouvre le mode chantier authenticated (MAT-14), identité =
 *     user connecté, route `/projets/:id/materiel/check/:versionId`.
 *   - Partager : ouvre ShareChecklistModal pour générer un lien tokenisé
 *     destiné à un loueur / prestataire externe.
 *
 * Fermeture : click outside + touche Échap (pattern standard). On évite un
 * portal/popper pour rester simple — le dropdown tient en position absolue
 * sous le bouton.
 */
function EssaisDropdown({ onOpenChantierMode, onOpenShare }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handleClick(e) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target)) setOpen(false)
    }
    function handleKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
        style={{
          background: open ? 'var(--blue-bg)' : 'var(--bg-elev)',
          color: open ? 'var(--blue)' : 'var(--txt-2)',
          border: `1px solid ${open ? 'var(--blue)' : 'var(--brd)'}`,
        }}
        onMouseEnter={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--blue-bg)'
          e.currentTarget.style.color = 'var(--blue)'
          e.currentTarget.style.borderColor = 'var(--blue)'
        }}
        onMouseLeave={(e) => {
          if (open) return
          e.currentTarget.style.background = 'var(--bg-elev)'
          e.currentTarget.style.color = 'var(--txt-2)'
          e.currentTarget.style.borderColor = 'var(--brd)'
        }}
        title="Essais terrain : ouvrir la checklist ou partager un lien"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ClipboardCheck className="w-3 h-3" />
        Essais
        <ChevronDown className="w-3 h-3" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-40 rounded-lg overflow-hidden"
          style={{
            minWidth: '220px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.25)',
          }}
        >
          <EssaisDropdownItem
            icon={ClipboardCheck}
            label="Checklist"
            description="Ouvrir le mode chantier (ton compte)"
            onClick={() => {
              setOpen(false)
              onOpenChantierMode?.()
            }}
          />
          <EssaisDropdownItem
            icon={Share2}
            label="Partager"
            description="Générer un lien pour le loueur / l'équipe"
            onClick={() => {
              setOpen(false)
              onOpenShare?.()
            }}
          />
        </div>
      )}
    </div>
  )
}

function EssaisDropdownItem({ icon: Icon, label, description, onClick }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
      style={{
        background: 'transparent',
        color: 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-2)'
      }}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--blue)' }} />
      <span className="flex flex-col min-w-0">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {description}
        </span>
      </span>
    </button>
  )
}

function FlagPill({ flag, count }) {
  const def = MATOS_FLAGS[flag]
  const Icon =
    flag === 'ok' ? CheckCircle2 : flag === 'attention' ? Circle : AlertTriangle
  return (
    <span
      className="flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
      style={{ background: def.bg, color: def.color }}
    >
      <Icon className="w-3 h-3" />
      {count}
    </span>
  )
}

/**
 * Badge "Clôturé le DD/MM/YYYY par X" affiché sur l'en-tête quand
 * `activeVersion.closed_at` est posé. Pour les admins, expose un bouton
 * "Ré-ouvrir" (pertinent si on a oublié un item ou qu'on veut re-générer
 * un bilan après corrections).
 */
function ClotureBadge({ closedAt, closedByName, canEdit, onReopen }) {
  const dateLabel = (() => {
    try {
      const d = new Date(closedAt)
      return d.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return '—'
    }
  })()

  const title = closedByName
    ? `Essais clôturés le ${dateLabel} par ${closedByName}`
    : `Essais clôturés le ${dateLabel}`

  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
      style={{
        background: 'var(--blue-bg)',
        color: 'var(--blue)',
        border: '1px solid var(--blue)',
      }}
      title={title}
    >
      <CheckCircle2 className="w-3 h-3" />
      <span className="truncate max-w-[10rem]">
        Clôturé {dateLabel}
        {closedByName ? ` · ${closedByName}` : ''}
      </span>
      {canEdit && onReopen && (
        <button
          type="button"
          onClick={onReopen}
          className="flex items-center gap-1 text-xs font-medium px-1.5 py-0.5 rounded transition-all ml-1"
          style={{
            background: 'transparent',
            color: 'var(--blue)',
            border: '1px solid var(--blue)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--blue)'
            e.currentTarget.style.color = 'white'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--blue)'
          }}
          title="Ré-ouvrir la version (efface closed_at, garde l'archive bilan)"
        >
          <LockOpen className="w-3 h-3" />
          Ré-ouvrir
        </button>
      )}
    </div>
  )
}

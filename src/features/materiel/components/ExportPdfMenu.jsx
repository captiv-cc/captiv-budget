// ════════════════════════════════════════════════════════════════════════════
// ExportPdfMenu — bouton dropdown "Partager" pour la page Matériel
// (renommé MAT-SHARE-4 : ex "Export PDF", maintenant unifié avec lien web)
// ════════════════════════════════════════════════════════════════════════════
//
// Déroule un menu avec quatre options :
//   - Lien web partageable → onShareLink()        (ouvre la modale tokens)
//   - ─────────── (séparateur) ──────────────
//   - Liste globale (PDF)  → onExportGlobal()
//   - Par loueur… (PDF)    → onExportByLoueur()   (ouvre modale sélection)
//   - Checklist (PDF)      → onExportChecklist()
//
// L'appelant gère tous les handlers. Si `onShareLink` n'est pas fourni
// (ex: utilisateur sans droit de partage), l'entrée + le séparateur sont
// masqués et le menu redevient "Export PDF" classique.
//
// Props :
//   - onShareLink()        — optionnel, ouvre MaterielShareModal
//   - onExportGlobal()
//   - onExportByLoueur()
//   - onExportChecklist()
//   - disabled : boolean (pas de version active par ex.)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import {
  ChevronDown,
  FileText,
  Link2,
  ListChecks,
  Share2,
  Users,
} from 'lucide-react'

export default function ExportPdfMenu({
  onShareLink = null,
  onExportGlobal,
  onExportByLoueur,
  onExportChecklist,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  // Close on click outside / Escape
  useEffect(() => {
    if (!open) return undefined
    function onDoc(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(fn) {
    setOpen(false)
    fn?.()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all"
        style={{
          background: open ? 'var(--bg-hov)' : 'var(--bg-elev)',
          color: disabled ? 'var(--txt-3)' : 'var(--txt-2)',
          border: `1px solid ${open ? 'var(--brd-str)' : 'var(--brd)'}`,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !open) {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--txt)'
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled && !open) {
            e.currentTarget.style.background = 'var(--bg-elev)'
            e.currentTarget.style.color = 'var(--txt-2)'
          }
        }}
        title={onShareLink ? 'Partager (lien ou PDF)' : 'Exporter en PDF'}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Share2 className="w-3 h-3" />
        {onShareLink ? 'Partager' : 'Export PDF'}
        <ChevronDown
          className="w-3 h-3 transition-transform"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 z-40 rounded-lg overflow-hidden"
          style={{
            minWidth: '240px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            boxShadow: '0 12px 28px rgba(0,0,0,0.25)',
          }}
        >
          {/* MAT-SHARE-4 : entrée Lien web en premier (action moderne).
              Si pas fournie, le menu reste "Export PDF" classique. */}
          {onShareLink && (
            <>
              <MenuItem
                icon={<Link2 className="w-3.5 h-3.5" />}
                label="Lien web partageable"
                hint="Vue READ-ONLY pour client / DOP / régisseur"
                onClick={() => pick(onShareLink)}
                accent
              />
              <div
                role="separator"
                style={{
                  height: '1px',
                  background: 'var(--brd-sub)',
                  margin: '2px 0',
                }}
              />
            </>
          )}
          <MenuItem
            icon={<FileText className="w-3.5 h-3.5" />}
            label="Liste globale (PDF)"
            hint="Tous les items par bloc"
            onClick={() => pick(onExportGlobal)}
          />
          <MenuItem
            icon={<Users className="w-3.5 h-3.5" />}
            label="Par loueur… (PDF)"
            hint="Combiné ou ZIP"
            onClick={() => pick(onExportByLoueur)}
          />
          <MenuItem
            icon={<ListChecks className="w-3.5 h-3.5" />}
            label="Checklist (PDF)"
            hint="Mode tournage (A4 paysage)"
            onClick={() => pick(onExportChecklist)}
          />
        </div>
      )}
    </div>
  )
}

function MenuItem({ icon, label, hint, onClick, accent = false }) {
  // accent = entrée mise en avant visuellement (ex: "Lien web partageable")
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-all"
      style={{
        background: accent ? 'var(--blue-bg)' : 'transparent',
        color: accent ? 'var(--blue)' : 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = accent ? 'var(--blue-bg)' : 'transparent'
        e.currentTarget.style.color = accent ? 'var(--blue)' : 'var(--txt-2)'
      }}
    >
      <span className="shrink-0" style={{ color: 'var(--blue)' }}>
        {icon}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}

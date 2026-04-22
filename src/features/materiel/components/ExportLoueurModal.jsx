// ════════════════════════════════════════════════════════════════════════════
// ExportLoueurModal — modale de sélection loueurs pour l'export PDF
// ════════════════════════════════════════════════════════════════════════════
//
// Trigger : bouton "Par loueur…" du menu Export.
// Demande à l'utilisateur :
//   - quels loueurs inclure (checkbox, tous cochés par défaut)
//   - format de sortie :
//       • "combined" : un PDF unique avec une page par loueur (preview possible)
//       • "zip"      : 1 PDF par loueur, dans un ZIP (pas de preview)
//
// Props :
//   - open : boolean
//   - onClose : () => void
//   - recapByLoueur : Array<{ loueur, lignes }>  — mêmes données que le panel
//   - onConfirm : ({ selectedIds, format }) => void
//       appelé quand l'utilisateur clique sur "Exporter"
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { FileArchive, FileText, Users, X } from 'lucide-react'

function alpha(hex, a = '22') {
  if (!hex || !hex.startsWith('#') || hex.length !== 7) return '#64748b' + a
  return hex + a
}

export default function ExportLoueurModal({
  open,
  onClose,
  recapByLoueur = [],
  onConfirm,
}) {
  const allIds = useMemo(() => recapByLoueur.map((r) => r.loueur.id), [recapByLoueur])

  const [selected, setSelected] = useState(() => new Set(allIds))
  const [format, setFormat] = useState('combined') // 'combined' | 'zip'

  // Re-sync selection whenever the modal re-opens or the input set changes.
  useEffect(() => {
    if (open) setSelected(new Set(allIds))
  }, [open, allIds])

  // Escape to close
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const total = allIds.length
  const count = selected.size
  const allChecked = count === total && total > 0
  const noneChecked = count === 0

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === total ? new Set() : new Set(allIds)))
  }

  function handleConfirm() {
    if (noneChecked) return
    onConfirm?.({
      selectedIds: Array.from(selected),
      format,
    })
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Modal */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl"
        style={{
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(520px, 94vw)',
          maxHeight: '84vh',
          background: 'var(--bg-base)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-label="Export par loueur"
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Users className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Export PDF par loueur
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Choisis les loueurs à inclure et le format de sortie.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer"
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Sélection loueurs */}
          {total === 0 ? (
            <div
              className="rounded-lg p-4 text-center text-xs"
              style={{
                background: 'var(--bg-surf)',
                border: '1px dashed var(--brd)',
                color: 'var(--txt-3)',
              }}
            >
              Aucun loueur affecté à cette version — affecte un loueur à un item
              d&apos;abord.
            </div>
          ) : (
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                >
                  Loueurs ({count}/{total})
                </label>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-semibold"
                  style={{
                    color: 'var(--blue)',
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                  }}
                >
                  {allChecked ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              </div>

              <div
                className="rounded-lg overflow-hidden"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd-sub)',
                }}
              >
                {recapByLoueur.map((r) => {
                  const loueur = r.loueur
                  const isChecked = selected.has(loueur.id)
                  const couleur = loueur.couleur || '#64748b'
                  return (
                    <label
                      key={loueur.id}
                      className="flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all"
                      style={{
                        borderBottom: '1px solid var(--brd-sub)',
                        background: isChecked ? alpha(couleur, '10') : 'transparent',
                      }}
                      onMouseEnter={(e) => {
                        if (!isChecked) {
                          e.currentTarget.style.background = 'var(--bg-hov)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isChecked) {
                          e.currentTarget.style.background = 'transparent'
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggle(loueur.id)}
                        className="shrink-0"
                        style={{ accentColor: couleur }}
                      />
                      <span
                        className="inline-block rounded-full shrink-0"
                        style={{
                          width: '8px',
                          height: '8px',
                          background: couleur,
                        }}
                      />
                      <span
                        className="text-xs font-semibold flex-1 truncate"
                        style={{ color: 'var(--txt)' }}
                      >
                        {loueur.nom}
                      </span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                        style={{
                          background: alpha(couleur, '22'),
                          color: couleur,
                        }}
                      >
                        {r.lignes.length}
                      </span>
                    </label>
                  )
                })}
              </div>
            </section>
          )}

          {/* Format */}
          <section className="flex flex-col gap-2">
            <label
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
            >
              Format
            </label>
            <div className="flex flex-col gap-2">
              <FormatOption
                value="combined"
                current={format}
                onChange={setFormat}
                icon={<FileText className="w-4 h-4" />}
                title="PDF combiné"
                hint="Un PDF avec une section par loueur (preview possible)"
              />
              <FormatOption
                value="zip"
                current={format}
                onChange={setFormat}
                icon={<FileArchive className="w-4 h-4" />}
                title="ZIP (1 PDF par loueur)"
                hint="Archive ZIP, téléchargement direct (pas de preview)"
              />
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md transition-all"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
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
            Annuler
          </button>
          <button
            type="button"
            disabled={noneChecked}
            onClick={handleConfirm}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all"
            style={{
              background: noneChecked ? 'var(--bg-hov)' : 'var(--blue)',
              color: noneChecked ? 'var(--txt-3)' : 'white',
              border: `1px solid ${noneChecked ? 'var(--brd)' : 'var(--blue)'}`,
              cursor: noneChecked ? 'not-allowed' : 'pointer',
              opacity: noneChecked ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              if (!noneChecked) e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              if (!noneChecked) e.currentTarget.style.opacity = '1'
            }}
          >
            Exporter
          </button>
        </footer>
      </div>
    </>
  )
}

function FormatOption({ value, current, onChange, icon, title, hint }) {
  const active = current === value
  return (
    <label
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-surf)',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
      }}
    >
      <input
        type="radio"
        name="export-loueur-format"
        value={value}
        checked={active}
        onChange={() => onChange(value)}
        className="shrink-0"
      />
      <span
        className="shrink-0"
        style={{ color: active ? 'var(--blue)' : 'var(--txt-2)' }}
      >
        {icon}
      </span>
      <span className="flex flex-col min-w-0">
        <span
          className="text-xs font-semibold"
          style={{ color: active ? 'var(--blue)' : 'var(--txt)' }}
        >
          {title}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </span>
      </span>
    </label>
  )
}

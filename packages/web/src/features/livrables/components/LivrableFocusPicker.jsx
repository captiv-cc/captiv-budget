// ════════════════════════════════════════════════════════════════════════════
// LivrableFocusPicker — Picker de livrable pour le mode Focus du Pipeline
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un bouton "pill" qui ouvre un popover listant tous les livrables du
// projet. L'utilisateur peut switcher rapidement de livrable focus depuis le
// header de la vue Focus (LIV-22c).
//
// Pattern miroir de `EventTypeSelect` (popover custom via PopoverFloat) pour
// rester cohérent avec le reste du feature LIV. PopoverFloat utilise
// createPortal + position fixed → le popover s'échappe des overflow ancêtres
// (sticky header, scroll container Gantt).
//
// Tri : par block.sort_order puis livrable.sort_order (cohérent avec le
// Gantt et la liste).
//
// Props :
//   - livrables          : Array (tous les livrables du projet)
//   - blocks             : Array (pour préfixe + tri)
//   - currentLabel       : string (label affiché sur le bouton)
//   - currentLivrableId  : string|null (livrable courant pour highlight)
//   - onPick             : (livrableId) => void
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import PopoverFloat from './PopoverFloat'

export default function LivrableFocusPicker({
  livrables = [],
  blocks = [],
  currentLabel = 'Choisir un livrable',
  currentLivrableId = null,
  onPick,
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef(null)

  // Pré-calcul des items avec label complet (préfixe bloc + numero · nom).
  const items = useMemo(() => {
    const blockOrderById = new Map(blocks.map((b) => [b.id, b.sort_order ?? 0]))
    const blocksById = new Map(blocks.map((b) => [b.id, b]))
    const out = livrables
      .filter((l) => l?.id)
      .map((l) => {
        const block = blocksById.get(l.block_id) || null
        const numero = (l.numero || '').toString().trim()
        const prefix = (block?.prefixe || '').toString().trim()
        const fullNumero =
          prefix && numero && !numero.startsWith(prefix)
            ? `${prefix}${numero}`
            : numero
        const nom = (l.nom || '').toString().trim() || 'Sans nom'
        const label = fullNumero ? `${fullNumero} · ${nom}` : nom
        return {
          id: l.id,
          label,
          blockOrder: blockOrderById.get(l.block_id) ?? 0,
          sortOrder: l.sort_order ?? 0,
        }
      })
    out.sort((a, b) => {
      if (a.blockOrder !== b.blockOrder) return a.blockOrder - b.blockOrder
      return a.sortOrder - b.sortOrder
    })
    return out
  }, [livrables, blocks])

  const handlePick = (id) => {
    setOpen(false)
    if (id !== currentLivrableId) onPick?.(id)
  }

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium"
        style={{
          background: 'var(--bg-2)',
          color: 'var(--txt)',
          border: '1px solid var(--brd-sub)',
          cursor: 'pointer',
          maxWidth: '320px',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--bg-2)'
        }}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown className="w-3 h-3 shrink-0 opacity-70" aria-hidden="true" />
      </button>
      <PopoverFloat
        anchorRef={anchorRef}
        open={open}
        onClose={() => setOpen(false)}
        align="left"
      >
        <div
          className="rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: '240px',
            maxHeight: '360px',
            overflowY: 'auto',
          }}
        >
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs italic" style={{ color: 'var(--txt-3)' }}>
              Aucun livrable.
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handlePick(item.id)}
                className="w-full flex items-center px-3 py-2 text-left text-xs transition-colors"
                style={{
                  background:
                    item.id === currentLivrableId ? 'var(--bg-hov)' : 'transparent',
                  color: 'var(--txt)',
                  fontWeight: item.id === currentLivrableId ? 600 : 400,
                }}
                onMouseEnter={(e) => {
                  if (item.id !== currentLivrableId) {
                    e.currentTarget.style.background = 'var(--bg-hov)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (item.id !== currentLivrableId) {
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <span className="truncate">{item.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverFloat>
    </>
  )
}

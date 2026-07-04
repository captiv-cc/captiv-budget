// ════════════════════════════════════════════════════════════════════════════
// LibraryPanel — bibliothèque d'éléments Captiv (panneau gauche de l'éditeur)
// ════════════════════════════════════════════════════════════════════════════
//
// Rendu DANS le contexte <Tldraw> (useEditor). Clic sur un item → placé au
// centre du viewport, sélectionné, prêt à déplacer. Caméras → shape
// 'captiv-camera' (numéro auto) ; le reste → 'captiv-item'.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { useEditor, createShapeId } from 'tldraw'
import { ChevronDown, ChevronRight, Search, Shapes, X } from 'lucide-react'
import { CATALOG, Glyph, focaleToAngleDeg } from './shapes/catalog'
import { CAMERA_SHAPE_TYPE, CAMERA_DEFAULT_H } from './shapes/CameraShapeUtil'
import { ITEM_SHAPE_TYPE } from './shapes/ItemShapeUtil'

export default function LibraryPanel() {
  const editor = useEditor()
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState(() => new Set(['cameras', 'lumiere']))

  function toggleCat(key) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function placeItem(item, layer) {
    const center = editor.getViewportPageBounds().center
    const id = createShapeId()

    if (item.isCamera) {
      // Numéro auto : max des numéros de caméras existantes + 1.
      const cams = editor
        .getCurrentPageShapes()
        .filter((s) => s.type === CAMERA_SHAPE_TYPE)
      const numero = cams.reduce((m, s) => Math.max(m, s.props.numero || 0), 0) + 1
      const focale = 35
      const h = CAMERA_DEFAULT_H
      const w = Math.round(2 * h * Math.tan(((focaleToAngleDeg(focale) / 2) * Math.PI) / 180))
      editor.createShape({
        id,
        type: CAMERA_SHAPE_TYPE,
        x: center.x - w / 2,
        y: center.y - h / 2,
        meta: { layer: 'cameras' },
        props: { w, h, modele: item.label, focale, couleur: item.color, numero },
      })
    } else {
      editor.createShape({
        id,
        type: ITEM_SHAPE_TYPE,
        x: center.x - (item.w || 60) / 2,
        y: center.y - (item.h || 60) / 2,
        meta: { layer },
        props: {
          w: item.w || 60,
          h: item.h || 60,
          kind: item.kind,
          label: item.label,
          couleur: item.color,
        },
      })
    }
    editor.setSelectedShapes([id])
    editor.setCurrentTool('select')
  }

  const q = search.trim().toLowerCase()
  const cats = CATALOG.map((c) => ({
    ...c,
    items: q ? c.items.filter((i) => i.label.toLowerCase().includes(q)) : c.items,
  })).filter((c) => c.items.length > 0)

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute left-3 top-16 z-[300] flex items-center gap-1.5 text-xs font-semibold px-2.5 py-2 rounded-lg"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
        title="Bibliothèque d'éléments"
      >
        <Shapes className="w-4 h-4" />
        Bibliothèque
      </button>
    )
  }

  return (
    <div
      className="absolute left-3 top-16 bottom-16 z-[300] w-52 flex flex-col rounded-xl overflow-hidden"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--brd)' }}>
        <Shapes className="w-4 h-4" style={{ color: 'var(--blue)' }} />
        <span className="flex-1 text-xs font-bold" style={{ color: 'var(--txt)' }}>
          Bibliothèque
        </span>
        <button type="button" onClick={() => setOpen(false)} style={{ color: 'var(--txt-3)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 shrink-0">
        <div
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher…"
            className="w-full text-xs outline-none bg-transparent"
            style={{ color: 'var(--txt)' }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {cats.map((catGroup) => {
          const isOpen = q || openCats.has(catGroup.key)
          return (
            <div key={catGroup.key} className="mb-1">
              <button
                type="button"
                onClick={() => toggleCat(catGroup.key)}
                className="w-full flex items-center gap-1 px-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                style={{ color: 'var(--txt-3)' }}
              >
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {catGroup.label}
              </button>
              {isOpen && (
                <div className="grid grid-cols-2 gap-1.5 px-1">
                  {catGroup.items.map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      onClick={() => placeItem(item, catGroup.layer)}
                      className="flex flex-col items-center gap-1 p-2 rounded-lg transition-colors"
                      style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--brd)' }}
                      title={`Ajouter ${item.label}`}
                    >
                      <div className="w-8 h-8">
                        {item.isCamera ? (
                          <svg viewBox="0 0 40 40" width="100%" height="100%">
                            <path
                              d="M20 34 L8 8 L32 8 Z"
                              fill={item.color}
                              fillOpacity="0.15"
                              stroke={item.color}
                              strokeWidth="1.5"
                              strokeDasharray="3 3"
                            />
                            <circle cx="20" cy="30" r="6" fill={item.color} />
                          </svg>
                        ) : (
                          <Glyph glyph={item.glyph} color={item.color} label={item.label} />
                        )}
                      </div>
                      <span className="text-[10px] font-semibold leading-tight text-center" style={{ color: 'var(--txt-2)' }}>
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

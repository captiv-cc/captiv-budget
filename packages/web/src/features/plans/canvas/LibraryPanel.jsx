// ════════════════════════════════════════════════════════════════════════════
// LibraryPanel — bibliothèque d'éléments Captiv (sidebar gauche de l'éditeur)
// ════════════════════════════════════════════════════════════════════════════
//
// v2 (cadrage Hugo 2026-07-05) :
//   - caméras par TYPE DE SUPPORT (trépied, épaule, grue, cable-cam, spider,
//     travelling…), le modèle (FX6, BURANO…) se choisit dans Propriétés ;
//   - rangée « Récents » (6 derniers posés, localStorage) ;
//   - grille 3 colonnes avec labels ;
//   - clic → posé au centre du viewport, OU drag & drop vers le canvas
//     (dataTransfer custom, drop géré par PlanEditor) ;
//   - recherche avec synonymes (item.tags).
//
// Le placement crée la bonne shape selon camKind : 'box' → captiv-camera,
// 'rail' → captiv-railcam, 'spider' → captiv-spidercam, sinon captiv-item.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { createShapeId } from 'tldraw'
import { ChevronDown, ChevronRight, Clock, Search, Shapes, X } from 'lucide-react'
import { CATALOG, Glyph, focaleToAngleDeg, catalogItem } from './shapes/catalog'
import { CAMERA_SHAPE_TYPE } from './shapes/CameraShapeUtil'
import { RAILCAM_SHAPE_TYPE } from './shapes/RailCamShapeUtil'
import { SPIDERCAM_SHAPE_TYPE } from './shapes/SpiderCamShapeUtil'
import { ZONE_SHAPE_TYPE } from './shapes/ZoneShapeUtil'
import { COTE_SHAPE_TYPE } from './shapes/CotationShapeUtil'
import { nextCamNumero, CAM_SHAPE_TYPES } from './shapes/camUtils'

export const LIB_DRAG_MIME = 'application/x-captiv-lib-item'
const RECENTS_KEY = 'plans-lib-recents'
// Tailles calibrées pour un viewport de référence ~900px de haut.
const REF_VIEWPORT_H = 900

function loadRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]')
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}

function pushRecent(kind) {
  const next = [kind, ...loadRecents().filter((k) => k !== kind)].slice(0, 6)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    /* noop */
  }
  return next
}

/**
 * Pose un item du catalogue sur le canvas au point page donné (ou au centre
 * du viewport). Exporté : utilisé aussi par le drop handler de PlanEditor.
 */
export function placeCatalogItem(editor, kind, pagePoint = null) {
  const item = catalogItem(kind)
  if (!editor || !item) return
  const viewport = editor.getViewportPageBounds()
  const at = pagePoint || viewport.center
  const k = Math.max(0.4, viewport.height / REF_VIEWPORT_H)
  // Taille de badge UNIFORME : hérite de la taille des caméras déjà posées
  // (médiane), sinon défaut dérivé du viewport. Réglable globalement via le
  // panneau Layers (S/M/L).
  const existing = editor
    .getCurrentPageShapes()
    .filter((s) => CAM_SHAPE_TYPES.includes(s.type) && s.props.uiScale)
    .map((s) => s.props.uiScale)
    .sort((a, b) => a - b)
  const uiScale = existing.length
    ? existing[Math.floor(existing.length / 2)]
    : Math.round(Math.max(16, Math.min(64, viewport.height * 0.024)))
  const id = createShapeId()

  if (item.special === 'zone') {
    const w = Math.round(viewport.width * 0.24)
    const h = Math.round(viewport.height * 0.2)
    editor.createShape({
      id,
      type: ZONE_SHAPE_TYPE,
      x: at.x - w / 2,
      y: at.y - h / 2,
      meta: { layer: 'zones' },
      props: { w, h, label: 'Zone', couleur: item.color, showDims: true },
    })
    editor.setSelectedShapes([id])
    editor.setCurrentTool('select')
    return pushRecent(kind)
  }
  if (item.special === 'cote') {
    const len = Math.round(viewport.width * 0.22)
    editor.createShape({
      id,
      type: COTE_SHAPE_TYPE,
      x: at.x - len / 2,
      y: at.y,
      meta: { layer: 'cotations' },
      props: {
        points: [
          { x: 0, y: 0 },
          { x: len, y: 0 },
        ],
        couleur: item.color,
      },
    })
    editor.setSelectedShapes([id])
    editor.setCurrentTool('select')
    return pushRecent(kind)
  }

  if (item.camKind === 'box') {
    const numero = nextCamNumero(editor)
    const focale = item.defaultFocale || 35
    // Mobiles (cône off) : box compacte autour du badge — pas d'espace mort.
    const h = item.mobile ? Math.round(uiScale * 2.2) : Math.round(viewport.height * 0.18)
    const w = item.mobile
      ? Math.round(uiScale * 2.2)
      : Math.round(2 * h * Math.tan(((focaleToAngleDeg(focale) / 2) * Math.PI) / 180))
    editor.createShape({
      id,
      type: CAMERA_SHAPE_TYPE,
      x: at.x - w / 2,
      // L'apex (position caméra) au point de drop, pas le centre du cône.
      y: at.y - h,
      meta: { layer: 'cameras' },
      props: {
        w,
        h,
        modele: '',
        support: item.short || item.label,
        focale,
        couleur: item.color,
        numero,
        uiScale,
        // Mobiles : anneau pointillé, cône masqué par défaut (activable).
        mobile: !!item.mobile,
        showCone: !item.mobile,
        variante: item.variante || '',
      },
    })
  } else if (item.camKind === 'rail') {
    const numero = nextCamNumero(editor)
    const len = viewport.width * 0.3
    // Travelling : on démarre à 2 points (droit) ; on ajoute des points via
    // les poignées « + » au milieu des segments.
    const points = [
      { x: 0, y: 0 },
      { x: len, y: 0 },
    ]
    editor.createShape({
      id,
      type: RAILCAM_SHAPE_TYPE,
      x: at.x - len / 2,
      y: at.y,
      meta: { layer: 'cameras' },
      props: {
        points,
        spline: false,
        railKind: item.railKind,
        // Travelling : caméra décentrée pour ne pas recouvrir la poignée
        // « + » d'ajout de point (au milieu du segment).
        camT: item.railKind === 'travelling' ? 0.3 : 0.5,
        modele: '',
        support: item.short || item.label,
        couleur: item.color,
        numero,
        uiScale,
      },
    })
  } else if (item.camKind === 'spider') {
    const numero = nextCamNumero(editor)
    const w = viewport.width * 0.28
    const h = viewport.height * 0.28
    editor.createShape({
      id,
      type: SPIDERCAM_SHAPE_TYPE,
      x: at.x - w / 2,
      y: at.y - h / 2,
      meta: { layer: 'cameras' },
      props: {
        points: [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ],
        modele: '',
        support: item.short || item.label,
        couleur: item.color,
        numero,
        uiScale,
      },
    })
  } else {
    const w = Math.round((item.w || 60) * k)
    const h = Math.round((item.h || 60) * k)
    editor.createShape({
      id,
      type: 'captiv-item',
      x: at.x - w / 2,
      y: at.y - h / 2,
      meta: { layer: item.layer },
      props: { w, h, kind: item.kind, label: item.label, couleur: item.color },
    })
  }
  editor.setSelectedShapes([id])
  editor.setCurrentTool('select')
  return pushRecent(kind)
}

/* ─── Tuile d'item ──────────────────────────────────────────────────────── */

function ItemTile({ item, onPlace }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(LIB_DRAG_MIME, item.kind)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onPlace(item.kind)}
      className="flex flex-col items-center gap-1 p-1.5 rounded-lg transition-colors"
      style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = item.color }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--brd)' }}
      title={`${item.label} — clic ou glisser sur le plan`}
    >
      <div className="w-7 h-7">
        <Glyph glyph={item.glyph} color={item.color} label={item.label} />
      </div>
      <span
        className="text-[9px] font-semibold leading-tight text-center w-full truncate"
        style={{ color: 'var(--txt-2)' }}
      >
        {item.short || item.label}
      </span>
    </button>
  )
}

/* ─── Panneau ───────────────────────────────────────────────────────────── */

export default function LibraryPanel({ editor }) {
  const [open, setOpen] = useState(true)
  const [search, setSearch] = useState('')
  const [openCats, setOpenCats] = useState(() => new Set(['cameras']))
  const [recents, setRecents] = useState(loadRecents)

  function toggleCat(key) {
    setOpenCats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function handlePlace(kind) {
    if (!editor) return
    const next = placeCatalogItem(editor, kind)
    if (next) setRecents(next)
  }

  const q = search
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
  const matches = (item) => {
    if (!q) return true
    const hay = [item.label, item.short, ...(item.tags || [])]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
    return hay.includes(q)
  }

  const cats = CATALOG.map((c) => ({ ...c, items: c.items.filter(matches) })).filter(
    (c) => c.items.length > 0,
  )
  const recentItems = q ? [] : recents.map((kind) => catalogItem(kind)).filter(Boolean)

  if (!open) {
    return (
      <div className="h-full flex flex-col shrink-0" style={{ borderRight: '1px solid var(--brd)', background: 'var(--bg-elev)' }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="p-2.5"
          style={{ color: 'var(--txt-2)' }}
          title="Ouvrir la bibliothèque"
        >
          <Shapes className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <div
      className="h-full w-56 flex flex-col shrink-0 overflow-hidden"
      style={{ background: 'var(--bg-elev)', borderRight: '1px solid var(--brd)' }}
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
        {/* Récents */}
        {recentItems.length > 0 && (
          <div className="mb-1">
            <div
              className="flex items-center gap-1 px-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--txt-3)' }}
            >
              <Clock className="w-3 h-3" />
              Récents
            </div>
            <div className="grid grid-cols-3 gap-1.5 px-1">
              {recentItems.map((item) => (
                <ItemTile key={`recent-${item.kind}`} item={item} onPlace={handlePlace} />
              ))}
            </div>
          </div>
        )}

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
                <div className="grid grid-cols-3 gap-1.5 px-1">
                  {catGroup.items.map((item) => (
                    <ItemTile key={item.kind} item={item} onPlace={handlePlace} />
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

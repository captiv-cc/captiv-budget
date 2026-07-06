// ════════════════════════════════════════════════════════════════════════════
// PlanSidePanel — sidebar droite de l'éditeur : Layers | Propriétés
// ════════════════════════════════════════════════════════════════════════════
//
// Colonne fixe HORS canvas (editor en prop, posé au onMount) : le panneau de
// styles natif tldraw garde son coin haut-droit du canvas sans collision.
//
// Layers : couches fixes (catalog.LAYERS), assignées par meta.layer à la
// création des shapes. Visibilité = meta.hidden sur chaque shape de la
// couche (lu par getShapeVisibility côté <Tldraw>) ; verrou = isLocked.
// Ces états vivent dans les shapes → synchronisés en collab et persistés,
// comme sur Figma (une couche masquée l'est pour tout le monde).
//
// Propriétés : édition de la sélection — caméra (label, modèle, focale →
// cône, couleur, cône on/off) et item (label, couleur).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useValue } from 'tldraw'
import { Check, Eye, EyeOff, Lock, LockOpen, Layers as LayersIcon, MessageCircle, RotateCcw, Send } from 'lucide-react'
import { replyToComment, setCommentResolved } from '../../../lib/plansCanvasShare'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { LAYERS, shapeLayer, FOCALES, focaleToAngleDeg, CAMERA_MODELES, CABLE_TYPES } from './shapes/catalog'
import { CABLE_SHAPE_TYPE, cableLengthPx } from './shapes/CableShapeUtil'
import { FocaleCalc } from './FocaleCalc'
import { CAMERA_SHAPE_TYPE } from './shapes/CameraShapeUtil'
import { ITEM_SHAPE_TYPE } from './shapes/ItemShapeUtil'
import { RAILCAM_SHAPE_TYPE } from './shapes/RailCamShapeUtil'
import { SPIDERCAM_SHAPE_TYPE } from './shapes/SpiderCamShapeUtil'
import { ZONE_SHAPE_TYPE } from './shapes/ZoneShapeUtil'
import { COTE_SHAPE_TYPE } from './shapes/CotationShapeUtil'
import { CAM_SHAPE_TYPES } from './shapes/camUtils'
import { fmtMeters, pageMetersPerPx } from './shapes/scale'

const COULEURS = ['#4d9fff', '#ffce00', '#9c5ffd', '#ff5ac4', '#00c875', '#ff9f0a', '#ff4757', '#a8a8a8']

export default function PlanSidePanel({
  editor,
  canvasId,
  comments = [],
  selectedCommentId = null,
  onFocusComment,
}) {
  const [tab, setTab] = useState('layers')

  const selected = useValue('selection', () => editor.getSelectedShapes(), [editor])
  const unresolvedCount = comments.filter((c) => !c.parent_id && !c.resolved).length

  // Un clic sur un marqueur du canvas bascule sur l'onglet Commentaires.
  useEffect(() => {
    if (selectedCommentId) setTab('comments')
  }, [selectedCommentId])

  return (
    <div
      className="h-full w-60 shrink-0 overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-elev)', borderLeft: '1px solid var(--brd)' }}
    >
      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid var(--brd)' }}>
        {[
          ['layers', 'Layers'],
          ['props', 'Propriétés'],
          ['comments', unresolvedCount ? `Comms (${unresolvedCount})` : 'Comms'],
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className="flex-1 text-xs font-bold py-2.5 transition-colors"
            style={{
              color: tab === key ? 'var(--txt)' : 'var(--txt-3)',
              borderBottom: tab === key ? '2px solid var(--blue)' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'layers' ? (
          <LayersTab editor={editor} />
        ) : tab === 'props' ? (
          <PropsTab editor={editor} selected={selected} />
        ) : (
          <CommentsTab
            canvasId={canvasId}
            comments={comments}
            selectedCommentId={selectedCommentId}
            onFocusComment={onFocusComment}
          />
        )}
      </div>

      {/* Résumé sélection (toujours visible, comme le mockup) */}
      {selected.length === 1 && tab === 'layers' && <SelectionSummary shape={selected[0]} />}
    </div>
  )
}

/* ─── Commentaires (clients + réponses desk) ────────────────────────────── */

function CommentsTab({ canvasId, comments, selectedCommentId, onFocusComment }) {
  const { user } = useAuth()
  const [replyTo, setReplyTo] = useState(null)
  const [showResolved, setShowResolved] = useState(false)

  const roots = comments.filter((c) => !c.parent_id)
  const open = roots.filter((c) => !c.resolved)
  const resolved = roots.filter((c) => c.resolved)
  const repliesOf = (id) => comments.filter((c) => c.parent_id === id)

  async function sendReply(parent, body) {
    if (!body.trim()) return
    try {
      await replyToComment({ canvasId, parentId: parent.id, body, userId: user?.id })
      setReplyTo(null)
      // Le refetch arrive par realtime.
    } catch (err) {
      notify.error('Réponse impossible : ' + (err?.message || err))
    }
  }

  async function toggleResolved(comment) {
    try {
      await setCommentResolved(comment.id, !comment.resolved)
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  function CommentCard({ comment, index }) {
    const isSelected = comment.id === selectedCommentId
    return (
      <div
        className="mx-2 mb-2 p-2.5 rounded-lg cursor-pointer"
        style={{
          background: 'var(--bg)',
          border: isSelected ? '1px solid #facc15' : '1px solid var(--brd)',
        }}
        onClick={() => onFocusComment?.(comment)}
      >
        <div className="flex items-center gap-1.5 mb-1">
          {index != null && (
            <span
              className="w-4.5 h-4.5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center"
              style={{ background: '#facc15', color: '#1c1917' }}
            >
              {index + 1}
            </span>
          )}
          <span className="flex-1 text-[11px] font-bold truncate" style={{ color: 'var(--txt)' }}>
            {comment.author_type === 'client'
              ? comment.author_client_name || 'Client'
              : comment.author?.full_name || 'Équipe'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {new Date(comment.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
          </span>
        </div>
        <div className="text-xs whitespace-pre-wrap" style={{ color: 'var(--txt-2)' }}>
          {comment.body}
        </div>

        {repliesOf(comment.id).map((r) => (
          <div key={r.id} className="mt-1.5 pl-2 py-1" style={{ borderLeft: '2px solid var(--brd)' }}>
            <div className="text-[10px] font-bold" style={{ color: 'var(--txt-3)' }}>
              {r.author_type === 'client' ? r.author_client_name || 'Client' : r.author?.full_name || 'Équipe'}
            </div>
            <div className="text-xs" style={{ color: 'var(--txt-2)' }}>
              {r.body}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
            className="text-[10px] font-semibold px-1.5 py-1 rounded"
            style={{ color: 'var(--blue)' }}
          >
            Répondre
          </button>
          <button
            type="button"
            onClick={() => toggleResolved(comment)}
            className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-1 rounded"
            style={{ color: comment.resolved ? 'var(--txt-3)' : 'var(--green, #00c875)' }}
          >
            {comment.resolved ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
            {comment.resolved ? 'Rouvrir' : 'Résoudre'}
          </button>
        </div>

        {replyTo === comment.id && (
          <form
            className="flex items-center gap-1 mt-1.5"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              sendReply(comment, e.currentTarget.elements.reply.value)
            }}
          >
            <input
              name="reply"
              type="text"
              autoFocus
              placeholder="Répondre…"
              className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            />
            <button type="submit" className="p-1.5 rounded-md" style={{ color: 'var(--blue)' }}>
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        )}
      </div>
    )
  }

  return (
    <div className="py-2">
      {open.length === 0 && resolved.length === 0 && (
        <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
          <MessageCircle className="w-5 h-5" style={{ color: 'var(--txt-3)' }} />
          <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Aucun commentaire. Les destinataires du lien de partage peuvent
            annoter le plan.
          </div>
        </div>
      )}
      {open.map((c, i) => (
        <CommentCard key={c.id} comment={c} index={i} />
      ))}
      {resolved.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowResolved((v) => !v)}
            className="w-full text-left px-3 py-1.5 text-[11px] font-bold"
            style={{ color: 'var(--txt-3)' }}
          >
            {showResolved ? '▾' : '▸'} Résolus ({resolved.length})
          </button>
          {showResolved && resolved.map((c) => <CommentCard key={c.id} comment={c} index={null} />)}
        </>
      )}
    </div>
  )
}

/* ─── Layers ─────────────────────────────────────────────────────────────── */

function LayersTab({ editor }) {
  // Regroupe les shapes de la page par layer (réactif).
  const byLayer = useValue(
    'shapes-by-layer',
    () => {
      const map = new Map()
      editor.getCurrentPageShapes().forEach((s) => {
        const key = shapeLayer(s)
        if (!map.has(key)) map.set(key, [])
        map.get(key).push(s)
      })
      return map
    },
    [editor],
  )

  function setLayerHidden(layerKey, hidden) {
    const shapes = byLayer.get(layerKey) || []
    if (!shapes.length) return
    editor.run(() => {
      shapes.forEach((s) => {
        // Les shapes verrouillées refusent les updates → dévérouille le temps
        // de poser le flag (cas du fond de plan).
        if (s.isLocked) {
          editor.updateShape({ id: s.id, type: s.type, isLocked: false })
          editor.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, hidden }, isLocked: true })
        } else {
          editor.updateShape({ id: s.id, type: s.type, meta: { ...s.meta, hidden } })
        }
      })
    })
  }

  function setLayerLocked(layerKey, locked) {
    const shapes = byLayer.get(layerKey) || []
    if (!shapes.length) return
    editor.run(() => {
      shapes.forEach((s) => {
        editor.updateShape({ id: s.id, type: s.type, isLocked: locked })
      })
    })
  }

  // Opacité par couche : pilote la prop native `opacity` de chaque shape
  // (0.1 → 1). Cas d'usage principal : atténuer le fond de plan pour faire
  // ressortir le dispositif.
  function setLayerOpacity(layerKey, opacity) {
    const shapes = byLayer.get(layerKey) || []
    if (!shapes.length) return
    editor.run(() => {
      shapes.forEach((s) => {
        if (s.isLocked) {
          editor.updateShape({ id: s.id, type: s.type, isLocked: false })
          editor.updateShape({ id: s.id, type: s.type, opacity, isLocked: true })
        } else {
          editor.updateShape({ id: s.id, type: s.type, opacity })
        }
      })
    })
  }

  return (
    <div className="py-1">
      {LAYERS.map((layer) => {
        const shapes = byLayer.get(layer.key) || []
        const count = shapes.length
        const allHidden = count > 0 && shapes.every((s) => s.meta?.hidden)
        const allLocked = count > 0 && shapes.every((s) => s.isLocked)
        const opacity = count > 0 ? (shapes[0].opacity ?? 1) : 1
        return (
          <div
            key={layer.key}
            className="group flex items-center gap-1.5 px-3 py-2"
            style={{ opacity: count === 0 ? 0.45 : 1 }}
          >
            <button
              type="button"
              onClick={() => setLayerHidden(layer.key, !allHidden)}
              disabled={count === 0}
              title={allHidden ? 'Afficher' : 'Masquer'}
              style={{ color: allHidden ? 'var(--txt-3)' : 'var(--txt-2)' }}
            >
              {allHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              onClick={() => setLayerLocked(layer.key, !allLocked)}
              disabled={count === 0}
              title={allLocked ? 'Déverrouiller' : 'Verrouiller'}
              style={{ color: allLocked ? 'var(--orange, #ff9f0a)' : 'var(--txt-3)' }}
            >
              {allLocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
            </button>
            <span className="flex-1 text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {layer.label}
            </span>
            {/* Opacité : slider compact, révélé au survol de la ligne
                (reste visible si la couche est atténuée). */}
            {count > 0 && (
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={Math.round(opacity * 100)}
                onChange={(e) => setLayerOpacity(layer.key, Number(e.target.value) / 100)}
                className={`w-14 shrink-0 transition-opacity ${
                  opacity < 1 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{ accentColor: 'var(--blue)', height: 2 }}
                title={`Opacité ${layer.label} : ${Math.round(opacity * 100)}%`}
              />
            )}
            {count > 0 && opacity < 1 && (
              <span className="text-[10px] font-semibold w-7 text-right shrink-0" style={{ color: 'var(--txt-3)' }}>
                {Math.round(opacity * 100)}%
              </span>
            )}
            <span className="text-[11px] font-semibold w-3 text-right shrink-0" style={{ color: 'var(--txt-3)' }}>
              {count || ''}
            </span>
          </div>
        )
      })}
      {/* Taille globale des badges caméra */}
      <BadgeSizeRow editor={editor} />
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        <LayersIcon className="w-3 h-3" />
        Les éléments rejoignent leur couche à la création
      </div>
    </div>
  )
}

// Applique une taille de badge uniforme à TOUTES les caméras du plan
// (S/M/L relatif à la hauteur visible actuelle).
function BadgeSizeRow({ editor }) {
  const cams = useValue(
    'cam-shapes',
    () => editor.getCurrentPageShapes().filter((s) => CAM_SHAPE_TYPES.includes(s.type)),
    [editor],
  )
  if (!cams.length) return null

  function apply(factor) {
    const vh = editor.getViewportPageBounds().height
    const uiScale = Math.round(Math.max(12, Math.min(80, vh * factor)))
    editor.run(() => {
      cams.forEach((s) => {
        editor.updateShape({ id: s.id, type: s.type, props: { uiScale } })
      })
    })
  }

  return (
    <div className="flex items-center gap-1.5 px-3 py-2" style={{ borderTop: '1px solid var(--brd)' }}>
      <span className="flex-1 text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>
        Badges caméra
      </span>
      {[
        ['S', 0.016],
        ['M', 0.024],
        ['L', 0.034],
      ].map(([label, factor]) => (
        <button
          key={label}
          type="button"
          onClick={() => apply(factor)}
          className="text-[11px] font-bold w-6 h-6 rounded-md"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
          title={`Taille ${label} (relative au zoom actuel)`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/* ─── Propriétés ─────────────────────────────────────────────────────────── */

function PropsTab({ editor, selected }) {
  if (selected.length === 0) {
    return (
      <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--txt-3)' }}>
        Sélectionne un élément pour éditer ses propriétés
      </div>
    )
  }
  if (selected.length > 1) return <MultiProps editor={editor} selected={selected} />

  const shape = selected[0]
  if (shape.type === CAMERA_SHAPE_TYPE) return <CameraProps editor={editor} shape={shape} />
  if (shape.type === RAILCAM_SHAPE_TYPE || shape.type === SPIDERCAM_SHAPE_TYPE) {
    return <RiggedCamProps editor={editor} shape={shape} />
  }
  if (shape.type === ITEM_SHAPE_TYPE) return <ItemProps editor={editor} shape={shape} />
  if (shape.type === ZONE_SHAPE_TYPE) return <ZoneProps editor={editor} shape={shape} />
  if (shape.type === COTE_SHAPE_TYPE) return <CoteProps editor={editor} shape={shape} />
  if (shape.type === CABLE_SHAPE_TYPE) return <CableProps editor={editor} shape={shape} />
  return (
    <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--txt-3)' }}>
      Pas de propriétés Captiv pour cet élément ({shape.type})
    </div>
  )
}

/* ─── Édition groupée (multi-sélection) ─────────────────────────────────── */

const TYPE_LABELS = {
  [CAMERA_SHAPE_TYPE]: ['caméra', 'caméras'],
  [RAILCAM_SHAPE_TYPE]: ['caméra', 'caméras'],
  [SPIDERCAM_SHAPE_TYPE]: ['caméra', 'caméras'],
  [ITEM_SHAPE_TYPE]: ['élément', 'éléments'],
  [ZONE_SHAPE_TYPE]: ['zone', 'zones'],
  [COTE_SHAPE_TYPE]: ['cotation', 'cotations'],
  [CABLE_SHAPE_TYPE]: ['câble', 'câbles'],
}
const TYPE_LABEL_OTHER = ['autre', 'autres']

function MultiProps({ editor, selected }) {
  // Décompte lisible par famille ("3 caméras · 2 câbles · 1 zone").
  const counts = new Map()
  selected.forEach((s) => {
    const label = TYPE_LABELS[s.type] || TYPE_LABEL_OTHER
    counts.set(label, (counts.get(label) || 0) + 1)
  })
  const breakdown = [...counts.entries()]
    .map(([label, n]) => `${n} ${label[n > 1 ? 1 : 0]}`)
    .join(' · ')

  const allCams = selected.every((s) => CAM_SHAPE_TYPES.includes(s.type))
  const allBoxCams = selected.every((s) => s.type === CAMERA_SHAPE_TYPE)
  const allCables = selected.every((s) => s.type === CABLE_SHAPE_TYPE)
  const allZones = selected.every((s) => s.type === ZONE_SHAPE_TYPE)
  const allHaveCouleur = selected.every((s) => s.props.couleur !== undefined)

  // Valeur commune d'une prop (null si la sélection diverge).
  const common = (key) => {
    const v = selected[0].props[key]
    return selected.every((s) => s.props[key] === v) ? v : null
  }

  function updateAll(patch) {
    editor.run(() => {
      selected.forEach((s) =>
        editor.updateShape({
          id: s.id,
          type: s.type,
          props: typeof patch === 'function' ? patch(s) : patch,
        }),
      )
    })
  }

  // Focale groupée : le cône de chaque caméra garde SA hauteur (la largeur
  // suit l'angle de la nouvelle focale, caméra par caméra).
  function setFocaleAll(focale) {
    const angle = focaleToAngleDeg(focale)
    updateAll((s) => ({
      focale,
      w: Math.max(40, Math.round(2 * s.props.h * Math.tan(((angle / 2) * Math.PI) / 180))),
    }))
  }

  const conesOn = allBoxCams && selected.every((s) => s.props.showCone)

  return (
    <div className="py-1">
      <div className="px-3 pt-2 text-xs font-bold" style={{ color: 'var(--txt)' }}>
        {breakdown}
      </div>
      <div className="px-3 pb-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        Les modifications s’appliquent à toute la sélection.
      </div>

      {allHaveCouleur && (
        <Field label="Couleur">
          <ColorRow value={common('couleur')} onChange={(couleur) => updateAll({ couleur })} />
        </Field>
      )}

      {allCams && (
        <ModeleField
          shapeId={`multi-${selected.length}`}
          value={common('modele') || ''}
          onChange={(modele) => updateAll({ modele })}
        />
      )}

      {allBoxCams && (
        <>
          <Field label="Focale">
            <div className="flex items-center gap-1 flex-wrap">
              {FOCALES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFocaleAll(f)}
                  className="text-[11px] font-semibold px-2 py-1 rounded-md"
                  style={{
                    background: common('focale') === f ? 'var(--blue)' : 'var(--bg)',
                    color: common('focale') === f ? '#fff' : 'var(--txt-2)',
                    border: '1px solid var(--brd)',
                  }}
                >
                  {f}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Cônes de vue">
            <button
              type="button"
              onClick={() =>
                editor.run(() => {
                  selected.forEach((s) => applyCameraCone(editor, s, !conesOn))
                })
              }
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: conesOn ? 'var(--blue-bg)' : 'var(--bg)',
                color: conesOn ? 'var(--blue)' : 'var(--txt-3)',
                border: '1px solid var(--brd)',
              }}
            >
              {conesOn ? 'Affichés' : 'Masqués'}
            </button>
          </Field>
        </>
      )}

      {allCables && (
        <Field label="Type de câble">
          <select
            value={common('cableType') || ''}
            onChange={(e) => e.target.value && updateAll({ cableType: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={inputStyle}
          >
            {common('cableType') == null && <option value="">— mixte —</option>}
            {Object.entries(CABLE_TYPES).map(([key, t]) => (
              <option key={key} value={key}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {allZones && (
        <Field label="Dimensions et surface">
          <button
            type="button"
            onClick={() => updateAll({ showDims: !selected.every((s) => s.props.showDims) })}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{
              background: selected.every((s) => s.props.showDims) ? 'var(--blue-bg)' : 'var(--bg)',
              color: selected.every((s) => s.props.showDims) ? 'var(--blue)' : 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
          >
            {selected.every((s) => s.props.showDims) ? 'Affichées' : 'Masquées'}
          </button>
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="block px-3 py-2">
      <span className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-3)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

// Section repliable des Propriétés — état mémorisé par section (localStorage).
function Section({ id, label, children, defaultOpen = true }) {
  const storageKey = `plans-props-${id}`
  const [open, setOpen] = useState(() => {
    const saved = localStorage.getItem(storageKey)
    return saved == null ? defaultOpen : saved === '1'
  })
  return (
    <div style={{ borderBottom: '1px solid var(--brd)' }}>
      <button
        type="button"
        onClick={() =>
          setOpen((v) => {
            localStorage.setItem(storageKey, v ? '0' : '1')
            return !v
          })
        }
        className="w-full flex items-center gap-1.5 text-left text-[11px] font-bold px-3 py-2"
        style={{ color: 'var(--txt-2)' }}
      >
        <span style={{ color: 'var(--txt-3)' }}>{open ? '▾' : '▸'}</span>
        {label}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  )
}

// Cône d'une caméra box : à l'activation sur une caméra mobile (box compacte
// autour du badge), la box grandit vers le haut pour accueillir le cône,
// apex (position caméra) inchangé.
function applyCameraCone(editor, shape, next) {
  const { props } = shape
  const badge = props.uiScale || 30
  if (next && props.h < badge * 4) {
    const h = badge * 8
    const angle = focaleToAngleDeg(props.focale)
    const w = Math.max(40, Math.round(2 * h * Math.tan(((angle / 2) * Math.PI) / 180)))
    editor.updateShape({
      id: shape.id,
      type: shape.type,
      x: shape.x - (w - props.w) / 2,
      y: shape.y - (h - props.h),
      props: { showCone: true, h, w },
    })
    return
  }
  editor.updateShape({ id: shape.id, type: shape.type, props: { showCone: next } })
}

const inputStyle = {
  background: 'var(--bg)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

function ColorRow({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {COULEURS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className="w-5 h-5 rounded-full"
          style={{
            background: c,
            border: value === c ? '2px solid #fff' : '2px solid transparent',
          }}
          title={c}
        />
      ))}
    </div>
  )
}

// Numéro de caméra : éditable directement (re-numérotation manuelle).
function NumeroField({ shape, update }) {
  return (
    <Field label="Numéro">
      <input
        type="number"
        min="1"
        defaultValue={shape.props.numero}
        key={`${shape.id}-numero`}
        onBlur={(e) => {
          const n = Math.max(1, Math.round(Number(e.target.value) || 1))
          if (n !== shape.props.numero) update({ numero: n })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-20 text-xs px-2 py-1.5 rounded-md outline-none"
        style={inputStyle}
      />
    </Field>
  )
}

function CameraProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })

  // Focale → recalcule la largeur du cône (l'angle suit la géométrie réelle).
  function setFocale(focale) {
    const angle = focaleToAngleDeg(focale)
    const w = Math.max(40, Math.round(2 * props.h * Math.tan(((angle / 2) * Math.PI) / 180)))
    update({ focale, w })
  }

  const angleReel = Math.round((2 * Math.atan(props.w / 2 / props.h) * 180) / Math.PI)

  return (
    <div className="py-1">
      <Section id="cam-identite" label="Identité">
        <NumeroField shape={shape} update={update} />
        <Field label="Label">
          <input
            type="text"
            defaultValue={props.label}
            key={shape.id}
            placeholder={`Cam ${props.numero} / ${props.modele}`}
            onBlur={(e) => update({ label: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={inputStyle}
          />
        </Field>
        <ModeleField shapeId={shape.id} value={props.modele} onChange={(modele) => update({ modele })} />
      </Section>
      <Section id="cam-optique" label="Optique">
        <Field label={`Focale (angle réel ${angleReel}°)`}>
          <div className="flex items-center gap-1 flex-wrap">
            {FOCALES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFocale(f)}
                className="text-[11px] font-semibold px-2 py-1 rounded-md"
                style={{
                  background: props.focale === f ? 'var(--blue)' : 'var(--bg)',
                  color: props.focale === f ? '#fff' : 'var(--txt-2)',
                  border: '1px solid var(--brd)',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Cône de vue">
          <button
            type="button"
            onClick={() => applyCameraCone(editor, shape, !props.showCone)}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{
              background: props.showCone ? 'var(--blue-bg)' : 'var(--bg)',
              color: props.showCone ? 'var(--blue)' : 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
          >
            {props.showCone ? 'Affiché' : 'Masqué'}
          </button>
        </Field>
        {/* Calculateur focale intégré (capteur pré-rempli, mesure sur plan) */}
        <CameraCalcSection shape={shape} setFocale={setFocale} />
      </Section>
      <Section id="cam-apparence" label="Apparence">
        <Field label="Couleur">
          <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
        </Field>
      </Section>
    </div>
  )
}

// Modèle : presets Captiv (datalist) + saisie libre.
function ModeleField({ shapeId, value, onChange }) {
  const listId = `cam-modeles-${shapeId}`
  return (
    <Field label="Modèle">
      <input
        type="text"
        defaultValue={value}
        key={`${shapeId}-modele`}
        list={listId}
        placeholder="FX6, BURANO…"
        onBlur={(e) => onChange(e.target.value)}
        onChange={(e) => {
          // Sélection dans la datalist : applique tout de suite.
          if (CAMERA_MODELES.includes(e.target.value)) onChange(e.target.value)
        }}
        className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
        style={inputStyle}
      />
      <datalist id={listId}>
        {CAMERA_MODELES.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </Field>
  )
}

// Cable-cam / travelling / spider : pas de focale ni cône, mais label,
// modèle, couleur (+ courbe pour le travelling).
function RiggedCamProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })
  const isRail = shape.type === RAILCAM_SHAPE_TYPE

  return (
    <div className="py-1">
      <Section id="rig-identite" label="Identité">
        <NumeroField shape={shape} update={update} />
        <Field label="Label">
          <input
            type="text"
            defaultValue={props.label}
            key={shape.id}
            placeholder={`Cam ${props.numero} · ${props.support || ''}`}
            onBlur={(e) => update({ label: e.target.value })}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={inputStyle}
          />
        </Field>
        <ModeleField shapeId={shape.id} value={props.modele} onChange={(modele) => update({ modele })} />
      </Section>
      <Section id="rig-apparence" label="Apparence">
        <Field label="Couleur">
          <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
        </Field>
        {isRail && props.railKind === 'travelling' && props.points.length >= 3 && (
          <Field label="Trajectoire">
            <button
              type="button"
              onClick={() => update({ spline: !props.spline })}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: props.spline ? 'var(--blue-bg)' : 'var(--bg)',
                color: props.spline ? 'var(--blue)' : 'var(--txt-3)',
                border: '1px solid var(--brd)',
              }}
            >
              {props.spline ? 'Courbe' : 'Droite'}
            </button>
          </Field>
        )}
      </Section>
      <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        {isRail
          ? props.railKind === 'travelling'
            ? 'Glisse le « + » au milieu d’un segment pour ajouter un point ; double-clic sur un point pour le supprimer. La caméra coulisse le long du rail.'
            : 'Poignées : extrémités du câble, position de la caméra, pastille.'
          : 'Poignées : les 4 points d’accroche ; la caméra suit l’intersection.'}
      </div>
    </div>
  )
}

// Section repliable « Calcul focale » des Propriétés caméra.
function CameraCalcSection({ shape, setFocale }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="px-3 py-2" style={{ borderTop: '1px solid var(--brd)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left text-[11px] font-bold"
        style={{ color: 'var(--txt-2)' }}
      >
        {open ? '▾' : '▸'} Calcul focale
      </button>
      {open && (
        <div className="mt-2">
          <FocaleCalc
            defaultModele={shape.props.modele}
            canMeasure
            measureShapeId={shape.id}
            onApplyFocale={(f) => setFocale(f)}
          />
        </div>
      )}
    </div>
  )
}

function ItemProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })

  return (
    <div className="py-1">
      <Field label="Label">
        <input
          type="text"
          defaultValue={props.label}
          key={shape.id}
          onBlur={(e) => update({ label: e.target.value })}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        />
      </Field>
      <Field label="Couleur">
        <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
      </Field>
    </div>
  )
}

function ZoneProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })
  const mpp = pageMetersPerPx(editor)

  return (
    <div className="py-1">
      <Field label="Nom de la zone">
        <input
          type="text"
          defaultValue={props.label}
          key={shape.id}
          onBlur={(e) => update({ label: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        />
      </Field>
      <Field label="Couleur">
        <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
      </Field>
      <Field label="Dimensions et surface">
        <button
          type="button"
          onClick={() => update({ showDims: !props.showDims })}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
          style={{
            background: props.showDims ? 'var(--blue-bg)' : 'var(--bg)',
            color: props.showDims ? 'var(--blue)' : 'var(--txt-3)',
            border: '1px solid var(--brd)',
          }}
        >
          {props.showDims ? 'Affichées' : 'Masquées'}
        </button>
      </Field>
      {mpp > 0 ? (
        <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-2)' }}>
          {fmtMeters(props.w * mpp)} × {fmtMeters(props.h * mpp)} m ·{' '}
          <span className="font-semibold">{fmtMeters(props.w * mpp * props.h * mpp)} m²</span>
        </div>
      ) : (
        <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
          Définis l’échelle du plan (bouton Échelle) pour afficher les mètres.
        </div>
      )}
    </div>
  )
}

function CoteProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })
  const [a, b] = props.points
  const lenPx = Math.hypot(b.x - a.x, b.y - a.y)
  const mpp = pageMetersPerPx(editor)

  return (
    <div className="py-1">
      <Field label="Couleur">
        <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
      </Field>
      <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-2)' }}>
        {mpp > 0 ? (
          <>
            Distance : <span className="font-semibold">{fmtMeters(lenPx * mpp)} m</span>
          </>
        ) : (
          'Définis l’échelle du plan (bouton Échelle) pour afficher les mètres.'
        )}
      </div>
      <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        Poignées : les deux extrémités de la mesure.
      </div>
    </div>
  )
}

function CableProps({ editor, shape }) {
  const { props } = shape
  const update = (patch) =>
    editor.updateShape({ id: shape.id, type: shape.type, props: patch })
  const mpp = pageMetersPerPx(editor)
  const lenPx = cableLengthPx(props)

  return (
    <div className="py-1">
      <Field label="Type de câble">
        <select
          value={props.cableType}
          onChange={(e) => update({ cableType: e.target.value })}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        >
          {Object.entries(CABLE_TYPES).map(([key, t]) => (
            <option key={key} value={key}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Label (optionnel)">
        <input
          type="text"
          defaultValue={props.label}
          key={shape.id}
          placeholder="SDI CAM 2 → régie"
          onBlur={(e) => update({ label: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        />
      </Field>
      {props.points.length >= 3 && (
        <Field label="Trajectoire">
          <button
            type="button"
            onClick={() => update({ spline: !props.spline })}
            className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
            style={{
              background: props.spline ? 'var(--blue-bg)' : 'var(--bg)',
              color: props.spline ? 'var(--blue)' : 'var(--txt-3)',
              border: '1px solid var(--brd)',
            }}
          >
            {props.spline ? 'Courbe' : 'Droite'}
          </button>
        </Field>
      )}
      <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-2)' }}>
        {mpp > 0 ? (
          <>
            Longueur : <span className="font-semibold">{fmtMeters(lenPx * mpp)} m</span>
          </>
        ) : (
          'Définis l’échelle du plan (bouton Échelle) pour le métrage.'
        )}
      </div>
      <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        Glisse le « + » au milieu d’un segment pour ajouter un point ;
        double-clic sur un point pour le supprimer.
      </div>
    </div>
  )
}

/* ─── Résumé sélection (bas de panneau, onglet Layers) ──────────────────── */

function SelectionSummary({ shape }) {
  const isCam = [CAMERA_SHAPE_TYPE, RAILCAM_SHAPE_TYPE, SPIDERCAM_SHAPE_TYPE].includes(shape.type)
  if (!isCam) return null
  const { props } = shape
  const isBox = shape.type === CAMERA_SHAPE_TYPE
  const angle = isBox ? Math.round((2 * Math.atan(props.w / 2 / props.h) * 180) / Math.PI) : null
  return (
    <div className="shrink-0 px-3 py-2.5" style={{ borderTop: '1px solid var(--brd)' }}>
      <div className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--txt-3)' }}>
        Sélectionné
      </div>
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
          style={{ background: props.couleur }}
        >
          {props.numero}
        </span>
        <span className="text-xs font-bold truncate" style={{ color: 'var(--txt)' }}>
          {props.label || `Cam ${props.numero}${props.modele ? ` · ${props.modele}` : props.support ? ` · ${props.support}` : ''}`}
        </span>
      </div>
      {props.support && (
        <div className="flex justify-between text-[11px]" style={{ color: 'var(--txt-2)' }}>
          <span>Support</span>
          <span className="font-semibold">{props.support}</span>
        </div>
      )}
      {isBox && (
        <>
          <div className="flex justify-between text-[11px]" style={{ color: 'var(--txt-2)' }}>
            <span>Focale</span>
            <span className="font-semibold">{props.focale} mm</span>
          </div>
          <div className="flex justify-between text-[11px]" style={{ color: 'var(--txt-2)' }}>
            <span>Angle vue</span>
            <span className="font-semibold">{angle}°</span>
          </div>
        </>
      )}
    </div>
  )
}

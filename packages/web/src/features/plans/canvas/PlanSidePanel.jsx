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

import { useState } from 'react'
import { useValue } from 'tldraw'
import { Eye, EyeOff, Lock, LockOpen, Layers as LayersIcon } from 'lucide-react'
import { LAYERS, shapeLayer, FOCALES, focaleToAngleDeg, CAMERA_MODELES } from './shapes/catalog'
import { CAMERA_SHAPE_TYPE } from './shapes/CameraShapeUtil'
import { ITEM_SHAPE_TYPE } from './shapes/ItemShapeUtil'
import { RAILCAM_SHAPE_TYPE } from './shapes/RailCamShapeUtil'
import { SPIDERCAM_SHAPE_TYPE } from './shapes/SpiderCamShapeUtil'

const COULEURS = ['#4d9fff', '#ffce00', '#9c5ffd', '#ff5ac4', '#00c875', '#ff9f0a', '#ff4757', '#a8a8a8']

export default function PlanSidePanel({ editor }) {
  const [tab, setTab] = useState('layers')

  const selected = useValue('selection', () => editor.getSelectedShapes(), [editor])

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
        {tab === 'layers' ? <LayersTab editor={editor} /> : <PropsTab editor={editor} selected={selected} />}
      </div>

      {/* Résumé sélection (toujours visible, comme le mockup) */}
      {selected.length === 1 && tab === 'layers' && <SelectionSummary shape={selected[0]} />}
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
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        <LayersIcon className="w-3 h-3" />
        Les éléments rejoignent leur couche à la création
      </div>
    </div>
  )
}

/* ─── Propriétés ─────────────────────────────────────────────────────────── */

function PropsTab({ editor, selected }) {
  if (selected.length !== 1) {
    return (
      <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--txt-3)' }}>
        {selected.length === 0
          ? 'Sélectionne un élément pour éditer ses propriétés'
          : `${selected.length} éléments sélectionnés`}
      </div>
    )
  }

  const shape = selected[0]
  if (shape.type === CAMERA_SHAPE_TYPE) return <CameraProps editor={editor} shape={shape} />
  if (shape.type === RAILCAM_SHAPE_TYPE || shape.type === SPIDERCAM_SHAPE_TYPE) {
    return <RiggedCamProps editor={editor} shape={shape} />
  }
  if (shape.type === ITEM_SHAPE_TYPE) return <ItemProps editor={editor} shape={shape} />
  return (
    <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--txt-3)' }}>
      Pas de propriétés Captiv pour cet élément ({shape.type})
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
      <Field label="Couleur">
        <ColorRow value={props.couleur} onChange={(couleur) => update({ couleur })} />
      </Field>
      <Field label="Cône de vue">
        <button
          type="button"
          onClick={() => update({ showCone: !props.showCone })}
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

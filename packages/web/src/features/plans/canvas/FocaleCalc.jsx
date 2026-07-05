// ════════════════════════════════════════════════════════════════════════════
// FocaleCalc — calculateur focale / distance / hauteur de sujet
// ════════════════════════════════════════════════════════════════════════════
//
// Formule Hugo (triangles semblables, L >> f) : f = Y′ · L / Y
//   Y  : hauteur du sujet (m)     Y′ : hauteur du capteur (mm)
//   L  : distance du sujet (m)    f  : focale (mm)
// Trois formes : f = Y′·L/Y · L = f·Y/Y′ · Y = Y′·L/f — la formule appliquée
// est affichée en léger sous le résultat.
//
// Capteur : full frame par défaut (36 mm de large), largeur personnalisable ;
// toggle 16:9 (vidéo, Y′ = 20,25) / 3:2 (photo, Y′ = 24) bien visible.
// Si le capteur ≠ FF, l'équivalent full frame est affiché (crop = 36/larg).
//
// Utilisé en standalone (FocaleCalcModal, top bar) et intégré aux Propriétés
// d'une caméra (capteur pré-rempli, mesure de distance sur le plan via
// CustomEvents, application de la focale au cône).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, Crosshair, X } from 'lucide-react'
import { CAMERA_SENSORS, CAMERA_MODELES, SENSOR_FULL_FRAME_W } from './shapes/catalog'

const fieldStyle = { background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }

const TARGETS = [
  { key: 'focale', label: 'Focale' },
  { key: 'distance', label: 'Distance' },
  { key: 'hauteur', label: 'Hauteur sujet' },
]

function parseNum(v) {
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}

function fmt(n, decimals = 1) {
  return Number(n.toFixed(decimals)).toLocaleString('fr-FR')
}

/**
 * @param {object} props
 * @param {string}  [props.defaultModele] — pré-remplit le capteur (caméra sélectionnée)
 * @param {boolean} [props.canMeasure]   — bouton « Mesurer sur le plan » (CustomEvents)
 * @param {string}  [props.measureShapeId] — apex de cette caméra comme origine de mesure
 * @param {function} [props.onApplyFocale] — (focaleFFmm) => applique au cône
 */
export function FocaleCalc({ defaultModele = '', canMeasure = false, measureShapeId = null, onApplyFocale }) {
  const [modele, setModele] = useState(defaultModele)
  const [sensorW, setSensorW] = useState(() => CAMERA_SENSORS[defaultModele] || SENSOR_FULL_FRAME_W)
  const [ratio, setRatio] = useState('169') // '169' vidéo | '32' photo
  const [target, setTarget] = useState('focale')
  const [focale, setFocale] = useState('')
  const [distance, setDistance] = useState('')
  const [hauteur, setHauteur] = useState('')

  // Résultat de mesure sur le plan (PlanEditor → CustomEvent).
  useEffect(() => {
    if (!canMeasure) return undefined
    const onResult = (e) => {
      const meters = e.detail?.meters
      if (meters > 0) setDistance(String(Math.round(meters * 10) / 10))
    }
    window.addEventListener('captiv-plan-measure-result', onResult)
    return () => window.removeEventListener('captiv-plan-measure-result', onResult)
  }, [canMeasure])

  const sensorH = ratio === '169' ? (sensorW * 9) / 16 : (sensorW * 2) / 3
  const yPrime = sensorH // mm
  const f = parseNum(focale)
  const L = parseNum(distance)
  const Y = parseNum(hauteur)

  let result = null
  let formula = null
  if (target === 'focale' && L && Y) {
    const val = (yPrime * L) / Y
    result = { label: 'Focale', value: `${fmt(val)} mm`, raw: val }
    formula = `f = Y′ × L / Y = ${fmt(yPrime, 2)} × ${fmt(L)} / ${fmt(Y)}`
  } else if (target === 'distance' && f && Y) {
    const val = (f * Y) / yPrime
    result = { label: 'Distance', value: `${fmt(val)} m`, raw: val }
    formula = `L = f × Y / Y′ = ${fmt(f)} × ${fmt(Y)} / ${fmt(yPrime, 2)}`
  } else if (target === 'hauteur' && f && L) {
    const val = (yPrime * L) / f
    result = { label: 'Hauteur du sujet', value: `${fmt(val, 2)} m`, raw: val }
    formula = `Y = Y′ × L / f = ${fmt(yPrime, 2)} × ${fmt(L)} / ${fmt(f)}`
  }

  // Équivalent full frame quand le capteur est plus petit.
  const crop = SENSOR_FULL_FRAME_W / sensorW
  const showFFEq = Math.abs(crop - 1) > 0.01 && target === 'focale' && result

  // Angle de vue horizontal correspondant (éq. FF) + garde-fou plausibilité.
  const focaleFF = target === 'focale' && result ? result.raw * crop : null
  const angleH = focaleFF
    ? Math.round((2 * Math.atan(SENSOR_FULL_FRAME_W / (2 * focaleFF)) * 180) / Math.PI)
    : null
  const horsPlage = focaleFF != null && (focaleFF > 800 || focaleFF < 8)

  const inputs = {
    focale: (
      <label key="f" className="flex-1 min-w-0">
        <span className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--txt-3)' }}>
          Focale (mm)
        </span>
        <input type="text" inputMode="decimal" value={focale} onChange={(e) => setFocale(e.target.value)} placeholder="35" className="w-full text-xs px-2 py-1.5 rounded-md outline-none" style={fieldStyle} />
      </label>
    ),
    distance: (
      <label key="d" className="flex-1 min-w-0">
        <span className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--txt-3)' }}>
          Distance (m)
        </span>
        <div className="flex items-center gap-1">
          <input type="text" inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="10" className="w-full min-w-0 text-xs px-2 py-1.5 rounded-md outline-none" style={fieldStyle} />
          {canMeasure && (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('captiv-plan-measure', { detail: { shapeId: measureShapeId } }),
                )
              }
              className="p-1.5 rounded-md shrink-0"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--blue)' }}
              title="Mesurer sur le plan : clique le sujet (échelle requise)"
            >
              <Crosshair className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </label>
    ),
    hauteur: (
      <label key="h" className="flex-1 min-w-0">
        <span className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--txt-3)' }}>
          Hauteur sujet (m)
        </span>
        <input type="text" inputMode="decimal" value={hauteur} onChange={(e) => setHauteur(e.target.value)} placeholder="1,8" className="w-full text-xs px-2 py-1.5 rounded-md outline-none" style={fieldStyle} />
      </label>
    ),
  }

  return (
    <div className="flex flex-col gap-2.5">
      {/* Caméra (presets) — masqué quand le modèle vient de la cam sélectionnée */}
      {!defaultModele && (
        <label>
          <span className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--txt-3)' }}>
            Caméra (optionnel — pré-remplit le capteur)
          </span>
          <input
            type="text"
            value={modele}
            list="focale-calc-modeles"
            onChange={(e) => {
              setModele(e.target.value)
              if (CAMERA_SENSORS[e.target.value]) setSensorW(CAMERA_SENSORS[e.target.value])
            }}
            placeholder="FX6, BURANO…"
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={fieldStyle}
          />
          <datalist id="focale-calc-modeles">
            {CAMERA_MODELES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      )}

      {/* Capteur */}
      <div className="flex items-end gap-2">
        <label className="flex-1 min-w-0">
          <span className="block text-[10px] font-semibold mb-0.5" style={{ color: 'var(--txt-3)' }}>
            Largeur capteur (mm){defaultModele ? ` — ${defaultModele}` : ''}
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={sensorW}
            onChange={(e) => setSensorW(parseNum(e.target.value) || SENSOR_FULL_FRAME_W)}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={fieldStyle}
          />
        </label>
        {/* Toggle ratio bien visible */}
        <div className="flex rounded-md overflow-hidden shrink-0" style={{ border: '1px solid var(--brd)' }}>
          {[
            ['169', '16:9'],
            ['32', '3:2'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRatio(key)}
              className="text-[11px] font-bold px-2.5 py-1.5"
              style={{
                background: ratio === key ? 'var(--blue)' : 'var(--bg)',
                color: ratio === key ? '#fff' : 'var(--txt-3)',
              }}
              title={key === '169' ? 'Vidéo 16:9 — hauteur capteur dérivée' : 'Photo 3:2'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="text-[10px] -mt-1.5" style={{ color: 'var(--txt-3)' }}>
        Hauteur capteur Y′ = {fmt(yPrime, 2)} mm ({ratio === '169' ? 'vidéo 16:9' : 'photo 3:2'})
      </div>

      {/* Cible du calcul */}
      <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
        {TARGETS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTarget(t.key)}
            className="flex-1 text-[11px] font-semibold py-1.5"
            style={{
              background: target === t.key ? 'var(--blue-bg)' : 'var(--bg)',
              color: target === t.key ? 'var(--blue)' : 'var(--txt-3)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Les deux entrées nécessaires */}
      <div className="flex gap-2">{TARGETS.filter((t) => t.key !== target).map((t) => inputs[t.key])}</div>

      {/* Résultat */}
      {result ? (
        <div className="rounded-lg px-3 py-2" style={{ background: 'var(--blue-bg)', border: '1px solid var(--brd)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
              {result.label}
            </span>
            <span className="text-sm font-bold" style={{ color: 'var(--blue)' }}>
              {result.value}
            </span>
          </div>
          {showFFEq && (
            <div className="text-[10px] text-right" style={{ color: 'var(--txt-2)' }}>
              ≈ {fmt(result.raw * crop)} mm éq. full frame (crop ×{fmt(crop, 2)})
            </div>
          )}
          {angleH != null && (
            <div className="text-[10px] text-right" style={{ color: 'var(--txt-2)' }}>
              Angle de vue horizontal ≈ {angleH}°
            </div>
          )}
          {/* Formule appliquée, en léger */}
          <div className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
            {formula}
          </div>
          {horsPlage && (
            <div className="text-[10px] mt-1 font-semibold" style={{ color: 'var(--orange, #ff9f0a)' }}>
              Hors plage des optiques courantes — vérifie la distance et la
              hauteur du sujet (cadres-tu vraiment {hauteur || '?'} m à {distance || '?'} m ?).
            </div>
          )}
          {target === 'focale' && onApplyFocale && (
            <button
              type="button"
              onClick={() => onApplyFocale(Math.round(result.raw * crop))}
              className="mt-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--blue)', color: '#fff' }}
              title="Règle le cône de vue de la caméra sur cette focale (éq. FF)"
            >
              Appliquer au cône de vue
            </button>
          )}
        </div>
      ) : (
        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          Renseigne les deux valeurs pour calculer {TARGETS.find((t) => t.key === target)?.label.toLowerCase()}.
        </div>
      )}
    </div>
  )
}

/* ─── Modale standalone (top bar) ───────────────────────────────────────── */

export function FocaleCalcModal({ onClose }) {
  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-xl p-5"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Calculator className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Calcul focale
            </h2>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <FocaleCalc />
      </div>
    </div>,
    document.body,
  )
}

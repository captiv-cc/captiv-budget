// ════════════════════════════════════════════════════════════════════════════
// NomenclatureModal — liste de matériel dérivée du plan
// ════════════════════════════════════════════════════════════════════════════
//
// Le plan devient un document de production : caméras (n°, support, modèle,
// focale), éléments par type et quantité, zones (dimensions/surface), câbles
// par type avec métrage + marge configurable (les câbles ne volent pas en
// ligne droite). Export CSV.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Download, X } from 'lucide-react'
import { CABLE_TYPES } from './shapes/catalog'
import { CAM_SHAPE_TYPES } from './shapes/camUtils'
import { CAMERA_SHAPE_TYPE } from './shapes/CameraShapeUtil'
import { ZONE_SHAPE_TYPE } from './shapes/ZoneShapeUtil'
import { CABLE_SHAPE_TYPE, cableLengthPx } from './shapes/CableShapeUtil'
import { fmtMeters, pageMetersPerPx } from './shapes/scale'

function buildNomenclature(editor, margePct) {
  const records = editor.store.allRecords()
  const mpp = pageMetersPerPx(editor)
  const cams = []
  const items = new Map()
  const zones = []
  const cables = new Map()

  records.forEach((r) => {
    if (r.typeName !== 'shape') return
    if (CAM_SHAPE_TYPES.includes(r.type)) {
      cams.push({
        numero: r.props.numero || 0,
        support: r.props.support || 'Caméra',
        modele: r.props.modele || '',
        // Plage "19-90" pour un zoom, valeur simple sinon.
        focale:
          r.type === CAMERA_SHAPE_TYPE
            ? r.props.focaleMax
              ? `${r.props.focale}-${r.props.focaleMax}`
              : String(r.props.focale)
            : null,
        optique: r.props.optique || '',
        remarques: r.props.remarques || '',
      })
    } else if (r.type === 'captiv-item') {
      const key = r.props.label || 'Élément'
      items.set(key, (items.get(key) || 0) + 1)
    } else if (r.type === ZONE_SHAPE_TYPE) {
      zones.push({
        label: r.props.label || 'Zone',
        dims: mpp > 0 ? `${fmtMeters(r.props.w * mpp)} × ${fmtMeters(r.props.h * mpp)} m` : null,
        surface: mpp > 0 ? `${fmtMeters(r.props.w * mpp * r.props.h * mpp)} m²` : null,
      })
    } else if (r.type === CABLE_SHAPE_TYPE) {
      const key = r.props.cableType || 'autre'
      const g = cables.get(key) || { count: 0, lenPx: 0 }
      g.count += 1
      g.lenPx += cableLengthPx(r.props)
      cables.set(key, g)
    }
  })

  cams.sort((a, b) => a.numero - b.numero)
  const cablesRows = [...cables.entries()].map(([key, g]) => {
    const type = CABLE_TYPES[key] || CABLE_TYPES.autre
    const meters = mpp > 0 ? g.lenPx * mpp : null
    return {
      label: type.label,
      color: type.color,
      count: g.count,
      meters,
      metersMarge: meters != null ? meters * (1 + margePct / 100) : null,
    }
  })
  return {
    mpp,
    cams,
    items: [...items.entries()].map(([label, count]) => ({ label, count })),
    zones,
    cables: cablesRows,
  }
}

function toCsv(nom, margePct) {
  const lines = []
  const push = (cells) => lines.push(cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';'))
  push(['CAMÉRAS'])
  push(['N°', 'Support', 'Modèle', 'Focale (mm)', 'Optique', 'Remarques'])
  nom.cams.forEach((c) => push([c.numero, c.support, c.modele, c.focale ?? '', c.optique, c.remarques]))
  push([])
  push(['ÉLÉMENTS'])
  push(['Élément', 'Quantité'])
  nom.items.forEach((i) => push([i.label, i.count]))
  push([])
  push(['ZONES'])
  push(['Zone', 'Dimensions', 'Surface'])
  nom.zones.forEach((z) => push([z.label, z.dims ?? '', z.surface ?? '']))
  push([])
  push(['CÂBLES'])
  push(['Type', 'Nombre', 'Métrage (m)', `Métrage +${margePct}% (m)`])
  nom.cables.forEach((c) =>
    push([c.label, c.count, c.meters != null ? c.meters.toFixed(1) : '', c.metersMarge != null ? c.metersMarge.toFixed(1) : '']),
  )
  return lines.join('\n')
}

const th = { color: 'var(--txt-3)' }
const td = { color: 'var(--txt-2)' }

export default function NomenclatureModal({ editor, canvas, onClose }) {
  const [margePct, setMargePct] = useState(10)
  const nom = useMemo(() => buildNomenclature(editor, margePct), [editor, margePct])

  function exportCsv() {
    const csv = toCsv(nom, margePct)
    // BOM UTF-8 en tête : Excel ouvre le CSV correctement accentué.
    const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `nomenclature-${(canvas?.titre || 'plan').replace(/[^a-zA-Z0-9À-ÿ ._-]/g, '').trim()}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', maxHeight: '85vh' }}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--blue-bg)' }}>
            <ClipboardList className="w-4.5 h-4.5" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Nomenclature
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
              Dérivée du contenu du plan{nom.mpp ? '' : ' — définis l’échelle pour les métrages'}.
            </p>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md shrink-0"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto flex flex-col gap-4 text-xs">
          {/* Caméras */}
          {nom.cams.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={th}>
                Caméras ({nom.cams.length})
              </h3>
              <table className="w-full">
                <thead>
                  <tr className="text-left text-[10px]" style={th}>
                    <th className="py-1 pr-2 font-semibold">N°</th>
                    <th className="py-1 pr-2 font-semibold">Support</th>
                    <th className="py-1 pr-2 font-semibold">Modèle</th>
                    <th className="py-1 pr-2 font-semibold">Focale</th>
                    <th className="py-1 pr-2 font-semibold">Optique</th>
                    <th className="py-1 font-semibold">Remarques</th>
                  </tr>
                </thead>
                <tbody>
                  {nom.cams.map((c, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--brd)' }}>
                      <td className="py-1 pr-2 font-bold" style={{ color: 'var(--txt)' }}>{c.numero}</td>
                      <td className="py-1 pr-2" style={td}>{c.support}</td>
                      <td className="py-1 pr-2" style={td}>{c.modele || '·'}</td>
                      <td className="py-1 pr-2" style={td}>{c.focale ? `${c.focale} mm` : '·'}</td>
                      <td className="py-1 pr-2" style={td} title={c.optique}>{c.optique || '·'}</td>
                      <td className="py-1" style={td} title={c.remarques}>{c.remarques || '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Éléments */}
          {nom.items.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={th}>
                Éléments
              </h3>
              <div className="grid grid-cols-2 gap-x-6">
                {nom.items.map((i) => (
                  <div key={i.label} className="flex justify-between py-1" style={{ borderTop: '1px solid var(--brd)' }}>
                    <span style={td}>{i.label}</span>
                    <span className="font-bold" style={{ color: 'var(--txt)' }}>×{i.count}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Zones */}
          {nom.zones.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={th}>
                Zones
              </h3>
              {nom.zones.map((z, i) => (
                <div key={i} className="flex justify-between py-1" style={{ borderTop: '1px solid var(--brd)' }}>
                  <span style={td}>{z.label}</span>
                  <span style={td}>{z.dims ? `${z.dims} · ${z.surface}` : '·'}</span>
                </div>
              ))}
            </section>
          )}

          {/* Câbles */}
          {nom.cables.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="flex-1 text-[10px] font-bold uppercase tracking-widest" style={th}>
                  Câbles
                </h3>
                <label className="flex items-center gap-1.5 text-[11px]" style={th}>
                  Marge
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={margePct}
                    onChange={(e) => setMargePct(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                    className="w-14 text-xs px-1.5 py-1 rounded-md outline-none text-right"
                    style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
                  />
                  %
                </label>
              </div>
              {nom.cables.map((c) => (
                <div key={c.label} className="flex items-center gap-2 py-1" style={{ borderTop: '1px solid var(--brd)' }}>
                  <span className="w-3.5 h-[3px] rounded-full shrink-0" style={{ background: c.color }} />
                  <span className="flex-1" style={td}>
                    {c.label} <span style={th}>×{c.count}</span>
                  </span>
                  {c.meters != null && (
                    <span style={td}>
                      {fmtMeters(c.meters)} m
                      <span className="font-bold" style={{ color: 'var(--txt)' }}>
                        {' '}
                        → {fmtMeters(c.metersMarge)} m
                      </span>
                    </span>
                  )}
                </div>
              ))}
            </section>
          )}

          {nom.cams.length === 0 && nom.items.length === 0 && nom.cables.length === 0 && (
            <div className="text-center py-8" style={th}>
              Le plan est vide — pose des caméras, éléments et câbles pour
              générer la nomenclature.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

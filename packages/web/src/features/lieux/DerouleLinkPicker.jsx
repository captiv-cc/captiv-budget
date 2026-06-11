// ════════════════════════════════════════════════════════════════════════════
// DerouleLinkPicker — lier un POI au déroulé
// ════════════════════════════════════════════════════════════════════════════
//
// Deux façons de lier (indépendantes, toutes optionnelles) :
//   • Scène / lieu (transversal) : une lane par NOM, toutes journées confondues
//     (une scène = N lanes, une par jour). → couvre tous les jours d'un coup.
//   • Jour → Créneau (précis)    : un événement précis d'une journée donnée.
//
// value = { deroule_id, lane_id, creneau_id } (tous nullable).
// Le lane_id stocké est un représentant (1 instance) ; la résolution mobile
// matche par libellé de lane pour couvrir tous les jours.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  fetchProjectDeroules,
  fetchProjectLanes,
  fetchDerouleComplet,
  formatMinHHMM,
  defaultLaneLibelle,
} from '../../lib/deroule'

const selStyle = {
  background: 'var(--bg)',
  color: 'var(--txt)',
  border: '1px solid var(--brd)',
}

// Types de lanes pertinents comme "lieu" (on exclut les cadreurs perso/global).
const PLACE_LANE_TYPES = new Set(['lieu', 'equipe'])

function formatJour(dateStr) {
  if (!dateStr) return ''
  const [, m, d] = dateStr.split('-')
  return `${d}/${m}`
}

export default function DerouleLinkPicker({ projectId, value, onChange }) {
  const v = value || {}
  const [deroules, setDeroules] = useState([])
  const [lanes, setLanes] = useState([])
  const [detail, setDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.all([fetchProjectDeroules(projectId), fetchProjectLanes(projectId)])
      .then(([ds, ls]) => {
        if (!alive) return
        setDeroules(ds)
        setLanes(ls)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [projectId])

  useEffect(() => {
    let alive = true
    if (!v.deroule_id) { setDetail(null); return }
    setLoadingDetail(true)
    fetchDerouleComplet(v.deroule_id)
      .then((d) => { if (alive) setDetail(d) })
      .catch(() => {})
      .finally(() => { if (alive) setLoadingDetail(false) })
    return () => { alive = false }
  }, [v.deroule_id])

  // Lanes "lieu" dédupliquées par libellé (1 représentant), triées.
  const { laneByLibelle, laneById } = useMemo(() => {
    const byLibelle = new Map()
    const byId = new Map()
    for (const l of lanes) {
      byId.set(l.id, l)
      if (!PLACE_LANE_TYPES.has(l.type)) continue
      const lib = l.libelle || defaultLaneLibelle(l.sort_order)
      if (!byLibelle.has(lib)) byLibelle.set(lib, l)
    }
    return { laneByLibelle: byLibelle, laneById: byId }
  }, [lanes])

  const laneLibelleOptions = useMemo(
    () => [...laneByLibelle.keys()].sort((a, b) => a.localeCompare(b, 'fr')),
    [laneByLibelle],
  )

  // Libellé de la lane actuellement liée (résolu depuis lane_id stocké).
  const selectedLaneLibelle = v.lane_id
    ? (laneById.get(v.lane_id)?.libelle ?? '') || (laneById.get(v.lane_id) ? defaultLaneLibelle(laneById.get(v.lane_id).sort_order) : '')
    : ''

  const creneaux = detail?.creneaux || []

  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold" style={{ color: 'var(--txt-3)' }}>
        Lier au déroulé (optionnel)
      </label>

      {/* Scène / lieu — transversal (tous les jours) */}
      <div className="space-y-1">
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>Scène / lieu (tous les jours)</span>
        <select
          value={selectedLaneLibelle}
          onChange={(e) => {
            const lib = e.target.value
            const rep = lib ? laneByLibelle.get(lib) : null
            onChange({ ...v, lane_id: rep?.id || null })
          }}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={selStyle}
        >
          <option value="">— Aucune —</option>
          {laneLibelleOptions.map((lib) => (
            <option key={lib} value={lib}>{lib}</option>
          ))}
        </select>
      </div>

      {/* Jour → Créneau — précis */}
      <div className="space-y-1">
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>Événement précis (un jour)</span>
        <select
          value={v.deroule_id || ''}
          onChange={(e) => onChange({ ...v, deroule_id: e.target.value || null, creneau_id: null })}
          className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
          style={selStyle}
        >
          <option value="">— Jour —</option>
          {deroules.map((d) => (
            <option key={d.id} value={d.id}>
              {formatJour(d.date_jour)}{d.titre ? ` · ${d.titre}` : ''}
            </option>
          ))}
        </select>

        {v.deroule_id && (
          <select
            value={v.creneau_id || ''}
            onChange={(e) => onChange({ ...v, creneau_id: e.target.value || null })}
            disabled={loadingDetail}
            className="w-full text-xs px-2 py-1.5 rounded-md outline-none"
            style={selStyle}
          >
            <option value="">— Créneau —</option>
            {creneaux.map((c) => (
              <option key={c.id} value={c.id}>
                {formatMinHHMM(c.heure_debut_min)} · {c.titre || c.type || 'Créneau'}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

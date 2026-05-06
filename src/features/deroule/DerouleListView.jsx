// ════════════════════════════════════════════════════════════════════════════
// DerouleListView — Vue liste compacte (mobile + alternative desktop)
// ════════════════════════════════════════════════════════════════════════════
//
// Tableau scrollable trié chrono : Heure | Durée | Lane | Titre | Lieu | Équipe
// Tap sur une ligne → ouvre l'inspecteur (read ou edit selon canEdit).
// Pas de drag/drop — saisie via formulaire seulement (Phase B → C).
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  effectiveCouleurCreneau,
  sortCreneauxByTime,
  creneauDureeMin,
  formatMinHHMM,
} from '../../lib/deroule'

export default function DerouleListView({
  lanes,
  creneaux,
  membres,
  conflictsByCreneau,
  onSelectCreneau,
}) {
  const laneById = useMemo(() => {
    const m = new Map()
    for (const l of lanes || []) m.set(l.id, l)
    return m
  }, [lanes])

  const membreById = useMemo(() => {
    const m = new Map()
    for (const x of membres || []) {
      const prenom = x.prenom || x.contact?.prenom || ''
      const nom = x.nom || x.contact?.nom || ''
      const fullName = `${prenom} ${nom}`.trim() || '—'
      const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
      m.set(x.id, { fullName, ini })
    }
    return m
  }, [membres])

  const sorted = useMemo(() => sortCreneauxByTime(creneaux || []), [creneaux])

  if (sorted.length === 0) {
    return (
      <div
        className="rounded-lg p-8 text-center text-sm"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          color: 'var(--txt-3)',
        }}
      >
        Aucun créneau planifié sur cette journée.
      </div>
    )
  }

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <table className="w-full text-xs">
        <thead style={{ background: 'var(--bg-elev)' }}>
          <tr>
            <Th width="80px">Heure</Th>
            <Th width="60px" hidden="sm">Durée</Th>
            <Th width="100px">Lane</Th>
            <Th>Titre</Th>
            <Th width="120px" hidden="sm">Lieu</Th>
            <Th width="100px" hidden="sm">Équipe</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const color = effectiveCouleurCreneau(c)
            const lane = c.multi_lane ? null : laneById.get(c.lane_id)
            const dureeMin = creneauDureeMin(c)
            const dureeStr = dureeMin >= 60
              ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
              : `${dureeMin}min`
            // Phase D — conflits d'assignation
            const conflicts = conflictsByCreneau?.get?.(c.id) || []
            const hasConflict = conflicts.length > 0
            return (
              <tr
                key={c.id}
                onClick={() => onSelectCreneau?.(c)}
                className="cursor-pointer transition-colors"
                style={{
                  borderBottom: '1px solid var(--brd-sub)',
                  opacity: c.statut === 'annule' ? 0.5 : 1,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <td className="px-3 py-2 align-middle whitespace-nowrap font-medium" style={{ color: 'var(--txt)' }}>
                  {formatMinHHMM(c.heure_debut_min)} – {formatMinHHMM(c.heure_fin_min)}
                </td>
                <td className="px-3 py-2 align-middle hidden sm:table-cell" style={{ color: 'var(--txt-3)' }}>
                  {dureeStr}
                </td>
                <td className="px-3 py-2 align-middle">
                  <span
                    className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
                    style={{
                      background: c.multi_lane ? 'rgba(136,135,128,0.2)' : `${color}22`,
                      color: c.multi_lane ? 'var(--txt-2)' : color,
                    }}
                  >
                    {c.multi_lane ? '↔ Multi' : (lane?.libelle || '—')}
                  </span>
                </td>
                <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt)' }}>
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full mr-2"
                    style={{ background: color }}
                  />
                  {hasConflict && (
                    <AlertTriangle
                      className="inline-block mr-1.5"
                      style={{
                        width: 12,
                        height: 12,
                        color: '#E24B4A',
                        verticalAlign: '-2px',
                      }}
                    />
                  )}
                  <span style={{ textDecoration: c.statut === 'annule' ? 'line-through' : 'none' }}>
                    {c.titre || '(sans titre)'}
                  </span>
                </td>
                <td className="px-3 py-2 align-middle hidden sm:table-cell" style={{ color: 'var(--txt-3)' }}>
                  {c.lieu_text || '—'}
                </td>
                <td className="px-3 py-2 align-middle hidden sm:table-cell">
                  {c.member_ids && c.member_ids.length > 0 ? (
                    <div className="flex gap-0.5">
                      {c.member_ids.slice(0, 3).map((mid) => {
                        const m = membreById.get(mid)
                        return (
                          <div
                            key={mid}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: '50%',
                              background: `${color}33`,
                              color,
                              fontSize: 9,
                              fontWeight: 500,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            title={m?.fullName || ''}
                          >
                            {m?.ini || '?'}
                          </div>
                        )
                      })}
                      {c.member_ids.length > 3 && (
                        <div
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            background: 'var(--bg-elev)',
                            color: 'var(--txt-3)',
                            fontSize: 9,
                            fontWeight: 500,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          +{c.member_ids.length - 3}
                        </div>
                      )}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--txt-3)' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Th({ children, width, hidden }) {
  const className = hidden === 'sm' ? 'hidden sm:table-cell' : ''
  return (
    <th
      className={`${className} px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider`}
      style={{
        color: 'var(--txt-2)',
        ...(width ? { width } : {}),
      }}
    >
      {children}
    </th>
  )
}

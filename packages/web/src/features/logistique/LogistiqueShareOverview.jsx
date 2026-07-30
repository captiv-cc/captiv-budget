// ════════════════════════════════════════════════════════════════════════════
// LogistiqueShareOverview — grille lecture seule de la page publique (P4)
// ════════════════════════════════════════════════════════════════════════════
//
// La « vision d'ensemble » en première page du partage équipe : personnes ×
// jours avec présence (couleur de session), repas M/S, nuit et trajets —
// même langage visuel que la grille interne, sans aucune édition.
// Totaux par jour en pied (présents, repas midi/soir, nuits).
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import { Bus, Car, Moon, Plane, PlaneLanding, PlaneTakeoff, Train, TramFront } from 'lucide-react'
import { effectiveCouleur } from '../../lib/sessions'
import { membreDisplayName, membrePosteLabel } from './logistiqueSynthese'

const MODE_ICONS = {
  train: Train,
  minibus: Bus,
  voiture: Car,
  avion: Plane,
  autre: TramFront,
}

const REPAS_STYLE = {
  client: { bg: 'rgba(34,197,94,0.18)', color: '#22c55e', label: 'C' },
  production: { bg: 'rgba(59,130,246,0.18)', color: '#3b82f6', label: 'P' },
  defraye: { bg: 'rgba(245,158,11,0.18)', color: '#f59e0b', label: 'D' },
}

function isoRange(minIso, maxIso) {
  const out = []
  const d = new Date(`${minIso}T12:00:00`)
  const end = new Date(`${maxIso}T12:00:00`)
  while (d <= end && out.length < 60) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 1)
  }
  return out
}

function dayHeader(iso) {
  const d = new Date(`${iso}T12:00:00`)
  const wd = d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')
  return {
    wd: wd.charAt(0).toUpperCase() + wd.slice(1),
    dm: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
  }
}

export default function LogistiqueShareOverview({ techRows = [], participations = [], logi }) {
  const partsByMembre = useMemo(() => {
    const map = new Map()
    for (const p of participations) {
      const arr = map.get(p.membre_id) || []
      arr.push(p)
      map.set(p.membre_id, arr)
    }
    return map
  }, [participations])

  const repasMap = useMemo(() => {
    const map = new Map()
    for (const r of logi.repas) map.set(`${r.membre_id}|${r.date_repas}|${r.service}`, r.statut)
    return map
  }, [logi.repas])

  const nuitMap = useMemo(() => {
    const map = new Map()
    for (const n of logi.nuits) map.set(`${n.membre_id}|${n.date_nuit}`, n)
    return map
  }, [logi.nuits])

  const trajetsByMembreDay = useMemo(() => {
    const map = new Map()
    for (const t of logi.trajets) {
      if (!t.date_trajet) continue
      const key = `${t.membre_id}|${t.date_trajet}`
      const arr = map.get(key) || []
      arr.push(t)
      map.set(key, arr)
    }
    return map
  }, [logi.trajets])

  const days = useMemo(() => {
    const all = new Set()
    for (const p of participations) {
      for (const d of p.presence_days || []) all.add(d)
      if (p.arrival_date) all.add(p.arrival_date)
      if (p.departure_date) all.add(p.departure_date)
    }
    for (const t of logi.trajets) if (t.date_trajet) all.add(t.date_trajet)
    if (!all.size) return []
    const sorted = Array.from(all).sort()
    return isoRange(sorted[0], sorted[sorted.length - 1])
  }, [participations, logi.trajets])

  // Personnes avec au moins une donnée (présence / repas / nuit / trajet).
  const rows = useMemo(
    () =>
      techRows.filter((m) => {
        const parts = partsByMembre.get(m.id) || []
        if (parts.some((p) => (p.presence_days || []).length)) return true
        if (logi.repas.some((r) => r.membre_id === m.id)) return true
        if (logi.nuits.some((n) => n.membre_id === m.id)) return true
        if (logi.trajets.some((t) => t.membre_id === m.id)) return true
        return false
      }),
    [techRows, partsByMembre, logi],
  )

  const totals = useMemo(() => {
    const byDay = new Map()
    for (const d of days) byDay.set(d, { presents: 0, midi: 0, soir: 0, nuits: 0 })
    for (const p of participations) {
      for (const d of p.presence_days || []) {
        const t = byDay.get(d)
        if (t) t.presents += 1
      }
    }
    for (const r of logi.repas) {
      const t = byDay.get(r.date_repas)
      if (t) t[r.service] += 1
    }
    for (const n of logi.nuits) {
      const t = byDay.get(n.date_nuit)
      if (t) t.nuits += 1
    }
    return byDay
  }, [days, participations, logi.repas, logi.nuits])

  if (!days.length || !rows.length) return null

  return (
    <div
      className="overflow-x-auto rounded-xl"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th
              className="sticky left-0 z-10 px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
                letterSpacing: '0.08em',
                minWidth: '160px',
                borderBottom: '1px solid var(--brd)',
                borderRight: '1px solid var(--brd)',
              }}
            >
              Personne
            </th>
            {days.map((d, di) => {
              const h = dayHeader(d)
              return (
                <th
                  key={d}
                  className="px-1 py-1.5 text-center"
                  style={{
                    minWidth: '76px',
                    background: di % 2 ? 'var(--bg-hov, var(--bg-elev))' : 'var(--bg-elev)',
                    borderBottom: '1px solid var(--brd)',
                    borderRight: '1px solid var(--brd-sub)',
                  }}
                >
                  <span className="block text-[10px] font-bold uppercase" style={{ color: 'var(--txt-2)' }}>
                    {h.wd}
                  </span>
                  <span className="block text-[10px]" style={{ color: 'var(--txt-3)' }}>
                    {h.dm}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const parts = partsByMembre.get(m.id) || []
            const presence = new Map()
            for (const p of parts) {
              const hex = `#${effectiveCouleur({ couleur: p.couleur, sort_order: p.sort_order }).replace('#', '')}`
              for (const d of p.presence_days || []) presence.set(d, hex)
            }
            return (
              <tr key={m.id}>
                <td
                  className="sticky left-0 z-10 px-3 py-1"
                  style={{
                    background: 'var(--bg-surf)',
                    borderBottom: '1px solid var(--brd-sub)',
                    borderRight: '1px solid var(--brd)',
                  }}
                >
                  <span className="block text-xs font-semibold truncate max-w-[150px]" style={{ color: 'var(--txt)' }}>
                    {membreDisplayName(m)}
                  </span>
                  {membrePosteLabel(m) && (
                    <span className="block text-[10px] truncate max-w-[150px]" style={{ color: 'var(--txt-3)' }}>
                      {membrePosteLabel(m)}
                    </span>
                  )}
                </td>
                {days.map((d, di) => {
                  const color = presence.get(d)
                  const trajets = trajetsByMembreDay.get(`${m.id}|${d}`) || []
                  const midi = repasMap.get(`${m.id}|${d}|midi`)
                  const soir = repasMap.get(`${m.id}|${d}|soir`)
                  const nuit = nuitMap.get(`${m.id}|${d}`)
                  const arrival = parts.find((p) => p.arrival_date === d)
                  const depart = parts.find((p) => p.departure_date === d)
                  return (
                    <td
                      key={d}
                      className="px-1 py-1 align-top"
                      style={{
                        borderBottom: '1px solid var(--brd-sub)',
                        borderRight: '1px solid var(--brd-sub)',
                        background: color
                          ? `${color}0d`
                          : di % 2
                            ? 'rgba(127,127,127,0.045)'
                            : 'transparent',
                      }}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-0.5">
                          {color && (
                            <span
                              className="w-4 h-4 rounded-sm shrink-0 flex items-center justify-center text-[9px] font-bold"
                              style={{ background: color, color: '#fff' }}
                            >
                              X
                            </span>
                          )}
                          {trajets.map((t) => {
                            const etapes = Array.isArray(t.etapes) ? t.etapes : []
                            const first = etapes[0] || {}
                            const last = etapes[etapes.length - 1] || {}
                            const Icon = MODE_ICONS[first.mode] || TramFront
                            return (
                              <span
                                key={t.id}
                                className="inline-flex items-center gap-0.5 h-4 px-1 rounded-sm text-[9px] font-semibold shrink-0"
                                style={{
                                  background: 'rgba(59,130,246,0.14)',
                                  color: '#60a5fa',
                                  border: '1px solid rgba(59,130,246,0.35)',
                                }}
                                title={etapes
                                  .map((e) => `${e.mode || ''} ${e.heure || ''} ${e.depart || ''}→${e.heure_arrivee || ''} ${e.arrivee || ''}`)
                                  .join(' + ')}
                              >
                                {t.sens === 'retour' ? '←' : '→'}
                                <Icon className="w-2.5 h-2.5" />
                                {first.heure || ''}
                                {last.heure_arrivee ? `▸${last.heure_arrivee}` : ''}
                              </span>
                            )
                          })}
                          {arrival && !trajets.some((t) => t.sens === 'aller') && (
                            <span
                              className="inline-flex items-center gap-0.5 h-4 px-1 rounded-sm text-[9px] font-semibold shrink-0"
                              style={{
                                background: 'rgba(167,139,250,0.16)',
                                color: '#a78bfa',
                                border: '1px solid rgba(167,139,250,0.4)',
                              }}
                              title="Arrivée"
                            >
                              <PlaneLanding className="w-2.5 h-2.5" />
                              {arrival.arrival_time || ''}
                            </span>
                          )}
                          {depart && !trajets.some((t) => t.sens === 'retour') && (
                            <span
                              className="inline-flex items-center gap-0.5 h-4 px-1 rounded-sm text-[9px] font-semibold shrink-0"
                              style={{
                                background: 'rgba(167,139,250,0.16)',
                                color: '#a78bfa',
                                border: '1px solid rgba(167,139,250,0.4)',
                              }}
                              title="Retour"
                            >
                              <PlaneTakeoff className="w-2.5 h-2.5" />
                              {depart.departure_time || ''}
                            </span>
                          )}
                        </div>
                        {(midi || soir || nuit) && (
                          <div className="flex items-center gap-0.5">
                            {midi && <RepasBadge service="M" statut={midi} />}
                            {soir && <RepasBadge service="S" statut={soir} />}
                            {nuit && (
                              <span
                                className="w-4 h-4 rounded-sm shrink-0 flex items-center justify-center"
                                style={{
                                  background: 'rgba(167,139,250,0.22)',
                                  border: '1px solid rgba(167,139,250,0.5)',
                                }}
                                title="Nuit sur place"
                              >
                                <Moon className="w-2.5 h-2.5" style={{ color: '#a78bfa' }} />
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          {[
            ['Présents', (t) => t.presents || ''],
            ['Repas midi', (t) => t.midi || ''],
            ['Repas soir', (t) => t.soir || ''],
            ['Nuits', (t) => t.nuits || ''],
          ].map(([label, get]) => (
            <tr key={label}>
              <td
                className="sticky left-0 z-10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  letterSpacing: '0.08em',
                  borderTop: '1px solid var(--brd)',
                  borderRight: '1px solid var(--brd)',
                }}
              >
                {label}
              </td>
              {days.map((d, di) => (
                <td
                  key={d}
                  className="px-1 py-1.5 text-center font-bold tabular-nums"
                  style={{
                    color: 'var(--txt)',
                    borderTop: '1px solid var(--brd)',
                    borderRight: '1px solid var(--brd-sub)',
                    background: di % 2 ? 'rgba(127,127,127,0.045)' : 'transparent',
                  }}
                >
                  {get(totals.get(d))}
                </td>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  )
}

function RepasBadge({ service, statut }) {
  const s = REPAS_STYLE[statut]
  if (!s) return null
  return (
    <span
      className="h-4 min-w-[18px] px-0.5 rounded-sm text-[9px] font-bold flex items-center justify-center"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}44` }}
      title={`Repas ${service === 'M' ? 'midi' : 'soir'} · ${statut}`}
    >
      {service}·{s.label}
    </span>
  )
}

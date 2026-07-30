// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSyntheseSections — rendu des sections de synthèse (P3/P4)
// ════════════════════════════════════════════════════════════════════════════
//
// PRÉSENTATIONNEL pur : reçoit `synthese` (computeSynthese) et rend Repas
// (transposé, jours en colonnes), Hébergements (nuits + rooming) et
// Arrivées & départs. Partagé entre la vue interne (LogistiqueSyntheseView)
// et la page publique token (ProjectShareLogistiqueV0Session).
// ════════════════════════════════════════════════════════════════════════════

import {
  BedDouble,
  Coffee,
  PlaneLanding,
  PlaneTakeoff,
  UtensilsCrossed,
} from 'lucide-react'
import {
  membreDisplayName,
  membrePosteLabel,
  frDay,
  frDayShort,
} from './logistiqueSynthese'

const STATUT_COLORS = {
  client: '#22c55e',
  production: '#3b82f6',
  defraye: '#f59e0b',
}

export default function LogistiqueSyntheseSections({ synthese, showNuitsSansHebNote = true }) {
  const { repasParJour, totauxRepas, hebs, nuitsSansHeb, mouvements } = synthese

  return (
    <>
      {/* ── Repas — transposé, colonnes dynamiques ─────────────────────── */}
      {repasParJour.length > 0 &&
        (() => {
          const services = ['midi', 'soir']
            .map((svc) => ({
              svc,
              label: svc === 'midi' ? 'Midi' : 'Soir',
              statuts: ['client', 'production', 'defraye'].filter(
                (k) => totauxRepas[svc][k] > 0,
              ),
            }))
            .filter((s) => s.statuts.length > 0)
          const statutLabel = (k) =>
            k === 'client' ? 'Client' : k === 'production' ? 'Prod' : 'Défrayé'
          const lignes = services.flatMap((s) =>
            s.statuts.map((k) => ({ svc: s.svc, svcLabel: s.label, k })),
          )
          return (
            <Section icon={UtensilsCrossed} title="Repas" accent="#22c55e" fit>
              <table className="text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd)' }}>
                    <Th align="left" />
                    {repasParJour.map((j) => (
                      <th
                        key={j.date}
                        className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                        style={{ letterSpacing: '0.06em', borderLeft: '1px solid var(--brd-sub)' }}
                      >
                        {frDayShort(j.date)}
                      </th>
                    ))}
                    <th
                      className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                      style={{ letterSpacing: '0.08em', borderLeft: '1px solid var(--brd)' }}
                    >
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map(({ svc, svcLabel, k }, li) => {
                    const groupStart = li === 0 || lignes[li - 1].svc !== svc
                    return (
                      <tr
                        key={`${svc}-${k}`}
                        style={{
                          borderBottom: '1px solid var(--brd-sub)',
                          borderTop: groupStart && li > 0 ? '1px solid var(--brd)' : undefined,
                        }}
                      >
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="font-semibold" style={{ color: 'var(--txt)' }}>
                            {svcLabel}
                          </span>{' '}
                          <span className="font-semibold" style={{ color: STATUT_COLORS[k] }}>
                            {statutLabel(k)}
                          </span>
                        </td>
                        {repasParJour.map((j) => (
                          <td
                            key={j.date}
                            className="px-2.5 py-1.5 text-center tabular-nums"
                            style={{
                              color: j[svc][k] ? 'var(--txt)' : 'var(--txt-3)',
                              fontWeight: k === 'client' && j[svc][k] ? 700 : 400,
                              borderLeft: '1px solid var(--brd-sub)',
                            }}
                          >
                            {j[svc][k] || ''}
                          </td>
                        ))}
                        <td
                          className="px-3 py-1.5 text-center font-bold tabular-nums"
                          style={{ color: STATUT_COLORS[k], borderLeft: '1px solid var(--brd)' }}
                        >
                          {totauxRepas[svc][k]}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Section>
          )
        })()}

      {/* ── Hébergements (nuits + rooming) ─────────────────────────────── */}
      {hebs
        .filter(({ rooming }) => rooming.length > 0)
        .map(({ hebergement: h, nuitsParDate, rooming }) => (
          <Section key={h.id} icon={BedDouble} title={h.nom} accent="#a78bfa" subtitle={h.adresse}>
            {nuitsParDate.length > 0 && (
              <div
                className="flex items-center gap-1.5 flex-wrap px-3 py-2"
                style={{ borderBottom: '1px solid var(--brd-sub)' }}
              >
                {nuitsParDate.map((n) => (
                  <span
                    key={n.date}
                    className="text-[11px] px-2 py-1 rounded-md"
                    style={{
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd-sub)',
                      color: 'var(--txt-2)',
                    }}
                    title={`Nuit du ${frDay(n.date)}`}
                  >
                    {frDayShort(n.date)} · <b style={{ color: 'var(--txt)' }}>{n.pers} pers</b>
                    {n.chambres ? ` · ${n.chambres} ch.` : ''}
                  </span>
                ))}
              </div>
            )}
            <table className="w-full text-xs">
              <thead>
                <tr style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd-sub)' }}>
                  <Th align="left">Personne</Th>
                  <Th>Chambre</Th>
                  <Th>PDJ</Th>
                  <Th>Check-in</Th>
                  <Th>Check-out</Th>
                  <Th>Nuits</Th>
                </tr>
              </thead>
              <tbody>
                {rooming.map((r) => (
                  <tr key={r.membreId} style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                    <td className="px-3 py-1.5">
                      <span className="font-semibold" style={{ color: 'var(--txt)' }}>
                        {membreDisplayName(r.membre)}
                      </span>
                      {membrePosteLabel(r.membre) && (
                        <span className="ml-2 text-[10px]" style={{ color: 'var(--txt-3)' }}>
                          {membrePosteLabel(r.membre)}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--txt-2)' }}>
                      {r.chambre}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {r.pdj && <Coffee className="w-3 h-3 inline" style={{ color: '#a78bfa' }} />}
                    </td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--txt-2)' }}>
                      {frDayShort(r.checkin)}
                    </td>
                    <td className="px-2 py-1.5 text-center" style={{ color: 'var(--txt-2)' }}>
                      {frDayShort(r.checkout)}
                    </td>
                    <td className="px-2 py-1.5 text-center tabular-nums" style={{ color: 'var(--txt)' }}>
                      {r.nuits}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ))}
      {showNuitsSansHebNote && nuitsSansHeb > 0 && (
        <p className="text-[11px] px-1" style={{ color: 'var(--amber, #f59e0b)' }}>
          {nuitsSansHeb} nuit{nuitsSansHeb > 1 ? 's' : ''} sans hébergement — à affecter via la
          modale Hébergements.
        </p>
      )}

      {/* ── Arrivées / départs ─────────────────────────────────────────── */}
      {mouvements.length > 0 && (
        <Section icon={PlaneLanding} title="Arrivées & départs" accent="#60a5fa">
          <div className="flex flex-col">
            {mouvements.map((m) => (
              <div key={m.date} className="px-3 py-2" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                <p
                  className="text-[10px] font-bold uppercase tracking-wider mb-1"
                  style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
                >
                  {frDay(m.date)}
                </p>
                <div
                  className={`grid grid-cols-1 gap-x-6 gap-y-0.5 ${
                    m.arrivees.length && m.departs.length ? 'sm:grid-cols-2' : ''
                  }`}
                >
                  {m.arrivees.length > 0 && (
                    <div>
                      {m.arrivees.map((e, i) => (
                        <MouvementRow key={i} icon={PlaneLanding} color="#22c55e" event={e} />
                      ))}
                    </div>
                  )}
                  {m.departs.length > 0 && (
                    <div>
                      {m.departs.map((e, i) => (
                        <MouvementRow key={i} icon={PlaneTakeoff} color="#f59e0b" event={e} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  )
}

// ─── Briques ───────────────────────────────────────────────────────────────

function Section({ icon: Icon, title, subtitle, accent, fit = false, children }) {
  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        width: fit ? 'fit-content' : undefined,
        minWidth: fit ? '380px' : undefined,
        maxWidth: '100%',
      }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2"
        style={{ background: `${accent}10`, borderBottom: '1px solid var(--brd-sub)' }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: accent }} />
        <h3
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: accent, letterSpacing: '0.08em' }}
        >
          {title}
        </h3>
        {subtitle && (
          <span className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
            {subtitle}
          </span>
        )}
      </header>
      {children}
    </section>
  )
}

function Th({ children, align = 'center', colSpan }) {
  return (
    <th
      colSpan={colSpan}
      className={`px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-${align}`}
      style={{ letterSpacing: '0.08em' }}
    >
      {children}
    </th>
  )
}

function MouvementRow({ icon: Icon, color, event }) {
  return (
    <p className="text-xs flex items-center gap-1.5 py-0.5" style={{ color: 'var(--txt)' }}>
      <Icon className="w-3 h-3 shrink-0" style={{ color }} />
      {event.heure && <b className="tabular-nums">{event.heure}</b>}
      <span className="font-semibold">{membreDisplayName(event.membre)}</span>
      {event.detail && (
        <span className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
          {event.detail}
        </span>
      )}
    </p>
  )
}

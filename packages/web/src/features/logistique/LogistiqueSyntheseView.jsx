// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSyntheseView — synthèse festival (Logistique V1, P3)
// ════════════════════════════════════════════════════════════════════════════
//
// La vision d'ensemble à envoyer à la prod du festival :
//   - repas par jour et par service, ventilés Client / Production / Défrayé ;
//   - chambres & personnes par nuit, par hébergement + rooming list ;
//   - planning des arrivées / départs (heure du trajet structuré en priorité,
//     sinon l'arrivée/retour de la session Équipe).
// Export PDF via logistiquePdfExport (preview avant téléchargement).
// Lecture seule — tout s'édite dans la grille et les modales.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BedDouble,
  Coffee,
  FileDown,
  Loader2,
  PlaneLanding,
  PlaneTakeoff,
  UtensilsCrossed,
} from 'lucide-react'
import { fetchProjectSessions, listTechlistRows } from '../../lib/crew'
import { fetchLogistique } from '../../lib/logistique'
import {
  computeSynthese,
  membreDisplayName,
  membrePosteLabel,
  frDay,
  frDayShort,
} from './logistiqueSynthese'
import { notify } from '../../lib/notify'
import PdfPreviewModal from '../materiel/components/PdfPreviewModal'

const STATUT_COLORS = {
  client: '#22c55e',
  production: '#3b82f6',
  defraye: '#f59e0b',
}

export default function LogistiqueSyntheseView({ projectId, project = null, org = null, membres = [] }) {
  const [participations, setParticipations] = useState([])
  const [logi, setLogi] = useState(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [preview, setPreview] = useState(null)

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [parts, l] = await Promise.all([
        fetchProjectSessions(projectId),
        fetchLogistique(projectId),
      ])
      setParticipations(parts)
      setLogi(l)
    } catch (err) {
      notify.error('Chargement synthèse : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const techRows = useMemo(() => listTechlistRows(membres), [membres])
  const synthese = useMemo(
    () => (logi ? computeSynthese({ techRows, participations, logi }) : null),
    [techRows, participations, logi],
  )

  async function handleExportPdf() {
    if (!synthese || exporting) return
    setExporting(true)
    try {
      const { exportLogistiqueSynthesePDF } = await import('./logistiquePdfExport')
      const result = await exportLogistiqueSynthesePDF({ project, org, synthese })
      setPreview({ ...result, title: 'Synthèse logistique' })
    } catch (err) {
      notify.error('Export PDF : ' + (err?.message || err))
    } finally {
      setExporting(false)
    }
  }

  if (loading || !synthese) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--blue)' }} />
      </div>
    )
  }

  const { repasParJour, totauxRepas, hebs, nuitsSansHeb, mouvements } = synthese
  const empty =
    repasParJour.length === 0 && hebs.length === 0 && mouvements.length === 0

  return (
    <div className="px-1 pb-8 flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
          Chiffres calculés depuis la grille — repas Client = à commander au festival.
        </p>
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={exporting || empty}
          className="ml-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileDown className="w-3.5 h-3.5" />}
          Exporter PDF
        </button>
      </div>

      {empty && (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
        >
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            Rien à synthétiser — remplis la grille (repas, nuits, trajets).
          </p>
        </div>
      )}

      {/* ── Repas — colonnes DYNAMIQUES : une prise en charge sans aucun
          repas (ex. jamais de Défrayé) n'affiche pas sa colonne. ───────── */}
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
          // Séparateur vertical au début de chaque groupe de service, et
          // filet léger entre colonnes (lisibilité, retour Hugo).
          const cellBorder = (isGroupStart) => ({
            borderLeft: isGroupStart ? '1px solid var(--brd)' : '1px solid var(--brd-sub)',
          })
          return (
            <Section icon={UtensilsCrossed} title="Repas" accent="#22c55e" fit>
              <table className="text-xs" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd)' }}>
                    <Th align="left">Jour</Th>
                    {services.map((s) => (
                      <th
                        key={s.svc}
                        colSpan={s.statuts.length}
                        className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                        style={{ letterSpacing: '0.08em', borderLeft: '1px solid var(--brd)' }}
                      >
                        {s.label}
                      </th>
                    ))}
                  </tr>
                  <tr style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd)' }}>
                    <Th align="left" />
                    {services.flatMap((s) =>
                      s.statuts.map((k, i) => (
                        <th
                          key={`${s.svc}-${k}`}
                          className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-center"
                          style={{ letterSpacing: '0.08em', ...cellBorder(i === 0) }}
                        >
                          <span style={{ color: STATUT_COLORS[k] }}>{statutLabel(k)}</span>
                        </th>
                      )),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {repasParJour.map((j) => (
                    <tr key={j.date} style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                      <td className="px-3 py-1.5 font-semibold" style={{ color: 'var(--txt)' }}>
                        {frDayShort(j.date)}
                      </td>
                      {services.flatMap((s) =>
                        s.statuts.map((k, i) => (
                          <td
                            key={`${s.svc}-${k}`}
                            className="px-3 py-1.5 text-center tabular-nums"
                            style={{
                              color: j[s.svc][k] ? 'var(--txt)' : 'var(--txt-3)',
                              fontWeight: k === 'client' && j[s.svc][k] ? 700 : 400,
                              ...cellBorder(i === 0),
                            }}
                          >
                            {j[s.svc][k] || ''}
                          </td>
                        )),
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '1px solid var(--brd)' }}>
                    <td className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                      Total
                    </td>
                    {services.flatMap((s) =>
                      s.statuts.map((k, i) => (
                        <td
                          key={`${s.svc}-${k}`}
                          className="px-3 py-1.5 text-center font-bold tabular-nums"
                          style={{ color: STATUT_COLORS[k], ...cellBorder(i === 0) }}
                        >
                          {totauxRepas[s.svc][k]}
                        </td>
                      )),
                    )}
                  </tr>
                </tfoot>
              </table>
            </Section>
          )
        })()}

      {/* ── Hébergements — masqués tant qu'aucune nuit (comme le PDF) ── */}
      {hebs
        .filter(({ rooming }) => rooming.length > 0)
        .map(({ hebergement: h, nuitsParDate, rooming }) => (
        <Section key={h.id} icon={BedDouble} title={h.nom} accent="#a78bfa" subtitle={h.adresse}>
          {nuitsParDate.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap px-3 py-2" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
              {nuitsParDate.map((n) => (
                <span
                  key={n.date}
                  className="text-[11px] px-2 py-1 rounded-md"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)', color: 'var(--txt-2)' }}
                  title={`Nuit du ${frDay(n.date)}`}
                >
                  {frDayShort(n.date)} ·{' '}
                  <b style={{ color: 'var(--txt)' }}>{n.pers} pers</b>
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
      {nuitsSansHeb > 0 && (
        <p className="text-[11px] px-1" style={{ color: 'var(--amber, #f59e0b)' }}>
          {nuitsSansHeb} nuit{nuitsSansHeb > 1 ? 's' : ''} sans hébergement — à affecter via la
          modale Hébergements.
        </p>
      )}

      {/* ── Arrivées / départs ────────────────────────────────────────── */}
      {mouvements.length > 0 && (
        <Section icon={PlaneLanding} title="Arrivées & départs" accent="#60a5fa">
          <div className="flex flex-col">
            {mouvements.map((m) => (
              <div key={m.date} className="px-3 py-2" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}>
                  {frDay(m.date)}
                </p>
                {/* 2 colonnes uniquement quand il y a arrivées ET départs —
                    sinon la colonne vide fait flotter l'autre (retour Hugo). */}
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

      <PdfPreviewModal
        open={Boolean(preview)}
        onClose={() => {
          preview?.revoke?.()
          setPreview(null)
        }}
        title={preview?.title}
        url={preview?.url}
        filename={preview?.filename}
        onDownload={() => preview?.download?.()}
      />
    </div>
  )
}

function Section({ icon: Icon, title, subtitle, accent, fit = false, children }) {
  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        // fit : la carte épouse son tableau (ex. Repas à 3 colonnes) au
        // lieu de flotter dans un bandeau pleine largeur (retour Hugo).
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
        <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: accent, letterSpacing: '0.08em' }}>
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

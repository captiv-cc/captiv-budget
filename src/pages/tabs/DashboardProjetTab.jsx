/**
 * DashboardProjetTab — Vue synthétique d'un projet
 * Données réelles : devis · budget réel · factures · équipe
 */
import { useState, useEffect } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useProjet } from '../ProjetLayout'
import { fmtEur, fmtPct } from '../../lib/cotisations'
import {
  TrendingUp,
  TrendingDown,
  Euro,
  Users,
  Receipt,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  FileText,
  Activity,
  Percent,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function _pctBar(val, max, color) {
  const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0
  return (
    <div
      className="h-1.5 rounded-full overflow-hidden mt-1"
      style={{ background: 'var(--bg-elev)' }}
    >
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, trend, to }) {
  const inner = (
    <div
      className="rounded-xl p-4 transition-all h-full"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
      onMouseEnter={(e) => {
        if (to) e.currentTarget.style.borderColor = color?.txt || 'var(--brd)'
      }}
      onMouseLeave={(e) => {
        if (to) e.currentTarget.style.borderColor = 'var(--brd)'
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: color?.bg || 'var(--bg-elev)' }}
        >
          <Icon className="w-4 h-4" style={{ color: color?.txt || 'var(--txt-2)' }} />
        </div>
        {trend != null && (
          <span
            className="text-[11px] font-medium flex items-center gap-0.5"
            style={{ color: trend >= 0 ? 'var(--green)' : 'var(--red)' }}
          >
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {Math.abs(trend).toFixed(1)} %
          </span>
        )}
      </div>
      <p className="text-[11px] uppercase tracking-wide mb-0.5" style={{ color: 'var(--txt-3)' }}>
        {label}
      </p>
      <p className="text-xl font-bold leading-tight" style={{ color: 'var(--txt)' }}>
        {value}
      </p>
      {sub && (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {sub}
        </p>
      )}
    </div>
  )
  return to ? (
    <Link to={to} className="block">
      {inner}
    </Link>
  ) : (
    inner
  )
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, action }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
        <h2
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--txt-3)' }}
        >
          {title}
        </h2>
      </div>
      {action}
    </div>
  )
}

// ─── Jauge budget ─────────────────────────────────────────────────────────────
function BudgetJauge({ label, reel, devis, color }) {
  const pct = devis > 0 ? (reel / devis) * 100 : 0
  const over = pct > 100
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--txt-2)' }}>{label}</span>
        <span className="font-semibold" style={{ color: over ? 'var(--red)' : 'var(--txt)' }}>
          {fmtEur(reel)}
          <span className="font-normal ml-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
            / {fmtEur(devis)}
          </span>
        </span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-elev)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(100, pct)}%`,
            background: over ? 'var(--red)' : pct > 80 ? 'var(--amber)' : color,
          }}
        />
      </div>
      <p className="text-[10px] text-right" style={{ color: over ? 'var(--red)' : 'var(--txt-3)' }}>
        {pct.toFixed(0)} % consommé{over ? ' ⚠ dépassement' : ''}
      </p>
    </div>
  )
}

// ─── Statut facture badge ─────────────────────────────────────────────────────
const FAC_STATUTS = {
  brouillon: { label: 'Brouillon', color: 'var(--txt-3)', bg: 'var(--bg-elev)' },
  envoyee: { label: 'Envoyée', color: 'var(--blue)', bg: 'rgba(59,130,246,.12)' },
  en_attente: { label: 'En attente', color: 'var(--amber)', bg: 'rgba(245,158,11,.12)' },
  reglee: { label: 'Réglée ✓', color: 'var(--green)', bg: 'rgba(0,200,117,.12)' },
  en_retard: { label: 'En retard', color: 'var(--red)', bg: 'rgba(239,68,68,.12)' },
}

function FacStatutBadge({ statut }) {
  const m = FAC_STATUTS[statut] || FAC_STATUTS.brouillon
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: m.bg, color: m.color }}
    >
      {m.label}
    </span>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function DashboardProjetTab() {
  const { projectId, refDevis, refSynth, devisList, devisStats } = useProjet()
  const _ctx = useOutletContext()

  const [budgetReel, setBudgetReel] = useState([])
  const [factures, setFactures] = useState([])
  const [membres, setMembres] = useState([])
  const [_loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    Promise.all([
      supabase.from('budget_reel').select('*').eq('project_id', projectId),
      supabase.from('factures').select('*').eq('project_id', projectId).order('date_emission'),
      supabase
        .from('projet_membres')
        .select('*, contact:contacts(nom, prenom, specialite)')
        .eq('project_id', projectId),
    ]).then(([br, fac, mb]) => {
      setBudgetReel(br.data || [])
      setFactures(fac.data || [])
      setMembres(mb.data || [])
      setLoading(false)
    })
  }, [projectId])

  if (!refSynth) {
    return (
      <div
        className="flex flex-col items-center justify-center h-64 gap-3"
        style={{ color: 'var(--txt-3)' }}
      >
        <BarChart3 className="w-10 h-10 opacity-30" />
        <p className="text-sm">Créez un devis pour voir le dashboard</p>
        <Link
          to={`/projets/${projectId}/devis`}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg text-white"
          style={{ background: 'var(--blue)' }}
        >
          <FileText className="w-3.5 h-3.5" />
          Aller aux devis
        </Link>
      </div>
    )
  }

  // ── Calculs ────────────────────────────────────────────────────────────────
  const totalReel = budgetReel.reduce((s, e) => s + Number(e.montant_ht || 0), 0)
  const ecartBudget = refSynth.totalHTFinal - totalReel
  const _totalFacHT = factures.reduce((s, f) => s + Number(f.montant_ht || 0), 0)
  const totalFacTTC = factures.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalRegle = factures
    .filter((f) => f.statut === 'reglee')
    .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const pctEncaisse = totalFacTTC > 0 ? totalRegle / totalFacTTC : 0
  const facEnRetard = factures.filter((f) => f.statut === 'en_retard')
  const _facAttente = factures.filter((f) => ['envoyee', 'en_attente'].includes(f.statut))

  // Marge couleur
  const margeColor =
    refSynth.pctMargeFinale < 0
      ? 'var(--red)'
      : refSynth.pctMargeFinale > 0.2
        ? 'var(--green)'
        : 'var(--amber)'

  // Prochaines factures (non réglées, avec échéance)
  const prochainesFac = factures
    .filter((f) => f.statut !== 'reglee' && f.statut !== 'brouillon')
    .sort((a, b) => (a.date_echeance || '9999').localeCompare(b.date_echeance || '9999'))
    .slice(0, 4)

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* ── KPIs principaux ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Budget devisé HT"
          value={fmtEur(refSynth.totalHTFinal)}
          sub={`${fmtEur(refSynth.totalTTC)} TTC`}
          icon={Euro}
          color={{ bg: 'rgba(59,130,246,.12)', txt: 'var(--blue)' }}
          to={`/projets/${projectId}/devis`}
        />
        <KpiCard
          label="Marge estimée"
          value={fmtPct(refSynth.pctMargeFinale)}
          sub={fmtEur(refSynth.margeFinale)}
          icon={TrendingUp}
          color={{
            bg: refSynth.pctMargeFinale < 0 ? 'rgba(239,68,68,.12)' : 'rgba(0,200,117,.12)',
            txt: margeColor,
          }}
        />
        <KpiCard
          label="Budget réel"
          value={fmtEur(totalReel)}
          sub={
            totalReel > 0
              ? `Écart : ${ecartBudget >= 0 ? '+' : ''}${fmtEur(ecartBudget)}`
              : 'Aucune entrée'
          }
          icon={Activity}
          color={{ bg: 'rgba(245,158,11,.12)', txt: 'var(--amber)' }}
          to={`/projets/${projectId}/budget`}
        />
        <KpiCard
          label="Encaissé"
          value={fmtEur(totalRegle)}
          sub={`${(pctEncaisse * 100).toFixed(0)} % · ${fmtEur(totalFacTTC)} facturé TTC`}
          icon={CheckCircle2}
          color={{ bg: 'rgba(0,200,117,.12)', txt: 'var(--green)' }}
          to={`/projets/${projectId}/factures`}
        />
      </div>

      {/* ── Ligne médiane : Budget vs Réel + Facturation ────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Budget vs Réel */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <SectionHeader
            icon={Activity}
            title="Budget vs Réel"
            action={
              <Link
                to={`/projets/${projectId}/budget`}
                className="flex items-center gap-1 text-[11px] transition-colors"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
              >
                Voir tout <ArrowRight className="w-3 h-3" />
              </Link>
            }
          />

          {budgetReel.length === 0 ? (
            <div
              className="flex flex-col items-center py-8 gap-2"
              style={{ color: 'var(--txt-3)' }}
            >
              <Activity className="w-8 h-8 opacity-30" />
              <p className="text-xs">Aucune entrée de budget réel</p>
            </div>
          ) : (
            <div className="space-y-4">
              <BudgetJauge
                label="Total global"
                reel={totalReel}
                devis={refSynth.totalHTFinal}
                color="var(--blue)"
              />

              {/* Répartition par catégorie budget_reel */}
              {(() => {
                const byCat = {}
                budgetReel.forEach((e) => {
                  const cat = e.categorie || e.regime || 'Autre'
                  byCat[cat] = (byCat[cat] || 0) + Number(e.montant_ht || 0)
                })
                return Object.entries(byCat)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 4)
                  .map(([cat, montant]) => (
                    <BudgetJauge
                      key={cat}
                      label={cat}
                      reel={montant}
                      devis={refSynth.totalHTFinal}
                      color="var(--blue)"
                    />
                  ))
              })()}

              {/* Écart résumé */}
              <div
                className="rounded-lg p-3 flex items-center justify-between mt-2"
                style={{
                  background: ecartBudget >= 0 ? 'rgba(0,200,117,.08)' : 'rgba(239,68,68,.08)',
                  border: `1px solid ${ecartBudget >= 0 ? 'rgba(0,200,117,.2)' : 'rgba(239,68,68,.2)'}`,
                }}
              >
                <span className="text-xs" style={{ color: 'var(--txt-2)' }}>
                  {ecartBudget >= 0 ? 'Marge de manœuvre' : 'Dépassement budget'}
                </span>
                <span
                  className="text-sm font-bold"
                  style={{ color: ecartBudget >= 0 ? 'var(--green)' : 'var(--red)' }}
                >
                  {ecartBudget >= 0 ? '+' : ''}
                  {fmtEur(ecartBudget)}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Facturation */}
        <div
          className="rounded-xl p-5"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <SectionHeader
            icon={Receipt}
            title="Facturation"
            action={
              <Link
                to={`/projets/${projectId}/factures`}
                className="flex items-center gap-1 text-[11px] transition-colors"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
              >
                Gérer <ArrowRight className="w-3 h-3" />
              </Link>
            }
          />

          {factures.length === 0 ? (
            <div
              className="flex flex-col items-center py-8 gap-2"
              style={{ color: 'var(--txt-3)' }}
            >
              <Receipt className="w-8 h-8 opacity-30" />
              <p className="text-xs">Aucune facture enregistrée</p>
              <Link
                to={`/projets/${projectId}/factures`}
                className="text-xs px-3 py-1.5 rounded-lg text-white mt-1"
                style={{ background: 'var(--blue)' }}
              >
                Créer une facture
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Barre encaissement */}
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: 'var(--txt-2)' }}>Encaissement TTC</span>
                  <span className="font-semibold" style={{ color: 'var(--txt)' }}>
                    {fmtEur(totalRegle)} / {fmtEur(totalFacTTC)}
                  </span>
                </div>
                <div
                  className="h-3 rounded-full overflow-hidden"
                  style={{ background: 'var(--bg-elev)' }}
                >
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.min(100, pctEncaisse * 100)}%`,
                      background: pctEncaisse >= 1 ? 'var(--green)' : 'var(--blue)',
                    }}
                  />
                </div>
                <p className="text-[10px] text-right mt-0.5" style={{ color: 'var(--txt-3)' }}>
                  {(pctEncaisse * 100).toFixed(0)} % encaissé
                </p>
              </div>

              {/* Alertes */}
              {facEnRetard.length > 0 && (
                <div
                  className="flex items-center gap-2 rounded-lg p-2.5"
                  style={{
                    background: 'rgba(239,68,68,.08)',
                    border: '1px solid rgba(239,68,68,.2)',
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--red)' }} />
                  <p className="text-xs" style={{ color: 'var(--red)' }}>
                    {facEnRetard.length} facture{facEnRetard.length > 1 ? 's' : ''} en retard ·{' '}
                    {fmtEur(facEnRetard.reduce((s, f) => s + Number(f.montant_ttc || 0), 0))} TTC
                  </p>
                </div>
              )}

              {/* Prochaines échéances */}
              {prochainesFac.length > 0 && (
                <div className="space-y-1.5">
                  <p
                    className="text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    À encaisser
                  </p>
                  {prochainesFac.map((f) => (
                    <div
                      key={f.id}
                      className="flex items-center justify-between rounded-lg px-3 py-2"
                      style={{ background: 'var(--bg-elev)' }}
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
                          {f.objet || f.type}
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                          Échéance : {fmtDate(f.date_echeance)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
                          {fmtEur(f.montant_ttc || 0)}
                        </span>
                        <FacStatutBadge statut={f.statut} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Ligne basse : Versions devis + Équipe ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Comparatif versions — 2/3 */}
        <div
          className="md:col-span-2 rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--brd)' }}
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
              <h2
                className="text-xs font-bold uppercase tracking-widest"
                style={{ color: 'var(--txt-3)' }}
              >
                Versions devis
              </h2>
            </div>
            <Link
              to={`/projets/${projectId}/devis`}
              className="flex items-center gap-1 text-[11px] transition-colors"
              style={{ color: 'var(--txt-3)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
            >
              Voir <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr
                  style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd-sub)' }}
                >
                  {['Version', 'Total HT', 'Coût chargé', 'Marge', '% Marge', 'Statut'].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-2.5 text-left font-bold uppercase tracking-wider"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devisList.map((dv) => {
                  const s = devisStats[dv.id]
                  const isRef = dv.id === refDevis?.id
                  const mc = !s
                    ? ''
                    : s.pctMargeFinale < 0
                      ? 'var(--red)'
                      : s.pctMargeFinale > 0.2
                        ? 'var(--green)'
                        : 'var(--amber)'
                  const statusMap = {
                    accepte: { label: 'Accepté', bg: 'rgba(0,200,117,.12)', txt: 'var(--green)' },
                    envoye: { label: 'Envoyé', bg: 'rgba(59,130,246,.12)', txt: 'var(--blue)' },
                    refuse: { label: 'Refusé', bg: 'rgba(239,68,68,.12)', txt: 'var(--red)' },
                    brouillon: { label: 'Brouillon', bg: 'var(--bg-elev)', txt: 'var(--txt-3)' },
                  }
                  const sm = statusMap[dv.status] || statusMap.brouillon
                  return (
                    <tr
                      key={dv.id}
                      style={{
                        borderBottom: '1px solid var(--brd-sub)',
                        background: isRef ? 'rgba(0,200,117,.04)' : '',
                      }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Link
                            to={`/projets/${projectId}/devis/${dv.id}`}
                            className="font-bold hover:underline"
                            style={{ color: 'var(--txt)' }}
                          >
                            V{dv.version_number}
                          </Link>
                          {isRef && (
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: 'rgba(0,200,117,.15)', color: 'var(--green)' }}
                            >
                              réf.
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-semibold" style={{ color: 'var(--txt)' }}>
                        {s ? fmtEur(s.totalHTFinal) : '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--txt-2)' }}>
                        {s ? fmtEur(s.totalCoutCharge) : '—'}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--txt-2)' }}>
                        {s ? fmtEur(s.margeFinale) : '—'}
                      </td>
                      <td className="px-4 py-3 font-bold" style={{ color: mc }}>
                        {s ? fmtPct(s.pctMargeFinale) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                          style={{ background: sm.bg, color: sm.txt }}
                        >
                          {sm.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Équipe + détail devis — 1/3 */}
        <div className="space-y-4">
          {/* Équipe */}
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            <SectionHeader
              icon={Users}
              title="Équipe"
              action={
                <Link
                  to={`/projets/${projectId}/equipe`}
                  className="flex items-center gap-1 text-[11px] transition-colors"
                  style={{ color: 'var(--txt-3)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                >
                  Voir <ArrowRight className="w-3 h-3" />
                </Link>
              }
            />
            {membres.length === 0 ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--txt-3)' }}>
                Aucun membre
              </p>
            ) : (
              <div className="space-y-1.5">
                {membres.slice(0, 6).map((m) => {
                  const nom = m.contact
                    ? `${m.contact.prenom || ''} ${m.contact.nom || ''}`.trim()
                    : m.nom_libre || 'Inconnu'
                  const spec = m.contact?.specialite || m.specialite || m.role
                  const initials = nom
                    .split(' ')
                    .map((w) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                      style={{ background: 'var(--bg-elev)' }}
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 text-white"
                        style={{ background: 'var(--blue)' }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
                          {nom}
                        </p>
                        {spec && (
                          <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                            {spec}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
                {membres.length > 6 && (
                  <p className="text-[11px] text-center pt-1" style={{ color: 'var(--txt-3)' }}>
                    +{membres.length - 6} autre{membres.length - 6 > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Détail marge devis */}
          <div
            className="rounded-xl p-5"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            <SectionHeader icon={Percent} title="Décomposition HT" />
            <div className="space-y-2">
              {[
                { label: 'Sous-total lignes', val: refSynth.sousTotal, color: 'var(--txt-2)' },
                refSynth.montantMargeGlobale
                  ? {
                      label: `Mg+Fg ${refDevis?.marge_globale_pct || 0}%`,
                      val: refSynth.montantMargeGlobale,
                      color: 'var(--blue)',
                    }
                  : null,
                refSynth.montantAssurance
                  ? {
                      label: `Assurance ${refDevis?.assurance_pct || 0}%`,
                      val: refSynth.montantAssurance,
                      color: '#a78bfa',
                    }
                  : null,
                refSynth.totalCharges
                  ? { label: 'Charges soc. pat.', val: refSynth.totalCharges, color: 'var(--red)' }
                  : null,
                refSynth.montantRemiseGlobale
                  ? { label: 'Remise', val: -refSynth.montantRemiseGlobale, color: 'var(--orange)' }
                  : null,
                {
                  label: 'Total HT final',
                  val: refSynth.totalHTFinal,
                  color: 'var(--txt)',
                  bold: true,
                },
              ]
                .filter(Boolean)
                .map((row, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span
                      className="text-[11px]"
                      style={{ color: row.color, fontWeight: row.bold ? 700 : 400 }}
                    >
                      {row.label}
                    </span>
                    <span className="text-[11px] font-semibold" style={{ color: row.color }}>
                      {row.val < 0 ? `−${fmtEur(Math.abs(row.val))}` : fmtEur(row.val)}
                    </span>
                  </div>
                ))}
              <div className="h-px mt-1" style={{ background: 'var(--brd)' }} />
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Marge nette
                </span>
                <span className="text-sm font-bold" style={{ color: margeColor }}>
                  {fmtPct(refSynth.pctMargeFinale)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

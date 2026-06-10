/**
 * Page Compta — Vue globale de toutes les factures
 * Classement par urgence (retard → en_attente → envoyée → brouillon → réglée)
 * Accessible uniquement aux rôles finance (admin, charge_prod)
 */
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fmtEur } from '../lib/cotisations'
import {
  AlertTriangle,
  Clock,
  Send,
  FileText,
  CheckCircle2,
  TrendingUp,
  Euro,
  ExternalLink,
  Receipt,
  RefreshCw,
  Filter,
} from 'lucide-react'

// ─── Priorité de tri par statut ───────────────────────────────────────────────
const STATUT_PRIORITY = {
  en_retard: 0,
  en_attente: 1,
  envoyee: 2,
  brouillon: 3,
  reglee: 4,
}

const STATUTS_META = {
  en_retard: {
    label: 'En retard',
    icon: AlertTriangle,
    color: 'var(--red)',
    bg: 'rgba(239,68,68,.12)',
  },
  en_attente: {
    label: 'En attente',
    icon: Clock,
    color: 'var(--amber)',
    bg: 'rgba(245,158,11,.12)',
  },
  envoyee: { label: 'Envoyée', icon: Send, color: 'var(--blue)', bg: 'rgba(59,130,246,.12)' },
  brouillon: { label: 'Brouillon', icon: FileText, color: 'var(--txt-3)', bg: 'var(--bg-elev)' },
  reglee: {
    label: 'Réglée ✓',
    icon: CheckCircle2,
    color: 'var(--green)',
    bg: 'rgba(0,200,117,.12)',
  },
}

const TYPES_LABELS = {
  acompte: 'Acompte',
  acompte_intermediaire: 'Acompte inter.',
  solde: 'Solde',
  globale: 'Globale',
}

function fmtDate(d) {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

// ─── Badges ───────────────────────────────────────────────────────────────────
function StatutBadge({ statut }) {
  const meta = STATUTS_META[statut] || STATUTS_META.brouillon
  const _Icon = meta.icon
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  )
}

// ─── KPI Card ────────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, onClick, active }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl p-4 flex items-center gap-3 text-left w-full transition-all"
      style={{
        background: active ? color?.activeBg || color?.bg : 'var(--bg-surf)',
        border: `1px solid ${active ? color?.txt || 'var(--brd)' : 'var(--brd)'}`,
        opacity: active ? 1 : 0.9,
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: color?.bg || 'var(--bg-elev)' }}
      >
        <Icon className="w-4 h-4" style={{ color: color?.txt || 'var(--txt-2)' }} />
      </div>
      <div className="min-w-0">
        <p
          className="text-[11px] uppercase tracking-wide truncate"
          style={{ color: 'var(--txt-3)' }}
        >
          {label}
        </p>
        <p className="text-base font-bold leading-tight" style={{ color: 'var(--txt)' }}>
          {value}
        </p>
        {sub && (
          <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {sub}
          </p>
        )}
      </div>
    </button>
  )
}

// ─── Ligne de facture ─────────────────────────────────────────────────────────
function FactureLine({ facture }) {
  const _meta = STATUTS_META[facture.statut] || STATUTS_META.brouillon
  const ech = facture.date_echeance
  const isRetard = facture.statut === 'en_retard'

  return (
    <div
      className="grid items-center gap-3 px-4 py-3 text-sm transition-colors"
      style={{
        gridTemplateColumns: '2fr 1fr 120px 110px 110px 110px',
        borderTop: '1px solid var(--brd-sub)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {/* Projet + objet */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/projets/${facture.project_id}/factures`}
            className="text-xs font-semibold truncate hover:underline"
            style={{ color: 'var(--blue)' }}
          >
            {facture.project_title || 'Projet sans nom'}
          </Link>
          {facture.client_name && (
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              · {facture.client_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>
            {facture.objet || TYPES_LABELS[facture.type] || 'Facture'}
          </p>
          {facture.numero && (
            <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--txt-3)' }}>
              {facture.numero}
            </span>
          )}
        </div>
      </div>

      {/* Type */}
      <div>
        <span
          className="text-[11px] px-2 py-0.5 rounded font-medium"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
        >
          {TYPES_LABELS[facture.type] || facture.type}
        </span>
      </div>

      {/* Montant TTC */}
      <div className="text-right">
        <p className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
          {fmtEur(facture.montant_ttc || 0)}
        </p>
        <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          {fmtEur(facture.montant_ht)} HT
        </p>
      </div>

      {/* Émission */}
      <div className="text-center">
        <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
          {fmtDate(facture.date_emission)}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          émission
        </p>
      </div>

      {/* Échéance */}
      <div className="text-center">
        <p className="text-xs" style={{ color: isRetard ? 'var(--red)' : 'var(--txt-2)' }}>
          {fmtDate(ech)}
          {isRetard && <AlertTriangle className="w-3 h-3 inline ml-1" />}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          échéance
        </p>
      </div>

      {/* Statut + lien */}
      <div className="flex items-center justify-end gap-2">
        <StatutBadge statut={facture.statut} />
        <Link
          to={`/projets/${facture.project_id}/factures`}
          className="p-1 rounded transition-colors"
          title="Voir dans le projet"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function Compta() {
  const { canSeeFinance } = useAuth()
  const [factures, setFactures] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all') // 'all' | statut key

  const load = useCallback(async () => {
    setLoading(true)
    // Jointure manuelle car pas de vue disponible
    const { data: facs } = await supabase
      .from('factures')
      .select(
        `
        *,
        projects (
          id,
          title,
          clients ( nom_commercial )
        )
      `,
      )
      .order('date_echeance', { ascending: true })

    const mapped = (facs || []).map((f) => ({
      ...f,
      project_title: f.projects?.title || '',
      client_name: f.projects?.clients?.nom_commercial || '',
    }))

    // Tri par priorité statut, puis date échéance
    mapped.sort((a, b) => {
      const pa = STATUT_PRIORITY[a.statut] ?? 99
      const pb = STATUT_PRIORITY[b.statut] ?? 99
      if (pa !== pb) return pa - pb
      if (!a.date_echeance) return 1
      if (!b.date_echeance) return -1
      return a.date_echeance.localeCompare(b.date_echeance)
    })

    setFactures(mapped)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (!canSeeFinance) {
    return (
      <div
        className="flex items-center justify-center h-64 gap-2"
        style={{ color: 'var(--txt-3)' }}
      >
        <Receipt className="w-5 h-5" />
        <p className="text-sm">Accès réservé à l&apos;équipe de production</p>
      </div>
    )
  }

  // ── KPIs globaux ──────────────────────────────────────────────────────────
  const actives = factures.filter((f) => f.statut !== 'brouillon')
  const totalTTC = actives.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const totalRegle = factures
    .filter((f) => f.statut === 'reglee')
    .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const enAttente = factures
    .filter((f) => ['envoyee', 'en_attente'].includes(f.statut))
    .reduce((s, f) => s + Number(f.montant_ttc || 0), 0)
  const enRetard = factures.filter((f) => f.statut === 'en_retard')
  const totalRetard = enRetard.reduce((s, f) => s + Number(f.montant_ttc || 0), 0)

  // ── Filtrage ──────────────────────────────────────────────────────────────
  const displayed = filter === 'all' ? factures : factures.filter((f) => f.statut === filter)

  // Grouper par section si filtre = all
  const sections =
    filter === 'all'
      ? [
          {
            key: 'urgent',
            label: '🔴 En retard',
            items: factures.filter((f) => f.statut === 'en_retard'),
          },
          {
            key: 'attente',
            label: '🟡 En attente',
            items: factures.filter((f) => ['en_attente', 'envoyee'].includes(f.statut)),
          },
          {
            key: 'brouillon',
            label: '⚪ Brouillons',
            items: factures.filter((f) => f.statut === 'brouillon'),
          },
          {
            key: 'reglee',
            label: '🟢 Réglées',
            items: factures.filter((f) => f.statut === 'reglee'),
          },
        ].filter((s) => s.items.length > 0)
      : null

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Comptabilité
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Suivi global des factures · tous projets confondus
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt-2)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surf)')}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Actualiser
        </button>
      </div>

      {/* ── KPIs (cliquables pour filtrer) ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total facturé (envoyé)"
          value={fmtEur(totalTTC)}
          icon={Euro}
          color={{
            bg: 'rgba(59,130,246,.12)',
            txt: 'var(--blue)',
            activeBg: 'rgba(59,130,246,.18)',
          }}
          onClick={() => setFilter((f) => (f === 'all' ? 'all' : 'all'))}
          active={filter === 'all'}
        />
        <KpiCard
          label={`Encaissé (${factures.filter((f) => f.statut === 'reglee').length} fact.)`}
          value={fmtEur(totalRegle)}
          icon={CheckCircle2}
          color={{ bg: 'rgba(0,200,117,.12)', txt: 'var(--green)', activeBg: 'rgba(0,200,117,.2)' }}
          onClick={() => setFilter((f) => (f === 'reglee' ? 'all' : 'reglee'))}
          active={filter === 'reglee'}
        />
        <KpiCard
          label={`En attente (${factures.filter((f) => ['envoyee', 'en_attente'].includes(f.statut)).length} fact.)`}
          value={fmtEur(enAttente)}
          icon={Clock}
          color={{
            bg: 'rgba(245,158,11,.12)',
            txt: 'var(--amber)',
            activeBg: 'rgba(245,158,11,.2)',
          }}
          onClick={() => setFilter((f) => (f === 'en_attente' ? 'all' : 'en_attente'))}
          active={filter === 'en_attente'}
        />
        <KpiCard
          label={`En retard (${enRetard.length} fact.)`}
          value={enRetard.length > 0 ? fmtEur(totalRetard) : 'Aucun retard'}
          icon={enRetard.length > 0 ? AlertTriangle : TrendingUp}
          color={
            enRetard.length > 0
              ? { bg: 'rgba(239,68,68,.12)', txt: 'var(--red)', activeBg: 'rgba(239,68,68,.2)' }
              : { bg: 'rgba(0,200,117,.08)', txt: 'var(--green)' }
          }
          onClick={() => setFilter((f) => (f === 'en_retard' ? 'all' : 'en_retard'))}
          active={filter === 'en_retard'}
        />
      </div>

      {/* ── Filtres pills ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--txt-3)' }}>
          <Filter className="w-3.5 h-3.5" />
          Filtrer :
        </span>
        {[
          { key: 'all', label: `Toutes (${factures.length})` },
          {
            key: 'en_retard',
            label: `En retard (${factures.filter((f) => f.statut === 'en_retard').length})`,
          },
          {
            key: 'en_attente',
            label: `En attente (${factures.filter((f) => f.statut === 'en_attente').length})`,
          },
          {
            key: 'envoyee',
            label: `Envoyées (${factures.filter((f) => f.statut === 'envoyee').length})`,
          },
          {
            key: 'brouillon',
            label: `Brouillons (${factures.filter((f) => f.statut === 'brouillon').length})`,
          },
          {
            key: 'reglee',
            label: `Réglées (${factures.filter((f) => f.statut === 'reglee').length})`,
          },
        ].map((p) => (
          <button
            key={p.key}
            onClick={() => setFilter(p.key)}
            className="px-3 py-1 rounded-full text-xs font-medium transition-all"
            style={
              filter === p.key
                ? { background: 'var(--blue)', color: 'white' }
                : {
                    background: 'var(--bg-elev)',
                    color: 'var(--txt-3)',
                    border: '1px solid var(--brd-sub)',
                  }
            }
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ── Tableau ─────────────────────────────────────────────────────────── */}
      {loading ? (
        <div
          className="flex items-center justify-center py-20 gap-2"
          style={{ color: 'var(--txt-3)' }}
        >
          <div
            className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }}
          />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : factures.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--bg-elev)' }}
          >
            <Receipt className="w-6 h-6" style={{ color: 'var(--txt-3)' }} />
          </div>
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            Aucune facture enregistrée
          </p>
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            Ajoutez des factures depuis les onglets projet
          </p>
        </div>
      ) : sections ? (
        /* Vue groupée par statut */
        <div className="space-y-4">
          {sections.map((sec) => (
            <div
              key={sec.key}
              className="rounded-xl overflow-hidden"
              style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
            >
              {/* Titre de section */}
              <div
                className="flex items-center justify-between px-4 py-2.5"
                style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd)' }}
              >
                <span className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
                  {sec.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                  {fmtEur(sec.items.reduce((s, f) => s + Number(f.montant_ttc || 0), 0))} TTC
                </span>
              </div>
              {/* En-tête colonnes */}
              <div
                className="grid px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  gridTemplateColumns: '2fr 1fr 120px 110px 110px 110px',
                  borderBottom: '1px solid var(--brd-sub)',
                  color: 'var(--txt-3)',
                }}
              >
                <span>Projet · Facture</span>
                <span>Type</span>
                <span className="text-right">Montant TTC</span>
                <span className="text-center">Émission</span>
                <span className="text-center">Échéance</span>
                <span className="text-right">Statut</span>
              </div>
              {sec.items.map((f) => (
                <FactureLine key={f.id} facture={f} />
              ))}
            </div>
          ))}
        </div>
      ) : (
        /* Vue filtrée (liste plate) */
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <div
            className="grid px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              gridTemplateColumns: '2fr 1fr 120px 110px 110px 110px',
              background: 'var(--bg-elev)',
              borderBottom: '1px solid var(--brd)',
              color: 'var(--txt-3)',
            }}
          >
            <span>Projet · Facture</span>
            <span>Type</span>
            <span className="text-right">Montant TTC</span>
            <span className="text-center">Émission</span>
            <span className="text-center">Échéance</span>
            <span className="text-right">Statut</span>
          </div>
          {displayed.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: 'var(--txt-3)' }}>
              Aucune facture dans cette catégorie
            </p>
          ) : (
            displayed.map((f) => <FactureLine key={f.id} facture={f} />)
          )}
        </div>
      )}
    </div>
  )
}

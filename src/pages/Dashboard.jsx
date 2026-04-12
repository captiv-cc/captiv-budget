import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fmtEur, fmtPct, calcSynthese, TAUX_DEFAUT } from '../lib/cotisations'
import { FolderOpen, TrendingUp, Euro, Plus, ArrowRight } from 'lucide-react'

export default function Dashboard() {
  const { org, profile } = useAuth()
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [loading, setLoading] = useState(true)

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    try {
      // Projets en cours
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title, status, client_id, clients(name), updated_at')
        .eq('org_id', org.id)
        .order('updated_at', { ascending: false })
        .limit(10)

      // Tous les devis acceptés pour CA
      const { data: devisAcceptes } = await supabase
        .from('devis')
        .select('id, project_id, version_number, status, tva_rate, acompte_pct')
        .eq('status', 'accepte')

      // Lignes des devis
      let totalCA = 0,
        totalMarge = 0,
        projetsActifs = 0
      const _projetsAlerte = 0

      if (devisAcceptes?.length) {
        const { data: lines } = await supabase
          .from('devis_lines')
          .select('*')
          .in(
            'devis_id',
            devisAcceptes.map((d) => d.id),
          )

        for (const dv of devisAcceptes) {
          const dvLines = (lines || []).filter((l) => l.devis_id === dv.id)
          const s = calcSynthese(dvLines, dv.tva_rate || 20, dv.acompte_pct || 30, TAUX_DEFAUT)
          totalCA += s.totalPrixVente
          totalMarge += s.totalMarge
        }
      }

      projetsActifs = (projects || []).filter((p) => p.status === 'en_cours').length

      setStats({
        totalCA,
        totalMarge,
        projetsActifs,
        pctMarge: totalCA > 0 ? totalMarge / totalCA : 0,
      })
      setRecent(projects || [])
    } finally {
      setLoading(false)
    }
  }, [org])

  useEffect(() => {
    if (org?.id) loadDashboard()
  }, [org, loadDashboard])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Bonjour'
    if (h < 18) return 'Bon après-midi'
    return 'Bonsoir'
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {profile?.full_name?.split(' ')[0] || 'Hugo'} 👋
        </h1>
        <p className="text-gray-500 text-sm mt-1">{org?.name} — vue d&apos;ensemble</p>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="h-3 bg-gray-200 rounded w-24 mb-3" />
              <div className="h-7 bg-gray-200 rounded w-32" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={FolderOpen}
            color="blue"
            label="Projets actifs"
            value={stats?.projetsActifs ?? 0}
          />
          <StatCard
            icon={Euro}
            color="green"
            label="CA devisé (accepté)"
            value={fmtEur(stats?.totalCA)}
          />
          <StatCard
            icon={TrendingUp}
            color="purple"
            label="Marge globale"
            value={fmtPct(stats?.pctMarge)}
          />
          <StatCard
            icon={Euro}
            color="amber"
            label="Marge totale HT"
            value={fmtEur(stats?.totalMarge)}
          />
        </div>
      )}

      {/* Projets récents */}
      <div className="card">
        <div className="card-header">
          <h2 className="font-semibold text-gray-800 text-sm">Projets récents</h2>
          <Link to="/projets" className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Nouveau projet
          </Link>
        </div>
        <div className="divide-y divide-gray-50">
          {recent.length === 0 && !loading && (
            <div className="p-12 text-center">
              <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Aucun projet pour l&apos;instant</p>
              <Link to="/projets" className="btn-primary btn-sm mt-4 inline-flex">
                Créer votre premier projet
              </Link>
            </div>
          )}
          {recent.map((p) => (
            <Link
              key={p.id}
              to={`/projets/${p.id}`}
              className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${STATUS_DOT[p.status] || 'bg-gray-300'}`} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{p.title}</p>
                  <p className="text-xs text-gray-500">{p.clients?.name || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`badge ${STATUS_BADGE[p.status] || 'badge-gray'}`}>
                  {STATUS_LABEL[p.status] || p.status}
                </span>
                <ArrowRight className="w-4 h-4 text-gray-300" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, color, label, value }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600',
  }
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}

const STATUS_DOT = {
  en_cours: 'bg-blue-500',
  termine: 'bg-green-500',
  annule: 'bg-gray-400',
  prospect: 'bg-amber-400',
}
const STATUS_BADGE = {
  en_cours: 'badge-blue',
  termine: 'badge-green',
  annule: 'badge-gray',
  prospect: 'badge-amber',
}
const STATUS_LABEL = {
  en_cours: 'En cours',
  termine: 'Terminé',
  annule: 'Annulé',
  prospect: 'Prospect',
}

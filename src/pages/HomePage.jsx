import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { fmtEur } from '../lib/cotisations'
import ProjectAvatar from '../features/projets/components/ProjectAvatar'
import LivrablesGlobalWidget from '../features/livrables/components/LivrablesGlobalWidget'
import {
  FolderOpen,
  Users,
  CheckSquare,
  Plus,
  ArrowRight,
  Receipt,
} from 'lucide-react'

// ─── Helpers ──────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Bonjour'
  if (h < 18) return 'Bon après-midi'
  return 'Bonsoir'
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

const STATUS_DOT = {
  prospect: 'var(--amber)',
  en_cours: 'var(--blue)',
  termine: 'var(--green)',
  archive: 'var(--txt-3)',
}
const STATUS_LABEL = {
  prospect: 'Prospect',
  en_cours: 'En cours',
  termine: 'Terminé',
  archive: 'Archivé',
}

// ─── Composants ───────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, color, restricted }) {
  const colors = {
    blue: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
    green: { bg: 'rgba(0,200,117,.12)', fg: 'var(--green)' },
    amber: { bg: 'rgba(255,159,10,.12)', fg: 'var(--amber)' },
    purple: { bg: 'rgba(156,95,253,.12)', fg: 'var(--purple)' },
    red: { bg: 'rgba(255,71,87,.12)', fg: 'var(--red)' },
  }
  const c = colors[color] || colors.blue

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-start justify-between mb-3">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center"
          style={{ background: c.bg }}
        >
          <Icon className="w-4.5 h-4.5" style={{ color: c.fg }} />
        </div>
        {restricted && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
          >
            Finance
          </span>
        )}
      </div>
      <p className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
        {value}
      </p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
        {label}
      </p>
      {sub && (
        <p className="text-xs mt-0.5 font-medium" style={{ color: c.fg }}>
          {sub}
        </p>
      )}
    </div>
  )
}

function SectionTitle({ children }) {
  return (
    <h2
      className="text-xs font-bold uppercase tracking-widest mb-3"
      style={{ color: 'var(--txt-3)' }}
    >
      {children}
    </h2>
  )
}

// ─── Page Accueil ─────────────────────────────────────────────────────────────
export default function HomePage() {
  const { profile, org, canSeeFinance, isInternal } = useAuth()

  const [loading, setLoading] = useState(true)
  const [projets, setProjets] = useState([])
  const [stats, setStats] = useState({
    projetsActifs: 0,
    livrables: 0,
    contacts: 0,
    facturesEnAttente: 0,
    montantEnAttente: 0,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Projets actifs (affichés à tous les rôles — sans chiffres)
      const { data: projs } = await supabase
        .from('projects')
        .select('id, title, status, types_projet, date_fin, cover_url, clients(nom_commercial)')
        .eq('org_id', org.id)
        .in('status', ['prospect', 'en_cours'])
        .order('updated_at', { ascending: false })
        .limit(8)

      // Compteurs non-sensibles
      const { count: nbActifs } = await supabase
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'en_cours')

      // Compteur livrables actifs : exclut les statuts terminés (livre, archive).
      // Cohérent avec LIVRABLE_STATUTS_TERMINES côté livrablesHelpers.js.
      const { count: nbLivrables } = await supabase
        .from('livrables')
        .select('id', { count: 'exact', head: true })
        .is('deleted_at', null)
        .not('statut', 'in', '("livre","archive")')

      const { count: nbContacts } = await supabase
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('actif', true)

      let statsFinance = {}
      if (canSeeFinance) {
        const { data: factures } = await supabase
          .from('factures')
          .select('montant_ttc, statut')
          .in('statut', ['envoyee', 'en_attente'])

        statsFinance = {
          facturesEnAttente: factures?.length || 0,
          montantEnAttente: factures?.reduce((s, f) => s + (f.montant_ttc || 0), 0) || 0,
        }
      }

      setProjets(projs || [])
      setStats({
        projetsActifs: nbActifs || 0,
        livrables: nbLivrables || 0,
        contacts: nbContacts || 0,
        ...statsFinance,
      })
    } finally {
      setLoading(false)
    }
  }, [org, canSeeFinance])

  useEffect(() => {
    if (org?.id) load()
  }, [org, load])

  const firstName = profile?.full_name?.split(' ')[0] || profile?.prenom || 'Hugo'

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--txt)' }}>
            {greeting()}, {firstName} 👋
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {new Date().toLocaleDateString('fr-FR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>
        {isInternal && (
          <Link
            to="/projets"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: 'var(--blue)', color: 'white' }}
          >
            <Plus className="w-4 h-4" />
            Nouveau projet
          </Link>
        )}
      </div>

      {/* ── Stats ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4 animate-pulse h-24"
              style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard
            icon={FolderOpen}
            color="blue"
            label="Projets en cours"
            value={stats.projetsActifs}
          />
          <StatCard icon={Users} color="purple" label="Crew actifs" value={stats.contacts} />
          <StatCard
            icon={CheckSquare}
            color="amber"
            label="Livrables en cours"
            value={stats.livrables}
          />
          {canSeeFinance && (
            <StatCard
              icon={Receipt}
              color="red"
              restricted
              label="Factures en attente"
              value={stats.facturesEnAttente}
              sub={stats.montantEnAttente > 0 ? fmtEur(stats.montantEnAttente) : null}
            />
          )}
        </div>
      )}

      {/* ── Contenu principal (2 colonnes) ─────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Projets actifs — colonne large */}
        <div className="lg:col-span-2">
          <SectionTitle>Projets en cours</SectionTitle>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
            {loading ? (
              <div className="p-8 text-center" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </div>
            ) : projets.length === 0 ? (
              <div className="p-10 text-center">
                <FolderOpen className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
                <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                  {isInternal ? 'Aucun projet actif' : 'Aucun projet assigné pour le moment'}
                </p>
                {isInternal && (
                  <Link
                    to="/projets"
                    className="inline-flex items-center gap-1 text-sm font-medium mt-3"
                    style={{ color: 'var(--blue)' }}
                  >
                    <Plus className="w-4 h-4" /> Créer un projet
                  </Link>
                )}
              </div>
            ) : (
              projets.map((p, i) => (
                <Link
                  key={p.id}
                  to={`/projets/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors"
                  style={{
                    background: i % 2 === 0 ? 'var(--bg-surf)' : 'transparent',
                    borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background =
                      i % 2 === 0 ? 'var(--bg-surf)' : 'transparent')
                  }
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: STATUS_DOT[p.status] || 'var(--txt-3)' }}
                    />
                    <ProjectAvatar project={p} size={36} rounded="lg" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
                        {p.title}
                      </p>
                      <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                        {p.clients?.nom_commercial || '—'}
                        {p.date_fin && <span> · fin {fmtDate(p.date_fin)}</span>}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 ml-3">
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        background: STATUS_DOT[p.status] + '22',
                        color: STATUS_DOT[p.status],
                      }}
                    >
                      {STATUS_LABEL[p.status] || p.status}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
                  </div>
                </Link>
              ))
            )}

            {/* Voir tous */}
            {projets.length > 0 && (
              <Link
                to="/projets"
                className="flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors"
                style={{
                  borderTop: '1px solid var(--brd-sub)',
                  color: 'var(--txt-3)',
                  background: 'var(--bg-surf)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--blue)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--txt-3)'
                }}
              >
                Voir tous les projets <ArrowRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>

        {/* Colonne droite */}
        <div className="space-y-6">
          {/* Deadlines à venir — widget livrables (LIV-18) */}
          <div>
            <SectionTitle>Deadlines à venir</SectionTitle>
            <LivrablesGlobalWidget orgId={org?.id} daysAhead={14} limit={8} />
          </div>

          {/* Actions rapides */}
          <div>
            <SectionTitle>Actions rapides</SectionTitle>
            <div className="space-y-2">
              {isInternal && (
                <>
                  <QuickAction
                    to="/projets"
                    icon={FolderOpen}
                    label="Nouveau projet"
                    color="blue"
                  />
                  <QuickAction to="/crew" icon={Users} label="Ajouter au Crew" color="purple" />
                </>
              )}
              {canSeeFinance && (
                <QuickAction to="/compta" icon={Receipt} label="Voir les factures" color="amber" />
              )}
              {!isInternal && (
                <QuickAction to="/projets" icon={FolderOpen} label="Mes projets" color="blue" />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickAction({ to, icon: Icon, label, color }) {
  const colors = {
    blue: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
    purple: { bg: 'rgba(156,95,253,.12)', fg: 'var(--purple)' },
    amber: { bg: 'rgba(255,159,10,.12)', fg: 'var(--amber)' },
  }
  const c = colors[color] || colors.blue
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = c.fg
        e.currentTarget.style.background = c.bg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--brd)'
        e.currentTarget.style.background = 'var(--bg-surf)'
      }}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
        style={{ background: c.bg }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: c.fg }} />
      </div>
      {label}
      <ArrowRight className="w-3.5 h-3.5 ml-auto" style={{ color: 'var(--txt-3)' }} />
    </Link>
  )
}

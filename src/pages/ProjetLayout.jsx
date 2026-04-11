/**
 * ProjetLayout — Layout partagé pour toutes les vues d'un projet
 * Banner KPI en haut + navigation par onglets
 */
import { useState, useEffect, createContext, useContext } from 'react'
import { useParams, useNavigate, useLocation, Outlet, Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useProjectPermissions } from '../hooks/useProjectPermissions'
import { calcSynthese, fmtEur, fmtPct, TAUX_DEFAUT } from '../lib/cotisations'
import {
  ChevronLeft, TrendingUp, Euro, FileText,
  Settings, BarChart3, Receipt, Activity, Users,
  Calendar, Clapperboard, CheckSquare, Shield,
} from 'lucide-react'

// ─── Contexte projet partagé entre les onglets ────────────────────────────────
const ProjetContext = createContext(null)
export const useProjet = () => useContext(ProjetContext)

// ─── Définition des onglets ───────────────────────────────────────────────────
// finance: true → masqué pour coordinateur et prestataire
// outil    → clé de outils_catalogue pour filtrage par permission (prestataire)
// admin   → onglet admin/manager uniquement (admin + charge_prod attaché)
const ALL_TABS = [
  { key: 'projet',      label: 'Projet',       icon: Settings,     path: 'projet',      finance: false, outil: 'projet_info' },
  { key: 'devis',       label: 'Devis',        icon: FileText,     path: 'devis',       finance: true,  outil: null          },
  { key: 'equipe',      label: 'Équipe',       icon: Users,        path: 'equipe',      finance: false, outil: 'equipe'      },
  { key: 'planning',    label: 'Planning',     icon: Calendar,     path: 'planning',    finance: false, outil: 'planning'    },
  { key: 'production',  label: 'Production',   icon: Clapperboard, path: 'production',  finance: false, outil: 'production'  },
  { key: 'livrables',   label: 'Livrables',    icon: CheckSquare,  path: 'livrables',   finance: false, outil: 'livrables'   },
  { key: 'budget',      label: 'Budget réel',  icon: Activity,     path: 'budget',      finance: true,  outil: null          },
  { key: 'factures',    label: 'Factures',     icon: Receipt,      path: 'factures',    finance: true,  outil: null          },
  { key: 'dashboard',   label: 'Dashboard',    icon: BarChart3,    path: 'dashboard',   finance: true,  outil: null          },
  { key: 'access',      label: 'Accès',        icon: Shield,       path: 'access',      finance: false, outil: null, admin: true },
]

// ─── Composant principal ──────────────────────────────────────────────────────
export default function ProjetLayout() {
  const { id } = useParams()
  const location = useLocation()
  const navigate  = useNavigate()
  const { org, canSeeFinance, isPrestataire, isAdmin, isChargeProd } = useAuth()

  // Permissions par projet (chantier 3B) : chargées depuis project_access +
  // project_access_permissions via Supabase
  const {
    loading: permLoading,
    isAttached,
    canSee: canSeeOutil,
  } = useProjectPermissions(id)

  // Filtrer les onglets selon le rôle et les permissions par outil
  //  1) Onglets finance : masqués si l'utilisateur n'a pas accès à la finance
  //  2) Onglets "outil" : pour les prestataires, masqués si pas de droit read
  //     (les rôles internes bypassent dans le hook)
  //  3) Onglets "admin" : visibles uniquement admin + charge_prod attaché
  const canManageAccess = isAdmin || (isChargeProd && isAttached)
  const TABS = ALL_TABS.filter(t => {
    if (t.admin && !canManageAccess) return false
    if (t.finance && !canSeeFinance) return false
    if (isPrestataire && t.outil && !canSeeOutil(t.outil)) return false
    return true
  })

  const [project,    setProject]    = useState(null)
  const [devisList,  setDevisList]  = useState([])
  const [devisStats, setDevisStats] = useState({})
  const [loading,    setLoading]    = useState(true)

  useEffect(() => { loadAll() }, [id])

  async function loadAll() {
    setLoading(true)
    try {
      const { data: proj } = await supabase
        .from('projects')
        .select('*, clients(*)')
        .eq('id', id)
        .single()
      setProject(proj)

      const { data: dvs } = await supabase
        .from('devis')
        .select('*')
        .eq('project_id', id)
        .order('version_number')
      setDevisList(dvs || [])

      if (dvs?.length) {
        const { data: lines } = await supabase
          .from('devis_lines')
          .select('*')
          .in('devis_id', dvs.map(d => d.id))

        const stats = {}
        for (const dv of dvs) {
          const dvLines = (lines || []).filter(l => l.devis_id === dv.id)
          stats[dv.id] = calcSynthese(
            dvLines,
            dv.tva_rate    || 20,
            dv.acompte_pct || 30,
            TAUX_DEFAUT,
            {
              marge_globale_pct:      dv.marge_globale_pct,
              assurance_pct:          dv.assurance_pct,
              remise_globale_pct:     dv.remise_globale_pct,
              remise_globale_montant: dv.remise_globale_montant,
            }
          )
        }
        setDevisStats(stats)
      }
    } finally {
      setLoading(false)
    }
  }

  // Dévis de référence : accepté en priorité, sinon le plus récent
  const refDevis  = devisList.find(d => d.status === 'accepte') || devisList[devisList.length - 1]
  const refSynth  = refDevis ? devisStats[refDevis.id] : null

  // Onglet actif depuis l'URL
  const pathSegments = location.pathname.split('/')
  const afterId      = pathSegments[pathSegments.indexOf(id) + 1]
  const activeTab    = TABS.find(t => t.key === afterId)?.key || 'projet'

  // Contexte partagé avec les onglets enfants
  const ctx = {
    project, setProject,
    devisList, setDevisList,
    devisStats, setDevisStats,
    refDevis, refSynth,
    reload: loadAll,
    projectId: id,
  }

  // Déterminer si on est dans l'éditeur de devis (plein écran)
  const isDevisEditor = location.pathname.includes('/devis/') &&
    pathSegments[pathSegments.length - 1] !== 'devis'

  if (loading || permLoading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  // RLS côté Supabase renvoie déjà NULL pour un projet auquel l'utilisateur
  // n'a pas accès (→ project === null). On ajoute en plus le garde-fou
  // isAttached du hook (défense en profondeur).
  if (!project || !isAttached) {
    return <Navigate to="/unauthorized" replace state={{ from: location.pathname }} />
  }

  // Garde-fou route-level : si l'URL cible un onglet qui n'est pas dans la
  // liste autorisée (TABS déjà filtrée par rôle/outil), on redirige vers le
  // premier onglet accessible. Évite qu'un prestataire accède à /devis ou
  // /budget en tapant l'URL manuellement.
  // On ignore les sous-routes de devis (ex: /devis/:devisId) qui sont gérées
  // séparément par l'éditeur de devis plein écran.
  if (afterId && !TABS.some(t => t.key === afterId) && !isDevisEditor) {
    const fallback = TABS[0]?.path || 'projet'
    return <Navigate to={`/projets/${id}/${fallback}`} replace />
  }

  return (
    <ProjetContext.Provider value={ctx}>
      <div className={`flex flex-col ${isDevisEditor ? 'h-screen overflow-hidden' : 'min-h-full'}`}>

        {/* ── Banner ──────────────────────────────────────────────────────── */}
        <div className="text-white shrink-0" style={{ background: 'linear-gradient(135deg, var(--bg-side) 0%, var(--bg-surf) 100%)', borderBottom: '1px solid var(--brd)' }}>
          <div className="px-5 py-3 flex items-center justify-between">
            {/* Gauche : breadcrumb + identité projet */}
            <div className="flex items-center gap-4 min-w-0">
              <Link
                to="/projets"
                className="flex items-center gap-1 text-slate-400 hover:text-white text-xs transition-colors shrink-0"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Projets
              </Link>

              <div className="w-px h-8 bg-slate-600 shrink-0" />

              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  {project?.clients?.name && (
                    <span className="text-slate-400 text-xs truncate">{project.clients.name}</span>
                  )}
                  {project?.clients?.name && <span className="text-slate-600 text-xs">·</span>}
                  <h1 className="text-sm font-bold text-white truncate">{project?.title || '—'}</h1>
                  {project?.ref_projet && (
                    <span className="text-xs text-slate-400 font-mono">{project.ref_projet}</span>
                  )}
                  <ProjectStatusBadge status={project?.status} />
                </div>
                {project?.type_projet && (
                  <p className="text-xs text-slate-500 mt-0.5">{project.type_projet}</p>
                )}
              </div>
            </div>

            {/* Droite : KPIs devis de référence (finance uniquement) */}
            {canSeeFinance && refSynth ? (
              <div className="flex items-center gap-6 shrink-0 ml-4">
                <BannerKpi
                  label={refDevis?.status === 'accepte' ? 'Budget accepté HT' : `Budget V${refDevis?.version_number} HT`}
                  value={fmtEur(refSynth.totalHTFinal)}
                  icon={<Euro className="w-3.5 h-3.5" />}
                  color="blue"
                />
                <BannerKpi
                  label="Marge estimée"
                  value={fmtPct(refSynth.pctMargeFinale)}
                  sub={fmtEur(refSynth.margeFinale)}
                  icon={<TrendingUp className="w-3.5 h-3.5" />}
                  color={refSynth.pctMargeFinale < 0 ? 'red' : refSynth.pctMargeFinale > 0.25 ? 'green' : 'amber'}
                />
                <div className="text-right hidden lg:block">
                  <p className="text-[10px] text-slate-500 uppercase tracking-wide">Devis</p>
                  <p className="text-xs font-medium text-slate-300">{devisList.length} version{devisList.length > 1 ? 's' : ''}</p>
                </div>
              </div>
            ) : canSeeFinance ? (
              <div className="text-xs text-slate-500 italic shrink-0 ml-4">Aucun devis</div>
            ) : null}
          </div>

          {/* ── Navigation onglets ──────────────────────────────────────── */}
          <div className="flex items-end px-5 gap-0.5" style={{ borderTop: '1px solid var(--brd-sub)' }}>
            {TABS.map(tab => {
              const Icon = tab.icon
              const isActive = tab.key === activeTab
              return (
                <Link
                  key={tab.key}
                  to={`/projets/${id}/${tab.path}`}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-all duration-150 whitespace-nowrap border-b-2"
                  style={isActive
                    ? { borderColor: 'var(--blue)', color: 'var(--blue)', background: 'var(--blue-bg)' }
                    : { borderColor: 'transparent', color: 'var(--txt-3)' }
                  }
                  onMouseEnter={e => { if (!isActive) { e.currentTarget.style.color = 'var(--txt-2)'; e.currentTarget.style.borderColor = 'var(--brd)' } }}
                  onMouseLeave={e => { if (!isActive) { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.borderColor = 'transparent' } }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                  {tab.key === 'devis' && devisList.length > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                      style={isActive
                        ? { background: 'var(--blue)', color: 'white' }
                        : { background: 'var(--bg-elev)', color: 'var(--txt-2)' }
                      }
                    >
                      {devisList.length}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        </div>

        {/* ── Contenu de l'onglet ──────────────────────────────────────────── */}
        <div className={`flex-1 ${isDevisEditor ? 'overflow-hidden flex flex-col' : 'overflow-auto'}`}>
          <Outlet context={ctx} />
        </div>
      </div>
    </ProjetContext.Provider>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function BannerKpi({ label, value, sub, icon, color }) {
  const colors = {
    blue:  'text-blue-300',
    green: 'text-green-300',
    amber: 'text-amber-300',
    red:   'text-red-300',
  }
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1 mb-0.5">
        <span className={`${colors[color]} opacity-70`}>{icon}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-sm font-bold ${colors[color]}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-500">{sub}</p>}
    </div>
  )
}

function ProjectStatusBadge({ status }) {
  const map = {
    prospect: 'bg-amber-500/20 text-amber-300',
    en_cours: 'bg-blue-500/20 text-blue-300',
    termine:  'bg-green-500/20 text-green-300',
    annule:   'bg-gray-500/20 text-gray-400',
  }
  const labels = { prospect:'Prospect', en_cours:'En cours', termine:'Terminé', annule:'Annulé', archive:'Archivé' }
  if (!status) return null
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${map[status] || 'bg-gray-500/20 text-gray-400'}`}>
      {labels[status] || status}
    </span>
  )
}

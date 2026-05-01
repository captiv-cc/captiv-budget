/**
 * ProjetLayout — Layout partagé pour toutes les vues d'un projet
 *
 * Structure (refonte UI-1, avril 2026) :
 *
 *   ┌──────────────┬────────────────────────────────────────┐
 *   │ ProjectSide- │  Banner (breadcrumb + titre + status) │
 *   │ Nav          │  ─────────────────────────────────────│
 *   │ (onglets     │                                        │
 *   │  verticaux   │  Outlet — contenu de l'onglet         │
 *   │  groupés)    │                                        │
 *   └──────────────┴────────────────────────────────────────┘
 *
 * La sidebar projet remplace l'ancienne tab bar horizontale : les 10 onglets
 * sont groupés en 5 sections thématiques (voir ProjectSideNav.jsx). Sur
 * mobile (<640px) elle bascule en drawer, déclenché par l'icône hamburger du
 * banner.
 */
import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  createContext,
  useContext,
} from 'react'
import { useParams, useLocation, Outlet, Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useAppTheme } from '../hooks/useAppTheme'
import { pickOrgLogo } from '../lib/branding'
import { notify } from '../lib/notify'
import { useProjectPermissions } from '../hooks/useProjectPermissions'
import useBreakpoint from '../hooks/useBreakpoint'
import { calcSynthese, TAUX_DEFAUT } from '../lib/cotisations'
import { applyCategoryDansMarge } from '../lib/devisLines'
import { pickRefDevis, groupDevisByLot, computeLotStatus } from '../lib/lots'
import { healOrphanMembres } from '../lib/healOrphanMembres'
import {
  ChevronLeft,
  FileText,
  LayoutDashboard,
  BarChart3,
  Receipt,
  Activity,
  Users,
  Calendar,
  Clapperboard,
  CheckSquare,
  Package,
  Shield,
  Menu,
} from 'lucide-react'
import StatusBadgeMenu from '../features/projets/components/StatusBadgeMenu'
import ProjectSideNav from '../components/ProjectSideNav'
import { buildGlobalNavSections } from '../lib/globalNav'

// ─── Contexte projet partagé entre les onglets ────────────────────────────────
const ProjetContext = createContext(null)
export const useProjet = () => useContext(ProjetContext)

// ─── Définition des onglets ───────────────────────────────────────────────────
// finance: true → masqué pour coordinateur et prestataire (legacy, conservé
//                 en filet de sécurité mais plus utilisé par défaut depuis
//                 BUDGET-PERM — les 4 onglets financiers utilisent désormais
//                 `outil` pour gater par permission granulaire).
// outil    → clé de outils_catalogue pour filtrage par permission (prestataire)
// admin   → onglet admin/manager uniquement (admin + charge_prod attaché)
//
// BUDGET-PERM (2026-04-20) — clés outil pour les onglets financiers :
//   Devis                            → 'devis'
//   Budget réel + Factures + Dashboard → 'budget'
// Les internes (admin/charge_prod/coordinateur) attachés bypassent via
// can_read_outil/can_edit_outil (cf. ch3b_project_access.sql).
const ALL_TABS = [
  {
    key: 'projet',
    label: 'Projet',
    icon: LayoutDashboard,
    path: 'projet',
    finance: false,
    outil: 'projet_info',
  },
  {
    key: 'devis',
    label: 'Devis',
    icon: FileText,
    path: 'devis',
    finance: false,
    outil: 'devis',
  },
  { key: 'equipe', label: 'Équipe', icon: Users, path: 'equipe', finance: false, outil: 'equipe' },
  {
    key: 'planning',
    label: 'Planning',
    icon: Calendar,
    path: 'planning',
    finance: false,
    outil: 'planning',
  },
  {
    key: 'production',
    label: 'Production',
    icon: Clapperboard,
    path: 'production',
    finance: false,
    outil: 'production',
  },
  {
    key: 'livrables',
    label: 'Livrables',
    icon: CheckSquare,
    path: 'livrables',
    finance: false,
    outil: 'livrables',
  },
  {
    key: 'materiel',
    label: 'Matériel',
    icon: Package,
    path: 'materiel',
    finance: false,
    outil: 'materiel',
  },
  {
    key: 'budget',
    label: 'Budget réel',
    icon: Activity,
    path: 'budget',
    finance: false,
    outil: 'budget',
  },
  {
    key: 'factures',
    label: 'Factures',
    icon: Receipt,
    path: 'factures',
    finance: false,
    outil: 'budget',
  },
  {
    key: 'dashboard',
    label: 'Dashboard',
    icon: BarChart3,
    path: 'dashboard',
    finance: false,
    outil: 'budget',
  },
  {
    key: 'access',
    label: 'Accès',
    icon: Shield,
    path: 'access',
    finance: false,
    outil: null,
    admin: true,
  },
]

// ─── Composant principal ──────────────────────────────────────────────────────
export default function ProjetLayout() {
  const { id } = useParams()
  const location = useLocation()
  const { org, canSeeFinance, isPrestataire, isAdmin, isChargeProd, isInternal, appSettings } = useAuth()
  const theme = useAppTheme()
  // Logo header projet : choix délégué à pickOrgLogo() qui gère la cascade
  // selon le theme courant (dark aujourd'hui, dark/light demain).
  const headerLogo = pickOrgLogo(org, theme)
  const headerLogoAlt = appSettings?.product_name || 'CAPTIV DESK'

  // Permissions par projet (chantier 3B) : chargées depuis project_access +
  // project_access_permissions via Supabase
  const { loading: permLoading, isAttached, canSee: canSeeOutil } = useProjectPermissions(id)

  // Filtrer les onglets selon le rôle et les permissions par outil
  //  1) Onglets finance : masqués si l'utilisateur n'a pas accès à la finance
  //  2) Onglets "outil" : pour les prestataires, masqués si pas de droit read
  //     (les rôles internes bypassent dans le hook)
  //  3) Onglets "admin" : visibles uniquement admin + charge_prod attaché
  const canManageAccess = isAdmin || (isChargeProd && isAttached)
  const TABS = ALL_TABS.filter((t) => {
    if (t.admin && !canManageAccess) return false
    if (t.finance && !canSeeFinance) return false
    if (isPrestataire && t.outil && !canSeeOutil(t.outil)) return false
    return true
  })

  const bannerRef = useRef(null)
  const [bannerHeight, setBannerHeight] = useState(0)

  // Mesurer la hauteur du banner pour le sticky des sous-composants
  useEffect(() => {
    if (!bannerRef.current) return
    const ro = new ResizeObserver(([entry]) => {
      setBannerHeight(entry.contentRect.height + 1) // +1 pour le border-bottom
    })
    ro.observe(bannerRef.current)
    return () => ro.disconnect()
  }, [])

  const [project, setProject] = useState(null)
  const [lots, setLots] = useState([])
  const [devisList, setDevisList] = useState([])
  const [devisStats, setDevisStats] = useState({})
  const [loading, setLoading] = useState(true)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { data: proj } = await supabase
        .from('projects')
        .select('*, clients(*)')
        .eq('id', id)
        .single()
      setProject(proj)

      // Chargement parallèle lots + devis
      const [{ data: lts }, { data: dvs }] = await Promise.all([
        supabase
          .from('devis_lots')
          .select('*')
          .eq('project_id', id)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('devis')
          .select('*')
          .eq('project_id', id)
          .order('version_number', { ascending: true }),
      ])
      setLots(lts || [])
      setDevisList(dvs || [])

      if (dvs?.length) {
        // Lignes ET catégories : on a besoin des catégories pour propager
        // `dans_marge` aux lignes (via applyCategoryDansMarge), sinon le
        // calcul d'ici diverge de celui du DevisEditor.
        const dvIds = dvs.map((d) => d.id)
        const [{ data: lines }, { data: cats }] = await Promise.all([
          supabase.from('devis_lines').select('*').in('devis_id', dvIds),
          supabase.from('devis_categories').select('*').in('devis_id', dvIds),
        ])

        const stats = {}
        for (const dv of dvs) {
          const dvLines = (lines || []).filter((l) => l.devis_id === dv.id)
          const dvCats = (cats || []).filter((c) => c.devis_id === dv.id)
          const normalizedLines = applyCategoryDansMarge(dvLines, dvCats)
          stats[dv.id] = calcSynthese(
            normalizedLines,
            dv.tva_rate || 20,
            dv.acompte_pct || 30,
            TAUX_DEFAUT,
            {
              marge_globale_pct: dv.marge_globale_pct,
              assurance_pct: dv.assurance_pct,
              remise_globale_pct: dv.remise_globale_pct,
              remise_globale_montant: dv.remise_globale_montant,
            },
          )
        }
        setDevisStats(stats)
      } else {
        setDevisStats({})
      }

      // Auto-heal : rebind les projet_membres orphelins vers les lignes du
      // refDevis courant. Idempotent (no-op si tout est d\u00e9j\u00e0 propre).
      // Couvre tous les cas de changement de version (V1\u2192V2, V2\u2192V1, etc.)
      // et b\u00e9n\u00e9ficie \u00e0 TOUS les onglets enfants (Budget r\u00e9el, \u00c9quipe, Dashboard...)
      try {
        await healOrphanMembres(id)
      } catch (e) {
        // Ne pas bloquer le chargement du projet si le heal \u00e9choue
        console.error('[ProjetLayout] healOrphanMembres failed', e)
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadAll()
  }, [id, loadAll])

  // Changement de statut depuis le badge du breadcrumb (optimistic)
  async function updateStatus(_projectId, newStatus) {
    const previous = project
    setProject({ ...project, status: newStatus })
    const { error, data } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', id)
      .select('*, clients(*)')
      .single()
    if (error) {
      console.error('[ProjetLayout] status update:', error)
      setProject(previous)
      notify.error('Impossible de mettre à jour le statut : ' + error.message)
    } else if (data) {
      setProject(data)
    }
  }

  // ── Calculs dérivés multi-lots ────────────────────────────────────────────
  // devisByLot : { [lotId]: devis[] trié par version_number ASC }
  const devisByLot = useMemo(() => groupDevisByLot(lots, devisList), [lots, devisList])

  // refDevisByLot : { [lotId]: devis } — devis de référence de chaque lot
  const refDevisByLot = useMemo(() => {
    const map = {}
    for (const lot of lots) {
      const ref = pickRefDevis(devisByLot[lot.id])
      if (ref) map[lot.id] = ref
    }
    return map
  }, [lots, devisByLot])

  // refSynthByLot : { [lotId]: synth } — synthèse calculée pour chaque refDevis
  const refSynthByLot = useMemo(() => {
    const map = {}
    for (const [lotId, dv] of Object.entries(refDevisByLot)) {
      if (devisStats[dv.id]) map[lotId] = devisStats[dv.id]
    }
    return map
  }, [refDevisByLot, devisStats])

  // lotStatusMap : { [lotId]: statut dérivé } — voir lots.js
  const lotStatusMap = useMemo(() => {
    const map = {}
    for (const lot of lots) {
      map[lot.id] = computeLotStatus(lot, devisByLot[lot.id] || [])
    }
    return map
  }, [lots, devisByLot])

  // Onglet actif depuis l'URL
  const pathSegments = location.pathname.split('/')
  const afterId = pathSegments[pathSegments.indexOf(id) + 1]
  const activeTab = TABS.find((t) => t.key === afterId)?.key || 'projet'

  // Contexte partagé avec les onglets enfants
  const ctx = {
    project,
    setProject,
    // Multi-lots (nouveau)
    lots,
    setLots,
    devisByLot,
    refDevisByLot,
    refSynthByLot,
    lotStatusMap,
    // Devis "à plat" (conservé — certains écrans l'utilisent encore)
    devisList,
    setDevisList,
    devisStats,
    setDevisStats,
    // Utilitaires
    reload: loadAll,
    projectId: id,
    bannerHeight,
  }

  // Déterminer si on est dans l'éditeur de devis (plein écran)
  const isDevisEditor =
    location.pathname.includes('/devis/') && pathSegments[pathSegments.length - 1] !== 'devis'

  // Raccourci vers l'éditeur si un seul devis sur le projet (mono-lot mono-version).
  // Sinon on tombe sur la liste (accordéon par lot).
  const singleDevisHref =
    devisList.length === 1 ? `/projets/${id}/devis/${devisList[0].id}` : null

  // Breakpoint : drawer mobile (<640px), sidebar inline au-delà
  const bp = useBreakpoint()
  const isMobile = bp.isMobile
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Sections de nav globale à afficher dans le drawer mobile uniquement
  // (Accueil, Projets, BDD, Finance, Admin). En desktop la sidebar globale
  // 64px à gauche remplit ce rôle → on passe null au composant non-mobile.
  // useMemo car buildGlobalNavSections renvoie un nouveau tableau à chaque
  // appel, et on ne veut pas recréer la référence à chaque render.
  const globalNavSections = useMemo(
    () => buildGlobalNavSections({ isInternal, canSeeFinance, isAdmin }),
    [isInternal, canSeeFinance, isAdmin],
  )

  // Referme le drawer au changement d'onglet (sécurité si ProjectSideNav n'a pas
  // intercepté le clic — ex: navigation programmatique ou history back).
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  if (loading || permLoading)
    return (
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
  if (afterId && !TABS.some((t) => t.key === afterId) && !isDevisEditor) {
    const fallback = TABS[0]?.path || 'projet'
    return <Navigate to={`/projets/${id}/${fallback}`} replace />
  }

  return (
    <ProjetContext.Provider value={ctx}>
      <div className={`flex ${isDevisEditor ? 'h-screen overflow-hidden' : 'min-h-full'}`}>
        {/* ── Sidebar latérale projet (desktop/tablet inline) ─────────────── */}
        {!isMobile && (
          <ProjectSideNav
            projectId={id}
            tabs={TABS}
            activeTab={activeTab}
            devisCount={devisList.length}
            singleDevisHref={singleDevisHref}
          />
        )}

        {/* ── Colonne droite : banner + contenu ───────────────────────────── */}
        <div
          className={`flex flex-col flex-1 min-w-0 ${
            isDevisEditor ? 'overflow-hidden' : ''
          }`}
        >
          {/* Banner sticky (breadcrumb + titre + status) */}
          <div
            ref={bannerRef}
            className="text-white shrink-0"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 40,
              background: 'linear-gradient(135deg, var(--bg-side) 0%, var(--bg-surf) 100%)',
              borderBottom: '1px solid var(--brd)',
            }}
          >
            <div className="px-5 py-3 flex items-center justify-between gap-3">
              {/* Gauche : hamburger (mobile) + breadcrumb + identité projet */}
              <div className="flex items-center gap-3 min-w-0">
                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(true)}
                    aria-label="Ouvrir le menu du projet"
                    className="flex items-center justify-center rounded-md shrink-0"
                    style={{
                      width: '32px',
                      height: '32px',
                      color: 'var(--txt-2)',
                      background: 'var(--bg-hov)',
                      border: '1px solid var(--brd-sub)',
                    }}
                  >
                    <Menu className="w-4 h-4" />
                  </button>
                )}

                {/* Logo captiv. mobile — cohérence cross-pages : le top bar de
                    Layout.jsx (pages hors projet) affiche aussi [burger + logo].
                    En projet on empile ensuite le titre + status badge à droite,
                    ce qui donne : [☰] captiv. <titre> [statut]. Caché en ≥sm
                    car la sidebar globale 64px porte déjà le logo. */}
                <img
                  src={headerLogo}
                  alt={headerLogoAlt}
                  className="sm:hidden shrink-0"
                  style={{
                    maxHeight: '20px',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />

                {/* Retour Projets + separator + meta (client/ref) → cachés sous sm :
                    sur mobile l'espace est précieux et le drawer contient déjà
                    un lien direct vers /projets. On garde juste hamburger + logo
                    + titre + status badge sur une seule ligne. */}
                <Link
                  to="/projets"
                  className="hidden sm:flex items-center gap-1 text-slate-400 hover:text-white text-xs transition-colors shrink-0"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Projets
                </Link>

                <div className="hidden sm:block w-px h-8 bg-slate-600 shrink-0" />

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {project?.clients?.nom_commercial && (
                      <span className="hidden sm:inline text-slate-400 text-xs truncate">
                        {project.clients.nom_commercial}
                      </span>
                    )}
                    {project?.clients?.nom_commercial && (
                      <span className="hidden sm:inline text-slate-600 text-xs">·</span>
                    )}
                    <h1 className="text-sm font-bold text-white truncate">{project?.title || '—'}</h1>
                    {project?.ref_projet && (
                      <span className="hidden sm:inline text-xs text-slate-400 font-mono">
                        {project.ref_projet}
                      </span>
                    )}
                    {project && (
                      <StatusBadgeMenu
                        project={project}
                        onChange={updateStatus}
                        canEdit={isAdmin || isChargeProd}
                        align="left"
                      />
                    )}
                  </div>
                  {project?.types_projet?.length > 0 && (
                    <p className="hidden sm:block text-xs text-slate-500 mt-0.5">
                      {project.types_projet.join(' · ')}
                    </p>
                  )}
                </div>
              </div>

              {/* KPIs header supprimés — les infos budget/marge/versions
                  sont déjà visibles dans les onglets Devis et Budget Réel.
                  Les onglets ont migré vers la sidebar latérale (chantier UI-1). */}
            </div>
          </div>

          {/* ── Contenu de l'onglet ──────────────────────────────────────── */}
          <div className={`flex-1 min-w-0 ${isDevisEditor ? 'overflow-hidden flex flex-col' : ''}`}>
            <Outlet context={ctx} />
          </div>
        </div>

        {/* ── Drawer mobile (overlay) ─────────────────────────────────────── */}
        {/* On injecte globalNavSections : en mobile la sidebar globale 64px
            est cachée (cf. Layout.jsx), donc le drawer est le seul endroit où
            l'utilisateur peut rejoindre Accueil / Projets / BDD / Finance. */}
        {isMobile && (
          <ProjectSideNav
            projectId={id}
            tabs={TABS}
            activeTab={activeTab}
            devisCount={devisList.length}
            singleDevisHref={singleDevisHref}
            isMobile
            drawerOpen={drawerOpen}
            onCloseDrawer={() => setDrawerOpen(false)}
            globalNavSections={globalNavSections}
          />
        )}
      </div>
    </ProjetContext.Provider>
  )
}


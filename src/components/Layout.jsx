import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  Home, FolderOpen, Users, Package,
  LogOut, Settings, BarChart3, Calculator,
  PanelLeft,
} from 'lucide-react'

// ─── Sections de la sidebar ───────────────────────────────────────────────────
const NAV_MAIN = [
  { to: '/accueil', icon: Home,       label: 'Accueil' },
  { to: '/projets', icon: FolderOpen, label: 'Projets' },
]

const NAV_BDD = [
  { to: '/clients',  icon: Users,    label: 'Clients' },
  { to: '/crew',     icon: Users,    label: 'Crew' },
  { to: '/produits', icon: Package,  label: 'Produits & Matériel' },
]

const NAV_FINANCE = [
  { to: '/dashboard', icon: BarChart3,  label: 'Dashboard' },
  { to: '/compta',    icon: Calculator, label: 'Compta' },
]

const ROLE_LABELS = {
  admin:        'Admin',
  charge_prod:  'Chargé de prod',
  coordinateur: 'Coordinateur',
  prestataire:  'Prestataire',
}

const STORAGE_KEY = 'captiv:sidebar-collapsed'

// ─── Composants ───────────────────────────────────────────────────────────────

function SidebarSection({ label, collapsed }) {
  // En mode collapsed, on affiche un fin séparateur horizontal à la place du
  // label (qui n'aurait plus la place de respirer). Garde la respiration entre
  // groupes sans encombrer.
  if (collapsed) {
    return (
      <div
        className="mx-3 my-3"
        style={{ height: '1px', background: 'var(--brd-sub)' }}
      />
    )
  }
  return (
    <p
      className="px-3 pt-5 pb-1.5 text-[10px] font-semibold uppercase select-none"
      style={{ color: 'var(--txt-3)', letterSpacing: '0.12em' }}
    >
      {label}
    </p>
  )
}

function SidebarLink({ to, icon: Icon, label, collapsed }) {
  return (
    <NavLink
      to={to}
      end={to === '/accueil'}
      title={collapsed ? label : undefined}
      className={`flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
        collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-3 py-2'
      }`}
      style={({ isActive }) => isActive
        // Active : pill plein, sans barre latérale, sans bord
        ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
        : { color: 'var(--txt-2)' }
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

function Initials({ name }) {
  const parts = (name || 'U').split(' ')
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].slice(0, 2)
  return letters.toUpperCase()
}

// ─── Layout principal ─────────────────────────────────────────────────────────
export default function Layout() {
  const { profile, role, canSeeFinance, isAdmin, isInternal, signOut } = useAuth()
  const navigate = useNavigate()

  // État collapsed persisté en localStorage
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0') } catch (_) {}
  }, [collapsed])

  // Les sections BDD et Finance sont réservées aux rôles internes.
  // Un prestataire ne verra que la section principale (Accueil + Projets).
  const showBddSection = isInternal

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>

      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col shrink-0 select-none transition-[width] duration-200 ${
          collapsed ? 'w-16' : 'w-56'
        }`}
        style={{
          background: 'var(--bg-side)',
          borderRight: '1px solid var(--brd-sub)',
        }}
      >
        {/* Header — logo + bouton collapse */}
        <div
          className={`flex items-center ${collapsed ? 'justify-center px-2' : 'justify-between px-4'} py-3.5`}
          style={{ borderBottom: '1px solid var(--brd-sub)', minHeight: '57px' }}
        >
          {!collapsed && (
            <img
              src="/captiv-logo.png"
              alt="CAPTIV"
              style={{ height: '24px', width: 'auto', display: 'block' }}
            />
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? 'Développer la sidebar' : 'Réduire la sidebar'}
            className="flex items-center justify-center rounded-md transition-all"
            style={{
              width: '26px', height: '26px',
              color: 'var(--txt-3)',
              background: 'transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--txt)'; e.currentTarget.style.background = 'var(--bg-hov)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.background = 'transparent' }}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 ${collapsed ? 'px-2' : 'px-2.5'} py-2 overflow-y-auto`}>

          {/* Principal */}
          <div className="space-y-0.5">
            {NAV_MAIN.map(item => <SidebarLink key={item.to} {...item} collapsed={collapsed} />)}
          </div>

          {/* Base de données — interne uniquement */}
          {showBddSection && (
            <>
              <SidebarSection label="Base de données" collapsed={collapsed} />
              <div className="space-y-0.5">
                {NAV_BDD.map(item => <SidebarLink key={item.to} {...item} collapsed={collapsed} />)}
              </div>
            </>
          )}

          {/* Finance — admin & charge_prod uniquement */}
          {canSeeFinance && (
            <>
              <SidebarSection label="Finance" collapsed={collapsed} />
              <div className="space-y-0.5">
                {NAV_FINANCE.map(item => <SidebarLink key={item.to} {...item} collapsed={collapsed} />)}
              </div>
            </>
          )}

          {/* Paramètres — admin uniquement */}
          {isAdmin && (
            <>
              <SidebarSection label="Admin" collapsed={collapsed} />
              <div className="space-y-0.5">
                <SidebarLink to="/parametres" icon={Settings} label="Paramètres" collapsed={collapsed} />
              </div>
            </>
          )}
        </nav>

        {/* User footer — carte unique avec bouton logout intégré (style Jane Cooper) */}
        <div className={`${collapsed ? 'px-2' : 'px-2.5'} py-3`} style={{ borderTop: '1px solid var(--brd-sub)' }}>
          <div
            className={`flex items-center rounded-lg transition-colors ${
              collapsed ? 'justify-center p-1.5' : 'gap-2.5 px-2 py-2'
            }`}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hov)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
              title={collapsed ? `${profile?.full_name || 'Utilisateur'} — ${ROLE_LABELS[role] || role}` : undefined}
            >
              <Initials name={profile?.full_name} />
            </div>

            {!collapsed && (
              <>
                {/* Nom + rôle */}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
                    {profile?.full_name || 'Utilisateur'}
                  </p>
                  <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                    {ROLE_LABELS[role] || role}
                  </p>
                </div>

                {/* Bouton logout aligné à droite */}
                <button
                  onClick={handleSignOut}
                  title="Déconnexion"
                  className="flex items-center justify-center rounded-md shrink-0 transition-all"
                  style={{
                    width: '28px', height: '28px',
                    color: 'var(--txt-3)',
                    background: 'transparent',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--bg-elev)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.background = 'transparent' }}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          {/* En collapsed, le bouton logout passe sous l'avatar pour rester accessible */}
          {collapsed && (
            <button
              onClick={handleSignOut}
              title="Déconnexion"
              className="flex items-center justify-center rounded-md mt-1 mx-auto transition-all"
              style={{
                width: '32px', height: '28px',
                color: 'var(--txt-3)',
                background: 'transparent',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.background = 'var(--bg-hov)' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--txt-3)'; e.currentTarget.style.background = 'transparent' }}
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  )
}

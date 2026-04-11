import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  Home, FolderOpen, Users, Database, Package,
  LogOut, Settings, BarChart3, Receipt,
  ChevronRight,
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
  { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { to: '/compta',    icon: Receipt,   label: 'Compta' },
]

// ─── Composants ───────────────────────────────────────────────────────────────
function SidebarSection({ label }) {
  return (
    <p
      className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-widest select-none"
      style={{ color: 'var(--txt-3)' }}
    >
      {label}
    </p>
  )
}

function SidebarLink({ to, icon: Icon, label }) {
  return (
    <NavLink
      to={to}
      end={to === '/accueil'}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
      style={({ isActive }) => isActive
        ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
        : { color: 'var(--txt-2)' }
      }
    >
      {({ isActive }) => (
        <>
          <span
            className="w-0.5 h-4 rounded-full shrink-0 -ml-1 transition-all"
            style={{ background: isActive ? 'var(--blue)' : 'transparent' }}
          />
          <Icon className="w-4 h-4 shrink-0" />
          <span className="truncate">{label}</span>
        </>
      )}
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

const ROLE_LABELS = {
  admin:        'Admin',
  charge_prod:  'Chargé de prod',
  coordinateur: 'Coordinateur',
  prestataire:  'Prestataire',
}

// ─── Layout principal ─────────────────────────────────────────────────────────
export default function Layout() {
  const { profile, org, role, canSeeFinance, isAdmin, isInternal, signOut } = useAuth()
  const navigate = useNavigate()

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
        className="w-56 flex flex-col shrink-0 select-none"
        style={{
          background: 'var(--bg-side)',
          borderRight: '1px solid var(--brd-sub)',
        }}
      >
        {/* Logo */}
        <div className="px-4 py-3.5" style={{ borderBottom: '1px solid var(--brd-sub)' }}>
          <img
            src="/captiv-logo.png"
            alt="CAPTIV"
            style={{ height: '26px', width: 'auto', display: 'block' }}
          />
          <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>
            {org?.name || 'Budget AV'}
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2.5 py-2 overflow-y-auto">

          {/* Principal */}
          <div className="space-y-0.5">
            {NAV_MAIN.map(item => <SidebarLink key={item.to} {...item} />)}
          </div>

          {/* Base de données — interne uniquement */}
          {showBddSection && (
            <>
              <SidebarSection label="Base de données" />
              <div className="space-y-0.5">
                {NAV_BDD.map(item => <SidebarLink key={item.to} {...item} />)}
              </div>
            </>
          )}

          {/* Finance — admin & charge_prod uniquement */}
          {canSeeFinance && (
            <>
              <SidebarSection label="Finance" />
              <div className="space-y-0.5">
                {NAV_FINANCE.map(item => <SidebarLink key={item.to} {...item} />)}
              </div>
            </>
          )}

          {/* Paramètres — admin uniquement */}
          {isAdmin && (
            <>
              <SidebarSection label="Admin" />
              <div className="space-y-0.5">
                <SidebarLink to="/parametres" icon={Settings} label="Paramètres" />
              </div>
            </>
          )}
        </nav>

        {/* User footer */}
        <div className="px-2.5 py-3" style={{ borderTop: '1px solid var(--brd-sub)' }}>
          {/* Avatar + nom */}
          <div
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg mb-1 cursor-default transition-colors"
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hov)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
            >
              <Initials name={profile?.full_name} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: 'var(--txt)' }}>
                {profile?.full_name || 'Utilisateur'}
              </p>
              <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
                {ROLE_LABELS[role] || role}
              </p>
            </div>
          </div>

          {/* Déconnexion */}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 w-full px-3 py-1.5 rounded-lg text-xs transition-all duration-150"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hov)'; e.currentTarget.style.color = 'var(--red)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--txt-3)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>
        <Outlet />
      </main>
    </div>
  )
}

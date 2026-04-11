import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ErrorBoundary from './components/ErrorBoundary'
import RequireRole from './components/guards/RequireRole'
// RequirePermission est disponible (src/components/guards/RequirePermission.jsx)
// pour les futures routes granulaires outil+action — non utilisé pour l'instant.
import Layout from './components/Layout'
import Login from './pages/Login'
import HomePage from './pages/HomePage'
import Dashboard from './pages/Dashboard'
import Projets from './pages/Projets'
import ProjetLayout from './pages/ProjetLayout'
import Clients from './pages/Clients'
import BDD from './pages/BDD'
import Compta from './pages/Compta'
import Crew  from './pages/Contacts'
import DevisPublic from './pages/DevisPublic'
import Unauthorized from './pages/Unauthorized'
import AcceptInvite from './pages/AcceptInvite'

// ─── Groupes de rôles (alias lisibles pour les gardes) ──────────────────────
const ROLES_FINANCE = ['admin', 'charge_prod']                       // /compta, /dashboard global, /parametres admin
const ROLES_BDD     = ['admin', 'charge_prod', 'coordinateur']       // /clients, /crew, /bdd (interne, pas prestataire)

// Onglets projet
import ProjetTab          from './pages/tabs/ProjetTab'
import DevisTab           from './pages/tabs/DevisTab'
import FacturesTab        from './pages/tabs/FacturesTab'
import BudgetReelTab      from './pages/tabs/BudgetReelTab'
import DashboardProjetTab from './pages/tabs/DashboardProjetTab'
import EquipeTab          from './pages/tabs/EquipeTab'
import PlanningTab        from './pages/tabs/PlanningTab'
import ProductionTab      from './pages/tabs/ProductionTab'
import LivrablesTab       from './pages/tabs/LivrablesTab'
import AccessTab          from './pages/tabs/AccessTab'

// Pages placeholders (à créer si besoin)
function Placeholder({ title }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-12 text-center">
      <p className="text-2xl mb-2">🚧</p>
      <p className="text-sm font-medium" style={{ color: 'var(--txt)' }}>{title}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>Page en cours de construction</p>
    </div>
  )
}

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center h-screen" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }} />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>Chargement…</p>
      </div>
    </div>
  )
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<Login />} />
      <Route path="/devis/public/:token" element={<DevisPublic />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="/accept-invite" element={<AcceptInvite />} />

      {/* Private */}
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        {/* Accueil par défaut */}
        <Route index element={<Navigate to="/accueil" replace />} />
        <Route path="accueil"    element={<HomePage />} />

        {/* Projets — accessible à tous (prestataire voit uniquement les siens, RLS côté ch3B) */}
        <Route path="projets"    element={<Projets />} />

        {/* Base de données — réservé interne (pas prestataire) */}
        <Route path="clients"    element={<RequireRole roles={ROLES_BDD}><Clients /></RequireRole>} />
        <Route path="crew"       element={<RequireRole roles={ROLES_BDD}><Crew /></RequireRole>} />
        <Route path="produits"   element={<RequireRole roles={ROLES_BDD}><BDD /></RequireRole>} />
        <Route path="bdd"        element={<RequireRole roles={ROLES_BDD}><BDD /></RequireRole>} />

        {/* Finance — admin et chargé de prod uniquement */}
        <Route path="dashboard"  element={<RequireRole roles={ROLES_FINANCE}><Dashboard /></RequireRole>} />
        <Route path="compta"     element={<RequireRole roles={ROLES_FINANCE}><Compta /></RequireRole>} />

        {/* Admin uniquement */}
        <Route path="parametres" element={<RequireRole roles={['admin']}><Placeholder title="Paramètres" /></RequireRole>} />

        {/* ── Layout projet avec onglets ─────────────────────────────────── */}
        <Route path="projets/:id" element={<ProjetLayout />}>
          <Route index element={<Navigate to="projet" replace />} />
          <Route path="projet"      element={<ProjetTab />} />
          <Route path="devis"       element={<DevisTab />} />
          <Route path="devis/:devisId" element={<DevisTab />} />
          <Route path="equipe"      element={<EquipeTab />} />
          <Route path="planning"    element={<PlanningTab />} />
          <Route path="production"  element={<ProductionTab />} />
          <Route path="livrables"   element={<LivrablesTab />} />
          <Route path="budget"      element={<BudgetReelTab />} />
          <Route path="factures"    element={<FacturesTab />} />
          <Route path="dashboard"   element={<DashboardProjetTab />} />
          <Route path="access"      element={<RequireRole roles={['admin','charge_prod']}><AccessTab /></RequireRole>} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/accueil" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <Toaster
            position="top-right"
            gutter={8}
            toastOptions={{
              // Styles par défaut appliqués à tous les toasts
              duration: 3500,
              style: {
                background: '#1f2937',
                color: '#f9fafb',
                fontSize: '14px',
                padding: '12px 16px',
                borderRadius: '10px',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.2)',
              },
              success: {
                iconTheme: { primary: '#10b981', secondary: '#ecfdf5' },
              },
              error: {
                duration: 5000,
                iconTheme: { primary: '#ef4444', secondary: '#fef2f2' },
              },
            }}
          />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}

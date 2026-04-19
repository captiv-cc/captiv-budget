/**
 * globalNav — Configuration centralisée de la nav globale (sidebar + drawer).
 *
 * Historiquement définie inline dans Layout.jsx. Extraite ici pour permettre
 * au ProjectSideNav de la réutiliser dans le drawer mobile (chantier UI-1
 * responsive, avril 2026) où la sidebar globale est cachée pour libérer
 * l'écran.
 *
 * Les items dépendent du rôle : `buildGlobalNavSections` filtre les sections
 * selon isInternal / canSeeFinance / isAdmin, comme Layout.jsx le faisait
 * avant, dans le même ordre.
 */
import {
  Home,
  FolderOpen,
  CalendarDays,
  Users,
  Package,
  BarChart3,
  Calculator,
  Settings,
} from 'lucide-react'

// ─── Sections ────────────────────────────────────────────────────────────────

// Planning global (PG-1) placé dans NAV_MAIN entre Projets et la Finance, pour
// rester accessible à tous les rôles (RLS filtre les events côté DB).
export const NAV_MAIN = [
  { to: '/accueil', icon: Home, label: 'Accueil' },
  { to: '/projets', icon: FolderOpen, label: 'Projets' },
  { to: '/planning', icon: CalendarDays, label: 'Planning' },
]

export const NAV_BDD = [
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/crew', icon: Users, label: 'Crew' },
  { to: '/produits', icon: Package, label: 'Produits & Matériel' },
]

export const NAV_FINANCE = [
  { to: '/dashboard', icon: BarChart3, label: 'Dashboard' },
  { to: '/compta', icon: Calculator, label: 'Compta' },
]

export const NAV_ADMIN = [
  { to: '/parametres', icon: Settings, label: 'Paramètres' },
]

// ─── Builder ─────────────────────────────────────────────────────────────────

/**
 * Retourne la liste des sections de nav globale filtrées selon le rôle.
 * Format : [{ label: string|null, items: NavItem[] }, ...].
 * Une section dont le label est null est rendue sans en-tête (cas "Principal").
 *
 * @param {{isInternal: boolean, canSeeFinance: boolean, isAdmin: boolean}} flags
 */
export function buildGlobalNavSections({ isInternal, canSeeFinance, isAdmin }) {
  const sections = [{ label: null, items: NAV_MAIN }]
  if (isInternal) sections.push({ label: 'Base de données', items: NAV_BDD })
  if (canSeeFinance) sections.push({ label: 'Finance', items: NAV_FINANCE })
  if (isAdmin) sections.push({ label: 'Admin', items: NAV_ADMIN })
  return sections
}

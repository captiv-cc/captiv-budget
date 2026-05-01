/**
 * Layout — Sidebar globale permanente (icon-only, 64px).
 *
 * Refonte UI-1 (avril 2026) : la sidebar globale est désormais **toujours
 * réduite en icon-only** (largeur fixe 64px). Plus de bouton toggle, plus de
 * persistance localStorage.
 *
 * Raisons :
 *   - les onglets du projet sont maintenant dans une sidebar latérale dédiée
 *     (ProjectSideNav), qui occupe l'espace utile pour la navigation contextuelle.
 *   - le pattern "3 colonnes" (Intercom / ClickUp) veut que la sidebar globale
 *     soit minimale et stable.
 *   - on gagne en lisibilité : l'utilisateur n'a qu'un seul "repère vertical"
 *     fluctuant (la sidebar projet).
 *
 * Le nom du profil + le rôle, qu'on affichait en expanded, sont désormais
 * accessibles via tooltip au hover sur l'avatar.
 *
 * Responsive mobile (<640px, option B du review UI-1) :
 *   - la sidebar 64px est **toujours cachée** (hidden sm:flex) pour libérer
 *     la largeur de l'écran.
 *   - sur une page projet : c'est ProjetLayout qui rend un banner avec un
 *     bouton hamburger, ouvrant le drawer projet (ProjectSideNav en mode
 *     drawer, avec bascule projet ↔ global).
 *   - sur les autres pages : Layout rend une **top bar mobile** (logo + burger)
 *     qui ouvre le GlobalNavDrawer (nav globale simple, sans bascule).
 *   - pattern mobile-first classique (Notion, Intercom) : 1 burger = 1 menu,
 *     peu importe la page.
 */
import { useEffect, useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useAppTheme } from '../hooks/useAppTheme'
import { pickOrgLogo } from '../lib/branding'
import { notify } from '../lib/notify'
import { LogOut, Menu, Search, Share2 } from 'lucide-react'
import {
  NAV_MAIN,
  NAV_BDD,
  NAV_FINANCE,
  NAV_ADMIN,
  buildGlobalNavSections,
} from '../lib/globalNav'
import GlobalNavDrawer from './GlobalNavDrawer'
import ICalExportDrawer from '../features/planning/ICalExportDrawer'

const ROLE_LABELS = {
  admin: 'Admin',
  charge_prod: 'Chargé de prod',
  coordinateur: 'Coordinateur',
  prestataire: 'Prestataire',
}

// Regex : est-on sur une page projet (ex: /projets/abc-123/projet) ?
// On matche /projets/:id/... et PAS /projets (la liste).
// Sert à décider si Layout doit rendre la top bar mobile (non si on est dans
// un projet, car ProjetLayout a déjà son propre banner + hamburger).
const PROJECT_ROUTE_RE = /^\/projets\/[^/]+\//

// ─── Composants ───────────────────────────────────────────────────────────────

/**
 * Séparateur subtil entre groupes (remplace les labels "Base de données" /
 * "Finance" / "Admin" en mode icon-only permanent).
 */
function SidebarDivider() {
  return <div className="mx-3 my-3" style={{ height: '1px', background: 'var(--brd-sub)' }} />
}

/**
 * Item nav icon-only avec tooltip au hover.
 */
function SidebarLink({ to, icon: Icon, label }) {
  return (
    <div className="relative group">
      <NavLink
        to={to}
        end={to === '/accueil'}
        className="flex items-center justify-center rounded-lg py-2 text-sm font-medium transition-all duration-150"
        style={({ isActive }) =>
          isActive
            ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
            : { color: 'var(--txt-2)' }
        }
      >
        <Icon className="w-4 h-4 shrink-0" />
      </NavLink>

      {/* Tooltip flottant */}
      <span
        className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
          zIndex: 50,
        }}
      >
        {label}
      </span>
    </div>
  )
}

/**
 * Bouton de recherche icon-only avec tooltip. Placeholder pour la future
 * palette de commandes Cmd+K.
 */
function SidebarSearchButton() {
  function handleClick() {
    notify.error(
      '🚧 Recherche globale — fonctionnalité en développement.\n\nElle te permettra bientôt de chercher projets, devis, clients, crew… via Cmd+K.',
    )
  }

  return (
    <div className="relative group">
      <button
        onClick={handleClick}
        className="flex items-center justify-center rounded-lg w-full py-2 transition-colors"
        style={{ color: 'var(--txt-2)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <Search className="w-4 h-4" />
      </button>
      <span
        className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--brd)',
          zIndex: 50,
        }}
      >
        Rechercher (⌘K)
      </span>
    </div>
  )
}

function Initials({ name }) {
  const parts = (name || 'U').split(' ')
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  return letters.toUpperCase()
}

// ─── Layout principal ─────────────────────────────────────────────────────────
export default function Layout() {
  const { profile, role, canSeeFinance, isAdmin, isInternal, signOut, org, appSettings } = useAuth()
  const theme = useAppTheme()
  // Logo affiché en sidebar/header : on délègue à pickOrgLogo() qui gère
  // la cascade clair/sombre/fallback selon le thème courant. Le jour où
  // l'app aura un lightmode global, useAppTheme() basculera et le bon
  // logo sera choisi automatiquement.
  const sidebarLogo = pickOrgLogo(org, theme)
  const sidebarLogoAlt = appSettings?.product_name || 'CAPTIV DESK'
  const navigate = useNavigate()
  const location = useLocation()

  // Les sections BDD et Finance sont réservées aux rôles internes.
  // Un prestataire ne verra que la section principale (Accueil + Projets).
  const showBddSection = isInternal

  // Pour savoir si on doit rendre la top bar mobile (hors projet uniquement —
  // en projet c'est ProjetLayout qui s'en occupe via son propre banner).
  const isInProject = PROJECT_ROUTE_RE.test(location.pathname)

  // Sections de la nav globale pour le drawer mobile, filtrées par rôle.
  // Réutilise le module partagé : identique à ce que la sidebar desktop affiche.
  const globalNavSections = buildGlobalNavSections({
    isInternal,
    canSeeFinance,
    isAdmin,
  })

  // État du drawer global mobile (ouvert/fermé via le burger de la top bar).
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  // Drawer "Mon planning iCal" (PL-8 v1) — accessible depuis la sidebar
  // globale (desktop) et depuis le GlobalNavDrawer (mobile). Monté ici au
  // niveau Layout pour rester utilisable partout, y compris en projet.
  const [icalDrawerOpen, setIcalDrawerOpen] = useState(false)
  const handleOpenIcalDrawer = () => setIcalDrawerOpen(true)

  // Ferme le drawer à chaque changement de route (sécurité : navigation
  // programmatique, back button, ou redirect serveur). Le `onClick` du NavLink
  // le fait déjà pour un clic utilisateur direct — ce useEffect couvre le reste.
  useEffect(() => {
    setMobileDrawerOpen(false)
  }, [location.pathname])

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* ── Sidebar globale — icon-only permanente (64px), cachée en <sm ─── */}
      <aside
        className="hidden sm:flex flex-col shrink-0 select-none w-16"
        style={{
          background: 'var(--bg-side)',
          borderRight: '1px solid var(--brd-sub)',
        }}
      >
        {/* Header — logo captiv. Hauteur alignée avec les banners des pages (57px).
            Le logo captiv-logo.png a un ratio wordmark ≈2,71:1 (1419×523). Dans
            une sidebar de 64px large (48px utiles après padding), une hauteur
            fixe écraserait l'image. On utilise donc max-width: 100% +
            object-fit: contain pour forcer le navigateur à conserver le ratio
            naturel et scaler proportionnellement. */}
        <div
          className="flex items-center justify-center px-2"
          style={{ borderBottom: '1px solid var(--brd-sub)', height: '57px' }}
        >
          <img
            src={sidebarLogo}
            alt={sidebarLogoAlt}
            style={{
              maxWidth: '100%',
              maxHeight: '24px',
              width: 'auto',
              height: 'auto',
              objectFit: 'contain',
              display: 'block',
              flexShrink: 0,
            }}
          />
        </div>

        {/* Navigation — overflow visible pour laisser sortir les tooltips */}
        <nav className="flex-1 px-2 py-2" style={{ overflow: 'visible' }}>
          {/* Recherche globale — placeholder pour la future fonctionnalité Cmd+K */}
          <SidebarSearchButton />

          {/* Principal (Accueil + Projets) */}
          <div className="space-y-0.5 mt-2">
            {NAV_MAIN.map((item) => (
              <SidebarLink key={item.to} {...item} />
            ))}
          </div>

          {/* Base de données — interne uniquement */}
          {showBddSection && (
            <>
              <SidebarDivider />
              <div className="space-y-0.5">
                {NAV_BDD.map((item) => (
                  <SidebarLink key={item.to} {...item} />
                ))}
              </div>
            </>
          )}

          {/* Finance — admin & charge_prod uniquement */}
          {canSeeFinance && (
            <>
              <SidebarDivider />
              <div className="space-y-0.5">
                {NAV_FINANCE.map((item) => (
                  <SidebarLink key={item.to} {...item} />
                ))}
              </div>
            </>
          )}

          {/* Paramètres — admin uniquement */}
          {isAdmin && (
            <>
              <SidebarDivider />
              <div className="space-y-0.5">
                {NAV_ADMIN.map((item) => (
                  <SidebarLink key={item.to} {...item} />
                ))}
              </div>
            </>
          )}
        </nav>

        {/* User footer — avatar (tooltip = nom + rôle) + bouton logout en dessous */}
        <div className="px-2 py-3" style={{ borderTop: '1px solid var(--brd-sub)' }}>
          <div className="flex flex-col items-center gap-1">
            {/* Avatar avec tooltip */}
            <div className="relative group">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
                style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
              >
                <Initials name={profile?.full_name} />
              </div>
              <span
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  zIndex: 50,
                }}
              >
                {profile?.full_name || 'Utilisateur'} — {ROLE_LABELS[role] || role}
              </span>
            </div>

            {/* Bouton "Mon planning iCal" — PL-8 v1. Ouvre le drawer d'export
                personnel (tokens cross-projets). Tooltip droit en hover. */}
            <div className="relative group">
              <button
                onClick={handleOpenIcalDrawer}
                aria-label="Mon planning iCal"
                className="flex items-center justify-center rounded-md transition-all"
                style={{
                  width: '32px',
                  height: '28px',
                  color: 'var(--txt-3)',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--blue)'
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--txt-3)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <Share2 className="w-3.5 h-3.5" />
              </button>
              <span
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  zIndex: 50,
                }}
              >
                Mon planning iCal
              </span>
            </div>

            {/* Bouton logout */}
            <div className="relative group">
              <button
                onClick={handleSignOut}
                className="flex items-center justify-center rounded-md transition-all"
                style={{
                  width: '32px',
                  height: '28px',
                  color: 'var(--txt-3)',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--red)'
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--txt-3)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
              <span
                className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                  zIndex: 50,
                }}
              >
                Déconnexion
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Colonne principale : top bar mobile (hors projet) + main ────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar mobile — visible uniquement en <sm ET hors projet.
            En projet, c'est le banner de ProjetLayout qui porte le burger.
            Hauteur 57px pour s'aligner avec les autres headers de l'app. */}
        {!isInProject && (
          <div
            className="sm:hidden shrink-0 flex items-center gap-3 px-4"
            style={{
              background: 'var(--bg-side)',
              borderBottom: '1px solid var(--brd-sub)',
              height: '57px',
            }}
          >
            {/* Burger à gauche → cohérence avec le banner projet (ProjetLayout).
                Pattern unifié : sur toutes les pages mobiles, le burger est au
                même endroit, et le logo captiv. vient juste après. */}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              aria-label="Ouvrir le menu"
              className="flex items-center justify-center rounded-md transition-all shrink-0"
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
            <img
              src={sidebarLogo}
              alt={sidebarLogoAlt}
              style={{
                maxHeight: '20px',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                display: 'block',
                flexShrink: 0,
              }}
            />
          </div>
        )}

        <main className="flex-1 overflow-y-auto" style={{ background: 'var(--bg)' }}>
          <Outlet />
        </main>
      </div>

      {/* Drawer global — rendu uniquement hors projet (en projet, ProjetLayout
          a son propre drawer qui gère déjà la bascule projet ↔ global). */}
      {!isInProject && (
        <GlobalNavDrawer
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          sections={globalNavSections}
          profile={profile}
          role={role}
          onSignOut={handleSignOut}
          onOpenIcalDrawer={handleOpenIcalDrawer}
        />
      )}

      {/* Drawer "Mon planning iCal" (PL-8 v1) — monté une fois au niveau
          Layout, utilisable depuis la sidebar desktop et le drawer mobile.
          N'a besoin que du profil courant (id + org_id). */}
      <ICalExportDrawer
        open={icalDrawerOpen}
        onClose={() => setIcalDrawerOpen(false)}
        scope="my"
        userId={profile?.id}
        orgId={profile?.org_id}
      />
    </div>
  )
}

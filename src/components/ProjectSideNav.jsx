/**
 * ProjectSideNav — Sidebar latérale des onglets projet.
 *
 * Remplace l'ancienne tab bar horizontale dans ProjetLayout (chantier UI-1).
 * Pattern 3 colonnes inspiré d'Intercom / ClickUp :
 *
 *   ┌─────────┬──────────────┬──────────────────────┐
 *   │ sidebar │  Project     │     main (banner     │
 *   │ globale │  SideNav     │     + Outlet)        │
 *   │ 64px    │  256px       │     flex-1          │
 *   └─────────┴──────────────┴──────────────────────┘
 *
 * Les onglets sont groupés en 5 sections thématiques :
 *   - APERÇU        (Projet)
 *   - COMMERCIAL    (Devis, Factures)
 *   - PRODUCTION    (Équipe, Planning, Production, Livrables, Matériel)
 *   - ANALYSE       (Budget réel, Dashboard)
 *   - ADMIN         (Accès)
 *
 * Un groupe dont tous les items sont filtrés (permissions) n'est pas rendu.
 *
 * Collapsibilité :
 *   - État interne `collapsed` (localStorage `captiv:project-sidenav-collapsed`)
 *   - Bouton toggle en bas-droite du header de la sidebar
 *   - Raccourci clavier Cmd/Ctrl + B (desktop uniquement)
 *   - En collapsed : largeur 48px, icon-only, tooltip au hover
 *
 * Mobile / tablet (<lg) :
 *   - Rendue en drawer overlay (slide-in gauche)
 *   - `drawerOpen` + `onCloseDrawer` contrôlent l'ouverture
 *   - Cmd+B désactivé en drawer mode (le toggle n'a pas de sens)
 *   - En mobile, la sidebar globale est cachée (cf. Layout.jsx). Le drawer
 *     propose alors DEUX panneaux côte à côte avec bascule :
 *       - `project` (défaut à chaque ouverture) : onglets du projet courant
 *       - `global`  : Accueil / Projets / BDD / Finance / Admin
 *     Une flèche dans le header bascule d'un mode à l'autre avec un slide
 *     horizontal (iOS-like). Le panel global est "à gauche" du panel projet
 *     pour correspondre à la métaphore spatiale des flèches.
 *
 * Props :
 *   - projectId          : string — ID du projet (pour les liens)
 *   - tabs               : Tab[] — onglets filtrés par rôle/permissions
 *   - activeTab          : string — clé de l'onglet actif
 *   - devisCount         : number — nombre de devis (badge sur l'onglet Devis)
 *   - singleDevisHref    : string | null — raccourci direct si 1 seul devis
 *   - isMobile           : boolean — si true, rendu en drawer
 *   - drawerOpen         : boolean — état ouvert du drawer (mobile only)
 *   - onCloseDrawer      : () => void — ferme le drawer (mobile only)
 *   - globalNavSections  : Array<{label, items}> | null — sections de la nav
 *                          globale à afficher dans le panneau "global" du
 *                          drawer. Passé uniquement en mode drawer (desktop
 *                          garde sa sidebar globale dédiée).
 */
import { useState, useEffect, useCallback } from 'react'
import { Link, NavLink } from 'react-router-dom'
import {
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react'

const STORAGE_KEY = 'captiv:project-sidenav-collapsed'

// ─── Groupes thématiques ──────────────────────────────────────────────────────
// L'ordre définit l'ordre de rendu. Les 5 groupes ont tous un label pour une
// lecture visuelle symétrique (cf. review UI-1 avril 2026).
const GROUPS = [
  { label: 'Aperçu', keys: ['projet'] },
  { label: 'Commercial', keys: ['devis', 'factures'] },
  { label: 'Production', keys: ['equipe', 'planning', 'production', 'livrables', 'materiel'] },
  { label: 'Analyse', keys: ['budget', 'dashboard'] },
  { label: 'Admin', keys: ['access'] },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Calcule le href d'un onglet. Cas particulier : l'onglet Devis pointe
 * directement vers l'éditeur si le projet n'a qu'un seul devis (mono-lot
 * mono-version). Sinon on tombe sur la liste (accordéon par lot).
 */
function resolveHref(tab, projectId, singleDevisHref) {
  if (tab.key === 'devis' && singleDevisHref) return singleDevisHref
  return `/projets/${projectId}/${tab.path}`
}

// ─── Items ────────────────────────────────────────────────────────────────────

/**
 * Item de nav globale (Accueil, Projets, Clients, …) pour le drawer mobile.
 * Utilise NavLink → l'état actif est calculé par react-router à partir de
 * l'URL courante, pas besoin de le passer depuis ProjetLayout.
 * Pas de badge, pas de collapse : le drawer est toujours en mode expanded.
 */
function GlobalNavItem({ to, icon: Icon, label, onNavigate }) {
  return (
    <NavLink
      to={to}
      end={to === '/accueil'}
      onClick={onNavigate}
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
      style={({ isActive }) =>
        isActive
          ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
          : { color: 'var(--txt-2)' }
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{label}</span>
    </NavLink>
  )
}

function NavItem({
  tab,
  isActive,
  collapsed,
  href,
  badge, // optionnel — rendu à droite (ex: count de devis)
  onNavigate,
}) {
  const Icon = tab.icon
  return (
    <div className="relative group">
      <Link
        to={href}
        onClick={onNavigate}
        className={`flex items-center rounded-lg text-sm font-medium transition-all duration-150 ${
          collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-3 py-2'
        }`}
        style={
          isActive
            ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
            : { color: 'var(--txt-2)' }
        }
        onMouseEnter={(e) => {
          if (!isActive) e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          if (!isActive) e.currentTarget.style.background = 'transparent'
        }}
      >
        <Icon className="w-4 h-4 shrink-0" />
        {!collapsed && (
          <>
            <span className="truncate flex-1">{tab.label}</span>
            {badge != null && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-bold shrink-0"
                style={
                  isActive
                    ? { background: 'var(--blue)', color: 'white' }
                    : { background: 'var(--bg-elev)', color: 'var(--txt-2)' }
                }
              >
                {badge}
              </span>
            )}
          </>
        )}
        {/* En collapsed, on garde le badge sous forme de pastille sur l'icône */}
        {collapsed && badge != null && (
          <span
            className="absolute -top-0.5 -right-0.5 text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center"
            style={{ background: 'var(--blue)', color: 'white' }}
          >
            {badge}
          </span>
        )}
      </Link>

      {/* Tooltip flottant en mode collapsed */}
      {collapsed && (
        <span
          className="pointer-events-none absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity duration-100"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt)',
            border: '1px solid var(--brd)',
            zIndex: 50,
          }}
        >
          {tab.label}
          {badge != null && ` (${badge})`}
        </span>
      )}
    </div>
  )
}

function GroupLabel({ label, collapsed }) {
  // Label falsy (null/undefined/"") → ne rien rendre. Utilisé pour la première
  // section de la nav globale qui n'a pas de titre (son titre implicite est
  // porté par le header du drawer : "NAVIGATION").
  if (!label) return null
  if (collapsed) {
    // En collapsed on remplace le label par un séparateur subtil pour garder
    // la respiration entre groupes sans prendre trop de place.
    return <div className="mx-3 my-2.5" style={{ height: '1px', background: 'var(--brd-sub)' }} />
  }
  return (
    <p
      className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase select-none"
      style={{ color: 'var(--txt-3)', letterSpacing: '0.12em' }}
    >
      {label}
    </p>
  )
}

// ─── Contenu de la sidebar (partagé desktop / drawer) ─────────────────────────

function SideNavContent({
  projectId,
  tabs,
  activeTab,
  devisCount,
  singleDevisHref,
  collapsed,
  onToggleCollapsed, // null → bouton masqué (drawer mobile)
  onClose, // null → bouton masqué (desktop)
  onNavigate, // optionnel : callback après clic sur un item (pour fermer le drawer)
  globalNavSections, // null → pas de section globale
  mobileMode, // undefined → desktop ; 'project' ou 'global' → panneau du drawer
  onSwitchMode, // () => void — bascule entre les deux panneaux du drawer
}) {
  const tabsByKey = new Map(tabs.map((t) => [t.key, t]))
  const renderedGroups = GROUPS.map((group) => {
    const groupTabs = group.keys.map((k) => tabsByKey.get(k)).filter(Boolean)
    if (groupTabs.length === 0) return null
    return { label: group.label, tabs: groupTabs }
  }).filter(Boolean)

  // ─── Flags de rendu ─────────────────────────────────────────────────────
  // En desktop (`mobileMode` undefined) : on affiche projet + (éventuellement)
  // globalNavSections — ce dernier cas n'arrive plus aujourd'hui mais on garde
  // le comportement pour éviter de casser un appel existant.
  // En mobile : on n'affiche QU'UN des deux selon le mode, l'autre est dans
  // le panneau voisin (rendu par le parent en parallèle).
  const isMobilePanel = mobileMode === 'project' || mobileMode === 'global'
  const showGlobal = globalNavSections && globalNavSections.length > 0 &&
    (!isMobilePanel || mobileMode === 'global')
  const showProject = !isMobilePanel || mobileMode === 'project'
  const showDivider = showGlobal && showProject // uniquement en desktop legacy
  const headerTitle = !isMobilePanel
    ? 'Projet'
    : mobileMode === 'project'
      ? 'Projet'
      : 'Navigation'

  // Click n'importe où sur la sidebar (hors zones interactives) = toggle du
  // collapse. Gated par `onToggleCollapsed` : en mode drawer mobile la prop
  // est null → aucun effet (le drawer utilise déjà backdrop/X pour fermer).
  function handleAsideClick(e) {
    if (!onToggleCollapsed) return
    // Ne pas intercepter si on a cliqué sur un élément interactif : NavLink,
    // bouton (toggle/close), input. `closest` remonte l'arbre, donc un clic
    // sur l'icône d'un NavLink (child du <a>) est bien détecté.
    if (e.target.closest('a, button, input, textarea, [role="button"]')) return
    onToggleCollapsed()
  }

  return (
    // Sticky + height: 100vh : la sidebar occupe toujours toute la hauteur de la
    // viewport, même quand le contenu de la page est plus long. Évite l'effet
    // "sidebar qui s'arrête au milieu de la page" sur les vues scrollables, et
    // garde la navigation accessible en permanence pendant qu'on scrolle.
    // `alignSelf: flex-start` empêche le flex row d'override avec un stretch
    // qui ferait grandir la sidebar à la hauteur du contenu.
    // En mode drawer (parent `fixed inset-0`), sticky est neutre (pas de
    // scrolling ancestor) et 100vh = hauteur du drawer → tout fonctionne.
    <aside
      onClick={handleAsideClick}
      className={`flex flex-col shrink-0 select-none transition-[width] duration-200 ${
        isMobilePanel ? '' : collapsed ? 'w-12' : 'w-64'
      }`}
      style={{
        background: 'var(--bg-side)',
        borderRight: '1px solid var(--brd-sub)',
        // En desktop : sticky 100vh pour rester visible pendant le scroll.
        // En panneau mobile : on occupe 100% du parent (wrapper drawer) —
        // le sticky est neutralisé car on est déjà dans un container `fixed`.
        position: 'sticky',
        top: 0,
        height: '100vh',
        width: isMobilePanel ? '100%' : undefined,
        alignSelf: 'flex-start',
        // `cursor: pointer` en desktop pour signaler que la sidebar est
        // cliquable. Les enfants interactifs (<a>, <button>) conservent leur
        // cursor via les styles par défaut du navigateur.
        cursor: onToggleCollapsed ? 'pointer' : 'default',
      }}
    >
      {/* Header de la sidebar — titre + bouton(s).
          Hauteur alignée sur le banner de page (57px) pour obtenir une ligne de
          bordure horizontale continue entre sidebar et zone principale.
          En mode drawer mobile, un bouton "switch" à gauche du titre permet
          de basculer entre le panneau projet et le panneau global. L'icône
          reflète la direction du slide (Chevron gauche = on va voir ce qui
          est à gauche, Chevron droit = on revient à ce qui est à droite). */}
      <div
        className={`flex items-center ${
          collapsed ? 'justify-center px-2' : 'justify-between px-4'
        }`}
        style={{ borderBottom: '1px solid var(--brd-sub)', height: '57px' }}
      >
        {!collapsed && (
          <div className="flex items-center gap-2 min-w-0">
            {isMobilePanel && onSwitchMode && (
              <button
                onClick={onSwitchMode}
                aria-label={
                  mobileMode === 'project'
                    ? 'Afficher la navigation générale'
                    : 'Retour au menu du projet'
                }
                className="flex items-center justify-center rounded-md transition-all shrink-0"
                style={{
                  width: '26px',
                  height: '26px',
                  color: 'var(--txt-3)',
                  background: 'transparent',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--txt)'
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--txt-3)'
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {mobileMode === 'project' ? (
                  <ChevronLeft className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            )}
            <p
              className="text-[10px] font-semibold uppercase select-none truncate"
              style={{ color: 'var(--txt-3)', letterSpacing: '0.12em' }}
            >
              {headerTitle}
            </p>
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Fermer le menu"
            className="flex items-center justify-center rounded-md transition-all"
            style={{
              width: '26px',
              height: '26px',
              color: 'var(--txt-3)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--txt)'
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--txt-3)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={
              collapsed
                ? 'Développer la sidebar projet (⌘B)'
                : 'Réduire la sidebar projet (⌘B)'
            }
            aria-label={collapsed ? 'Développer la sidebar' : 'Réduire la sidebar'}
            className="flex items-center justify-center rounded-md transition-all"
            style={{
              width: '26px',
              height: '26px',
              color: 'var(--txt-3)',
              background: 'transparent',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--txt)'
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--txt-3)'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Navigation groupée — overflow visible pour laisser sortir les tooltips.
          Le contenu affiché dépend de showGlobal / showProject :
          - desktop : showProject = true, showGlobal = faux (depuis le refacto)
          - panneau mobile "project" : showProject = true, showGlobal = false
          - panneau mobile "global"  : showProject = false, showGlobal = true
          Les deux panneaux sont toujours montés en parallèle en mobile et
          slident — un seul est visible à la fois. */}
      <nav
        className={`flex-1 ${collapsed ? 'px-2' : 'px-2.5'} py-2 overflow-y-auto`}
        style={{ overflow: 'visible auto' }}
      >
        {showGlobal && (
          <>
            {globalNavSections.map((section, i) => (
              <div key={section.label ?? `__main-${i}`}>
                <GroupLabel label={section.label} collapsed={collapsed} />
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <GlobalNavItem
                      key={item.to}
                      to={item.to}
                      icon={item.icon}
                      label={item.label}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            ))}
            {showDivider && (
              <div
                className="mx-3 my-3"
                style={{ height: '1px', background: 'var(--brd-sub)' }}
              />
            )}
          </>
        )}

        {showProject &&
          renderedGroups.map((group) => (
            <div key={group.label}>
              <GroupLabel label={group.label} collapsed={collapsed} />
              <div className="space-y-0.5">
                {group.tabs.map((tab) => {
                  const href = resolveHref(tab, projectId, singleDevisHref)
                  const isActive = tab.key === activeTab
                  const badge =
                    tab.key === 'devis' && devisCount > 0 ? devisCount : null
                  return (
                    <NavItem
                      key={tab.key}
                      tab={tab}
                      isActive={isActive}
                      collapsed={collapsed}
                      href={href}
                      badge={badge}
                      onNavigate={onNavigate}
                    />
                  )
                })}
              </div>
            </div>
          ))}
      </nav>
    </aside>
  )
}

// ─── Composant public ────────────────────────────────────────────────────────

export default function ProjectSideNav({
  projectId,
  tabs,
  activeTab,
  devisCount = 0,
  singleDevisHref = null,
  isMobile = false,
  drawerOpen = false,
  onCloseDrawer,
  globalNavSections = null,
}) {
  // État collapsed persisté en localStorage (desktop uniquement)
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const toggleCollapsed = useCallback(() => setCollapsed((c) => !c), [])

  // Mode du drawer mobile : 'project' (défaut) ou 'global'. On reset à 'project'
  // à chaque ouverture du drawer parce que 90 % du temps l'utilisateur l'ouvre
  // pour naviguer dans le projet courant. L'état n'est pas persisté.
  const [drawerMode, setDrawerMode] = useState('project')
  useEffect(() => {
    if (drawerOpen) setDrawerMode('project')
  }, [drawerOpen])

  const switchToGlobal = useCallback(() => setDrawerMode('global'), [])
  const switchToProject = useCallback(() => setDrawerMode('project'), [])

  // Raccourci clavier Cmd/Ctrl + B (desktop uniquement — en drawer ça n'a pas de sens)
  useEffect(() => {
    if (isMobile) return undefined
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        // Ne pas intercepter si l'utilisateur est en train de taper dans un input/textarea
        const tag = document.activeElement?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) {
          return
        }
        e.preventDefault()
        toggleCollapsed()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isMobile, toggleCollapsed])

  // En mobile : drawer overlay avec 2 panneaux côte à côte (slide horizontal).
  // Layout :
  //   drawer       : width = 256px (w-64), overflow hidden
  //   slide wrap   : width = 200% (= 2 × panel), translateX selon mode
  //   panel global : width = 50% (= 100% du drawer), à gauche du wrap
  //   panel projet : width = 50%, à droite du wrap
  // Initialement drawerMode = 'project' → translateX(-50%) → on voit le panel
  // de droite (projet). Bascule → translateX(0) → panel de gauche (global).
  if (isMobile) {
    if (!drawerOpen) return null
    return (
      <div
        className="fixed inset-0 z-50 flex"
        role="dialog"
        aria-label="Menu du projet"
        onClick={onCloseDrawer}
      >
        {/* Backdrop — 0.7 opacity + micro-blur pour bien isoler le drawer
            du contenu de la page en fond (mobile). backdrop-filter n'est pas
            supporté sur les vieux Safari → on prévoit le fallback WebKit. */}
        <div
          className="absolute inset-0"
          style={{
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        />
        {/* Drawer panel — clic à l'intérieur ne ferme pas.
            overflow-hidden pour masquer le panneau hors-champ pendant le slide. */}
        <div
          className="relative h-full overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '256px',
            animation: 'slideInLeft 180ms ease-out',
          }}
        >
          {/* Container qui slide horizontalement entre les 2 panneaux.
              Easing iOS-like (ease-out cubic) pour un ressenti familier. */}
          <div
            className="flex h-full"
            style={{
              width: '200%',
              transform:
                drawerMode === 'global' ? 'translateX(0)' : 'translateX(-50%)',
              transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            {/* Panneau "global" (à gauche) — Accueil / Projets / BDD / ... */}
            <div style={{ width: '50%', height: '100%', flexShrink: 0 }}>
              <SideNavContent
                projectId={projectId}
                tabs={[]}
                activeTab=""
                devisCount={0}
                singleDevisHref={null}
                collapsed={false}
                onToggleCollapsed={null}
                onClose={onCloseDrawer}
                onNavigate={onCloseDrawer}
                globalNavSections={globalNavSections}
                mobileMode="global"
                onSwitchMode={switchToProject}
              />
            </div>
            {/* Panneau "projet" (à droite) — Aperçu / Commercial / ... */}
            <div style={{ width: '50%', height: '100%', flexShrink: 0 }}>
              <SideNavContent
                projectId={projectId}
                tabs={tabs}
                activeTab={activeTab}
                devisCount={devisCount}
                singleDevisHref={singleDevisHref}
                collapsed={false}
                onToggleCollapsed={null}
                onClose={onCloseDrawer}
                onNavigate={onCloseDrawer}
                globalNavSections={null}
                mobileMode="project"
                onSwitchMode={switchToGlobal}
              />
            </div>
          </div>
        </div>
        <style>{`
          @keyframes slideInLeft {
            from { transform: translateX(-100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </div>
    )
  }

  // Desktop / tablet — rendu inline
  return (
    <SideNavContent
      projectId={projectId}
      tabs={tabs}
      activeTab={activeTab}
      devisCount={devisCount}
      singleDevisHref={singleDevisHref}
      collapsed={collapsed}
      onToggleCollapsed={toggleCollapsed}
      onClose={null}
      onNavigate={null}
    />
  )
}

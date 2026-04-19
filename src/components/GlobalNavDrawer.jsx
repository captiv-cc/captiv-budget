/**
 * GlobalNavDrawer — Drawer mobile pour la nav globale (hors projet).
 *
 * Contexte UI-1 (avril 2026, option B du review mobile) : en mobile la
 * sidebar globale 64px est cachée partout. Sur les pages non-projet (Accueil,
 * Projets, Clients, Crew, …) on propose un hamburger dans la top bar mobile
 * qui ouvre ce drawer. Les pages projet ont leur propre drawer (ProjectSideNav
 * en mode mobile) qui gère la bascule projet / global.
 *
 * Rendu uniquement en <sm (garde sm:hidden sur le root), mais le parent
 * contrôle aussi l'affichage via `open` pour éviter de monter le composant
 * inutilement.
 *
 * Structure visuelle (identique au drawer projet pour cohérence) :
 *   - backdrop 0.7 + blur
 *   - panel 256px qui slide depuis la gauche (180ms)
 *   - header 57px : titre "NAVIGATION" + bouton close
 *   - nav groupée par sections (Accueil/Projets, BDD, Finance, Admin)
 *   - footer : avatar + nom + rôle + bouton logout
 *
 * Props :
 *   - open              : boolean — état ouvert
 *   - onClose           : () => void — ferme le drawer
 *   - sections          : Array<{label, items}> — sections retournées par
 *                         buildGlobalNavSections (lib/globalNav)
 *   - profile           : { full_name?: string } | null — user courant
 *   - role              : string — rôle (admin / charge_prod / …)
 *   - onSignOut         : () => Promise<void> — handler de déconnexion
 *   - onOpenIcalDrawer  : () => void — ouvre le drawer "Mon planning iCal"
 *                         (PL-8 v1). Optionnel : si absent, le bouton n'est
 *                         pas rendu.
 */
import { NavLink } from 'react-router-dom'
import { LogOut, Share2, X } from 'lucide-react'

const ROLE_LABELS = {
  admin: 'Admin',
  charge_prod: 'Chargé de prod',
  coordinateur: 'Coordinateur',
  prestataire: 'Prestataire',
}

function Initials({ name }) {
  const parts = (name || 'U').split(' ')
  const letters =
    parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  return letters.toUpperCase()
}

export default function GlobalNavDrawer({
  open,
  onClose,
  sections,
  profile,
  role,
  onSignOut,
  onOpenIcalDrawer,
}) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex sm:hidden"
      role="dialog"
      aria-label="Menu de navigation"
      onClick={onClose}
    >
      {/* Backdrop — mêmes tokens que le drawer projet pour cohérence */}
      <div
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(2px)',
          WebkitBackdropFilter: 'blur(2px)',
        }}
      />
      {/* Panel — clic à l'intérieur ne ferme pas */}
      <div
        className="relative h-full"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '256px',
          animation: 'slideInLeft 180ms ease-out',
        }}
      >
        <aside
          className="flex flex-col h-full select-none"
          style={{
            background: 'var(--bg-side)',
            borderRight: '1px solid var(--brd-sub)',
            height: '100vh',
          }}
        >
          {/* Header — titre + close */}
          <div
            className="flex items-center justify-between px-4"
            style={{ borderBottom: '1px solid var(--brd-sub)', height: '57px' }}
          >
            <p
              className="text-[10px] font-semibold uppercase select-none"
              style={{ color: 'var(--txt-3)', letterSpacing: '0.12em' }}
            >
              Navigation
            </p>
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
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2.5 py-2 overflow-y-auto">
            {sections.map((section, i) => (
              <div key={section.label ?? `__main-${i}`}>
                {section.label && (
                  <p
                    className="px-3 pt-4 pb-1.5 text-[10px] font-semibold uppercase select-none"
                    style={{ color: 'var(--txt-3)', letterSpacing: '0.12em' }}
                  >
                    {section.label}
                  </p>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.to === '/accueil'}
                        onClick={onClose}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150"
                        style={({ isActive }) =>
                          isActive
                            ? { background: 'var(--blue-bg)', color: 'var(--blue)' }
                            : { color: 'var(--txt-2)' }
                        }
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate flex-1">{item.label}</span>
                      </NavLink>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer user — avatar + nom + logout (équivalent sidebar desktop) */}
          <div
            className="px-3 py-3 flex items-center gap-3"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{ background: 'linear-gradient(135deg, var(--blue), var(--purple))' }}
            >
              <Initials name={profile?.full_name} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
                {profile?.full_name || 'Utilisateur'}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                {ROLE_LABELS[role] || role}
              </p>
            </div>
            {onOpenIcalDrawer && (
              <button
                onClick={() => {
                  onClose()
                  onOpenIcalDrawer()
                }}
                aria-label="Mon planning iCal"
                title="Mon planning iCal"
                className="flex items-center justify-center rounded-md transition-all shrink-0"
                style={{
                  width: '28px',
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
            )}
            <button
              onClick={() => {
                onClose()
                onSignOut()
              }}
              aria-label="Déconnexion"
              className="flex items-center justify-center rounded-md transition-all shrink-0"
              style={{
                width: '28px',
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
          </div>
        </aside>
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

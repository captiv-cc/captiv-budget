// ════════════════════════════════════════════════════════════════════════════
// SharePageHeader — Hero unifié pour les pages /share/* (P4.2 polish)
// ════════════════════════════════════════════════════════════════════════════
//
// Composant partagé entre toutes les pages publiques de partage :
//   - /share/livrables/:token (LivrableShareSession)
//   - /share/equipe/:token    (EquipeShareSession)
//   - /share/...              (futures pages — logistique, factures, etc.)
//
// Hiérarchie visuelle (décision Hugo P4.2) :
//   1. Logo de l'org en haut-gauche, vraie taille (~h-7), avec sa propre
//      ligne — plus discret en eyebrow microscopique.
//   2. PAGE TITLE en H1 dominant (ex: "Suivi des livrables", "Tech list").
//   3. Project title en H2 plus discret (taille moyenne, semibold, opacité 0.85).
//   4. Meta items (ref, scope, label, date) en petit en bas du hero.
//
// API à slots / props typés :
//   - pageTitle  (string, required) — titre principal de la page
//   - project    ({ title, ref_projet, cover_url })
//   - org        ({ display_name, legal_name, logo_url_clair, logo_url_sombre,
//                   logo_banner_url, brand_color, website_url, tagline,
//                   share_intro_text })
//   - metaItems  (Array<{ type: 'ref'|'scope'|'label'|'date', value, color? }>)
//   - theme      ('light' | 'dark') + onToggleTheme (function)
//   - actions    (ReactNode) — boutons custom (PDF, partage, etc.)
//
// L'overlay du hero est sombre quel que soit le thème de la page (cohérence
// avec le pattern existant), donc les couleurs internes sont en dur (pas de
// CSS vars).
// ════════════════════════════════════════════════════════════════════════════

import { Film, Moon, Sun } from 'lucide-react'
import { pickOrgLogo } from '../../lib/branding'
import { formatDateTimeFR } from '../../lib/dateFormat'

export default function SharePageHeader({
  pageTitle,
  project,
  org = null,
  metaItems = [],
  theme = 'dark',
  onToggleTheme = null,
  actions = null,
}) {
  const projectTitle = project?.title || ''
  const cover = project?.cover_url

  // Logo de l'org : on prend la variante FOND SOMBRE en priorité (le hero
  // est foncé = overlay noir 0.6+, donc on veut le logo conçu pour ce fond,
  // pas le logo banner PDF qui est typiquement pensé pour fond clair).
  // Cascade : logo_url_sombre > logo_url_clair (fallback) ; pas de fallback
  // Captiv automatique (décision Hugo : respecter l'identité de l'org).
  const hasOrgLogo = Boolean(
    org?.logo_url_sombre || org?.logo_url_clair || org?.logo_banner_url,
  )
  const orgLogoUrl = hasOrgLogo ? pickOrgLogo(org, 'dark') : null
  const orgName = org?.display_name || org?.legal_name || ''

  return (
    <header
      className="relative rounded-2xl overflow-hidden shadow-sm"
      style={{ border: '1px solid var(--brd)' }}
    >
      {/* Background : cover floutée OU gradient sombre */}
      {cover ? (
        <>
          <img
            src={cover}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'blur(28px) saturate(1.1)', transform: 'scale(1.18)' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.74) 50%, rgba(0,0,0,0.6) 100%)',
            }}
          />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)' }}
        />
      )}

      <div className="relative p-4 sm:p-5 md:p-6 flex flex-col gap-3 sm:gap-5 md:gap-6">
        {/* ── Top row : logo org (gauche) + actions (droite) ─────────────── */}
        <div className="flex items-start justify-between gap-3 min-h-[28px]">
          {/* Logo org (statique, pas de lien) */}
          <div className="flex-1 min-w-0">
            {orgLogoUrl ? (
              <img
                src={orgLogoUrl}
                alt={orgName || 'Logo'}
                className="h-6 sm:h-7 md:h-8 w-auto object-contain"
                style={{ maxWidth: '160px' }}
              />
            ) : orgName ? (
              <span
                className="text-sm font-semibold"
                style={{ color: 'rgba(255,255,255,0.95)' }}
              >
                {orgName}
              </span>
            ) : null}
          </div>

          {/* Actions custom + theme toggle */}
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            {onToggleTheme && (
              <GlassThemeToggle theme={theme} onToggle={onToggleTheme} />
            )}
          </div>
        </div>

        {/* ── Main content : vignette + titres (toujours en row, taille
            responsive de la vignette pour économiser l'espace mobile) ──── */}
        <div className="flex flex-row gap-3 sm:gap-4 md:gap-6 items-center">
          {/* Vignette projet (carrée) — plus petite en mobile */}
          {cover ? (
            <img
              src={cover}
              alt={projectTitle}
              className="flex-shrink-0 w-14 h-14 sm:w-20 sm:h-20 md:w-28 md:h-28 rounded-lg sm:rounded-xl object-cover"
              style={{
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4), 0 4px 12px rgba(0,0,0,0.25)',
              }}
            />
          ) : (
            <div
              className="flex-shrink-0 w-14 h-14 sm:w-20 sm:h-20 md:w-28 md:h-28 rounded-lg sm:rounded-xl flex items-center justify-center"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
              }}
            >
              <Film
                className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7"
                style={{ color: 'rgba(255,255,255,0.7)' }}
              />
            </div>
          )}

          {/* Bloc titres + meta */}
          <div className="flex-1 min-w-0">
            {/* H1 : nom de la page (dominant) — plus petit en mobile */}
            <h1
              className="text-lg sm:text-2xl md:text-3xl lg:text-4xl font-bold leading-tight tracking-tight break-words text-white"
              style={{ textShadow: '0 2px 8px rgba(0,0,0,0.55)' }}
            >
              {pageTitle}
            </h1>
            {/* H2 : nom du projet (subordonné) */}
            {projectTitle && (
              <h2
                className="mt-0.5 sm:mt-1.5 text-sm sm:text-base md:text-lg lg:text-xl font-semibold leading-snug break-words"
                style={{
                  color: 'rgba(255,255,255,0.85)',
                  textShadow: '0 1px 4px rgba(0,0,0,0.5)',
                }}
              >
                {projectTitle}
              </h2>
            )}
            {/* Meta items */}
            {metaItems.length > 0 && (
              <MetaRow items={metaItems} />
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// ─── Meta items (ref / scope / label / date) ─────────────────────────────────

function MetaRow({ items }) {
  return (
    <div
      className="mt-1.5 sm:mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs"
      style={{ color: 'rgba(255,255,255,0.85)' }}
    >
      {items.map((item, i) => {
        switch (item?.type) {
          case 'ref':
            return (
              <span
                key={i}
                className="font-mono px-2 py-0.5 rounded text-[11px] backdrop-blur"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                {item.value}
              </span>
            )
          case 'scope': {
            const color = item.color || 'rgba(255,255,255,0.95)'
            return (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                style={{ color }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: color }}
                />
                {item.value}
              </span>
            )
          }
          case 'label':
            return (
              <span
                key={i}
                className="italic text-[11px]"
                style={{
                  color: 'rgba(255,255,255,0.9)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                }}
              >
                {item.value}
              </span>
            )
          case 'date':
            return (
              <span
                key={i}
                className="text-[11px] sm:ml-auto"
                style={{
                  color: 'rgba(255,255,255,0.7)',
                  textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                }}
              >
                Mis à jour {formatDateTimeFR(item.value)}
              </span>
            )
          default:
            // Fallback : valeur brute
            return (
              <span key={i} className="text-[11px]">
                {String(item?.value || '')}
              </span>
            )
        }
      })}
    </div>
  )
}

// ─── Theme toggle (variante "glass" pour fond sombre) ────────────────────────

function GlassThemeToggle({ theme, onToggle }) {
  const Icon = theme === 'light' ? Moon : Sun
  return (
    <button
      type="button"
      onClick={onToggle}
      className="p-2 rounded-lg backdrop-blur transition-colors shrink-0"
      style={{
        background: 'rgba(255,255,255,0.15)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.25)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
      }}
      title={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
      aria-label={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}


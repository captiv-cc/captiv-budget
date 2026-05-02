// ════════════════════════════════════════════════════════════════════════════
// ShareHeader — En-tête de la page de partage public livrables (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Hero immersif : image projet (cover_url) en background flouté + overlay
// sombre + vignette carrée nette à gauche + bloc texte à droite. Le bouton
// PDF et le toggle theme sont posés en absolu en haut à droite, avec
// backdrop-blur. Pattern aligné sur le hero de ProjetTab.
//
// MT-PRE-1.A (D.4) : badge de branding "Partagé par <org>" en bas du hero
// avec logo (mode 'dark' = version pour fond sombre) si l'org en a un.
// L'eyebrow "Suivi des livrables" peut être surchargé par org.share_intro_text.
// Si org est null (caller legacy / RPC ancienne version), comportement
// inchangé (pas de badge, eyebrow par défaut).
// ════════════════════════════════════════════════════════════════════════════

import { Film, FileText, Loader2, Moon, Sun } from 'lucide-react'
import { pickOrgLogo } from '../../../../lib/branding'

export default function ShareHeader({ project, share, generatedAt, org = null, theme, onToggleTheme, onExportPdf, exporting }) {
  const title = project?.title || 'Projet'
  const ref = project?.ref_projet
  const cover = project?.cover_url
  const shareLabel = share?.label

  const generatedFr = formatDateTimeFR(generatedAt)

  // MT-PRE-1.A : eyebrow customisable par org (ex: "Suivi production",
  // "Espace client OMNI FILMS"…), fallback sur l'eyebrow par défaut.
  const eyebrow = org?.share_intro_text?.trim() || 'Suivi des livrables'

  // MT-PRE-1.A : signature org. Le hero est sombre (overlay noir 0.7+),
  // donc on prend le logo en mode 'dark' = la version blanche/claire conçue
  // pour fond sombre. Pas de fallback Captiv automatique : si l'org a pas
  // de logo, on affiche juste le nom commercial en texte (badge subtil).
  const hasOrgLogo = Boolean(
    org?.logo_banner_url || org?.logo_url_clair || org?.logo_url_sombre
  )
  const orgLogoUrl = hasOrgLogo ? pickOrgLogo(org, 'dark') : null
  const orgName = org?.display_name || org?.legal_name || ''

  return (
    <header
      className="relative rounded-2xl overflow-hidden shadow-sm"
      style={{ border: '1px solid var(--brd)' }}
    >
      {/* Background : image cover floutée OU gradient fallback */}
      {cover ? (
        <>
          <img
            src={cover}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: 'blur(24px) saturate(1.1)', transform: 'scale(1.15)' }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.7) 50%, rgba(0,0,0,0.55) 100%)',
            }}
          />
        </>
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #334155 0%, #0f172a 100%)' }}
        />
      )}

      {/* Actions flottantes en haut à droite */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-10 flex items-center gap-2">
        {onExportPdf && (
          <button
            type="button"
            onClick={onExportPdf}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur transition-colors"
            style={{
              background: 'rgba(255,255,255,0.15)',
              color: 'white',
              border: '1px solid rgba(255,255,255,0.25)',
              cursor: exporting ? 'wait' : 'pointer',
              opacity: exporting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
            }}
            onMouseLeave={(e) => {
              if (!exporting) e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
            }}
            title="Exporter en PDF"
          >
            {exporting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileText className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">PDF</span>
          </button>
        )}
        {onToggleTheme && <GlassThemeToggle theme={theme} onToggle={onToggleTheme} />}
      </div>

      {/* Contenu : vignette carrée nette à gauche + textes à droite */}
      <div className="relative p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:gap-6 items-start sm:items-center">
        {cover ? (
          <img
            src={cover}
            alt={title}
            className="flex-shrink-0 w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-xl object-cover"
            style={{
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.3)',
            }}
          />
        ) : (
          <div
            className="flex-shrink-0 w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-xl flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
            }}
          >
            <Film className="w-8 h-8" style={{ color: 'rgba(255,255,255,0.7)' }} />
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* MT-PRE-1.A : eyebrow enrichi avec branding org. Format inline :
              [logo] OMNI FILMS · Suivi des livrables. Si pas de logo image,
              juste le nom en texte. Si pas d'org du tout (RPC pas migrée),
              on retombe sur le texte seul (eyebrow par défaut). */}
          <div
            className="flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold mb-1"
            style={{ color: 'rgba(255,255,255,0.7)' }}
          >
            {orgLogoUrl && (
              <img
                src={orgLogoUrl}
                alt={orgName}
                className="h-3.5 w-auto object-contain shrink-0"
                style={{ maxWidth: '60px' }}
              />
            )}
            {orgName && !orgLogoUrl && (
              <span style={{ color: 'rgba(255,255,255,0.95)' }}>{orgName}</span>
            )}
            {orgName && (
              <span aria-hidden="true" style={{ color: 'rgba(255,255,255,0.4)' }}>·</span>
            )}
            <span>{eyebrow}</span>
          </div>
          <h1
            className="text-xl sm:text-2xl md:text-3xl font-bold leading-tight break-words text-white"
            style={{ textShadow: '0 2px 8px rgba(0,0,0,0.5)' }}
          >
            {title}
          </h1>
          <div
            className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            {ref && (
              <span
                className="font-mono px-2 py-0.5 rounded backdrop-blur"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                {ref}
              </span>
            )}
            {shareLabel && (
              <span style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{shareLabel}</span>
            )}
            {generatedFr && (
              <span
                className="sm:ml-auto"
                style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)', color: 'rgba(255,255,255,0.75)' }}
              >
                Mis à jour {generatedFr}
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}

// Variante "glass" du ThemeToggle, posée sur le hero sombre (couleurs en
// dur — pas de CSS vars — pour rester lisible quel que soit le theme courant).
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

function formatDateTimeFR(isoOrDate) {
  if (!isoOrDate) return null
  const d = new Date(isoOrDate)
  if (Number.isNaN(d.getTime())) return null
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `le ${dd}/${mm}/${yyyy} à ${hh}:${min}`
}

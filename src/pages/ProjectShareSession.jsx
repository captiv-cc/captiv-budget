// ════════════════════════════════════════════════════════════════════════════
// ProjectShareSession — Page publique HUB du portail projet (PROJECT-SHARE-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Route /share/projet/:token. Hub d'accueil pour le destinataire externe :
//   - Header projet (cover, nom, ref, org)
//   - Cartes cliquables vers chaque sous-page activée
//   - Toggle thème (partagé avec les sous-pages via localStorage commun)
//   - Footer
//
// Sous-pages :
//   /share/projet/:token/equipe     → ProjectShareEquipeSession
//   /share/projet/:token/livrables  → ProjectShareLivrablesSession
//
// Pour ajouter une page : 1 entrée dans PAGE_REGISTRY ci-dessous + créer
// la page React correspondante + ajouter la route dans App.jsx.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  AlertCircle, Loader2, Users, CheckSquare, Package, ChevronRight,
} from 'lucide-react'
import { useProjectShareHub } from '../hooks/useProjectShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import ProjectSharePasswordGate from '../components/share/ProjectSharePasswordGate'

// Clé localStorage commune au hub + sous-pages → toggle thème cohérent
// quand l'utilisateur navigue d'une page à l'autre.
export const PROJECT_SHARE_THEME_KEY = 'project-share-theme'

// Registre des pages disponibles. Pour ajouter une page : 1 ligne ici.
// Les "teasers" sont des fonctions qui prennent le payload du hub et
// retournent un texte court à afficher dans la carte (peut être null si
// pas de data — la carte reste affichée).
const PAGE_REGISTRY = {
  equipe: {
    label: 'Équipe',
    description: 'Liste de l\u2019équipe technique, présence, secteurs',
    Icon: Users,
    color: 'var(--purple)',
    bgColor: 'var(--purple-bg)',
    teaser: (hub) => {
      const t = hub?.teasers?.equipe
      if (!t) return null
      const persons = Number(t.persons || 0)
      const attribs = Number(t.attributions || 0)
      return `${persons} personne${persons > 1 ? 's' : ''} · ${attribs} attribution${attribs > 1 ? 's' : ''}`
    },
  },
  livrables: {
    label: 'Livrables',
    description: 'Suivi des livrables, versions, dates',
    Icon: CheckSquare,
    color: 'var(--blue)',
    bgColor: 'var(--blue-bg)',
    teaser: (hub) => {
      const t = hub?.teasers?.livrables
      if (!t) return null
      const count = Number(t.count || 0)
      return `${count} livrable${count > 1 ? 's' : ''}`
    },
  },
  materiel: {
    label: 'Matériel',
    description: 'Liste matériel — version active ou figée',
    Icon: Package,
    color: 'var(--orange)',
    bgColor: 'var(--orange-bg)',
    teaser: (hub) => {
      const t = hub?.teasers?.materiel
      if (!t) return null
      const items = Number(t.items || 0)
      const blocks = Number(t.blocks || 0)
      return `${items} item${items > 1 ? 's' : ''} · ${blocks} bloc${blocks > 1 ? 's' : ''}`
    },
  },
}

export default function ProjectShareSession() {
  const { token } = useParams()
  const {
    payload, loading, error,
    requirePassword, passwordHint, passwordKind, submitPassword,
  } = useProjectShareHub(token)

  // Toggle thème — partagé entre hub + sous-pages via la clé commune.
  // Default 'dark' (cohérent avec EquipeShareSession). Peut évoluer plus
  // tard vers une préférence utilisateur (system / dark / light).
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(PROJECT_SHARE_THEME_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECT_SHARE_THEME_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (requirePassword) {
    return (
      <ProjectSharePasswordGate
        kind={passwordKind || 'missing'}
        hint={passwordHint}
        onSubmit={submitPassword}
      />
    )
  }
  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement du portail…
      </FullScreenStatus>
    )
  }
  if (error || !payload) {
    return <ErrorState error={error} />
  }

  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const enabledPages = Array.isArray(share.enabled_pages) ? share.enabled_pages : []

  const onToggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  // MetaItems pour le SharePageHeader. Choix UX (cf. retours Hugo) :
  //   - On NE pousse PAS share.label (libellé interne admin "Régisseur Paul",
  //     pas pertinent pour le visiteur côté hub).
  //   - On pousse ref_projet, le badge "Portail privé" (si protégé), et la
  //     date de génération en dernier (sm:ml-auto pour passer à droite).
  const metaItems = []
  if (project.ref_projet) {
    metaItems.push({ type: 'ref', value: project.ref_projet })
  }
  if (share.password_protected) {
    metaItems.push({ type: 'lock', value: 'Portail privé' })
  }
  if (payload.generated_at) {
    metaItems.push({ type: 'date', value: payload.generated_at })
  }

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        {/* Hub : on remonte le projet en H1 (titre dominant pour le visiteur)
            et on dégrade "Portail projet" en kicker uppercase au-dessus.
            Le SharePageHeader masque automatiquement le H2 si le H1 ===
            project.title pour éviter le doublon visuel. */}
        <SharePageHeader
          pageTitle={project.title || 'Portail projet'}
          kicker="Portail projet"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {/* ── Cartes des sous-pages activées ───────────────────────────── */}
        <main className="mt-6 sm:mt-8">
          <h2
            className="text-[11px] font-bold uppercase tracking-wider mb-3 sm:mb-4"
            style={{ color: 'var(--txt-3)' }}
          >
            Pages disponibles
          </h2>

          {enabledPages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              {enabledPages.map((pageKey) => {
                const meta = PAGE_REGISTRY[pageKey]
                if (!meta) return null // page registrée côté DB mais pas côté front
                return (
                  <PageCard
                    key={pageKey}
                    to={`/share/projet/${encodeURIComponent(token)}/${pageKey}`}
                    meta={meta}
                    teaser={meta.teaser ? meta.teaser(payload) : null}
                  />
                )
              })}
            </div>
          )}
        </main>

        <SharePageFooter generatedAt={payload.generated_at} />
      </div>
    </div>
  )
}

// ─── Carte d'une sous-page ──────────────────────────────────────────────────
function PageCard({ to, meta, teaser }) {
  const { label, description, Icon, color, bgColor } = meta
  return (
    <Link
      to={to}
      className="group block rounded-xl p-4 sm:p-5 transition-all"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.borderColor = color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-surf)'
        e.currentTarget.style.borderColor = 'var(--brd)'
      }}
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          className="w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: bgColor }}
        >
          <Icon className="w-5 h-5 sm:w-5.5 sm:h-5.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base sm:text-lg font-bold truncate" style={{ color: 'var(--txt)' }}>
              {label}
            </h3>
            <ChevronRight
              className="w-4 h-4 transition-transform shrink-0 group-hover:translate-x-0.5"
              style={{ color: 'var(--txt-3)' }}
            />
          </div>
          <p className="text-xs sm:text-sm mt-0.5 leading-snug" style={{ color: 'var(--txt-3)' }}>
            {description}
          </p>
          {teaser && (
            <p
              className="text-xs sm:text-[13px] mt-2 font-medium"
              style={{ color: 'var(--txt-2)' }}
            >
              {teaser}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}

// ─── Empty state si aucune page activée (cas d'erreur config) ──────────────
function EmptyState() {
  return (
    <div
      className="rounded-xl p-8 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <AlertCircle
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="font-semibold text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucune page activée
      </p>
      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)', opacity: 0.7 }}>
        Ce portail ne contient aucune page consultable. Contactez l&rsquo;équipe production.
      </p>
    </div>
  )
}

// ─── États système (loading / erreur) ──────────────────────────────────────
function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="flex flex-col items-center gap-3">
        {icon}
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {children}
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || 'Erreur inconnue'
  const isInvalid = msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-md w-full text-center p-6 sm:p-8 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <AlertCircle
          className="w-10 h-10 mx-auto mb-3"
          style={{ color: 'var(--red)', opacity: 0.7 }}
        />
        <h1 className="text-base font-bold mb-2" style={{ color: 'var(--txt)' }}>
          Lien {isInvalid ? 'invalide' : 'inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? 'Ce lien n\u2019est plus valide. Il a peut-être été révoqué ou a expiré. Contactez la production pour en obtenir un nouveau.'
            : 'Impossible de charger le portail pour le moment. Réessayez dans quelques instants.'}
        </p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ProjectShareLogistiqueV0Session — Sous-page /share/projet/:token/logistique_v0
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY de la logistique V0 d'un projet, partagée via le portail
// public. Affiche les entries (transport / hébergement / repas + docs) en
// réutilisant LogistiqueEntryCard avec readOnly=true — pas de duplication
// de code de rendu.
//
// Sécurité :
//   - RPC share_projet_logistique_v0_fetch (SECURITY DEFINER) filtre par
//     token avec required page = 'logistique_v0'.
//   - Storage policy SELECT anon (configurée dans logistique_v0_schema.sql)
//     autorise createSignedUrl pour les utilisateurs anon tant qu'un
//     project_share_token actif existe avec logistique_v0 dans enabled_pages.
//
// Pattern aligné sur ProjectShareDerouleSession.jsx.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AlertCircle, ArrowLeft, Loader2, Truck } from 'lucide-react'
import { useProjectShareLogistiqueV0 } from '../hooks/useProjectShareSession'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import ProjectSharePasswordGate from '../components/share/ProjectSharePasswordGate'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import LogistiqueEntryCard from '../features/logistique/LogistiqueEntryCard'

const THEME_STORAGE_KEY = PROJECT_SHARE_THEME_KEY

export default function ProjectShareLogistiqueV0Session() {
  const { token } = useParams()
  const {
    payload,
    loading,
    error,
    requirePassword,
    passwordHint,
    passwordKind,
    submitPassword,
  } = useProjectShareLogistiqueV0(token)

  // Thème partagé avec le hub.
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
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
        pageLabel="la logistique"
      />
    )
  }
  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement de la logistique…
      </FullScreenStatus>
    )
  }
  if (error || !payload) {
    return <ErrorState error={error} token={token} />
  }

  return (
    <div style={{ background: 'var(--bg)' }}>
      <BackToHubLink token={token} />
      <LogistiqueShareView
        payload={payload}
        theme={theme}
        setTheme={setTheme}
      />
    </div>
  )
}

// ─── Vue read-only réutilisable ────────────────────────────────────────────
// On la nomme exported pour permettre une réutilisation future si besoin
// (par exemple dans un mode preview admin du share).

export function LogistiqueShareView({ payload, theme, setTheme }) {
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const entries = useMemo(() => payload.entries || [], [payload.entries])
  const documents = useMemo(() => payload.documents || [], [payload.documents])
  const membres = useMemo(() => payload.membres || [], [payload.membres])

  // Map<membre_id, membre> pour lookup O(1)
  const membreById = useMemo(() => {
    const m = new Map()
    for (const x of membres) m.set(x.id, x)
    return m
  }, [membres])

  // Map<entry_id, Map<kind, Array<doc>>> pour le rendu des cards
  const documentsByEntry = useMemo(() => {
    const map = new Map()
    for (const doc of documents) {
      if (!map.has(doc.entry_id)) map.set(doc.entry_id, new Map())
      const byKind = map.get(doc.entry_id)
      if (!byKind.has(doc.kind)) byKind.set(doc.kind, [])
      byKind.get(doc.kind).push(doc)
    }
    return map
  }, [documents])

  // Header meta items
  const metaItems = []
  if (project.ref_projet) metaItems.push({ type: 'ref', value: project.ref_projet })
  if (share.label) metaItems.push({ type: 'label', value: share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        <SharePageHeader
          pageTitle="Logistique"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />

        {/* Liste des cards */}
        {entries.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="mt-5 space-y-4">
            {entries.map((entry) => {
              const membre = membreById.get(entry.membre_id)
              return (
                <LogistiqueEntryCard
                  key={entry.id}
                  entry={entry}
                  membre={membre}
                  documentsByKind={documentsByEntry.get(entry.id)}
                  readOnly={true}
                />
              )
            })}
          </div>
        )}

        <SharePageFooter />
      </div>
    </div>
  )
}

// ─── Lien retour vers le hub portail ───────────────────────────────────────
function BackToHubLink({ token }) {
  return (
    <div
      className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-4 sm:pt-6"
      style={{ background: 'var(--bg)' }}
    >
      <Link
        to={`/share/projet/${encodeURIComponent(token)}`}
        className="inline-flex items-center gap-1.5 text-xs font-semibold transition-colors"
        style={{ color: 'var(--txt-3)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Portail projet
      </Link>
    </div>
  )
}

// ─── Empty / Status ────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <div
      className="mt-6 rounded-xl p-12 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Truck
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucune information logistique renseignée pour ce projet.
      </p>
    </div>
  )
}

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

function ErrorState({ error, token }) {
  const msg = error?.message || 'Erreur inconnue'
  const lower = msg.toLowerCase()
  const isInvalid = lower.includes('invalid') || lower.includes('expired')
  const isNotEnabled = lower.includes('non activée') || lower.includes('not enabled')
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
          {isInvalid
            ? 'Lien invalide'
            : isNotEnabled
              ? 'Page non activée'
              : 'Page inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed mb-4" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? "Ce lien n'est plus valide. Il a peut-être été révoqué ou a expiré."
            : isNotEnabled
              ? "La page Logistique n'est pas activée pour ce portail."
              : 'Impossible de charger la logistique pour le moment. Réessayez dans quelques instants.'}
        </p>
        {token && (
          <Link
            to={`/share/projet/${encodeURIComponent(token)}`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold"
            style={{ color: 'var(--blue)' }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour au portail
          </Link>
        )}
      </div>
    </div>
  )
}

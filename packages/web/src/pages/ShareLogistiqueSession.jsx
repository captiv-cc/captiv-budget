// ════════════════════════════════════════════════════════════════════════════
// ShareLogistiqueSession — Page publique /share/logistique/:token
// ════════════════════════════════════════════════════════════════════════════
//
// Lien DÉDIÉ au module Logistique (comme /share/deroule/:token) : token
// logistique_share_tokens, RPC share_logistique_fetch, aucun lien vers le
// hub portail projet. Le rendu est LogistiqueShareView, partagé avec la
// sous-page portail /share/projet/:token/logistique_v0 — même payload,
// même config sections (appliquée côté serveur).
//
// Pattern aligné sur DerouleShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { fetchSharePayload } from '../lib/logistiqueShare'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import { LogistiqueShareView } from './ProjectShareLogistiqueV0Session'

const THEME_STORAGE_KEY = PROJECT_SHARE_THEME_KEY

export default function ShareLogistiqueSession() {
  const { token } = useParams()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return undefined
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchSharePayload(token)
      .then((data) => {
        if (!cancelled) setPayload(data)
      })
      .catch((e) => {
        if (!cancelled) setError(e)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // Thème clair/sombre — même clé que les autres pages share.
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
    return <ErrorState error={error} />
  }

  return (
    <div style={{ background: 'var(--bg)' }}>
      <LogistiqueShareView payload={payload} theme={theme} setTheme={setTheme} />
    </div>
  )
}

// ─── Status / erreurs ──────────────────────────────────────────────────────

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
  const lower = msg.toLowerCase()
  const isInvalid = lower.includes('invalid') || lower.includes('expired')
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
          {isInvalid ? 'Lien invalide' : 'Page inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? "Ce lien n'est plus valide. Il a peut-être été révoqué ou a expiré."
            : 'Impossible de charger la logistique pour le moment. Réessayez dans quelques instants.'}
        </p>
      </div>
    </div>
  )
}

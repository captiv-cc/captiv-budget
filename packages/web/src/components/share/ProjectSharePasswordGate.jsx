// ════════════════════════════════════════════════════════════════════════════
// ProjectSharePasswordGate — Écran de saisie mdp pour les portails protégés
// (PROJECT-SHARE-PWD)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiché par les pages /share/projet/:token/* quand la RPC raise 28P01
// (mdp requis ou invalide). Présente un input + un message d'erreur si le
// précédent mdp était mauvais. L'indice (`hint`) est optionnel et stocké
// au niveau du token (visible avant authentification).
//
// Le mdp est transmis vers le hook via `onSubmit(plain)` qui le stocke en
// sessionStorage et déclenche un refetch. Pas d'auth state durable —
// fermeture de l'onglet = re-saisie du mdp.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Lock, AlertCircle, ArrowRight } from 'lucide-react'

export default function ProjectSharePasswordGate({
  hint = null,
  kind = 'missing',
  onSubmit,
  pageLabel = null, // ex: 'l\u2019équipe', 'les livrables'. Optionnel — affiné par la sous-page.
}) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const isInvalid = kind === 'invalid'

  const handleSubmit = (e) => {
    e?.preventDefault?.()
    if (!value || submitting) return
    setSubmitting(true)
    // submitPassword() ne renvoie pas de promesse (refetch async via reloadKey)
    // — on relâche l'état submitting au prochain render via le change de key.
    try {
      onSubmit?.(value)
    } finally {
      // Sécurité : si le hook ne triggère pas de re-render dans la même tick,
      // on rend la main au bouton.
      setTimeout(() => setSubmitting(false), 600)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 share-fade-in"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-md w-full text-center p-7 sm:p-9 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
          style={{
            background: isInvalid ? 'var(--red-bg)' : 'var(--blue-bg)',
            color: isInvalid ? 'var(--red)' : 'var(--blue)',
          }}
        >
          <Lock className="w-6 h-6" />
        </div>

        <h1
          className="text-lg sm:text-xl font-bold mb-2"
          style={{ color: 'var(--txt)' }}
        >
          {pageLabel
            ? `Accès protégé à ${pageLabel}`
            : 'Portail protégé'}
        </h1>

        <p
          className="text-sm leading-relaxed mb-5"
          style={{ color: 'var(--txt-2)' }}
        >
          {isInvalid
            ? 'Mot de passe incorrect. Réessayez ou demandez à la production.'
            : 'Saisissez le mot de passe pour accéder à ce portail.'}
        </p>

        {hint && (
          <div
            className="text-[11px] mb-4 px-3 py-2 rounded-md inline-flex items-start gap-2 text-left"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            <span
              className="text-[9px] uppercase tracking-wider font-bold shrink-0 mt-px"
              style={{ color: 'var(--txt-3)' }}
            >
              Indice
            </span>
            <span className="leading-snug">{hint}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Mot de passe"
            autoComplete="current-password"
            autoFocus
            disabled={submitting}
            className="w-full px-3 py-2.5 rounded-md text-sm outline-none transition-colors"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: `1px solid ${isInvalid ? 'var(--red)' : 'var(--brd)'}`,
            }}
            onFocus={(e) => {
              if (!isInvalid) e.currentTarget.style.borderColor = 'var(--blue)'
            }}
            onBlur={(e) => {
              if (!isInvalid) e.currentTarget.style.borderColor = 'var(--brd)'
            }}
          />

          <button
            type="submit"
            disabled={!value || submitting}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-semibold transition-all"
            style={{
              background: 'var(--blue)',
              color: 'white',
              border: '1px solid var(--blue)',
              opacity: !value || submitting ? 0.55 : 1,
              cursor: !value || submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Vérification…' : 'Accéder au portail'}
            {!submitting && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        {isInvalid && (
          <p
            className="text-[10px] mt-3 inline-flex items-center gap-1"
            style={{ color: 'var(--red)' }}
          >
            <AlertCircle className="w-3 h-3" />
            Mot de passe incorrect.
          </p>
        )}
      </div>
    </div>
  )
}

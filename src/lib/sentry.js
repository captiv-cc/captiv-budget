import * as Sentry from '@sentry/react'

const DSN = import.meta.env.VITE_SENTRY_DSN

/**
 * Initialise Sentry uniquement si un DSN est configuré.
 * En dev sans DSN, rien ne se passe — aucun impact.
 */
export function initSentry() {
  if (!DSN) return

  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE, // 'development' | 'production'
    // Capture 10% des transactions pour le monitoring de performance
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,
    // En dev, on log tout ; en prod, on filtre le bruit
    beforeSend(event) {
      // Ignore les erreurs réseau (Supabase timeout, etc.) en prod
      if (import.meta.env.PROD && event.exception?.values?.[0]?.type === 'TypeError') {
        const msg = event.exception.values[0].value || ''
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return null
      }
      return event
    },
  })
}

/**
 * Report manuel d'une erreur (pour les catch existants).
 * Exemple : captureError(error, { context: 'loadProjects' })
 */
export function captureError(error, extra = {}) {
  console.error('[Sentry]', error)
  if (DSN) {
    Sentry.captureException(error, { extra })
  }
}

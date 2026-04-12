import { Component } from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { captureError } from '../lib/sentry'

/**
 * ErrorBoundary global — attrape les erreurs JavaScript non gérées
 * qui remonteraient jusqu'ici et empêche la "page blanche".
 *
 * Pour l'instant on se contente d'un fallback visuel propre.
 * Plus tard (chantier 4+), on pourra brancher Sentry via componentDidCatch
 * pour logger automatiquement les erreurs en production.
 *
 * Les Error Boundaries DOIVENT être des composants de classe en React.
 * C'est la seule API React qui nécessite encore ce format.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    // Appelé pendant la "render phase" — met à jour le state pour afficher le fallback
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // Appelé pendant la "commit phase" — bon endroit pour logger

    console.error('[ErrorBoundary] Crash React capturé:', error, errorInfo)
    this.setState({ errorInfo })

    // Report vers Sentry (no-op si DSN absent)
    captureError(error, { componentStack: errorInfo?.componentStack })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleHome = () => {
    window.location.href = '/accueil'
  }

  render() {
    if (!this.state.hasError) return this.props.children

    const { error, errorInfo } = this.state
    const isDev = import.meta.env?.DEV

    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        style={{ background: 'var(--bg)' }}
      >
        <div
          className="w-full max-w-lg rounded-2xl shadow-xl p-8 bg-white"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-11 h-11 rounded-full bg-red-50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Oups, une erreur est survenue</h1>
              <p className="text-xs text-gray-500 mt-0.5">
                L&apos;application a rencontré un problème inattendu
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-700 leading-relaxed mb-6">
            Vos données sont sauvegardées. Tu peux recharger la page pour reprendre là où tu en
            étais. Si le problème se répète, contacte l&apos;équipe CAPTIV avec une capture
            d&apos;écran.
          </p>

          {isDev && error && (
            <details className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-600 select-none">
                Détails techniques (mode développement)
              </summary>
              <div className="mt-3 space-y-2">
                <pre className="text-[11px] text-red-700 whitespace-pre-wrap break-words font-mono">
                  {error.toString()}
                </pre>
                {errorInfo?.componentStack && (
                  <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words font-mono max-h-40 overflow-auto">
                    {errorInfo.componentStack}
                  </pre>
                )}
              </div>
            </details>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Recharger la page
            </button>
            <button
              type="button"
              onClick={this.handleHome}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium transition"
            >
              <Home className="w-4 h-4" aria-hidden="true" />
              Retour à l&apos;accueil
            </button>
          </div>
        </div>
      </div>
    )
  }
}

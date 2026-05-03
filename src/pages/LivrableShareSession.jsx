// ════════════════════════════════════════════════════════════════════════════
// LivrableShareSession — Page publique /share/livrables/:token (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY simplifiée de l'état des livrables d'un projet, partagée à
// un client externe via un lien public. Aucune authentification requise.
//
// Sécurité : la RPC share_livrables_fetch (SECURITY DEFINER) filtre les
// données côté serveur — pas d'étapes (sauf calendar_level='phases'), pas
// d'assignee, pas de notes internes, feedback / dates prévues conditionnés
// par les toggles config du token.
//
// Layout plein écran (hors Layout app) avec un design neutre indépendant du
// thème dark interne — Tailwind pur, look professionnel.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, FileText, Loader2, Moon, Sun } from 'lucide-react'
import { useLivrableShareSession } from '../hooks/useLivrableShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import SharePeriodesBar from '../features/livrables/components/share/SharePeriodesBar'
import ShareTimeline from '../features/livrables/components/share/ShareTimeline'
import ShareLivrablesList from '../features/livrables/components/share/ShareLivrablesList'
import { buildLivrablesSharePdf } from '../features/livrables/livrablesSharePdfExport'

const THEME_STORAGE_KEY = 'liv-share-theme'

export default function LivrableShareSession() {
  const { token } = useParams()
  const { payload, loading, error } = useLivrableShareSession(token)

  // Toggle dark / light, persisté localStorage. Pattern miroir de
  // CheckSession (MAT-10K) — la page client utilise les CSS vars
  // --bg/--txt/--bg-surf etc. plutôt que des classes Tailwind hardcodées,
  // de sorte que le switch fait suivre tout le layout automatiquement.
  // Default 'light' (lecture client typique en journée + design optimisé).
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'light'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.dataset.checkTheme = 'light'
    } else {
      delete root.dataset.checkTheme
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (loading) {
    return <FullScreenStatus icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}>
      Chargement…
    </FullScreenStatus>
  }

  if (error || !payload) {
    return <ErrorState error={error} />
  }

  const { share, project, blocks, livrables, versions } = payload
  const etapes = payload.etapes || []
  const eventTypes = payload.event_types || []
  // MT-PRE-1.A : org transportée par la RPC share_livrables_fetch (étendue
  // en D.4). null si la RPC n'a pas encore été migrée — le rendu fallback
  // gracieusement sur l'apparence Captiv historique.
  const org = payload.org || null
  const config = share?.config || {}
  const calendarLevel = config.calendar_level || 'hidden'

  return (
    <ShareContent
      payload={payload}
      project={project}
      share={share}
      org={org}
      blocks={blocks}
      livrables={livrables}
      versions={versions}
      etapes={etapes}
      eventTypes={eventTypes}
      config={config}
      calendarLevel={calendarLevel}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
    />
  )
}

// Sous-composant pour héberger l'état d'export PDF (qui doit pouvoir
// déclencher un re-render du bouton "exporting" sans toucher au hook
// principal). Garde aussi le code de la page racine plus lisible.
function ShareContent({
  payload,
  project,
  share,
  org = null,
  blocks,
  livrables,
  versions,
  etapes,
  eventTypes,
  config,
  calendarLevel,
  theme,
  onToggleTheme,
}) {
  const [exporting, setExporting] = useState(false)

  const handleExportPdf = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const pdf = await buildLivrablesSharePdf(payload)
      // Télécharge directement (le client veut le fichier en main).
      pdf.download()
      // Révoque l'URL après un court délai pour laisser le download partir.
      setTimeout(() => pdf.revoke(), 1000)
    } catch (err) {
      console.error('[livrableShare] PDF export error', err)
      alert('Une erreur est survenue lors de la génération du PDF.')
    } finally {
      setExporting(false)
    }
  }

  // Construction des metaItems pour le SharePageHeader (typés).
  const metaItems = []
  if (project?.ref_projet) metaItems.push({ type: 'ref', value: project.ref_projet })
  if (share?.label) metaItems.push({ type: 'label', value: share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6 share-fade-in">
        <SharePageHeader
          pageTitle={org?.share_intro_text?.trim() || 'Suivi des livrables'}
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={onToggleTheme}
          actions={
            <PdfActionButton onClick={handleExportPdf} loading={exporting} />
          }
        />

        {config.show_periodes && project?.periodes && (
          <SharePeriodesBar periodes={project.periodes} />
        )}

        {calendarLevel !== 'hidden' && (
          <ShareTimeline
            blocks={blocks}
            livrables={livrables}
            versions={versions}
            etapes={etapes}
            eventTypes={eventTypes}
            periodes={config.show_periodes ? project?.periodes : null}
            calendarLevel={calendarLevel}
          />
        )}

        <ShareLivrablesList
          blocks={blocks}
          livrables={livrables}
          versions={versions}
          config={config}
        />

        {/* Footer "Powered by captiv." centré subtil — partagé entre toutes
            les pages /share/*. La signature org est portée par le hero
            (SharePageHeader top-left). */}
        <SharePageFooter />
      </div>
    </div>
  )
}

// Bouton PDF "glass" pour le hero (sur fond sombre).
function PdfActionButton({ onClick, loading }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold backdrop-blur transition-colors"
      style={{
        background: 'rgba(255,255,255,0.15)',
        color: 'white',
        border: '1px solid rgba(255,255,255,0.25)',
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.7 : 1,
      }}
      onMouseEnter={(e) => {
        if (!loading) e.currentTarget.style.background = 'rgba(255,255,255,0.25)'
      }}
      onMouseLeave={(e) => {
        if (!loading) e.currentTarget.style.background = 'rgba(255,255,255,0.15)'
      }}
      title="Exporter en PDF"
    >
      {loading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <FileText className="w-3.5 h-3.5" />
      )}
      <span className="hidden sm:inline">PDF</span>
    </button>
  )
}

// Bouton toggle dark/light — exporté pour réutilisation par d'autres pages share.
export function ThemeToggle({ theme, onToggle }) {
  const Icon = theme === 'light' ? Moon : Sun
  return (
    <button
      type="button"
      onClick={onToggle}
      className="p-2 rounded-lg transition-colors shrink-0"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        color: 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-elev)'
        e.currentTarget.style.color = 'var(--txt-2)'
      }}
      title={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
      aria-label={theme === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair'}
    >
      <Icon className="w-4 h-4" />
    </button>
  )
}

// ─── États ────────────────────────────────────────────────────────────────

function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="flex items-center justify-center min-h-screen"
      style={{ background: 'var(--bg)', color: 'var(--txt-2)' }}
    >
      <div className="flex flex-col items-center gap-3 text-sm">
        {icon}
        <p>{children}</p>
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  const message = String(error?.message || '').toLowerCase()
  const isInvalid = message.includes('invalid') || message.includes('expired') || message.includes('token')

  const techDetail = !isInvalid
    ? [error?.code, error?.message, error?.hint, error?.details]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div
      className="flex items-center justify-center min-h-screen px-6"
      style={{ background: 'var(--bg)', color: 'var(--txt-2)' }}
    >
      <div
        className="max-w-md w-full rounded-2xl shadow-sm p-8 text-center"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <div
          className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4"
          style={{ background: 'var(--orange-bg)', color: 'var(--orange)' }}
        >
          <AlertCircle className="w-7 h-7" />
        </div>
        <h1 className="text-lg font-semibold mb-2" style={{ color: 'var(--txt)' }}>
          {isInvalid ? 'Lien indisponible' : 'Une erreur est survenue'}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? 'Ce lien n\u2019est plus valide. Il a peut-\u00eatre \u00e9t\u00e9 r\u00e9voqu\u00e9 ou a expir\u00e9. Contactez la production pour en obtenir un nouveau.'
            : 'Impossible de charger les livrables pour le moment. R\u00e9essayez dans quelques instants.'}
        </p>
        {techDetail && (
          <details className="mt-4 text-left">
            <summary
              className="cursor-pointer text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--txt-3)' }}
            >
              Détails techniques
            </summary>
            <pre
              className="mt-2 text-[10px] whitespace-pre-wrap break-all p-2 rounded"
              style={{
                color: 'var(--txt-3)',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              {techDetail}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

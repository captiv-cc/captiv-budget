// ════════════════════════════════════════════════════════════════════════════
// BonRetourExportModal — export bon de retour avec choix de format + preview (MAT-13H)
// ════════════════════════════════════════════════════════════════════════════
//
// Pendant de `BilanExportModal` pour la phase rendu. Trois modes d'export :
//
//   1. "Global"      → un seul PDF combiné (tous les loueurs)
//   2. "ZIP complet" → un PDF global + un PDF par loueur, empaquetés en ZIP
//   3. "Par loueur"  → un seul PDF filtré sur un loueur (sélecteur)
//
// Conçu pour être ouvert UNIQUEMENT depuis `RenduSession` (flow checklist
// terrain ou admin). À l'inverse du bilan, on n'a pas aujourd'hui de flow
// admin MaterielTab qui ouvrirait ce modal sans session préchargée — donc
// la prop `session` est REQUISE (pas de fetch interne, pas de versionId).
//
// MAT-13G : le snapshot généré par `aggregateBilanData` pass-through
// `version_loueur_infos` pour que les feedbacks par loueur atterrissent dans
// les PDFs sans re-fetch.
//
// Props :
//   - open           : boolean
//   - onClose        : () => void
//   - session        : objet session préchargé (requis — fourni par le hook
//                      `useRenduTokenSession` ou `useRenduAuthedSession`)
//   - org            : object (organisation — passée au PDF builder pour le footer)
//
// Responsive (MAT-RESP-CHECK-5, 2026-04) — miroir strict du fix appliqué à
// BilanExportModal pour la phase essais. Voir commentaire équivalent dans
// `BilanExportModal.jsx` pour le rationnel détaillé.
//   - Desktop (>=sm) : modale centrée 1200×92vh, panneau latéral 320px + iframe
//     à droite (layout d'origine).
//   - Mobile (<sm)   : plein écran, body vertical — onglets horizontaux
//     `ModeTab` + <select> natif pour loueur, iframe PDF en flex-1.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  Download,
  FileText,
  Loader2,
  User as UserIcon,
  X,
} from 'lucide-react'
import { aggregateBilanData, NO_LOUEUR_BUCKET_ID } from '../../../lib/matosBilanData'
import {
  buildBonRetourGlobalPdf,
  buildBonRetourLoueurPdf,
  buildBonRetourZip,
} from '../matosBonRetourPdf'
import { useBreakpoint } from '../../../hooks/useBreakpoint'

const MODES = [
  {
    id: 'global',
    label: 'Global combiné',
    description: 'Un seul PDF avec tous les loueurs réunis',
    icon: FileText,
  },
  {
    id: 'zip',
    label: 'ZIP complet',
    description: 'Un PDF global + un PDF par loueur, empaquetés',
    icon: Archive,
  },
  {
    id: 'loueur',
    label: 'Un seul loueur',
    description: 'PDF filtré sur un loueur précis',
    icon: UserIcon,
  },
]

export default function BonRetourExportModal({
  open,
  onClose,
  session = null,
  org = null,
}) {
  const { isMobile } = useBreakpoint()

  // Snapshot dérivé de la session (memoized pour éviter un re-compute à chaque
  // render). null si pas de session — on affiche alors un error state.
  const snapshot = useMemo(() => {
    if (!session) return null
    try {
      return aggregateBilanData(session)
    } catch (err) {
      console.error('[BonRetourExportModal] aggregateBilanData :', err)
      return null
    }
  }, [session])

  const [mode, setMode] = useState('global')
  const [selectedLoueurKey, setSelectedLoueurKey] = useState(null)

  const [currentPdf, setCurrentPdf] = useState(null) // { blob, url, filename, isZip?, globalPdf?, loueurPdfs?, download, revoke }
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState(null)

  // Identifiant de build pour ignorer les résolutions out-of-order (race
  // lors d'un switch rapide de mode avant que le précédent build n'ait résolu).
  const buildIdRef = useRef(0)
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // ─── Reset à l'ouverture / fermeture ─────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setMode('global')
      setSelectedLoueurKey(null)
      setBuildError(null)
      setCurrentPdf((prev) => {
        try { prev?.revoke?.() } catch { /* noop */ }
        return null
      })
    }
  }, [open])

  // ─── Pré-sélection du premier loueur à l'ouverture ───────────────────────
  useEffect(() => {
    if (!open || !snapshot) return
    const firstLoueur = snapshot.byLoueur?.[0]
    if (firstLoueur) {
      setSelectedLoueurKey(firstLoueur.loueur?.id || NO_LOUEUR_BUCKET_ID)
    }
  }, [open, snapshot])

  // ─── Builder : régénère le PDF/ZIP au changement de mode/loueur ──────────
  //
  // On utilise un compteur d'ID pour n'appliquer que le résultat le plus
  // récent : si l'utilisateur switche global → zip → global en rafale, seul
  // le dernier build persiste, les résultats intermédiaires sont révoqués.
  useEffect(() => {
    if (!open || !snapshot) return

    const currentBuildId = ++buildIdRef.current
    let cancelled = false

    async function build() {
      setBuilding(true)
      setBuildError(null)
      try {
        let result
        if (mode === 'global') {
          result = await buildBonRetourGlobalPdf(snapshot, { org })
          result.isZip = false
        } else if (mode === 'zip') {
          result = await buildBonRetourZip(snapshot, { org })
        } else if (mode === 'loueur') {
          if (!selectedLoueurKey) {
            setBuilding(false)
            return
          }
          const section = findLoueurSection(snapshot, selectedLoueurKey)
          if (!section) {
            throw new Error('Loueur introuvable dans le snapshot')
          }
          result = await buildBonRetourLoueurPdf(snapshot, {
            loueur: section.loueur,
            section,
            org,
          })
          result.isZip = false
        }

        if (cancelled || !aliveRef.current) {
          try { result?.revoke?.() } catch { /* noop */ }
          return
        }
        if (currentBuildId !== buildIdRef.current) {
          try { result?.revoke?.() } catch { /* noop */ }
          return
        }

        setCurrentPdf((prev) => {
          try { prev?.revoke?.() } catch { /* noop */ }
          return result
        })
      } catch (err) {
        if (cancelled || !aliveRef.current) return
        if (currentBuildId !== buildIdRef.current) return
        console.error('[BonRetourExportModal] build :', err)
        setBuildError(err?.message || String(err))
      } finally {
        if (!cancelled && aliveRef.current && currentBuildId === buildIdRef.current) {
          setBuilding(false)
        }
      }
    }

    build()

    return () => {
      cancelled = true
    }
  }, [open, snapshot, mode, selectedLoueurKey, org])

  // ─── Escape pour fermer ──────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ─── Cleanup total au unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      try { currentPdf?.revoke?.() } catch { /* noop */ }
    }
    // on veut capturer la dernière valeur connue à l'unmount seulement
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ─── Derived ─────────────────────────────────────────────────────────────
  const loueurOptions = useMemo(() => {
    if (!snapshot?.byLoueur) return []
    return snapshot.byLoueur.map((sec) => {
      const key = sec.loueur?.id || NO_LOUEUR_BUCKET_ID
      const label = sec.loueur?.nom || 'Sans loueur'
      const nItems = sec.blocks.reduce((s, b) => s + b.items.length, 0)
      return { key, label, nItems, couleur: sec.loueur?.couleur || null }
    })
  }, [snapshot])

  const handleDownload = useCallback(() => {
    if (!currentPdf?.download) return
    try {
      currentPdf.download()
    } catch (err) {
      console.error('[BonRetourExportModal] download :', err)
    }
  }, [currentPdf])

  if (!open) return null

  // Le PDF à afficher dans l'iframe :
  //   - mode global/loueur : l'URL direct
  //   - mode zip : l'URL du globalPdf interne
  const previewUrl = (() => {
    if (!currentPdf) return null
    if (currentPdf.isZip) return currentPdf.globalPdf?.url || null
    return currentPdf.url
  })()

  const previewFilename = currentPdf?.filename || '—'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Container */}
      <div
        className="fixed z-50 flex flex-col overflow-hidden sm:rounded-xl"
        style={
          isMobile
            ? {
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'var(--bg-elev)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              }
            : {
                top: '4vh',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(1200px, 96vw)',
                height: '92vh',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
              }
        }
        role="dialog"
        aria-label="Exporter le bon de retour"
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="min-w-0 flex-1">
            <h2
              className="text-sm font-bold truncate"
              style={{ color: 'var(--txt)' }}
              title="Exporter le bon de retour"
            >
              Exporter le bon de retour
            </h2>
            <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
              {previewFilename}
            </p>
          </div>

          <button
            type="button"
            onClick={handleDownload}
            disabled={!currentPdf || building}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--blue)',
              color: 'white',
              border: '1px solid var(--blue)',
            }}
            onMouseEnter={(e) => {
              if (currentPdf && !building) e.currentTarget.style.opacity = '0.9'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
            title="Télécharger le fichier"
          >
            <Download className="w-3.5 h-3.5" />
            Télécharger
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            title="Fermer (Échap)"
            className="p-1.5 rounded-md transition-all"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body :
         *   • desktop → [aside 320px] [preview flex-1]
         *   • mobile  → [aside top, max-height] / [preview below, flex-1]
         * Miroir strict de BilanExportModal. Les onglets horizontaux compacts
         * remplacent les radios verticaux verbeux pour libérer de la hauteur
         * à l'iframe PDF (inutilisable sinon).
         */}
        <div className={`flex-1 min-h-0 flex ${isMobile ? 'flex-col' : ''}`}>
          {/* Left / top panel */}
          <aside
            className={`shrink-0 overflow-y-auto ${isMobile ? 'w-full' : ''}`}
            style={
              isMobile
                ? {
                    borderBottom: '1px solid var(--brd-sub)',
                    background: 'var(--bg-elev)',
                  }
                : {
                    width: '320px',
                    borderRight: '1px solid var(--brd-sub)',
                    background: 'var(--bg-elev)',
                  }
            }
          >
            <div className={isMobile ? 'p-3 space-y-2.5' : 'p-4 space-y-4'}>
              <div>
                <h3
                  className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Format d&apos;export
                </h3>
                {isMobile ? (
                  <div className="flex gap-1.5">
                    {MODES.map((m) => (
                      <ModeTab
                        key={m.id}
                        active={mode === m.id}
                        onClick={() => setMode(m.id)}
                        icon={m.icon}
                        label={m.label}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {MODES.map((m) => (
                      <ModeRadio
                        key={m.id}
                        active={mode === m.id}
                        onClick={() => setMode(m.id)}
                        icon={m.icon}
                        label={m.label}
                        description={m.description}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Sélecteur loueur (visible en mode "loueur" uniquement) */}
              {mode === 'loueur' && (
                <div>
                  <h3
                    className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                    style={{ color: 'var(--txt-3)' }}
                  >
                    Loueur
                  </h3>
                  {loueurOptions.length === 0 ? (
                    <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                      Aucun loueur disponible.
                    </p>
                  ) : isMobile ? (
                    // Mobile : select natif pour minimiser la hauteur
                    <select
                      value={selectedLoueurKey || ''}
                      onChange={(e) => setSelectedLoueurKey(e.target.value)}
                      className="w-full text-xs px-2.5 py-2 rounded-md"
                      style={{
                        background: 'var(--bg-surf)',
                        border: '1px solid var(--brd)',
                        color: 'var(--txt)',
                      }}
                    >
                      {loueurOptions.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label} ({opt.nItems})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="space-y-1">
                      {loueurOptions.map((opt) => (
                        <LoueurRadio
                          key={opt.key}
                          active={selectedLoueurKey === opt.key}
                          onClick={() => setSelectedLoueurKey(opt.key)}
                          label={opt.label}
                          nItems={opt.nItems}
                          couleur={opt.couleur}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Note spécifique au ZIP (on visualise le global, pas le zip) */}
              {mode === 'zip' && currentPdf?.isZip && (
                <div
                  className="text-[11px] p-2.5 rounded-md"
                  style={{
                    background: 'var(--bg-surf)',
                    border: '1px dashed var(--brd)',
                    color: 'var(--txt-3)',
                  }}
                >
                  Aperçu : le <strong style={{ color: 'var(--txt-2)' }}>PDF global</strong>.
                  Le ZIP contiendra en plus{' '}
                  <strong style={{ color: 'var(--txt-2)' }}>
                    {currentPdf.loueurPdfs?.length || 0} PDF{(currentPdf.loueurPdfs?.length || 0) > 1 ? 's' : ''} loueur
                  </strong>
                  .
                </div>
              )}

              {/* Erreur build */}
              {buildError && (
                <div
                  className="flex items-start gap-2 text-[11px] p-2.5 rounded-md"
                  style={{
                    background: 'var(--red-bg, rgba(200,50,50,0.08))',
                    border: '1px solid var(--red, #c33)',
                    color: 'var(--red, #e55)',
                  }}
                >
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-[1px]" />
                  <span>Erreur : {buildError}</span>
                </div>
              )}
            </div>
          </aside>

          {/* Right preview */}
          <div
            className="flex-1 min-w-0 relative"
            style={{ background: 'var(--bg-surf)' }}
          >
            {!snapshot ? (
              <CenterError error={new Error('Session manquante ou invalide')} />
            ) : building && !previewUrl ? (
              <CenterSpinner label="Génération du PDF…" />
            ) : previewUrl ? (
              <>
                <iframe
                  src={previewUrl}
                  title="Aperçu du bon de retour"
                  style={{
                    width: '100%',
                    height: '100%',
                    border: 0,
                    display: 'block',
                  }}
                />
                {/* Overlay pendant un rebuild (switch de mode) */}
                {building && (
                  <div
                    className="absolute top-3 right-3 flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md"
                    style={{
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-2)',
                      border: '1px solid var(--brd)',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                    }}
                  >
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Génération…
                  </div>
                )}
              </>
            ) : (
              <CenterSpinner label="Préparation…" />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Helpers visuels ───────────────────────────────────────────────────────

function ModeRadio({ active, onClick, icon: Icon, label, description }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-md transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
        color: active ? 'var(--txt)' : 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        if (active) return
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        if (active) return
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5"
        style={{
          background: active ? 'var(--blue)' : 'var(--bg-surf)',
          color: active ? '#fff' : 'var(--txt-3)',
        }}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="flex flex-col min-w-0 flex-1">
        <span
          className="text-xs font-semibold"
          style={{ color: active ? 'var(--blue)' : 'var(--txt)' }}
        >
          {label}
        </span>
        <span className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {description}
        </span>
      </span>
    </button>
  )
}

/**
 * Variante compacte horizontale de `ModeRadio`, utilisée sur mobile. Miroir
 * strict du composant éponyme dans `BilanExportModal`. Trois onglets équi-
 * répartis via `flex-1`, icône + label court sans description.
 */
function ModeTab({ active, onClick, icon: Icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 flex flex-col items-center gap-1 px-2 py-2 rounded-md transition-all min-w-0"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-surf)',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
        color: active ? 'var(--blue)' : 'var(--txt-2)',
      }}
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span
        className="text-[10px] font-semibold leading-tight text-center truncate w-full"
        style={{ color: active ? 'var(--blue)' : 'var(--txt)' }}
      >
        {label}
      </span>
    </button>
  )
}

function LoueurRadio({ active, onClick, label, nItems, couleur }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-md transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'transparent',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
        color: active ? 'var(--txt)' : 'var(--txt-2)',
      }}
      onMouseEnter={(e) => {
        if (active) return
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        if (active) return
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: couleur || 'var(--txt-3)' }}
      />
      <span
        className="text-xs font-medium truncate flex-1"
        style={{ color: active ? 'var(--blue)' : 'var(--txt-2)' }}
      >
        {label}
      </span>
      <span
        className="text-[10px] shrink-0 px-1.5 py-0.5 rounded"
        style={{
          background: 'var(--bg-surf)',
          color: 'var(--txt-3)',
        }}
      >
        {nItems}
      </span>
    </button>
  )
}

function CenterSpinner({ label }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3"
      style={{ color: 'var(--txt-3)' }}
    >
      <div
        className="w-6 h-6 border-2 rounded-full animate-spin"
        style={{
          borderColor: 'var(--blue)',
          borderTopColor: 'transparent',
        }}
      />
      <p className="text-xs">{label}</p>
    </div>
  )
}

function CenterError({ error }) {
  const msg = error?.message || String(error || 'Erreur inconnue')
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{
          background: 'var(--red-bg, rgba(200,50,50,0.1))',
          color: 'var(--red, #e55)',
        }}
      >
        <AlertCircle className="w-5 h-5" />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
        Impossible de charger le bon de retour
      </p>
      <p className="text-xs text-center max-w-md" style={{ color: 'var(--txt-3)' }}>
        {msg}
      </p>
    </div>
  )
}

// ─── Helpers internes ──────────────────────────────────────────────────────

/**
 * Retrouve la section loueur du snapshot à partir d'une clé (id loueur ou
 * la sentinelle NO_LOUEUR_BUCKET_ID pour le bucket "Sans loueur").
 */
function findLoueurSection(snapshot, key) {
  if (!snapshot?.byLoueur) return null
  if (key === NO_LOUEUR_BUCKET_ID) {
    return snapshot.byLoueur.find((s) => !s.loueur) || null
  }
  return snapshot.byLoueur.find((s) => s.loueur?.id === key) || null
}

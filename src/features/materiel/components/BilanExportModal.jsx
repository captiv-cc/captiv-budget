// ════════════════════════════════════════════════════════════════════════════
// BilanExportModal — export bilan avec choix de format + preview inline (MAT-22)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale plein écran offrant 3 modes d'export du bilan d'essais :
//
//   1. "Global"      → un seul PDF combiné (tous les loueurs)
//   2. "ZIP complet" → un PDF global + un PDF par loueur, empaquetés en ZIP
//   3. "Par loueur"  → un seul PDF filtré sur un loueur (sélecteur)
//
// Le rendu suit le pattern de `PdfPreviewModal` (iframe plein écran) avec un
// panneau latéral à gauche pour le choix de format. Le PDF est régénéré à la
// volée à chaque changement de mode (lazy builder, pas d'état pré-calculé).
//
// Flow :
//
//   1. À l'ouverture, la modale récupère la session :
//        • si `session` est fourni en prop → on l'utilise directement (flow
//          checklist : la session est déjà chargée par le hook token/authed)
//        • sinon → fetch UNE FOIS via `fetchCheckSessionAuthed(versionId)`
//          (flow admin MaterielTab) ; gated par `can_read_outil('materiel')`.
//      Puis on l'agrège via `aggregateBilanData` ; les mêmes données
//      alimentent ensuite les 3 modes.
//   2. À chaque changement de mode OU de loueur sélectionné, on relance le
//      builder correspondant (async) et on met à jour l'iframe.
//   3. Le bouton "Télécharger" dans le header déclenche `currentPdf.download()`.
//   4. En mode ZIP : l'iframe affiche le PDF global (contenu du ZIP) + une
//      note précise les autres PDFs empaquetés.
//
// Nettoyage :
//   - Les URLs Blob sont révoquées à chaque remplacement (évite la fuite).
//   - Au unmount, on révoque le courant + fait un cleanup global.
//
// Props :
//   - open           : boolean
//   - onClose        : () => void
//   - versionId      : string (UUID) — requis si `session` n'est pas fourni
//   - session        : objet session déjà chargé (optionnel). Permet de
//                      réutiliser la modale dans CheckSession (token ou authed)
//                      sans refaire un fetch admin.
//   - org            : object (organisation — passée au PDF builder pour le footer)
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
import { fetchCheckSessionAuthed } from '../../../lib/matosCheckAuthed'
import { aggregateBilanData, NO_LOUEUR_BUCKET_ID } from '../../../lib/matosBilanData'
import {
  buildBilanGlobalPDF,
  buildBilanLoueurPDF,
  buildBilanZip,
} from '../matosBilanPdf'

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

export default function BilanExportModal({
  open,
  onClose,
  versionId,
  session: sessionProp = null,
  org = null,
}) {
  const [snapshot, setSnapshot] = useState(null)
  const [snapshotError, setSnapshotError] = useState(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)

  const [mode, setMode] = useState('global')
  const [selectedLoueurKey, setSelectedLoueurKey] = useState(null) // id loueur ou NO_LOUEUR_BUCKET_ID

  const [currentPdf, setCurrentPdf] = useState(null) // { blob, url, filename, isZip, download, revoke, globalPdf? }
  const [building, setBuilding] = useState(false)
  const [buildError, setBuildError] = useState(null)

  // Identifiant de build pour ignorer les résolutions out-of-order (race lors
  // d'un switch rapide de mode avant que le précédent build n'ait résolu).
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
      // cleanup global à la fermeture
      setSnapshot(null)
      setSnapshotError(null)
      setMode('global')
      setSelectedLoueurKey(null)
      setBuildError(null)
      setCurrentPdf((prev) => {
        try { prev?.revoke?.() } catch { /* noop */ }
        return null
      })
      return
    }
  }, [open])

  // ─── Fetch snapshot une seule fois à l'ouverture ─────────────────────────
  //
  // Deux sources possibles pour la session :
  //   • `sessionProp` (optionnel) → flow checklist, la session est déjà
  //     chargée par `useCheckTokenSession` / `useCheckAuthedSession`. On
  //     l'agrège directement, sans double-fetch réseau.
  //   • sinon → flow admin MaterielTab : fetch authed via `versionId`.
  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    async function load() {
      setLoadingSnapshot(true)
      setSnapshotError(null)
      try {
        let session = sessionProp
        if (!session) {
          if (!versionId) throw new Error('Version manquante')
          session = await fetchCheckSessionAuthed(versionId)
        }
        const snap = aggregateBilanData(session)
        if (cancelled || !aliveRef.current) return
        if (!snap?.version?.id) throw new Error('Version introuvable')
        setSnapshot(snap)
        // Pré-sélection du premier loueur disponible (utile si l'utilisateur
        // bascule en mode "loueur" sans rien choisir d'abord).
        const firstLoueur = snap.byLoueur?.[0]
        if (firstLoueur) {
          setSelectedLoueurKey(firstLoueur.loueur?.id || NO_LOUEUR_BUCKET_ID)
        }
      } catch (err) {
        if (cancelled || !aliveRef.current) return
        console.error('[BilanExportModal] fetch snapshot :', err)
        setSnapshotError(err)
      } finally {
        if (!cancelled && aliveRef.current) setLoadingSnapshot(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, versionId, sessionProp])

  // ─── Builder : régénère le PDF/ZIP au changement de mode/loueur ──────────
  //
  // On utilise un compteur d'ID pour n'appliquer que le résultat le plus
  // récent : si l'utilisateur switche global → zip → global en rafale, seul
  // le dernier build persiste, les résultats intermédiaires sont simplement
  // révoqués.
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
          result = await buildBilanGlobalPDF(snapshot, { org })
          result.isZip = false
        } else if (mode === 'zip') {
          result = await buildBilanZip(snapshot, { org })
        } else if (mode === 'loueur') {
          if (!selectedLoueurKey) {
            // rien à générer tant qu'aucun loueur n'est sélectionné
            setBuilding(false)
            return
          }
          const section = findLoueurSection(snapshot, selectedLoueurKey)
          if (!section) {
            throw new Error('Loueur introuvable dans le snapshot')
          }
          result = await buildBilanLoueurPDF(snapshot, {
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
          // Un build plus récent a déjà démarré — on révoque celui-ci.
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
        console.error('[BilanExportModal] build :', err)
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
  // Liste des loueurs disponibles : on exploite snapshot.byLoueur qui peut
  // contenir une entrée `loueur: null` pour "Sans loueur".
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
      console.error('[BilanExportModal] download :', err)
    }
  }, [currentPdf])

  if (!open) return null

  // Le PDF à afficher dans l'iframe :
  //   - mode global/loueur : le blob URL direct du PDF
  //   - mode zip : l'URL du globalPdf interne (le ZIP lui-même n'est pas visible)
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
        className="fixed z-50 flex flex-col overflow-hidden rounded-xl"
        style={{
          top: '4vh',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 'min(1200px, 96vw)',
          height: '92vh',
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
        role="dialog"
        aria-label="Exporter le bilan"
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
              title="Exporter le bilan d'essais"
            >
              Exporter le bilan d&apos;essais
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

        {/* Body : [Left panel] [Right preview] */}
        <div className="flex-1 min-h-0 flex">
          {/* Left panel */}
          <aside
            className="shrink-0 overflow-y-auto"
            style={{
              width: '320px',
              borderRight: '1px solid var(--brd-sub)',
              background: 'var(--bg-elev)',
            }}
          >
            <div className="p-4 space-y-4">
              <div>
                <h3
                  className="text-[11px] font-semibold uppercase tracking-wide mb-2"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Format d&apos;export
                </h3>
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
            {loadingSnapshot ? (
              <CenterSpinner label="Chargement des données…" />
            ) : snapshotError ? (
              <CenterError error={snapshotError} />
            ) : building && !previewUrl ? (
              <CenterSpinner label="Génération du PDF…" />
            ) : previewUrl ? (
              <>
                <iframe
                  src={previewUrl}
                  title="Aperçu du bilan"
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
        Impossible de charger le bilan
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

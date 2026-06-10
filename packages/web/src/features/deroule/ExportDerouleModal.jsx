// ════════════════════════════════════════════════════════════════════════════
// ExportDerouleModal (FEST-6.D + FEST-6.E preview) — Modal d'export PNG/PDF
// ════════════════════════════════════════════════════════════════════════════
//
// Flow en 2 phases :
//   1. CONFIG    : type d'export + cadreur + jours + bouton "Générer aperçu"
//   2. PREVIEW   : visualisation (iframe PDF / img PNG) + bouton "Télécharger"
//                  + bouton "Modifier" pour revenir au step config
//
// Suit les règles CHANTIER_UI_KIT.md : modal centré z=60, backdrop noir,
// click out / Esc ferment.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Download,
  Image as ImageIcon,
  FileText,
  Camera,
  Calendar,
  Loader2,
  Eye,
  ArrowLeft,
} from 'lucide-react'
import { notify } from '../../lib/notify'
import * as DerouleLib from '../../lib/deroule'
import { buildDerouleCadreurPng } from './export/exportPNG'
import { buildDerouleMultiJourPdf } from './export/exportPDF'

export default function ExportDerouleModal({
  open,
  onClose,
  project,
  deroules = [],
  currentDerouleId = null,
  membres = [],
}) {
  const [exportType, setExportType] = useState('pdf') // 'pdf' | 'png'
  const [selectedMembreId, setSelectedMembreId] = useState(null)
  const [selectedDateJours, setSelectedDateJours] = useState(() => {
    const currentDeroule = deroules.find((d) => d.id === currentDerouleId)
    return currentDeroule ? [currentDeroule.date_jour] : []
  })
  const [generating, setGenerating] = useState(false)
  // FEST-6.E : preview du fichier généré avant DL
  // { type: 'pdf'|'png', url: blobURL, filename, revoke: fn }
  const [previewResult, setPreviewResult] = useState(null)

  // ─── Cadreurs disponibles ─────────────────────────────────────────────
  const cadreurOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const m of membres || []) {
      if (!m?.id || seen.has(m.id)) continue
      seen.add(m.id)
      const prenom = m.contact?.prenom || m.prenom || ''
      const nom = m.contact?.nom || m.nom || ''
      const fullName = `${prenom} ${nom}`.trim() || 'Membre sans nom'
      out.push({ id: m.id, label: fullName })
    }
    out.sort((a, b) => a.label.localeCompare(b.label))
    return out
  }, [membres])

  // Sélectionne le 1er cadreur par défaut quand on passe en mode PNG
  useEffect(() => {
    if (exportType === 'png' && !selectedMembreId && cadreurOptions.length > 0) {
      setSelectedMembreId(cadreurOptions[0].id)
    }
  }, [exportType, selectedMembreId, cadreurOptions])

  // ─── Esc ferme ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !generating) {
        e.stopPropagation()
        // Si on est en preview, Esc revient à la config (pas ferme la modal)
        if (previewResult) {
          handleBackToConfig()
          return
        }
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, generating, onClose, previewResult])

  // Reset à chaque ouverture
  useEffect(() => {
    if (!open) return
    const currentDeroule = deroules.find((d) => d.id === currentDerouleId)
    setSelectedDateJours(currentDeroule ? [currentDeroule.date_jour] : [])
    if (cadreurOptions.length > 0 && !selectedMembreId) {
      setSelectedMembreId(cadreurOptions[0].id)
    }
    // Nettoie un éventuel preview résiduel
    if (previewResult) {
      try {
        previewResult.revoke?.()
      } catch {
        /* ignore */
      }
      setPreviewResult(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentDerouleId])

  // Cleanup blob URL au unmount / ferme
  useEffect(() => {
    return () => {
      if (previewResult) {
        try {
          previewResult.revoke?.()
        } catch {
          /* ignore */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!open) return null

  const sortedDeroules = [...(deroules || [])].sort((a, b) =>
    a.date_jour < b.date_jour ? -1 : 1,
  )

  function toggleDayJour(dateJour) {
    setSelectedDateJours((prev) =>
      prev.includes(dateJour)
        ? prev.filter((d) => d !== dateJour)
        : [...prev, dateJour],
    )
  }

  function selectAllDays() {
    setSelectedDateJours(sortedDeroules.map((d) => d.date_jour))
  }
  function selectNoneDays() {
    setSelectedDateJours([])
  }

  function handleBackToConfig() {
    if (previewResult) {
      try {
        previewResult.revoke?.()
      } catch {
        /* ignore */
      }
      setPreviewResult(null)
    }
  }

  function handleDownloadNow() {
    if (!previewResult) return
    const a = document.createElement('a')
    a.href = previewResult.url
    a.download = previewResult.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    notify.success('Téléchargement lancé')
    // On garde le preview visible (l'utilisateur peut re-download si besoin)
  }

  async function handleGeneratePreview() {
    if (selectedDateJours.length === 0) {
      notify.error('Sélectionne au moins un jour')
      return
    }
    if (exportType === 'png' && !selectedMembreId) {
      notify.error('Choisis un cadreur')
      return
    }

    setGenerating(true)
    try {
      const targetsDeroules = sortedDeroules.filter((d) =>
        selectedDateJours.includes(d.date_jour),
      )
      const deroulesData = []
      for (const d of targetsDeroules) {
        try {
          const detail = await DerouleLib.fetchDerouleComplet(d.id)
          deroulesData.push({
            deroule: detail.deroule,
            lanes: detail.lanes || [],
            creneaux: detail.creneaux || [],
            membres,
          })
        } catch (e) {
          console.warn('[ExportDerouleModal] fetch deroule failed', d.id, e)
        }
      }

      if (deroulesData.length === 0) {
        notify.error('Aucun déroulé valide à exporter')
        return
      }

      let result
      if (exportType === 'pdf') {
        result = await buildDerouleMultiJourPdf({
          project,
          deroulesData,
          generatedAt: new Date(),
        })
      } else {
        if (deroulesData.length > 1) {
          notify.info(
            `PNG V1 : aperçu du 1er jour uniquement (${deroulesData[0].deroule.date_jour})`,
          )
        }
        result = await buildDerouleCadreurPng({
          project,
          deroulesData,
          membreId: selectedMembreId,
          generatedAt: new Date(),
        })
      }
      setPreviewResult({
        type: exportType,
        url: result.url,
        filename: result.filename,
        revoke: result.revoke,
      })
    } catch (e) {
      console.error('[ExportDerouleModal] generation failed', e)
      notify.error('Erreur : ' + (e?.message || e))
    } finally {
      setGenerating(false)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────
  const isPreview = Boolean(previewResult)

  // Width + height adaptée selon le format du preview.
  // - PDF (A4 paysage 297×210) : modal LARGE et HAUTE pour bien voir le rendu
  // - PNG (portrait 9:19.5)     : modal moins large, hauteur quasi-pleine
  // - Config                    : compact 560px
  const isPdfPreview = isPreview && previewResult?.type === 'pdf'
  const isPngPreview = isPreview && previewResult?.type === 'png'
  let modalWidth = 'min(560px, 100%)'
  let modalHeight = 'auto'
  let modalMaxHeight = 'calc(100vh - 32px)'
  if (isPdfPreview) {
    modalWidth = 'min(1300px, 96vw)'
    modalHeight = '92vh'
    modalMaxHeight = '92vh'
  } else if (isPngPreview) {
    modalWidth = 'min(700px, 90vw)'
    modalHeight = '92vh'
    modalMaxHeight = '92vh'
  }

  return (
    <div
      onClick={() => !generating && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'export-fade-in 120ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: modalWidth,
          // height fixe en mode preview pour que l'iframe/img ait toute
          // la place (flex:1 sur le child a besoin d'une hauteur de parent
          // résolue, pas juste maxHeight)
          ...(modalHeight !== 'auto' ? { height: modalHeight } : {}),
          maxHeight: modalMaxHeight,
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isPreview ? (
              <Eye size={16} style={{ color: 'var(--blue, #3B82F6)' }} />
            ) : (
              <Download size={16} style={{ color: 'var(--blue, #3B82F6)' }} />
            )}
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
              }}
            >
              {isPreview ? 'Aperçu avant téléchargement' : 'Exporter le déroulé'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => !generating && onClose?.()}
            disabled={generating}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: generating ? 'not-allowed' : 'pointer',
              borderRadius: 4,
            }}
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — config OR preview */}
        {isPreview ? (
          <PreviewView previewResult={previewResult} />
        ) : (
          <ConfigView
            exportType={exportType}
            setExportType={setExportType}
            selectedMembreId={selectedMembreId}
            setSelectedMembreId={setSelectedMembreId}
            cadreurOptions={cadreurOptions}
            sortedDeroules={sortedDeroules}
            selectedDateJours={selectedDateJours}
            toggleDayJour={toggleDayJour}
            selectAllDays={selectAllDays}
            selectNoneDays={selectNoneDays}
            currentDerouleId={currentDerouleId}
            generating={generating}
          />
        )}

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 16px',
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
            flexShrink: 0,
          }}
        >
          {isPreview ? (
            <>
              <button
                type="button"
                onClick={handleBackToConfig}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 5,
                  color: 'var(--txt-2)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                title="Revenir aux options pour modifier l'export"
              >
                <ArrowLeft size={12} />
                Modifier
              </button>
              <button
                type="button"
                onClick={handleDownloadNow}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  background: 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Download size={12} />
                Télécharger
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => !generating && onClose?.()}
                disabled={generating}
                style={{
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 5,
                  color: 'var(--txt-2)',
                  fontSize: 12,
                  cursor: generating ? 'not-allowed' : 'pointer',
                }}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleGeneratePreview}
                disabled={
                  generating ||
                  selectedDateJours.length === 0 ||
                  (exportType === 'png' && !selectedMembreId)
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  background:
                    generating ||
                    selectedDateJours.length === 0 ||
                    (exportType === 'png' && !selectedMembreId)
                      ? 'var(--brd)'
                      : 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor:
                    generating ||
                    selectedDateJours.length === 0 ||
                    (exportType === 'png' && !selectedMembreId)
                      ? 'not-allowed'
                      : 'pointer',
                }}
              >
                {generating ? (
                  <>
                    <Loader2
                      size={12}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                    Génération…
                  </>
                ) : (
                  <>
                    <Eye size={12} />
                    Générer l&apos;aperçu
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes export-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ─── Sous-composant : vue configuration ────────────────────────────────
function ConfigView({
  exportType,
  setExportType,
  selectedMembreId,
  setSelectedMembreId,
  cadreurOptions,
  sortedDeroules,
  selectedDateJours,
  toggleDayJour,
  selectAllDays,
  selectNoneDays,
  currentDerouleId,
  generating,
}) {
  return (
    <div
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        overflow: 'auto',
      }}
    >
      {/* Type d'export */}
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--txt-3)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 6,
          }}
        >
          Format
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <TypeCard
            active={exportType === 'pdf'}
            onClick={() => setExportType('pdf')}
            icon={<FileText size={20} />}
            label="PDF complet"
            description="Une page par jour, toutes les lanes"
          />
          <TypeCard
            active={exportType === 'png'}
            onClick={() => setExportType('png')}
            icon={<ImageIcon size={20} />}
            label="PNG cadreur"
            description="Fond d'écran vertical 9:19.5 (iPhone)"
          />
        </div>
      </div>

      {/* Sélection cadreur (PNG uniquement) */}
      {exportType === 'png' && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--txt-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Camera size={12} />
            Cadreur destinataire
          </div>
          {cadreurOptions.length === 0 ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--txt-3)',
                padding: '8px 10px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 6,
              }}
            >
              Aucun cadreur dans la techlist du projet.
            </div>
          ) : (
            <select
              value={selectedMembreId || ''}
              onChange={(e) => setSelectedMembreId(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 10px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 6,
                color: 'var(--txt)',
                fontSize: 13,
              }}
            >
              {cadreurOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Sélection des jours */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 6,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: 'var(--txt-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Calendar size={12} />
            Jours à inclure ({selectedDateJours.length} / {sortedDeroules.length})
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={selectAllDays}
              disabled={generating}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                color: 'var(--txt-2)',
                cursor: generating ? 'not-allowed' : 'pointer',
              }}
            >
              Tous
            </button>
            <button
              type="button"
              onClick={selectNoneDays}
              disabled={generating}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                color: 'var(--txt-2)',
                cursor: generating ? 'not-allowed' : 'pointer',
              }}
            >
              Aucun
            </button>
          </div>
        </div>
        {sortedDeroules.length === 0 ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--txt-3)',
              padding: '8px 10px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 6,
            }}
          >
            Aucun déroulé créé pour ce projet.
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 200,
              overflow: 'auto',
              background: 'var(--bg)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 6,
              padding: 6,
            }}
          >
            {sortedDeroules.map((d) => {
              const checked = selectedDateJours.includes(d.date_jour)
              return (
                <label
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    background: checked ? 'var(--bg-elev)' : 'transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--txt)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleDayJour(d.date_jour)}
                    disabled={generating}
                  />
                  <span style={{ flex: 1 }}>
                    {formatDayLabel(d.date_jour)}
                  </span>
                  {d.id === currentDerouleId && (
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 5px',
                        background: 'var(--blue, #3B82F6)',
                        color: 'white',
                        borderRadius: 3,
                      }}
                    >
                      Courant
                    </span>
                  )}
                </label>
              )
            })}
          </div>
        )}
        {exportType === 'png' && selectedDateJours.length > 1 && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt-3)',
              marginTop: 4,
              fontStyle: 'italic',
            }}
          >
            ℹ V1 : pour le PNG, seul le 1er jour sera exporté.
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sous-composant : preview du fichier généré ────────────────────────
function PreviewView({ previewResult }) {
  if (!previewResult) return null
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: previewResult.type === 'pdf' ? '#525659' : '#0E1014',
        overflow: 'hidden',
      }}
    >
      {/* Info bar : nom du fichier */}
      <div
        style={{
          padding: '6px 12px',
          fontSize: 11,
          color: 'var(--txt-3)',
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--brd-sub)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {previewResult.type === 'pdf' ? (
          <FileText size={12} />
        ) : (
          <ImageIcon size={12} />
        )}
        <span style={{ fontFamily: 'monospace' }}>{previewResult.filename}</span>
      </div>
      {/* Vue spécifique au type */}
      {previewResult.type === 'pdf' ? (
        <iframe
          src={previewResult.url}
          title="Aperçu PDF"
          style={{
            flex: 1,
            border: 'none',
            width: '100%',
            background: '#525659',
          }}
        />
      ) : (
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <img
            src={previewResult.url}
            alt="Aperçu PNG"
            style={{
              maxHeight: 'calc(95vh - 200px)',
              objectFit: 'contain',
              borderRadius: 8,
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}
    </div>
  )
}

function TypeCard({ active, onClick, icon, label, description }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 4,
        padding: '10px 12px',
        background: active ? 'rgba(59,130,246,0.10)' : 'var(--bg-elev)',
        border: `1px solid ${active ? 'var(--blue, #3B82F6)' : 'var(--brd-sub)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 100ms ease',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color: active ? 'var(--blue, #3B82F6)' : 'var(--txt)',
        }}
      >
        {icon}
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      </div>
      <span
        style={{
          fontSize: 11,
          color: 'var(--txt-3)',
        }}
      >
        {description}
      </span>
    </button>
  )
}

function formatDayLabel(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(`${iso}T12:00:00`)
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

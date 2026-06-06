// ════════════════════════════════════════════════════════════════════════════
// ExportDerouleModal (FEST-6.D) — Modal de pré-export PNG/PDF
// ════════════════════════════════════════════════════════════════════════════
//
// Permet de configurer l'export avant génération :
//   - Type : PNG cadreur ou PDF complet
//   - Cadreur (si PNG) : dropdown des cadreurs du projet
//   - Jours à inclure : checkboxes des déroulés existants
//   - Bouton "Télécharger"
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
    // Par défaut, le déroulé courant uniquement
    const currentDeroule = deroules.find((d) => d.id === currentDerouleId)
    return currentDeroule ? [currentDeroule.date_jour] : []
  })
  const [exporting, setExporting] = useState(false)

  // ─── Cadreurs disponibles ─────────────────────────────────────────────
  // On considère "cadreur" tout membre du projet qui apparaît dans au moins
  // une lane type='personne' d'un des déroulés du projet. V1 : on liste
  // tous les membres et l'utilisateur choisit. (Filtrage plus fin en V2.)
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
      if (e.key === 'Escape' && !exporting) {
        e.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, exporting, onClose])

  // Reset à chaque ouverture
  useEffect(() => {
    if (!open) return
    const currentDeroule = deroules.find((d) => d.id === currentDerouleId)
    setSelectedDateJours(currentDeroule ? [currentDeroule.date_jour] : [])
    if (cadreurOptions.length > 0 && !selectedMembreId) {
      setSelectedMembreId(cadreurOptions[0].id)
    }
  }, [open, currentDerouleId, deroules, cadreurOptions, selectedMembreId])

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

  async function handleExport() {
    if (selectedDateJours.length === 0) {
      notify.error('Sélectionne au moins un jour')
      return
    }
    if (exportType === 'png' && !selectedMembreId) {
      notify.error('Choisis un cadreur')
      return
    }

    setExporting(true)
    try {
      // Charge le détail (lanes + créneaux) des déroulés sélectionnés
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

      if (exportType === 'pdf') {
        const result = buildDerouleMultiJourPdf({
          project,
          deroulesData,
          generatedAt: new Date(),
        })
        result.download()
        notify.success(
          `PDF généré (${deroulesData.length} jour${deroulesData.length > 1 ? 's' : ''})`,
        )
        setTimeout(() => result.revoke(), 10000)
      } else {
        // PNG : si plusieurs jours, on prend juste le premier (V1)
        if (deroulesData.length > 1) {
          notify.info(
            `PNG V1 : export du 1er jour uniquement (${deroulesData[0].deroule.date_jour})`,
          )
        }
        const result = await buildDerouleCadreurPng({
          project,
          deroulesData,
          membreId: selectedMembreId,
          generatedAt: new Date(),
        })
        result.download()
        notify.success('PNG cadreur généré')
        setTimeout(() => result.revoke(), 10000)
      }
      onClose?.()
    } catch (e) {
      console.error('[ExportDerouleModal] export failed', e)
      notify.error("Erreur d'export : " + (e?.message || e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div
      onClick={() => !exporting && onClose?.()}
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
          width: 'min(560px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
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
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Download size={16} style={{ color: 'var(--blue, #3B82F6)' }} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
              }}
            >
              Exporter le déroulé
            </span>
          </div>
          <button
            type="button"
            onClick={() => !exporting && onClose?.()}
            disabled={exporting}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: exporting ? 'not-allowed' : 'pointer',
              borderRadius: 4,
            }}
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
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
                  disabled={exporting}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--brd-sub)',
                    borderRadius: 4,
                    color: 'var(--txt-2)',
                    cursor: exporting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Tous
                </button>
                <button
                  type="button"
                  onClick={selectNoneDays}
                  disabled={exporting}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    background: 'var(--bg-elev)',
                    border: '1px solid var(--brd-sub)',
                    borderRadius: 4,
                    color: 'var(--txt-2)',
                    cursor: exporting ? 'not-allowed' : 'pointer',
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
                        disabled={exporting}
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
          }}
        >
          <button
            type="button"
            onClick={() => !exporting && onClose?.()}
            disabled={exporting}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--brd-sub)',
              borderRadius: 5,
              color: 'var(--txt-2)',
              fontSize: 12,
              cursor: exporting ? 'not-allowed' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={
              exporting ||
              selectedDateJours.length === 0 ||
              (exportType === 'png' && !selectedMembreId)
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background:
                exporting ||
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
                exporting ||
                selectedDateJours.length === 0 ||
                (exportType === 'png' && !selectedMembreId)
                  ? 'not-allowed'
                  : 'pointer',
            }}
          >
            {exporting ? (
              <>
                <Loader2
                  size={12}
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                Génération…
              </>
            ) : (
              <>
                <Download size={12} />
                Télécharger
              </>
            )}
          </button>
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

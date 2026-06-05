// ════════════════════════════════════════════════════════════════════════════
// ImportPreviewModal (FEST-4.3) — Preview + sélection des shows à importer
// ════════════════════════════════════════════════════════════════════════════
//
// Reçoit le résultat d'extraction Claude ({ date, shows[] }) et permet à
// l'utilisateur de :
//   - Vérifier la date détectée, la modifier via DayPicker
//   - Voir la liste des shows extraits avec checkboxes (cochés par défaut)
//   - Voir quelles scènes nouvelles seront créées comme lanes
//   - Voir les conflits éventuels avec des créneaux existants
//   - Lancer l'import (auto-création déroulé + lanes scène + créneaux)
//
// Règles CHANTIER_UI_KIT.md respectées (modal centré z=60, backdrop noir,
// click out / Esc ferment).
//
// Props :
//   - open: bool
//   - extracted: { date, shows, meta }
//   - selectedDate: ISO YYYY-MM-DD (jour courant)
//   - existingLanes: lanes du déroulé courant (si exists)
//   - existingCreneaux: créneaux du déroulé courant (si exists)
//   - importing: bool (parent locked l'UI pendant l'insert BDD)
//   - onClose
//   - onConfirm({ targetDate, scenesToCreate, shows }) → Promise
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  X,
  Calendar,
  MapPin,
  Clock,
  AlertTriangle,
  Plus,
  Loader2,
  Check,
} from 'lucide-react'
import DayPicker from '../../components/DayPicker'
import { timeToMinutes, formatMinHHMM } from '../../lib/deroule'

export default function ImportPreviewModal({
  open,
  extracted,
  selectedDate,
  existingLanes = [],
  existingCreneaux = [],
  existingDeroule = null,
  importing = false,
  onClose,
  onConfirm,
}) {
  const initialDate = extracted?.date || selectedDate
  const [targetDate, setTargetDate] = useState(initialDate)
  const [checked, setChecked] = useState(() =>
    (extracted?.shows || []).map(() => true),
  )

  // Reset à chaque ouverture / nouveau résultat
  useEffect(() => {
    if (!open) return
    setTargetDate(extracted?.date || selectedDate)
    setChecked((extracted?.shows || []).map(() => true))
  }, [open, extracted, selectedDate])

  // Esc ferme
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !importing) {
        e.stopPropagation()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKey, { capture: true })
  }, [open, importing, onClose])

  // ─── Normalisation horaires en minutes ──────────────────────────────────
  // Les shows[].heure_debut/heure_fin sont des "HH:MM" depuis Claude.
  // Si heure_fin <= heure_debut, on suppose passage de minuit → +1j (+1440).
  const showsWithMin = useMemo(() => {
    if (!extracted?.shows) return []
    return extracted.shows.map((s) => {
      const debut = timeToMinutes(s.heure_debut)
      let fin = timeToMinutes(s.heure_fin)
      if (Number.isFinite(debut) && Number.isFinite(fin) && fin <= debut) {
        fin = fin + 1440 // passage minuit
      }
      return {
        ...s,
        debut_min: debut,
        fin_min: fin,
      }
    })
  }, [extracted])

  // ─── Détection des scènes à créer ───────────────────────────────────────
  // Pour chaque scène unique parmi les shows cochés, on regarde si une lane
  // type='lieu' avec un libellé équivalent existe déjà. Sinon → à créer.
  // Comparaison de libellés normalisée (lowercase trim) pour matcher
  // "Scène Médiator" et "scène médiator".
  const scenesAnalysis = useMemo(() => {
    const uniqueScenes = new Map() // scene → { existingLaneId | null, count }
    for (let i = 0; i < showsWithMin.length; i++) {
      if (!checked[i]) continue
      const scene = (showsWithMin[i].scene || '').trim()
      if (!scene) continue // skip shows without scene
      const key = scene.toLowerCase()
      if (uniqueScenes.has(key)) {
        uniqueScenes.get(key).count += 1
        continue
      }
      const existingLane = existingLanes.find(
        (l) =>
          (l.libelle || '').trim().toLowerCase() === key &&
          l.type === 'lieu',
      )
      uniqueScenes.set(key, {
        scene,
        existingLaneId: existingLane?.id || null,
        count: 1,
      })
    }
    return Array.from(uniqueScenes.values())
  }, [showsWithMin, checked, existingLanes])

  const scenesToCreate = scenesAnalysis.filter((s) => !s.existingLaneId)
  const scenesExisting = scenesAnalysis.filter((s) => Boolean(s.existingLaneId))

  // ─── Détection des conflits avec les créneaux existants ─────────────────
  // Considère un conflit si un show coché overlap avec un créneau existant
  // sur la MÊME lane scène (ou multi_lane). On ne tient pas compte des
  // membres pour les conflits ici (V1).
  const conflictsByIndex = useMemo(() => {
    const map = {}
    if (!existingCreneaux || existingCreneaux.length === 0) return map
    for (let i = 0; i < showsWithMin.length; i++) {
      if (!checked[i]) continue
      const s = showsWithMin[i]
      const sceneKey = (s.scene || '').trim().toLowerCase()
      const sceneLane = existingLanes.find(
        (l) =>
          (l.libelle || '').trim().toLowerCase() === sceneKey &&
          l.type === 'lieu',
      )
      const conflict = existingCreneaux.find((c) => {
        if (c.lane_id !== sceneLane?.id && !c.multi_lane) return false
        const cDebut = c.heure_debut_min ?? 0
        const cFin = c.heure_fin_min ?? 0
        return s.debut_min < cFin && s.fin_min > cDebut
      })
      if (conflict) {
        map[i] = conflict
      }
    }
    return map
  }, [showsWithMin, checked, existingCreneaux, existingLanes])

  if (!open || !extracted) return null

  const validShows = showsWithMin.filter(
    (s) => Number.isFinite(s.debut_min) && Number.isFinite(s.fin_min),
  )
  const checkedCount = checked.filter(Boolean).length
  const dateMismatch = targetDate !== selectedDate
  const willCreateDeroule = !existingDeroule || dateMismatch

  function toggleAll(value) {
    setChecked(showsWithMin.map(() => value))
  }
  function toggleOne(i) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  async function handleConfirm() {
    if (importing) return
    const selectedShows = showsWithMin
      .map((s, i) => ({ ...s, idx: i }))
      .filter((s) => checked[s.idx])
      .filter(
        (s) => Number.isFinite(s.debut_min) && Number.isFinite(s.fin_min),
      )
    if (selectedShows.length === 0) return
    await onConfirm?.({
      targetDate,
      scenesToCreate: scenesToCreate.map((s) => s.scene),
      scenesMapping: scenesAnalysis, // { scene, existingLaneId }
      shows: selectedShows,
      willCreateDeroule,
    })
  }

  return (
    <div
      onClick={() => !importing && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'preview-fade-in 120ms ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
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
            <Check size={16} style={{ color: 'var(--blue, #3B82F6)' }} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
              }}
            >
              Prévisualisation de l&apos;import ({validShows.length} show
              {validShows.length > 1 ? 's' : ''} détecté
              {validShows.length > 1 ? 's' : ''})
            </span>
          </div>
          <button
            type="button"
            onClick={() => !importing && onClose?.()}
            disabled={importing}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: importing ? 'not-allowed' : 'pointer',
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
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflow: 'auto',
          }}
        >
          {/* Ligne : date d'import — DayPicker inline */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 12px',
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              borderRadius: 6,
            }}
          >
            <Calendar size={14} style={{ color: 'var(--txt-3)' }} />
            <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
              Importer dans le déroulé du
            </span>
            <div style={{ flex: 1 }}>
              <DayPicker value={targetDate} onChange={setTargetDate} />
            </div>
            {dateMismatch && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--blue, #3B82F6)',
                  whiteSpace: 'nowrap',
                }}
              >
                ≠ jour courant
              </span>
            )}
            {extracted.date && extracted.date !== targetDate && (
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--txt-3)',
                  whiteSpace: 'nowrap',
                }}
                title={`Claude a détecté ${formatHumanDate(extracted.date)}`}
              >
                IA: {extracted.date}
              </span>
            )}
          </div>

          {willCreateDeroule && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: 'var(--txt-3)',
                padding: '4px 8px',
              }}
            >
              <Plus size={12} />
              Le déroulé du {formatHumanDate(targetDate)} sera créé
              automatiquement.
            </div>
          )}

          {/* Section "Scènes nouvelles" */}
          {scenesToCreate.length > 0 && (
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(59,130,246,0.08)',
                border: '1px solid rgba(59,130,246,0.3)',
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--blue, #3B82F6)',
                  marginBottom: 4,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                <Plus
                  size={11}
                  style={{
                    display: 'inline',
                    marginRight: 4,
                    verticalAlign: 'middle',
                  }}
                />
                {scenesToCreate.length} lane scène à créer
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 4,
                  marginTop: 4,
                }}
              >
                {scenesToCreate.map((s) => (
                  <span
                    key={s.scene}
                    style={{
                      padding: '2px 6px',
                      background: 'var(--bg-surf)',
                      border: '1px solid var(--brd-sub)',
                      borderRadius: 4,
                      fontSize: 11,
                      color: 'var(--txt-2)',
                    }}
                  >
                    {s.scene}{' '}
                    <span style={{ color: 'var(--txt-3)' }}>· {s.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {scenesExisting.length > 0 && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--txt-3)',
                padding: '0 4px',
              }}
            >
              {scenesExisting.length} lane(s) scène existante(s) seront
              réutilisées :{' '}
              {scenesExisting.map((s) => s.scene).join(', ')}
            </div>
          )}

          {/* Toolbar shows : tous/aucun + compteur */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid var(--brd-sub)',
            }}
          >
            <button
              type="button"
              onClick={() => toggleAll(true)}
              disabled={importing || checkedCount === validShows.length}
              style={{
                padding: '3px 8px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                fontSize: 10,
                color: 'var(--txt-2)',
                cursor:
                  importing || checkedCount === validShows.length
                    ? 'not-allowed'
                    : 'pointer',
                opacity:
                  importing || checkedCount === validShows.length ? 0.5 : 1,
              }}
            >
              Tout cocher
            </button>
            <button
              type="button"
              onClick={() => toggleAll(false)}
              disabled={importing || checkedCount === 0}
              style={{
                padding: '3px 8px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 4,
                fontSize: 10,
                color: 'var(--txt-2)',
                cursor:
                  importing || checkedCount === 0 ? 'not-allowed' : 'pointer',
                opacity: importing || checkedCount === 0 ? 0.5 : 1,
              }}
            >
              Tout décocher
            </button>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 11,
                color: 'var(--txt-3)',
              }}
            >
              {checkedCount} / {validShows.length} cochés
            </span>
          </div>

          {/* Liste des shows */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 360,
              overflow: 'auto',
            }}
          >
            {showsWithMin.length === 0 && (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--txt-3)',
                }}
              >
                Aucun show extrait.
              </div>
            )}
            {showsWithMin.map((s, i) => {
              const invalid =
                !Number.isFinite(s.debut_min) || !Number.isFinite(s.fin_min)
              const conflict = conflictsByIndex[i]
              return (
                <label
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    background: checked[i] ? 'var(--bg-elev)' : 'transparent',
                    border: '1px solid',
                    borderColor: checked[i]
                      ? 'var(--brd-sub)'
                      : 'transparent',
                    borderRadius: 5,
                    cursor: invalid ? 'not-allowed' : 'pointer',
                    opacity: invalid ? 0.45 : 1,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(checked[i]) && !invalid}
                    disabled={invalid || importing}
                    onChange={() => toggleOne(i)}
                    style={{ flexShrink: 0 }}
                  />
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--txt)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {s.titre || '(sans titre)'}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 11,
                        color: 'var(--txt-3)',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Clock size={10} />
                        {invalid ? (
                          <span style={{ color: 'var(--red)' }}>
                            Horaire invalide
                          </span>
                        ) : (
                          `${formatMinHHMM(s.debut_min)} – ${formatMinHHMM(s.fin_min)}`
                        )}
                      </span>
                      {s.scene && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <MapPin size={10} />
                          {s.scene}
                        </span>
                      )}
                    </div>
                  </div>
                  {conflict && (
                    <span
                      title={`Conflit avec « ${conflict.titre || '(sans titre)'} » ${formatMinHHMM(conflict.heure_debut_min)}–${formatMinHHMM(conflict.heure_fin_min)}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 3,
                        padding: '2px 6px',
                        background: 'rgba(245,158,11,0.15)',
                        border: '1px solid rgba(245,158,11,0.4)',
                        borderRadius: 4,
                        fontSize: 10,
                        color: '#F59E0B',
                        flexShrink: 0,
                      }}
                    >
                      <AlertTriangle size={10} />
                      Conflit
                    </span>
                  )}
                </label>
              )
            })}
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
            onClick={() => !importing && onClose?.()}
            disabled={importing}
            style={{
              padding: '6px 12px',
              background: 'transparent',
              border: '1px solid var(--brd-sub)',
              borderRadius: 5,
              color: 'var(--txt-2)',
              fontSize: 12,
              cursor: importing ? 'not-allowed' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={importing || checkedCount === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background:
                importing || checkedCount === 0
                  ? 'var(--brd)'
                  : 'var(--blue, #3B82F6)',
              color: 'white',
              border: 'none',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 500,
              cursor:
                importing || checkedCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {importing ? (
              <>
                <Loader2
                  size={12}
                  style={{ animation: 'spin 1s linear infinite' }}
                />
                Import…
              </>
            ) : (
              <>
                <Check size={12} />
                Importer {checkedCount} créneau{checkedCount > 1 ? 'x' : ''}
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes preview-fade-in {
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

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatHumanDate(iso) {
  if (!iso) return '—'
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString('fr-FR', {
      weekday: 'short',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

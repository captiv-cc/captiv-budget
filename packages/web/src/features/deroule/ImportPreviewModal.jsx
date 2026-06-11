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
import { analyzeImportDiff, formatDelta } from '../../lib/derouleImportMatch'

export default function ImportPreviewModal({
  open,
  extracted,
  selectedDate,
  existingLanes = [],
  existingCreneaux = [],
  existingDeroule = null,
  // FEST-5.5.3 : liste de tous les déroulés du projet pour proposer de
  // copier la structure (cadreurs) du jour le plus récent.
  allProjectDeroules = [],
  importing = false,
  onClose,
  onConfirm,
}) {
  const initialDate = extracted?.date || selectedDate
  const [targetDate, setTargetDate] = useState(initialDate)
  const [checked, setChecked] = useState(() =>
    (extracted?.shows || []).map(() => true),
  )
  // FEST-5.5.3 : copier les lanes cadreur (type='personne') depuis un
  // déroulé existant si on crée un nouveau jour. Coché par défaut.
  const [copyCadreurs, setCopyCadreurs] = useState(true)
  // Mode UPDATE : checkboxes de suppression pour les créneaux existants
  // absents de la nouvelle prog. Décochés par défaut (safety). Map par id.
  const [deleteChecked, setDeleteChecked] = useState({})
  // Mode UPDATE : toggle global "Décaler aussi les créneaux cadreurs
  // liés". Default ON (use case courant : MAJ programme festival).
  const [propagateLinks, setPropagateLinks] = useState(true)
  // Corrections de noms d'artistes (fautes d'extraction IA) : idx → titre édité.
  const [titreOverrides, setTitreOverrides] = useState({})

  // Reset à chaque ouverture / nouveau résultat
  useEffect(() => {
    if (!open) return
    setTargetDate(extracted?.date || selectedDate)
    setChecked((extracted?.shows || []).map(() => true))
    setCopyCadreurs(true)
    setDeleteChecked({})
    setPropagateLinks(true)
    setTitreOverrides({})
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
    return extracted.shows.map((s, i) => {
      const debut = timeToMinutes(s.heure_debut)
      let fin = timeToMinutes(s.heure_fin)
      if (Number.isFinite(debut) && Number.isFinite(fin) && fin <= debut) {
        fin = fin + 1440 // passage minuit
      }
      const titre = titreOverrides[i] !== undefined ? titreOverrides[i] : s.titre
      return {
        ...s,
        titre,
        debut_min: debut,
        fin_min: fin,
      }
    })
  }, [extracted, titreOverrides])

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

  // Déclaré ICI (avant le diff) car utilisé en short-circuit dans le useMemo
  // ci-dessous. (Avant : déclaré plus bas → TDZ ReferenceError au mount.)
  const dateMismatch = targetDate !== selectedDate
  const willCreateDeroule = !existingDeroule || dateMismatch

  // ─── DIFF intelligent (FEST-import-update) ──────────────────────────────
  // Calcul du diff entre la prog extraite et les créneaux LIEU existants
  // du jour cible. Pour chaque show extracté, retourne s'il s'agit d'une
  // mise à jour, d'une création, ou inchangé. Et liste séparée des
  // existants non-matchés (candidats à la suppression).
  //
  // Le diff n'est calculé que si on importe sur un déroulé EXISTANT
  // (sinon : tout est création par définition).
  const diff = useMemo(() => {
    if (willCreateDeroule) {
      // Pas de matching : tout est création
      return { updates: [], creates: [], deletes: [], unchanged: [] }
    }
    return analyzeImportDiff({
      extracted: showsWithMin,
      existing: existingCreneaux,
      lanes: existingLanes,
    })
  }, [willCreateDeroule, showsWithMin, existingCreneaux, existingLanes])

  // Indexation : pour chaque idx du show, son état diff
  const showStateByIdx = useMemo(() => {
    const m = new Map()
    for (const u of diff.updates) {
      m.set(u.extractedIdx, { kind: 'update', match: u })
    }
    for (const c of diff.creates) {
      m.set(c.extractedIdx, { kind: 'create' })
    }
    for (const u of diff.unchanged) {
      m.set(u.extractedIdx, { kind: 'unchanged', match: u })
    }
    return m
  }, [diff])

  // En mode UPDATE, les "unchanged" sont décochés par défaut (rien à faire).
  // Effet : on s'aligne sur l'état du diff au moment du calcul, sans
  // écraser une éventuelle action user. Comme `checked` est aussi reset
  // au open, ce useEffect ne tourne que quand le diff change vraiment.
  useEffect(() => {
    if (willCreateDeroule || showsWithMin.length === 0) return
    setChecked((prev) =>
      showsWithMin.map((_, i) => {
        const state = showStateByIdx.get(i)
        // Si déjà touché par l'user, on ne change rien
        // (heuristique simple : on respecte la dernière valeur)
        // Pour V1 on suit toujours le diff : inchangés OFF, MAJ/nouv ON.
        if (state?.kind === 'unchanged') return false
        return prev[i] !== undefined ? prev[i] : true
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showStateByIdx, willCreateDeroule, showsWithMin.length])

  const isUpdateMode =
    !willCreateDeroule &&
    (diff.updates.length > 0 ||
      diff.deletes.length > 0 ||
      diff.unchanged.length > 0)

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

  // (dateMismatch et willCreateDeroule sont déclarés plus haut, avant le
  // useMemo `diff`, pour éviter une TDZ ReferenceError au mount.)

  // FEST-5.5.3 : si l'import va créer un nouveau déroulé, propose de
  // reprendre les cadreurs (lanes type='personne') du déroulé le plus
  // récent (autre que targetDate). Déclaré AVANT le return null pour
  // respecter rules-of-hooks (useMemo doit être appelé à chaque render).
  const cadreurSourceDeroule = useMemo(() => {
    if (!willCreateDeroule) return null
    const others = (allProjectDeroules || []).filter(
      (d) => d.date_jour !== targetDate,
    )
    if (others.length === 0) return null
    const sorted = [...others].sort((a, b) =>
      a.date_jour < b.date_jour ? 1 : -1,
    )
    return sorted[0]
  }, [allProjectDeroules, willCreateDeroule, targetDate])

  if (!open || !extracted) return null

  const validShows = showsWithMin.filter(
    (s) => Number.isFinite(s.debut_min) && Number.isFinite(s.fin_min),
  )
  const checkedCount = checked.filter(Boolean).length

  function toggleAll(value) {
    setChecked(showsWithMin.map(() => value))
  }
  function toggleOne(i) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)))
  }

  async function handleConfirm() {
    if (importing) return
    // En mode UPDATE on découpe le payload : creates/updates/deletes
    // (basés sur le diff + les checkboxes user). Sinon : full create
    // (comportement historique).
    const selectedIdxs = showsWithMin
      .map((_, i) => i)
      .filter((i) => checked[i])
      .filter(
        (i) =>
          Number.isFinite(showsWithMin[i].debut_min) &&
          Number.isFinite(showsWithMin[i].fin_min),
      )

    let createsPayload = []
    const updatesPayload = []
    if (isUpdateMode) {
      for (const i of selectedIdxs) {
        const state = showStateByIdx.get(i)
        const show = { ...showsWithMin[i], idx: i }
        if (!state || state.kind === 'create') {
          createsPayload.push(show)
        } else if (state.kind === 'update') {
          updatesPayload.push({
            existingId: state.match.existing.id,
            fields: state.match.fields,
            show,
            old: {
              heure_debut_min: state.match.existing.heure_debut_min,
              heure_fin_min: state.match.existing.heure_fin_min,
            },
          })
        }
        // unchanged : on n'envoie pas (no-op)
      }
    } else {
      createsPayload = selectedIdxs.map((i) => ({
        ...showsWithMin[i],
        idx: i,
      }))
    }
    const deletesPayload = isUpdateMode
      ? diff.deletes
          .filter((d) => deleteChecked[d.existing.id])
          .map((d) => ({ existingId: d.existing.id }))
      : []

    if (
      createsPayload.length === 0 &&
      updatesPayload.length === 0 &&
      deletesPayload.length === 0
    ) {
      return
    }

    await onConfirm?.({
      targetDate,
      scenesToCreate: scenesToCreate.map((s) => s.scene),
      scenesMapping: scenesAnalysis,
      // Backward-compat : 'shows' = créations (comportement historique).
      shows: createsPayload,
      updates: updatesPayload,
      deletes: deletesPayload,
      propagateLinks,
      willCreateDeroule,
      copyCadreursFromDerouleId:
        cadreurSourceDeroule && copyCadreurs ? cadreurSourceDeroule.id : null,
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

          {/* FEST-5.5.3 : checkbox "Reprendre les cadreurs de [date]" */}
          {willCreateDeroule && cadreurSourceDeroule && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(34,197,94,0.08)',
                border: '1px solid rgba(34,197,94,0.3)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--txt-2)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={copyCadreurs}
                onChange={(e) => setCopyCadreurs(e.target.checked)}
              />
              Reprendre les cadreurs du{' '}
              <strong style={{ color: 'var(--txt)' }}>
                {formatHumanDate(cadreurSourceDeroule.date_jour)}
              </strong>
              <span
                style={{
                  color: 'var(--txt-3)',
                  fontSize: 11,
                  marginLeft: 4,
                }}
              >
                (évite de re-saisir Hugo, Samuel…)
              </span>
            </label>
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
              const diffState = isUpdateMode ? showStateByIdx.get(i) : null
              const isUpdate = diffState?.kind === 'update'
              const isCreate = diffState?.kind === 'create'
              const isUnchanged = diffState?.kind === 'unchanged'
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
                    borderColor: isUpdate
                      ? 'rgba(245,158,11,0.35)'
                      : isCreate
                      ? 'rgba(59,130,246,0.35)'
                      : checked[i]
                      ? 'var(--brd-sub)'
                      : 'transparent',
                    borderRadius: 5,
                    cursor: invalid ? 'not-allowed' : 'pointer',
                    opacity: invalid ? 0.45 : isUnchanged ? 0.6 : 1,
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
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <input
                        type="text"
                        value={s.titre || ''}
                        disabled={importing}
                        placeholder="Nom d'artiste"
                        onChange={(e) =>
                          setTitreOverrides((p) => ({ ...p, [i]: e.target.value }))
                        }
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                        title="Corriger le nom de l'artiste avant l'import"
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: 'var(--txt)',
                          flex: 1,
                          minWidth: 0,
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px dashed var(--brd-sub)',
                          outline: 'none',
                          padding: '1px 0',
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.borderBottomColor = 'var(--blue)'
                          e.currentTarget.style.borderBottomStyle = 'solid'
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.borderBottomColor = 'var(--brd-sub)'
                          e.currentTarget.style.borderBottomStyle = 'dashed'
                        }}
                      />
                      {/* Badges d'état diff (mode update) */}
                      {isUpdate && (
                        <span
                          style={{
                            padding: '1px 5px',
                            background: 'rgba(245,158,11,0.18)',
                            border: '1px solid rgba(245,158,11,0.45)',
                            borderRadius: 3,
                            fontSize: 9,
                            fontWeight: 700,
                            color: '#F59E0B',
                            flexShrink: 0,
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}
                        >
                          MAJ
                        </span>
                      )}
                      {isCreate && (
                        <span
                          style={{
                            padding: '1px 5px',
                            background: 'rgba(59,130,246,0.18)',
                            border: '1px solid rgba(59,130,246,0.45)',
                            borderRadius: 3,
                            fontSize: 9,
                            fontWeight: 700,
                            color: '#3B82F6',
                            flexShrink: 0,
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}
                        >
                          Nouveau
                        </span>
                      )}
                      {isUnchanged && (
                        <span
                          style={{
                            padding: '1px 5px',
                            background: 'rgba(150,150,150,0.12)',
                            border: '1px solid rgba(150,150,150,0.25)',
                            borderRadius: 3,
                            fontSize: 9,
                            fontWeight: 600,
                            color: 'var(--txt-3)',
                            flexShrink: 0,
                            textTransform: 'uppercase',
                            letterSpacing: 0.3,
                          }}
                        >
                          Inchangé
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 11,
                        color: 'var(--txt-3)',
                        flexWrap: 'wrap',
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
                        ) : isUpdate ? (
                          // Diff visuel : ancien (strikethrough) → nouveau
                          <>
                            <span style={{ textDecoration: 'line-through' }}>
                              {formatMinHHMM(
                                diffState.match.existing.heure_debut_min,
                              )}
                              –
                              {formatMinHHMM(
                                diffState.match.existing.heure_fin_min,
                              )}
                            </span>
                            <span
                              style={{
                                margin: '0 4px',
                                color: '#F59E0B',
                                fontWeight: 600,
                              }}
                            >
                              →
                            </span>
                            <span
                              style={{ color: 'var(--txt)', fontWeight: 600 }}
                            >
                              {formatMinHHMM(s.debut_min)}–
                              {formatMinHHMM(s.fin_min)}
                            </span>
                            {/* delta */}
                            {(diffState.match.deltaStart !== 0 ||
                              diffState.match.deltaEnd !== 0) && (
                              <span
                                style={{
                                  marginLeft: 4,
                                  color: '#F59E0B',
                                  fontWeight: 600,
                                }}
                              >
                                {diffState.match.deltaStart !== 0
                                  ? formatDelta(diffState.match.deltaStart)
                                  : ''}
                                {diffState.match.deltaStart !== 0 &&
                                diffState.match.deltaEnd !== 0 &&
                                diffState.match.deltaStart !==
                                  diffState.match.deltaEnd
                                  ? ' / '
                                  : ''}
                                {diffState.match.deltaEnd !== 0 &&
                                diffState.match.deltaStart !==
                                  diffState.match.deltaEnd
                                  ? formatDelta(diffState.match.deltaEnd)
                                  : ''}
                              </span>
                            )}
                          </>
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
                  {conflict && !isUpdate && !isUnchanged && (
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

          {/* Section ABSENTS (mode update) : créneaux existants non
              présents dans la nouvelle prog. Décochés par défaut (safety).
              Si coché, ils seront supprimés à l'apply. */}
          {isUpdateMode && diff.deletes.length > 0 && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 12px',
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.25)',
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--red, #EF4444)',
                  marginBottom: 6,
                  textTransform: 'uppercase',
                  letterSpacing: 0.05,
                }}
              >
                <AlertTriangle
                  size={11}
                  style={{
                    display: 'inline',
                    marginRight: 4,
                    verticalAlign: 'middle',
                  }}
                />
                Absents de la nouvelle prog ({diff.deletes.length})
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--txt-3)',
                  marginBottom: 8,
                }}
              >
                Ces créneaux existent en BDD mais ne figurent pas dans la
                nouvelle prog. Coche ceux à supprimer.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {diff.deletes.map(({ existing: c }) => {
                  const lane = existingLanes.find((l) => l.id === c.lane_id)
                  return (
                    <label
                      key={c.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '6px 8px',
                        background: deleteChecked[c.id]
                          ? 'rgba(239,68,68,0.12)'
                          : 'transparent',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(deleteChecked[c.id])}
                        disabled={importing}
                        onChange={() =>
                          setDeleteChecked((p) => ({
                            ...p,
                            [c.id]: !p[c.id],
                          }))
                        }
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--txt-2)',
                            textDecoration: deleteChecked[c.id]
                              ? 'line-through'
                              : 'none',
                          }}
                        >
                          {c.titre || '(sans titre)'}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--txt-3)',
                            display: 'flex',
                            gap: 8,
                          }}
                        >
                          <span>
                            {formatMinHHMM(c.heure_debut_min)}–
                            {formatMinHHMM(c.heure_fin_min)}
                          </span>
                          {lane?.libelle && <span>· {lane.libelle}</span>}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Toggle propagation aux cadreurs liés (mode update uniquement
              et seulement si y a des MAJ). */}
          {isUpdateMode && diff.updates.length > 0 && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                background: 'rgba(59,130,246,0.06)',
                border: '1px solid rgba(59,130,246,0.25)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--txt-2)',
                cursor: 'pointer',
                marginTop: 4,
              }}
            >
              <input
                type="checkbox"
                checked={propagateLinks}
                onChange={(e) => setPropagateLinks(e.target.checked)}
              />
              Décaler aussi les créneaux cadreurs liés (soft link)
              <span
                style={{
                  color: 'var(--txt-3)',
                  fontSize: 11,
                  marginLeft: 4,
                }}
              >
                ({diff.updates.length} MAJ → cascade vers les enfants liés)
              </span>
            </label>
          )}
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
          {(() => {
            // Compteurs pour le label du bouton + état disabled
            const nUpdates = isUpdateMode
              ? checked
                  .map((v, i) =>
                    v && showStateByIdx.get(i)?.kind === 'update' ? 1 : 0,
                  )
                  .reduce((a, b) => a + b, 0)
              : 0
            const nCreates = isUpdateMode
              ? checked
                  .map((v, i) =>
                    v && showStateByIdx.get(i)?.kind === 'create' ? 1 : 0,
                  )
                  .reduce((a, b) => a + b, 0)
              : checkedCount
            const nDeletes = isUpdateMode
              ? diff.deletes.filter((d) => deleteChecked[d.existing.id]).length
              : 0
            const hasActions = nCreates + nUpdates + nDeletes > 0
            return (
              <button
                type="button"
                onClick={handleConfirm}
                disabled={importing || !hasActions}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  background:
                    importing || !hasActions
                      ? 'var(--brd)'
                      : 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 500,
                  cursor:
                    importing || !hasActions ? 'not-allowed' : 'pointer',
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
                ) : isUpdateMode ? (
                  <>
                    <Check size={12} />
                    Appliquer
                    {nUpdates > 0 ? ` · ${nUpdates} MAJ` : ''}
                    {nCreates > 0 ? ` · ${nCreates} nouv.` : ''}
                    {nDeletes > 0 ? ` · ${nDeletes} suppr.` : ''}
                  </>
                ) : (
                  <>
                    <Check size={12} />
                    Importer {checkedCount} créneau{checkedCount > 1 ? 'x' : ''}
                  </>
                )}
              </button>
            )
          })()}
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

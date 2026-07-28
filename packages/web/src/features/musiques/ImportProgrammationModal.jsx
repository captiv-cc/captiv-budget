// ════════════════════════════════════════════════════════════════════════════
// ImportProgrammationModal — Modal d'import de l'affiche festival
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.10
//
// Modal qui permet de déposer une affiche/line-up festival, l'envoyer
// à Claude Vision pour extraire la liste des artistes, puis upserter
// dans l'annuaire projet_artistes.
//
// Flow :
//   1. Drag & drop ou click pour choisir un fichier (PDF / JPG / PNG / WebP)
//   2. Preview du fichier (thumbnail si image)
//   3. Click "Analyser" → call Edge Function import-programmation
//   4. Loading state (Claude Vision met 5-10s)
//   5. Liste extraite : artistes avec checkboxes (tous cochés par défaut),
//      headliners pré-marqués visuellement, jour/scène affichés si dispos
//   6. Click "Importer N artistes" → bulkUpsertFromAffiche
//   7. Toast succès + close
//
// Cohérent avec ImportDerouleModal (FEST-4) mais adapté au cas affiche.
//
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  X,
  ImageUp,
  Loader2,
  Check,
  Sparkles,
  AlertCircle,
  Star,
  Pencil,
} from 'lucide-react'
import useImportProgrammation from '../../hooks/useImportProgrammation'
import { bulkUpsertFromAffiche } from '../../lib/projetArtistes'
import { notify } from '../../lib/notify'

const ACCEPTED_TYPES = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const MAX_FILE_SIZE_MB = 20

export default function ImportProgrammationModal({
  open,
  projectId,
  onClose,
  onImported,
}) {
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [selected, setSelected] = useState(new Set()) // ids artiste cochés
  const [importing, setImporting] = useState(false)
  // MUS-4.9 : overrides du flag headliner par idx, appliqués au commit.
  // Map<idx, boolean> ; absent = on garde la valeur IA d'origine.
  const [headlinerOverride, setHeadlinerOverride] = useState(new Map())
  // MUS-ANNUAIRE ② : corrections de noms (fautes d'extraction IA) avant
  // import — même pattern que la preview timetable du déroulé.
  // Map<idx, string> ; editingIdx = row en cours d'édition.
  const [nomOverride, setNomOverride] = useState(new Map())
  const [editingIdx, setEditingIdx] = useState(null)
  const [editDraft, setEditDraft] = useState('')
  const { extract, importing: extracting, error, result, reset } =
    useImportProgrammation()

  // Reset à chaque ouverture
  useEffect(() => {
    if (open) {
      setFile(null)
      setPreviewUrl(null)
      setDragOver(false)
      setSelected(new Set())
      setImporting(false)
      setHeadlinerOverride(new Map())
      setNomOverride(new Map())
      setEditingIdx(null)
      reset()
    }
  }, [open, reset])

  // MUS-ANNUAIRE ② : helpers nom override
  function getEffectiveNom(a, idx) {
    const o = nomOverride.get(idx)
    return o !== undefined ? o : a.nom
  }
  function commitNomEdit(idx) {
    const next = editDraft.trim()
    setNomOverride((prev) => {
      const map = new Map(prev)
      // Retour au nom IA d'origine (ou vide) → on retire l'override.
      if (!next || next === result?.artistes?.[idx]?.nom) map.delete(idx)
      else map.set(idx, next)
      return map
    })
    setEditingIdx(null)
  }

  // MUS-4.9 : helpers headliner override
  function getEffectiveHeadliner(a, idx) {
    if (headlinerOverride.has(idx)) return headlinerOverride.get(idx)
    return Boolean(a.headliner)
  }
  function toggleHeadliner(idx, current) {
    setHeadlinerOverride((prev) => {
      const next = new Map(prev)
      // Si on revient à la valeur IA d'origine, on retire l'override
      // (pour ne pas garder de trace inutile).
      const original = Boolean(result?.artistes?.[idx]?.headliner)
      if (!current === original) next.delete(idx)
      else next.set(idx, !current)
      return next
    })
  }

  // Cleanup blob URL
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    },
    [previewUrl],
  )

  // Pré-coche tous les artistes quand result arrive
  useEffect(() => {
    if (result?.artistes) {
      setSelected(new Set(result.artistes.map((_, i) => i)))
    }
  }, [result])

  // Esc to close
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape' && !extracting && !importing) onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, extracting, importing, onClose])

  function handleFile(f) {
    if (!f) return
    const sizeMB = f.size / 1024 / 1024
    if (sizeMB > MAX_FILE_SIZE_MB) {
      notify.error(`Fichier trop volumineux (${sizeMB.toFixed(1)}MB max ${MAX_FILE_SIZE_MB}MB)`)
      return
    }
    setFile(f)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    if (f.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(f))
    } else {
      setPreviewUrl(null) // PDF : pas de preview thumbnail simple
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer?.files?.[0]
    if (f) handleFile(f)
  }

  async function handleAnalyze() {
    if (!file) return
    try {
      await extract(file)
    } catch (e) {
      console.warn('[ImportProgrammation] extract failed', e)
      // L'erreur est déjà setError dans le hook + affichée plus bas
    }
  }

  function toggleSelected(idx) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function toggleAll() {
    const all = result?.artistes || []
    if (selected.size === all.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(all.map((_, i) => i)))
    }
  }

  async function handleImport() {
    if (!result?.artistes || selected.size === 0) return
    setImporting(true)
    try {
      // MUS-4.9 : applique les overrides headliner avant le commit
      const toImport = result.artistes
        .map((a, i) => ({
          ...a,
          nom: getEffectiveNom(a, i),
          headliner: getEffectiveHeadliner(a, i),
        }))
        .filter((_, i) => selected.has(i))
      const { created, updated, errors } = await bulkUpsertFromAffiche(
        projectId,
        toImport,
        { source: 'affiche' },
      )
      const parts = []
      if (created > 0) parts.push(`${created} créé${created > 1 ? 's' : ''}`)
      if (updated > 0) parts.push(`${updated} mis à jour`)
      if (errors.length > 0) parts.push(`${errors.length} erreur${errors.length > 1 ? 's' : ''}`)
      notify.success(parts.join(' · ') || 'Import terminé', false)
      onImported?.({ created, updated, errors })
      onClose?.()
    } catch (e) {
      console.warn('[ImportProgrammation] bulkUpsert failed', e)
      notify.error(e?.message || 'Erreur d\'import')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  const busy = extracting || importing
  const allSelected =
    result?.artistes &&
    selected.size === result.artistes.length &&
    result.artistes.length > 0

  return (
    <div
      onClick={() => !busy && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
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
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--txt)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Sparkles size={14} style={{ color: 'var(--blue, #3B82F6)' }} />
              Importer la programmation
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}>
              Affiche, line-up, flyer → liste d&apos;artistes extraite par
              Claude Vision
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 4,
              cursor: 'pointer',
              color: 'var(--txt-3)',
            }}
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
            gap: 14,
            overflow: 'auto',
          }}
        >
          {/* ─── Étape 1 : Choix du fichier ──────────────────────────── */}
          {!result && (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '40px 20px',
                  border: `2px dashed ${
                    dragOver
                      ? 'var(--blue, #3B82F6)'
                      : 'var(--brd-sub)'
                  }`,
                  borderRadius: 8,
                  background: dragOver
                    ? 'rgba(59,130,246,0.04)'
                    : 'var(--bg-elev)',
                  cursor: extracting ? 'not-allowed' : 'pointer',
                  transition: 'border-color 80ms, background 80ms',
                }}
              >
                {file && previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Aperçu affiche"
                    style={{
                      maxHeight: 220,
                      maxWidth: '100%',
                      borderRadius: 6,
                      objectFit: 'contain',
                    }}
                  />
                ) : (
                  <>
                    <ImageUp
                      size={32}
                      style={{
                        color: dragOver
                          ? 'var(--blue, #3B82F6)'
                          : 'var(--txt-3)',
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13,
                        color: dragOver
                          ? 'var(--blue, #3B82F6)'
                          : 'var(--txt-2)',
                        fontWeight: 500,
                      }}
                    >
                      Dépose l&apos;affiche ici
                      <span style={{ fontWeight: 400 }}> ou clique pour choisir</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                      PDF, JPG, PNG, WebP — max {MAX_FILE_SIZE_MB}MB
                    </div>
                  </>
                )}
                {file && (
                  <div style={{ fontSize: 11, color: 'var(--txt-3)' }}>
                    {file.name} · {(file.size / 1024).toFixed(0)} KB
                  </div>
                )}
                <input
                  type="file"
                  accept={ACCEPTED_TYPES}
                  disabled={extracting}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
              </label>

              {error && (
                <div
                  style={{
                    padding: '8px 12px',
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    color: '#EF4444',
                    borderRadius: 6,
                    fontSize: 12,
                    display: 'flex',
                    gap: 6,
                    alignItems: 'flex-start',
                  }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>{error}</div>
                </div>
              )}

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={() => !busy && onClose?.()}
                  disabled={busy}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={!file || busy}
                  style={{
                    padding: '8px 14px',
                    background: !file ? 'var(--brd)' : 'var(--blue, #3B82F6)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: !file || busy ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    opacity: !file || busy ? 0.6 : 1,
                  }}
                >
                  {extracting ? (
                    <Loader2 size={12} className="spin-imp" />
                  ) : (
                    <Sparkles size={12} />
                  )}
                  {extracting ? 'Analyse en cours…' : 'Analyser l\'affiche'}
                </button>
              </div>
            </>
          )}

          {/* ─── Étape 2 : Preview résultat extrait ──────────────────── */}
          {result && (
            <>
              <div
                style={{
                  padding: '8px 12px',
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#22C55E',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Check size={14} />
                <span style={{ flex: 1 }}>
                  {result.artistes.length} artiste{result.artistes.length > 1 ? 's' : ''} détecté{result.artistes.length > 1 ? 's' : ''}
                  {result.festival_name ? ` · ${result.festival_name}` : ''}
                  {result.dates ? ` · ${result.dates}` : ''}
                </span>
                {result.meta?.duration_ms && (
                  <span style={{ fontSize: 10, opacity: 0.7 }}>
                    {(result.meta.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>

              {/* Toolbar liste */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: 11,
                }}
              >
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--blue, #3B82F6)',
                    cursor: 'pointer',
                    fontSize: 11,
                    textDecoration: 'underline',
                  }}
                >
                  {allSelected ? 'Tout décocher' : 'Tout cocher'}
                </button>
                <span style={{ color: 'var(--txt-3)' }}>
                  {selected.size} sélectionné{selected.size > 1 ? 's' : ''} sur {result.artistes.length}
                </span>
              </div>

              {/* Liste artistes */}
              <div
                style={{
                  border: '1px solid var(--brd-sub)',
                  borderRadius: 6,
                  overflow: 'hidden',
                  maxHeight: 400,
                  overflowY: 'auto',
                }}
              >
                {result.artistes.map((a, idx) => {
                  const checked = selected.has(idx)
                  const isHL = getEffectiveHeadliner(a, idx)
                  const wasOverridden =
                    headlinerOverride.has(idx) &&
                    headlinerOverride.get(idx) !== Boolean(a.headliner)
                  const displayNom = getEffectiveNom(a, idx)
                  const nomEdited = nomOverride.has(idx)
                  const isEditing = editingIdx === idx
                  return (
                    <label
                      key={idx}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '20px 1fr auto auto',
                        gap: 10,
                        padding: '7px 10px',
                        fontSize: 12,
                        alignItems: 'center',
                        borderBottom:
                          idx < result.artistes.length - 1
                            ? '1px solid var(--brd-sub)'
                            : 'none',
                        cursor: 'pointer',
                        background: checked
                          ? 'rgba(59,130,246,0.04)'
                          : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelected(idx)}
                        disabled={importing}
                        style={{ accentColor: 'var(--blue, #3B82F6)' }}
                      />
                      <span
                        style={{
                          fontWeight: isHL ? 600 : 400,
                          color: 'var(--txt)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        {/* MUS-ANNUAIRE ② : correction du nom avant import
                            (faute de lecture IA). Crayon → input inline. */}
                        {isEditing ? (
                          <input
                            value={editDraft}
                            autoFocus
                            disabled={importing}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                commitNomEdit(idx)
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault()
                                setEditingIdx(null)
                              }
                            }}
                            onBlur={() => commitNomEdit(idx)}
                            style={{
                              background: 'var(--bg-elev)',
                              border: '1px solid var(--blue, #3B82F6)',
                              borderRadius: 4,
                              color: 'var(--txt)',
                              fontSize: 12,
                              padding: '2px 6px',
                              outline: 'none',
                              width: `${Math.max(10, editDraft.length + 2)}ch`,
                              maxWidth: 260,
                            }}
                          />
                        ) : (
                          <span style={{ color: nomEdited ? 'var(--blue, #3B82F6)' : undefined }}>
                            {displayNom}
                          </span>
                        )}
                        {!isEditing && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setEditDraft(displayNom)
                              setEditingIdx(idx)
                            }}
                            disabled={importing}
                            title="Corriger le nom de l'artiste avant l'import"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              display: 'inline-flex',
                              cursor: importing ? 'not-allowed' : 'pointer',
                              opacity: 0.3,
                              transition: 'opacity 80ms',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.opacity = '0.8'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.opacity = '0.3'
                            }}
                          >
                            <Pencil size={11} style={{ color: 'var(--txt-3)' }} />
                          </button>
                        )}
                        {nomEdited && !isEditing && (
                          <span
                            style={{ fontSize: 9, color: 'var(--blue, #3B82F6)', fontStyle: 'italic' }}
                            title={`Nom IA d'origine : « ${a.nom} »`}
                          >
                            ·corrigé
                          </span>
                        )}
                        {/* MUS-4.9 : étoile cliquable pour toggle headliner.
                            Pleine ambrée pour HL, vide grise sinon (visible
                            quand on hover toute la row pour discoverabilité). */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            toggleHeadliner(idx, isHL)
                          }}
                          disabled={importing}
                          title={
                            isHL
                              ? 'Retirer le statut tête d\'affiche'
                              : 'Marquer comme tête d\'affiche'
                          }
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            display: 'inline-flex',
                            cursor: importing ? 'not-allowed' : 'pointer',
                            opacity: isHL ? 1 : 0.3,
                            transition: 'opacity 80ms, transform 60ms',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = isHL ? '0.8' : '0.7'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = isHL ? '1' : '0.3'
                          }}
                        >
                          <Star
                            size={11}
                            style={{ color: '#D97706' }}
                            fill={isHL ? '#D97706' : 'none'}
                          />
                        </button>
                        {wasOverridden && (
                          <span
                            style={{
                              fontSize: 9,
                              color: 'var(--txt-3)',
                              fontStyle: 'italic',
                            }}
                            title="Override manuel (≠ IA)"
                          >
                            ·modifié
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                        {a.jour || ''}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                        {a.scene || ''}
                      </span>
                    </label>
                  )
                })}
              </div>

              {/* Actions finales */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    reset()
                    setFile(null)
                    setPreviewUrl(null)
                  }}
                  disabled={busy}
                  style={{
                    padding: '8px 14px',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ← Choisir une autre affiche
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={selected.size === 0 || busy}
                  style={{
                    padding: '8px 14px',
                    background: 'var(--blue, #3B82F6)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor:
                      selected.size === 0 || busy ? 'not-allowed' : 'pointer',
                    opacity: selected.size === 0 ? 0.5 : 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  {importing ? (
                    <Loader2 size={12} className="spin-imp" />
                  ) : (
                    <Check size={12} />
                  )}
                  Importer {selected.size > 0 ? `${selected.size} ` : ''}artiste
                  {selected.size > 1 ? 's' : ''}
                </button>
              </div>

              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt-3)',
                  textAlign: 'center',
                  opacity: 0.8,
                }}
              >
                Les artistes déjà dans l&apos;annuaire seront mis à jour
                (matching flou sur nom). Pas de doublons.
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        .spin-imp { animation: spin-imp 1s linear infinite; }
        @keyframes spin-imp {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

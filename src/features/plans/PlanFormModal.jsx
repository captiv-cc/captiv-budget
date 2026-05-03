// ════════════════════════════════════════════════════════════════════════════
// PlanFormModal — Modale unique pour créer / éditer un plan
// ════════════════════════════════════════════════════════════════════════════
//
// Mode "create" : tous les champs vides + drop zone fichier obligatoire.
// Mode "edit"   : champs pré-remplis + section "Remplacer le fichier" optionnelle
//                 (avec champ comment de mise à jour qui sera stocké dans la
//                 row plan_versions archivée).
//
// Champs :
//   - Nom (obligatoire)
//   - Catégorie (obligatoire — select parmi les non-archivées)
//   - Tags (multi, autocomplete sur tags existants du projet)
//   - Description (libre)
//   - Date applicable (optionnel — null = "tous les jours")
//   - Fichier (drop zone PDF/PNG/JPG, 50MB max — required en create)
//
// Submit : appelle actions.createPlan ou actions.updatePlan + replacePlanFile.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { Calendar, FileText, Image as ImageIcon, Plus, Upload, X } from 'lucide-react'
import {
  ALLOWED_FILE_TYPES,
  MAX_FILE_SIZE_BYTES,
  formatFileSize,
  mimeTypeToFileType,
} from '../../lib/plans'
import { notify } from '../../lib/notify'
import PlanDatesPickerModal from './PlanDatesPickerModal'

export default function PlanFormModal({
  open,
  onClose,
  mode = 'create',         // 'create' | 'edit'
  plan = null,             // requis en mode edit
  categories = [],
  allTags = [],
  projectMetadata = null,  // pour afficher prépa/tournage en arrière-plan du datepicker
  actions,                 // { createPlan, updatePlan, replacePlanFile }
}) {
  const isEdit = mode === 'edit'

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [tags, setTags] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [applicableDates, setApplicableDates] = useState([])
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [replaceComment, setReplaceComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset / preload à chaque (re)open.
  useEffect(() => {
    if (!open) return
    if (isEdit && plan) {
      setName(plan.name || '')
      setDescription(plan.description || '')
      setCategoryId(plan.category_id || '')
      setTags(plan.tags || [])
      setApplicableDates(Array.isArray(plan.applicable_dates) ? plan.applicable_dates : [])
      setFile(null)
      setReplaceComment('')
    } else {
      setName('')
      setDescription('')
      setCategoryId('')
      setTags([])
      setApplicableDates([])
      setFile(null)
      setReplaceComment('')
    }
    setTagInput('')
  }, [open, isEdit, plan])

  // Autocomplete tags : suggestions = allTags - tags déjà choisis, filtrées
  // par le texte en cours de saisie.
  const tagSuggestions = useMemo(() => {
    const q = tagInput.trim().toLowerCase()
    if (!q) return []
    return allTags
      .filter((t) => !tags.includes(t))
      .filter((t) => t.toLowerCase().includes(q))
      .slice(0, 6)
  }, [tagInput, allTags, tags])

  if (!open) return null

  function addTag(value) {
    const v = (value || '').trim()
    if (!v) return
    if (tags.includes(v)) return
    if (v.length > 30) return
    setTags([...tags, v])
    setTagInput('')
  }

  function removeTag(t) {
    setTags(tags.filter((x) => x !== t))
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0]
    if (!f) return
    validateAndSetFile(f)
  }

  function handleFileDrop(e) {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    validateAndSetFile(f)
  }

  function validateAndSetFile(f) {
    const ft = mimeTypeToFileType(f.type)
    if (!ft) {
      notify.error('Format non supporté (PDF, PNG ou JPG uniquement)')
      return
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      notify.error(`Fichier trop volumineux (max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB)`)
      return
    }
    setFile(f)
  }

  const canSubmit =
    !submitting &&
    name.trim().length > 0 &&
    Boolean(categoryId) &&
    (isEdit || file)

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      if (isEdit) {
        // 1. Update meta
        await actions.updatePlan(plan.id, {
          name,
          description,
          category_id: categoryId,
          tags,
          applicable_dates: applicableDates,
        })
        // 2. Si nouveau fichier fourni → replacePlanFile (archive ancien).
        if (file) {
          await actions.replacePlanFile(plan.id, file, {
            comment: replaceComment.trim() || null,
          })
        }
        notify.success('Plan mis à jour')
      } else {
        await actions.createPlan({
          name,
          description: description || null,
          categoryId,
          tags,
          applicableDates,
          file,
        })
        notify.success('Plan ajouté')
      }
      onClose?.()
    } catch (err) {
      console.error('[PlanFormModal] submit error', err)
      notify.error('Erreur : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-xl max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <h2 className="flex-1 text-base font-bold" style={{ color: 'var(--txt)' }}>
            {isEdit ? 'Modifier le plan' : 'Nouveau plan'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Nom */}
          <Field label="Nom" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nom du plan"
              maxLength={120}
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
          </Field>

          {/* Catégorie */}
          <Field label="Catégorie" required>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            >
              <option value="">— Choisir —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Tags */}
          <Field
            label="Tags"
            hint="Optionnel — pour recherche rapide"
          >
            <div
              className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-md"
              style={{
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                minHeight: 36,
              }}
            >
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--bg-hov)', color: 'var(--txt-2)' }}
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="opacity-60 hover:opacity-100"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag(tagInput)
                  } else if (e.key === 'Backspace' && !tagInput && tags.length) {
                    setTags(tags.slice(0, -1))
                  }
                }}
                placeholder={tags.length ? '' : 'Ajouter un tag…'}
                className="flex-1 min-w-[120px] text-sm bg-transparent outline-none"
                style={{ color: 'var(--txt)' }}
              />
            </div>
            {tagSuggestions.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {tagSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addTag(s)}
                    className="text-[11px] px-2 py-0.5 rounded"
                    style={{
                      background: 'var(--bg-elev)',
                      color: 'var(--txt-2)',
                      border: '1px solid var(--brd-sub)',
                    }}
                  >
                    + {s}
                  </button>
                ))}
              </div>
            )}
          </Field>

          {/* Description */}
          <Field label="Description" hint="Optionnel">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Notes, contexte, validations…"
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none resize-none"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
          </Field>

          {/* Jours d'application */}
          <Field
            label="Jours d'application"
            hint="Optionnel — laisser vide si le plan vaut pour tous les jours"
          >
            <button
              type="button"
              onClick={() => setDatePickerOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-all"
              style={{
                background: 'var(--bg-elev)',
                color: applicableDates.length ? 'var(--txt)' : 'var(--txt-3)',
                border: '1px solid var(--brd)',
              }}
            >
              <Calendar className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
              <span className="flex-1 text-sm truncate">
                {applicableDates.length === 0
                  ? 'Tous les jours'
                  : formatDatesSummary(applicableDates)}
              </span>
              {applicableDates.length > 0 && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                >
                  {applicableDates.length}
                </span>
              )}
            </button>
          </Field>

          {/* Fichier */}
          <Field
            label={isEdit ? 'Remplacer le fichier' : 'Fichier'}
            required={!isEdit}
            hint={
              isEdit
                ? `Optionnel — uploader un nouveau fichier archivera la version actuelle (V${plan?.current_version || 1})`
                : `PDF, PNG ou JPG — max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`
            }
          >
            <FileDropZone file={file} onFileChange={handleFileChange} onFileDrop={handleFileDrop} />
            {isEdit && file && (
              <input
                type="text"
                value={replaceComment}
                onChange={(e) => setReplaceComment(e.target.value)}
                placeholder="Note de mise à jour (ex: « Ajout caméra HF en fond »)"
                maxLength={150}
                className="mt-2 w-full text-xs px-3 py-1.5 rounded-md outline-none"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              />
            )}
          </Field>
        </div>

        {/* Footer */}
        <footer
          className="flex justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium px-3 py-1.5 rounded-md"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md"
            style={{
              background: 'var(--blue)',
              color: 'white',
              opacity: canSubmit ? 1 : 0.5,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            <Plus className="w-3 h-3" />
            {submitting
              ? isEdit
                ? 'Enregistrement…'
                : 'Création…'
              : isEdit
                ? 'Enregistrer'
                : 'Créer'}
          </button>
        </footer>
      </div>

      {/* Modale calendrier multi-sélection — au-dessus de la modale form */}
      <PlanDatesPickerModal
        open={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        initialDates={applicableDates}
        projectMetadata={projectMetadata}
        onSave={(dates) => setApplicableDates(dates)}
      />
    </div>
  )
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

/**
 * Résumé compact d'un tableau de dates ISO.
 *  - 1 date  → "12/05/2026"
 *  - 2-3     → "12, 13, 14/05"
 *  - 4+ contigus → "12 → 17/05"
 *  - 4+ non contigus → "5 jours"
 */
function formatDatesSummary(dates) {
  if (!Array.isArray(dates) || dates.length === 0) return ''
  const sorted = [...dates].sort()
  if (sorted.length === 1) return formatFR(sorted[0], true)
  // Détection contiguïté
  const allContiguous = sorted.every((iso, i) => {
    if (i === 0) return true
    const prev = new Date(sorted[i - 1])
    const cur = new Date(iso)
    const diffDays = Math.round((cur - prev) / 86400000)
    return diffDays === 1
  })
  if (allContiguous && sorted.length >= 4) {
    return `${formatFR(sorted[0], false)} → ${formatFR(sorted.at(-1), true)}`
  }
  if (sorted.length <= 3) {
    const days = sorted.map((iso, i) => formatFR(iso, i === sorted.length - 1)).join(', ')
    return days
  }
  return `${sorted.length} jours`
}

function formatFR(iso, withYear = false) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return withYear ? `${dd}/${mm}/${d.getFullYear()}` : `${dd}/${mm}`
}

/* ─── Sous-composants ─────────────────────────────────────────────────────── */

function Field({ label, hint, required = false, children }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
        {label}
        {required && <span style={{ color: 'var(--red)' }}> *</span>}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function FileDropZone({ file, onFileChange, onFileDrop }) {
  const inputRef = useRef(null)
  const [hovered, setHovered] = useState(false)

  const accept = ALLOWED_FILE_TYPES.map((t) =>
    t === 'pdf' ? 'application/pdf' : t === 'jpg' ? 'image/jpeg' : `image/${t}`,
  ).join(',')

  if (file) {
    const isPdf = file.type === 'application/pdf'
    const Icon = isPdf ? FileText : ImageIcon
    return (
      <div
        className="flex items-center gap-3 p-3 rounded-md"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
        }}
      >
        <Icon className="w-6 h-6 shrink-0" style={{ color: 'var(--blue)' }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate" style={{ color: 'var(--txt)' }}>
            {file.name}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {formatFileSize(file.size)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="text-[11px] font-medium px-2 py-1 rounded"
          style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}
        >
          Changer
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onFileChange}
          className="hidden"
        />
      </div>
    )
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setHovered(true)
      }}
      onDragLeave={() => setHovered(false)}
      onDrop={(e) => {
        setHovered(false)
        onFileDrop(e)
      }}
      className="flex flex-col items-center justify-center gap-1 p-6 rounded-md cursor-pointer transition-all"
      style={{
        background: hovered ? 'var(--blue-bg)' : 'var(--bg-elev)',
        border: `1px dashed ${hovered ? 'var(--blue)' : 'var(--brd)'}`,
      }}
    >
      <Upload className="w-5 h-5" style={{ color: 'var(--txt-3)' }} />
      <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
        Glisser le fichier ici ou{' '}
        <span style={{ color: 'var(--blue)' }}>parcourir</span>
      </p>
      <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
        PDF, PNG ou JPG — max {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onFileChange}
        className="hidden"
      />
    </div>
  )
}

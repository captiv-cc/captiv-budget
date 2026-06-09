// ════════════════════════════════════════════════════════════════════════════
// CreateFeedbackModal — Modale de création d'un ticket bug/idée (FBK-1.4)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale centrée pour créer un ticket. Toggle bug/idée → champs adaptés.
// Auto-fill "page" via initialPage (URL/nom de la page d'où on a cliqué).
//
// Champs communs : type / titre / page / description / priorité
// Spécifiques bug : category=type de bug / steps_to_reproduce
// Spécifiques idée : category=thématique / images de refs (option)
//
// Screenshots / images : upload après création du ticket (besoin du ticket_id
// pour le path Storage). On crée le ticket vide d'attachments d'abord, puis
// on upload séquentiellement.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { X, Bug, Lightbulb, Upload, Loader2, Image as ImageIcon } from 'lucide-react'
import {
  createTicket,
  uploadAttachment,
  TICKET_TYPES,
  PRIORITY_LABELS,
} from '../../lib/feedback'
import { notify } from '../../lib/notify'

export default function CreateFeedbackModal({
  open,
  initialPage = '',
  initialType = 'bug',
  onClose,
  onCreated,
}) {
  const [type, setType] = useState(initialType)
  const [title, setTitle] = useState('')
  const [page, setPage] = useState(initialPage)
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [steps, setSteps] = useState('')
  const [priority, setPriority] = useState('normal')
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef(null)

  // Reset à l'ouverture/fermeture
  useEffect(() => {
    if (open) {
      setType(initialType)
      setTitle('')
      setPage(initialPage)
      setCategory('')
      setDescription('')
      setSteps('')
      setPriority('normal')
      setFiles([])
    }
  }, [open, initialPage, initialType])

  if (!open) return null

  function handleFilesChosen(e) {
    const list = Array.from(e.target.files || [])
    // Cap 50 Mo / fichier, 5 fichiers max
    const MAX = 50 * 1024 * 1024
    const next = []
    for (const f of list) {
      if (f.size > MAX) {
        notify.error(`${f.name} trop gros (max 50 Mo)`)
        continue
      }
      next.push(f)
    }
    setFiles((cur) => [...cur, ...next].slice(0, 5))
    e.target.value = ''
  }

  function removeFile(idx) {
    setFiles((cur) => cur.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!title.trim()) {
      notify.error('Titre requis')
      return
    }
    if (!description.trim()) {
      notify.error('Description requise')
      return
    }
    setSubmitting(true)
    try {
      const ticket = await createTicket({
        type,
        title,
        page,
        category,
        description,
        steps_to_reproduce: type === 'bug' ? steps : null,
        priority,
      })
      // Upload des attachments en séquentiel pour éviter de pulvériser
      // la connection si plusieurs fichiers lourds
      let okFiles = 0
      for (const file of files) {
        try {
          await uploadAttachment(ticket.id, file)
          okFiles += 1
        } catch (e) {
          console.warn('[CreateFeedback] upload KO', file.name, e)
          notify.error(`${file.name} : upload KO`)
        }
      }
      if (okFiles > 0) {
        notify.success(
          `Ticket créé avec ${okFiles} pièce${okFiles > 1 ? 's' : ''} jointe${okFiles > 1 ? 's' : ''}`,
          false,
        )
      } else {
        notify.success('Ticket créé', false)
      }
      onCreated?.(ticket)
      onClose?.()
    } catch (e) {
      console.warn('[CreateFeedback] failed', e)
      notify.error(e?.message || 'Création KO')
    } finally {
      setSubmitting(false)
    }
  }

  const isBug = type === 'bug'

  return (
    <div
      onClick={() => !submitting && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
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
        {/* ─── Header ─── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--txt)',
              margin: 0,
            }}
          >
            Nouveau retour
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              display: 'inline-flex',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Body scrollable ─── */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {/* Toggle type bug/idea */}
          <div style={{ display: 'flex', gap: 6 }}>
            {TICKET_TYPES.map((t) => {
              const isActive = type === t
              const Icon = t === 'bug' ? Bug : Lightbulb
              const label = t === 'bug' ? 'Bug' : 'Idée'
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    flex: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 12px',
                    background: isActive
                      ? t === 'bug'
                        ? 'rgba(239,68,68,0.15)'
                        : 'rgba(168,85,247,0.15)'
                      : 'var(--bg-elev)',
                    color: isActive
                      ? t === 'bug'
                        ? '#EF4444'
                        : '#A855F7'
                      : 'var(--txt-2)',
                    border: `1px solid ${
                      isActive
                        ? t === 'bug'
                          ? '#EF4444'
                          : '#A855F7'
                        : 'var(--brd)'
                    }`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Icon size={14} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* Titre */}
          <Field label="Titre" required>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                isBug
                  ? 'Ex : Le bouton Enregistrer ne marche pas'
                  : 'Ex : Ajouter un raccourci Cmd+S'
              }
              disabled={submitting}
              maxLength={200}
              autoFocus
              style={inputStyle()}
            />
          </Field>

          {/* Page concernée */}
          <Field label="Page concernée">
            <input
              type="text"
              value={page}
              onChange={(e) => setPage(e.target.value)}
              placeholder="Ex : Devis · Onglet Livrables"
              disabled={submitting}
              style={inputStyle()}
            />
          </Field>

          {/* Catégorie / thématique */}
          <Field label={isBug ? 'Type de bug' : 'Thématique'}>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder={
                isBug
                  ? 'Ex : Crash · Lenteur · UI cassée'
                  : 'Ex : UX · Performance · Intégration'
              }
              disabled={submitting}
              style={inputStyle()}
            />
          </Field>

          {/* Description */}
          <Field label="Description" required>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isBug
                  ? "Ce qui s'est passé, ce que tu attendais, etc."
                  : 'Décris ton idée, son contexte et la valeur attendue.'
              }
              disabled={submitting}
              rows={4}
              maxLength={8000}
              style={{ ...inputStyle(), resize: 'vertical', minHeight: 80 }}
            />
          </Field>

          {/* Steps to reproduce (bug only) */}
          {isBug && (
            <Field label="Étapes pour reproduire (optionnel)">
              <textarea
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                placeholder={`1. Aller sur la page…\n2. Cliquer sur…\n3. Constater que…`}
                disabled={submitting}
                rows={3}
                style={{ ...inputStyle(), resize: 'vertical', minHeight: 60 }}
              />
            </Field>
          )}

          {/* Priorité */}
          <Field label="Priorité">
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PRIORITY_LABELS).map(([key, label]) => {
                const isActive = priority === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPriority(key)}
                    style={{
                      flex: 1,
                      padding: '6px 10px',
                      background: isActive
                        ? 'var(--blue-bg, rgba(59,130,246,0.18))'
                        : 'var(--bg-elev)',
                      color: isActive
                        ? 'var(--blue, #3B82F6)'
                        : 'var(--txt-2)',
                      border: `1px solid ${
                        isActive ? 'var(--blue, #3B82F6)' : 'var(--brd)'
                      }`,
                      borderRadius: 4,
                      fontSize: 12,
                      cursor: 'pointer',
                      fontWeight: isActive ? 600 : 400,
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Attachments */}
          <Field
            label={
              isBug
                ? 'Screenshots (jusqu’à 5)'
                : 'Images de refs (optionnel, jusqu’à 5)'
            }
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesChosen}
              disabled={submitting}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting || files.length >= 5}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px dashed var(--brd)',
                borderRadius: 4,
                cursor:
                  submitting || files.length >= 5 ? 'not-allowed' : 'pointer',
                fontSize: 12,
                opacity: files.length >= 5 ? 0.5 : 1,
              }}
            >
              <Upload size={12} />
              Ajouter des images
            </button>
            {/* Preview files */}
            {files.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  marginTop: 8,
                }}
              >
                {files.map((f, idx) => (
                  <span
                    key={idx}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 6px 3px 8px',
                      background: 'var(--bg-elev)',
                      border: '1px solid var(--brd-sub)',
                      borderRadius: 10,
                      fontSize: 11,
                      color: 'var(--txt-2)',
                    }}
                  >
                    <ImageIcon size={10} />
                    {f.name.length > 24 ? f.name.slice(0, 21) + '…' : f.name}
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      disabled={submitting}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--txt-3)',
                        cursor: 'pointer',
                        padding: 0,
                        display: 'inline-flex',
                      }}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </Field>
        </div>

        {/* ─── Footer actions ─── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '10px 14px',
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '6px 14px',
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
              borderRadius: 4,
              fontSize: 13,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !title.trim() || !description.trim()}
            style={{
              padding: '6px 14px',
              background: 'var(--blue, #3B82F6)',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              cursor:
                submitting || !title.trim() || !description.trim()
                  ? 'not-allowed'
                  : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: !title.trim() || !description.trim() ? 0.6 : 1,
            }}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            Envoyer
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, required = false, children }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt-3)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          fontWeight: 600,
        }}
      >
        {label}
        {required && <span style={{ color: '#EF4444', marginLeft: 3 }}>*</span>}
      </div>
      {children}
    </div>
  )
}

function inputStyle() {
  return {
    width: '100%',
    padding: '6px 10px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd-sub)',
    color: 'var(--txt)',
    borderRadius: 4,
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  }
}

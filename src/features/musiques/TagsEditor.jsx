// ════════════════════════════════════════════════════════════════════════════
// TagsEditor — Édition des tags d'une proposition (collab + autocomplete)
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.13
//
// UI inline pour gérer les tags d'une proposition :
//   - Chips compacts pour les tags existants
//   - X pour retirer (RLS limite ça à ses propres tags + admin)
//   - Bouton "+ tag" → input avec autocomplete sur les tags existants
//     du projet
//   - Submit : Enter, click sur une suggestion, ou blur sur input non vide
//
// Props :
//   - propositionId
//   - projectId
//   - currentUserId
//   - tags : Array<{ id, tag, user_id }> depuis aggregate
//   - canEdit (boolean) : si false, mode read-only (juste les chips)
//   - onChange () : appelé après add/remove pour signaler refetch éventuel
//                   (n'est plus utile avec Realtime, mais reste pour
//                   forcer refresh si Realtime KO)
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { addTag, removeTag, listDistinctTags, normalizeTag } from '../../lib/musiques'
import { notify } from '../../lib/notify'

export default function TagsEditor({
  propositionId,
  projectId,
  currentUserId,
  tags = [],
  canEdit = true,
  onChange,
  // MUS-3.1 : si fourni, click sur un chip tag = filtre par ce tag
  onTagClick,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)

  // Autocomplete : debounce 200ms sur le draft
  useEffect(() => {
    if (!editing || !projectId) return undefined
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const list = await listDistinctTags(projectId, draft, 8)
        if (cancelled) return
        // Filtre : retire ce qui est déjà sur la proposition courante
        const already = new Set(tags.map((t) => t.tag))
        setSuggestions((list || []).filter((s) => !already.has(s)))
      } catch (e) {
        console.warn('[TagsEditor] autocomplete failed', e)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [draft, editing, projectId, tags])

  // Focus auto à l'ouverture
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  const handleAdd = useCallback(
    async (rawTag) => {
      const tag = normalizeTag(rawTag)
      if (!tag) return
      if (tags.some((t) => t.tag === tag)) {
        notify.error('Ce tag existe déjà sur cette proposition')
        return
      }
      setBusy(true)
      try {
        await addTag(propositionId, tag)
        onChange?.()
        setDraft('')
        // Garder le mode édition ouvert pour ajouter rapidement plusieurs tags
        inputRef.current?.focus()
      } catch (e) {
        console.warn('[TagsEditor] add failed', e)
        notify.error(e?.message || 'Impossible d\'ajouter le tag')
      } finally {
        setBusy(false)
      }
    },
    [propositionId, tags, onChange],
  )

  const handleRemove = useCallback(
    async (tagId) => {
      setBusy(true)
      try {
        await removeTag(tagId)
        onChange?.()
      } catch (e) {
        console.warn('[TagsEditor] remove failed', e)
        notify.error(e?.message || 'Impossible de retirer le tag')
      } finally {
        setBusy(false)
      }
    },
    [onChange],
  )

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (draft.trim()) handleAdd(draft)
    } else if (e.key === 'Escape') {
      setEditing(false)
      setDraft('')
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      // Backspace sur input vide → retire le dernier tag (si à moi)
      const lastMine = [...tags]
        .reverse()
        .find((t) => t.user_id === currentUserId)
      if (lastMine) handleRemove(lastMine.id)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 4,
        alignItems: 'center',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Chips tags existants */}
      {tags.map((t) => {
        const isMine = t.user_id === currentUserId
        return (
          <span
            key={t.id}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              padding: '1px 6px',
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              borderRadius: 8,
              border: isMine ? '1px solid rgba(59,130,246,0.3)' : 'none',
            }}
            title={
              isMine
                ? 'Ton tag · clique X pour retirer, click chip pour filtrer'
                : onTagClick
                ? `Filtrer par "${t.tag}"`
                : undefined
            }
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onTagClick?.(t.tag)
              }}
              disabled={!onTagClick}
              style={{
                background: 'transparent',
                border: 'none',
                padding: 0,
                color: 'inherit',
                font: 'inherit',
                cursor: onTagClick ? 'pointer' : 'default',
              }}
            >
              {t.tag}
            </button>
            {canEdit && isMine && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleRemove(t.id)
                }}
                disabled={busy}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  color: 'var(--txt-3)',
                  opacity: 0.6,
                }}
                aria-label="Retirer ce tag"
              >
                <X size={9} />
              </button>
            )}
          </span>
        )
      })}

      {/* Bouton "+ tag" ou input édition */}
      {canEdit && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={busy}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 2,
            fontSize: 10,
            padding: '1px 6px',
            background: 'transparent',
            color: 'var(--txt-3)',
            border: '1px dashed var(--brd-sub)',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <Plus size={9} />
          tag
        </button>
      )}

      {canEdit && editing && (
        <div
          style={{
            position: 'relative',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              // Différé pour permettre le click sur une suggestion
              setTimeout(() => {
                // Si le focus est passé à une suggestion, on annule la
                // fermeture (la suggestion onMouseDown re-focus l'input).
                if (document.activeElement === inputRef.current) return
                if (draft.trim()) {
                  handleAdd(draft).then(() => setEditing(false))
                } else {
                  setEditing(false)
                }
              }, 100)
            }}
            placeholder="drop banger, intro chill…"
            disabled={busy}
            style={{
              padding: '1px 8px',
              fontSize: 11,
              background: 'var(--bg-surf)',
              border: '1px solid var(--blue, #3B82F6)',
              borderRadius: 8,
              color: 'var(--txt)',
              outline: 'none',
              minWidth: 120,
              height: 18,
            }}
          />
          {/* Dropdown suggestions */}
          {suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                zIndex: 20,
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                padding: 3,
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
                minWidth: 140,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--txt-3)',
                  padding: '2px 6px',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Tags existants du projet
              </div>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  // mousedown plutôt que onClick pour devancer le onBlur
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleAdd(s)
                  }}
                  style={{
                    padding: '3px 6px',
                    background: 'transparent',
                    border: 'none',
                    fontSize: 11,
                    color: 'var(--txt)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    borderRadius: 3,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--bg-elev)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {/* Bouton check pour valider sans Enter (mobile-friendly) */}
          {draft.trim() && (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                handleAdd(draft)
              }}
              disabled={busy}
              style={{
                background: 'var(--blue, #3B82F6)',
                color: 'white',
                border: 'none',
                borderRadius: 3,
                padding: '2px 4px',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
              aria-label="Ajouter ce tag"
            >
              <Check size={9} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

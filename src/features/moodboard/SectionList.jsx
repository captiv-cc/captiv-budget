// ════════════════════════════════════════════════════════════════════════════
// SectionList — Liste verticale des sections + masonry de cartes (MOD-1.6)
// ════════════════════════════════════════════════════════════════════════════
//
// Orchestre :
//   - Rendu de chaque section (header + masonry CSS columns)
//   - Drag-drop d'une CARTE vers une autre section (cross-section)
//   - Drag-drop d'une CARTE intra-section pour réordre
//   - Drag-drop d'une SECTION pour réordonner les sections elles-mêmes
//   - Édition inline du nom de section (clic sur le titre)
//   - Suppression de section (bouton "..." avec confirm)
//
// État de drag global ici (un seul drag à la fois) — passé en props aux
// Card via Section.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useRef, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Check,
  X,
  Trash2,
  Plus,
  Link as LinkIcon,
  Upload,
  StickyNote,
  Loader2,
} from 'lucide-react'
import {
  updateSection,
  deleteSection,
  updateCard,
  deleteCard,
  createCard,
  fetchUrlMetadata,
  uploadCardFile,
  calcSortOrderBetween,
} from '../../lib/moodboard'
import { notify } from '../../lib/notify'
import { confirm } from '../../lib/confirm'
import Card from './Card'

export default function SectionList({
  sections,
  cardsBySection,
  commentsByCard,
  reactionsByCard,
  canEdit,
  projectId,
  onMutated,
  onOpenCard,
}) {
  // État du drag en cours (cardId + sourceSectionId).
  // `dragging` = drag en cours, `over` = cible survolée.
  const draggingRef = useRef(null) // { cardId, fromSection }
  const [overSection, setOverSection] = useState(null) // sectionId | null
  const [overCard, setOverCard] = useState(null) // cardId | null
  const [collapsed, setCollapsed] = useState(() => new Set())

  const toggleCollapsed = useCallback((sectionId) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  // ─── Card drag handlers ─────────────────────────────────────────────────
  const handleCardDragStart = useCallback((card) => {
    draggingRef.current = { cardId: card.id, fromSection: card.section_id }
  }, [])

  const handleCardDragEnd = useCallback(() => {
    draggingRef.current = null
    setOverSection(null)
    setOverCard(null)
  }, [])

  const handleSectionDragOver = useCallback((e, sectionId) => {
    if (!draggingRef.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOverSection(sectionId)
  }, [])

  const handleCardDragOver = useCallback((e, card) => {
    if (!draggingRef.current) return
    if (draggingRef.current.cardId === card.id) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setOverCard(card.id)
    setOverSection(card.section_id)
  }, [])

  const handleCardDrop = useCallback(
    async (e, targetCard) => {
      if (!draggingRef.current) return
      e.preventDefault()
      e.stopPropagation()
      const { cardId, fromSection } = draggingRef.current
      const toSection = targetCard.section_id
      if (cardId === targetCard.id) return
      // Calcule sort_order pour insérer AVANT la cible
      const sectionCards = cardsBySection.get(toSection) || []
      const targetIdx = sectionCards.findIndex((c) => c.id === targetCard.id)
      const before = sectionCards[targetIdx - 1]?.sort_order ?? null
      const after = targetCard.sort_order ?? null
      const newOrder = calcSortOrderBetween(before, after)
      handleCardDragEnd()
      try {
        await updateCard(cardId, {
          section_id: toSection,
          sort_order: newOrder,
        })
        onMutated?.()
      } catch (err) {
        console.warn('[SectionList] move KO', err)
        notify.error(err?.message || 'Déplacement impossible')
      }
      // unused param (could be useful for fromSection diff)
      void fromSection
    },
    [cardsBySection, handleCardDragEnd, onMutated],
  )

  const handleSectionDrop = useCallback(
    async (e, sectionId) => {
      if (!draggingRef.current) return
      e.preventDefault()
      const { cardId, fromSection } = draggingRef.current
      handleCardDragEnd()
      if (sectionId === fromSection) return // pas de changement
      // Append en fin de la section cible
      const sectionCards = cardsBySection.get(sectionId) || []
      const last = sectionCards[sectionCards.length - 1]
      const newOrder = (last?.sort_order ?? 0) + 1000
      try {
        await updateCard(cardId, {
          section_id: sectionId,
          sort_order: newOrder,
        })
        onMutated?.()
      } catch (err) {
        console.warn('[SectionList] section-drop KO', err)
        notify.error(err?.message || 'Déplacement impossible')
      }
    },
    [cardsBySection, handleCardDragEnd, onMutated],
  )

  // ─── Section actions ────────────────────────────────────────────────────
  const handleRenameSection = useCallback(
    async (section, newName) => {
      if (!newName?.trim() || newName.trim() === section.nom) return
      try {
        await updateSection(section.id, { nom: newName.trim() })
        onMutated?.()
      } catch (e) {
        notify.error(e?.message || 'Renommage impossible')
      }
    },
    [onMutated],
  )

  const handleDeleteSection = useCallback(
    async (section) => {
      const cardCount = (cardsBySection.get(section.id) || []).length
      const message =
        cardCount > 0
          ? `La section "${section.nom}" et ses ${cardCount} carte${
              cardCount > 1 ? 's' : ''
            } seront supprimées définitivement.`
          : `La section "${section.nom}" sera supprimée.`
      const ok = await confirm({
        title: 'Supprimer la section',
        message,
        confirmLabel: 'Supprimer',
        danger: true,
      })
      if (!ok) return
      try {
        await deleteSection(section.id)
        onMutated?.()
      } catch (e) {
        notify.error(e?.message || 'Suppression impossible')
      }
    },
    [cardsBySection, onMutated],
  )

  const handleDeleteCard = useCallback(
    async (card) => {
      try {
        await deleteCard(card.id, { removeFile: true })
        onMutated?.()
      } catch (e) {
        notify.error(e?.message || 'Suppression impossible')
      }
    },
    [onMutated],
  )

  // ─── Add card actions (bouton "+" par section) ─────────────────────────
  const handleAddLink = useCallback(
    async (sectionId, url) => {
      const clean = url.trim()
      if (!clean) return
      try {
        let meta = null
        try {
          meta = await fetchUrlMetadata(clean)
        } catch (e) {
          console.warn('[SectionList] og-fetch KO', e)
        }
        await createCard(sectionId, {
          type: 'link',
          url: clean,
          title: meta?.title || clean,
          description: meta?.description || null,
          image_url: meta?.image_url || null,
          oembed_html: meta?.oembed_html || null,
          provider: meta?.provider || null,
        })
        onMutated?.()
      } catch (e) {
        notify.error(e?.message || 'Création carte impossible')
      }
    },
    [onMutated],
  )

  const handleAddUploads = useCallback(
    async (sectionId, files) => {
      if (!projectId) {
        notify.error('Projet introuvable')
        return
      }
      const MAX = 50 * 1024 * 1024
      let ok = 0
      for (const file of files) {
        const mime = (file.type || '').toLowerCase()
        const isImage = mime.startsWith('image/')
        const isVideo = mime.startsWith('video/')
        if (!isImage && !isVideo) {
          notify.error(`Type non supporté : ${mime || 'inconnu'}`)
          continue
        }
        if (file.size > MAX) {
          notify.error(
            `${file.name} trop gros (${Math.round(file.size / 1024 / 1024)} Mo, max 50)`,
          )
          continue
        }
        try {
          const tmpId = crypto.randomUUID()
          const { file_path, public_url } = await uploadCardFile(
            projectId,
            tmpId,
            file,
          )
          await createCard(sectionId, {
            type: isImage ? 'image' : 'video',
            title: file.name || null,
            file_path,
            image_url: public_url,
          })
          ok += 1
        } catch (e) {
          notify.error(e?.message || 'Upload KO')
        }
      }
      if (ok > 0) {
        notify.success(
          `${ok} carte${ok > 1 ? 's' : ''} ajoutée${ok > 1 ? 's' : ''}`,
          false,
        )
        onMutated?.()
      }
    },
    [projectId, onMutated],
  )

  const handleAddNote = useCallback(
    async (sectionId) => {
      try {
        const card = await createCard(sectionId, {
          type: 'note',
          title: 'Nouvelle note',
          content_json: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [] }],
          },
        })
        // Ouvre le drawer pour édition directe
        onOpenCard?.(card)
        onMutated?.()
      } catch (e) {
        notify.error(e?.message || 'Création note impossible')
      }
    },
    [onMutated, onOpenCard],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sections.map((section) => {
        const sectionCards = cardsBySection.get(section.id) || []
        const isCollapsed = collapsed.has(section.id)
        const isOver = overSection === section.id

        return (
          <div
            key={section.id}
            style={{
              background: 'var(--bg-surf)',
              border: `1px solid ${
                isOver ? 'var(--blue, #3B82F6)' : 'var(--brd-sub)'
              }`,
              borderRadius: 8,
              overflow: 'hidden',
              transition: 'border-color 100ms',
            }}
            onDragOver={(e) => handleSectionDragOver(e, section.id)}
            onDragLeave={() => {
              // On reset uniquement si on quitte la zone section
              setOverSection(null)
            }}
            onDrop={(e) => handleSectionDrop(e, section.id)}
          >
            <SectionHeader
              section={section}
              count={sectionCards.length}
              collapsed={isCollapsed}
              onToggleCollapsed={() => toggleCollapsed(section.id)}
              canEdit={canEdit}
              onRename={(name) => handleRenameSection(section, name)}
              onDelete={() => handleDeleteSection(section)}
              onAddLink={(url) => handleAddLink(section.id, url)}
              onAddUploads={(files) => handleAddUploads(section.id, files)}
              onAddNote={() => handleAddNote(section.id)}
            />

            {!isCollapsed && (
              <div style={{ padding: '8px 12px 12px' }}>
                {sectionCards.length === 0 ? (
                  <div
                    style={{
                      padding: '20px 12px',
                      textAlign: 'center',
                      color: 'var(--txt-3)',
                      fontSize: 11,
                      fontStyle: 'italic',
                      border: '1px dashed var(--brd-sub)',
                      borderRadius: 6,
                    }}
                  >
                    Glisse une carte ici ou colle une URL pour ajouter
                  </div>
                ) : (
                  <div
                    style={{
                      // Masonry CSS columns
                      columnCount: 'auto',
                      columnWidth: 200,
                      columnGap: 10,
                    }}
                  >
                    {sectionCards.map((card) => (
                      <div
                        key={card.id}
                        onDragOver={(e) => handleCardDragOver(e, card)}
                        onDrop={(e) => handleCardDrop(e, card)}
                        style={{
                          outline:
                            overCard === card.id
                              ? '2px solid var(--blue, #3B82F6)'
                              : 'none',
                          outlineOffset: 2,
                          borderRadius: 8,
                          marginBottom: 0,
                        }}
                      >
                        <Card
                          card={card}
                          comments={commentsByCard.get(card.id) || []}
                          reactionAgg={reactionsByCard.get(card.id) || null}
                          canEdit={canEdit}
                          onOpen={onOpenCard}
                          onDelete={canEdit ? handleDeleteCard : null}
                          draggable={canEdit}
                          onDragStart={() => handleCardDragStart(card)}
                          onDragEnd={handleCardDragEnd}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── SectionHeader ──────────────────────────────────────────────────────────
function SectionHeader({
  section,
  count,
  collapsed,
  onToggleCollapsed,
  canEdit,
  onRename,
  onDelete,
  onAddLink,
  onAddUploads,
  onAddNote,
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(section.nom)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [linkInputOpen, setLinkInputOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLoading, setLinkLoading] = useState(false)
  const fileInputRef = useRef(null)

  async function handleSubmitLink(e) {
    e?.preventDefault?.()
    const trimmed = linkUrl.trim()
    if (!trimmed) return
    setLinkLoading(true)
    try {
      await onAddLink?.(trimmed)
      setLinkUrl('')
      setLinkInputOpen(false)
    } finally {
      setLinkLoading(false)
    }
  }

  function handleFilesChosen(e) {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) onAddUploads?.(files)
    e.target.value = '' // reset pour re-trigger sur le même fichier
    setAddOpen(false)
  }

  const commit = () => {
    setEditing(false)
    if (draft && draft !== section.nom) onRename?.(draft)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={collapsed ? 'Déplier' : 'Replier'}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--txt-3)',
          cursor: 'pointer',
          padding: 2,
          display: 'inline-flex',
        }}
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
      </button>

      {section.color && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: section.color,
            flexShrink: 0,
          }}
        />
      )}

      {editing ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') {
                setDraft(section.nom)
                setEditing(false)
              }
            }}
            autoFocus
            style={{
              fontSize: 13,
              fontWeight: 600,
              flex: 1,
              padding: '2px 6px',
              background: 'var(--bg-surf)',
              border: '1px solid var(--blue, #3B82F6)',
              borderRadius: 4,
              color: 'var(--txt)',
              outline: 'none',
            }}
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              commit()
            }}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--blue, #3B82F6)',
              cursor: 'pointer',
            }}
          >
            <Check size={14} />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              setDraft(section.nom)
              setEditing(false)
            }}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--txt)',
            background: 'transparent',
            border: 'none',
            padding: '2px 4px',
            cursor: canEdit ? 'text' : 'default',
            textAlign: 'left',
          }}
          title={canEdit ? 'Cliquer pour renommer' : ''}
        >
          {section.nom}
        </button>
      )}

      <span
        style={{
          fontSize: 11,
          color: 'var(--txt-3)',
          fontWeight: 400,
        }}
      >
        {count}
      </span>

      <div style={{ flex: 1 }} />

      {/* Bouton + avec menu d'ajout (lien / upload / note) */}
      {canEdit && (
        <div style={{ position: 'relative' }}>
          {/* Hidden file input réutilisable */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={handleFilesChosen}
            style={{ display: 'none' }}
          />

          {/* Bouton + (cache derrière le menu Lien si l'input est ouvert) */}
          {!linkInputOpen && (
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                padding: '3px 8px 3px 6px',
                background: addOpen
                  ? 'var(--blue-bg, rgba(59,130,246,0.18))'
                  : 'rgba(59,130,246,0.10)',
                border: '1px solid var(--blue, #3B82F6)',
                borderRadius: 4,
                color: 'var(--blue, #3B82F6)',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 600,
              }}
              title="Ajouter une carte"
            >
              <Plus size={12} />
              Ajouter
            </button>
          )}

          {/* Input "coller un lien" en place du bouton */}
          {linkInputOpen && (
            <form
              onSubmit={handleSubmitLink}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setLinkUrl('')
                    setLinkInputOpen(false)
                  }
                }}
                placeholder="https://…"
                autoFocus
                disabled={linkLoading}
                style={{
                  fontSize: 12,
                  padding: '3px 8px',
                  width: 240,
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--blue, #3B82F6)',
                  borderRadius: 4,
                  color: 'var(--txt)',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={linkLoading || !linkUrl.trim()}
                style={{
                  padding: '3px 8px',
                  background: 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: linkLoading ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: !linkUrl.trim() ? 0.5 : 1,
                }}
                title="Ajouter (Entrée)"
              >
                {linkLoading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Check size={12} />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setLinkUrl('')
                  setLinkInputOpen(false)
                }}
                disabled={linkLoading}
                style={{
                  padding: 3,
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--txt-3)',
                  cursor: 'pointer',
                }}
                title="Annuler (Esc)"
              >
                <X size={12} />
              </button>
            </form>
          )}

          {addOpen && (
            <>
              <div
                onClick={() => setAddOpen(false)}
                style={{ position: 'fixed', inset: 0, zIndex: 10 }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  zIndex: 11,
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                  minWidth: 180,
                  padding: 4,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false)
                    setLinkInputOpen(true)
                  }}
                  style={menuItemStyle()}
                >
                  <LinkIcon size={12} style={{ marginRight: 6 }} />
                  Coller un lien
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={menuItemStyle()}
                >
                  <Upload size={12} style={{ marginRight: 6 }} />
                  Uploader image / vidéo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAddOpen(false)
                    onAddNote?.()
                  }}
                  style={menuItemStyle()}
                >
                  <StickyNote size={12} style={{ marginRight: 6 }} />
                  Note
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {canEdit && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              padding: 4,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="Actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{
                  position: 'fixed',
                  inset: 0,
                  zIndex: 10,
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  zIndex: 11,
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  borderRadius: 6,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                  minWidth: 160,
                  padding: 4,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    setEditing(true)
                  }}
                  style={menuItemStyle()}
                >
                  Renommer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete?.()
                  }}
                  style={{
                    ...menuItemStyle(),
                    color: '#EF4444',
                  }}
                >
                  <Trash2 size={12} style={{ marginRight: 4 }} />
                  Supprimer
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function menuItemStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    padding: '6px 10px',
    background: 'transparent',
    border: 'none',
    color: 'var(--txt-2)',
    fontSize: 12,
    textAlign: 'left',
    borderRadius: 4,
    cursor: 'pointer',
  }
}


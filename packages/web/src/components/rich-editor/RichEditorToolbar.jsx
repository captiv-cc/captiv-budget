// ════════════════════════════════════════════════════════════════════════════
// RichEditorToolbar — Barre d'outils du RichEditor (B/I/listes/lien/etc.)
// ════════════════════════════════════════════════════════════════════════════
//
// Utilise les commandes Tiptap (editor.chain().focus().X.run()) pour
// transformer la sélection courante. Chaque bouton est actif si la sélection
// porte la mark/node correspondante (editor.isActive('bold') etc.) — feedback
// visuel pris en charge par RichEditor.css (.is-active).
//
// Boutons :
//   B  I  S | H1 H2 H3 | • 1. > <> ↪ | ⌫⏎
//
// Le bouton lien ouvre un mini-popover inline (LinkPopover ci-dessous) qui
// remplace l'ancien window.prompt natif. Style cohérent avec le thème DESK.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react'
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Undo,
  Redo,
  Check,
  X,
} from 'lucide-react'

function Btn({ active, disabled, onClick, title, children, btnRef }) {
  return (
    <button
      type="button"
      ref={btnRef}
      className={`rich-editor-toolbar-button${active ? ' is-active' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      // mousedown.preventDefault() évite la perte de sélection au click
      onMouseDown={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="rich-editor-toolbar-sep" />
}

// ─── LinkPopover — Popover inline pour ajouter/éditer/retirer un lien ────
function LinkPopover({ initialUrl, onApply, onRemove, onCancel }) {
  const [url, setUrl] = useState(initialUrl || '')
  const inputRef = useRef(null)

  useEffect(() => {
    // Focus + sélection au mount pour une saisie immédiate
    if (inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [])

  const handleKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = url.trim()
      if (!trimmed) onRemove()
      else onApply(trimmed)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  // Bloque la propagation des clics dans le popover pour ne pas déclencher
  // le close au mousedown qui écoute en dehors.
  const stop = (e) => e.stopPropagation()

  return (
    <div
      className="rich-editor-link-popover"
      onMouseDown={stop}
      onClick={stop}
      role="dialog"
      aria-label="Insérer un lien"
    >
      <input
        ref={inputRef}
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={handleKey}
        placeholder="https://…"
        className="rich-editor-link-input"
        spellCheck={false}
        autoComplete="off"
      />
      <div className="rich-editor-link-actions">
        {initialUrl && (
          <button
            type="button"
            onClick={onRemove}
            className="rich-editor-link-btn is-danger"
            title="Retirer le lien"
          >
            Retirer
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="rich-editor-link-btn"
          title="Annuler (Esc)"
        >
          <X size={12} />
        </button>
        <button
          type="button"
          onClick={() => {
            const trimmed = url.trim()
            if (!trimmed) onRemove()
            else onApply(trimmed)
          }}
          className="rich-editor-link-btn is-primary"
          title="Appliquer (Entrée)"
        >
          <Check size={12} />
        </button>
      </div>
    </div>
  )
}

export default function RichEditorToolbar({ editor }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const linkBtnRef = useRef(null)
  const popoverWrapRef = useRef(null)

  // Ferme le popover si clic ailleurs (hors du popover + hors du bouton lien).
  useEffect(() => {
    if (!linkOpen) return undefined
    function onDocMouseDown(e) {
      if (popoverWrapRef.current?.contains(e.target)) return
      if (linkBtnRef.current?.contains(e.target)) return
      setLinkOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [linkOpen])

  if (!editor) return null

  const currentLinkUrl = editor.getAttributes('link').href || ''

  const applyLink = (url) => {
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run()
    setLinkOpen(false)
  }
  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkOpen(false)
  }

  return (
    <div className="rich-editor-toolbar" role="toolbar" aria-label="Mise en forme">
      <Btn
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
        title="Gras (Cmd+B)"
      >
        <Bold size={14} />
      </Btn>
      <Btn
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        title="Italique (Cmd+I)"
      >
        <Italic size={14} />
      </Btn>
      <Btn
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        title="Barré"
      >
        <Strikethrough size={14} />
      </Btn>

      <Sep />

      <Btn
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Titre 1"
      >
        <Heading1 size={14} />
      </Btn>
      <Btn
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Titre 2"
      >
        <Heading2 size={14} />
      </Btn>
      <Btn
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Titre 3"
      >
        <Heading3 size={14} />
      </Btn>

      <Sep />

      <Btn
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        title="Liste à puces"
      >
        <List size={14} />
      </Btn>
      <Btn
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        title="Liste numérotée"
      >
        <ListOrdered size={14} />
      </Btn>
      <Btn
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        title="Citation"
      >
        <Quote size={14} />
      </Btn>
      <Btn
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        title="Bloc de code"
      >
        <Code size={14} />
      </Btn>

      {/* Lien avec popover inline */}
      <div className="rich-editor-link-wrap" ref={popoverWrapRef}>
        <Btn
          btnRef={linkBtnRef}
          active={editor.isActive('link') || linkOpen}
          onClick={() => setLinkOpen((v) => !v)}
          title="Lien (URL)"
        >
          <LinkIcon size={14} />
        </Btn>
        {linkOpen && (
          <LinkPopover
            initialUrl={currentLinkUrl}
            onApply={applyLink}
            onRemove={removeLink}
            onCancel={() => setLinkOpen(false)}
          />
        )}
      </div>

      <Sep />

      <Btn
        disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
        title="Annuler (Cmd+Z)"
      >
        <Undo size={14} />
      </Btn>
      <Btn
        disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
        title="Rétablir (Cmd+Shift+Z)"
      >
        <Redo size={14} />
      </Btn>
    </div>
  )
}

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
// Le bouton lien utilise window.prompt() pour la V1 — simple et efficace.
// V2 (CHANTIER_NOTES_DOCS) : popover inline avec preview + bouton retirer.
// ════════════════════════════════════════════════════════════════════════════

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
} from 'lucide-react'

function Btn({ active, disabled, onClick, title, children }) {
  return (
    <button
      type="button"
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

export default function RichEditorToolbar({ editor }) {
  if (!editor) return null

  // Action "lien" : si on a déjà un lien actif, on précharge l'URL pour
  // édition ; sinon on demande une URL fraîche. URL vide → retire le lien.
  const promptLink = () => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt(
      'URL du lien (laisser vide pour retirer)',
      previousUrl || 'https://',
    )
    if (url === null) return // annulé
    if (url === '' || url === 'https://') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: url })
      .run()
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
      <Btn
        active={editor.isActive('link')}
        onClick={promptLink}
        title="Lien (URL)"
      >
        <LinkIcon size={14} />
      </Btn>

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

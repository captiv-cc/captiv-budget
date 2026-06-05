// ════════════════════════════════════════════════════════════════════════════
// RichEditor — Éditeur de texte riche réutilisable basé sur Tiptap
// ════════════════════════════════════════════════════════════════════════════
//
// Composant universel pour toute zone de saisie de texte riche dans DESK :
// notes de créneaux (FEST-2), descriptions de devis, briefs de production,
// futurs documents partagés (CHANTIER_NOTES_DOCS).
//
// Stockage : JSON ProseMirror (Tiptap natif, format compatible Y.js pour
// collab temps réel future).
//
// Props :
//   - value          : doc ProseMirror (objet JSON) — ou null/undefined
//   - onChange(json) : appelé à chaque modif (caller peut debounce si besoin)
//   - placeholder    : texte affiché si vide (défaut : "Notes…")
//   - readOnly       : true → mode lecture seule (pas de toolbar)
//   - autoFocus      : focus à la fin du contenu au mount
//   - minHeight      : hauteur min en px de la zone d'édition (défaut 80)
//   - className      : classes additionnelles sur le wrapper
//   - collaboration  : (FEST-2.6) { provider, doc, user } pour activer Y.js
//                       — quand fourni, désactive l'history StarterKit (Y.js
//                       gère l'undo/redo) et injecte les extensions Collab.
//                       Pour l'instant accepté mais non utilisé : juste la
//                       prop est en place pour câbler FEST-2.5/2.6 sans
//                       breaking change.
//
// Usage minimal :
//   <RichEditor value={notes} onChange={setNotes} placeholder="Notes du créneau…" />
//
// Usage lecture seule (vue cadreur, share) :
//   <RichEditor value={notes} readOnly />
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import RichEditorToolbar from './RichEditorToolbar'
import { EMPTY_DOC, docsEqual } from './utils'
import './RichEditor.css'

export default function RichEditor({
  value,
  onChange,
  placeholder = 'Notes…',
  readOnly = false,
  autoFocus = false,
  minHeight = 80,
  className = '',
  collaboration = null,
}) {
  const [isFocused, setIsFocused] = useState(false)
  // Ref vers le dernier doc émis par l'éditeur lui-même — sert à éviter de
  // re-set le content quand value re-arrive identique depuis le parent (qui
  // refait un re-render après l'onChange).
  const lastEmittedRef = useRef(null)

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Si on est en mode collab Y.js, on désactive l'historique local
          // (Y.js fournit son propre undo/redo cross-clients via le doc CRDT).
          history: collaboration ? false : { depth: 100 },
        }),
        Placeholder.configure({
          placeholder,
          emptyEditorClass: 'is-editor-empty',
        }),
        Link.configure({
          openOnClick: readOnly,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            rel: 'noopener noreferrer nofollow',
            target: '_blank',
          },
        }),
        // ▶︎ FEST-2.6 : @tiptap/extension-collaboration et
        //               @tiptap/extension-collaboration-cursor seront
        //               injectés ici si `collaboration` est fourni.
      ],
      content: value || EMPTY_DOC,
      editable: !readOnly,
      autofocus: autoFocus ? 'end' : false,
      onUpdate: ({ editor: ed }) => {
        const json = ed.getJSON()
        lastEmittedRef.current = json
        if (typeof onChange === 'function') onChange(json)
      },
      onFocus: () => setIsFocused(true),
      onBlur: () => setIsFocused(false),
      editorProps: {
        attributes: {
          class: 'rich-editor-content',
          style: `min-height: ${minHeight}px;`,
        },
      },
    },
    // Dépendances de re-création de l'éditeur. On NE met PAS `value` ici
    // pour éviter un re-mount à chaque saisie (qui flush le curseur). Le
    // sync de value est fait via useEffect ci-dessous (commands.setContent).
    [readOnly, placeholder, minHeight, collaboration],
  )

  // ─── Sync externe : value (parent) → editor ───────────────────────────
  // Si le parent change `value` à un autre doc que ce que l'éditeur a
  // émis, on met à jour le contenu. Cas d'usage : reload depuis BDD,
  // reset après navigation, undo externe.
  useEffect(() => {
    if (!editor || collaboration) return
    const current = editor.getJSON()
    const incoming = value || EMPTY_DOC
    // 1. Si c'est ce qu'on vient nous-même d'émettre → skip
    if (lastEmittedRef.current && docsEqual(lastEmittedRef.current, incoming)) {
      return
    }
    // 2. Si déjà identique au state interne → skip
    if (docsEqual(current, incoming)) return
    // 3. Sinon on remplace (false = pas d'event onUpdate)
    editor.commands.setContent(incoming, false)
  }, [value, editor, collaboration])

  // ─── Sync readOnly toggle ──────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    if (editor.isEditable === !readOnly) return
    editor.setEditable(!readOnly)
  }, [readOnly, editor])

  if (!editor) return null

  const wrapperClass = [
    'rich-editor',
    readOnly ? 'is-readonly' : '',
    isFocused ? 'is-focused' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={wrapperClass}>
      {!readOnly && <RichEditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}


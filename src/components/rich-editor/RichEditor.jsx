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
//   - value          : doc ProseMirror (objet JSON) — ou null/undefined.
//                       IGNORÉ si collaboration est fourni (Y.Doc est la source
//                       de vérité dans ce cas).
//   - onChange(json) : appelé à chaque modif (caller peut debounce si besoin).
//                       En mode collab, appelé aussi pour les updates remote
//                       arrivés via Y.js → permet au caller de snapshoter en BDD.
//   - placeholder    : texte affiché si vide (défaut : "Notes…")
//   - readOnly       : true → mode lecture seule (pas de toolbar)
//   - autoFocus      : focus à la fin du contenu au mount
//   - minHeight      : hauteur min en px de la zone d'édition (défaut 80)
//   - className      : classes additionnelles sur le wrapper
//   - collaboration  : { doc, awareness, user } pour activer Y.js (FEST-2.5).
//                       - doc        : instance Y.Doc partagée (from useYjsCollab)
//                       - awareness  : instance Y.Awareness (curseurs colorés)
//                       - user       : { name, color, user_id } meta locale
//                       Quand fourni :
//                       - StarterKit.history est désactivé (Y.js gère undo)
//                       - Extension Collaboration branchée sur le Y.Doc
//                       - Extension CollaborationCursor branchée sur awareness
//                       - La prop `value` est ignorée (le caller doit pré-remplir
//                         le Y.Doc avec son contenu initial si besoin)
//
// Usage minimal :
//   <RichEditor value={notes} onChange={setNotes} placeholder="Notes du créneau…" />
//
// Usage lecture seule (vue cadreur, share) :
//   <RichEditor value={notes} readOnly />
//
// Usage avec collab Y.js (FEST-2.5) :
//   const { doc, awareness, myUserMeta } = useYjsCollab({ docId, scope: 'deroule-creneau' })
//   <RichEditor
//     collaboration={{ doc, awareness, user: myUserMeta }}
//     onChange={(json) => debouncedSaveNotes(json)}
//   />
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
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

  // Extensions Y.js conditionnelles (FEST-2.5). Si `collaboration` est
  // fourni, on les ajoute APRÈS le StarterKit (qui aura history désactivé).
  const collabExtensions = collaboration?.doc
    ? [
        Collaboration.configure({ document: collaboration.doc }),
        ...(collaboration.awareness
          ? [
              CollaborationCursor.configure({
                provider: { awareness: collaboration.awareness },
                user: collaboration.user || { name: 'Inconnu', color: '#666' },
              }),
            ]
          : []),
      ]
    : []

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
        ...collabExtensions,
      ],
      // En mode collab, on ne fournit PAS de `content` initial : c'est le
      // Y.Doc (déjà rempli par le caller au mount) qui détermine le contenu.
      // Fournir un content ici écraserait potentiellement les modifs des
      // autres clients déjà reçus via sync-request.
      content: collaboration ? undefined : value || EMPTY_DOC,
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
    // Pour `collaboration`, on dépend uniquement de l'identité du Y.Doc et
    // de l'awareness (objets stables tant que useYjsCollab ne re-mount pas),
    // pas du wrapper `collaboration` lui-même qui peut être recréé à chaque
    // render du parent.
    [
      readOnly,
      placeholder,
      minHeight,
      collaboration?.doc,
      collaboration?.awareness,
    ],
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


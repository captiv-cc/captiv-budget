// ════════════════════════════════════════════════════════════════════════════
// rich-editor/utils — Helpers purs sur les docs ProseMirror
// ════════════════════════════════════════════════════════════════════════════
//
// Séparés du composant RichEditor pour préserver le fast-refresh React (un
// fichier composant ne doit exporter que des composants).
//
// Indépendant de Tiptap : ces helpers manipulent uniquement la structure
// JSON ProseMirror, donc utilisables côté serveur (PDF export, etc.) sans
// charger le runtime éditeur.
// ════════════════════════════════════════════════════════════════════════════

// Document vide canonical : un paragraphe vierge. Équivalent à ce que Tiptap
// produit pour un éditeur sans contenu.
export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

// Compare deux docs ProseMirror via sérialisation. Suffisant pour les
// chemins critiques (éviter setContent inutile en boucle). Pour comparaison
// sémantique fine (anchor field "notes"), utiliser plutôt
// canonicalJsonStringify de derouleSoftLinks.
export function docsEqual(a, b) {
  return JSON.stringify(a || EMPTY_DOC) === JSON.stringify(b || EMPTY_DOC)
}

// Vrai si le doc ne contient aucun caractère visible. Utilisé par les
// consommateurs pour décider s'ils stockent NULL en BDD (économie place +
// distinction "vide" vs "rempli puis effacé").
//
// Considère vide : null/undefined, doc sans content, doc avec uniquement
// des paragraphes vides ou contenant uniquement des whitespace.
// Considère NON vide : tout autre node (heading, liste, blockquote, image,
// même vide → présence intentionnelle de structure).
export function isDocEmpty(doc) {
  if (!doc || typeof doc !== 'object') return true
  if (!Array.isArray(doc.content)) return true

  for (const node of doc.content) {
    if (!node) continue
    if (node.type !== 'paragraph') return false
    if (Array.isArray(node.content)) {
      for (const inline of node.content) {
        if (
          inline &&
          inline.type === 'text' &&
          typeof inline.text === 'string' &&
          inline.text.trim().length > 0
        ) {
          return false
        }
        if (inline && inline.type !== 'text') return false
      }
    }
  }
  return true
}

// Extrait le texte brut d'un doc ProseMirror (pour preview/recherche/PDF).
// Concatène tous les nœuds text avec un retour à la ligne entre les blocs.
// Ignore le formatage (gras, italique, etc.). Limit safe en bytes via slice.
export function extractPlainText(doc, { maxLen = 5000 } = {}) {
  if (!doc) return ''
  const parts = []

  const blockTypes = new Set([
    'paragraph',
    'heading',
    'listItem',
    'blockquote',
    'codeBlock',
  ])
  function walk(node) {
    if (!node) return
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text)
      return
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) walk(child)
    }
    // Saut de ligne entre blocs (paragraphes, headings, items, etc.)
    // Ajouté même si le bloc est VIDE (sans content) — un paragraphe vide
    // est une ligne blanche dans le texte. Indispensable pour préserver
    // les sauts visuels (ex: A / vide / vide / B → "A\n\n\nB" puis
    // compressé à "A\n\nB").
    if (blockTypes.has(node.type)) parts.push('\n')
  }
  walk(doc)

  const text = parts.join('').replace(/\n{3,}/g, '\n\n').trim()
  return text.length > maxLen ? text.slice(0, maxLen) + '…' : text
}

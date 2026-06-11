// ════════════════════════════════════════════════════════════════════════════
// creneauVisual — état visuel d'un créneau (fait / annulé / passé / en cours)
// ════════════════════════════════════════════════════════════════════════════
//
// Centralise la logique d'atténuation pour Mes créneaux + Timeline :
// - annulé  → très atténué + barré
// - fait    → atténué + coche
// - passé   → atténué (focus présent/futur)
// - en cours→ accent
//
// ════════════════════════════════════════════════════════════════════════════

function toMs(end) {
  if (!end) return null
  if (end instanceof Date) return end.getTime()
  if (typeof end === 'string') {
    const t = new Date(end).getTime()
    return Number.isNaN(t) ? null : t
  }
  return null
}

export function creneauVisual({ statut, end }) {
  const endMs = toMs(end)
  const now = new Date().getTime()
  const past = endMs != null && endMs < now
  const done = statut === 'fait'
  const cancelled = statut === 'annule'
  const enCours = statut === 'en_cours'

  let opacity = 1
  if (cancelled) opacity = 0.38
  else if (done) opacity = 0.5
  else if (past) opacity = 0.5

  return { past, done, cancelled, enCours, opacity }
}

/**
 * Extrait le texte d'un doc rich-text (JSON tiptap/prosemirror) :
 * { type, content:[...], text }. Ajoute un saut de ligne après les blocs.
 */
function extractDocText(node) {
  if (!node) return ''
  if (Array.isArray(node)) return node.map(extractDocText).join('')
  if (typeof node === 'string') return node
  let out = ''
  if (typeof node.text === 'string') out += node.text
  if (node.content) out += extractDocText(node.content)
  if (node.type && ['paragraph', 'heading', 'listItem', 'blockquote'].includes(node.type)) {
    out += '\n'
  }
  return out
}

/** Rend un texte de notes en plat sur mobile (HTML string OU doc rich-text JSON). */
export function stripHtml(html) {
  if (!html) return ''
  // Notes stockées en doc rich-text (objet) → extraction du texte.
  if (typeof html !== 'string') {
    return extractDocText(html).replace(/\n{3,}/g, '\n\n').trim()
  }
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

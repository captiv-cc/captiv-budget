// ════════════════════════════════════════════════════════════════════════════
// HubShareNotice — Bloc "Note à l'équipe" affiché en haut du hub portail
// ════════════════════════════════════════════════════════════════════════════
//
// Rendu d'un texte libre markdown léger (gras, italique, listes, liens, lignes
// vides → paragraphes). Pas de dépendance externe — mini-parser maison qui
// gère un sous-ensemble suffisant pour la V0.
//
// Format supporté :
//   **gras**          → <strong>gras</strong>
//   *italique*        → <em>italique</em>
//   [texte](url)      → <a href="url" target="_blank">texte</a>
//   - élément         → <li> dans <ul>
//   ligne vide        → nouveau paragraphe
//   retour à la ligne → conservé via white-space: pre-wrap
//
// Sécurité : on n'injecte JAMAIS de HTML brut. Tout passe par React (text nodes
// + JSX), donc aucun XSS possible même si un destinataire bricole le payload.
// Les URLs des liens sont filtrées : seuls http:, https: et mailto: passent.
// ════════════════════════════════════════════════════════════════════════════

import { Megaphone } from 'lucide-react'

export default function HubShareNotice({ text }) {
  if (!text || !text.trim()) return null

  const blocks = parseMarkdownBlocks(text)

  return (
    <div
      className="mb-5 rounded-xl p-4"
      style={{
        background: 'var(--accent-bg)',
        border: '1px solid var(--accent)',
        // Léger inner highlight pour mettre en valeur sans agresser.
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'var(--bg-surf)' }}
        >
          <Megaphone className="w-4 h-4" style={{ color: 'var(--accent)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="text-[10px] font-bold uppercase tracking-widest mb-1.5"
            style={{ color: 'var(--accent)' }}
          >
            Note à l&apos;équipe
          </h3>
          <div
            className="text-sm leading-relaxed space-y-2"
            style={{ color: 'var(--txt)' }}
          >
            {blocks.map((block, idx) => renderBlock(block, idx))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Mini parser markdown ──────────────────────────────────────────────────
//
// On découpe le texte en blocs séparés par les lignes vides. Chaque bloc est
// soit une liste (lignes qui commencent par `- `), soit un paragraphe.

function parseMarkdownBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let currentParaLines = []
  let currentListItems = []
  let inList = false

  function flushPara() {
    if (currentParaLines.length > 0) {
      blocks.push({ type: 'p', content: currentParaLines.join('\n') })
      currentParaLines = []
    }
  }
  function flushList() {
    if (currentListItems.length > 0) {
      blocks.push({ type: 'ul', items: currentListItems })
      currentListItems = []
    }
    inList = false
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    const isBlank = line.trim() === ''
    const listMatch = line.match(/^\s*[-*]\s+(.*)$/)

    if (isBlank) {
      flushPara()
      flushList()
      continue
    }
    if (listMatch) {
      flushPara()
      inList = true
      currentListItems.push(listMatch[1])
      continue
    }
    // Si on était dans une liste et qu'on tombe sur une ligne non-bullet
    // non-blank, on ferme la liste et on commence un para.
    if (inList) {
      flushList()
    }
    currentParaLines.push(line)
  }
  flushPara()
  flushList()

  return blocks
}

function renderBlock(block, key) {
  if (block.type === 'ul') {
    return (
      <ul key={key} className="list-disc list-outside pl-5 space-y-0.5">
        {block.items.map((item, i) => (
          <li key={i}>{renderInline(item)}</li>
        ))}
      </ul>
    )
  }
  return (
    <p key={key} className="whitespace-pre-wrap">
      {renderInline(block.content)}
    </p>
  )
}

// Parse les marqueurs inline d'un texte : **gras**, *italique*, [texte](url).
// Retourne un array de React nodes (strings + <strong>/<em>/<a>).
//
// Stratégie : pour chaque texte courant, on cherche le PREMIER marqueur en
// scannant un regex combiné, on push la partie avant en string, le marqueur
// en JSX, puis on récurse sur la suite. Simple et robuste pour ce périmètre
// (pas de markdown imbriqué).

const INLINE_RE = /(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(\[([^\]\n]+)\]\(([^)\n]+)\))/

function renderInline(text) {
  const result = []
  let remaining = text
  let safetyLimit = 200 // évite une boucle infinie si regex foireux

  while (remaining && safetyLimit-- > 0) {
    const m = remaining.match(INLINE_RE)
    if (!m) {
      result.push(remaining)
      break
    }
    if (m.index > 0) {
      result.push(remaining.slice(0, m.index))
    }
    if (m[1]) {
      // **gras**
      result.push(<strong key={result.length}>{m[2]}</strong>)
    } else if (m[3]) {
      // *italique*
      result.push(<em key={result.length}>{m[4]}</em>)
    } else if (m[5]) {
      // [texte](url)
      const linkText = m[6]
      const linkUrl = sanitizeUrl(m[7])
      if (linkUrl) {
        result.push(
          <a
            key={result.length}
            href={linkUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'underline' }}
          >
            {linkText}
          </a>,
        )
      } else {
        // URL invalide → on rend juste le texte brut sans lien
        result.push(linkText)
      }
    }
    remaining = remaining.slice(m.index + m[0].length)
  }
  return result
}

// Whitelist d'URL : seuls http:, https: et mailto: passent. Pour empêcher
// javascript: ou data: dans un éventuel payload malveillant. (Même si la
// page est read-only, on garde la défense en profondeur.)
function sanitizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^mailto:/i.test(trimmed)) return trimmed
  // URL sans schéma : on suppose https
  if (/^[\w-]+\.[\w-]+/.test(trimmed) && !trimmed.includes(' ')) {
    return `https://${trimmed}`
  }
  return null
}

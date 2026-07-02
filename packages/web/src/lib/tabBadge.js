// ════════════════════════════════════════════════════════════════════════════
// tabBadge — compteur de notifications non lues dans l'onglet navigateur
// ════════════════════════════════════════════════════════════════════════════
//
// Deux signaux : préfixe "(N) " dans document.title + pastille rouge dessinée
// sur le favicon (le favicon de l'app est un SVG inline 🎬, on régénère le
// même SVG avec un badge). Visible même quand l'utilisateur est sur un autre
// onglet. setTabBadge(0) restaure titre et favicon d'origine.
// ════════════════════════════════════════════════════════════════════════════

let baseTitle = null

export function setTabBadge(count) {
  // ── Titre ──────────────────────────────────────────────────────────────────
  if (baseTitle === null) {
    baseTitle = document.title.replace(/^\(\d+\+?\)\s/, '')
  }
  document.title = count > 0 ? `(${count > 99 ? '99+' : count}) ${baseTitle}` : baseTitle

  // ── Favicon ────────────────────────────────────────────────────────────────
  const link = document.querySelector("link[rel~='icon']")
  if (!link) return
  if (!link.dataset.originalHref) link.dataset.originalHref = link.href

  if (count > 0) {
    const label = count > 9 ? '9+' : String(count)
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
      `<text y='.9em' font-size='90'>🎬</text>` +
      `<circle cx='72' cy='72' r='27' fill='#ef4444'/>` +
      `<text x='72' y='83' font-size='36' font-weight='bold' fill='#fff' text-anchor='middle' font-family='sans-serif'>${label}</text>` +
      `</svg>`
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
  } else {
    link.href = link.dataset.originalHref
  }
}

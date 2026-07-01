// ════════════════════════════════════════════════════════════════════════════
// devisGridNav — navigation clavier verticale dans le tableau devis (UX-C)
// ════════════════════════════════════════════════════════════════════════════
//
// Les cellules éditables portent un attribut `data-col` (clé de colonne) et
// vivent dans des <tr> de ligne. Entrée fait descendre (Maj+Entrée remonte) sur
// la même colonne. On saute les lignes structurelles (en-tête de bloc, barre de
// recherche, footer) car elles n'ont pas d'élément `data-col` correspondant.
// ════════════════════════════════════════════════════════════════════════════

// Focalise la cellule de même colonne sur la ligne voisine (dir +1 = bas).
// Retourne true si une cible a été trouvée et focalisée.
export function focusSiblingRowCell(el, dir = 1) {
  if (!el) return false
  const col = el.getAttribute('data-col')
  const tr = el.closest('tr')
  if (!col || !tr) return false
  let row = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling
  while (row) {
    const target = row.querySelector(`[data-col="${col}"]`)
    if (target) {
      target.focus()
      if (typeof target.select === 'function') target.select()
      return true
    }
    row = dir > 0 ? row.nextElementSibling : row.previousElementSibling
  }
  return false
}

// Gestionnaire Entrée pour un <input> simple tagué data-col : descend/monte.
export function handleGridEnter(e) {
  if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return
  e.preventDefault()
  focusSiblingRowCell(e.currentTarget, e.shiftKey ? -1 : 1)
}

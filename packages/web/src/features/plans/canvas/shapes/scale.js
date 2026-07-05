// ════════════════════════════════════════════════════════════════════════════
// scale — helpers d'échelle des plans (mètres ↔ pixels canvas)
// ════════════════════════════════════════════════════════════════════════════
//
// L'échelle vit à deux endroits, toujours synchronisés par PlanEditor :
//   - plans_canvas.echelle_ratio (mètres par pixel canvas) : persistance ;
//   - meta.metersPerPx de la page tldraw : lisible par les shapes (cotations,
//     zones) et synchronisé en collab via le doc Yjs.
// ════════════════════════════════════════════════════════════════════════════

/** Formatage mètres : 2 décimales sous 10, 1 au-delà, sans zéros inutiles. */
export function fmtMeters(m) {
  const decimals = m < 10 ? 2 : 1
  return Number(m.toFixed(decimals)).toLocaleString('fr-FR')
}

/** metersPerPx de la page courante d'un editor (0 = échelle non définie). */
export function pageMetersPerPx(editor) {
  return Number(editor?.getCurrentPage()?.meta?.metersPerPx) || 0
}

/** Pose l'échelle sur la page courante (synchronisée via le doc). */
export function setPageMetersPerPx(editor, metersPerPx) {
  const page = editor.getCurrentPage()
  if (!page) return
  editor.updatePage({ id: page.id, meta: { ...page.meta, metersPerPx } })
}

// ════════════════════════════════════════════════════════════════════════════
// styles.js — styles de champ partagés par les modales Embauches
// ════════════════════════════════════════════════════════════════════════════
//
// Séparés de ui.jsx : un fichier qui exporte des composants ET des constantes
// casse le rafraîchissement à chaud de Vite.
// ════════════════════════════════════════════════════════════════════════════

export const inputStyle = {
  background: 'var(--bg-elev)',
  border: '1px solid var(--brd)',
  color: 'var(--txt)',
}

// SearchSelect rend un bouton en text-xs sur fond var(--bg) : sans ça, un
// sélecteur posé à côté d'un champ texte est plus petit et plus sombre que
// son voisin.
export const selectStyle = {
  background: 'var(--bg-elev)',
  fontSize: 14,
  paddingTop: 6,
  paddingBottom: 6,
  width: '100%',
}

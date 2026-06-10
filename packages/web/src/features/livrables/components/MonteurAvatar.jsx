// ════════════════════════════════════════════════════════════════════════════
// MonteurAvatar — pastille initiale colorée pour un monteur (texte libre)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche un disque coloré avec les initiales du monteur. La couleur est
// dérivée du hash du nom (`monteurAvatar` → palette MONTEUR_AVATAR_COLORS),
// donc stable cross-session/cross-row pour un même nom.
//
// Quand on branchera l'autocomplete profiles à un ticket dédié, on pourra
// ajouter une prop `profile` (avec photo URL) sans changer l'API ici.
//
// Props :
//   - name  : string|null (texte libre — assignee_external pour LIV-7 MVP)
//   - size  : 'sm' (20px) | 'md' (24px), défaut 'sm'
//
// Si `name` est vide → renvoie null (le parent gère le fallback).
// ════════════════════════════════════════════════════════════════════════════

import { monteurAvatar } from '../../../lib/livrablesHelpers'

export default function MonteurAvatar({ name, size = 'sm' }) {
  const data = monteurAvatar(name)
  if (!data) return null
  const dim = size === 'md' ? 24 : 20
  const fontSize = size === 'md' ? 10 : 9
  return (
    <span
      aria-hidden="true"
      title={name}
      className="inline-flex items-center justify-center rounded-full font-semibold shrink-0"
      style={{
        width: dim,
        height: dim,
        background: data.color,
        color: '#fff',
        fontSize,
        lineHeight: 1,
        letterSpacing: '0.02em',
      }}
    >
      {data.initials}
    </span>
  )
}

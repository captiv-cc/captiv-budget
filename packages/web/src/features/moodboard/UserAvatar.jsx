// ════════════════════════════════════════════════════════════════════════════
// UserAvatar — Mini avatar d'utilisateur (initiales + couleur déterministe)
// ════════════════════════════════════════════════════════════════════════════
//
// Réutilisable dans Moodboard (carte, drawer, commentaires, réactions).
// Pattern aligné sur ProposerAvatar de Musiques (à extraire en commun
// quand le besoin se confirme dans plusieurs modules).
//
// Props :
//   - user      : { full_name?, email?, avatar_url? } — user profile partiel
//   - size      : taille en px (défaut 22)
//   - title     : tooltip natif (par défaut "Nom")
//
// ════════════════════════════════════════════════════════════════════════════

const PALETTE = [
  { bg: '#FCD34D', fg: '#78350F' }, // amber
  { bg: '#93C5FD', fg: '#1E3A8A' }, // blue
  { bg: '#FDA4AF', fg: '#881337' }, // rose
  { bg: '#5EEAD4', fg: '#134E4A' }, // teal
  { bg: '#C4B5FD', fg: '#4338CA' }, // violet
  { bg: '#FDBA74', fg: '#7C2D12' }, // orange
  { bg: '#67E8F9', fg: '#155E75' }, // cyan
  { bg: '#A5B4FC', fg: '#3730A3' }, // indigo
  { bg: '#FCA5A5', fg: '#7F1D1D' }, // red
  { bg: '#D8B4FE', fg: '#581C87' }, // purple
]

function hashColorFromName(name) {
  let h = 0
  const s = name || '?'
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0
  }
  return PALETTE[h % PALETTE.length]
}

export function userDisplayName(user) {
  return (
    user?.full_name ||
    user?.email?.split('@')[0] ||
    'inconnu'
  )
}

export default function UserAvatar({ user, size = 22, title }) {
  const name = userDisplayName(user)
  const initials = (name.match(/[A-Za-zÀ-ÿ0-9]/g) || ['?'])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  const color = hashColorFromName(name)
  const tooltip = title || name

  // Image avatar si dispo, sinon fallback initiales colorées
  if (user?.avatar_url) {
    return (
      <img
        src={user.avatar_url}
        alt={name}
        title={tooltip}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
      />
    )
  }

  return (
    <div
      title={tooltip}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color.bg,
        color: color.fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(8, Math.round(size * 0.4)),
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  )
}

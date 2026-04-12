/**
 * ProjectAvatar — Visuel d'un projet (carré arrondi, taille configurable)
 *
 * Cascade de fallback :
 *   1) project.cover_url        (upload côté projet — bucket Supabase 'project-covers')
 *   2) project.clients.logo_url (logo client existant en base)
 *   3) Initiales du titre projet sur fond gradient déterministe (hash)
 *
 * Utilisé dans : ProjetTab (hero + uploader), Projets (liste), HomePage (cards).
 */
export default function ProjectAvatar({ project, size = 64, rounded = 'xl' }) {
  if (!project) return null

  const src = project.cover_url || project.clients?.logo_url || null
  const dim = { width: size, height: size }
  const radius =
    rounded === 'full' ? 'rounded-full' : rounded === 'lg' ? 'rounded-lg' : 'rounded-xl'

  if (src) {
    return (
      <img
        src={src}
        alt={project.title || 'Projet'}
        style={dim}
        className={`${radius} object-cover shrink-0 ring-1 ring-gray-100 bg-white`}
        onError={(e) => {
          e.currentTarget.style.display = 'none'
        }}
      />
    )
  }

  // Fallback : initiales sur fond coloré (hash déterministe sur le titre)
  const title = (project.title || '?').trim()
  const initials =
    title
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'

  const palette = [
    'from-blue-500 to-indigo-600',
    'from-purple-500 to-pink-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-red-600',
    'from-cyan-500 to-blue-600',
  ]
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0
  const grad = palette[Math.abs(h) % palette.length]

  // Taille de la typo proportionnelle à la taille de l'avatar
  const fontSize = Math.round(size * 0.34)

  return (
    <div
      style={{ ...dim, fontSize }}
      className={`${radius} bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold shrink-0 ring-1 ring-black/5 shadow-sm`}
    >
      {initials}
    </div>
  )
}

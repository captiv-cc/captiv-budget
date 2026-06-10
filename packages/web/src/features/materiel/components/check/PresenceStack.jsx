// ════════════════════════════════════════════════════════════════════════════
// PresenceStack — Pills empilées des utilisateurs connectés (MAT-10H)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche la liste des prénoms connectés à la checklist terrain, sous forme de
// petites pastilles colorées rondes (avatar texte). Le user courant est mis en
// évidence (outline blanche) pour lui montrer "c'est toi là".
//
// Layout :
//
//   ┌──────────────────────────────┐
//   │ (C)(L)(J) +2                 │
//   └──────────────────────────────┘
//
//   - 4 premiers prénoms en pills superposées (stack -ml-1.5)
//   - overflow : "+N" pour les suivants
//   - hover sur une pill → tooltip prénom complet
//
// Props :
//   - users        : Array<{ key, name, color, joinedAt }>
//   - currentKey   : string | null — key du client courant (pour outline)
//   - maxVisible   : number         — défaut 4
// ════════════════════════════════════════════════════════════════════════════

export default function PresenceStack({ users = [], currentKey = null, maxVisible = 4 }) {
  if (!users.length) return null

  const visible = users.slice(0, maxVisible)
  const overflow = users.length - visible.length

  return (
    <div className="flex items-center -space-x-1.5" role="group" aria-label="Personnes connectées">
      {visible.map((u) => {
        const isSelf = u.key === currentKey
        const initial = (u.name || '?').trim().charAt(0).toUpperCase()
        return (
          <div
            key={u.key}
            title={`${u.name}${isSelf ? ' (vous)' : ''} · connecté`}
            className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
            style={{
              background: u.color,
              color: '#0a0a0a',
              border: `2px solid ${isSelf ? 'var(--txt)' : 'var(--bg-surf)'}`,
              boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
              zIndex: visible.length - visible.indexOf(u),
            }}
          >
            {initial}
            {/* Petit dot vert pour marquer "live" (uniquement sur soi) */}
            {isSelf && (
              <span
                className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full"
                style={{
                  background: '#22c55e',
                  border: '1.5px solid var(--bg-surf)',
                }}
                aria-hidden
              />
            )}
          </div>
        )
      })}
      {overflow > 0 && (
        <div
          className="relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt-2)',
            border: '2px solid var(--bg-surf)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            zIndex: 0,
          }}
          title={users.slice(maxVisible).map((u) => u.name).join(', ')}
        >
          +{overflow}
        </div>
      )}
    </div>
  )
}

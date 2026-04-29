// ════════════════════════════════════════════════════════════════════════════
// MonteurInput — input texte + autocomplete profiles d'organisation (LIV-15)
// ════════════════════════════════════════════════════════════════════════════
//
// Permet de saisir un monteur de deux façons :
//   1. Pick d'un profil membre de l'org (`assignee_profile_id` set, external null)
//   2. Texte libre (`assignee_external` set, profile_id null)
//
// L'UX est pensée comme un combobox léger :
//   - Au focus → popover s'ouvre avec la liste des profils (filtrée si query)
//   - Click sur un profil → onCommit({ profileId, external: null })
//   - Tape texte qui ne match aucun profil + Enter / blur →
//        onCommit({ profileId: null, external: texte })
//   - Bouton "Effacer" dans le popover → onCommit({ profileId: null, external: null })
//
// On garde `value` interne pour permettre une frappe libre sans flicker, et on
// resync dès que le livrable upstream change (via `displayName` dérivé). Le
// commit ne se fait QUE :
//   - sur click profil (immediate)
//   - sur Enter / blur (texte libre)
// pas sur chaque keystroke (cohérent avec les autres champs inline).
//
// Props :
//   - profileId        : string|null — profile actuellement assigné
//   - external         : string|null — texte libre actuellement assigné
//   - profiles         : Array<{ id, full_name, email, avatar_url }>
//   - profilesById     : Map<id, profile> (lookup O(1))
//   - canEdit          : booléen
//   - onCommit         : ({ profileId, external }) => Promise|void
//   - placeholder      : string (défaut '—')
//   - className        : string optionnel (root `<div>`)
//   - inputClassName   : string optionnel (input)
//   - showAvatar       : booléen (défaut true)
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, X } from 'lucide-react'
import MonteurAvatar from './MonteurAvatar'
import PopoverFloat from './PopoverFloat'

export default function MonteurInput({
  profileId = null,
  external = null,
  profiles = [],
  profilesById = null,
  canEdit = true,
  onCommit,
  placeholder = '—',
  className = '',
  inputClassName = '',
  showAvatar = true,
}) {
  // Nom affiché : profile.full_name si profileId, sinon external (texte libre).
  const profile = useMemo(() => {
    if (!profileId) return null
    if (profilesById) return profilesById.get(profileId) || null
    return profiles.find((p) => p.id === profileId) || null
  }, [profileId, profiles, profilesById])

  const profileLabel = useMemo(() => {
    if (!profile) return ''
    return profile.full_name || profile.email || 'Membre'
  }, [profile])

  const displayName = profileId ? profileLabel : (external || '')

  // ─── État interne (édition) ─────────────────────────────────────────────
  const [query, setQuery] = useState(displayName)
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)

  // Resync si le parent change (optimistic update / refetch).
  useEffect(() => {
    setQuery(displayName)
  }, [displayName])

  // ─── Filtrage des suggestions ───────────────────────────────────────────
  const trimmedQuery = query.trim()
  const filteredProfiles = useMemo(() => {
    if (!profiles || profiles.length === 0) return []
    if (!trimmedQuery) return profiles
    const q = trimmedQuery.toLowerCase()
    return profiles.filter((p) => {
      const name = (p.full_name || '').toLowerCase()
      const email = (p.email || '').toLowerCase()
      return name.includes(q) || email.includes(q)
    })
  }, [profiles, trimmedQuery])

  // Indique si le texte actuel match exactement le label affiché (pas de
  // changement à committer).
  const isUnchanged = trimmedQuery === (displayName || '').trim()

  // ─── Handlers ───────────────────────────────────────────────────────────
  const handlePickProfile = useCallback(
    async (p) => {
      setOpen(false)
      if (!canEdit) return
      // Si déjà sélectionné et même profile → no-op
      if (profileId === p.id) {
        setQuery(profileLabel)
        return
      }
      try {
        await onCommit?.({ profileId: p.id, external: null })
      } catch {
        // Le notify est géré par le parent — on resync la query au cas où.
        setQuery(displayName)
      }
    },
    [canEdit, displayName, onCommit, profileId, profileLabel],
  )

  const handleCommitText = useCallback(async () => {
    if (!canEdit) return
    if (isUnchanged) return
    const next = trimmedQuery
    // Texte qui match exactement un profile name → on bascule sur ce profile
    // (pratique : tape "Hugo" puis Tab → on assigne le profile s'il existe).
    const exact = profiles.find(
      (p) => (p.full_name || '').toLowerCase() === next.toLowerCase(),
    )
    try {
      if (exact) {
        await onCommit?.({ profileId: exact.id, external: null })
      } else {
        await onCommit?.({ profileId: null, external: next || null })
      }
    } catch {
      setQuery(displayName)
    }
  }, [canEdit, displayName, isUnchanged, onCommit, profiles, trimmedQuery])

  const handleClear = useCallback(async () => {
    setOpen(false)
    if (!canEdit) return
    if (!profileId && !external) return
    try {
      await onCommit?.({ profileId: null, external: null })
    } catch {
      setQuery(displayName)
    }
  }, [canEdit, displayName, external, onCommit, profileId])

  // Avatar : on prend le nom affiché (profile.full_name ou external).
  const avatarName = displayName || null

  return (
    <div className={`flex items-center gap-1.5 min-w-0 ${className}`}>
      {showAvatar && <MonteurAvatar name={avatarName} size="sm" />}
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open && canEdit) setOpen(true)
        }}
        onFocus={() => {
          if (canEdit) setOpen(true)
        }}
        onBlur={() => {
          // Délai pour laisser le click profile passer avant de committer.
          // PopoverFloat a son propre click-outside, mais on doit committer le
          // texte si l'utilisateur cliquait ailleurs (hors popover).
          setTimeout(() => {
            handleCommitText()
          }, 120)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setQuery(displayName)
            setOpen(false)
            e.currentTarget.blur()
          }
        }}
        disabled={!canEdit}
        placeholder={placeholder}
        className={`flex-1 min-w-0 bg-transparent focus:outline-none text-xs ${inputClassName}`}
        style={{ color: 'var(--txt-2)' }}
      />
      <PopoverFloat
        anchorRef={inputRef}
        open={open && canEdit}
        onClose={() => setOpen(false)}
        align="left"
      >
        <SuggestionsPanel
          profiles={filteredProfiles}
          activeProfileId={profileId}
          query={trimmedQuery}
          hasAssignment={Boolean(profileId || external)}
          onPick={handlePickProfile}
          onClear={handleClear}
        />
      </PopoverFloat>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SuggestionsPanel — liste des profils filtrés + actions
// ════════════════════════════════════════════════════════════════════════════

function SuggestionsPanel({
  profiles,
  activeProfileId,
  query,
  hasAssignment,
  onPick,
  onClear,
}) {
  const empty = !profiles || profiles.length === 0
  return (
    <div
      className="rounded-lg shadow-lg overflow-hidden"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd)',
        minWidth: 240,
        maxHeight: 280,
        overflowY: 'auto',
      }}
    >
      {empty ? (
        <div
          className="px-3 py-3 text-xs italic text-center"
          style={{ color: 'var(--txt-3)' }}
        >
          {query
            ? `Aucun profil pour « ${query} » — sera enregistré comme texte libre.`
            : 'Aucun profil dans cette organisation.'}
        </div>
      ) : (
        profiles.map((p) => {
          const active = p.id === activeProfileId
          const label = p.full_name || p.email || 'Membre'
          return (
            <button
              key={p.id}
              type="button"
              // Ne PAS laisser le blur du parent passer avant le click :
              // mousedown préventif évite la "course" entre commit text et pick.
              onMouseDown={(e) => {
                e.preventDefault()
              }}
              onClick={() => onPick(p)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
              style={{
                background: active ? 'var(--bg-hov)' : 'transparent',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.background = 'var(--bg-hov)'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.background = 'transparent'
              }}
            >
              <MonteurAvatar name={label} size="sm" />
              <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--txt)' }}>
                {label}
              </span>
              {p.email && p.email !== label && (
                <span className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>
                  {p.email}
                </span>
              )}
              {active && (
                <Check className="w-3 h-3 shrink-0" style={{ color: 'var(--green)' }} />
              )}
            </button>
          )
        })
      )}
      {hasAssignment && (
        <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-[11px]"
            style={{ color: 'var(--red)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <X className="w-3 h-3" />
            Retirer le monteur
          </button>
        </div>
      )}
    </div>
  )
}

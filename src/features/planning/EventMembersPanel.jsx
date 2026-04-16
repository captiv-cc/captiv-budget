/**
 * EventMembersPanel — Gestion des membres convoqués sur un événement (PL-3).
 *
 * Deux origines possibles :
 *   - profils internes (table `profiles`, org scoped)
 *   - intervenants projet (table `crew_members`, projet scoped)
 *
 * Statut : pending | confirmed | declined | tentative (voir lib/planning).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserPlus, Minus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { notify } from '../../lib/notify'
import {
  addEventMember,
  updateEventMember,
  removeEventMember,
  EVENT_MEMBER_STATUS,
} from '../../lib/planning'

const STATUS_META = {
  pending:   { label: 'Invité',    color: 'var(--txt-3)' },
  confirmed: { label: 'Confirmé',  color: 'var(--green)' },
  declined:  { label: 'Décliné',   color: 'var(--red)' },
  tentative: { label: 'Incertain', color: 'var(--orange)' },
}

export default function EventMembersPanel({ eventId, projectId, members, onMutated }) {
  const [adding, setAdding] = useState(false)
  const [profiles, setProfiles] = useState([])
  const [crew, setCrew] = useState([])
  const [loadingChoices, setLoadingChoices] = useState(false)

  // ── IDs déjà convoqués pour éviter les doublons ──────────────────────────
  const takenProfileIds = useMemo(
    () => new Set((members || []).filter((m) => m.profile_id).map((m) => m.profile_id)),
    [members],
  )
  const takenCrewIds = useMemo(
    () => new Set((members || []).filter((m) => m.crew_member_id).map((m) => m.crew_member_id)),
    [members],
  )

  // ── Chargement des choix (profiles org + crew projet) à l'ouverture ──────
  const loadChoices = useCallback(async () => {
    setLoadingChoices(true)
    try {
      const [{ data: profs }, { data: cr }] = await Promise.all([
        supabase.from('profiles').select('id, full_name, role').order('full_name'),
        projectId
          ? supabase
              .from('crew_members')
              .select('id, person_name, crew_role, email, statut')
              .eq('project_id', projectId)
              .order('crew_role')
          : Promise.resolve({ data: [] }),
      ])
      setProfiles(profs || [])
      setCrew(cr || [])
    } catch (e) {
      console.error('[Members] load choices:', e)
      notify.error('Erreur de chargement des contacts')
    } finally {
      setLoadingChoices(false)
    }
  }, [projectId])

  useEffect(() => {
    if (adding) loadChoices()
  }, [adding, loadChoices])

  // ── Actions ──────────────────────────────────────────────────────────────
  async function handleAddProfile(profile, roleLabel) {
    try {
      await addEventMember(eventId, {
        profileId: profile.id,
        role: roleLabel || profile.role || null,
        status: 'pending',
      })
      notify.success('Membre ajouté')
      setAdding(false)
      onMutated && onMutated()
    } catch (e) {
      console.error(e)
      notify.error(e.message || "Erreur à l'ajout")
    }
  }

  async function handleAddCrew(crewMember) {
    try {
      await addEventMember(eventId, {
        crewMemberId: crewMember.id,
        role: crewMember.crew_role || null,
        status: 'pending',
      })
      notify.success('Intervenant ajouté')
      setAdding(false)
      onMutated && onMutated()
    } catch (e) {
      console.error(e)
      notify.error(e.message || "Erreur à l'ajout")
    }
  }

  async function handleStatusChange(memberId, nextStatus) {
    try {
      await updateEventMember(memberId, { status: nextStatus })
      onMutated && onMutated()
    } catch (e) {
      console.error(e)
      notify.error(e.message || 'Erreur mise à jour')
    }
  }

  async function handleRemove(memberId) {
    try {
      await removeEventMember(memberId)
      notify.success('Retiré')
      onMutated && onMutated()
    } catch (e) {
      console.error(e)
      notify.error(e.message || 'Erreur suppression')
    }
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  const list = members || []

  return (
    <div className="flex flex-col gap-3">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: 'var(--txt-3)' }}>
          {list.length ? `${list.length} membre${list.length > 1 ? 's' : ''} convoqué${list.length > 1 ? 's' : ''}` : 'Aucun membre convoqué'}
        </div>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
            style={{
              background: 'var(--blue-bg)',
              color: 'var(--blue)',
              border: '1px solid var(--blue)',
            }}
          >
            <UserPlus className="w-3.5 h-3.5" />
            Ajouter
          </button>
        )}
      </div>

      {/* Liste des membres */}
      {list.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {list.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              onStatusChange={(next) => handleStatusChange(m.id, next)}
              onRemove={() => handleRemove(m.id)}
            />
          ))}
        </div>
      )}

      {/* Panneau d'ajout */}
      {adding && (
        <AddMemberPanel
          profiles={profiles.filter((p) => !takenProfileIds.has(p.id))}
          crew={crew.filter((c) => !takenCrewIds.has(c.id))}
          loading={loadingChoices}
          onCancel={() => setAdding(false)}
          onPickProfile={handleAddProfile}
          onPickCrew={handleAddCrew}
        />
      )}
    </div>
  )
}

/* ─── Row d'un membre ─────────────────────────────────────────────────────── */
function MemberRow({ member, onStatusChange, onRemove }) {
  const { profile, crew } = member
  const name = profile?.full_name || crew?.person_name || 'Sans nom'
  const email = crew?.email || null
  const subtitle = member.role || crew?.crew_role || null

  const meta = STATUS_META[member.status] || STATUS_META.pending

  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
    >
      {/* Avatar initiales */}
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
        style={{
          background: profile ? 'var(--blue-bg)' : 'var(--purple-bg)',
          color: profile ? 'var(--blue)' : 'var(--purple)',
        }}
      >
        {initials(name)}
      </div>

      {/* Nom + sous-titre */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate" style={{ color: 'var(--txt)' }}>
          {name}
          {!profile && (
            <span
              className="ml-1.5 text-[9px] px-1 py-0.5 rounded uppercase"
              style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
            >
              Externe
            </span>
          )}
        </div>
        {(subtitle || email) && (
          <div className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
            {subtitle}{subtitle && email ? ' · ' : ''}{email}
          </div>
        )}
      </div>

      {/* Statut — sélecteur */}
      <select
        value={member.status || 'pending'}
        onChange={(e) => onStatusChange(e.target.value)}
        className="text-[11px] rounded px-2 py-1"
        style={{
          background: 'var(--bg-surf)',
          color: meta.color,
          border: `1px solid ${meta.color}`,
        }}
        aria-label="Statut"
      >
        {Object.keys(EVENT_MEMBER_STATUS).map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s]?.label || s}
          </option>
        ))}
      </select>

      {/* Bouton retirer */}
      <button
        type="button"
        onClick={onRemove}
        aria-label="Retirer"
        className="w-6 h-6 rounded flex items-center justify-center"
        style={{ color: 'var(--txt-3)' }}
        title="Retirer"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

    </div>
  )
}

/* ─── Panneau ajout (profiles + crew) ─────────────────────────────────────── */
function AddMemberPanel({ profiles, crew, loading, onCancel, onPickProfile, onPickCrew }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const filteredProfiles = q
    ? profiles.filter((p) => (p.full_name || '').toLowerCase().includes(q))
    : profiles
  const filteredCrew = q
    ? crew.filter(
        (c) =>
          (c.person_name || '').toLowerCase().includes(q) ||
          (c.crew_role || '').toLowerCase().includes(q),
      )
    : crew

  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un membre…"
          className="flex-1 px-2.5 py-1.5 rounded text-xs"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            color: 'var(--txt)',
          }}
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] px-2 py-1 rounded"
          style={{ color: 'var(--txt-3)' }}
        >
          Annuler
        </button>
      </div>

      {loading && (
        <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      )}

      {!loading && filteredProfiles.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wide px-1" style={{ color: 'var(--txt-3)' }}>
            Équipe Captiv
          </div>
          {filteredProfiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPickProfile(p, null)}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition"
              style={{ background: 'var(--bg-surf)', color: 'var(--txt)' }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
              >
                {initials(p.full_name)}
              </div>
              <span className="flex-1">{p.full_name || 'Sans nom'}</span>
              {p.role && (
                <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                  {p.role}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!loading && filteredCrew.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] uppercase tracking-wide px-1" style={{ color: 'var(--txt-3)' }}>
            Intervenants projet
          </div>
          {filteredCrew.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onPickCrew(c)}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition"
              style={{ background: 'var(--bg-surf)', color: 'var(--txt)' }}
            >
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold"
                style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}
              >
                {initials(c.person_name || c.crew_role)}
              </div>
              <span className="flex-1">
                {c.person_name || <em style={{ color: 'var(--txt-3)' }}>(poste vacant)</em>}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                {c.crew_role}
              </span>
            </button>
          ))}
        </div>
      )}

      {!loading && !filteredProfiles.length && !filteredCrew.length && (
        <div className="text-[11px] py-2 text-center" style={{ color: 'var(--txt-3)' }}>
          Aucun contact disponible.
        </div>
      )}
    </div>
  )
}

function initials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

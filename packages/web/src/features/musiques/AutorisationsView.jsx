// ════════════════════════════════════════════════════════════════════════════
// AutorisationsView — suivi des autorisations par track × média (MUS-7 A2)
// ════════════════════════════════════════════════════════════════════════════
//
// Tableau calqué sur le tableur de suivi RP (V and B Fest' 2025) : groupé
// par média (livrable), 1 ligne par track avec statut d'autorisation,
// durée d'utilisation, contact label, doc signé, master et fil de
// commentaires. La row projet_musique_autorisations est créée à la volée
// au premier édit (ensureAutorisation).
//
// Entrent ici les tracks au moins « choisies » pour un média (statut_local
// choix/valide) — toggle pour inclure aussi les simples propositions.
//
// Le même modèle sera exposé aux RP du festival via lien token (A3).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Download,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react'
import {
  AUTOR_STATUTS,
  AUTOR_STATUT_LABELS,
  AUTOR_STATUT_COLORS,
  listAutorisationRows,
  ensureAutorisation,
  updateAutorisation,
  listAutorisationEvents,
  countCommentsByAutorisation,
  addAutorisationEvent,
  subscribeAutorisations,
} from '../../lib/musiqueAutorisations'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'

export default function AutorisationsView({
  projectId,
  canEdit = false,
  playingId = null,
  onTogglePlay,
}) {
  const { user } = useAuth() || {}
  const [rows, setRows] = useState([])
  const [commentCounts, setCommentCounts] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [includePropositions, setIncludePropositions] = useState(false)
  // Fil de commentaires ouvert (row du tableau)
  const [eventsFor, setEventsFor] = useState(null)

  const who = useMemo(
    () => ({ userId: user?.id || null, userName: user?.user_metadata?.full_name || null }),
    [user],
  )

  const reload = useCallback(async () => {
    if (!projectId) return
    try {
      const [data, counts] = await Promise.all([
        listAutorisationRows(projectId),
        countCommentsByAutorisation(projectId),
      ])
      setRows(data)
      setCommentCounts(counts)
    } catch (e) {
      console.error('[AutorisationsView] load', e)
      notify.error('Chargement des autorisations échoué')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    reload()
    const unsub = subscribeAutorisations(projectId, () => reload())
    return unsub
  }, [projectId, reload])

  // ── Groupes par média ────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const visible = rows.filter((r) =>
      includePropositions ? true : r.statut_local === 'choix' || r.statut_local === 'valide',
    )
    const byLivrable = new Map()
    for (const r of visible) {
      const key = r.livrable_id
      if (!byLivrable.has(key)) {
        byLivrable.set(key, { livrable: r.livrable, rows: [] })
      }
      byLivrable.get(key).rows.push(r)
    }
    const arr = Array.from(byLivrable.values())
    arr.sort((a, b) => (a.livrable?.nom || '').localeCompare(b.livrable?.nom || '', 'fr'))
    for (const g of arr) {
      g.rows.sort((a, b) =>
        credit(a.proposition).localeCompare(credit(b.proposition), 'fr', {
          sensitivity: 'base',
        }),
      )
    }
    return arr
  }, [rows, includePropositions])

  const stats = useMemo(() => {
    const s = { a_lancer: 0, envoyee: 0, accordee: 0, refusee: 0 }
    for (const g of groups) {
      for (const r of g.rows) {
        s[r.autorisation?.statut || 'a_lancer'] += 1
      }
    }
    return s
  }, [groups])

  // ── Patch (ensure + update) ──────────────────────────────────────────────
  const handlePatch = useCallback(
    async (row, patch) => {
      if (!canEdit) return
      try {
        const autor =
          row.autorisation || (await ensureAutorisation({ projectId, linkId: row.id }))
        await updateAutorisation(autor, patch, who)
        reload()
      } catch (e) {
        console.error('[AutorisationsView] patch', e)
        notify.error('Sauvegarde échouée : ' + (e?.message || e))
      }
    },
    [canEdit, projectId, who, reload],
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--blue)' }} />
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div
        className="rounded-xl p-8 text-center m-5"
        style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
      >
        <ShieldCheck className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)', opacity: 0.5 }} />
        <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
          Aucune track à autoriser.
        </p>
        <p className="text-xs mt-1.5" style={{ color: 'var(--txt-3)' }}>
          Les tracks choisies ou validées pour un média (vue Attribution) apparaissent ici.
        </p>
        {!includePropositions && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setIncludePropositions(true)}
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-md"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
          >
            Inclure les propositions ({rows.length})
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="px-5 pb-8 flex flex-col gap-4">
      {/* Barre : stats + toggle propositions */}
      <div className="flex items-center gap-3 flex-wrap pt-3">
        {AUTOR_STATUTS.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: AUTOR_STATUT_COLORS[s] }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: AUTOR_STATUT_COLORS[s] }}
            />
            {stats[s]} {AUTOR_STATUT_LABELS[s].toLowerCase()}
          </span>
        ))}
        <label
          className="ml-auto flex items-center gap-1.5 text-[11px] cursor-pointer select-none"
          style={{ color: 'var(--txt-3)' }}
        >
          <input
            type="checkbox"
            checked={includePropositions}
            onChange={(e) => setIncludePropositions(e.target.checked)}
          />
          Inclure les propositions non choisies
        </label>
      </div>

      {/* Groupes média */}
      {groups.map(({ livrable, rows: groupRows }) => (
        <section
          key={livrable?.id || 'none'}
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <header
            className="flex items-center gap-2 px-3 py-2"
            style={{ background: 'rgba(255,110,55,0.07)', borderBottom: '1px solid var(--brd-sub)' }}
          >
            <h3
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: '#FF6E37', letterSpacing: '0.08em' }}
            >
              {livrable?.nom || 'Média supprimé'}
            </h3>
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {groupRows.length} track{groupRows.length > 1 ? 's' : ''}
            </span>
          </header>

          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ minWidth: '900px' }}>
              <thead>
                <tr
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd-sub)' }}
                >
                  <th className="px-3 py-1.5 text-left font-bold">Track</th>
                  <th className="px-2 py-1.5 text-center font-bold">Jour</th>
                  <th className="px-2 py-1.5 text-left font-bold">Durée</th>
                  <th className="px-2 py-1.5 text-left font-bold">Autorisation</th>
                  <th className="px-2 py-1.5 text-left font-bold">Contact label</th>
                  <th className="px-2 py-1.5 text-center font-bold" title="Document signé reçu">
                    Doc
                  </th>
                  <th className="px-2 py-1.5 text-left font-bold" title="Lien de téléchargement de la musique en bonne qualité">
                    Master
                  </th>
                  <th className="px-2 py-1.5 text-center font-bold" title="Track utilisée dans le montage">
                    Utilisé
                  </th>
                  <th className="px-2 py-1.5 text-center font-bold">
                    <MessageCircle className="w-3 h-3 inline" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row) => (
                  <AutorRow
                    key={row.id}
                    row={row}
                    canEdit={canEdit}
                    commentCount={
                      row.autorisation ? commentCounts.get(row.autorisation.id) || 0 : 0
                    }
                    playingId={playingId}
                    onTogglePlay={onTogglePlay}
                    onPatch={(patch) => handlePatch(row, patch)}
                    onOpenEvents={async () => {
                      // Le fil nécessite une row (créée à la volée si besoin)
                      try {
                        const autor =
                          row.autorisation ||
                          (await ensureAutorisation({ projectId, linkId: row.id }))
                        setEventsFor({ row, autor })
                      } catch (e) {
                        notify.error('Ouverture du fil échouée : ' + (e?.message || e))
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {eventsFor && (
        <EventsPanel
          projectId={projectId}
          row={eventsFor.row}
          autor={eventsFor.autor}
          canEdit={canEdit}
          who={who}
          onClose={() => {
            setEventsFor(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function credit(p) {
  return p?.artiste_text || p?.artiste?.nom || '—'
}

const cellInput = {
  background: 'var(--bg)',
  border: '1px solid var(--brd-sub)',
  color: 'var(--txt)',
}

// ─── Ligne track ───────────────────────────────────────────────────────────

function AutorRow({ row, canEdit, commentCount, playingId, onTogglePlay, onPatch, onOpenEvents }) {
  const p = row.proposition
  const a = row.autorisation
  const statut = a?.statut || 'a_lancer'
  const isPlaying = playingId === p?.id

  return (
    <tr style={{ borderBottom: '1px solid var(--brd-sub)' }}>
      {/* Track : play + crédit · titre */}
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {p?.preview_url && onTogglePlay && (
            <button
              type="button"
              onClick={() => onTogglePlay(p)}
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,110,55,0.12)' }}
              title={isPlaying ? 'Pause' : 'Écouter le preview'}
            >
              {isPlaying ? (
                <Pause size={10} fill="#FF6E37" style={{ color: '#FF6E37' }} />
              ) : (
                <Play size={10} fill="#FF6E37" style={{ color: '#FF6E37', marginLeft: 1 }} />
              )}
            </button>
          )}
          <span className="truncate">
            <span className="font-semibold" style={{ color: 'var(--txt)' }}>
              {credit(p)}
            </span>{' '}
            <span style={{ color: 'var(--txt-2)' }}>· {p?.titre || '—'}</span>
          </span>
        </div>
      </td>

      {/* Jour (annuaire) */}
      <td className="px-2 py-1.5 text-center" style={{ color: 'var(--txt-3)' }}>
        {p?.artiste?.jour || ''}
      </td>

      {/* Durée d'utilisation */}
      <td className="px-2 py-1.5">
        <input
          type="text"
          defaultValue={a?.duree_utilisation || ''}
          disabled={!canEdit}
          placeholder="60s…"
          onBlur={(e) => {
            const v = e.target.value.trim() || null
            if (v !== (a?.duree_utilisation || null)) onPatch({ duree_utilisation: v })
          }}
          className="w-[80px] px-1.5 py-1 rounded outline-none text-xs"
          style={cellInput}
        />
      </td>

      {/* Statut autorisation */}
      <td className="px-2 py-1.5">
        <select
          value={statut}
          disabled={!canEdit}
          onChange={(e) => onPatch({ statut: e.target.value })}
          className="px-1.5 py-1 rounded outline-none text-xs font-semibold cursor-pointer"
          style={{
            background: `${AUTOR_STATUT_COLORS[statut]}1a`,
            color: AUTOR_STATUT_COLORS[statut],
            border: `1px solid ${AUTOR_STATUT_COLORS[statut]}55`,
          }}
          title={
            a?.envoyee_at
              ? `Envoyée le ${new Date(a.envoyee_at).toLocaleDateString('fr-FR')}`
              : undefined
          }
        >
          {AUTOR_STATUTS.map((s) => (
            <option key={s} value={s}>
              {AUTOR_STATUT_LABELS[s]}
            </option>
          ))}
        </select>
      </td>

      {/* Contact label */}
      <td className="px-2 py-1.5">
        <input
          type="text"
          defaultValue={a?.contact_label || ''}
          disabled={!canEdit}
          placeholder="email, contact…"
          onBlur={(e) => {
            const v = e.target.value.trim() || null
            if (v !== (a?.contact_label || null)) onPatch({ contact_label: v })
          }}
          className="w-[150px] px-1.5 py-1 rounded outline-none text-xs"
          style={cellInput}
        />
      </td>

      {/* Doc signé */}
      <td className="px-2 py-1.5 text-center">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onPatch({ doc_signe: !a?.doc_signe })}
          className="w-5 h-5 rounded inline-flex items-center justify-center"
          style={{
            background: a?.doc_signe ? 'rgba(34,197,94,0.15)' : 'var(--bg-elev)',
            border: `1px solid ${a?.doc_signe ? '#22c55e' : 'var(--brd)'}`,
            color: a?.doc_signe ? '#22c55e' : 'var(--txt-3)',
          }}
          title={a?.doc_signe ? 'Document signé reçu' : 'Pas de document signé'}
        >
          {a?.doc_signe ? <Check className="w-3 h-3" /> : <X className="w-2.5 h-2.5" style={{ opacity: 0.4 }} />}
        </button>
      </td>

      {/* Master */}
      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1">
          <input
            type="text"
            defaultValue={a?.master_url || ''}
            disabled={!canEdit}
            placeholder="Lien DL…"
            onBlur={(e) => {
              const v = e.target.value.trim() || null
              if (v !== (a?.master_url || null)) onPatch({ master_url: v })
            }}
            className="w-[120px] px-1.5 py-1 rounded outline-none text-xs"
            style={cellInput}
          />
          {a?.master_url && (
            <a
              href={a.master_url}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 p-1"
              style={{ color: 'var(--blue)' }}
              title="Ouvrir le master"
            >
              <Download className="w-3 h-3" />
            </a>
          )}
        </div>
      </td>

      {/* Utilisé */}
      <td className="px-2 py-1.5 text-center">
        <input
          type="checkbox"
          checked={Boolean(a?.utilise)}
          disabled={!canEdit}
          onChange={(e) => onPatch({ utilise: e.target.checked })}
          title="Track utilisée dans le montage"
        />
      </td>

      {/* Commentaires */}
      <td className="px-2 py-1.5 text-center">
        <button
          type="button"
          onClick={onOpenEvents}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{
            color: commentCount > 0 ? 'var(--blue)' : 'var(--txt-3)',
            background: commentCount > 0 ? 'var(--blue-bg)' : 'transparent',
          }}
          title="Commentaires & historique"
        >
          <MessageCircle className="w-3 h-3" />
          {commentCount > 0 && <span className="text-[10px] font-bold">{commentCount}</span>}
        </button>
      </td>
    </tr>
  )
}

// ─── Fil de commentaires + journal des statuts ─────────────────────────────

function EventsPanel({ projectId, row, autor, canEdit, who, onClose }) {
  const [events, setEvents] = useState(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    try {
      setEvents(await listAutorisationEvents(autor.id))
    } catch (e) {
      console.error('[EventsPanel] load', e)
      setEvents([])
    }
  }, [autor.id])

  useEffect(() => {
    load()
  }, [load])

  async function handlePost() {
    if (!body.trim() || posting) return
    setPosting(true)
    try {
      await addAutorisationEvent({
        projectId,
        autorisationId: autor.id,
        kind: 'comment',
        body,
        authorId: who.userId,
        authorName: who.userName,
      })
      setBody('')
      load()
    } catch (e) {
      notify.error('Envoi échoué : ' + (e?.message || e))
    } finally {
      setPosting(false)
    }
  }

  const p = row.proposition

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <header
          className="flex items-center gap-2.5 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <MessageCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
              {credit(p)} · {p?.titre}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {row.livrable?.nom} — commentaires &amp; historique
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {events === null ? (
            <Loader2 className="w-4 h-4 animate-spin mx-auto my-6" style={{ color: 'var(--txt-3)' }} />
          ) : events.length === 0 ? (
            <p className="text-xs text-center italic py-6" style={{ color: 'var(--txt-3)' }}>
              Aucun échange pour l&apos;instant.
            </p>
          ) : (
            events.map((e) => {
              const author = e.author?.full_name || e.author_name || 'Anonyme'
              const date = new Date(e.created_at).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              if (e.kind === 'statut') {
                return (
                  <p key={e.id} className="text-[10px] text-center" style={{ color: 'var(--txt-3)' }}>
                    {date} — {author} : statut →{' '}
                    <b style={{ color: AUTOR_STATUT_COLORS[e.body] || 'var(--txt-2)' }}>
                      {AUTOR_STATUT_LABELS[e.body] || e.body}
                    </b>
                  </p>
                )
              }
              return (
                <div
                  key={e.id}
                  className="rounded-lg px-3 py-2"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                >
                  <p className="text-[10px] mb-0.5" style={{ color: 'var(--txt-3)' }}>
                    <b style={{ color: 'var(--txt-2)' }}>{author}</b> · {date}
                  </p>
                  <p className="text-xs whitespace-pre-line" style={{ color: 'var(--txt)' }}>
                    {e.body}
                  </p>
                </div>
              )
            })
          )}
        </div>

        {canEdit && (
          <div
            className="flex items-center gap-2 px-4 py-3 shrink-0"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePost()}
              placeholder="Écrire un commentaire…"
              className="flex-1 text-xs px-2.5 py-2 rounded-md outline-none"
              style={cellInput}
            />
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !body.trim()}
              className="p-2 rounded-md disabled:opacity-40"
              style={{ background: 'var(--blue)', color: '#fff' }}
              title="Envoyer"
            >
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

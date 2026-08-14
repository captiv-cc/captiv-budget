// ════════════════════════════════════════════════════════════════════════════
// AutorisationsView — onglet interne du suivi des autorisations (MUS-7 A2)
// ════════════════════════════════════════════════════════════════════════════
//
// Orchestration desk : fetch RLS + patchs Supabase + realtime + modale de
// partage RP. Le rendu du tableau vit dans AutorisationsTable (partagé avec
// le portail public ShareMusiqueAutorSession).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Share2, ShieldCheck } from 'lucide-react'
import AutorisationsTable, {
  AutorSearchInput,
  AutorStatsBar,
  EventsPanel,
  computeAutorStats,
  groupAutorRows,
} from './AutorisationsTable'
import MusiqueAutorShareModal from './MusiqueAutorShareModal'
import {
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
  const [shareOpen, setShareOpen] = useState(false)
  // Fil ouvert : { row, autor, events } — events rechargés à l'ouverture
  const [eventsFor, setEventsFor] = useState(null)
  const [posting, setPosting] = useState(false)
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState(null)

  // Par défaut : TOUTES les tracks attribuées à un média. Option persistée
  // pour ne voir que les choisies/validées.
  const FILTER_KEY = `musiques.autorOnlyChoisies.${projectId || 'global'}`
  const [onlyChoisies, setOnlyChoisiesRaw] = useState(() => {
    try {
      return localStorage.getItem(FILTER_KEY) === '1'
    } catch {
      return false
    }
  })
  const setOnlyChoisies = (v) => {
    setOnlyChoisiesRaw(v)
    try {
      localStorage.setItem(FILTER_KEY, v ? '1' : '0')
    } catch {
      /* ignore */
    }
  }

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

  // Stats sur l'ensemble (hors filtre statut) — le tableau applique le filtre.
  const baseGroups = useMemo(
    () => groupAutorRows(rows, { onlyChoisies, search }),
    [rows, onlyChoisies, search],
  )
  const stats = useMemo(() => computeAutorStats(baseGroups), [baseGroups])
  const groups = useMemo(
    () => groupAutorRows(rows, { onlyChoisies, search, statutFilter }),
    [rows, onlyChoisies, search, statutFilter],
  )

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

  const handleOpenEvents = useCallback(
    async (row) => {
      try {
        const autor =
          row.autorisation || (await ensureAutorisation({ projectId, linkId: row.id }))
        setEventsFor({ row, autor, events: null })
        const events = await listAutorisationEvents(autor.id)
        setEventsFor((cur) => (cur?.autor.id === autor.id ? { ...cur, events } : cur))
      } catch (e) {
        notify.error('Ouverture du fil échouée : ' + (e?.message || e))
      }
    },
    [projectId],
  )

  async function handlePostComment(body) {
    if (!eventsFor) return false
    setPosting(true)
    try {
      await addAutorisationEvent({
        projectId,
        autorisationId: eventsFor.autor.id,
        kind: 'comment',
        body,
        authorId: who.userId,
        authorName: who.userName,
      })
      const events = await listAutorisationEvents(eventsFor.autor.id)
      setEventsFor((cur) => (cur ? { ...cur, events } : cur))
      return true
    } catch (e) {
      notify.error('Envoi échoué : ' + (e?.message || e))
      return false
    } finally {
      setPosting(false)
    }
  }

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
          Les tracks attribuées à un média (vue Attribution) apparaissent ici.
        </p>
        {onlyChoisies && rows.length > 0 && (
          <button
            type="button"
            onClick={() => setOnlyChoisies(false)}
            className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-md"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
          >
            Afficher toutes les tracks attribuées ({rows.length})
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="px-5 pb-8 flex flex-col gap-3">
      <div className="flex items-center gap-3 flex-wrap pt-3">
        <AutorStatsBar stats={stats} activeFilter={statutFilter} onFilter={setStatutFilter} />
        <span className="ml-auto flex items-center gap-3">
          <AutorSearchInput value={search} onChange={setSearch} />
          <label
            className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none"
            style={{ color: 'var(--txt-3)' }}
          >
            <input
              type="checkbox"
              checked={onlyChoisies}
              onChange={(e) => setOnlyChoisies(e.target.checked)}
            />
            Seulement les choisies / validées
          </label>
          {canEdit && (
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
              title="Générer un lien pour les chargés de comm / RP du festival"
            >
              <Share2 className="w-3.5 h-3.5" />
              Partager aux RP
            </button>
          )}
        </span>
      </div>

      <AutorisationsTable
        groups={groups}
        canEdit={canEdit}
        commentCounts={commentCounts}
        playingId={playingId}
        onTogglePlay={onTogglePlay}
        onPatch={handlePatch}
        onOpenEvents={handleOpenEvents}
        selfName={who.userName || ''}
      />

      {eventsFor && (
        <EventsPanel
          row={eventsFor.row}
          events={eventsFor.events}
          canEdit={canEdit}
          posting={posting}
          onPost={handlePostComment}
          onClose={() => {
            setEventsFor(null)
            reload()
          }}
        />
      )}

      {shareOpen && (
        <MusiqueAutorShareModal
          open={shareOpen}
          onClose={() => setShareOpen(false)}
          projectId={projectId}
        />
      )}
    </div>
  )
}

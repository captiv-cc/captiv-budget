// ════════════════════════════════════════════════════════════════════════════
// ShareMusiqueAutorSession — Portail RP autorisations /share/musiques-autor/:token
// ════════════════════════════════════════════════════════════════════════════
//
// Page publique SANS compte pour les chargés de comm / RP du festival :
// ils écoutent les previews, lancent les demandes d'autorisation, mettent à
// jour les statuts, contacts, docs signés, masters, et commentent. Toutes
// les écritures passent par des RPCs token (whitelist côté serveur) et sont
// signées par le prénom saisi à l'arrivée.
//
// Le tableau est AutorisationsTable — le même que l'onglet interne : les RP
// et l'équipe voient exactement la même chose, en temps quasi réel.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Loader2, Pencil, ShieldCheck } from 'lucide-react'
import AutorisationsTable, {
  AutorSearchInput,
  AutorStatsBar,
  EventsPanel,
  computeAutorStats,
  groupAutorRows,
} from '../features/musiques/AutorisationsTable'
import {
  fetchSharePayload,
  shareUpdateAutorisation,
  shareAddComment,
} from '../lib/musiqueAutorShare'
import { getPreviewVolume } from '../lib/previewVolume'
import PreviewVolumeControl from '../features/musiques/PreviewVolumeControl'
import { PROJECT_SHARE_THEME_KEY } from './ProjectShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import { notify } from '../lib/notify'

export default function ShareMusiqueAutorSession() {
  const { token } = useParams()
  const [payload, setPayload] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // Prénom du RP — signe toutes ses modifications. Persisté par token.
  const NAME_KEY = `musiqueAutor.name.${token}`
  const [rpName, setRpNameRaw] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) || ''
    } catch {
      return ''
    }
  })
  const [editingName, setEditingName] = useState(false)
  const setRpName = (v) => {
    setRpNameRaw(v)
    try {
      localStorage.setItem(NAME_KEY, v)
    } catch {
      /* ignore */
    }
  }

  // Player local (un preview à la fois, volume global partagé)
  const [playingId, setPlayingId] = useState(null)
  const audioRef = useRef(null)

  const [eventsLinkId, setEventsLinkId] = useState(null)
  const [posting, setPosting] = useState(false)
  const [search, setSearch] = useState('')
  const [statutFilter, setStatutFilter] = useState(null)

  const reload = useCallback(
    async (silent = false) => {
      if (!token) return
      if (!silent) setLoading(true)
      try {
        setPayload(await fetchSharePayload(token))
        setError(null)
      } catch (e) {
        if (!silent) setError(e)
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [token],
  )

  useEffect(() => {
    reload()
  }, [reload])

  // Refetch silencieux : les modifs des autres RP / de l'équipe arrivent
  // sans recharger la page (pas de realtime anon sur ces tables).
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') reload(true)
    }, 30000)
    return () => clearInterval(t)
  }, [reload])

  // Thème clair/sombre — même clé que les autres pages share.
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(PROJECT_SHARE_THEME_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECT_SHARE_THEME_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  // Cleanup audio au démontage
  useEffect(
    () => () => {
      audioRef.current?.pause?.()
    },
    [],
  )

  const links = useMemo(() => payload?.links || [], [payload])
  const events = useMemo(() => payload?.events || [], [payload])
  // Stats sur l'ensemble (hors filtre statut) — le tableau applique le filtre.
  const baseGroups = useMemo(() => groupAutorRows(links, { search }), [links, search])
  const stats = useMemo(() => computeAutorStats(baseGroups), [baseGroups])
  const groups = useMemo(
    () => groupAutorRows(links, { search, statutFilter }),
    [links, search, statutFilter],
  )
  const commentCounts = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      if (e.kind !== 'comment') continue
      map.set(e.autorisation_id, (map.get(e.autorisation_id) || 0) + 1)
    }
    return map
  }, [events])

  const eventsRow = useMemo(
    () => (eventsLinkId ? links.find((l) => l.id === eventsLinkId) || null : null),
    [eventsLinkId, links],
  )
  const eventsList = useMemo(() => {
    if (!eventsRow?.autorisation) return []
    return events.filter((e) => e.autorisation_id === eventsRow.autorisation.id)
  }, [eventsRow, events])

  function togglePlay(p) {
    if (playingId === p.id) {
      audioRef.current?.pause?.()
      audioRef.current = null
      setPlayingId(null)
      return
    }
    audioRef.current?.pause?.()
    if (!p.preview_url) return
    const audio = new Audio(p.preview_url)
    audio.volume = getPreviewVolume()
    audio.addEventListener('ended', () => setPlayingId(null))
    audio.play().catch(() => setPlayingId(null))
    audioRef.current = audio
    setPlayingId(p.id)
  }

  async function handlePatch(row, patch) {
    try {
      await shareUpdateAutorisation(token, row.id, patch, rpName || null)
      reload(true)
    } catch (e) {
      notify.error('Sauvegarde échouée : ' + (e?.message || e))
    }
  }

  async function handlePostComment(body) {
    if (!eventsRow) return false
    setPosting(true)
    try {
      await shareAddComment(token, eventsRow.id, body, rpName || null)
      await reload(true)
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
      <FullScreenStatus>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />
      </FullScreenStatus>
    )
  }
  if (error || !payload) {
    return <ErrorState error={error} />
  }

  const project = payload.project || {}
  const org = payload.org || null
  const metaItems = []
  if (project.ref_projet) metaItems.push({ type: 'ref', value: project.ref_projet })
  if (payload.share?.label) metaItems.push({ type: 'label', value: payload.share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  // ── Porte d'entrée : prénom obligatoire avant d'éditer ──────────────────
  if (!rpName || editingName) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4 share-theme-transition"
        style={{ background: 'var(--bg)', color: 'var(--txt)' }}
      >
        <div
          className="max-w-md w-full p-6 sm:p-8 rounded-2xl text-center"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <ShieldCheck className="w-10 h-10 mx-auto mb-3" style={{ color: '#FF6E37' }} />
          <h1 className="text-lg font-bold mb-1" style={{ color: 'var(--txt)' }}>
            Autorisations musiques
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--txt-2)' }}>
            {project.title}
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--txt-3)' }}>
            Ton prénom signera tes modifications.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const v = e.target.elements.rpname.value.trim()
              if (!v) return
              setRpName(v)
              setEditingName(false)
            }}
            className="flex items-center gap-2"
          >
            <input
              name="rpname"
              autoFocus
              type="text"
              defaultValue={rpName}
              placeholder="Ton prénom…"
              maxLength={60}
              className="flex-1 text-sm px-3 py-2.5 rounded-lg outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            />
            <button
              type="submit"
              className="text-sm font-bold px-4 py-2.5 rounded-lg"
              style={{ background: '#FF6E37', color: '#fff' }}
            >
              Commencer
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        <SharePageHeader
          pageTitle="Autorisations musiques"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />

        {/* Aide interface, une ligne */}
        <div
          className="mt-5 rounded-xl px-4 py-3 text-xs leading-relaxed"
          style={{ background: 'rgba(255,110,55,0.07)', border: '1px solid rgba(255,110,55,0.25)', color: 'var(--txt-2)' }}
        >
          Clique sur une valeur pour la modifier, sur la bulle 💬 pour ajouter
          commentaires et remarques. Tout s&apos;enregistre automatiquement.
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <AutorStatsBar stats={stats} activeFilter={statutFilter} onFilter={setStatutFilter} />
          <span className="ml-auto flex items-center gap-3">
            <PreviewVolumeControl
              onApply={(v) => {
                if (audioRef.current) audioRef.current.volume = v
              }}
            />
            <AutorSearchInput value={search} onChange={setSearch} />
            <button
              type="button"
              onClick={() => setEditingName(true)}
              className="inline-flex items-center gap-1.5 text-[11px]"
              style={{ color: 'var(--txt-3)' }}
              title="Changer de prénom"
            >
              Connecté : <b style={{ color: 'var(--txt-2)' }}>{rpName}</b>
              <Pencil className="w-3 h-3" />
            </button>
          </span>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          <AutorisationsTable
            groups={groups}
            canEdit
            commentCounts={commentCounts}
            playingId={playingId}
            onTogglePlay={togglePlay}
            onPatch={handlePatch}
            onOpenEvents={(row) => setEventsLinkId(row.id)}
            selfName={rpName}
          />
        </div>

        {eventsRow && (
          <EventsPanel
            row={eventsRow}
            events={eventsList}
            canEdit
            posting={posting}
            onPost={handlePostComment}
            onClose={() => setEventsLinkId(null)}
          />
        )}

        <SharePageFooter />
      </div>
    </div>
  )
}

// ─── Status / erreurs ──────────────────────────────────────────────────────

function FullScreenStatus({ children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      {children}
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || 'Erreur inconnue'
  const isInvalid = msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('expired')
  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-md w-full text-center p-6 sm:p-8 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <AlertCircle className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--red)', opacity: 0.7 }} />
        <h1 className="text-base font-bold mb-2" style={{ color: 'var(--txt)' }}>
          {isInvalid ? 'Lien invalide' : 'Page inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? "Ce lien n'est plus valide. Il a peut-être été révoqué ou a expiré."
            : 'Impossible de charger le suivi pour le moment. Réessayez dans quelques instants.'}
        </p>
      </div>
    </div>
  )
}

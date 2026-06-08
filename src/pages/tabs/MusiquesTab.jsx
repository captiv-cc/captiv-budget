// ════════════════════════════════════════════════════════════════════════════
// MusiquesTab — Onglet Musiques d'un projet
// ════════════════════════════════════════════════════════════════════════════
//
// Module Musiques MVP1 — MUS-1.7
//
// Page principale du module Musiques. Affiche la liste des propositions
// (vrac + statuts), avec barre de recherche unifiée et actions globales.
//
// Pour MVP1, le scope est :
//   - Liste propositions du projet (avec note moyenne, tags, artiste)
//   - Bouton "+ Ajouter une proposition" → modal AddProposition (MUS-1.9)
//   - Bouton "Importer affiche" → modal ImportAffiche (MUS-1.10)
//   - Barre de recherche text/filter local (MUS-1.8 fera la recherche
//     externe Deezer/YouTube via la UnifiedSearchBar du AddProposition)
//   - Loading + empty states
//   - Realtime subscriptions (MUS-1.14)
//
// Les composants PropositionRow (MUS-1.11), UnifiedSearchBar (MUS-1.8),
// AddProposition modal (MUS-1.9), ImportAffiche modal (MUS-1.10) seront
// branchés au fur et à mesure. Pour MUS-1.7, on a un rendu basique
// inline en attendant.
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import {
  Music,
  Plus,
  Search,
  Sparkles,
  ImageUp,
  Inbox,
  X,
  CheckSquare,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Eraser,
  ChevronDown,
  Check,
  Tag as TagIcon,
  ArrowUpDown,
  LayoutGrid,
} from 'lucide-react'
import {
  listPropositions,
  listAllNotes,
  listAllTags,
  listAllComments,
  computeAggregates,
  subscribeToProject,
  STATUTS,
  STATUT_LABELS,
  STATUT_COLORS,
  updateProposition,
  updateSortOrder,
  deleteProposition,
  setStatut,
} from '../../lib/musiques'
import { detectBpmFromUrl } from '../../lib/bpmDetect'
import {
  findYouTubeForTrack,
  getDeezerTrack,
} from '../../lib/musiqueSearch'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import AddPropositionModal from '../../features/musiques/AddPropositionModal'
import ImportProgrammationModal from '../../features/musiques/ImportProgrammationModal'
import PropositionRow from '../../features/musiques/PropositionRow'
import PropositionDetailDrawer from '../../features/musiques/PropositionDetailDrawer'

const OUTIL_KEY = 'musiques'

export default function MusiquesTab() {
  const { id: projectId } = useParams()
  const outletCtx = useOutletContext?.() || {}
  const project = outletCtx.project || null
  const { user } = useAuth() || {}
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

  // ─── State ────────────────────────────────────────────────────────────────
  const [propositions, setPropositions] = useState([])
  const [notes, setNotes] = useState([])
  const [tags, setTags] = useState([])
  const [commentsList, setCommentsList] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filtres locaux (recherche, statut)
  const [searchLocal, setSearchLocal] = useState('')
  const [filterStatut, setFilterStatut] = useState(null)
  // MUS-3.1 : filtres rapides additionnels (click sur tag/jour/proposeur)
  const [filterTag, setFilterTag] = useState(null)
  const [filterJour, setFilterJour] = useState(null)
  const [filterProposerId, setFilterProposerId] = useState(null)

  // MUS-3.2 : tri configurable, persisté localStorage par projet
  // Stratégie de défaut :
  //   - Si l'utilisateur a explicitement choisi un mode (localStorage)
  //     → on respecte sa préférence
  //   - Sinon : si la BDD a au moins une proposition avec sort_order
  //     non-null (= quelqu'un a déjà réordonné le projet) → 'manual'
  //     pour voir l'ordre partagé
  //   - Sinon : 'created_desc' (les plus récentes d'abord)
  const SORT_KEY = `musiques.sort.${projectId || 'global'}`
  const [sortModeOverride, setSortModeOverride] = useState(() => {
    try {
      return localStorage.getItem(SORT_KEY) || null
    } catch {
      return null
    }
  })
  const sortMode = useMemo(() => {
    if (sortModeOverride) return sortModeOverride
    const anyManual = propositions.some((p) => p.sort_order != null)
    return anyManual ? 'manual' : 'created_desc'
  }, [sortModeOverride, propositions])
  const setSortMode = useCallback(
    (mode) => {
      setSortModeOverride(mode)
      try {
        localStorage.setItem(SORT_KEY, mode)
      } catch {
        /* ignore */
      }
    },
    [SORT_KEY],
  )

  // MUS-3.4 : groupBy "Organiser par..." (statut/artiste/jour/proposeur)
  const GROUPBY_KEY = `musiques.groupby.${projectId || 'global'}`
  const [groupBy, setGroupBy] = useState(() => {
    try {
      return localStorage.getItem(GROUPBY_KEY) || 'none'
    } catch {
      return 'none'
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(GROUPBY_KEY, groupBy)
    } catch {
      /* ignore */
    }
  }, [GROUPBY_KEY, groupBy])

  // MUS-3.5 : drag and drop state (les handlers sont définis plus bas
  // car ils dépendent de visiblePropositions, déclaré plus loin dans
  // le composant — sinon TDZ ReferenceError).
  const [draggingId, setDraggingId] = useState(null)
  const [dropTargetId, setDropTargetId] = useState(null)
  const [dropPosition, setDropPosition] = useState(null) // 'above' | 'below'

  // MUS-3.3 : multi-sélection pour actions bulk
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const toggleSelected = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false)

  // Modals
  const [addOpen, setAddOpen] = useState(false)
  const [importProgOpen, setImportProgOpen] = useState(false)
  const [detailPropId, setDetailPropId] = useState(null) // ID de la prop ouverte
  // On dérive detailProp depuis l'array propositions pour avoir toujours
  // la version fraîche après refetch (sinon stale state au save inline).
  const detailProp = useMemo(
    () => propositions.find((p) => p.id === detailPropId) || null,
    [propositions, detailPropId],
  )

  // Audio player partagé : un seul preview joue à la fois.
  const [playingId, setPlayingId] = useState(null)
  const [audioEl, setAudioEl] = useState(null)
  // Set des propositions déjà analysées en BPM cette session (évite de
  // re-déclencher la détection au re-play).
  const bpmDetectedRef = useRef(new Set())
  // Idem pour YouTube auto-find rétroactif (1 essai par session par prop).
  const ytFetchedRef = useRef(new Set())

  // MUS-2.7 : si BPM null/0, déclenche la détection client-side en
  // arrière-plan (n'attend pas le résultat, joue tout de suite).
  const maybeDetectBpm = useCallback(async (prop) => {
    if (!prop?.preview_url) return
    if (bpmDetectedRef.current.has(prop.id)) return
    const currentBpm = prop.audio_features?.tempo
    if (currentBpm > 0) return
    bpmDetectedRef.current.add(prop.id)
    try {
      const detected = await detectBpmFromUrl(prop.preview_url)
      if (!detected) return
      const newFeatures = {
        ...(prop.audio_features || {}),
        tempo: detected,
        source: 'client-detected',
      }
      await updateProposition(prop.id, { audio_features: newFeatures })
      // Realtime + refetch global vont catch
    } catch (e) {
      console.warn('[BPM detect] failed for', prop.id, e)
    }
  }, [])

  // playWithRefresh — tente de jouer le preview_url, et si ça foire (URL
  // Deezer expirée, CDN refusé), refetch via getDeezerTrack pour une URL
  // fraîche. Met à jour la BDD en passant. Idempotent.
  const playWithRefresh = useCallback(
    async (prop) => {
      const tryPlay = (url) => {
        const audio = new Audio(url)
        audio.volume = 0.7
        audio.addEventListener('ended', () => setPlayingId(null))
        const playPromise = audio.play()
        return { audio, playPromise }
      }

      let url = prop.preview_url
      let audio = null
      let played = false

      if (url) {
        try {
          const r = tryPlay(url)
          await r.playPromise
          audio = r.audio
          played = true
        } catch (e) {
          console.warn('[preview] première lecture KO, on refresh', e)
        }
      }

      // Si pas d'URL OU lecture initiale KO → tente refresh via Deezer
      if (!played && prop.spotify_id) {
        try {
          const fresh = await getDeezerTrack(prop.spotify_id)
          if (fresh?.preview_url && fresh.preview_url !== url) {
            url = fresh.preview_url
            // Persiste la nouvelle URL pour les prochains play
            updateProposition(prop.id, { preview_url: url }).catch((e) =>
              console.warn('[preview] save fresh URL failed', e),
            )
            const r = tryPlay(url)
            audio = r.audio
            await r.playPromise
            played = true
          }
        } catch (e) {
          console.warn('[preview] refresh KO', e)
        }
      }

      return { audio, played }
    },
    [],
  )

  const togglePlay = useCallback(
    async (prop) => {
      if (playingId === prop.id) {
        audioEl?.pause?.()
        setPlayingId(null)
        return
      }
      if (audioEl) audioEl.pause()
      if (!prop.preview_url && !prop.spotify_id) return
      // Optimistic UI : on indique playing tout de suite, on revert si échec
      setPlayingId(prop.id)
      const { audio, played } = await playWithRefresh(prop)
      if (!played) {
        notify.error('Lecture impossible (preview Deezer indisponible)')
        setPlayingId(null)
        return
      }
      setAudioEl(audio)
      // Déclenche la détection BPM en parallèle si nécessaire
      maybeDetectBpm(prop)
    },
    [audioEl, playingId, maybeDetectBpm, playWithRefresh],
  )
  // Cleanup audio à l'unmount du tab
  useEffect(() => () => audioEl?.pause?.(), [audioEl])

  // ─── Chargement initial ────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!projectId) return
    setError(null)
    try {
      const [propsData, notesData, tagsData, commentsData] = await Promise.all([
        listPropositions(projectId, { sort: 'created_at_desc' }),
        listAllNotes(projectId),
        listAllTags(projectId),
        listAllComments(projectId),
      ])
      setPropositions(propsData)
      setNotes(notesData)
      setTags(tagsData)
      setCommentsList(commentsData)
    } catch (e) {
      console.warn('[MusiquesTab] fetch failed', e)
      setError(e.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refetch()
  }, [refetch])

  // ─── Realtime subscriptions (MUS-1.14 partiel) ─────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined
    const sub = subscribeToProject(projectId, {
      onPropositionChange: () => refetch(),
      onNoteChange: () => refetch(),
      onTagChange: () => refetch(),
    })
    return () => sub.unsubscribe()
  }, [projectId, refetch])

  // ─── Backfill YouTube rétroactif ──────────────────────────────────────────
  // Pour les propositions ajoutées AVANT MUS-2.8 (qui n'avaient pas
  // l'auto-find), on lance une recherche en background au load. Throttle
  // 1 req/s pour ne pas spammer YouTube API (quota 100/jour).
  useEffect(() => {
    if (!propositions.length) return undefined
    let cancelled = false
    const missing = propositions.filter(
      (p) =>
        !p.lien_youtube &&
        !ytFetchedRef.current.has(p.id) &&
        (p.artiste?.nom || p.artiste_text) &&
        p.titre,
    )
    if (missing.length === 0) return undefined

    async function backfillSequential() {
      for (const p of missing) {
        if (cancelled) break
        ytFetchedRef.current.add(p.id)
        const artistName = p.artiste?.nom || p.artiste_text
        try {
          const match = await findYouTubeForTrack(artistName, p.titre)
          if (cancelled) break
          if (match?.video_url) {
            await updateProposition(p.id, { lien_youtube: match.video_url })
            // Realtime + refetch catch
          }
        } catch (e) {
          console.warn('[YT backfill] failed for', p.id, e)
        }
        // Throttle 1s entre 2 calls (anti-quota)
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    backfillSequential()
    return () => {
      cancelled = true
    }
    // propositions change quand on refetch → re-trigger sans relancer les
    // déjà essayés (grâce au ytFetchedRef).
  }, [propositions])

  // ─── Agrégats (note moyenne + tags) côté front ────────────────────────────
  const aggregates = useMemo(
    () => computeAggregates(notes, tags, user?.id || null, commentsList),
    [notes, tags, user?.id, commentsList],
  )

  // ─── Filtrage local (search + statut + filtres rapides) ──────────────────
  const visiblePropositions = useMemo(() => {
    const s = searchLocal.trim().toLowerCase()
    const filtered = propositions.filter((p) => {
      if (filterStatut && p.statut !== filterStatut) return false
      if (filterJour && p.artiste?.jour !== filterJour) return false
      if (filterProposerId && p.proposer_id !== filterProposerId) return false
      if (filterTag) {
        const ptags = aggregates.get(p.id)?.tags || []
        if (!ptags.some((t) => t.tag === filterTag)) return false
      }
      if (s) {
        const artist = (p.artiste?.nom || p.artiste_text || '').toLowerCase()
        const title = (p.titre || '').toLowerCase()
        if (!artist.includes(s) && !title.includes(s)) return false
      }
      return true
    })
    // Tri configurable (MUS-3.2)
    return sortPropositions(filtered, sortMode, aggregates)
  }, [
    propositions,
    searchLocal,
    filterStatut,
    filterTag,
    filterJour,
    filterProposerId,
    sortMode,
    aggregates,
  ])

  // Clear tous les filtres rapides
  const clearQuickFilters = useCallback(() => {
    setFilterTag(null)
    setFilterJour(null)
    setFilterProposerId(null)
  }, [])

  // MUS-3.4 : groupes calculés depuis visiblePropositions + groupBy
  const groupedView = useMemo(
    () => groupPropositions(visiblePropositions, groupBy),
    [visiblePropositions, groupBy],
  )

  // MUS-4.7 : compteurs par statut (pour les stat pills du header).
  // Calculés sur les propositions BRUTES (pas filtrées) — ce sont les
  // totaux du projet, pas de la vue. C'est la logique attendue côté
  // Livrables/Matériel : on filtre depuis le header, le compteur reste
  // global.
  const statutCounts = useMemo(() => {
    const counts = { total: propositions.length }
    for (const s of STATUTS) counts[s] = 0
    let noted = 0
    const seen = new Set()
    for (const p of propositions) {
      if (p.statut in counts) counts[p.statut] += 1
    }
    // Combien de propositions ont au moins une note (peu importe qui)
    for (const n of notes || []) {
      if (!seen.has(n.proposition_id)) {
        seen.add(n.proposition_id)
        noted += 1
      }
    }
    counts.noted = noted
    return counts
  }, [propositions, notes])

  // MUS-4.7 : indique si au moins un filtre est actif → permet à la pill
  // "Total" de devenir un eraser (clic = clear all filters).
  const anyFilterActive = Boolean(
    filterStatut ||
      filterTag ||
      filterJour ||
      filterProposerId ||
      searchLocal.trim(),
  )
  const clearAllFilters = useCallback(() => {
    setFilterStatut(null)
    setFilterTag(null)
    setFilterJour(null)
    setFilterProposerId(null)
    setSearchLocal('')
  }, [])

  // MUS-4.7 : toggle d'une stat pill statut. Click sur la pill = filtre
  // sur ce statut, click sur la même pill = clear.
  const toggleStatutFilter = useCallback(
    (statut) => {
      setFilterStatut((cur) => (cur === statut ? null : statut))
    },
    [],
  )

  // MUS-3.5 : drag and drop handlers (déclarés ici car ils dépendent
  // de visiblePropositions qui doit être init avant).
  const handleDragStart = useCallback(
    (prop) => {
      if (sortMode !== 'manual') setSortMode('manual')
      setDraggingId(prop.id)
    },
    [sortMode, setSortMode],
  )
  const handleDragOver = useCallback((prop, position) => {
    setDropTargetId(prop.id)
    setDropPosition(position)
  }, [])
  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    setDropTargetId(null)
    setDropPosition(null)
  }, [])
  const handleDrop = useCallback(
    async (targetProp, position) => {
      const dragId = draggingId
      setDraggingId(null)
      setDropTargetId(null)
      setDropPosition(null)
      if (!dragId || dragId === targetProp.id) return
      // Construit le nouveau ordre cible
      const dragRow = visiblePropositions.find((p) => p.id === dragId)
      if (!dragRow) return
      const ordered = visiblePropositions.filter((p) => p.id !== dragId)
      const targetIdx = ordered.findIndex((p) => p.id === targetProp.id)
      if (targetIdx < 0) return
      const insertIdx = position === 'above' ? targetIdx : targetIdx + 1
      const newList = [...ordered]
      newList.splice(insertIdx, 0, dragRow)

      // Renumérote TOUTES les rows qui n'ont pas la bonne sort_order
      // (= idx * 1000). C'est plus simple et fiable que d'essayer de
      // calculer fractionnaire avec des voisins NULL. Pour 5-100 rows,
      // c'est 5-100 UPDATEs en parallèle — acceptable.
      const updates = []
      newList.forEach((p, idx) => {
        const expected = idx * 1000
        if (p.sort_order !== expected) {
          updates.push(updateSortOrder(p.id, expected))
        }
      })
      console.warn(
        `[DnD] drop ${dragId} ${position} ${targetProp.id} → ${updates.length} updates`,
      )
      try {
        const results = await Promise.allSettled(updates)
        const failed = results.filter((r) => r.status === 'rejected')
        if (failed.length > 0) {
          console.warn('[DnD] some updates failed', failed)
          const firstMsg = failed[0]?.reason?.message || ''
          if (/sort_order/i.test(firstMsg)) {
            notify.error(
              "Migration manquante : exécute 20260608g_musique_proposition_sort_order.sql",
            )
          } else {
            notify.error(
              `${failed.length} échec${failed.length > 1 ? 's' : ''} sur le drop`,
            )
          }
        }
        refetch()
      } catch (e) {
        console.warn('[DnD] reorder failed', e)
        notify.error(e?.message || 'Réordonnancement impossible')
      }
    },
    [draggingId, visiblePropositions, refetch],
  )

  // Liste des proposeurs ayant filtré ce jour (pour le label du chip)
  const proposerNameLookup = useMemo(() => {
    const m = new Map()
    for (const p of propositions) {
      if (p.proposer_id && !m.has(p.proposer_id)) {
        m.set(
          p.proposer_id,
          p.proposer?.full_name || p.proposer?.email?.split('@')[0] || '—',
        )
      }
    }
    return m
  }, [propositions])

  // ─── Bulk actions (MUS-3.3) ───────────────────────────────────────────────
  async function bulkSetStatut(newStatut) {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        [...selectedIds].map((id) => setStatut(id, newStatut)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const ko = results.length - ok
      if (ok > 0) {
        notify.success(
          `${ok} proposition${ok > 1 ? 's' : ''} → ${STATUT_LABELS[newStatut]}`,
          false,
        )
      }
      if (ko > 0) {
        notify.error(`${ko} échec${ko > 1 ? 's' : ''} sur le bulk`)
      }
      clearSelection()
      refetch()
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return
    setBulkBusy(true)
    try {
      const results = await Promise.allSettled(
        [...selectedIds].map((id) => deleteProposition(id)),
      )
      const ok = results.filter((r) => r.status === 'fulfilled').length
      const ko = results.length - ok
      if (ok > 0) notify.success(`${ok} supprimée${ok > 1 ? 's' : ''}`, false)
      if (ko > 0) notify.error(`${ko} échec${ko > 1 ? 's' : ''}`)
      clearSelection()
      setBulkConfirmDelete(false)
      refetch()
    } finally {
      setBulkBusy(false)
    }
  }

  // ─── Permission denied ────────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div
        className="flex flex-col items-center justify-center p-12 text-center"
        style={{ color: 'var(--txt-3)' }}
      >
        <Music size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
        <div style={{ fontSize: 14 }}>
          Tu n&apos;as pas accès au module Musiques pour ce projet.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">

      {/* ─── Header : icon + titre + stats + CTAs (MUS-4.7) ───────────────
          Pattern aligné Livrables/Matériel : icon box coloré + h1 +
          subtitle dynamique + stat pills cliquables, CTA primaires à
          droite. Bordure bas pour séparer du filtres bar. */}
      <div
        className="flex flex-col gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {/* Icon block — violet pour matcher l'identité Musiques */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'var(--purple-bg)' }}
          >
            <Music className="w-5 h-5" style={{ color: 'var(--purple)' }} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-lg font-bold"
              style={{ color: 'var(--txt)' }}
            >
              Musiques
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {statutCounts.total}{' '}
              {statutCounts.total > 1 ? 'propositions' : 'proposition'}
              {statutCounts.noted > 0 && (
                <>
                  {' '}· {statutCounts.noted} notée
                  {statutCounts.noted > 1 ? 's' : ''}
                </>
              )}
              {statutCounts.accorde > 0 && (
                <>
                  {' '}· {statutCounts.accorde} accordée
                  {statutCounts.accorde > 1 ? 's' : ''}
                </>
              )}
            </p>
          </div>

          {/* Stat pills cliquables — chaque pill toggle un filtre statut.
              Total est un eraser quand au moins un filtre est actif. */}
          <div className="flex items-center gap-2 flex-wrap ml-0 sm:ml-4">
            <StatPill
              label="Total"
              value={statutCounts.total}
              icon={anyFilterActive ? Eraser : Inbox}
              color="var(--txt-2)"
              bg="var(--bg-2, var(--bg-elev))"
              active={false}
              eraser={anyFilterActive}
              onClick={anyFilterActive ? clearAllFilters : undefined}
              title={
                anyFilterActive
                  ? 'Effacer tous les filtres'
                  : `${statutCounts.total} proposition${
                      statutCounts.total > 1 ? 's' : ''
                    }`
              }
            />
            <StatPill
              label="Vrac"
              value={statutCounts.vrac}
              icon={Music}
              color={STATUT_COLORS.vrac?.fg || 'var(--txt-3)'}
              bg={STATUT_COLORS.vrac?.bg || 'var(--bg-elev)'}
              active={filterStatut === 'vrac'}
              onClick={() => toggleStatutFilter('vrac')}
            />
            <StatPill
              label="En nego"
              value={statutCounts.en_nego}
              icon={Clock}
              color={STATUT_COLORS.en_nego?.fg || '#D97706'}
              bg={STATUT_COLORS.en_nego?.bg || 'rgba(245,158,11,0.18)'}
              active={filterStatut === 'en_nego'}
              onClick={() => toggleStatutFilter('en_nego')}
              dim={statutCounts.en_nego === 0}
            />
            <StatPill
              label="Accordés"
              value={statutCounts.accorde}
              icon={CheckCircle2}
              color={STATUT_COLORS.accorde?.fg || '#16A34A'}
              bg={STATUT_COLORS.accorde?.bg || 'rgba(34,197,94,0.18)'}
              active={filterStatut === 'accorde'}
              onClick={() => toggleStatutFilter('accorde')}
              dim={statutCounts.accorde === 0}
            />
            {statutCounts.refuse > 0 && (
              <StatPill
                label="Refusés"
                value={statutCounts.refuse}
                icon={XCircle}
                color={STATUT_COLORS.refuse?.fg || '#EF4444'}
                bg={STATUT_COLORS.refuse?.bg || 'rgba(239,68,68,0.18)'}
                active={filterStatut === 'refuse'}
                onClick={() => toggleStatutFilter('refuse')}
              />
            )}
          </div>

          {/* CTAs primaires — pattern Mat/Liv : actions secondaires en
              bg-elev borded, action principale en bleu solide. ml-auto
              pousse à droite. */}
          {canEdit && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={() => setImportProgOpen(true)}
                title="Importer la programmation du festival via Claude Vision"
                className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-all shrink-0"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-2)',
                  border: '1px solid var(--brd)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                  e.currentTarget.style.color = 'var(--txt)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elev)'
                  e.currentTarget.style.color = 'var(--txt-2)'
                }}
              >
                <ImageUp className="w-3 h-3" />
                Importer prog.
              </button>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all shrink-0"
                style={{
                  background: 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: '1px solid var(--blue, #3B82F6)',
                }}
              >
                <Plus className="w-3 h-3" />
                Ajouter
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Filtres bar (MUS-4.7) ─────────────────────────────────────
          Ligne 2 dédiée aux filtres : label FILTRES + recherche + 3
          dropdowns (statut, tri, groupement). Pattern Livrables. */}
      <div
        className="flex items-center gap-2 px-5 py-2 overflow-x-auto"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <span
          className="text-[10px] uppercase tracking-wider shrink-0 mr-1"
          style={{ color: 'var(--txt-3)' }}
        >
          Filtres
        </span>

        {/* Search (typeahead local) */}
        <div
          className="flex items-center gap-2 px-2.5 rounded-md shrink-0"
          style={{
            height: 30,
            minWidth: 220,
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
          }}
        >
          <Search size={13} style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder="Artiste ou titre…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--txt)',
              fontSize: 12,
              minWidth: 100,
            }}
          />
          <Sparkles
            size={12}
            style={{ color: 'var(--txt-3)', opacity: 0.4 }}
            title="Recherche intelligente bientôt — pour ajouter, utilise +Ajouter"
          />
        </div>

        {/* Filtre statut — chip dropdown au pattern Livrables */}
        <ChipDropdown
          icon={TagIcon}
          label="Statut"
          value={filterStatut}
          options={[
            { key: null, label: 'Tous les statuts' },
            ...Object.entries(STATUT_LABELS).map(([key, label]) => ({
              key,
              label,
              colorBg: STATUT_COLORS[key]?.bg,
              colorFg: STATUT_COLORS[key]?.fg,
            })),
          ]}
          onSelect={(k) => setFilterStatut(k)}
        />

        {/* Tri */}
        <ChipDropdown
          icon={ArrowUpDown}
          label="Tri"
          value={sortMode}
          options={SORT_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
          onSelect={(k) => setSortMode(k)}
          hideClear
        />

        {/* Groupement */}
        <ChipDropdown
          icon={LayoutGrid}
          label="Groupement"
          value={groupBy}
          options={[
            { key: 'none', label: 'Sans groupement' },
            { key: 'statut', label: 'Par statut' },
            { key: 'artiste', label: 'Par artiste' },
            { key: 'jour', label: 'Par jour' },
            { key: 'proposeur', label: 'Par proposeur' },
          ]}
          onSelect={(k) => setGroupBy(k)}
          hideClear
        />
      </div>

      {/* ─── Content : body avec padding standard ────────────────────── */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ─── Chips filtres rapides actifs (MUS-3.1) ─────────────────────── */}
      {(filterTag || filterJour || filterProposerId) && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
            padding: '6px 10px',
            background: 'rgba(59,130,246,0.06)',
            border: '1px solid rgba(59,130,246,0.2)',
            borderRadius: 6,
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--txt-3)', marginRight: 4 }}>
            Filtres actifs :
          </span>
          {filterTag && (
            <FilterChip
              label={`tag: ${filterTag}`}
              onClear={() => setFilterTag(null)}
            />
          )}
          {filterJour && (
            <FilterChip
              label={`Joue ${filterJour}`}
              onClear={() => setFilterJour(null)}
            />
          )}
          {filterProposerId && (
            <FilterChip
              label={`Par ${proposerNameLookup.get(filterProposerId) || '—'}`}
              onClear={() => setFilterProposerId(null)}
            />
          )}
          <button
            type="button"
            onClick={clearQuickFilters}
            style={{
              fontSize: 11,
              color: 'var(--blue, #3B82F6)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              marginLeft: 'auto',
            }}
          >
            Tout effacer
          </button>
        </div>
      )}

      {/* ─── Bulk action bar (MUS-3.3) — sticky overlay (MUS-3.4) ─────── */}
      {selectedIds.size > 0 && (
        <div
          style={{
            position: 'sticky',
            top: 8,
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            background: 'rgba(217,119,6,0.95)',
            color: 'white',
            border: '1px solid rgba(217,119,6,0.6)',
            borderRadius: 6,
            flexWrap: 'wrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          <CheckSquare size={14} />
          <span style={{ fontSize: 12, fontWeight: 500 }}>
            {selectedIds.size} sélectionnée{selectedIds.size > 1 ? 's' : ''}
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span style={{ fontSize: 11, opacity: 0.85 }}>
            Changer le statut :
          </span>
          {STATUTS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => bulkSetStatut(s)}
              disabled={bulkBusy}
              style={{
                padding: '3px 8px',
                fontSize: 10,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: 10,
                cursor: bulkBusy ? 'not-allowed' : 'pointer',
                color: 'white',
              }}
            >
              {STATUT_LABELS[s]}
            </button>
          ))}
          <span style={{ opacity: 0.5 }}>·</span>
          {bulkConfirmDelete ? (
            <>
              <AlertTriangle size={12} />
              <span style={{ fontSize: 11 }}>Sûr ?</span>
              <button
                type="button"
                onClick={bulkDelete}
                disabled={bulkBusy}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  background: '#7F1D1D',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setBulkConfirmDelete(false)}
                disabled={bulkBusy}
                style={{
                  padding: '3px 8px',
                  fontSize: 10,
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.4)',
                  color: 'white',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                Annuler
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setBulkConfirmDelete(true)}
              disabled={bulkBusy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                fontSize: 11,
                background: 'rgba(255,255,255,0.15)',
                border: '1px solid rgba(255,255,255,0.35)',
                color: 'white',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              <Trash2 size={11} />
              Supprimer
            </button>
          )}
          <button
            type="button"
            onClick={clearSelection}
            style={{
              marginLeft: 'auto',
              fontSize: 11,
              color: 'white',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              textDecoration: 'underline',
              opacity: 0.9,
            }}
          >
            Tout désélectionner
          </button>
        </div>
      )}

      {/* ─── Erreur ────────────────────────────────────────────────────── */}
      {error && (
        <div
          style={{
            padding: 12,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
            color: '#EF4444',
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* ─── Loading ──────────────────────────────────────────────────── */}
      {loading && (
        <div
          style={{
            padding: '40px 12px',
            textAlign: 'center',
            color: 'var(--txt-3)',
            fontSize: 13,
          }}
        >
          Chargement des propositions…
        </div>
      )}

      {/* ─── Empty state ──────────────────────────────────────────────── */}
      {!loading && propositions.length === 0 && (
        <div
          style={{
            padding: '60px 12px',
            textAlign: 'center',
            color: 'var(--txt-3)',
            background: 'var(--bg-elev)',
            border: '1px dashed var(--brd-sub)',
            borderRadius: 8,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Inbox size={28} style={{ opacity: 0.5 }} />
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--txt-2)' }}>
            Aucune proposition pour le moment
          </div>
          <div style={{ fontSize: 12, maxWidth: 420 }}>
            Démarre en important l&apos;affiche du festival pour peupler
            l&apos;annuaire artistes, puis ajoute tes premières propositions
            de titres via la barre de recherche unifiée (Deezer + YouTube).
          </div>
        </div>
      )}

      {/* ─── Empty state filtres (a des propositions mais filtres masquent) ── */}
      {!loading && propositions.length > 0 && visiblePropositions.length === 0 && (
        <div
          style={{
            padding: '32px 12px',
            textAlign: 'center',
            color: 'var(--txt-3)',
            fontSize: 13,
          }}
        >
          Aucune proposition ne correspond aux filtres actifs.
          <button
            type="button"
            onClick={() => {
              setSearchLocal('')
              setFilterStatut(null)
            }}
            style={{
              marginLeft: 8,
              background: 'none',
              border: 'none',
              color: 'var(--blue, #3B82F6)',
              cursor: 'pointer',
              fontSize: 13,
              textDecoration: 'underline',
            }}
          >
            Réinitialiser
          </button>
        </div>
      )}

      {/* ─── Liste propositions (PropositionRow — MUS-1.11) ──────────── */}
      {!loading && visiblePropositions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {groupedView.map((group) => (
            <div
              key={group.key}
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd-sub)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {/* Sub-header de groupe (si groupBy actif) */}
              {groupBy !== 'none' && (
                <div
                  style={{
                    padding: '6px 12px',
                    background: 'var(--bg-elev)',
                    borderBottom: '1px solid var(--brd-sub)',
                    fontSize: 11,
                    color: 'var(--txt-2)',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    textTransform: groupBy === 'statut' ? 'uppercase' : 'none',
                    letterSpacing: groupBy === 'statut' ? 0.5 : 0,
                  }}
                >
                  <span>{group.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--txt-3)',
                      fontWeight: 400,
                    }}
                  >
                    ({group.items.length})
                  </span>
                </div>
              )}
              {group.items.map((p, idx) => (
                <div
                  key={p.id}
                  style={{
                    borderBottom:
                      idx < group.items.length - 1
                        ? '1px solid var(--brd-sub)'
                        : 'none',
                  }}
                >
                  <PropositionRow
                    proposition={p}
                    aggregate={aggregates.get(p.id)}
                    isPlaying={playingId === p.id}
                    onTogglePlay={togglePlay}
                    canEdit={canEdit}
                    currentUserId={user?.id || null}
                    projectId={projectId}
                    onMutated={refetch}
                    onClick={() => setDetailPropId(p.id)}
                    // Filtres rapides (MUS-3.1)
                    onTagClick={(tag) => setFilterTag(tag)}
                    onJourClick={(jour) => setFilterJour(jour)}
                    onProposerClick={(uid) => setFilterProposerId(uid)}
                    // Multi-sélection (MUS-3.3)
                    selected={selectedIds.has(p.id)}
                    onToggleSelected={() => toggleSelected(p.id)}
                    anySelected={selectedIds.size > 0}
                    // Drag and drop (MUS-3.5)
                    enableDnD={canEdit && groupBy === 'none'}
                    isDragging={draggingId === p.id}
                    dropTarget={dropTargetId === p.id ? dropPosition : null}
                    onDragStart={handleDragStart}
                    onDragOver={handleDragOver}
                    onDragEnd={handleDragEnd}
                    onDrop={handleDrop}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ─── Filigrane info ───────────────────────────────────────────── */}
      {!loading && propositions.length > 0 && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt-3)',
            textAlign: 'center',
            paddingTop: 4,
          }}
        >
          {visiblePropositions.length} sur {propositions.length} propositions
          affichées
          {project?.title ? ` · ${project.title}` : ''}
        </div>
      )}

      </div>{/* /Content body wrapper */}

      {/* ─── Modals ────────────────────────────────────────────────────── */}
      <AddPropositionModal
        open={addOpen}
        projectId={projectId}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          // Refetch immédiat pour ne pas dépendre du Realtime (au cas où
          // la publication supabase_realtime n'est pas encore appliquée
          // sur ce projet, ou si le delay subscription est lent).
          // Le double refetch (immédiat + via Realtime quelques ms après)
          // est sans conséquence — c'est idempotent.
          refetch()
        }}
      />
      <ImportProgrammationModal
        open={importProgOpen}
        projectId={projectId}
        onClose={() => setImportProgOpen(false)}
        onImported={() => {
          // Pas de refetch direct ici (les artistes ne sont pas dans
          // propositions). L'annuaire sera utilisé au prochain ajout
          // de proposition pour le matching.
        }}
      />
      <PropositionDetailDrawer
        open={Boolean(detailProp)}
        proposition={detailProp}
        canEdit={canEdit}
        projectId={projectId}
        currentUserId={user?.id || null}
        aggregate={detailProp ? aggregates.get(detailProp.id) : null}
        onClose={() => setDetailPropId(null)}
        onMutated={refetch}
      />
    </div>
  )
}

// ─── Grouping (MUS-3.4) ────────────────────────────────────────────────────

function groupPropositions(list, groupBy) {
  if (groupBy === 'none' || !groupBy) {
    return [{ key: 'all', label: '', items: list }]
  }
  const groups = new Map() // key → { label, items }
  for (const p of list) {
    const { key, label } = groupKeyLabel(p, groupBy)
    if (!groups.has(key)) groups.set(key, { key, label, items: [] })
    groups.get(key).items.push(p)
  }
  const arr = [...groups.values()]
  // Ordonner les groupes intelligemment selon le mode
  if (groupBy === 'statut') {
    const order = [
      'accorde',
      'en_nego',
      'valide_festival',
      'selectionne',
      'vrac',
      'refuse',
    ]
    arr.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  } else {
    // Ordre alphabétique du label, avec "Sans X" en dernier
    arr.sort((a, b) => {
      const aNo = a.key.startsWith('_none')
      const bNo = b.key.startsWith('_none')
      if (aNo && !bNo) return 1
      if (!aNo && bNo) return -1
      return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' })
    })
  }
  return arr
}

function groupKeyLabel(p, groupBy) {
  switch (groupBy) {
    case 'statut':
      return { key: p.statut, label: STATUT_LABELS_FALLBACK(p.statut) }
    case 'artiste': {
      const nom = p.artiste?.nom || p.artiste_text || ''
      if (!nom) return { key: '_none', label: 'Sans artiste' }
      return { key: `art:${nom.toLowerCase()}`, label: nom }
    }
    case 'jour': {
      const jour = p.artiste?.jour
      if (!jour) return { key: '_none_jour', label: 'Sans jour défini' }
      return { key: `jour:${jour}`, label: `Joue ${jour}` }
    }
    case 'proposeur': {
      const id = p.proposer_id
      if (!id) return { key: '_none_prop', label: 'Sans proposeur' }
      const name =
        p.proposer?.full_name ||
        p.proposer?.email?.split('@')[0] ||
        '—'
      return { key: `prop:${id}`, label: `Par ${name}` }
    }
    default:
      return { key: 'all', label: '' }
  }
}

// Inline mini lookup pour ne pas avoir à importer STATUT_LABELS ici
function STATUT_LABELS_FALLBACK(key) {
  const m = {
    vrac: 'Vrac',
    selectionne: 'Sélectionné',
    valide_festival: 'Validé festival',
    en_nego: 'En négo',
    accorde: 'Accordé',
    refuse: 'Refusé',
  }
  return m[key] || key
}

// ─── FilterChip (MUS-3.1) ─────────────────────────────────────────────────

function FilterChip({ label, onClear }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 4px 2px 8px',
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 10,
        fontSize: 11,
        color: 'var(--txt-2)',
      }}
    >
      {label}
      <button
        type="button"
        onClick={onClear}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--txt-3)',
          cursor: 'pointer',
          padding: 2,
          display: 'inline-flex',
          alignItems: 'center',
        }}
        aria-label={`Retirer le filtre ${label}`}
      >
        <X size={10} />
      </button>
    </span>
  )
}

// ─── StatPill (MUS-4.7) ────────────────────────────────────────────────────
// Pill compteur cliquable du header — pattern Livrables.
// `dim=true` → pill grise atténuée pour count=0 (au lieu de hidden,
// pour stabilité de layout). `eraser=true` → pill prend la couleur
// d'accent + icône Eraser pour signifier "click = clear all filters".
function StatPill({
  label,
  value,
  icon: Icon,
  color,
  bg,
  active = false,
  eraser = false,
  dim = false,
  onClick,
  title,
}) {
  const isInteractive = Boolean(onClick) && !dim
  const isHighlight = active || eraser
  return (
    <button
      type="button"
      onClick={isInteractive ? onClick : undefined}
      disabled={!isInteractive}
      className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full shrink-0 transition-all"
      style={{
        background: isHighlight ? bg : 'var(--bg-elev)',
        color: isHighlight ? color : dim ? 'var(--txt-3)' : 'var(--txt)',
        border: `1px solid ${isHighlight ? color : 'var(--brd)'}`,
        cursor: isInteractive ? 'pointer' : 'default',
        opacity: dim ? 0.55 : 1,
      }}
      title={
        title ||
        (eraser
          ? 'Effacer tous les filtres'
          : active
            ? `Désactiver le filtre ${label}`
            : `${label} — cliquer pour filtrer`)
      }
    >
      {Icon && (
        <Icon
          className="w-3 h-3"
          style={{ color: isHighlight ? color : dim ? 'var(--txt-3)' : color }}
        />
      )}
      <span className="tabular-nums">{value}</span>
      <span
        className="text-[11px] font-medium"
        style={{ color: isHighlight ? color : 'var(--txt-3)' }}
      >
        {label}
      </span>
    </button>
  )
}

// ─── ChipDropdown (MUS-4.7) ────────────────────────────────────────────────
// Bouton chip avec dropdown panel — pattern visuel aligné Livrables
// (MultiSelectChip privée). Version single-select pour Statut, Tri,
// Groupement de Musiques.
//
// Props :
//   - icon                 : Lucide icon component (Tag, ArrowUpDown, …)
//   - label                : string affiché en pill quand pas de sélection
//   - value                : key courante (null = pas de sélection)
//   - options              : Array<{ key, label, colorBg?, colorFg? }>
//                            colorBg/colorFg → pour afficher le label en
//                            pill colorée (utilisé par Statut pour
//                            reprendre les couleurs STATUT_COLORS)
//   - onSelect(key)        : callback sur sélection (null pour Tous)
//   - hideClear            : si true, pas de footer "Effacer" (cas où
//                            'none' / mode par défaut a déjà cette
//                            sémantique)
function ChipDropdown({
  icon: Icon,
  label,
  value,
  options,
  onSelect,
  hideClear = false,
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close au click outside
  useEffect(() => {
    if (!open) return undefined
    function onDocClick(e) {
      if (ref.current?.contains(e.target)) return
      setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.key === value)
  // Le chip est "actif" si la valeur courante n'est pas la première
  // option (par convention : Tous les statuts / Sans groupement → repos)
  const defaultKey = options[0]?.key
  const isActive = value != null && value !== defaultKey

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg shrink-0 transition-colors"
        style={{
          background: isActive ? 'var(--blue-bg)' : 'transparent',
          color: isActive ? 'var(--blue)' : 'var(--txt-2)',
          border: `1px solid ${isActive ? 'var(--blue)' : 'var(--brd-sub)'}`,
        }}
      >
        {Icon && <Icon className="w-3.5 h-3.5" />}
        <span>{label}</span>
        {isActive && selected?.label && (
          <span
            className="text-[10px] px-1.5 rounded-full font-medium tabular-nums"
            style={{
              background: 'var(--blue)',
              color: '#fff',
            }}
          >
            {selected.label}
          </span>
        )}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 rounded-lg shadow-lg overflow-hidden"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            minWidth: 200,
            maxHeight: 320,
            overflowY: 'auto',
            zIndex: 40,
          }}
        >
          {options.map((opt) => {
            const checked = opt.key === value
            return (
              <button
                key={opt.key ?? '__null__'}
                type="button"
                onClick={() => {
                  onSelect(opt.key)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs"
                style={{
                  background: checked ? 'var(--bg-hov)' : 'transparent',
                  color: 'var(--txt)',
                }}
                onMouseEnter={(e) => {
                  if (!checked)
                    e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  if (!checked)
                    e.currentTarget.style.background = 'transparent'
                }}
              >
                {/* Check icône à gauche pour l'item courant, sinon réserve
                    de l'espace pour aligner */}
                <span
                  className="w-3.5 h-3.5 inline-flex items-center justify-center shrink-0"
                  style={{ color: 'var(--blue)' }}
                >
                  {checked && <Check className="w-3 h-3" />}
                </span>
                {opt.colorBg ? (
                  <span
                    className="px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ background: opt.colorBg, color: opt.colorFg }}
                  >
                    {opt.label}
                  </span>
                ) : (
                  <span className="truncate" style={{ color: 'var(--txt)' }}>
                    {opt.label}
                  </span>
                )}
              </button>
            )
          })}
          {!hideClear && isActive && (
            <div style={{ borderTop: '1px solid var(--brd-sub)' }}>
              <button
                type="button"
                onClick={() => {
                  onSelect(defaultKey ?? null)
                  setOpen(false)
                }}
                className="w-full px-3 py-2 text-left text-[11px]"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                Effacer la sélection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tri (MUS-3.2) ──────────────────────────────────────────────────────────

const SORT_OPTIONS = [
  { key: 'manual', label: 'Ordre manuel (drag)' },
  { key: 'created_desc', label: 'Ajout récent' },
  { key: 'created_asc', label: 'Ajout ancien' },
  { key: 'note_desc', label: 'Note ★ desc' },
  { key: 'bpm_asc', label: 'BPM croissant' },
  { key: 'bpm_desc', label: 'BPM décroissant' },
  { key: 'titre_asc', label: 'Titre A→Z' },
  { key: 'artiste_asc', label: 'Artiste A→Z' },
  { key: 'comments_desc', label: 'Plus commenté' },
  { key: 'statut', label: 'Par statut' },
]

function sortPropositions(list, mode, aggregates) {
  const arr = [...list]
  const getAgg = (p) =>
    aggregates.get(p.id) || {
      noteAvg: null,
      noteCount: 0,
      commentCount: 0,
    }
  const artistName = (p) => p.artiste?.nom || p.artiste_text || '~'
  const bpm = (p) => p.audio_features?.tempo || 0
  switch (mode) {
    case 'manual':
      // sort_order ASC (rows avec NULL tombent à la fin par created_at desc)
      arr.sort((a, b) => {
        const ao = a.sort_order ?? null
        const bo = b.sort_order ?? null
        if (ao == null && bo == null) {
          return new Date(b.created_at) - new Date(a.created_at)
        }
        if (ao == null) return 1
        if (bo == null) return -1
        return ao - bo
      })
      break
    case 'created_asc':
      arr.sort(
        (a, b) =>
          new Date(a.created_at) - new Date(b.created_at),
      )
      break
    case 'note_desc':
      arr.sort((a, b) => (getAgg(b).noteAvg ?? -1) - (getAgg(a).noteAvg ?? -1))
      break
    case 'bpm_asc':
      arr.sort((a, b) => (bpm(a) || 999) - (bpm(b) || 999))
      break
    case 'bpm_desc':
      arr.sort((a, b) => (bpm(b) || 0) - (bpm(a) || 0))
      break
    case 'titre_asc':
      arr.sort((a, b) =>
        (a.titre || '').localeCompare(b.titre || '', 'fr', {
          sensitivity: 'base',
        }),
      )
      break
    case 'artiste_asc':
      arr.sort((a, b) =>
        artistName(a).localeCompare(artistName(b), 'fr', {
          sensitivity: 'base',
        }),
      )
      break
    case 'comments_desc':
      arr.sort(
        (a, b) => getAgg(b).commentCount - getAgg(a).commentCount,
      )
      break
    case 'statut': {
      const order = [
        'accorde',
        'en_nego',
        'valide_festival',
        'selectionne',
        'vrac',
        'refuse',
      ]
      arr.sort(
        (a, b) =>
          order.indexOf(a.statut) - order.indexOf(b.statut) ||
          new Date(b.created_at) - new Date(a.created_at),
      )
      break
    }
    case 'created_desc':
    default:
      arr.sort(
        (a, b) =>
          new Date(b.created_at) - new Date(a.created_at),
      )
  }
  return arr
}

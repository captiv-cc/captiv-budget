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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useOutletContext } from 'react-router-dom'
import {
  Music,
  Plus,
  Search,
  Sparkles,
  ImageUp,
  Inbox,
} from 'lucide-react'
import {
  listPropositions,
  listAllNotes,
  listAllTags,
  computeAggregates,
  subscribeToProject,
  STATUT_LABELS,
} from '../../lib/musiques'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import AddPropositionModal from '../../features/musiques/AddPropositionModal'

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filtres locaux (recherche, statut)
  const [searchLocal, setSearchLocal] = useState('')
  const [filterStatut, setFilterStatut] = useState(null)

  // Modals
  const [addOpen, setAddOpen] = useState(false)

  // ─── Chargement initial ────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!projectId) return
    setError(null)
    try {
      const [propsData, notesData, tagsData] = await Promise.all([
        listPropositions(projectId, { sort: 'created_at_desc' }),
        listAllNotes(projectId),
        listAllTags(projectId),
      ])
      setPropositions(propsData)
      setNotes(notesData)
      setTags(tagsData)
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

  // ─── Agrégats (note moyenne + tags) côté front ────────────────────────────
  const aggregates = useMemo(
    () => computeAggregates(notes, tags, user?.id || null),
    [notes, tags, user?.id],
  )

  // ─── Filtrage local (search + statut) ─────────────────────────────────────
  const visiblePropositions = useMemo(() => {
    const s = searchLocal.trim().toLowerCase()
    return propositions.filter((p) => {
      if (filterStatut && p.statut !== filterStatut) return false
      if (s) {
        const artist = (p.artiste?.nom || p.artiste_text || '').toLowerCase()
        const title = (p.titre || '').toLowerCase()
        if (!artist.includes(s) && !title.includes(s)) return false
      }
      return true
    })
  }, [propositions, searchLocal, filterStatut])

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
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ─── Header : titre + actions ──────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Music size={18} style={{ color: 'var(--txt-2)' }} />
          <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--txt)' }}>
            Musiques
          </span>
          {!loading && (
            <span
              style={{
                fontSize: 11,
                background: 'var(--bg-elev)',
                color: 'var(--txt-3)',
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {propositions.length} proposition{propositions.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Search bar locale (typeahead sur propositions chargées).
            La recherche externe Deezer/YouTube sera dans la modal d'ajout. */}
        <div
          style={{
            flex: 1,
            minWidth: 220,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
            height: 34,
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 6,
          }}
        >
          <Search size={14} style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            placeholder="Filtrer par artiste ou titre…"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--txt)',
              fontSize: 13,
            }}
          />
          <Sparkles
            size={13}
            style={{
              color: 'var(--txt-3)',
              opacity: 0.4,
            }}
            title="Recherche intelligente bientôt — pour ajouter, utilise +Ajouter"
          />
        </div>

        {/* Filtre statut */}
        <select
          value={filterStatut || ''}
          onChange={(e) => setFilterStatut(e.target.value || null)}
          style={{
            height: 34,
            padding: '0 10px',
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 6,
            color: 'var(--txt-2)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          <option value="">Tous les statuts</option>
          {Object.entries(STATUT_LABELS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>

        {/* Actions edit (gated canEdit) */}
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => alert('ImportAffiche modal — MUS-1.10')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 10px',
                height: 34,
                background: 'transparent',
                border: '1px solid var(--brd-sub)',
                color: 'var(--txt-2)',
                borderRadius: 6,
                fontSize: 12,
                cursor: 'pointer',
              }}
              title="Importer la programmation depuis une affiche (Claude Vision)"
            >
              <ImageUp size={13} />
              Importer affiche
            </button>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '0 12px',
                height: 34,
                background: 'var(--blue, #3B82F6)',
                color: 'white',
                border: '1px solid var(--blue, #3B82F6)',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <Plus size={13} />
              Ajouter
            </button>
          </>
        )}
      </div>

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

      {/* ─── Liste propositions (rendu inline — MUS-1.11 fera PropositionRow) ── */}
      {!loading && visiblePropositions.length > 0 && (
        <div
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd-sub)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          {visiblePropositions.map((p, idx) => {
            const agg = aggregates.get(p.id) || {
              noteAvg: null,
              noteCount: 0,
              myNote: null,
              tags: [],
            }
            const artistName = p.artiste?.nom || p.artiste_text || '—'
            return (
              <div
                key={p.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '36px 1fr auto',
                  gap: 12,
                  padding: '10px 14px',
                  borderBottom:
                    idx < visiblePropositions.length - 1
                      ? '1px solid var(--brd-sub)'
                      : 'none',
                  alignItems: 'center',
                }}
              >
                {/* Cover (placeholder MUS-1.11 fera initiales ou cover_url) */}
                <div
                  style={{
                    width: 36,
                    height: 36,
                    background: p.cover_url ? 'transparent' : 'var(--bg-elev)',
                    backgroundImage: p.cover_url ? `url(${p.cover_url})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--txt-3)',
                  }}
                >
                  {!p.cover_url && (artistName[0] || '?').toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 6,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: 'var(--txt)',
                      }}
                    >
                      {artistName}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--txt-3)' }}>·</span>
                    <span style={{ fontSize: 13, color: 'var(--txt-2)' }}>
                      {p.titre}
                    </span>
                    {p.artiste?.jour && (
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 5px',
                          background: 'rgba(59,130,246,0.12)',
                          color: 'var(--blue, #3B82F6)',
                          borderRadius: 6,
                        }}
                      >
                        Joue {p.artiste.jour}
                        {p.artiste.scene ? ` · ${p.artiste.scene}` : ''}
                      </span>
                    )}
                  </div>
                  {agg.tags.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        marginTop: 4,
                        flexWrap: 'wrap',
                      }}
                    >
                      {agg.tags.slice(0, 5).map((t) => (
                        <span
                          key={t.id}
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            background: 'var(--bg-elev)',
                            color: 'var(--txt-3)',
                            borderRadius: 8,
                          }}
                        >
                          {t.tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-end',
                    gap: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: agg.noteAvg ? '#B68B0E' : 'var(--txt-3)',
                    }}
                  >
                    {agg.noteAvg ? `★ ${agg.noteAvg}` : '— pas noté —'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--txt-3)' }}>
                    {agg.noteCount > 0
                      ? `${agg.noteCount} vote${agg.noteCount > 1 ? 's' : ''}`
                      : (
                        <span
                          style={{
                            padding: '0 5px',
                            background: 'var(--bg-elev)',
                            borderRadius: 6,
                          }}
                        >
                          {STATUT_LABELS[p.statut] || p.statut}
                        </span>
                      )}
                  </span>
                </div>
              </div>
            )
          })}
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
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MoodboardTab — Onglet Moodboard d'un projet (MOD-1.4)
// ════════════════════════════════════════════════════════════════════════════
//
// Page principale du module Moodboard. Affiche les sections nommées et leur
// masonry de cartes (link / image / video / note). Permet :
//   - Paste-anywhere d'URLs / fichiers / images clipboard
//   - Drag-drop entre sections
//   - Drawer détail par carte (commentaires + réactions emoji)
//   - Création de sections et de cartes note
//
// Orchestre :
//   - Fetch initial (sections + cards + comments + reactions)
//   - ensureDefaultSection "Vrac" si vide
//   - Realtime subscriptions sur les 4 tables → refetch granulaire
//   - PasteHandler global pour ajout rapide
//
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Image as ImageIcon,
  Plus,
  Inbox,
  StickyNote,
  MessageCircle,
  Sparkles,
} from 'lucide-react'
import {
  listSections,
  listCardsForProject,
  listAllComments,
  listAllReactions,
  ensureDefaultSection,
  createSection,
  createCard,
  aggregateReactions,
  subscribeToProject,
} from '../../lib/moodboard'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../lib/notify'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import SectionList from '../../features/moodboard/SectionList'
import CardDrawer from '../../features/moodboard/CardDrawer'
import PasteHandler from '../../features/moodboard/PasteHandler'

const OUTIL_KEY = 'moodboard'

export default function MoodboardTab() {
  const { id: projectId } = useParams()
  const { user } = useAuth() || {}
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

  // ─── State ────────────────────────────────────────────────────────────────
  const [sections, setSections] = useState([])
  const [cards, setCards] = useState([])
  const [comments, setComments] = useState([])
  const [reactions, setReactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Drawer detail : ID de la carte ouverte (null = fermé)
  const [drawerCardId, setDrawerCardId] = useState(null)

  // ─── Fetch initial ────────────────────────────────────────────────────────
  const refetch = useCallback(async () => {
    if (!projectId) return
    try {
      setError(null)
      const [sec, crd, cmt, rea] = await Promise.all([
        listSections(projectId),
        listCardsForProject(projectId),
        listAllComments(projectId),
        listAllReactions(projectId),
      ])
      setSections(sec)
      setCards(crd)
      setComments(cmt)
      setReactions(rea)
    } catch (e) {
      console.warn('[MoodboardTab] fetch failed', e)
      setError(e?.message || 'Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    refetch()
  }, [refetch])

  // Auto-création de la section "Vrac" si la liste est vide au 1er fetch.
  // On le fait UNE FOIS après le 1er chargement réussi pour éviter les
  // boucles si la création échoue (RLS, etc.).
  const [bootstrapped, setBootstrapped] = useState(false)
  useEffect(() => {
    if (!projectId || loading || bootstrapped) return
    if (!canEdit) {
      // Si lecture seule et pas de section → on laisse vide
      setBootstrapped(true)
      return
    }
    if (sections.length === 0) {
      ensureDefaultSection(projectId)
        .then(() => refetch())
        .catch((e) => console.warn('[MoodboardTab] ensureDefault KO', e))
        .finally(() => setBootstrapped(true))
    } else {
      setBootstrapped(true)
    }
  }, [projectId, loading, sections.length, canEdit, bootstrapped, refetch])

  // ─── Realtime ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!projectId) return undefined
    const sub = subscribeToProject(projectId, {
      onSectionChange: () => refetch(),
      onCardChange: () => refetch(),
      onCommentChange: () => refetch(),
      onReactionChange: () => refetch(),
    })
    return () => sub.unsubscribe()
  }, [projectId, refetch])

  // ─── Dérivés ──────────────────────────────────────────────────────────────

  // Map<sectionId, cards[]> triée par sort_order
  const cardsBySection = useMemo(() => {
    const m = new Map()
    for (const s of sections) m.set(s.id, [])
    for (const c of cards) {
      if (!m.has(c.section_id)) m.set(c.section_id, [])
      m.get(c.section_id).push(c)
    }
    // Tri par sort_order (les fetches le font déjà mais sécu)
    for (const arr of m.values()) {
      arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    }
    return m
  }, [sections, cards])

  // Map<cardId, comment[]> et count par carte
  const commentsByCard = useMemo(() => {
    const m = new Map()
    for (const c of comments) {
      if (!m.has(c.card_id)) m.set(c.card_id, [])
      m.get(c.card_id).push(c)
    }
    return m
  }, [comments])

  // Reactions aggregées par carte
  const reactionsByCard = useMemo(
    () => aggregateReactions(reactions, user?.id || null),
    [reactions, user?.id],
  )

  // Compteurs header
  const stats = useMemo(
    () => ({
      sections: sections.length,
      cards: cards.length,
      withComments: new Set(comments.map((c) => c.card_id)).size,
      withReactions: new Set(reactions.map((r) => r.card_id)).size,
    }),
    [sections.length, cards.length, comments, reactions],
  )

  // Carte actuellement ouverte dans le drawer (dérivée depuis cards pour
  // toujours avoir la version fraîche après refetch)
  const drawerCard = useMemo(
    () => cards.find((c) => c.id === drawerCardId) || null,
    [cards, drawerCardId],
  )

  // ─── Handlers ─────────────────────────────────────────────────────────────

  // Ajout d'une section nommée "Nouvelle section" — l'utilisateur la
  // renomme inline après création (UX simple : ne pas demander le nom
  // avant). Append en fin de liste.
  const handleAddSection = useCallback(async () => {
    if (!projectId || !canEdit) return
    try {
      await createSection(projectId, { nom: 'Nouvelle section' })
      // Realtime catch → refetch
    } catch (e) {
      notify.error(e?.message || 'Création section impossible')
    }
  }, [projectId, canEdit])

  // Ajout d'une carte note vide dans la 1re section (ou la section "Vrac"
  // si elle existe). À étoffer en MOD-1.6 si on veut choisir la section.
  const handleAddNote = useCallback(async () => {
    if (!projectId || !canEdit) return
    const target = sections[0]
    if (!target) {
      notify.error('Aucune section disponible')
      return
    }
    try {
      const card = await createCard(target.id, {
        type: 'note',
        title: 'Nouvelle note',
        content_json: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [] }],
        },
      })
      // Ouvre directement le drawer pour édition
      setDrawerCardId(card.id)
    } catch (e) {
      notify.error(e?.message || 'Création note impossible')
    }
  }, [projectId, canEdit, sections])

  // ─── Permission denied ────────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div
        className="flex flex-col items-center justify-center p-12 text-center"
        style={{ color: 'var(--txt-3)' }}
      >
        <ImageIcon size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
        <div style={{ fontSize: 14 }}>
          Tu n&apos;as pas accès au module Moodboard pour ce projet.
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* PasteHandler global : capte paste/drop sur la page et crée les
          cartes correspondantes. Aucun rendu visible — composant utilitaire. */}
      {canEdit && (
        <PasteHandler
          projectId={projectId}
          sections={sections}
          onCreated={refetch}
        />
      )}

      {/* ─── Header (pattern aligné Livrables/Matériel/Musiques) ────────── */}
      <div
        className="flex flex-col gap-3 px-5 py-4"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          {/* Icon block — violet/rose pour identifier le module */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(236,72,153,0.15)' }}
          >
            <ImageIcon className="w-5 h-5" style={{ color: '#EC4899' }} />
          </div>
          <div className="min-w-0">
            <h1
              className="text-lg font-bold"
              style={{ color: 'var(--txt)' }}
            >
              Moodboard
            </h1>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {stats.cards}{' '}
              {stats.cards > 1 ? 'cartes' : 'carte'}
              {stats.sections > 0 && (
                <>
                  {' '}· {stats.sections} section{stats.sections > 1 ? 's' : ''}
                </>
              )}
              {stats.withComments > 0 && (
                <>
                  {' '}· {stats.withComments} commentée
                  {stats.withComments > 1 ? 's' : ''}
                </>
              )}
            </p>
          </div>

          {/* Stat pills */}
          <div className="flex items-center gap-2 flex-wrap ml-0 sm:ml-4">
            <StatPill
              label="Total"
              value={stats.cards}
              icon={Inbox}
              color="var(--txt-2)"
              bg="var(--bg-2, var(--bg-elev))"
            />
            <StatPill
              label="Commentées"
              value={stats.withComments}
              icon={MessageCircle}
              color="var(--blue, #3B82F6)"
              bg="rgba(59,130,246,0.18)"
              dim={stats.withComments === 0}
            />
            <StatPill
              label="Réagi"
              value={stats.withReactions}
              icon={Sparkles}
              color="#EC4899"
              bg="rgba(236,72,153,0.18)"
              dim={stats.withReactions === 0}
            />
          </div>

          {/* CTAs primaires */}
          {canEdit && (
            <div className="flex items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={handleAddNote}
                title="Ajouter une note libre (texte riche)"
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
                <StickyNote className="w-3 h-3" />
                Note
              </button>
              <button
                type="button"
                onClick={handleAddSection}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all shrink-0"
                style={{
                  background: 'var(--blue, #3B82F6)',
                  color: 'white',
                  border: '1px solid var(--blue, #3B82F6)',
                }}
              >
                <Plus className="w-3 h-3" />
                Section
              </button>
            </div>
          )}
        </div>

        {/* Sous-titre d'aide pour le paste */}
        {canEdit && (
          <p
            className="text-[11px]"
            style={{ color: 'var(--txt-3)' }}
          >
            Astuce — colle (Ctrl+V) une URL, une image, ou glisse un
            fichier n&apos;importe où sur la page pour ajouter une carte.
          </p>
        )}
      </div>

      {/* ─── Body ──────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
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

        {loading && (
          <div
            style={{
              padding: '40px 12px',
              textAlign: 'center',
              color: 'var(--txt-3)',
              fontSize: 13,
            }}
          >
            Chargement du moodboard…
          </div>
        )}

        {!loading && sections.length === 0 && (
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
            <ImageIcon size={28} style={{ opacity: 0.5 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--txt-2)' }}>
              Aucune section pour le moment
            </div>
            <div style={{ fontSize: 12, maxWidth: 460 }}>
              Crée une section pour organiser tes refs (Lumière, Mouvement,
              Refs client…), puis colle des URLs ou glisse des fichiers pour
              alimenter chaque section.
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={handleAddSection}
                className="mt-3 inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded transition-colors"
                style={{ background: 'var(--blue)', color: 'white' }}
              >
                <Plus className="w-3.5 h-3.5" />
                Créer la 1re section
              </button>
            )}
          </div>
        )}

        {!loading && sections.length > 0 && (
          <SectionList
            sections={sections}
            cardsBySection={cardsBySection}
            commentsByCard={commentsByCard}
            reactionsByCard={reactionsByCard}
            canEdit={canEdit}
            projectId={projectId}
            onMutated={refetch}
            onOpenCard={(card) => setDrawerCardId(card.id)}
          />
        )}
      </div>

      {/* Drawer détail carte */}
      <CardDrawer
        open={Boolean(drawerCard)}
        card={drawerCard}
        comments={drawerCard ? commentsByCard.get(drawerCard.id) || [] : []}
        reactionAgg={
          drawerCard
            ? reactionsByCard.get(drawerCard.id) || {
                counts: { thumbs_up: 0, heart: 0, fire: 0, zap: 0 },
                mine: new Set(),
              }
            : null
        }
        canEdit={canEdit}
        currentUserId={user?.id || null}
        onClose={() => setDrawerCardId(null)}
        onMutated={refetch}
      />
    </div>
  )
}

// ─── StatPill (pattern aligné Musiques/Livrables) ──────────────────────────
function StatPill({ label, value, icon: Icon, color, bg, dim = false, title }) {
  return (
    <div
      className="flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full shrink-0"
      style={{
        background: bg,
        color,
        border: `1px solid ${color}`,
        opacity: dim ? 0.55 : 1,
      }}
      title={title || `${value} ${label}`}
    >
      {Icon && <Icon className="w-3 h-3" />}
      <span className="tabular-nums">{value}</span>
      <span
        className="text-[11px] font-medium"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
    </div>
  )
}

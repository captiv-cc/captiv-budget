// ════════════════════════════════════════════════════════════════════════════
// DuplicateToProjectModal — modal duplication cross-project (LIV-13)
// ════════════════════════════════════════════════════════════════════════════
//
// Modal générique pour dupliquer un livrable OU un bloc entier vers un autre
// projet. Sémantique :
//   - mode 'livrable' : duplique 1 livrable. L'utilisateur choisit projet cible
//                       + bloc cible (sélecteur ou "+ Nouveau bloc importé").
//                       Versions/étapes du livrable source NON dupliquées
//                       (feuille blanche, cohérent avec LIV-12).
//   - mode 'bloc'     : duplique le bloc + tous ses livrables actifs (chacun
//                       en feuille blanche). Pas de sélecteur de bloc cible —
//                       on crée un nouveau bloc dans le projet cible avec le
//                       même nom (suffixé "(copie)" si conflit).
//
// La liste des projets cible utilise `listAccessibleProjects` (RLS filtre
// côté DB ce que l'user voit). Pas de pré-filter sur OUTILS.LIVRABLES.can_edit
// côté client — si l'user n'a pas les droits, l'opération échoue en RLS et on
// affiche l'erreur.
//
// Le livrable / bloc créé est dans un AUTRE projet → pas d'optimistic update.
// L'utilisateur le verra au prochain mount du projet cible (ou via realtime
// si l'autre onglet est ouvert).
//
// Props :
//   - mode             : 'livrable' | 'bloc'
//   - source           : { id, label } — élément à dupliquer (label affiché)
//   - currentProjectId : à exclure de la liste cible
//   - actions          : `useLivrables.actions` (du projet courant)
//   - onClose          : () => void
//   - onSuccess        : (result) => void — appelé après dup réussie. result =
//                        { targetProject, targetProjectId, livrableId? | block? }
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Copy, ListTodo, Loader2, Search, X } from 'lucide-react'
import * as L from '../../../lib/livrables'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'

const NEW_BLOCK_SENTINEL = '__new__'

export default function DuplicateToProjectModal({
  mode,
  source,
  currentProjectId,
  actions,
  onClose,
  onSuccess,
}) {
  const { org } = useAuth()
  const orgId = org?.id

  // ─── État liste projets ──────────────────────────────────────────────────
  const [projects, setProjects] = useState([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState(null)
  const [search, setSearch] = useState('')

  // ─── Sélection ──────────────────────────────────────────────────────────
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [blocksLoading, setBlocksLoading] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState(NEW_BLOCK_SENTINEL)

  // ─── Submit state ────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)

  // Escape pour fermer.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Charge la liste des projets au mount.
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setProjectsLoading(true)
    L.listAccessibleProjects({ orgId, excludeProjectId: currentProjectId })
      .then((data) => {
        if (!cancelled) {
          setProjects(data)
          setProjectsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setProjectsError(err)
          setProjectsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [orgId, currentProjectId])

  // Charge les blocs du projet sélectionné (uniquement en mode livrable).
  useEffect(() => {
    if (mode !== 'livrable' || !selectedProjectId) {
      setBlocks([])
      setSelectedBlockId(NEW_BLOCK_SENTINEL)
      return
    }
    let cancelled = false
    setBlocksLoading(true)
    L.listBlocksForProject(selectedProjectId)
      .then((data) => {
        if (!cancelled) {
          setBlocks(data)
          // Default = nouveau bloc si pas de blocs existants, sinon le premier.
          setSelectedBlockId(data.length > 0 ? data[0].id : NEW_BLOCK_SENTINEL)
          setBlocksLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBlocks([])
          setBlocksLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mode, selectedProjectId])

  // Filtre projets par recherche.
  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return projects
    return projects.filter((p) => (p.title || '').toLowerCase().includes(q))
  }, [projects, search])

  // ─── Submit ──────────────────────────────────────────────────────────────
  const canSubmit = Boolean(selectedProjectId) && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const targetProject = projects.find((p) => p.id === selectedProjectId)
      if (mode === 'livrable') {
        const targetBlockId =
          selectedBlockId === NEW_BLOCK_SENTINEL ? undefined : selectedBlockId
        const dup = await actions.duplicateLivrableToProject(
          source.id,
          selectedProjectId,
          targetBlockId ? { targetBlockId } : {},
        )
        notify.success(`Livrable dupliqué dans « ${targetProject?.title || 'le projet'} »`)
        onSuccess?.({
          targetProject,
          targetProjectId: selectedProjectId,
          livrable: dup,
        })
      } else {
        // mode === 'bloc'
        const result = await actions.duplicateBlockToProject(
          source.id,
          selectedProjectId,
        )
        notify.success(
          `Bloc dupliqué (${result.livrablesCount} livrable${result.livrablesCount > 1 ? 's' : ''}) dans « ${targetProject?.title || 'le projet'} »`,
        )
        onSuccess?.({
          targetProject,
          targetProjectId: selectedProjectId,
          block: result.block,
          livrablesCount: result.livrablesCount,
        })
      }
      onClose?.()
    } catch (err) {
      notify.error('Duplication impossible : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }, [
    actions,
    canSubmit,
    mode,
    onClose,
    onSuccess,
    projects,
    selectedBlockId,
    selectedProjectId,
    source,
  ])

  const titleIcon = mode === 'bloc' ? ListTodo : Copy
  const TitleIcon = titleIcon
  const titleText = mode === 'bloc' ? 'Dupliquer le bloc dans un autre projet' : 'Dupliquer le livrable dans un autre projet'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
        aria-hidden
      />

      {/* Modal centered */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-label={titleText}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose?.()
        }}
      >
        <div
          className="rounded-xl shadow-2xl w-full flex flex-col"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd)',
            maxWidth: '520px',
            maxHeight: 'calc(100vh - 32px)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <header
            className="flex items-center gap-3 px-5 py-4"
            style={{ borderBottom: '1px solid var(--brd-sub)' }}
          >
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'var(--blue-bg)' }}
            >
              <TitleIcon className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                className="text-base font-bold truncate"
                style={{ color: 'var(--txt)' }}
              >
                {titleText}
              </h2>
              <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                {mode === 'bloc' ? 'Bloc' : 'Livrable'} : <strong>{source?.label || '—'}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fermer"
              className="p-1.5 rounded-md"
              style={{ color: 'var(--txt-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-hov)'
                e.currentTarget.style.color = 'var(--txt)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
            >
              <X className="w-4 h-4" />
            </button>
          </header>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
            {/* Étape 1 — choisir un projet */}
            <div>
              <label
                className="block text-[11px] uppercase tracking-wider mb-2"
                style={{ color: 'var(--txt-3)' }}
              >
                1. Projet cible
              </label>
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-2"
                style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
              >
                <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher un projet…"
                  className="flex-1 bg-transparent focus:outline-none text-sm"
                  style={{ color: 'var(--txt)' }}
                  autoFocus
                />
              </div>
              <ProjectsList
                projects={filteredProjects}
                loading={projectsLoading}
                error={projectsError}
                selected={selectedProjectId}
                onSelect={setSelectedProjectId}
              />
            </div>

            {/* Étape 2 — choisir un bloc cible (mode livrable uniquement) */}
            {mode === 'livrable' && selectedProjectId && (
              <div>
                <label
                  className="block text-[11px] uppercase tracking-wider mb-2"
                  style={{ color: 'var(--txt-3)' }}
                >
                  2. Bloc cible
                </label>
                <BlocksSelect
                  blocks={blocks}
                  loading={blocksLoading}
                  selected={selectedBlockId}
                  onSelect={setSelectedBlockId}
                />
              </div>
            )}
          </div>

          {/* Footer */}
          <footer
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="text-sm px-3 py-2 rounded-lg"
              style={{ color: 'var(--txt-3)' }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg"
              style={{
                background: canSubmit ? 'var(--blue)' : 'var(--bg-2)',
                color: canSubmit ? '#fff' : 'var(--txt-3)',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Duplication…
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Dupliquer
                </>
              )}
            </button>
          </footer>
        </div>
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// ProjectsList — liste cliquable des projets accessibles
// ════════════════════════════════════════════════════════════════════════════

function ProjectsList({ projects, loading, error, selected, onSelect }) {
  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-8 text-xs"
        style={{ color: 'var(--txt-3)' }}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
        Chargement…
      </div>
    )
  }
  if (error) {
    return (
      <div
        className="text-xs px-3 py-2 rounded"
        style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
      >
        Erreur de chargement : {String(error?.message || error)}
      </div>
    )
  }
  if (projects.length === 0) {
    return (
      <div
        className="text-xs italic py-6 text-center"
        style={{ color: 'var(--txt-3)' }}
      >
        Aucun projet accessible.
      </div>
    )
  }
  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden"
      style={{
        border: '1px solid var(--brd-sub)',
        maxHeight: '240px',
        overflowY: 'auto',
      }}
    >
      {projects.map((p) => {
        const isSelected = p.id === selected
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSelect(p.id)}
            className="flex items-center gap-2 px-3 py-2 text-left transition-colors text-sm"
            style={{
              background: isSelected ? 'var(--blue-bg)' : 'transparent',
              color: isSelected ? 'var(--blue)' : 'var(--txt)',
              borderBottom: '1px solid var(--brd-sub)',
              fontWeight: isSelected ? 600 : 400,
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'transparent'
            }}
          >
            <span className="flex-1 min-w-0 truncate">{p.title || 'Sans titre'}</span>
            <StatusPill status={p.status} />
          </button>
        )
      })}
    </div>
  )
}

function StatusPill({ status }) {
  const map = {
    en_cours: { label: 'En cours', bg: 'var(--blue-bg)', color: 'var(--blue)' },
    prospect: { label: 'Prospect', bg: 'var(--orange-bg)', color: 'var(--orange)' },
    termine: { label: 'Terminé', bg: 'var(--green-bg)', color: 'var(--green)' },
    archive: { label: 'Archivé', bg: 'var(--bg-2)', color: 'var(--txt-3)' },
  }
  const s = map[status] || { label: status || '—', bg: 'var(--bg-2)', color: 'var(--txt-3)' }
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// BlocksSelect — sélecteur radio des blocs du projet cible
// ════════════════════════════════════════════════════════════════════════════

function BlocksSelect({ blocks, loading, selected, onSelect }) {
  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-3 text-xs"
        style={{ color: 'var(--txt-3)' }}
      >
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
        Chargement des blocs…
      </div>
    )
  }
  return (
    <div
      className="flex flex-col rounded-lg overflow-hidden"
      style={{ border: '1px solid var(--brd-sub)' }}
    >
      {blocks.map((b) => {
        const isSelected = b.id === selected
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onSelect(b.id)}
            className="flex items-center gap-2 px-3 py-2 text-left text-sm"
            style={{
              background: isSelected ? 'var(--blue-bg)' : 'transparent',
              borderBottom: '1px solid var(--brd-sub)',
              fontWeight: isSelected ? 600 : 400,
              color: isSelected ? 'var(--blue)' : 'var(--txt)',
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'var(--bg-hov)'
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.background = 'transparent'
            }}
          >
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: b.couleur || '#94a3b8' }}
            />
            <span className="flex-1 min-w-0 truncate">{b.nom || 'Sans nom'}</span>
            {b.prefixe && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-2)', color: 'var(--txt-3)' }}
              >
                {b.prefixe}
              </span>
            )}
          </button>
        )
      })}
      {/* Toujours offrir l'option "Nouveau bloc" en bas */}
      <button
        type="button"
        onClick={() => onSelect(NEW_BLOCK_SENTINEL)}
        className="flex items-center gap-2 px-3 py-2 text-left text-sm italic"
        style={{
          background:
            selected === NEW_BLOCK_SENTINEL ? 'var(--blue-bg)' : 'transparent',
          color:
            selected === NEW_BLOCK_SENTINEL ? 'var(--blue)' : 'var(--txt-2)',
          fontWeight: selected === NEW_BLOCK_SENTINEL ? 600 : 400,
        }}
        onMouseEnter={(e) => {
          if (selected !== NEW_BLOCK_SENTINEL)
            e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          if (selected !== NEW_BLOCK_SENTINEL)
            e.currentTarget.style.background = 'transparent'
        }}
      >
        <span className="text-base shrink-0">+</span>
        <span className="flex-1">Nouveau bloc « Importé »</span>
      </button>
    </div>
  )
}

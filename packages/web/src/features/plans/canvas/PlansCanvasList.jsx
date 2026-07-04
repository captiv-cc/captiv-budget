// ════════════════════════════════════════════════════════════════════════════
// PlansCanvasList — liste des plans techniques éditables d'un projet
// ════════════════════════════════════════════════════════════════════════════
//
// V0 POC : grille de cards simples (titre, catégorie, date), création par
// prompt de titre, ouverture de l'éditeur via ?canvas=<id>, archivage.
// Preview miniature (snapshot_svg) et présence live : Phase 2.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Loader2, PenTool, Plus, RotateCcw, Trash2 } from 'lucide-react'
import {
  listCanvases,
  createCanvas,
  archiveCanvas,
  restoreCanvas,
  deleteCanvas,
} from '../../../lib/plansCanvas'
import { listPlanCategories } from '../../../lib/plans'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'
import { confirm } from '../../../lib/confirm'

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export default function PlansCanvasList({ projectId, orgId, canEdit, archived = false, onOpen }) {
  const { user } = useAuth()
  const [rows, setRows] = useState(null)
  const [categories, setCategories] = useState([])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listCanvases(projectId, { includeArchived: true })
      setRows(data)
    } catch (err) {
      // Table pas encore migrée → message clair plutôt qu'un crash.
      notify.error('Plans éditables indisponibles : ' + (err?.message || err))
      setRows([])
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!orgId) return
    listPlanCategories(orgId).then(setCategories).catch(() => {})
  }, [orgId])

  const catById = useMemo(() => {
    const m = new Map()
    categories.forEach((c) => m.set(c.id, c))
    return m
  }, [categories])

  const visible = useMemo(
    () => (rows || []).filter((r) => (archived ? r.statut === 'archive' : r.statut !== 'archive')),
    [rows, archived],
  )

  async function handleCreate() {
    const titre = window.prompt('Titre du plan ?', 'Plan caméra')
    if (!titre?.trim()) return
    setCreating(true)
    try {
      const row = await createCanvas({ projectId, titre, userId: user?.id })
      setRows((prev) => [row, ...(prev || [])])
      onOpen?.(row.id)
    } catch (err) {
      notify.error('Création impossible : ' + (err?.message || err))
    } finally {
      setCreating(false)
    }
  }

  async function handleArchive(row) {
    try {
      await archiveCanvas(row.id)
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, statut: 'archive' } : r)))
      notify.success('Plan archivé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleRestore(row) {
    try {
      await restoreCanvas(row.id)
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, statut: 'brouillon' } : r)))
      notify.success('Plan restauré')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  async function handleDelete(row) {
    const ok = await confirm({
      title: 'Supprimer définitivement',
      message: `« ${row.titre} » et son contenu seront effacés. Cette action est irréversible.`,
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteCanvas(row.id)
      setRows((prev) => prev.filter((r) => r.id !== row.id))
      notify.success('Plan supprimé')
    } catch (err) {
      notify.error('Erreur : ' + (err?.message || err))
    }
  }

  if (rows === null) {
    return (
      <div className="flex items-center gap-2 text-sm py-8" style={{ color: 'var(--txt-3)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Chargement…
      </div>
    )
  }

  return (
    <div>
      {canEdit && !archived && (
        <div className="mb-4">
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-md transition-colors"
            style={{ background: 'var(--blue)', color: '#fff', opacity: creating ? 0.6 : 1 }}
          >
            <Plus className="w-4 h-4" />
            Nouveau plan
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <div
          className="flex flex-col items-center gap-2 py-14 rounded-xl text-center"
          style={{ border: '1px dashed var(--brd)', color: 'var(--txt-3)' }}
        >
          <PenTool className="w-6 h-6" />
          <div className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {archived ? 'Aucun plan archivé' : 'Aucun plan éditable'}
          </div>
          {!archived && (
            <div className="text-xs max-w-sm">
              Dessine un plan caméra, lumière ou son directement dans le desk,
              à plusieurs et en temps réel.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((row) => {
            const cat = row.category_id ? catById.get(row.category_id) : null
            return (
              <div
                key={row.id}
                role="button"
                tabIndex={0}
                onClick={() => !archived && onOpen?.(row.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !archived) onOpen?.(row.id)
                }}
                className="group rounded-xl p-3.5 cursor-pointer transition-colors"
                style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brd-hov, var(--txt-3))' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--brd)' }}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'var(--blue-bg)' }}
                  >
                    <PenTool className="w-4 h-4" style={{ color: cat?.color || 'var(--blue)' }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                      {row.titre}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                      {cat && (
                        <span
                          className="px-1.5 py-0.5 rounded font-semibold"
                          style={{ background: `${cat.color}22`, color: cat.color }}
                        >
                          {cat.label}
                        </span>
                      )}
                      <span>Modifié le {fmtDate(row.updated_at)}</span>
                    </div>
                  </div>
                  {canEdit && (
                    <div
                      className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {archived ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleRestore(row)}
                            className="p-1.5 rounded-md"
                            style={{ color: 'var(--txt-3)' }}
                            title="Restaurer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            className="p-1.5 rounded-md"
                            style={{ color: 'var(--red)' }}
                            title="Supprimer définitivement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchive(row)}
                          className="p-1.5 rounded-md"
                          style={{ color: 'var(--txt-3)' }}
                          title="Archiver"
                        >
                          <Archive className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

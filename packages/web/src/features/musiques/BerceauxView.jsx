// ════════════════════════════════════════════════════════════════════════════
// BerceauxView — liste des berceaux du projet et éditeur
// ════════════════════════════════════════════════════════════════════════════
//
// Le berceau appartient au projet, pas au livrable : on en crée librement,
// on les compare. Le rattachement à un livrable ne sert qu'à hériter d'une
// durée cible.
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import { AudioLines, Loader2, Plus, Trash2 } from 'lucide-react'
import {
  addBloc,
  createBerceau,
  deleteBerceau,
  deleteBloc,
  listBerceaux,
  listBlocs,
  reorderBlocs,
  updateBerceau,
  updateBloc,
} from '../../lib/musiqueBerceaux'
import { formatMs } from '../../lib/musiqueAudio'
import BerceauEditor from './BerceauEditor'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function BerceauxView({
  projectId,
  propositions = [],
  livrables = [],
  canEdit = true,
  userId = null,
}) {
  const [berceaux, setBerceaux] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [blocs, setBlocs] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const rows = await listBerceaux(projectId)
      setBerceaux(rows)
      setCurrentId((prev) => prev || rows[0]?.id || null)
    } catch (err) {
      notify.error('Berceaux : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!currentId) {
      setBlocs([])
      return
    }
    listBlocs(currentId).then(setBlocs).catch((err) => notify.error(String(err?.message || err)))
  }, [currentId])

  const current = berceaux.find((b) => b.id === currentId) || null

  async function handleCreate() {
    try {
      const b = await createBerceau({ projectId, nom: 'Nouveau berceau', userId })
      setBerceaux((prev) => [b, ...prev])
      setCurrentId(b.id)
    } catch (err) {
      notify.error('Création : ' + (err?.message || err))
    }
  }

  async function handleDelete(berceau) {
    const ok = await confirm({
      title: `Supprimer « ${berceau.nom} » ?`,
      message: 'Le montage sera perdu. Les morceaux, eux, restent intacts.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await deleteBerceau(berceau.id)
    setBerceaux((prev) => prev.filter((b) => b.id !== berceau.id))
    if (currentId === berceau.id) setCurrentId(null)
  }

  async function patchBerceau(patch) {
    if (!current) return
    setBerceaux((prev) => prev.map((b) => (b.id === current.id ? { ...b, ...patch } : b)))
    try {
      await updateBerceau(current.id, patch)
    } catch (err) {
      notify.error('Enregistrement : ' + (err?.message || err))
      load()
    }
  }

  async function handleAddBloc(proposition) {
    try {
      const bloc = await addBloc({
        projectId,
        berceauId: currentId,
        proposition,
        sortOrder: blocs.length,
      })
      setBlocs((prev) => [...prev, bloc])
    } catch (err) {
      notify.error(err?.message || String(err))
    }
  }

  async function handleUpdateBloc(bloc, patch) {
    setBlocs((prev) => prev.map((b) => (b.id === bloc.id ? { ...b, ...patch } : b)))
    try {
      await updateBloc(bloc.id, patch)
    } catch (err) {
      notify.error('Coupe : ' + (err?.message || err))
      listBlocs(currentId).then(setBlocs)
    }
  }

  async function handleDeleteBloc(bloc) {
    setBlocs((prev) => prev.filter((b) => b.id !== bloc.id))
    try {
      await deleteBloc(bloc.id)
    } catch (err) {
      notify.error('Suppression : ' + (err?.message || err))
      listBlocs(currentId).then(setBlocs)
    }
  }

  async function handleReorder(ordered) {
    setBlocs(ordered.map((b, i) => ({ ...b, sort_order: i })))
    try {
      await reorderBlocs(ordered)
    } catch (err) {
      notify.error('Ordre : ' + (err?.message || err))
      listBlocs(currentId).then(setBlocs)
    }
  }

  if (loading) {
    return (
      <div className="p-10 text-center">
        <Loader2 className="w-5 h-5 mx-auto animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Sélecteur de berceau */}
      <div className="flex items-center gap-2 flex-wrap">
        {berceaux.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setCurrentId(b.id)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            style={{
              background: b.id === currentId ? 'var(--blue-bg)' : 'var(--bg-surf)',
              color: b.id === currentId ? 'var(--blue)' : 'var(--txt-2)',
              border: `1px solid ${b.id === currentId ? 'var(--blue)' : 'var(--brd-sub)'}`,
            }}
          >
            <AudioLines className="w-3.5 h-3.5" />
            {b.nom}
          </button>
        ))}
        {canEdit && (
          <button
            type="button"
            onClick={handleCreate}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            style={{ color: 'var(--txt-2)', border: '1px dashed var(--brd)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            Nouveau berceau
          </button>
        )}
      </div>

      {!current && (
        <p className="text-xs text-center py-10" style={{ color: 'var(--txt-3)' }}>
          Crée un berceau pour commencer à monter un enchaînement.
        </p>
      )}

      {current && (
        <>
          {/* Réglages du berceau */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              defaultValue={current.nom}
              key={current.id}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== current.nom) patchBerceau({ nom: v })
              }}
              className="text-sm font-bold px-2 py-1 rounded-lg outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            />
            <select
              value={current.livrable_id || ''}
              disabled={!canEdit}
              onChange={(e) => {
                const id = e.target.value || null
                const liv = livrables.find((l) => l.id === id)
                // La durée du livrable devient la cible : c'est tout
                // l'intérêt du rattachement. Elle est stockée en texte
                // (« 04:00 »), d'où la conversion.
                const cible = parseDuree(liv?.duree)
                patchBerceau({
                  livrable_id: id,
                  duree_cible_ms: cible ?? current.duree_cible_ms ?? null,
                })
              }}
              className="text-xs px-2 py-1.5 rounded-lg outline-none"
              style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
            >
              <option value="">Aucun livrable</option>
              {livrables.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nom}
                </option>
              ))}
            </select>
            <label className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--txt-3)' }}>
              Cible
              <input
                type="text"
                defaultValue={current.duree_cible_ms ? formatMs(current.duree_cible_ms) : ''}
                key={`cible-${current.id}-${current.duree_cible_ms}`}
                disabled={!canEdit}
                placeholder="4:00"
                onBlur={(e) => {
                  const ms = parseDuree(e.target.value)
                  if (ms !== current.duree_cible_ms) patchBerceau({ duree_cible_ms: ms })
                }}
                className="w-16 text-xs px-2 py-1 rounded-md outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
              />
            </label>
            {canEdit && (
              <button
                type="button"
                onClick={() => handleDelete(current)}
                className="ml-auto p-1.5"
                style={{ color: 'var(--txt-3)' }}
                title="Supprimer ce berceau"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <BerceauEditor
            berceau={current}
            blocs={blocs}
            propositions={propositions}
            canEdit={canEdit}
            onAddBloc={handleAddBloc}
            onUpdateBloc={handleUpdateBloc}
            onDeleteBloc={handleDeleteBloc}
            onReorder={handleReorder}
          />
        </>
      )}
    </div>
  )
}

/**
 * « 4:00 », « 04:00 », « 1:02:30 » ou « 240 » → millisecondes.
 * Null si illisible : les durées de livrables sont saisies librement.
 */
export function parseDuree(txt) {
  const s = String(txt || '').trim()
  if (!s) return null
  const parts = s.split(':')
  if (parts.length > 1) {
    if (!parts.every((p) => /^\d+$/.test(p.trim()))) return null
    const nums = parts.map(Number)
    const secondes =
      nums.length === 3
        ? nums[0] * 3600 + nums[1] * 60 + nums[2]
        : nums[0] * 60 + nums[1]
    return secondes > 0 ? secondes * 1000 : null
  }
  const secondes = Number(s)
  return Number.isFinite(secondes) && secondes > 0 ? Math.round(secondes * 1000) : null
}

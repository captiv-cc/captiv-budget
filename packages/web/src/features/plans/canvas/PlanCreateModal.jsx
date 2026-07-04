// ════════════════════════════════════════════════════════════════════════════
// PlanCreateModal — création d'un plan éditable (titre, catégorie, fond)
// ════════════════════════════════════════════════════════════════════════════
//
// Le fond est choisi parmi les fichiers de la bibliothèque "Fonds importés"
// (table plans) du projet. Optionnel : canvas vierge sinon.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, X } from 'lucide-react'
import { createCanvas } from '../../../lib/plansCanvas'
import { listPlans, listPlanCategories } from '../../../lib/plans'
import { useAuth } from '../../../contexts/AuthContext'
import { notify } from '../../../lib/notify'

export default function PlanCreateModal({ projectId, orgId, onClose, onCreated }) {
  const { user } = useAuth()
  const [titre, setTitre] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [fondId, setFondId] = useState('')
  const [categories, setCategories] = useState([])
  const [fonds, setFonds] = useState([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (orgId) listPlanCategories(orgId).then(setCategories).catch(() => {})
    listPlans({ projectId })
      .then((rows) => setFonds(rows.filter((p) => !p.is_archived)))
      .catch(() => {})
  }, [projectId, orgId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!titre.trim() || submitting) return
    setSubmitting(true)
    try {
      const row = await createCanvas({
        projectId,
        titre,
        categoryId: categoryId || null,
        fondId: fondId || null,
        userId: user?.id,
      })
      onCreated?.(row)
    } catch (err) {
      notify.error('Création impossible : ' + (err?.message || err))
      setSubmitting(false)
    }
  }

  const fieldStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl p-5"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Nouveau plan éditable
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-md" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="block mb-3">
          <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
            Titre
          </span>
          <input
            type="text"
            value={titre}
            onChange={(e) => setTitre(e.target.value)}
            placeholder="Plan caméra scène principale"
            autoFocus
            className="w-full text-sm px-3 py-2 rounded-md outline-none"
            style={fieldStyle}
          />
        </label>

        <label className="block mb-3">
          <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
            Catégorie
          </span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-md outline-none"
            style={fieldStyle}
          >
            <option value="">Sans catégorie</option>
            {categories
              .filter((c) => !c.is_archived)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
          </select>
        </label>

        <label className="block mb-5">
          <span className="block text-xs font-semibold mb-1" style={{ color: 'var(--txt-2)' }}>
            Fond de plan
          </span>
          <select
            value={fondId}
            onChange={(e) => setFondId(e.target.value)}
            className="w-full text-sm px-3 py-2 rounded-md outline-none"
            style={fieldStyle}
          >
            <option value="">Aucun (canvas vierge)</option>
            {fonds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.file_type.toUpperCase()})
              </option>
            ))}
          </select>
          <span className="block text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
            Un fichier de la bibliothèque « Fonds importés », affiché verrouillé
            en arrière-plan du canvas.
          </span>
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-2 rounded-md"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={!titre.trim() || submitting}
            className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-md"
            style={{
              background: 'var(--blue)',
              color: '#fff',
              opacity: !titre.trim() || submitting ? 0.6 : 1,
            }}
          >
            {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Créer le plan
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

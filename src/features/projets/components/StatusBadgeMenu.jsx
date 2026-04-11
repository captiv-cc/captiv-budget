/**
 * Badge statut projet cliquable avec menu déroulant.
 *
 * Utilisé dans la liste /projets et dans le hero de ProjetTab pour permettre
 * un changement de statut en 2 clics, sans ouvrir de formulaire.
 *
 * Props :
 *   - project  : objet projet (utilisé pour project.id et project.status)
 *   - onChange : (projectId, newStatus) => Promise — callback de mise à jour
 *   - canEdit  : booléen — si false, affiche juste le badge en lecture seule
 *   - size     : 'sm' | 'md' — taille du badge (défaut 'sm')
 *   - align    : 'left' | 'right' — alignement du menu déroulant (défaut 'right')
 */
import { useState, useEffect, useRef } from 'react'
import { Check } from 'lucide-react'
import { STATUS_OPTIONS, getStatusOption } from '../constants'

export default function StatusBadgeMenu({ project, onChange, canEdit, size = 'sm', align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const current = getStatusOption(project.status)

  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    const onEsc   = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const sizeCls = size === 'md' ? 'text-sm px-3 py-1' : ''

  // Lecture seule : pas de menu, juste le badge affiché
  if (!canEdit) {
    return <span className={`badge ${current.cls} ${sizeCls}`}>{current.label}</span>
  }

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`badge ${current.cls} ${sizeCls} cursor-pointer hover:opacity-80 transition-opacity`}
        title="Changer le statut"
      >
        {current.label}
      </button>
      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-1 z-30 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[150px]`}>
          {STATUS_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(project.id, opt.value); setOpen(false) }}
              className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-gray-50 text-left"
            >
              <span className={`badge ${opt.cls}`}>{opt.label}</span>
              {opt.value === project.status && <Check className="w-3 h-3 text-gray-400" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// LogistiqueAddPersonModal — Modal pour ajouter une personne à la logistique
// ════════════════════════════════════════════════════════════════════════════
//
// Liste les membres de l'équipe du projet qui ne sont PAS encore dans la
// logistique, avec une checkbox de sélection multiple. Clic sur "Ajouter"
// → crée une entry pour chaque membre coché.
//
// Pour la V0, pas de recherche / filtre — liste simple alphabétique. Si plus
// tard l'équipe dépasse 50 personnes, on ajoutera un filtre texte.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { X, UserPlus, Search } from 'lucide-react'
import { membreFullName } from '../../lib/logistiqueV0'
import { notify } from '../../lib/notify'

export default function LogistiqueAddPersonModal({
  open,
  onClose,
  membres = [],
  existingEntryMembreIds = [], // Liste des membre_id déjà dans la logistique
  onAdd, // (membreIds: string[]) → Promise
}) {
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [search, setSearch] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Reset à l'ouverture
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set())
      setSearch('')
      setSubmitting(false)
    }
  }, [open])

  // Membres disponibles (pas encore dans la logistique) + filtrage texte
  const availableMembres = useMemo(() => {
    const existing = new Set(existingEntryMembreIds)
    return membres
      .filter((m) => !existing.has(m.id))
      .filter((m) => {
        if (!search.trim()) return true
        const fullName = membreFullName(m).toLowerCase()
        const specialite = (m.specialite || m.contact?.specialite || '').toLowerCase()
        const q = search.toLowerCase()
        return fullName.includes(q) || specialite.includes(q)
      })
      .sort((a, b) => {
        const an = membreFullName(a).toLowerCase()
        const bn = membreFullName(b).toLowerCase()
        return an.localeCompare(bn, 'fr')
      })
  }, [membres, existingEntryMembreIds, search])

  // Esc pour fermer
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSubmit() {
    if (selectedIds.size === 0) return
    setSubmitting(true)
    try {
      await onAdd([...selectedIds])
      notify.success(
        selectedIds.size === 1
          ? '1 personne ajoutée'
          : `${selectedIds.size} personnes ajoutées`,
      )
      onClose()
    } catch (err) {
      notify.error(err.message || 'Erreur ajout')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl flex flex-col"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-2 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <UserPlus className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <h2
            className="flex-1 text-base font-semibold"
            style={{ color: 'var(--txt)' }}
          >
            Ajouter à la logistique
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
            title="Fermer (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Search */}
        <div className="px-4 py-2 shrink-0">
          <div
            className="flex items-center gap-2 rounded-md px-2 py-1.5"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            <Search className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une personne…"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: 'var(--txt)' }}
              autoFocus
            />
          </div>
        </div>

        {/* Liste des membres */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {availableMembres.length === 0 ? (
            <div
              className="text-center py-8 text-sm"
              style={{ color: 'var(--txt-3)' }}
            >
              {membres.length === 0
                ? 'Aucun membre dans l\'équipe du projet.'
                : existingEntryMembreIds.length === membres.length
                  ? 'Toute l\'équipe est déjà dans la logistique.'
                  : 'Aucun résultat.'}
            </div>
          ) : (
            <ul className="space-y-1">
              {availableMembres.map((m) => {
                const checked = selectedIds.has(m.id)
                const fullName = membreFullName(m)
                const specialite = m.specialite || m.contact?.specialite || ''
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => toggle(m.id)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors"
                      style={{
                        background: checked ? 'var(--accent-bg)' : 'transparent',
                        border: `1px solid ${checked ? 'var(--accent)' : 'transparent'}`,
                      }}
                      onMouseEnter={(e) => {
                        if (!checked) e.currentTarget.style.background = 'var(--bg-elev)'
                      }}
                      onMouseLeave={(e) => {
                        if (!checked) e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <span
                        className="w-4 h-4 rounded inline-flex items-center justify-center shrink-0"
                        style={{
                          background: checked ? 'var(--accent)' : 'transparent',
                          border: `1px solid ${checked ? 'var(--accent)' : 'var(--brd-sub)'}`,
                          color: '#fff',
                          fontSize: 10,
                          lineHeight: 1,
                        }}
                      >
                        {checked ? '✓' : ''}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm font-medium truncate"
                          style={{ color: 'var(--txt)' }}
                        >
                          {fullName}
                        </div>
                        {specialite && (
                          <div
                            className="text-[11px] truncate"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            {specialite}
                          </div>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              color: 'var(--txt-2)',
            }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selectedIds.size === 0 || submitting}
            className="px-3 py-1.5 rounded-md text-sm font-semibold disabled:opacity-50"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            {submitting
              ? 'Ajout…'
              : selectedIds.size === 0
                ? 'Ajouter'
                : `Ajouter (${selectedIds.size})`}
          </button>
        </footer>
      </div>
    </div>
  )
}

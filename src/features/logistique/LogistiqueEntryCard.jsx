// ════════════════════════════════════════════════════════════════════════════
// LogistiqueEntryCard — Carte d'une entrée logistique (une personne)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche pour une personne :
//   - Header : avatar (initiales) + nom + spécialité + bouton supprimer
//   - 3 sous-blocs : Transport / Hébergement / Repas (côte à côte sur
//     desktop, empilés sur mobile)
//
// Mode read-only : pas de bouton supprimer, sous-blocs en lecture seule.
// ════════════════════════════════════════════════════════════════════════════

import { Trash2 } from 'lucide-react'
import LogistiqueSubBloc from './LogistiqueSubBloc'
import { LOGISTIQUE_KINDS, membreFullName } from '../../lib/logistiqueV0'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function LogistiqueEntryCard({
  entry,
  membre,
  documentsByKind, // Map<kind, Array<document>>
  readOnly = false,
  onUpdateText,
  onUploadDocument,
  onDeleteDocument,
  onRemoveEntry,
}) {
  const fullName = membreFullName(membre)
  const initials = computeInitials(membre)
  const specialite = membre?.specialite || membre?.contact?.specialite || ''

  async function handleRemoveEntry() {
    const ok = await confirm({
      title: 'Retirer de la logistique',
      message: `Retirer ${fullName} de la logistique ? Tous les textes et documents (transport, hébergement, repas) seront supprimés. Cette action est irréversible.`,
      confirmLabel: 'Retirer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await onRemoveEntry(entry.id)
      notify.success(`${fullName} retiré`)
    } catch (err) {
      notify.error(err.message || 'Erreur suppression')
    }
  }

  // Wrap update text avec l'entry_id contextuel
  const handleUpdateText = (kind, text) => onUpdateText(entry.id, kind, text)
  const handleUploadDocument = ({ kind, file }) =>
    onUploadDocument({ entryId: entry.id, kind, file })

  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <div
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
          style={{
            background: 'var(--accent-bg)',
            color: 'var(--accent)',
          }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h3
            className="text-base font-semibold leading-tight truncate"
            style={{ color: 'var(--txt)' }}
          >
            {fullName}
          </h3>
          {specialite && (
            <p
              className="text-xs leading-tight mt-0.5 truncate"
              style={{ color: 'var(--txt-3)' }}
            >
              {specialite}
            </p>
          )}
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={handleRemoveEntry}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: 'var(--txt-3)' }}
            title="Retirer de la logistique"
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--red-bg)'
              e.currentTarget.style.color = 'var(--red)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Sous-blocs (grille 3 col desktop, stack mobile) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {LOGISTIQUE_KINDS.map((kind) => (
          <LogistiqueSubBloc
            key={kind}
            kind={kind}
            text={entry[`${kind}_text`]}
            documents={documentsByKind?.get(kind) || []}
            readOnly={readOnly}
            onUpdateText={handleUpdateText}
            onUploadDocument={handleUploadDocument}
            onDeleteDocument={onDeleteDocument}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeInitials(membre) {
  if (!membre) return '?'
  // Préférence : champs surcharge sur projet_membres
  // Fallback : champs contact joint
  const prenom = membre.prenom || membre.contact?.prenom || ''
  const nom = membre.nom || membre.contact?.nom || ''
  const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase()
  return ini || '?'
}

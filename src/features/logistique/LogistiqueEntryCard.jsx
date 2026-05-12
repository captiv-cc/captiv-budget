// ════════════════════════════════════════════════════════════════════════════
// LogistiqueEntryCard — Carte d'une entrée logistique (une personne)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche pour une personne :
//   - Header : avatar (initiales) + nom + spécialité + bouton supprimer
//   - Les sous-blocs Transport / Hébergement / Repas, SAUF ceux marqués
//     dans entry.hidden_kinds (côté admin et côté share)
//   - En bas (admin) : boutons "+ Transport / + Hébergement / + Repas" pour
//     restaurer les sous-blocs masqués
//
// Mode read-only : pas de bouton supprimer, pas de bouton X par sous-bloc,
// pas de boutons "+ Restaurer" — uniquement les sous-blocs visibles.
// ════════════════════════════════════════════════════════════════════════════

import { Trash2, Plus, Plane, BedDouble, UtensilsCrossed } from 'lucide-react'
import LogistiqueSubBloc from './LogistiqueSubBloc'
import {
  LOGISTIQUE_KINDS,
  labelForKind,
  membreFullName,
} from '../../lib/logistiqueV0'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

// Icônes pour les boutons "+ Restaurer X"
const KIND_ICONS = {
  transport: Plane,
  hebergement: BedDouble,
  repas: UtensilsCrossed,
}

export default function LogistiqueEntryCard({
  entry,
  membre,
  documentsByKind, // Map<kind, Array<document>>
  readOnly = false,
  onUpdateText,
  onUploadDocument,
  onDeleteDocument,
  onRemoveEntry,
  onSetHiddenKinds, // (entryId, hiddenKinds) — admin uniquement
}) {
  const fullName = membreFullName(membre)
  const initials = computeInitials(membre)
  const specialite = membre?.specialite || membre?.contact?.specialite || ''

  // Normalise hidden_kinds depuis l'entry (peut être undefined ou null en V0
  // legacy avant la migration hidden_kinds — fallback []).
  const hiddenKinds = Array.isArray(entry.hidden_kinds) ? entry.hidden_kinds : []
  const visibleKinds = LOGISTIQUE_KINDS.filter((k) => !hiddenKinds.includes(k))
  const hiddenKindsList = LOGISTIQUE_KINDS.filter((k) => hiddenKinds.includes(k))

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

  async function handleHideKind(kind) {
    const next = [...new Set([...hiddenKinds, kind])]
    try {
      await onSetHiddenKinds(entry.id, next)
    } catch (err) {
      notify.error(err.message || 'Erreur masquage')
    }
  }

  async function handleRestoreKind(kind) {
    const next = hiddenKinds.filter((k) => k !== kind)
    try {
      await onSetHiddenKinds(entry.id, next)
    } catch (err) {
      notify.error(err.message || 'Erreur restauration')
    }
  }

  // Wrap update text avec l'entry_id contextuel
  const handleUpdateText = (kind, text) => onUpdateText(entry.id, kind, text)
  const handleUploadDocument = ({ kind, file }) =>
    onUploadDocument({ entryId: entry.id, kind, file })

  // Détecte si la personne a vraiment 0 sous-bloc visible (cas où tout est
  // masqué). On affiche une note pour l'admin pour lui dire qu'il peut
  // restaurer un sous-bloc. Côté share, on cache juste la card vide.
  if (readOnly && visibleKinds.length === 0) {
    return null
  }

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

      {/* Sous-blocs visibles uniquement. La grille adapte le nombre de
          colonnes : 3 si tout est visible, 2 si 1 masqué, 1 si 2 masqués. */}
      {visibleKinds.length > 0 && (
        <div
          className="grid grid-cols-1 gap-3"
          style={{
            gridTemplateColumns:
              visibleKinds.length === 3
                ? 'repeat(auto-fit, minmax(0, 1fr))'
                : visibleKinds.length === 2
                  ? 'repeat(auto-fit, minmax(0, 1fr))'
                  : '1fr',
          }}
        >
          {visibleKinds.map((kind) => (
            <LogistiqueSubBloc
              key={kind}
              kind={kind}
              text={entry[`${kind}_text`]}
              documents={documentsByKind?.get(kind) || []}
              readOnly={readOnly}
              onUpdateText={handleUpdateText}
              onUploadDocument={handleUploadDocument}
              onDeleteDocument={onDeleteDocument}
              onHide={readOnly ? null : () => handleHideKind(kind)}
            />
          ))}
        </div>
      )}

      {/* Boutons "+ Restaurer X" pour les sous-blocs masqués (admin uniquement) */}
      {!readOnly && hiddenKindsList.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span
            className="text-[10px] uppercase tracking-wider mr-1"
            style={{ color: 'var(--txt-3)' }}
          >
            Réactiver :
          </span>
          {hiddenKindsList.map((kind) => {
            const KIcon = KIND_ICONS[kind] || Plus
            return (
              <button
                key={kind}
                type="button"
                onClick={() => handleRestoreKind(kind)}
                className="text-[11px] inline-flex items-center gap-1 rounded-md px-2 py-1 transition-colors"
                style={{
                  background: 'var(--bg-elev)',
                  border: '1px dashed var(--brd-sub)',
                  color: 'var(--txt-2)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-hov)'
                  e.currentTarget.style.borderStyle = 'solid'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elev)'
                  e.currentTarget.style.borderStyle = 'dashed'
                }}
              >
                <Plus className="w-3 h-3" />
                <KIcon className="w-3 h-3" />
                {labelForKind(kind)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeInitials(membre) {
  if (!membre) return '?'
  // Priorité contact lié (live, à jour si la BDD a été corrigée), fallback
  // sur membre.prenom/nom pour les hors-annuaire. Aligné sur crew.js.
  const prenom = membre.contact?.prenom || membre.prenom || ''
  const nom = membre.contact?.nom || membre.nom || ''
  const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase()
  return ini || '?'
}

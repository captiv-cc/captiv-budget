// ════════════════════════════════════════════════════════════════════════════
// LogistiqueTab — Onglet "Logistique" d'un projet (V0 PROVISOIRE)
// ════════════════════════════════════════════════════════════════════════════
//
// Mini outil rapide pour publier les infos logistique de l'équipe :
//   - Liste des personnes ajoutées (1 carte par personne, choix manuel)
//   - Chaque carte : 3 sous-blocs Transport / Hébergement / Repas
//     (textarea libre + upload PDF/PNG/JPG multi)
//
// Sera REMPLACÉ par LOGISTIQUE V1/V2/V3 (calendrier, hébergements partagés,
// transports avec tracking, per diem, etc.) — d'où le naming `logistique_v0`
// partout (DB, perm, bucket).
//
// Pattern aligné sur DerouleTab pour la gestion permissions / loading / error.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, AlertCircle, Lock, Truck, Loader2, Inbox } from 'lucide-react'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import { useLogistiqueV0 } from '../../hooks/useLogistiqueV0'
import { fetchProjectMembers } from '../../lib/crew'
import LogistiqueEntryCard from '../../features/logistique/LogistiqueEntryCard'
import LogistiqueAddPersonModal from '../../features/logistique/LogistiqueAddPersonModal'
import LogistiqueGlobalCard from '../../features/logistique/LogistiqueGlobalCard'

const OUTIL_KEY = 'logistique_v0'

export default function LogistiqueTab() {
  const { id: projectId } = useParams()
  const { can } = useProjectPermissions(projectId)
  const canRead = can(OUTIL_KEY, 'read')
  const canEdit = can(OUTIL_KEY, 'edit')

  const {
    entries,
    documentsByEntry,
    global: globalRow,
    globalDocuments,
    loading,
    error,
    addEntry,
    removeEntry,
    updateEntryText,
    setEntryHiddenKinds,
    uploadDocument,
    deleteDocument,
    updateGlobalText,
    uploadGlobalDocument,
    deleteGlobalDocument,
  } = useLogistiqueV0(canRead ? projectId : null)

  // Charge la liste des membres du projet pour le picker d'ajout + le mapping
  // entry.membre_id → infos membre (nom, prénom, spécialité).
  const [membres, setMembres] = useState([])
  const [membresLoading, setMembresLoading] = useState(true)
  useEffect(() => {
    if (!canRead || !projectId) {
      setMembresLoading(false)
      return
    }
    let cancelled = false
    setMembresLoading(true)
    fetchProjectMembers(projectId)
      .then((data) => {
        if (!cancelled) setMembres(data)
      })
      .catch((err) => {
         
        console.error('[LogistiqueTab] fetchProjectMembers error :', err)
      })
      .finally(() => {
        if (!cancelled) setMembresLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectId, canRead])

  const [addOpen, setAddOpen] = useState(false)

  // Map<membre_id, membre> pour lookup O(1) au rendu des cards
  const membreById = new Map(membres.map((m) => [m.id, m]))

  // ─── Guard permissions ────────────────────────────────────────────────
  if (!canRead) {
    return (
      <div className="p-8 text-center">
        <Lock className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
          Tu n&apos;as pas accès à la logistique de ce projet.
        </p>
      </div>
    )
  }

  if (loading || membresLoading) {
    return (
      <div className="p-12 text-center">
        <Loader2
          className="w-6 h-6 mx-auto animate-spin"
          style={{ color: 'var(--txt-3)' }}
        />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <AlertCircle
          className="w-8 h-8 mx-auto mb-2"
          style={{ color: 'var(--red)' }}
        />
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {error.message || 'Erreur lors du chargement de la logistique'}
        </p>
      </div>
    )
  }

  async function handleAdd(membreIds) {
    // Itère séquentiellement pour éviter de spammer la DB.
    for (const id of membreIds) {
      await addEntry({ membreId: id })
    }
  }

  const existingMembreIds = entries.map((e) => e.membre_id)

  return (
    <div className="p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Truck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          <div>
            <h1
              className="text-lg font-semibold"
              style={{ color: 'var(--txt)' }}
            >
              Logistique & VHR
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
              Transport · Hébergement · Repas (V0 — outil provisoire)
            </p>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
            style={{
              background: 'var(--accent)',
              color: '#fff',
            }}
          >
            <Plus className="w-4 h-4" />
            Ajouter une personne
          </button>
        )}
      </div>

      {/* ─── Bloc Global (infos générales projet) ─────────────────────── */}
      <div className="mb-4">
        <LogistiqueGlobalCard
          text={globalRow?.text}
          documents={globalDocuments}
          readOnly={!canEdit}
          onUpdateText={updateGlobalText}
          onUploadDocument={uploadGlobalDocument}
          onDeleteDocument={deleteGlobalDocument}
        />
      </div>

      {/* ─── Liste des cards personnes ───────────────────────────────── */}
      {entries.length === 0 ? (
        <EmptyState canEdit={canEdit} onAdd={() => setAddOpen(true)} />
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => {
            const membre = membreById.get(entry.membre_id)
            return (
              <LogistiqueEntryCard
                key={entry.id}
                entry={entry}
                membre={membre}
                documentsByKind={documentsByEntry.get(entry.id)}
                readOnly={!canEdit}
                onUpdateText={updateEntryText}
                onUploadDocument={uploadDocument}
                onDeleteDocument={deleteDocument}
                onRemoveEntry={removeEntry}
                onSetHiddenKinds={setEntryHiddenKinds}
              />
            )
          })}
        </div>
      )}

      {/* ─── Modal Ajout ──────────────────────────────────────────────── */}
      {canEdit && (
        <LogistiqueAddPersonModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          membres={membres}
          existingEntryMembreIds={existingMembreIds}
          onAdd={handleAdd}
        />
      )}
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────
function EmptyState({ canEdit, onAdd }) {
  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Inbox
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <h2 className="text-base font-semibold mb-1" style={{ color: 'var(--txt)' }}>
        Aucune logistique encore renseignée
      </h2>
      <p className="text-sm mb-4 max-w-md mx-auto" style={{ color: 'var(--txt-3)' }}>
        Ajoute les personnes de l&apos;équipe pour leur attribuer un transport,
        un hébergement et des informations repas, avec leurs documents associés.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium"
          style={{
            background: 'var(--accent)',
            color: '#fff',
          }}
        >
          <Plus className="w-4 h-4" />
          Ajouter une personne
        </button>
      )}
    </div>
  )
}

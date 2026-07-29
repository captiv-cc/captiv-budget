// ════════════════════════════════════════════════════════════════════════════
// HebergementsModal — gestion des hébergements du projet (Logistique V1, P2)
// ════════════════════════════════════════════════════════════════════════════
//
// Un hébergement = nom + type libre (hôtel, apart'hôtel, Airbnb…) + adresse
// + notes. Déclaré UNE fois au projet, puis rattaché aux personnes (fiche
// personne : chambre, pdj). Les nuits cochées de la grille pointent dessus
// → rooming list / totaux chambres par nuit en P3.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { BedDouble, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  createHebergement,
  updateHebergement,
  deleteHebergement,
} from '../../lib/logistique'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function HebergementsModal({
  projectId,
  hebergements = [],
  membresCountByHebergement = new Map(), // Map<hebId, n> (rattachements)
  onMutated, // reload côté appelant
  onClose,
}) {
  const [editingId, setEditingId] = useState(null) // id | 'new' | null
  const [busy, setBusy] = useState(false)

  async function run(fn, successMsg) {
    setBusy(true)
    try {
      await fn()
      if (successMsg) notify.success(successMsg)
      await onMutated?.()
      return true
    } catch (err) {
      notify.error(err?.message || String(err))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(h) {
    const n = membresCountByHebergement.get(h.id) || 0
    const ok = await confirm({
      title: `Supprimer « ${h.nom} » ?`,
      message: n
        ? `${n} personne${n > 1 ? 's' : ''} y ${n > 1 ? 'sont rattachées' : 'est rattachée'} — les rattachements seront supprimés, les nuits cochées resteront (sans hébergement).`
        : 'Aucune personne rattachée. Action irréversible.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await run(() => deleteHebergement(h.id), 'Hébergement supprimé')
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.55)' }}
        onClick={() => !busy && onClose?.()}
      />
      <div
        className="relative w-full max-w-lg rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: 'calc(100vh - 32px)',
        }}
      >
        <div
          className="flex items-center gap-2 px-5 py-3.5 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <BedDouble className="w-4 h-4" style={{ color: 'var(--purple, #a78bfa)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Hébergements du projet
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            className="ml-auto p-1"
            style={{ color: 'var(--txt-3)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2.5">
          {hebergements.length === 0 && editingId !== 'new' && (
            <p className="text-xs text-center py-4" style={{ color: 'var(--txt-3)' }}>
              Aucun hébergement — déclare l&apos;hôtel / Airbnb de l&apos;équipe une
              fois, puis rattache les personnes depuis leurs fiches.
            </p>
          )}
          {hebergements.map((h) =>
            editingId === h.id ? (
              <HebergementForm
                key={h.id}
                initial={h}
                busy={busy}
                onCancel={() => setEditingId(null)}
                onSubmit={async (fields) => {
                  const ok = await run(() => updateHebergement(h.id, fields), 'Hébergement mis à jour')
                  if (ok) setEditingId(null)
                }}
              />
            ) : (
              <div
                key={h.id}
                className="rounded-lg px-3 py-2.5 flex items-start gap-3"
                style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                    {h.nom}
                    {h.type && (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--txt-3)' }}>
                        {h.type}
                      </span>
                    )}
                  </p>
                  {h.adresse && (
                    <p className="text-xs whitespace-pre-line" style={{ color: 'var(--txt-2)' }}>
                      {h.adresse}
                    </p>
                  )}
                  {h.notes && (
                    <p className="text-[11px] mt-1 italic" style={{ color: 'var(--txt-3)' }}>
                      {h.notes}
                    </p>
                  )}
                  <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
                    {membresCountByHebergement.get(h.id) || 0} personne
                    {(membresCountByHebergement.get(h.id) || 0) > 1 ? 's' : ''} rattachée
                    {(membresCountByHebergement.get(h.id) || 0) > 1 ? 's' : ''}
                  </p>
                </div>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingId(h.id)}
                    className="p-1.5 rounded-md"
                    style={{ color: 'var(--txt-3)' }}
                    title="Modifier"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(h)}
                    className="p-1.5 rounded-md"
                    style={{ color: 'var(--red, #ef4444)' }}
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </span>
              </div>
            ),
          )}

          {editingId === 'new' ? (
            <HebergementForm
              busy={busy}
              onCancel={() => setEditingId(null)}
              onSubmit={async (fields) => {
                const ok = await run(
                  () => createHebergement({ projectId, ...fields }),
                  'Hébergement créé',
                )
                if (ok) setEditingId(null)
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingId('new')}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg self-start"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt-2)',
                border: '1px dashed var(--brd)',
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter un hébergement
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function HebergementForm({ initial = null, busy, onSubmit, onCancel }) {
  const [nom, setNom] = useState(initial?.nom || '')
  const [type, setType] = useState(initial?.type || '')
  const [adresse, setAdresse] = useState(initial?.adresse || '')
  const [notes, setNotes] = useState(initial?.notes || '')

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!nom.trim()) return
        onSubmit({
          nom: nom.trim(),
          type: type.trim() || null,
          adresse: adresse.trim() || null,
          notes: notes.trim() || null,
        })
      }}
      className="rounded-lg p-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--blue)' }}
    >
      <div className="flex gap-2">
        <input
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          placeholder="Nom (ex. Lagrange apart'HOTEL) *"
          autoFocus
          className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        />
        <input
          type="text"
          value={type}
          onChange={(e) => setType(e.target.value)}
          placeholder="Type (hôtel, Airbnb…)"
          className="w-[130px] text-xs px-2 py-1.5 rounded-md outline-none"
          style={inputStyle}
        />
      </div>
      <textarea
        value={adresse}
        onChange={(e) => setAdresse(e.target.value)}
        placeholder="Adresse"
        rows={2}
        className="text-xs px-2 py-1.5 rounded-md outline-none resize-y"
        style={{ ...inputStyle, fontFamily: 'inherit' }}
      />
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notes (code d'accès, contact résa…)"
        className="text-xs px-2 py-1.5 rounded-md outline-none"
        style={inputStyle}
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold px-2.5 py-1.5 rounded-md"
          style={{ color: 'var(--txt-2)' }}
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={busy || !nom.trim()}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-md disabled:opacity-40"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          {initial ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </form>
  )
}

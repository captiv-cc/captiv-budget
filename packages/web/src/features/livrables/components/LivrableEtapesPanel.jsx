// ════════════════════════════════════════════════════════════════════════════
// LivrableEtapesPanel — onglet "Étapes" du drawer details (LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Liste verticale des étapes du livrable + form de création inline en footer.
// Les étapes sont triées par date_debut asc (la prochaine en haut), tie-break
// sur sort_order. Chaque étape est rendue via `LivrableEtapeCard`.
//
// LIV-9 — l'étape utilise directement les `event_types` de l'org (Dérush,
// Étalonnage, VFX, types custom…) plutôt qu'une enum `kind` figée. Le
// `event_type_id` est utilisé tel quel comme `type_id` du event miroir,
// ce qui garantit la cohérence visuelle (même couleur, même libellé) entre
// la card étape et le bloc planning.
//
// Création (form inline obligatoire — pas de date par défaut côté front,
// l'utilisateur DOIT saisir nom + date_debut) :
//   - nom            (texte, required)
//   - event_type_id  (dropdown des event_types de l'org, défaut = premier)
//   - date_debut     (date, required)
//   - is_event       (toggle implicite, défaut true via lib)
// Le form ne soumet QUE si nom et date_debut sont remplis. Mode "1 jour"
// par défaut (date_fin = date_debut). L'utilisateur peut ensuite étendre
// la plage via le toggle ↔ sur la carte.
//
// Props :
//   - livrable     : livrable parent (pour `addEtape`)
//   - etapes       : Array<livrable_etape> filtré sur livrable.id
//   - eventTypes   : Array<event_type> de l'org (dropdown type)
//   - actions      : `useLivrables.actions`
//   - canEdit      : booléen
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, ListTodo, Plus } from 'lucide-react'
import { notify } from '../../../lib/notify'
import LivrableEtapeCard from './LivrableEtapeCard'

export default function LivrableEtapesPanel({
  livrable,
  etapes = [],
  eventTypes = [],
  actions,
  canEdit = true,
}) {
  // Tri : date_debut asc (prochaine en haut), tie-break sort_order, fallback
  // created_at pour les étapes saisies dans la même seconde.
  const ordered = useMemo(() => {
    return etapes.slice().sort((a, b) => {
      const da = a?.date_debut || ''
      const db = b?.date_debut || ''
      if (da !== db) return da.localeCompare(db)
      const sa = a?.sort_order ?? 0
      const sb = b?.sort_order ?? 0
      if (sa !== sb) return sa - sb
      return (a?.created_at || '').localeCompare(b?.created_at || '')
    })
  }, [etapes])

  return (
    <div className="flex flex-col h-full">
      {/* Liste */}
      <div className="flex-1 overflow-y-auto p-4">
        {ordered.length === 0 ? (
          <EmptyEtapes />
        ) : (
          <div className="flex flex-col gap-3">
            {ordered.map((e) => (
              <LivrableEtapeCard
                key={e.id}
                etape={e}
                eventTypes={eventTypes}
                actions={actions}
                canEdit={canEdit}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer : form d'ajout */}
      {canEdit && livrable && (
        <footer
          className="px-4 py-3"
          style={{
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-surf)',
          }}
        >
          <EtapeQuickAdd
            livrable={livrable}
            eventTypes={eventTypes}
            actions={actions}
          />
        </footer>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EmptyEtapes — état vide simple (pas de CTA car le footer en propose un)
// ════════════════════════════════════════════════════════════════════════════

function EmptyEtapes() {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-lg"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd-sub)',
      }}
    >
      <ListTodo
        className="w-8 h-8 mb-3 opacity-30"
        style={{ color: 'var(--txt-3)' }}
      />
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
        Aucune étape
      </p>
      <p className="text-xs max-w-xs" style={{ color: 'var(--txt-3)' }}>
        Ajoute des étapes pour cadencer la post-prod (DA, montage, étalo, son,
        livraison…). Chaque étape génère un bloc dans le planning.
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EtapeQuickAdd — form de création inline (nom + date_debut requis)
// ════════════════════════════════════════════════════════════════════════════
//
// État : "dormant" (bouton Plus) ou "actif" (form étendu). Le bouton "Ajouter"
// reste désactivé tant que nom et date_debut ne sont pas remplis. Pas de
// pré-remplissage de date (cf. décision Hugo : la date est obligatoire et
// ne doit pas être suggérée à `today` pour forcer le choix conscient).
// ════════════════════════════════════════════════════════════════════════════

function EtapeQuickAdd({ livrable, eventTypes = [], actions }) {
  // event_type_id par défaut = premier type non-archivé. Si aucun → null
  // (l'event miroir héritera du défaut côté planning).
  const defaultEventTypeId = useMemo(() => eventTypes[0]?.id || '', [eventTypes])

  const [open, setOpen] = useState(false)
  const [nom, setNom] = useState('')
  const [eventTypeId, setEventTypeId] = useState(defaultEventTypeId)
  const [date, setDate] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const nomRef = useRef(null)

  // Re-sync le défaut si les eventTypes arrivent en différé (load async).
  useEffect(() => {
    if (!eventTypeId && defaultEventTypeId) setEventTypeId(defaultEventTypeId)
  }, [defaultEventTypeId, eventTypeId])

  const reset = useCallback(() => {
    setNom('')
    setEventTypeId(defaultEventTypeId)
    setDate('')
    setOpen(false)
  }, [defaultEventTypeId])

  const canSubmit = nom.trim().length > 0 && Boolean(date) && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      // Étape créée en mode "1 jour" par défaut (date_debut = date_fin).
      // L'utilisateur étend la plage ensuite via le toggle ↔ sur la carte.
      await actions.addEtape(livrable.id, {
        nom: nom.trim(),
        event_type_id: eventTypeId || null,
        date_debut: date,
        date_fin: date,
        // is_event = true par défaut (cf. addEtape lib).
      })
      reset()
      // Refocus l'input nom après reset pour saisie en rafale.
      setOpen(true)
      setTimeout(() => nomRef.current?.focus(), 0)
    } catch (err) {
      notify.error('Création étape impossible : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }, [actions, canSubmit, date, eventTypeId, livrable, nom, reset])

  // Mode dormant : juste un bouton "+ Ajouter une étape".
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setTimeout(() => nomRef.current?.focus(), 0)
        }}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
      >
        <Plus className="w-4 h-4" />
        Ajouter une étape
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2 px-1 text-[11px] font-medium uppercase tracking-wider"
        style={{ color: 'var(--txt-3)' }}
      >
        <CalendarPlus className="w-3.5 h-3.5" />
        Nouvelle étape
      </div>
      {/* Ligne 1 : nom + kind */}
      <div className="flex items-center gap-2">
        <input
          ref={nomRef}
          type="text"
          value={nom}
          onChange={(e) => setNom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault()
              handleSubmit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              reset()
            }
          }}
          placeholder="Nom (ex : Étalo, Mix, Envoi V0…)"
          className="flex-1 min-w-0 bg-transparent focus:outline-none text-sm px-2 py-1.5 rounded"
          style={{
            color: 'var(--txt)',
            border: '1px solid var(--brd)',
          }}
        />
        <select
          value={eventTypeId}
          onChange={(e) => setEventTypeId(e.target.value)}
          disabled={eventTypes.length === 0}
          className="text-xs px-2 py-1.5 rounded shrink-0 cursor-pointer"
          style={{
            background: 'var(--bg-elev)',
            color: 'var(--txt)',
            border: '1px solid var(--brd)',
            opacity: eventTypes.length === 0 ? 0.5 : 1,
          }}
        >
          {eventTypes.length === 0 ? (
            <option value="">— aucun type —</option>
          ) : (
            eventTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))
          )}
        </select>
      </div>
      {/* Ligne 2 : date + actions */}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          className="flex-1 bg-transparent focus:outline-none text-xs px-2 py-1.5 rounded"
          style={{
            color: 'var(--txt-2)',
            border: '1px solid var(--brd)',
          }}
          required
        />
        <button
          type="button"
          onClick={reset}
          disabled={submitting}
          className="text-xs px-3 py-1.5 rounded shrink-0"
          style={{ color: 'var(--txt-3)' }}
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="text-xs font-medium px-3 py-1.5 rounded shrink-0"
          style={{
            background: canSubmit ? 'var(--blue)' : 'var(--bg-2)',
            color: canSubmit ? '#fff' : 'var(--txt-3)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? 'Ajout…' : 'Ajouter'}
        </button>
      </div>
      <p
        className="text-[11px] px-1"
        style={{ color: 'var(--txt-3)' }}
      >
        Étape sur 1 jour par défaut. Tu pourras la passer en plage ensuite via
        le toggle ↔ sur la carte.
      </p>
    </div>
  )
}

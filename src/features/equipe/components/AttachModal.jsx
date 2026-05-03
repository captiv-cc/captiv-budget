// ════════════════════════════════════════════════════════════════════════════
// AttachModal — Rattacher une attribution à un autre poste de la même persona
// ════════════════════════════════════════════════════════════════════════════
//
// Ouverte depuis le menu kebab d'une AttributionRow. Liste les autres
// attributions principales de la même personne (sur le même projet) ; admin
// choisit le "parent" → la row courante devient sa rattachée et disparaît
// de la techlist.
//
// Cas typique : Alexandre a 1 row "Cadreur" + 1 row "Essais caméra". L'admin
// veut une seule ligne dans la techlist → ouvre le menu sur "Essais caméra"
// → "Rattacher à" → choisit "Cadreur" → la ligne "Essais caméra" est
// rattachée à "Cadreur" et masquée sur la techlist.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { X, GitMerge } from 'lucide-react'
import {
  fullNameFromPersona,
  personaKey,
} from '../../../lib/crew'
import { notify } from '../../../lib/notify'

// Helper : résout le lot d'une row (priorité devis_line → fallback lot_id
// direct sur la row ad-hoc, cf. EQUIPE-P4.4).
function resolveRowLot(row, lineLotMap, lotInfoMap) {
  if (!row) return null
  let lotId = null
  if (row.devis_line_id) lotId = lineLotMap?.[row.devis_line_id] || null
  else if (row.lot_id) lotId = row.lot_id
  if (!lotId) return null
  return lotInfoMap?.[lotId] || null
}

// Petit badge "● Lot X" — réutilisé header + cards candidats.
function LotBadge({ lot, size = 'sm' }) {
  if (!lot) return null
  const isLg = size === 'md'
  return (
    <span
      className={`inline-flex items-center gap-1 rounded shrink-0 ${
        isLg ? 'text-[10px] px-1.5 py-0.5' : 'text-[10px] px-1 py-0'
      }`}
      style={{
        background: 'var(--bg-elev)',
        border: `1px solid ${lot.color}`,
        color: lot.color,
      }}
      title={`Lot · ${lot.title}`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: lot.color }}
      />
      <span className="truncate max-w-[120px]" style={{ fontWeight: 600 }}>
        {lot.title}
      </span>
    </span>
  )
}

export default function AttachModal({
  open,
  onClose,
  // La ligne qu'on rattache (= future enfant).
  childRow,
  // Toutes les rows du projet (pour identifier les candidats parents).
  allMembers = [],
  // (childId, parentId) => Promise
  onAttach,
  // Multi-lot — pour afficher le badge de lot à côté de chaque poste
  // candidat + dans le header (savoir d'où vient la modale).
  lineLotMap = {},
  lotInfoMap = {},
}) {
  const [submitting, setSubmitting] = useState(false)

  if (!open || !childRow) return null

  const childKey = personaKey(childRow)
  const personaName = fullNameFromPersona({
    contact: childRow.contact || childRow.persona?.contact,
    members: [childRow],
  })
  const childLot = resolveRowLot(childRow, lineLotMap, lotInfoMap)

  // Candidats : rows de la MÊME persona, principales (parent IS NULL),
  // et qui ne sont pas la row elle-même.
  const candidates = allMembers.filter(
    (m) =>
      personaKey(m) === childKey &&
      m.id !== childRow.id &&
      !m.parent_membre_id,
  )

  const handlePick = async (parentId) => {
    if (submitting) return
    setSubmitting(true)
    try {
      await onAttach(childRow.id, parentId)
      notify.success('Poste rattaché')
      onClose?.()
    } catch (err) {
      console.error('[AttachModal] attach error:', err)
      notify.error('Rattachement échoué : ' + (err?.message || err))
    } finally {
      setSubmitting(false)
    }
  }

  const childPoste =
    childRow.devis_line?.produit ||
    childRow.specialite ||
    '—'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--purple-bg)' }}
          >
            <GitMerge className="w-4 h-4" style={{ color: 'var(--purple)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              Rattacher à un autre poste
            </h2>
            <div
              className="text-xs flex items-center gap-1.5 flex-wrap"
              style={{ color: 'var(--txt-3)' }}
            >
              <span className="truncate">
                {personaName} — {childPoste}
              </span>
              {childLot && <LotBadge lot={childLot} size="md" />}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {candidates.length === 0 ? (
            <div
              className="text-center py-8 text-sm"
              style={{ color: 'var(--txt-3)' }}
            >
              Aucune autre attribution principale pour {personaName}.
              <div className="mt-2 text-[11px]" style={{ opacity: 0.7 }}>
                Pour rattacher cette ligne, il faut d&rsquo;abord qu&rsquo;une autre
                attribution principale existe pour la même personne.
              </div>
            </div>
          ) : (
            <>
              <p className="text-xs mb-3" style={{ color: 'var(--txt-2)' }}>
                Cette ligne sera masquée sur la Crew list et apparaîtra comme
                rôle rattaché à la ligne sélectionnée. Elle reste visible dans
                Attribution.
              </p>
              <div className="space-y-1">
                {candidates.map((c) => {
                  const cPoste =
                    c.devis_line?.produit ||
                    c.specialite ||
                    c.contact?.specialite ||
                    '—'
                  const cLot = resolveRowLot(c, lineLotMap, lotInfoMap)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handlePick(c.id)}
                      disabled={submitting}
                      className="w-full text-left p-3 rounded-md transition-colors flex items-center justify-between gap-2"
                      style={{
                        background: 'var(--bg-elev)',
                        border: '1px solid var(--brd)',
                        color: 'var(--txt)',
                        opacity: submitting ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!submitting) {
                          e.currentTarget.style.borderColor = 'var(--purple)'
                          e.currentTarget.style.background = 'var(--bg-hov)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--brd)'
                        e.currentTarget.style.background = 'var(--bg-elev)'
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{cPoste}</span>
                          {cLot && <LotBadge lot={cLot} size="md" />}
                        </div>
                        {c.regime && (
                          <div
                            className="text-[10px] mt-0.5"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            {c.regime}
                          </div>
                        )}
                      </div>
                      <GitMerge
                        className="w-4 h-4 shrink-0"
                        style={{ color: 'var(--purple)' }}
                      />
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Fermer
          </button>
        </footer>
      </div>
    </div>
  )
}

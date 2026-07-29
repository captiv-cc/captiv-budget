// ════════════════════════════════════════════════════════════════════════════
// LogistiqueStructuredSection — couche structurée d'une fiche personne (P2)
// ════════════════════════════════════════════════════════════════════════════
//
// Rendue EN TÊTE de la LogistiqueEntryCard (vue « Par personne »), au-dessus
// des blocs texte V0 qui deviennent de fait les « notes libres » :
//   - Trajets : lignes structurées (sens · date · étapes · coût) + ajout —
//     mêmes données que les chips de la grille (TrajetModal partagé) ;
//   - Hébergement : rattachement à un hébergement du projet + chambre +
//     petit-déj + check-in/check-out CALCULÉS depuis les nuits cochées.
// ════════════════════════════════════════════════════════════════════════════

import {
  BedDouble,
  Bus,
  Car,
  Pencil,
  Plane,
  Plus,
  Train,
  TramFront,
} from 'lucide-react'

const MODE_ICONS = {
  train: Train,
  minibus: Bus,
  voiture: Car,
  avion: Plane,
  autre: TramFront,
}

const SENS_LABELS = { aller: 'Aller', retour: 'Retour', autre: 'Trajet' }

function frDate(iso) {
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  const s = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function LogistiqueStructuredSection({
  trajets = [],
  hebergements = [],
  hebergementMembre = null, // row projet_logistique_hebergement_membres | null
  nuits = [], // nuits du membre (dates + hebergement_id)
  readOnly = false,
  onEditTrajet, // (trajet) => void
  onAddTrajet, // () => void
  onPatchHebergementMembre, // (patch, hebergementId) => void
}) {
  // Check-in / check-out dérivés des nuits cochées (grille) : première nuit
  // = check-in, dernière nuit + 1 jour = check-out.
  const nuitDates = nuits.map((n) => n.date_nuit).sort()
  const checkin = nuitDates[0] || null
  const checkout = nuitDates.length
    ? (() => {
        const d = new Date(`${nuitDates[nuitDates.length - 1]}T12:00:00`)
        d.setDate(d.getDate() + 1)
        return d.toISOString().slice(0, 10)
      })()
    : null

  const inputStyle = {
    background: 'var(--bg)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
  }

  return (
    <div className="flex flex-col gap-2 mb-3">
      {/* ── Trajets ─────────────────────────────────────────────────────── */}
      {(trajets.length > 0 || !readOnly) && (
        <div
          className="rounded-lg px-3 py-2"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--blue)', letterSpacing: '0.08em' }}
            >
              Trajets
            </span>
            {trajets.length === 0 && (
              <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                aucun
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={onAddTrajet}
                className="ml-auto flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md"
                style={{
                  color: 'var(--txt-2)',
                  border: '1px dashed var(--brd)',
                }}
              >
                <Plus className="w-3 h-3" />
                Trajet
              </button>
            )}
          </div>
          {trajets.map((t) => {
            const etapes = Array.isArray(t.etapes) ? t.etapes : []
            return (
              <div
                key={t.id}
                className="flex items-center gap-2 py-1.5 flex-wrap"
                style={{ borderTop: '1px solid var(--brd-sub)' }}
              >
                <span
                  className="text-[10px] font-bold uppercase tracking-wider shrink-0"
                  style={{
                    color: t.sens === 'retour' ? 'var(--amber, #f59e0b)' : 'var(--green, #22c55e)',
                    letterSpacing: '0.06em',
                  }}
                >
                  {SENS_LABELS[t.sens] || 'Trajet'}
                </span>
                {t.date_trajet && (
                  <span className="text-[11px] shrink-0" style={{ color: 'var(--txt-2)' }}>
                    {frDate(t.date_trajet)}
                  </span>
                )}
                <span className="flex items-center gap-1.5 flex-wrap min-w-0">
                  {etapes.map((e, i) => {
                    const Icon = MODE_ICONS[e.mode] || TramFront
                    return (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 text-[11px]"
                        style={{ color: 'var(--txt)' }}
                        title={e.note || undefined}
                      >
                        {i > 0 && <span style={{ color: 'var(--txt-3)' }}>+</span>}
                        <Icon className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                        {e.heure && <span className="font-semibold">{e.heure}</span>}
                        {(e.depart || e.arrivee) && (
                          <span style={{ color: 'var(--txt-2)' }}>
                            {e.depart || '?'} →{e.heure_arrivee ? ` ${e.heure_arrivee}` : ''}{' '}
                            {e.arrivee || '?'}
                          </span>
                        )}
                        {e.note && (
                          <span className="italic" style={{ color: 'var(--txt-3)' }}>
                            ({e.note})
                          </span>
                        )}
                      </span>
                    )
                  })}
                  {etapes.length === 0 && (
                    <span className="text-[11px] italic" style={{ color: 'var(--txt-3)' }}>
                      sans étapes
                    </span>
                  )}
                </span>
                {!readOnly && t.cout != null && (
                  <span
                    className="text-[10px] font-semibold shrink-0"
                    style={{ color: 'var(--txt-3)' }}
                    title="Coût interne — jamais visible sur les partages"
                  >
                    {Number(t.cout).toLocaleString('fr-FR')} €
                  </span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => onEditTrajet?.(t)}
                    className="ml-auto p-1 rounded"
                    style={{ color: 'var(--txt-3)' }}
                    title="Modifier le trajet"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Hébergement — DÉRIVÉ des nuits cochées dans la grille (modèle
          validé Hugo) : ici on lit le lieu et on n'édite que chambre/PDJ. */}
      {(() => {
        const derivedHebId =
          hebergementMembre?.hebergement_id ||
          nuits.map((n) => n.hebergement_id).find(Boolean) ||
          null
        const heb = hebergements.find((h) => h.id === derivedHebId) || null
        if (!heb && !nuitDates.length) return null
        return (
          <div
            className="rounded-lg px-3 py-2 flex items-center gap-2.5 flex-wrap"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
          >
            <BedDouble className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--purple, #a78bfa)' }} />
            <span
              className="text-xs font-semibold"
              style={{ color: heb ? 'var(--txt)' : 'var(--txt-3)' }}
              title="Dérivé des nuits cochées dans la grille"
            >
              {heb ? heb.nom : 'Nuits sans hébergement (aucun déclaré)'}
            </span>

            {heb && (
              <>
                {readOnly ? (
                  hebergementMembre?.chambre && (
                    <span className="text-[11px]" style={{ color: 'var(--txt-2)' }}>
                      Ch. {hebergementMembre.chambre}
                    </span>
                  )
                ) : (
                  <input
                    type="text"
                    defaultValue={hebergementMembre?.chambre || ''}
                    onBlur={(e) => {
                      const v = e.target.value.trim() || null
                      if (v !== (hebergementMembre?.chambre || null)) {
                        onPatchHebergementMembre?.({ chambre: v }, heb.id)
                      }
                    }}
                    placeholder="Chambre"
                    className="w-[90px] text-[11px] px-2 py-1 rounded-md outline-none"
                    style={inputStyle}
                  />
                )}
                <label
                  className="flex items-center gap-1 text-[11px]"
                  style={{ color: 'var(--txt-2)', cursor: readOnly ? 'default' : 'pointer' }}
                  title="Petit-déjeuner inclus"
                >
                  <input
                    type="checkbox"
                    checked={Boolean(hebergementMembre?.pdj)}
                    disabled={readOnly}
                    onChange={(e) => onPatchHebergementMembre?.({ pdj: e.target.checked }, heb.id)}
                    style={{ accentColor: 'var(--purple, #a78bfa)' }}
                  />
                  PDJ
                </label>
              </>
            )}

            {checkin && checkout && (
              <span
                className="text-[11px] ml-auto"
                style={{ color: 'var(--txt-3)' }}
                title="Calculé depuis les nuits cochées dans la grille"
              >
                Check-in {frDate(checkin)} → check-out {frDate(checkout)} ·{' '}
                {nuitDates.length} nuit{nuitDates.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )
      })()}
    </div>
  )
}

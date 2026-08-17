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

import { useMemo, useState } from 'react'
import {
  BedDouble,
  Bus,
  Car,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Image as ImageIcon,
  MapPin,
  Pencil,
  Plane,
  Plus,
  Train,
  TramFront,
  UtensilsCrossed,
} from 'lucide-react'
import { DocPreviewModal, docIsImage, downloadDoc } from './LogistiqueDocViewer'
import { notify } from '../../lib/notify'

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

/** Ouvre l'adresse dans l'app de cartes du téléphone (Plans / Google Maps). */
function mapsHref(adresse) {
  return `https://maps.google.com/?q=${encodeURIComponent(adresse.replace(/\s+/g, ' ').trim())}`
}

// Téléphones FR (06 78 09 84 35, +33…) et URLs — rendus tapables dans les
// notes d'hébergement : sur le terrain on appelle la réception, on ne
// recopie pas un numéro à la main.
const LINKIFY_RE = /(https?:\/\/[^\s]+|(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4})/g

function LinkifiedText({ text, style }) {
  const parts = String(text).split(LINKIFY_RE)
  return (
    <span className="whitespace-pre-line" style={style}>
      {parts.map((part, i) => {
        if (!part) return null
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noreferrer" style={{ color: 'var(--blue)' }}>
              {part}
            </a>
          )
        }
        if (/^(?:\+33|0)\s?[1-9](?:[\s.-]?\d{2}){4}$/.test(part)) {
          return (
            <a key={i} href={`tel:${part.replace(/[\s.-]/g, '')}`} style={{ color: 'var(--blue)' }}>
              {part}
            </a>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

const REPAS_LABELS = { client: 'Client', production: 'Production', defraye: 'Défrayé' }
const REPAS_COLORS = { client: '#22c55e', production: '#3b82f6', defraye: '#f59e0b' }

/** Repas pris en charge, groupés par jour, repliés par défaut. */
function RepasBloc({ repas }) {
  const [open, setOpen] = useState(false)
  const jours = useMemo(() => {
    const byDate = new Map()
    for (const r of repas) {
      if (!r.statut) continue
      const e = byDate.get(r.date_repas) || {}
      e[r.service] = r.statut
      byDate.set(r.date_repas, e)
    }
    return Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [repas])

  if (jours.length === 0) return null

  return (
    <div
      className="rounded-lg px-3 py-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left"
      >
        <UtensilsCrossed className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
          Repas pris en charge
        </span>
        <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
          {jours.length} jour{jours.length > 1 ? 's' : ''}
        </span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: 'var(--txt-3)' }} />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto shrink-0" style={{ color: 'var(--txt-3)' }} />
        )}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col">
          {jours.map(([date, services]) => (
            <div
              key={date}
              className="flex items-center gap-2 py-1 flex-wrap"
              style={{ borderTop: '1px solid var(--brd-sub)' }}
            >
              <span className="text-[11px] font-medium" style={{ color: 'var(--txt-2)', minWidth: 90 }}>
                {frDate(date)}
              </span>
              {['midi', 'soir'].map((svc) =>
                services[svc] ? (
                  <span key={svc} className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                    {svc}{' '}
                    <span style={{ color: REPAS_COLORS[services[svc]], fontWeight: 600 }}>
                      {REPAS_LABELS[services[svc]]}
                    </span>
                  </span>
                ) : null,
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Notes d'un hébergement, repliées par défaut. */
function HebergementNotes({ notes }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] font-semibold"
        style={{ color: 'var(--txt-2)' }}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Infos pratiques
      </button>
      {open && (
        <div className="mt-1 pl-4 text-[11px] leading-relaxed">
          <LinkifiedText text={notes} style={{ color: 'var(--txt-2)' }} />
        </div>
      )}
    </div>
  )
}

/** Lendemain d'une date ISO (check-out = dernière nuit + 1 jour). */
function nextDay(iso) {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Séjours d'une personne, un par hébergement (double hébergement : A jusqu'au
 * 24, B ensuite). Les nuits portent chacune leur hebergement_id, donc on
 * regroupe par hébergement et on dérive check-in / check-out de CHAQUE groupe.
 * Trié par date de check-in. Les rows chambre/PDJ sans nuit restante
 * apparaissent quand même (infos conservées).
 */
function buildSejours(nuits, hebergementMembres) {
  const byHeb = new Map()
  for (const n of nuits) {
    const key = n.hebergement_id || '__sans__'
    const dates = byHeb.get(key) || []
    dates.push(n.date_nuit)
    byHeb.set(key, dates)
  }
  for (const hm of hebergementMembres) {
    if (hm.hebergement_id && !byHeb.has(hm.hebergement_id)) {
      byHeb.set(hm.hebergement_id, [])
    }
  }
  const hmByHeb = new Map(hebergementMembres.map((hm) => [hm.hebergement_id, hm]))
  return Array.from(byHeb.entries())
    .map(([key, dates]) => {
      const sorted = [...dates].sort()
      const hebId = key === '__sans__' ? null : key
      return {
        hebergementId: hebId,
        hm: hebId ? hmByHeb.get(hebId) || null : null,
        nuits: sorted.length,
        checkin: sorted[0] || null,
        checkout: sorted.length ? nextDay(sorted[sorted.length - 1]) : null,
      }
    })
    .sort((a, b) => (a.checkin || '9999').localeCompare(b.checkin || '9999'))
}

export default function LogistiqueStructuredSection({
  trajets = [],
  hebergements = [],
  hebergementMembres = [], // rows projet_logistique_hebergement_membres du membre
  nuits = [], // nuits du membre (dates + hebergement_id)
  repas = [], // repas du membre (date_repas, service, statut)
  docs = [], // projet_logistique_docs (tous parents — filtrés par trajet/heb ici)
  readOnly = false,
  onEditTrajet, // (trajet) => void
  onAddTrajet, // () => void
  onPatchHebergementMembre, // (patch, hebergementId) => void
}) {
  const [previewDoc, setPreviewDoc] = useState(null)
  // Un séjour par hébergement : une personne peut basculer de logement en
  // cours de projet, chaque bloc porte ses propres dates.
  const sejours = buildSejours(nuits, hebergementMembres)

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
                            {e.depart || 'à préciser'} →
                            {e.heure_arrivee ? ` ${e.heure_arrivee}` : ''}{' '}
                            {e.arrivee || 'à préciser'}
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
                <DocChips
                  docs={docs.filter(
                    (d) => d.parent_type === 'trajet' && d.parent_id === t.id,
                  )}
                  onPreview={setPreviewDoc}
                />
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

      {/* ── Hébergements — DÉRIVÉS des nuits cochées dans la grille (modèle
          validé Hugo) : ici on lit le lieu et on n'édite que chambre/PDJ.
          Un bloc par séjour : une personne peut changer de logement en cours
          de projet, chaque bloc porte ses propres check-in / check-out. */}
      {sejours.map((s) => {
        const heb = s.hebergementId
          ? hebergements.find((h) => h.id === s.hebergementId) || null
          : null
        if (!heb && !s.nuits) return null
        return (
          <div
            key={s.hebergementId || 'sans'}
            className="rounded-lg px-3 py-2.5 flex flex-col gap-1.5"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
          >
            {/* Ligne 1 : nom + chambre + PDJ */}
            <div className="flex items-center gap-2.5 flex-wrap">
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
                    s.hm?.chambre && (
                      <span
                        className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(167,139,250,0.14)', color: 'var(--purple, #a78bfa)' }}
                      >
                        Chambre {s.hm.chambre}
                      </span>
                    )
                  ) : (
                    <input
                      type="text"
                      defaultValue={s.hm?.chambre || ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null
                        if (v !== (s.hm?.chambre || null)) {
                          onPatchHebergementMembre?.({ chambre: v }, heb.id)
                        }
                      }}
                      placeholder="Chambre"
                      className="w-[90px] text-[11px] px-2 py-1 rounded-md outline-none"
                      style={inputStyle}
                    />
                  )}
                  {/* En lecture, le PDJ n'apparaît que s'il est inclus : une
                      case vide grise n'apprend rien à qui lit sa fiche. */}
                  {readOnly ? (
                    s.hm?.pdj && (
                      <span className="text-[11px]" style={{ color: 'var(--txt-2)' }}>
                        Petit-déjeuner inclus
                      </span>
                    )
                  ) : (
                    <label
                      className="flex items-center gap-1 text-[11px] cursor-pointer"
                      style={{ color: 'var(--txt-2)' }}
                      title="Petit-déjeuner inclus"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(s.hm?.pdj)}
                        onChange={(e) => onPatchHebergementMembre?.({ pdj: e.target.checked }, heb.id)}
                        style={{ accentColor: 'var(--purple, #a78bfa)' }}
                      />
                      PDJ
                    </label>
                  )}
                </>
              )}

            </div>

            {/* Ligne 2 : séjour. Alignée à gauche sous le nom (en ml-auto
                elle se retrouvait orpheline à droite dès que ça wrappait). */}
            {s.checkin && s.checkout && (
              <span
                className="text-[11px]"
                style={{ color: 'var(--txt-2)' }}
                title="Calculé depuis les nuits cochées dans la grille"
              >
                {frDate(s.checkin)} → {frDate(s.checkout)} · {s.nuits} nuit
                {s.nuits > 1 ? 's' : ''}
              </span>
            )}

            {/* Ligne 3 : adresse cliquable (ouvre l'app de cartes) */}
            {heb?.adresse && (
              <a
                href={mapsHref(heb.adresse)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-start gap-1 text-[11px] w-fit"
                style={{ color: 'var(--blue)' }}
              >
                <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
                <span className="whitespace-pre-line">{heb.adresse}</span>
              </a>
            )}

            {/* Docs (résa, fiche d'accès) */}
            {heb && (
              <DocChips
                docs={docs.filter(
                  (d) => d.parent_type === 'hebergement' && d.parent_id === heb.id,
                )}
                onPreview={setPreviewDoc}
              />
            )}

            {/* Infos pratiques : les notes de l'hébergement (badge, clés,
                horaires d'accueil…) — repliées pour ne pas noyer la fiche,
                numéros et liens rendus tapables. */}
            {heb?.notes && <HebergementNotes notes={heb.notes} />}
          </div>
        )
      })}

      {/* ── Repas pris en charge : l'info manquait de la fiche alors que
          c'est une question de tous les midis sur le terrain. Repliée. ── */}
      {repas.length > 0 && <RepasBloc repas={repas} />}

      {previewDoc && (
        <DocPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}

// ─── Chips documents (billets, résas) : clic = aperçu, flèche = télécharger ─
function DocChips({ docs, onPreview }) {
  if (!docs.length) return null
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {docs.map((doc) => {
        const DocIcon = docIsImage(doc) ? ImageIcon : FileText
        return (
          <span
            key={doc.id}
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
          >
            <DocIcon className="w-2.5 h-2.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
            <button
              type="button"
              onClick={() => onPreview(doc)}
              className="hover:underline max-w-[140px] truncate"
              style={{ color: 'var(--txt-2)', textUnderlineOffset: '2px' }}
              title="Aperçu"
            >
              {doc.filename}
            </button>
            <button
              type="button"
              onClick={() =>
                downloadDoc(doc).catch((err) =>
                  notify.error('Téléchargement : ' + (err?.message || err)),
                )
              }
              className="shrink-0"
              style={{ color: 'var(--txt-3)' }}
              title="Télécharger"
            >
              <Download className="w-2.5 h-2.5" />
            </button>
          </span>
        )
      })}
    </span>
  )
}

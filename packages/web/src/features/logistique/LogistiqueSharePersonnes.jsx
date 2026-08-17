// ════════════════════════════════════════════════════════════════════════════
// LogistiqueSharePersonnes — bloc « Ma fiche » + équipe repliée (page publique)
// ════════════════════════════════════════════════════════════════════════════
//
// Sur le terrain, celui qui ouvre le lien vient chercher SES infos : son
// train, son logement, ses repas. Avant, il devait scroller toute l'équipe
// pour trouver sa carte.
//
// On lui demande donc une fois qui il est (mémorisé par lien dans le
// localStorage, comme le prénom du portail RP des musiques), sa fiche passe
// en tête dépliée, et le reste de l'équipe devient une liste repliable avec
// recherche.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, UserRound } from 'lucide-react'
import {
  membreDisplayName,
  membrePosteLabel,
} from './logistiqueSynthese'

const STORAGE_PREFIX = 'logistique.share.moi.'

/** Identité mémorisée pour ce lien (null si jamais choisie). */
function readMoi(storageKey) {
  if (!storageKey || typeof localStorage === 'undefined') return null
  return localStorage.getItem(STORAGE_PREFIX + storageKey) || null
}

function writeMoi(storageKey, membreId) {
  if (!storageKey || typeof localStorage === 'undefined') return
  if (membreId) localStorage.setItem(STORAGE_PREFIX + storageKey, membreId)
  else localStorage.removeItem(STORAGE_PREFIX + storageKey)
}

function initialsOf(membre) {
  const prenom = membre.contact?.prenom || membre.prenom || ''
  const nom = membre.contact?.nom || membre.nom || ''
  return `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Résumé d'une ligne repliée : arrivée + logement, ce qu'on cherche du regard. */
function resumeFor(membre, { trajets, nuits, hebergements }) {
  const bits = []
  const aller = trajets
    .filter((t) => t.membre_id === membre.id && t.sens === 'aller' && t.date_trajet)
    .sort((a, b) => a.date_trajet.localeCompare(b.date_trajet))[0]
  if (aller) {
    const d = new Date(`${aller.date_trajet}T12:00:00`)
    bits.push(d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }))
  }
  const hebIds = [
    ...new Set(
      nuits.filter((n) => n.membre_id === membre.id && n.hebergement_id).map((n) => n.hebergement_id),
    ),
  ]
  if (hebIds.length === 1) {
    const h = hebergements.find((x) => x.id === hebIds[0])
    if (h) bits.push(h.nom)
  } else if (hebIds.length > 1) {
    bits.push(`${hebIds.length} logements`)
  }
  return bits.join(' · ')
}

export default function LogistiqueSharePersonnes({
  storageKey,
  personRows,
  logi,
  renderCard, // (membre) => ReactNode — la carte complète, fournie par la page
  between = null, // inséré entre « Ma fiche » et l'équipe (infos générales)
}) {
  const [moiId, setMoiId] = useState(() => readMoi(storageKey))
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [openIds, setOpenIds] = useState(() => new Set())

  const moi = personRows.find((m) => m.id === moiId) || null
  const autres = moi ? personRows.filter((m) => m.id !== moi.id) : personRows

  const filtered = useMemo(() => {
    const q = normalize(query).trim()
    if (!q) return autres
    return autres.filter(
      (m) =>
        normalize(membreDisplayName(m)).includes(q) ||
        normalize(membrePosteLabel(m)).includes(q),
    )
  }, [autres, query])

  function choose(id) {
    setMoiId(id)
    writeMoi(storageKey, id)
    setPicking(false)
  }

  function toggle(id) {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Ma fiche ──────────────────────────────────────────────────────── */}
      <section id="ma-fiche" className="scroll-mt-20">
        {moi && !picking ? (
          <>
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <SectionLabel>Ma fiche</SectionLabel>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="text-[11px] font-semibold"
                style={{ color: 'var(--blue)' }}
              >
                ce n&apos;est pas moi
              </button>
            </div>
            <div
              className="rounded-xl p-4"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--blue)',
                boxShadow: '0 0 0 3px rgba(59,130,246,0.08)',
              }}
            >
              <PersonHeader membre={moi} big />
              {renderCard(moi)}
            </div>
          </>
        ) : (
          <IdentityPicker
            personRows={personRows}
            currentId={moiId}
            onChoose={choose}
            onCancel={moi ? () => setPicking(false) : null}
          />
        )}
      </section>

      {/* Infos générales : juste après sa fiche, avant l'équipe — ça
          concerne tout le monde et ça se lit en arrivant. */}
      {between}

      {/* ── Le reste de l'équipe, replié ──────────────────────────────────── */}
      {autres.length > 0 && (
        <section id="equipe" className="scroll-mt-20">
          <div className="flex items-center gap-3 mb-2.5 flex-wrap">
            <SectionLabel>{moi ? 'Le reste de l’équipe' : 'Équipe'}</SectionLabel>
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {autres.length} personne{autres.length > 1 ? 's' : ''}
            </span>
            <div className="ml-auto relative">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--txt-3)' }}
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Chercher quelqu’un"
                className="text-xs pl-8 pr-3 py-1.5 rounded-lg outline-none w-[180px] sm:w-[220px]"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {filtered.length === 0 && (
              <p className="text-xs py-3 text-center" style={{ color: 'var(--txt-3)' }}>
                Personne à ce nom.
              </p>
            )}
            {filtered.map((membre) => {
              const open = openIds.has(membre.id)
              return (
                <div
                  key={membre.id}
                  className="rounded-xl overflow-hidden shrink-0"
                  style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
                >
                  <button
                    type="button"
                    onClick={() => toggle(membre.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{
                        background: 'var(--bg-elev)',
                        color: 'var(--txt-2)',
                        border: '1px solid var(--brd)',
                      }}
                    >
                      {initialsOf(membre)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className="block text-sm font-semibold truncate"
                        style={{ color: 'var(--txt)' }}
                      >
                        {membreDisplayName(membre)}
                      </span>
                      <span
                        className="block text-[11px] truncate"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {[membrePosteLabel(membre), resumeFor(membre, logi)]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {open ? (
                      <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
                    ) : (
                      <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--txt-3)' }} />
                    )}
                  </button>
                  {open && (
                    <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--brd-sub)' }}>
                      <div className="pt-3">{renderCard(membre)}</div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Sélecteur d'identité ──────────────────────────────────────────────────

function IdentityPicker({ personRows, currentId, onChoose, onCancel }) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = normalize(query).trim()
    if (!q) return personRows
    return personRows.filter((m) => normalize(membreDisplayName(m)).includes(q))
  }, [personRows, query])

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-start gap-2.5 mb-3">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <UserRound className="w-4 h-4" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-3">
            <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
              Qui es-tu ?
            </p>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto text-[11px] font-semibold shrink-0"
                style={{ color: 'var(--txt-3)' }}
              >
                Annuler
              </button>
            )}
          </div>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Tes infos s&apos;afficheront en haut de la page à chaque visite.
          </p>
        </div>
      </div>

      {personRows.length > 8 && (
        <div className="relative mb-2">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--txt-3)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ton nom"
            autoFocus
            className="w-full text-xs pl-8 pr-3 py-2 rounded-lg outline-none"
            style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {filtered.map((m) => {
          const active = m.id === currentId
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChoose(m.id)}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
                color: active ? 'var(--blue)' : 'var(--txt-2)',
                border: `1px solid ${active ? 'var(--blue)' : 'var(--brd-sub)'}`,
              }}
            >
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{ background: 'var(--bg-surf)', color: 'var(--txt-3)' }}
              >
                {initialsOf(m)}
              </span>
              {membreDisplayName(m)}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Entête d'une fiche mise en avant ──────────────────────────────────────

function PersonHeader({ membre, big = false }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div
        className={`${big ? 'w-11 h-11 text-sm' : 'w-9 h-9 text-xs'} rounded-full flex items-center justify-center font-bold shrink-0`}
        style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
      >
        {initialsOf(membre)}
      </div>
      <div className="min-w-0">
        <p
          className={`${big ? 'text-base' : 'text-sm'} font-bold truncate`}
          style={{ color: 'var(--txt)' }}
        >
          {membreDisplayName(membre)}
        </p>
        {membrePosteLabel(membre) && (
          <p className="text-[11px] truncate" style={{ color: 'var(--txt-3)' }}>
            {membrePosteLabel(membre)}
          </p>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <h2
      className="text-[11px] font-bold uppercase tracking-wider"
      style={{ color: 'var(--txt-3)', letterSpacing: '0.1em' }}
    >
      {children}
    </h2>
  )
}

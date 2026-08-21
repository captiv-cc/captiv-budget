// ════════════════════════════════════════════════════════════════════════════
// ContenusTable — liste de validation des contenus (desk + portail public)
// ════════════════════════════════════════════════════════════════════════════
//
// Un seul composant pour les deux surfaces : le desk le rend avec canEdit,
// le lien photographes en lecture seule, le lien équipe (mot de passe) en
// écriture. Toute écriture porte le prénom de son auteur.
//
// Sous 640px on abandonne le tableau au profit de cartes empilées : les
// photographes consultent depuis leur téléphone, un tableau qui scrolle
// horizontalement y est inutilisable.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Eye,
  EyeOff,
  ExternalLink,
  Image as ImageIcon,
  MessageCircle,
  Search,
  Trash2,
  UserRound,
  Video,
} from 'lucide-react'
import {
  CONTENU_STATUTS,
  CONTENU_STATUT_COLORS,
  CONTENU_STATUT_LABELS,
  CONTENU_TYPE_LABELS,
  contenuSujet,
  resolveSujet,
} from '../../lib/contenus'
import useBreakpoint from '../../hooks/useBreakpoint'
import RefSelect from './RefSelect'
import JourSelect, { labelForDate } from './JourSelect'

// Teinte de fond par statut : une pastille seule se repère mal dans une
// longue liste. Très légère — la ligne doit rester lisible, pas criarde.
// Même parti pris que le portail RP des autorisations musiques.
const ROW_TINT = {
  valide: 'rgba(34,197,94,0.07)',
  refuse: 'rgba(239,68,68,0.06)',
  a_revoir: 'rgba(245,158,11,0.06)',
  en_attente: 'transparent',
}

const GROUP_BY_OPTIONS = [
  { value: 'espace', label: 'Espace' },
  { value: 'date', label: 'Date' },
  { value: 'artiste', label: 'Artiste' },
]

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

export default function ContenusTable({
  contenus = [],
  events = [],
  canEdit = false,
  refs = { espace: [], photographe: [], suivi: [] },
  jours = [],
  artistes = [],
  onPatch, // (contenu, patch) => Promise
  onDelete, // (contenu) => Promise
  onComment, // (contenu, text) => Promise
  onCreateRef, // (kind, valeur) => Promise
  // Nom du photographe qui consulte (lien de suivi). Fourni → bascule
  // « Mes contenus », active par défaut : il vient voir les siens.
  mineName = null,
}) {
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'sm'

  const [statutFilter, setStatutFilter] = useState(null)
  // Une fois validé, un contenu n'a plus besoin d'être sous les yeux : ce
  // qui reste à traiter doit pouvoir occuper tout l'écran.
  const [hideValides, setHideValides] = useState(false)
  const [onlyMine, setOnlyMine] = useState(false)

  // L'identité arrive après le premier rendu (localStorage puis payload) :
  // on active la bascule dès qu'elle est connue, une seule fois.
  useEffect(() => {
    if (mineName) setOnlyMine(true)
  }, [mineName])
  const [typeFilter, setTypeFilter] = useState(null)
  const [query, setQuery] = useState('')
  const [groupBy, setGroupBy] = useState('espace')
  const [eventsFor, setEventsFor] = useState(null)

  const counts = useMemo(() => {
    const out = { en_attente: 0, valide: 0, a_revoir: 0, refuse: 0 }
    for (const c of contenus) out[c.statut] = (out[c.statut] || 0) + 1
    return out
  }, [contenus])

  const eventsByContenu = useMemo(() => {
    const map = new Map()
    for (const e of events) {
      const arr = map.get(e.contenu_id) || []
      arr.push(e)
      map.set(e.contenu_id, arr)
    }
    return map
  }, [events])

  const filtered = useMemo(() => {
    const q = normalize(query).trim()
    return contenus.filter((c) => {
      if (onlyMine && mineName && c.photographe !== mineName) return false
      if (hideValides && c.statut === 'valide') return false
      if (statutFilter && c.statut !== statutFilter) return false
      if (typeFilter && c.type !== typeFilter) return false
      if (!q) return true
      return [contenuSujet(c), c.espace, c.photographe, c.suivi_par]
        .map(normalize)
        .some((v) => v.includes(q))
    })
  }, [contenus, statutFilter, typeFilter, query, hideValides, onlyMine, mineName])

  const groups = useMemo(() => {
    const byKey = new Map()
    for (const c of filtered) {
      let key
      if (groupBy === 'date') {
        key = c.date_contenu ? labelForDate(c.date_contenu, jours) : 'Date non précisée'
      }
      else if (groupBy === 'artiste') key = contenuSujet(c)
      else key = (c.espace || '').trim() || 'Espace non précisé'
      const arr = byKey.get(key) || []
      arr.push(c)
      byKey.set(key, arr)
    }
    // Les entrées non renseignées ferment la liste, jamais l'inverse.
    return [...byKey.entries()].sort(([a], [b]) => {
      const aVide = a.startsWith('Espace non') || a.startsWith('Date non')
      const bVide = b.startsWith('Espace non') || b.startsWith('Date non')
      if (aVide !== bVide) return aVide ? 1 : -1
      return a.localeCompare(b, 'fr', { sensitivity: 'base' })
    })
  }, [filtered, groupBy, jours])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Barre : compteurs cliquables, type, recherche, groupement ── */}
      <div className="flex flex-wrap items-center gap-2">
        {CONTENU_STATUTS.map((s) => {
          const active = statutFilter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatutFilter(active ? null : s)
                if (!active && s === 'valide') setHideValides(false)
              }}
              className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
              style={{
                background: active ? `${CONTENU_STATUT_COLORS[s]}1f` : 'var(--bg-surf)',
                color: active ? CONTENU_STATUT_COLORS[s] : 'var(--txt-2)',
                border: `1px solid ${active ? CONTENU_STATUT_COLORS[s] : 'var(--brd-sub)'}`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: CONTENU_STATUT_COLORS[s] }}
              />
              {counts[s] || 0} {CONTENU_STATUT_LABELS[s].toLowerCase()}
            </button>
          )
        })}

        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--brd-sub)' }}>
          {[
            { value: null, label: 'Tout' },
            { value: 'photo', label: 'Photo' },
            { value: 'video', label: 'Vidéo' },
          ].map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => setTypeFilter(o.value)}
              className="text-xs font-semibold px-2.5 py-1.5"
              style={{
                background: typeFilter === o.value ? 'var(--blue-bg)' : 'var(--bg-surf)',
                color: typeFilter === o.value ? 'var(--blue)' : 'var(--txt-2)',
              }}
            >
              {o.label}
            </button>
          ))}
        </div>

        {mineName && (
          <button
            type="button"
            onClick={() => setOnlyMine((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
            style={{
              background: onlyMine ? 'var(--blue-bg)' : 'var(--bg-surf)',
              color: onlyMine ? 'var(--blue)' : 'var(--txt-2)',
              border: `1px solid ${onlyMine ? 'var(--blue)' : 'var(--brd-sub)'}`,
            }}
            title={onlyMine ? 'Voir les contenus de toute l’équipe' : `Ne voir que les contenus de ${mineName}`}
          >
            <UserRound className="w-3.5 h-3.5" />
            {onlyMine ? 'Mes contenus' : 'Tout le monde'}
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setHideValides((v) => !v)
            if (!hideValides && statutFilter === 'valide') setStatutFilter(null)
          }}
          className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg"
          style={{
            background: hideValides ? 'var(--blue-bg)' : 'var(--bg-surf)',
            color: hideValides ? 'var(--blue)' : 'var(--txt-2)',
            border: `1px solid ${hideValides ? 'var(--blue)' : 'var(--brd-sub)'}`,
          }}
          title={hideValides ? 'Réafficher les contenus validés' : 'Ne garder que ce qui reste à traiter'}
        >
          {hideValides ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          {hideValides ? 'Tout afficher' : 'Masquer les validés'}
        </button>

        <div className="relative ml-auto">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--txt-3)' }}
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Artiste, espace, photographe…"
            className="text-xs pl-8 pr-3 py-1.5 rounded-lg outline-none w-[190px] sm:w-[240px]"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
        </div>

        <select
          value={groupBy}
          onChange={(e) => setGroupBy(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-lg outline-none"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)', color: 'var(--txt-2)' }}
          title="Regrouper par"
        >
          {GROUP_BY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Par {o.label.toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-center py-10" style={{ color: 'var(--txt-3)' }}>
          {contenus.length === 0
            ? 'Aucun contenu pour le moment.'
            : onlyMine && mineName
              ? `Aucun contenu à ton nom (${mineName}) pour l'instant.`
              : hideValides
                ? 'Tout est validé.'
                : 'Aucun contenu ne correspond à ces filtres.'}
        </p>
      )}

      {groups.map(([label, rows]) => (
        <section
          key={label}
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <header
            className="flex items-center gap-2 px-4 py-2.5"
            style={{ background: 'var(--bg-elev)', borderBottom: '1px solid var(--brd-sub)' }}
          >
            <h3
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--accent, #f97316)', letterSpacing: '0.08em' }}
            >
              {label}
            </h3>
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {rows.length} contenu{rows.length > 1 ? 's' : ''}
            </span>
          </header>

          {isMobile ? (
            <div className="flex flex-col">
              {rows.map((c) => (
                <ContenuCard
                  key={c.id}
                  contenu={c}
                  canEdit={canEdit}
                  refs={refs}
                  jours={jours}
                  artistes={artistes}
                  commentCount={(eventsByContenu.get(c.id) || []).filter((e) => e.kind === 'comment').length}
                  onPatch={onPatch}
                  onDelete={onDelete}
                  onCreateRef={onCreateRef}
                  onOpenEvents={() => setEventsFor(c)}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs" style={{ minWidth: 860 }}>
                <thead>
                  <tr style={{ color: 'var(--txt-3)' }}>
                    <Th>Contenu</Th>
                    <Th width={130}>Date</Th>
                    <Th width={150}>Espace</Th>
                    <Th width={140}>Photographe</Th>
                    <Th width={120}>Statut</Th>
                    <Th width={130}>Suivi par</Th>
                    <Th width={110}>Drive</Th>
                    <Th width={70} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <ContenuRow
                      key={c.id}
                      contenu={c}
                      canEdit={canEdit}
                      refs={refs}
                      jours={jours}
                      artistes={artistes}
                      commentCount={(eventsByContenu.get(c.id) || []).filter((e) => e.kind === 'comment').length}
                      onPatch={onPatch}
                      onDelete={onDelete}
                      onCreateRef={onCreateRef}
                      onOpenEvents={() => setEventsFor(c)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      {eventsFor && (
        <EventsPanel
          contenu={eventsFor}
          events={eventsByContenu.get(eventsFor.id) || []}
          canEdit={canEdit}
          onComment={onComment}
          onClose={() => setEventsFor(null)}
        />
      )}
    </div>
  )
}

function Th({ children, width }) {
  return (
    <th
      className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
      style={{ width, letterSpacing: '0.06em', borderBottom: '1px solid var(--brd-sub)' }}
    >
      {children}
    </th>
  )
}

// ─── Ligne (desktop) ────────────────────────────────────────────────────────

function ContenuRow({ contenu: c, canEdit, refs, jours, artistes, commentCount, onPatch, onDelete, onCreateRef, onOpenEvents }) {
  const TypeIcon = c.type === 'video' ? Video : ImageIcon
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: ROW_TINT[c.statut] || 'transparent',
      }}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={canEdit ? () => onPatch(c, { type: c.type === 'video' ? 'photo' : 'video' }) : undefined}
            className="shrink-0 p-0.5 rounded"
            style={{ color: 'var(--txt-3)', cursor: canEdit ? 'pointer' : 'default' }}
            title={canEdit ? `${CONTENU_TYPE_LABELS[c.type]} — cliquer pour basculer` : CONTENU_TYPE_LABELS[c.type]}
          >
            <TypeIcon className="w-3.5 h-3.5" />
          </button>
          <RefSelect
            value={contenuSujet(c)}
            options={artistes.map((a) => a.nom)}
            placeholder="Artiste ou moment"
            canEdit={canEdit}
            compact
            className="flex-1 min-w-0 font-semibold"
            style={{ padding: '2px 6px', background: 'transparent', border: '1px solid transparent', color: 'var(--txt)' }}
            onChange={(v) => onPatch(c, resolveSujet(v, artistes))}
          />
        </div>
        <TraceLine contenu={c} />
      </td>
      <td className="px-3 py-2" style={{ color: 'var(--txt-2)' }}>
        <JourSelect
          value={c.date_contenu}
          jours={jours}
          canEdit={canEdit}
          compact
          className="w-full"
          style={{ padding: '2px 6px', background: 'transparent', border: '1px solid transparent' }}
          onChange={(v) => onPatch(c, { date_contenu: v })}
        />
      </td>
      <td className="px-3 py-2">
        <RefSelect
          value={c.espace}
          options={refs.espace}
          placeholder="+ espace"
          canEdit={canEdit}
          compact
          className="w-full"
          style={{ padding: '2px 6px', background: 'transparent', border: '1px solid transparent' }}
          onChange={(v) => onPatch(c, { espace: v })}
          onCreate={(v) => onCreateRef('espace', v)}
        />
      </td>
      <td className="px-3 py-2">
        <RefSelect
          value={c.photographe}
          options={refs.photographe}
          placeholder="+ photographe"
          canEdit={canEdit}
          compact
          className="w-full"
          style={{ padding: '2px 6px', background: 'transparent', border: '1px solid transparent' }}
          onChange={(v) => onPatch(c, { photographe: v })}
          onCreate={(v) => onCreateRef('photographe', v)}
        />
      </td>
      <td className="px-3 py-2">
        <StatutChip
          statut={c.statut}
          decideAt={c.decide_at}
          canEdit={canEdit}
          onChange={(s) => onPatch(c, { statut: s })}
        />
      </td>
      <td className="px-3 py-2">
        <RefSelect
          value={c.suivi_par}
          options={refs.suivi}
          placeholder="+ responsable"
          canEdit={canEdit}
          compact
          className="w-full"
          style={{ padding: '2px 6px', background: 'transparent', border: '1px solid transparent' }}
          onChange={(v) => onPatch(c, { suivi_par: v })}
          onCreate={(v) => onCreateRef('suivi', v)}
        />
      </td>
      <td className="px-3 py-2">
        <DriveCell contenu={c} canEdit={canEdit} onPatch={onPatch} />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1 justify-end">
          <CommentButton count={commentCount} onClick={onOpenEvents} />
          {canEdit && (
            <button
              type="button"
              onClick={() => onDelete(c)}
              className="p-1 rounded"
              style={{ color: 'var(--txt-3)' }}
              title="Supprimer ce contenu"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Carte (mobile) ─────────────────────────────────────────────────────────

function ContenuCard({ contenu: c, canEdit, jours, commentCount, onPatch, onDelete, onOpenEvents }) {
  const TypeIcon = c.type === 'video' ? Video : ImageIcon
  return (
    <div
      className="px-4 py-3 flex flex-col gap-2"
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: ROW_TINT[c.statut] || 'transparent',
      }}
    >
      <div className="flex items-start gap-2">
        <TypeIcon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
            {contenuSujet(c)}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {[
              CONTENU_TYPE_LABELS[c.type],
              c.espace,
              c.date_contenu ? labelForDate(c.date_contenu, jours) : null,
              c.photographe,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <TraceLine contenu={c} />
        </div>
        <StatutChip
          statut={c.statut}
          decideAt={c.decide_at}
          canEdit={canEdit}
          onChange={(s) => onPatch(c, { statut: s })}
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {c.drive_url && (
          <a
            href={c.drive_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold"
            style={{ color: 'var(--blue)' }}
          >
            <ExternalLink className="w-3 h-3" />
            Ouvrir le drive
          </a>
        )}
        {c.suivi_par && (
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            Suivi par {c.suivi_par}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          <CommentButton count={commentCount} onClick={onOpenEvents} />
          {canEdit && (
            <button
              type="button"
              onClick={() => onDelete(c)}
              className="p-1.5 rounded"
              style={{ color: 'var(--txt-3)' }}
              title="Supprimer"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

/** Prénom normalisé, pour comparer « Hugo » et « Hugo MARTIN ». */
function firstName(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)[0]
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Qui a ajouté le contenu, et quand. C'est ce qui remplace les rôles : tout
 * le monde édite derrière le même mot de passe, la trace fait foi.
 */
function TraceLine({ contenu: c }) {
  if (!c.created_at) return null
  const quand = new Date(c.created_at).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
  })
  const qui = c.created_by_name || null
  // « Hugo » et « Hugo MARTIN » sont la même personne : on compare le
  // prénom, sinon la ligne répète l'auteur sous deux formes.
  const memePersonne =
    qui &&
    c.updated_by_name &&
    firstName(qui) === firstName(c.updated_by_name)
  return (
    <p className="text-[10px] mt-0.5 pl-6" style={{ color: 'var(--txt-3)', opacity: 0.75 }}>
      {qui ? `Ajouté par ${qui} · ${quand}` : `Ajouté le ${quand}`}
      {c.updated_by_name && !memePersonne ? ` · modifié par ${c.updated_by_name}` : ''}
    </p>
  )
}

// ─── Cellules ───────────────────────────────────────────────────────────────

function DriveCell({ contenu: c, canEdit, onPatch }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        autoFocus
        type="url"
        defaultValue={c.drive_url || ''}
        placeholder="https://drive.google.com/…"
        onBlur={(e) => {
          setEditing(false)
          const v = e.target.value.trim() || null
          if (v !== (c.drive_url || null)) onPatch(c, { drive_url: v })
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-full box-border px-1.5 py-0.5 rounded outline-none text-xs"
        style={{ background: 'var(--bg)', border: '1px solid var(--blue)', color: 'var(--txt)' }}
      />
    )
  }
  if (c.drive_url) {
    return (
      <span className="flex items-center gap-1">
        <a
          href={c.drive_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-semibold truncate"
          style={{ color: 'var(--blue)' }}
        >
          <ExternalLink className="w-3 h-3 shrink-0" />
          Ouvrir
        </a>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] opacity-50 hover:opacity-100"
            style={{ color: 'var(--txt-3)' }}
            title="Modifier le lien"
          >
            ✎
          </button>
        )}
      </span>
    )
  }
  if (!canEdit) return null
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="text-[10px] opacity-60 hover:opacity-100 transition-opacity"
      style={{ color: 'var(--txt-3)' }}
    >
      + lien
    </button>
  )
}

function CommentButton({ count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-1.5 py-1 rounded"
      style={{
        color: count ? 'var(--blue)' : 'var(--txt-3)',
        border: `1px solid ${count ? 'var(--blue)' : 'var(--brd-sub)'}`,
      }}
      title={count ? `${count} commentaire${count > 1 ? 's' : ''}` : 'Commentaires et remarques'}
    >
      <MessageCircle className="w-3.5 h-3.5" />
      {count > 0 && <span className="text-[10px] font-bold">{count}</span>}
    </button>
  )
}

// ─── Fil de commentaires ────────────────────────────────────────────────────
// En portal : les pages publiques animent leurs conteneurs avec un transform
// persistant, qui ferait référencer le `fixed` au conteneur au lieu du
// viewport (le panneau partirait en haut de page).

function EventsPanel({ contenu, events, canEdit, onComment, onClose }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function send() {
    const v = text.trim()
    if (!v || busy) return
    setBusy(true)
    try {
      await onComment(contenu, v)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-xl sm:rounded-xl flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          maxHeight: 'min(80vh, 640px)',
        }}
      >
        <header
          className="px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <p className="text-sm font-bold" style={{ color: 'var(--txt)' }}>
            {contenuSujet(contenu)}
          </p>
          <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            Commentaires et historique
          </p>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-2 [&>*]:shrink-0">
          {events.length === 0 && (
            <p className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
              Rien pour l&apos;instant.
            </p>
          )}
          {events.map((e) => (
            <div key={e.id} className="text-xs">
              <span className="font-semibold" style={{ color: 'var(--txt-2)' }}>
                {e.author_name || 'Équipe'}
              </span>
              <span className="text-[10px] ml-1.5" style={{ color: 'var(--txt-3)' }}>
                {new Date(e.created_at).toLocaleString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <p style={{ color: 'var(--txt)' }}>
                {e.kind === 'statut'
                  ? `→ ${CONTENU_STATUT_LABELS[e.body] || e.body}`
                  : e.body}
              </p>
            </div>
          ))}
        </div>

        <footer className="p-3 flex items-center gap-2 shrink-0" style={{ borderTop: '1px solid var(--brd-sub)' }}>
          {canEdit ? (
            <>
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') send()
                }}
                placeholder="Ajouter un commentaire…"
                className="flex-1 min-w-0 text-xs px-2.5 py-2 rounded-lg outline-none"
                style={{ background: 'var(--bg)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
              />
              <button
                type="button"
                onClick={send}
                disabled={busy || !text.trim()}
                className="text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-40"
                style={{ background: 'var(--blue)', color: '#fff' }}
              >
                Envoyer
              </button>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              Lecture seule.
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-2 py-2"
            style={{ color: 'var(--txt-2)' }}
          >
            Fermer
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

// ─── Pastille de statut ─────────────────────────────────────────────────────

function StatutChip({ statut, decideAt, canEdit, onChange }) {
  const [menuPos, setMenuPos] = useState(null)

  function toggleMenu(e) {
    if (menuPos) {
      setMenuPos(null)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const up = window.innerHeight - r.bottom < 170
    setMenuPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up })
  }

  return (
    <>
      <button
        type="button"
        onClick={canEdit ? toggleMenu : undefined}
        className="text-[10px] font-bold px-2 py-1 rounded-full whitespace-nowrap"
        style={{
          background: `${CONTENU_STATUT_COLORS[statut]}1a`,
          color: CONTENU_STATUT_COLORS[statut],
          border: `1px solid ${CONTENU_STATUT_COLORS[statut]}44`,
          cursor: canEdit ? 'pointer' : 'default',
        }}
        title={
          decideAt
            ? `Décidé le ${new Date(decideAt).toLocaleDateString('fr-FR')}`
            : undefined
        }
      >
        {CONTENU_STATUT_LABELS[statut]}
      </button>
      {menuPos &&
        createPortal(
          <>
            <span className="fixed inset-0 z-[80]" onClick={() => setMenuPos(null)} />
            <div
              className="fixed z-[81] rounded-lg py-1 shadow-xl"
              style={{
                left: menuPos.left,
                top: menuPos.top,
                transform: menuPos.up ? 'translateY(-100%)' : undefined,
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
                minWidth: 130,
              }}
            >
              {CONTENU_STATUTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setMenuPos(null)
                    if (s !== statut) onChange(s)
                  }}
                  className="flex items-center gap-2 w-full text-left text-[11px] font-semibold px-2.5 py-1.5"
                  style={{ color: CONTENU_STATUT_COLORS[s] }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: CONTENU_STATUT_COLORS[s] }}
                  />
                  {CONTENU_STATUT_LABELS[s]}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

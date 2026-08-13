// ════════════════════════════════════════════════════════════════════════════
// AutorisationsTable — tableau des autorisations track × média (présentationnel)
// ════════════════════════════════════════════════════════════════════════════
//
// Partagé entre l'onglet interne (AutorisationsView) et le portail RP
// public (ShareMusiqueAutorSession) — même rendu, mêmes interactions, seules
// les écritures diffèrent (Supabase RLS côté desk, RPCs token côté portail),
// injectées via onPatch / onOpenEvents.
//
// Règles UI validées Hugo : valeurs affichées (pas de champs de formulaire),
// édition inline au clic, affordances TOUJOURS visibles (les RP découvrent
// l'outil), table-layout fixed avec colgroup identique pour tous les médias.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  Search,
  Send,
  X,
  Youtube,
} from 'lucide-react'
import {
  AUTOR_STATUTS,
  AUTOR_STATUT_LABELS,
  AUTOR_STATUT_COLORS,
} from '../../lib/musiqueAutorisations'

export function credit(p) {
  return p?.artiste_text || p?.artiste?.nom || ''
}

/** Groupe les rows (links enrichis) par média, dans l'ordre des livrables. */
export function groupAutorRows(
  rows,
  { onlyChoisies = false, statutFilter = null, search = '' } = {},
) {
  const q = search.trim().toLowerCase()
  const visible = rows.filter((r) => {
    if (onlyChoisies && !(r.statut_local === 'choix' || r.statut_local === 'valide')) return false
    if (statutFilter && (r.autorisation?.statut || 'a_lancer') !== statutFilter) return false
    if (q) {
      const hay = `${credit(r.proposition)} ${r.proposition?.titre || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
  const byLivrable = new Map()
  for (const r of visible) {
    if (!byLivrable.has(r.livrable_id)) {
      byLivrable.set(r.livrable_id, { livrable: r.livrable, rows: [] })
    }
    byLivrable.get(r.livrable_id).rows.push(r)
  }
  const arr = Array.from(byLivrable.values())
  const rank = (l) => [l?.block?.sort_order ?? 999, l?.sort_order ?? 999]
  arr.sort((a, b) => {
    const [ab, al] = rank(a.livrable)
    const [bb, bl] = rank(b.livrable)
    return ab - bb || al - bl || (a.livrable?.nom || '').localeCompare(b.livrable?.nom || '', 'fr')
  })
  for (const g of arr) {
    g.rows.sort((a, b) =>
      credit(a.proposition).localeCompare(credit(b.proposition), 'fr', { sensitivity: 'base' }),
    )
  }
  return arr
}

export function computeAutorStats(groups) {
  const s = { a_lancer: 0, envoyee: 0, accordee: 0, refusee: 0 }
  for (const g of groups) {
    for (const r of g.rows) s[r.autorisation?.statut || 'a_lancer'] += 1
  }
  return s
}

/** Barre de compteurs par statut (masque les zéros). Cliquables quand
    onFilter est fourni : clic = filtre le tableau sur ce statut, re-clic
    = tout afficher. */
export function AutorStatsBar({ stats, activeFilter = null, onFilter, children }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {AUTOR_STATUTS.map((s) => {
        if (stats[s] === 0) return null
        const active = activeFilter === s
        return (
          <button
            key={s}
            type="button"
            onClick={onFilter ? () => onFilter(active ? null : s) : undefined}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              color: AUTOR_STATUT_COLORS[s],
              background: active ? `${AUTOR_STATUT_COLORS[s]}22` : 'transparent',
              border: `1px solid ${active ? `${AUTOR_STATUT_COLORS[s]}66` : 'transparent'}`,
              cursor: onFilter ? 'pointer' : 'default',
            }}
            title={onFilter ? (active ? 'Tout afficher' : 'Filtrer sur ce statut') : undefined}
          >
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: AUTOR_STATUT_COLORS[s] }} />
            {stats[s]} {AUTOR_STATUT_LABELS[s].toLowerCase()}
          </button>
        )
      })}
      {children}
    </div>
  )
}

/** Recherche artiste / titre (partagée desk + portail). */
export function AutorSearchInput({ value, onChange }) {
  return (
    <span className="relative inline-flex items-center">
      <Search className="w-3 h-3 absolute left-2 pointer-events-none" style={{ color: 'var(--txt-3)' }} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Artiste, titre…"
        className="pl-6 pr-2 py-1 rounded-md text-xs outline-none w-[180px]"
        style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
      />
    </span>
  )
}

// ─── Tableau complet (tous les médias) ─────────────────────────────────────

export default function AutorisationsTable({
  groups,
  canEdit = false,
  commentCounts = new Map(),
  playingId = null,
  onTogglePlay,
  onPatch, // (row, patch) => void
  onOpenEvents, // (row) => void
}) {
  return (
    <>
      {groups.map(({ livrable, rows: groupRows }) => (
        <section
          key={livrable?.id || 'none'}
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <header
            className="flex items-baseline gap-2 px-3 py-2"
            style={{ borderBottom: '1px solid var(--brd-sub)' }}
          >
            <h3
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: '#FF6E37', letterSpacing: '0.08em' }}
            >
              {livrable?.nom || 'Média supprimé'}
            </h3>
            <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {groupRows.length} track{groupRows.length > 1 ? 's' : ''}
            </span>
          </header>

          <div className="overflow-x-auto">
            {/* table-layout fixed + colgroup : mêmes largeurs sur TOUS les
                tableaux (sinon colonnes désalignées entre médias et décalage
                au clic sur un champ). */}
            <table className="w-full text-xs" style={{ minWidth: '960px', tableLayout: 'fixed' }}>
              <colgroup>
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 210 }} />
              </colgroup>
              <thead>
                <tr
                  className="text-[9px] uppercase tracking-widest"
                  style={{ color: 'var(--txt-3)', opacity: 0.8 }}
                >
                  <th className="px-3 pt-2 pb-1 text-left font-semibold">Track</th>
                  <th className="px-2 pt-2 pb-1 text-left font-semibold">Jour</th>
                  <th className="px-2 pt-2 pb-1 text-left font-semibold">Durée</th>
                  <th className="px-2 pt-2 pb-1 text-left font-semibold">Autorisation</th>
                  <th className="px-2 pt-2 pb-1 text-left font-semibold">Contact label</th>
                  <th className="px-2 pt-2 pb-1 text-left font-semibold">Master</th>
                  <th className="px-2 pt-2 pb-1 text-right font-semibold" />
                </tr>
              </thead>
              <tbody>
                {groupRows.map((row, i) => (
                  <AutorRow
                    key={row.id}
                    row={row}
                    zebra={i % 2 === 1}
                    canEdit={canEdit}
                    commentCount={row.autorisation ? commentCounts.get(row.autorisation.id) || 0 : 0}
                    playingId={playingId}
                    onTogglePlay={onTogglePlay}
                    onPatch={(patch) => onPatch(row, patch)}
                    onOpenEvents={() => onOpenEvents(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  )
}

// ─── Cellule éditable : valeur affichée, édition au clic ───────────────────

function EditableCell({ value, ghost, canEdit, onCommit }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        defaultValue={value || ''}
        onBlur={(e) => {
          setEditing(false)
          const v = e.target.value.trim() || null
          if (v !== (value || null)) onCommit(v)
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
  if (value) {
    return (
      <button
        type="button"
        onClick={canEdit ? () => setEditing(true) : undefined}
        className="block w-full text-left truncate text-xs"
        style={{ color: 'var(--txt-2)', cursor: canEdit ? 'text' : 'default' }}
        title={canEdit ? `${value} — clic pour modifier` : value}
      >
        {value}
      </button>
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
      + {ghost}
    </button>
  )
}

// ─── Chip statut avec menu ─────────────────────────────────────────────────
// Menu rendu en PORTAL (position fixe calculée depuis la chip) : le conteneur
// overflow-x-auto du tableau clippait le menu des dernières lignes, et les
// pages share ont un transform persistant qui fausse les position:fixed
// imbriqués.

function StatutChip({ statut, envoyeeAt, canEdit, onChange }) {
  const [menuPos, setMenuPos] = useState(null) // { left, top, up } | null

  function toggleMenu(e) {
    if (menuPos) {
      setMenuPos(null)
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    // 4 statuts ≈ 130px de menu : ouvre vers le haut si on est près du bas.
    const up = window.innerHeight - r.bottom < 170
    setMenuPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up })
  }

  return (
    <>
      <button
        type="button"
        onClick={canEdit ? toggleMenu : undefined}
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{
          background: `${AUTOR_STATUT_COLORS[statut]}1a`,
          color: AUTOR_STATUT_COLORS[statut],
          border: `1px solid ${AUTOR_STATUT_COLORS[statut]}44`,
          cursor: canEdit ? 'pointer' : 'default',
        }}
        title={
          envoyeeAt ? `Envoyée le ${new Date(envoyeeAt).toLocaleDateString('fr-FR')}` : undefined
        }
      >
        {AUTOR_STATUT_LABELS[statut]}
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
                minWidth: 120,
              }}
            >
              {AUTOR_STATUTS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setMenuPos(null)
                    if (s !== statut) onChange(s)
                  }}
                  className="flex items-center gap-2 w-full text-left text-[11px] font-semibold px-2.5 py-1.5"
                  style={{ color: AUTOR_STATUT_COLORS[s] }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: AUTOR_STATUT_COLORS[s] }} />
                  {AUTOR_STATUT_LABELS[s]}
                  {s === statut && <Check className="w-3 h-3 ml-auto" />}
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

// ─── Cellule master : lien + édition au crayon ─────────────────────────────

function MasterCell({ url, canEdit, onCommit }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        defaultValue={url || ''}
        placeholder="https://…"
        onBlur={(e) => {
          setEditing(false)
          const v = e.target.value.trim() || null
          if (v !== (url || null)) onCommit(v)
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
  if (url) {
    return (
      <span className="inline-flex items-center gap-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
          title={url}
        >
          <ExternalLink className="w-2.5 h-2.5" />
          Master
        </a>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="opacity-60 hover:opacity-100 text-[10px] transition-opacity px-0.5"
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
      + master
    </button>
  )
}

// ─── Chip toggle (Doc signé / Utilisé) — toujours visible ──────────────────

function ToggleChip({ active, label, color, canEdit, onToggle }) {
  if (!active && !canEdit) return null
  return (
    <button
      type="button"
      onClick={canEdit ? onToggle : undefined}
      className="text-[10px] font-semibold px-2 py-1 rounded-md whitespace-nowrap"
      style={{
        background: active ? `${color}22` : 'var(--bg-elev)',
        color: active ? color : 'var(--txt-3)',
        border: `1px solid ${active ? `${color}66` : 'var(--brd)'}`,
        cursor: canEdit ? 'pointer' : 'default',
      }}
      title={active ? 'Clic pour décocher' : 'Clic pour cocher'}
    >
      {label}
      {active ? ' ✓' : ''}
    </button>
  )
}

// ─── Ligne track ───────────────────────────────────────────────────────────

function AutorRow({ row, zebra, canEdit, commentCount, playingId, onTogglePlay, onPatch, onOpenEvents }) {
  const p = row.proposition
  const a = row.autorisation
  const statut = a?.statut || 'a_lancer'
  const isPlaying = playingId === p?.id
  // Fond de ligne selon l'issue : vert léger si autorisé, rouge léger si
  // refusé — l'état du média se lit d'un coup d'œil.
  const rowBg =
    statut === 'accordee'
      ? 'rgba(34,197,94,0.06)'
      : statut === 'refusee'
        ? 'rgba(239,68,68,0.06)'
        : zebra
          ? 'rgba(255,255,255,0.015)'
          : 'transparent'

  return (
    <tr
      className="group"
      style={{
        borderTop: '1px solid var(--brd-sub)',
        background: rowBg,
      }}
    >
      <td className="px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {p?.preview_url && onTogglePlay && (
            <button
              type="button"
              onClick={() => onTogglePlay(p)}
              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,110,55,0.12)' }}
              title={isPlaying ? 'Pause' : 'Écouter le preview'}
            >
              {isPlaying ? (
                <Pause size={10} fill="#FF6E37" style={{ color: '#FF6E37' }} />
              ) : (
                <Play size={10} fill="#FF6E37" style={{ color: '#FF6E37', marginLeft: 1 }} />
              )}
            </button>
          )}
          {p?.lien_youtube && (
            <a
              href={p.lien_youtube}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
              style={{ color: 'var(--txt-3)' }}
              title="Ouvrir sur YouTube"
            >
              <Youtube className="w-3.5 h-3.5" />
            </a>
          )}
          <span className="truncate">
            <span className="font-semibold" style={{ color: 'var(--txt)' }}>
              {credit(p)}
            </span>
            {p?.titre && <span style={{ color: 'var(--txt-3)' }}> · {p.titre}</span>}
          </span>
        </div>
      </td>

      <td className="px-2 py-1.5 whitespace-nowrap text-[11px]" style={{ color: 'var(--txt-3)' }}>
        {p?.artiste?.jour || ''}
      </td>

      <td className="px-2 py-1.5">
        <EditableCell
          value={a?.duree_utilisation}
          ghost="durée"
          canEdit={canEdit}
          onCommit={(v) => onPatch({ duree_utilisation: v })}
        />
      </td>

      <td className="px-2 py-1.5">
        <StatutChip
          statut={statut}
          envoyeeAt={a?.envoyee_at}
          canEdit={canEdit}
          onChange={(s) => onPatch({ statut: s })}
        />
      </td>

      <td className="px-2 py-1.5">
        <EditableCell
          value={a?.contact_label}
          ghost="contact"
          canEdit={canEdit}
          onCommit={(v) => onPatch({ contact_label: v })}
        />
      </td>

      <td className="px-2 py-1.5">
        <MasterCell url={a?.master_url} canEdit={canEdit} onCommit={(v) => onPatch({ master_url: v })} />
      </td>

      <td className="px-2 py-1.5">
        <div className="flex items-center gap-1.5 justify-end">
          <ToggleChip
            active={Boolean(a?.doc_signe)}
            label="Doc signé"
            color="#22c55e"
            canEdit={canEdit}
            onToggle={() => onPatch({ doc_signe: !a?.doc_signe })}
          />
          <ToggleChip
            active={Boolean(a?.utilise)}
            label="Utilisé"
            color="#a78bfa"
            canEdit={canEdit}
            onToggle={() => onPatch({ utilise: !a?.utilise })}
          />
          <button
            type="button"
            onClick={onOpenEvents}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md"
            style={{
              color: commentCount > 0 ? 'var(--blue)' : 'var(--txt-3)',
              background: commentCount > 0 ? 'var(--blue-bg)' : 'var(--bg-elev)',
              border: `1px solid ${commentCount > 0 ? 'var(--blue)' : 'var(--brd)'}`,
            }}
            title="Commentaires & historique"
          >
            <MessageCircle className="w-3 h-3" />
            {commentCount > 0 && <span className="text-[10px] font-bold">{commentCount}</span>}
          </button>
        </div>
      </td>
    </tr>
  )
}

// ─── Fil de commentaires + journal (CONTRÔLÉ : events et post injectés) ────

export function EventsPanel({ row, events, canEdit, posting = false, onPost, onClose }) {
  const [body, setBody] = useState('')
  const p = row.proposition

  async function handlePost() {
    if (!body.trim() || posting) return
    const ok = await onPost(body)
    if (ok !== false) setBody('')
  }

  // Portal : les pages share ont un transform persistant qui ferait
  // référencer ce fixed au conteneur (popup perdue en bas de page).
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <header
          className="flex items-center gap-2.5 px-4 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <MessageCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--blue)' }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate" style={{ color: 'var(--txt)' }}>
              {[credit(p), p?.titre].filter(Boolean).join(' · ')}
            </p>
            <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
              {row.livrable?.nom}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2">
          {events === null ? (
            <Loader2 className="w-4 h-4 animate-spin mx-auto my-6" style={{ color: 'var(--txt-3)' }} />
          ) : events.length === 0 ? null : (
            events.map((e) => {
              const author = e.author?.full_name || e.author_name || 'Anonyme'
              const date = new Date(e.created_at).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })
              if (e.kind === 'statut') {
                return (
                  <p key={e.id} className="text-[10px] text-center" style={{ color: 'var(--txt-3)' }}>
                    {date} — {author} : statut →{' '}
                    <b style={{ color: AUTOR_STATUT_COLORS[e.body] || 'var(--txt-2)' }}>
                      {AUTOR_STATUT_LABELS[e.body] || e.body}
                    </b>
                  </p>
                )
              }
              return (
                <div
                  key={e.id}
                  className="rounded-lg px-3 py-2"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                >
                  <p className="text-[10px] mb-0.5" style={{ color: 'var(--txt-3)' }}>
                    <b style={{ color: 'var(--txt-2)' }}>{author}</b> · {date}
                  </p>
                  <p className="text-xs whitespace-pre-line" style={{ color: 'var(--txt)' }}>
                    {e.body}
                  </p>
                </div>
              )
            })
          )}
        </div>

        {canEdit && (
          <div
            className="flex items-center gap-2 px-4 py-3 shrink-0"
            style={{ borderTop: '1px solid var(--brd-sub)' }}
          >
            <input
              type="text"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePost()}
              placeholder="Écrire un commentaire…"
              className="flex-1 text-xs px-2.5 py-2 rounded-md outline-none"
              style={{ background: 'var(--bg)', border: '1px solid var(--brd-sub)', color: 'var(--txt)' }}
            />
            <button
              type="button"
              onClick={handlePost}
              disabled={posting || !body.trim()}
              className="p-2 rounded-md disabled:opacity-40"
              style={{ background: 'var(--blue)', color: '#fff' }}
              title="Envoyer"
            >
              {posting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// AnnuaireView — gestion de l'annuaire artistes du projet (MUS-ANNUAIRE)
// ════════════════════════════════════════════════════════════════════════════
//
// Demande Hugo 2026-07-28 : reprendre la main après un import IA raté.
//   - Liste complète de projet_artistes avec édition inline (nom, jour,
//     scène, headliner) — toute correction passe la fiche en source
//     'manuel' pour survivre aux ré-imports.
//   - Suppression (FKs en SET NULL : les propositions/créneaux restent).
//   - Fusion de doublons : la fiche absorbée rattache ses propositions et
//     créneaux à la cible avant suppression. Un rename qui collisionne
//     (DUPLICATE_NOM) propose directement la fusion.
//   - Recoupement affiche ↔ timetable : compteur de créneaux déroulé par
//     artiste ; « 0 créneau » = vu sur l'affiche mais jamais retrouvé dans
//     la grille → erreur d'import probable. Filtres rapides + détection de
//     doublons proches (distance d'édition ≤ 2 sur le nom normalisé).
//
// Vue autonome : fetch son propre état (listArtistes + fetchArtisteCounts),
// remonte `onMutated` au parent pour rafraîchir les propositions (labels).
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  GitMerge,
  Loader2,
  Pencil,
  Search,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  deleteArtiste,
  deleteArtistes,
  fetchArtisteCounts,
  fetchJourSceneOptions,
  listArtistes,
  mergeArtistes,
  normalizeNom,
  setArtisteDupOk,
  updateArtiste,
} from '../../lib/projetArtistes'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'
import SelectCheckbox from '../materiel/components/SelectCheckbox'

// ─── Détection de doublons proches (nom_normalise) ──────────────────────────
// Levenshtein borné à 2 — suffisant pour attraper « DJ Snoke » / « DJ Snake »
// sans faux positifs massifs. On ne compare que les noms ≥ 4 caractères.

function editDistanceLe2(a, b) {
  if (Math.abs(a.length - b.length) > 2) return false
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      rowMin = Math.min(rowMin, dp[i][j])
    }
    if (rowMin > 2) return false // early exit : plus rattrapable
  }
  return dp[a.length][b.length] <= 2
}

function computeDuplicateIds(artistes) {
  const dup = new Set()
  // Un artiste confirmé « pas un doublon » (metadata.dup_ok, badge ✕)
  // neutralise toute paire qui le contient.
  const eligible = artistes.filter((a) => !a.metadata?.dup_ok)
  for (let i = 0; i < eligible.length; i++) {
    const a = eligible[i].nom_normalise || ''
    if (a.length < 4) continue
    for (let j = i + 1; j < eligible.length; j++) {
      const b = eligible[j].nom_normalise || ''
      if (b.length < 4) continue
      if (a === b) continue // impossible (unicité) mais defensif
      if (editDistanceLe2(a, b)) {
        dup.add(eligible[i].id)
        dup.add(eligible[j].id)
      }
    }
  }
  return dup
}

// 'grille' en BDD = import de la timetable (renommé côté UI, retour Hugo).
const SOURCE_LABELS = {
  manuel: { label: 'Manuel', color: 'var(--blue)' },
  grille: { label: 'Timetable', color: 'var(--green, #22c55e)' },
  affiche: { label: 'Affiche', color: 'var(--purple, #a78bfa)' },
}

export default function AnnuaireView({ projectId, canEdit = false, onMutated }) {
  const [artistes, setArtistes] = useState([])
  const [counts, setCounts] = useState({
    creneaux: new Map(),
    propositions: new Map(),
    scenes: new Map(),
    jours: new Map(),
  })
  const [options, setOptions] = useState({ jours: [], scenes: [] })
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all') // all | sans-creneau | doublons
  const [sourceFilter, setSourceFilter] = useState('') // '' | manuel | grille | affiche
  const [mergeSource, setMergeSource] = useState(null) // artiste à absorber
  const [mergeTargetId, setMergeTargetId] = useState(null) // pré-sélection (conflit rename)
  // Sélection multiple → suppression en masse (reset d'un import raté).
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const [list, cnt, opts] = await Promise.all([
        listArtistes(projectId, { limit: 500 }),
        fetchArtisteCounts(projectId),
        fetchJourSceneOptions(projectId),
      ])
      setArtistes(list)
      setCounts(cnt)
      setOptions(opts)
      // Purge la sélection des ids disparus (suppression concurrente).
      setSelectedIds((prev) => {
        const ids = new Set(list.map((a) => a.id))
        return new Set(Array.from(prev).filter((id) => ids.has(id)))
      })
    } catch (err) {
      notify.error('Chargement annuaire : ' + (err?.message || err))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const duplicateIds = useMemo(() => computeDuplicateIds(artistes), [artistes])

  const filtered = useMemo(() => {
    const q = normalizeNom(search)
    return artistes.filter((a) => {
      if (q && !(a.nom_normalise || '').includes(q)) return false
      if (sourceFilter && a.source !== sourceFilter) return false
      if (filter === 'sans-creneau' && (counts.creneaux.get(a.id) || 0) > 0) return false
      if (filter === 'doublons' && !duplicateIds.has(a.id)) return false
      return true
    })
  }, [artistes, search, filter, sourceFilter, counts, duplicateIds])

  const sansCreneauCount = useMemo(
    () => artistes.filter((a) => (counts.creneaux.get(a.id) || 0) === 0).length,
    [artistes, counts],
  )

  async function handleMutation(fn, successMsg) {
    try {
      await fn()
      if (successMsg) notify.success(successMsg)
      await load()
      onMutated?.()
      return true
    } catch (err) {
      if (err?.code === 'DUPLICATE_NOM' && err.conflictArtiste) {
        // Rename qui collisionne → on propose directement la fusion.
        notify.error(err.message)
        return false
      }
      notify.error(err?.message || String(err))
      return false
    }
  }

  async function handleRename(artiste, nom) {
    try {
      await updateArtiste(artiste.id, { nom })
      notify.success('Artiste renommé')
      await load()
      onMutated?.()
      return true
    } catch (err) {
      if (err?.code === 'DUPLICATE_NOM' && err.conflictArtiste) {
        setMergeSource(artiste)
        setMergeTargetId(err.conflictArtiste.id)
        return false
      }
      notify.error(err?.message || String(err))
      return false
    }
  }

  async function handleDelete(artiste) {
    const nCren = counts.creneaux.get(artiste.id) || 0
    const nProps = counts.propositions.get(artiste.id) || 0
    const ok = await confirm({
      title: `Supprimer « ${artiste.nom} » ?`,
      message:
        nCren || nProps
          ? `${nCren} créneau${nCren > 1 ? 'x' : ''} déroulé et ${nProps} proposition${nProps > 1 ? 's' : ''} garderont leur contenu mais perdront le lien artiste.`
          : 'Cet artiste ne porte aucun lien — suppression sans impact.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    await handleMutation(() => deleteArtiste(artiste.id), 'Artiste supprimé')
  }

  // ─── Sélection multiple / suppression en masse (reset d'import) ──────────
  function toggleSelect(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allFilteredSelected =
    filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id))
  function toggleSelectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) filtered.forEach((a) => next.delete(a.id))
      else filtered.forEach((a) => next.add(a.id))
      return next
    })
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds)
    if (!ids.length) return
    let nCren = 0
    let nProps = 0
    for (const id of ids) {
      nCren += counts.creneaux.get(id) || 0
      nProps += counts.propositions.get(id) || 0
    }
    const ok = await confirm({
      title: `Supprimer ${ids.length} artiste${ids.length > 1 ? 's' : ''} de l'annuaire ?`,
      message:
        nCren || nProps
          ? `${nCren} créneau${nCren > 1 ? 'x' : ''} déroulé et ${nProps} proposition${nProps > 1 ? 's' : ''} garderont leur contenu mais perdront le lien artiste. Action irréversible.`
          : 'Ces artistes ne portent aucun lien — suppression sans impact. Action irréversible.',
      confirmLabel: `Supprimer (${ids.length})`,
      danger: true,
    })
    if (!ok) return
    const done = await handleMutation(
      () => deleteArtistes(ids),
      `${ids.length} artiste${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}`,
    )
    if (done) setSelectedIds(new Set())
  }

  // ─── « Ce n'est pas un doublon » — désamorce le badge (persistant) ───────
  async function handleDupOk(artiste) {
    await handleMutation(
      () => setArtisteDupOk(artiste.id, true),
      `« ${artiste.nom} » ne sera plus signalé comme doublon`,
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--blue)' }} />
      </div>
    )
  }

  return (
    <div className="px-5 py-4">
      {/* Barre outils : recherche + filtres */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <div
          className="flex items-center gap-1.5 px-2 rounded-md flex-1 min-w-[180px] max-w-sm"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un artiste…"
            className="w-full min-w-0 text-xs py-1.5 outline-none bg-transparent"
            style={{ color: 'var(--txt)' }}
          />
        </div>
        <FilterChip
          active={filter === 'all'}
          label={`Tous (${artistes.length})`}
          onClick={() => setFilter('all')}
        />
        <FilterChip
          active={filter === 'sans-creneau'}
          label={`Sans créneau (${sansCreneauCount})`}
          warn={sansCreneauCount > 0}
          onClick={() => setFilter('sans-creneau')}
          title="Vus sur l'affiche ou saisis, mais jamais retrouvés dans la grille horaire"
        />
        <FilterChip
          active={filter === 'doublons'}
          label={`Doublons ? (${duplicateIds.size})`}
          warn={duplicateIds.size > 0}
          onClick={() => setFilter('doublons')}
          title="Noms très proches — probablement le même artiste mal orthographié"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="text-[11px] font-semibold px-2 py-1.5 rounded-md outline-none"
          style={{
            background: sourceFilter ? 'var(--blue-bg)' : 'var(--bg-elev)',
            color: sourceFilter ? 'var(--blue)' : 'var(--txt-2)',
            border: `1px solid ${sourceFilter ? 'var(--blue)' : 'var(--brd)'}`,
          }}
          title="Filtrer par source d'import — pratique pour vider un import raté"
        >
          <option value="">Toutes sources</option>
          <option value="affiche">Affiche</option>
          <option value="grille">Timetable</option>
          <option value="manuel">Manuel</option>
        </select>

        {canEdit && selectedIds.size > 0 && (
          <span className="flex items-center gap-2 ml-auto">
            <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              {selectedIds.size} sélectionné{selectedIds.size > 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={handleBulkDelete}
              className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-md"
              style={{
                background: 'rgba(239,68,68,0.12)',
                color: 'var(--red, #ef4444)',
                border: '1px solid rgba(239,68,68,0.4)',
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="text-[11px] font-semibold px-2 py-1.5 rounded-md"
              style={{ color: 'var(--txt-3)' }}
            >
              Annuler
            </button>
          </span>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className="rounded-xl p-8 text-center"
          style={{ background: 'var(--bg-surf)', border: '1px dashed var(--brd)' }}
        >
          <Users className="w-8 h-8 mx-auto mb-3 opacity-40" style={{ color: 'var(--txt-3)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {artistes.length === 0
              ? "Annuaire vide — importe une affiche ou une timetable pour l'alimenter."
              : 'Aucun artiste ne correspond aux filtres.'}
          </p>
        </div>
      ) : (
        <div
          className="rounded-xl overflow-hidden"
          style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        >
          <table className="w-full text-xs">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--brd)', color: 'var(--txt-3)' }}>
                {canEdit && (
                  <Th style={{ width: '30px' }}>
                    <SelectCheckbox
                      checked={allFilteredSelected}
                      indeterminate={selectedIds.size > 0 && !allFilteredSelected}
                      onToggle={toggleSelectAllFiltered}
                      title="Tout sélectionner (résultats filtrés)"
                      size={14}
                    />
                  </Th>
                )}
                <Th style={{ width: '28px' }} />
                <Th>Artiste</Th>
                <Th style={{ width: '120px' }}>Jour</Th>
                <Th style={{ width: '140px' }}>Scène</Th>
                <Th style={{ width: '70px' }}>Source</Th>
                <Th style={{ width: '90px' }} title="Créneaux dans le déroulé">
                  Créneaux
                </Th>
                <Th style={{ width: '70px' }} title="Propositions musiques rattachées">
                  Props
                </Th>
                {canEdit && <Th style={{ width: '76px' }} />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <ArtisteRow
                  key={a.id}
                  artiste={a}
                  nCreneaux={counts.creneaux.get(a.id) || 0}
                  nProps={counts.propositions.get(a.id) || 0}
                  isDuplicate={duplicateIds.has(a.id)}
                  canEdit={canEdit}
                  options={options}
                  derivedJour={(counts.jours.get(a.id) || []).join(' · ')}
                  derivedScene={(counts.scenes.get(a.id) || []).join(' · ')}
                  selected={selectedIds.has(a.id)}
                  onToggleSelect={() => toggleSelect(a.id)}
                  onRename={(nom) => handleRename(a, nom)}
                  onPatch={(patch) =>
                    handleMutation(() => updateArtiste(a.id, patch), 'Artiste mis à jour')
                  }
                  onDupOk={() => handleDupOk(a)}
                  onMerge={() => {
                    setMergeSource(a)
                    setMergeTargetId(null)
                  }}
                  onDelete={() => handleDelete(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mergeSource && (
        <MergeModal
          source={mergeSource}
          artistes={artistes}
          counts={counts}
          initialTargetId={mergeTargetId}
          onClose={() => {
            setMergeSource(null)
            setMergeTargetId(null)
          }}
          onConfirm={async (targetId) => {
            const ok = await handleMutation(
              () => mergeArtistes(mergeSource.id, targetId),
              'Fiches fusionnées',
            )
            if (ok) {
              setMergeSource(null)
              setMergeTargetId(null)
            }
          }}
        />
      )}
    </div>
  )
}

// ─── Sous-composants ───────────────────────────────────────────────────────

function Th({ children, style, title }) {
  return (
    <th
      className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-left"
      style={{ letterSpacing: '0.08em', ...style }}
      title={title}
    >
      {children}
    </th>
  )
}

function ArtisteRow({
  artiste,
  nCreneaux,
  nProps,
  isDuplicate,
  canEdit,
  options,
  derivedJour = '',
  derivedScene = '',
  selected,
  onToggleSelect,
  onRename,
  onPatch,
  onDupOk,
  onMerge,
  onDelete,
}) {
  const src = SOURCE_LABELS[artiste.source] || SOURCE_LABELS.manuel
  return (
    <tr
      style={{
        borderBottom: '1px solid var(--brd-sub)',
        background: selected ? 'rgba(59,130,246,0.05)' : undefined,
      }}
    >
      {/* Sélection multiple */}
      {canEdit && (
        <td className="px-2 py-1.5 text-center">
          <SelectCheckbox checked={selected} onToggle={onToggleSelect} size={14} />
        </td>
      )}
      {/* Headliner star */}
      <td className="px-2 py-1.5 text-center">
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => onPatch({ headliner: !artiste.headliner })}
          title={artiste.headliner ? 'Headliner (cliquer pour retirer)' : 'Marquer headliner'}
          style={{ cursor: canEdit ? 'pointer' : 'default', opacity: artiste.headliner ? 1 : 0.3 }}
        >
          <Star
            className="w-3.5 h-3.5"
            style={{
              color: artiste.headliner ? 'var(--amber, #f59e0b)' : 'var(--txt-3)',
              fill: artiste.headliner ? 'var(--amber, #f59e0b)' : 'none',
            }}
          />
        </button>
      </td>
      {/* Nom */}
      <td className="px-3 py-1.5" style={{ color: 'var(--txt)' }}>
        <span className="flex items-center gap-1.5">
          <EditableText
            value={artiste.nom}
            canEdit={canEdit}
            onSave={onRename}
            className="font-semibold"
          />
          {isDuplicate && (
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0"
              style={{ background: 'var(--amber-bg, #78350f33)', color: 'var(--amber, #f59e0b)' }}
              title="Un autre artiste porte un nom très proche — probable doublon à fusionner"
            >
              <AlertTriangle className="w-3 h-3" />
              doublon ?
              {canEdit && (
                <button
                  type="button"
                  onClick={onDupOk}
                  title="Ce n'est PAS un doublon — ne plus signaler cet artiste"
                  className="inline-flex items-center rounded-full transition-opacity opacity-60 hover:opacity-100"
                  style={{ color: 'inherit' }}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </span>
          )}
        </span>
      </td>
      {/* Jour — paramètre défini (jours du déroulé + valeurs existantes),
          pas de texte libre (retour Hugo). */}
      <td className="px-3 py-1.5" style={{ color: 'var(--txt-2)' }}>
        <EditableSelect
          value={artiste.jour || ''}
          options={options.jours}
          derived={derivedJour}
          canEdit={canEdit}
          onSave={(v) => onPatch({ jour: v })}
        />
      </td>
      {/* Scène — idem : scènes du déroulé + valeurs existantes. */}
      <td className="px-3 py-1.5" style={{ color: 'var(--txt-2)' }}>
        <EditableSelect
          value={artiste.scene || ''}
          options={options.scenes}
          derived={derivedScene}
          canEdit={canEdit}
          onSave={(v) => onPatch({ scene: v })}
        />
      </td>
      {/* Source */}
      <td className="px-3 py-1.5">
        <span
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: src.color, letterSpacing: '0.06em' }}
        >
          {src.label}
        </span>
      </td>
      {/* Créneaux (recoupement grille) */}
      <td className="px-3 py-1.5">
        {nCreneaux > 0 ? (
          <span className="tabular-nums" style={{ color: 'var(--txt-2)' }}>
            {nCreneaux}
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
            style={{ background: 'var(--amber-bg, #78350f33)', color: 'var(--amber, #f59e0b)' }}
            title="Aucun créneau déroulé — artiste vu sur l'affiche mais absent de la grille (ou nom mal lu)"
          >
            0
          </span>
        )}
      </td>
      {/* Propositions */}
      <td className="px-3 py-1.5 tabular-nums" style={{ color: 'var(--txt-2)' }}>
        {nProps || '—'}
      </td>
      {/* Actions */}
      {canEdit && (
        <td className="px-2 py-1.5">
          <span className="flex items-center gap-1 justify-end">
            <IconBtn title="Fusionner avec un autre artiste…" onClick={onMerge}>
              <GitMerge className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Supprimer de l'annuaire" onClick={onDelete} danger>
              <Trash2 className="w-3.5 h-3.5" />
            </IconBtn>
          </span>
        </td>
      )}
    </tr>
  )
}

function IconBtn({ children, title, onClick, danger = false }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="p-1 rounded-md transition-all"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = danger ? 'var(--red, #ef4444)' : 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-3)'
      }}
    >
      {children}
    </button>
  )
}

/**
 * Texte cliquable → input inline. `onSave` async : renvoie false pour
 * garder l'input ouvert (ex. rename en conflit → fusion proposée).
 */
function EditableText({ value, placeholder = '', canEdit, onSave, className = '' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])
  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  async function commit() {
    if (saving) return
    const next = draft.trim()
    if (next === (value || '')) {
      setEditing(false)
      return
    }
    setSaving(true)
    const ok = await onSave(next)
    setSaving(false)
    if (ok !== false) setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => canEdit && setEditing(true)}
        className={`group inline-flex items-center gap-1 text-left ${className}`}
        style={{ cursor: canEdit ? 'text' : 'default', color: 'inherit' }}
        title={canEdit ? 'Cliquer pour modifier' : undefined}
      >
        <span className={value ? '' : 'opacity-40'}>{value || placeholder}</span>
        {canEdit && (
          <Pencil
            className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity shrink-0"
            style={{ color: 'var(--txt-3)' }}
          />
        )}
      </button>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        onBlur={commit}
        className="text-xs px-1.5 py-0.5 rounded outline-none min-w-0"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--blue)',
          color: 'var(--txt)',
          width: `${Math.max(8, draft.length + 2)}ch`,
          maxWidth: '240px',
        }}
      />
      {saving && <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--txt-3)' }} />}
    </span>
  )
}

/**
 * Select discret pour jour / scène : valeurs définies uniquement (jours et
 * scènes du déroulé + valeurs déjà en base), pas de texte libre — retour
 * Hugo : « ce sont censés être des paramètres définis ».
 *
 * `derived` : valeur issue des CRÉNEAUX du déroulé (vérité terrain de la
 * timetable). Quand la fiche n'a pas de valeur propre, on l'affiche comme
 * libellé de l'option vide (italique, gris) — informatif sans rien écrire
 * en base ; choisir une option la fige sur la fiche.
 */
function EditableSelect({ value, options = [], derived = '', canEdit, onSave }) {
  const [saving, setSaving] = useState(false)
  // La valeur courante reste sélectionnable même si elle a disparu des
  // options (ancienne saisie libre) — sinon le select l'afficherait vide.
  const opts = options.some((o) => o.toLowerCase() === (value || '').toLowerCase())
    ? options
    : value
      ? [value, ...options]
      : options
  const showDerived = !value && derived

  if (!canEdit) {
    return (
      <span
        className={value || derived ? '' : 'opacity-40'}
        style={showDerived ? { fontStyle: 'italic', color: 'var(--txt-3)' } : undefined}
        title={showDerived ? 'Valeur issue des créneaux du déroulé (timetable)' : undefined}
      >
        {value || derived || '—'}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={value || ''}
        disabled={saving}
        onChange={async (e) => {
          setSaving(true)
          await onSave(e.target.value)
          setSaving(false)
        }}
        className="text-xs py-0.5 pl-1 pr-5 rounded outline-none cursor-pointer max-w-[150px] truncate"
        style={{
          background: 'transparent',
          border: '1px solid transparent',
          color: value ? 'var(--txt-2)' : 'var(--txt-3)',
          fontStyle: showDerived ? 'italic' : 'normal',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--brd)'
          e.currentTarget.style.background = 'var(--bg-elev)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'transparent'
          e.currentTarget.style.background = 'transparent'
        }}
        title={
          showDerived
            ? `Issue des créneaux du déroulé : ${derived} — choisir une valeur pour la figer sur la fiche`
            : 'Choisir parmi les jours/scènes du projet'
        }
      >
        <option value="">{showDerived ? derived : '—'}</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {saving && <Loader2 className="w-3 h-3 animate-spin" style={{ color: 'var(--txt-3)' }} />}
    </span>
  )
}

// ─── Modale de fusion ──────────────────────────────────────────────────────

function MergeModal({ source, artistes, counts, initialTargetId, onClose, onConfirm }) {
  const [query, setQuery] = useState('')
  const [targetId, setTargetId] = useState(initialTargetId || null)
  const [merging, setMerging] = useState(false)

  const candidates = useMemo(() => {
    const q = normalizeNom(query)
    return artistes
      .filter((a) => a.id !== source.id)
      .filter((a) => !q || (a.nom_normalise || '').includes(q))
      .slice(0, 30)
  }, [artistes, source.id, query])

  const target = artistes.find((a) => a.id === targetId) || null
  const nCren = counts.creneaux.get(source.id) || 0
  const nProps = counts.propositions.get(source.id) || 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.55)' }} onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-xl p-5 flex flex-col"
        style={{
          background: 'var(--bg-elev)',
          border: '1px solid var(--brd)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
          maxHeight: '80vh',
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <GitMerge className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Fusionner « {source.nom} »
          </h2>
          <button type="button" onClick={onClose} className="ml-auto p-1" style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[11px] mb-3" style={{ color: 'var(--txt-3)' }}>
          Ses {nCren} créneau{nCren > 1 ? 'x' : ''} et {nProps} proposition{nProps > 1 ? 's' : ''} seront
          rattachés à la fiche conservée, puis « {source.nom} » sera supprimé.
        </p>

        <div
          className="flex items-center gap-1.5 px-2 rounded-md mb-2"
          style={{ background: 'var(--bg)', border: '1px solid var(--brd)' }}
        >
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher la fiche à conserver…"
            className="w-full min-w-0 text-xs py-1.5 outline-none bg-transparent"
            style={{ color: 'var(--txt)' }}
            autoFocus
          />
        </div>

        <div className="flex-1 overflow-y-auto rounded-md" style={{ border: '1px solid var(--brd-sub)' }}>
          {candidates.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setTargetId(a.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-all"
              style={{
                background: targetId === a.id ? 'var(--blue-bg)' : 'transparent',
                color: 'var(--txt)',
                borderBottom: '1px solid var(--brd-sub)',
              }}
            >
              <span
                className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center shrink-0"
                style={{
                  border: `1.5px solid ${targetId === a.id ? 'var(--blue)' : 'var(--brd)'}`,
                  background: targetId === a.id ? 'var(--blue)' : 'transparent',
                }}
              >
                {targetId === a.id && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </span>
              <span className="font-semibold truncate">{a.nom}</span>
              {a.headliner && (
                <Star className="w-3 h-3 shrink-0" style={{ color: 'var(--amber, #f59e0b)', fill: 'var(--amber, #f59e0b)' }} />
              )}
              <span className="ml-auto text-[10px] shrink-0" style={{ color: 'var(--txt-3)' }}>
                {counts.creneaux.get(a.id) || 0} crén. · {counts.propositions.get(a.id) || 0} props
              </span>
            </button>
          ))}
          {candidates.length === 0 && (
            <p className="text-xs p-3" style={{ color: 'var(--txt-3)' }}>
              Aucun artiste ne matche.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold px-3 py-2 rounded-lg"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!target || merging}
            onClick={async () => {
              setMerging(true)
              await onConfirm(targetId)
              setMerging(false)
            }}
            className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-40"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {merging && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {target ? `Fusionner dans « ${target.nom} »` : 'Fusionner'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── FilterChip ────────────────────────────────────────────────────────────

function FilterChip({ active, label, onClick, warn = false, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md transition-all"
      style={{
        background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
        color: active ? 'var(--blue)' : warn ? 'var(--amber, #f59e0b)' : 'var(--txt-2)',
        border: `1px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
      }}
    >
      {label}
    </button>
  )
}

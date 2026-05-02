// ════════════════════════════════════════════════════════════════════════════
// TechListView — Vue principale de la tech list d'un projet (P1.5)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche les attributions du projet (1 ligne = 1 row projet_membres
// principale, parent_membre_id IS NULL). Les rows rattachées sont masquées
// ici (visibles dans Attribution + dans le détail d'une persona).
//
// Structure :
//   1. Boîte "📥 À trier" (toujours en haut, stylée distinctement) qui
//      contient les rows avec category IS NULL.
//   2. Sections par catégorie (PRODUCTION, EQUIPE TECHNIQUE, POST PRODUCTION
//      + custom utilisées). Une section vide affiche un message "Glisser une
//      ligne ici".
//
// Drag & drop : HTML5 native. On drag d'une ligne, on lâche dans une
// catégorie → met à jour la row.category (per-row, choix Y validé). Une
// ligne peut aussi être lâchée dans la boîte "À trier" pour la décatégoriser.
//
// Toggle coordonnées sensibles : neutre par défaut (off), bleu quand actif.
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Users, Plus, Eye, EyeOff, Loader2, Inbox } from 'lucide-react'
import { useCrew } from '../../hooks/useCrew'
import { extractPeriodes, expandDays, hasAnyRange } from '../../lib/projectPeriodes'
import { fullNameFromPersona } from '../../lib/crew'
import AttributionRow from './components/AttributionRow'
import AddMemberModal from './components/AddMemberModal'
import PresenceCalendarModal from './components/PresenceCalendarModal'
import AttachModal from './components/AttachModal'

const SENTINEL_UNCATEGORIZED = '__uncategorized__'

export default function TechListView({ project, projectId, canEdit = true }) {
  const {
    members,
    contacts,
    techlistRows,
    uncategorized,
    byCategory,
    categories,
    loading,
    error,
    reload,
    addMember,
    addContact,
    updateMember,
    updatePersona,
    removeMember,
    attachMember,
    detachMember,
  } = useCrew(projectId)

  const [showSensitive, setShowSensitive] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [presenceFor, setPresenceFor] = useState(null)
  const [attachFor, setAttachFor] = useState(null)
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverCat, setDragOverCat] = useState(null)

  // Périodes du projet pour borner le calendrier de présence
  const periodes = extractPeriodes(project?.metadata)
  const tournageDays = hasAnyRange(periodes.tournage)
    ? expandDays(periodes.tournage)
    : []
  const tournageAnchor =
    tournageDays.length > 0
      ? (() => {
          const [y, m, d] = tournageDays[0].split('-').map(Number)
          return new Date(y, m - 1, d)
        })()
      : null

  // ─── Handlers drag & drop ──────────────────────────────────────────────
  // On drag d'une row, on lâche sur une catégorie → on update sa `category`.
  // category null/SENTINEL_UNCATEGORIZED = drop dans "À trier".

  const handleDropOnCategory = async (categoryName) => {
    setDragOverCat(null)
    const id = draggingId
    setDraggingId(null)
    if (!id) return
    const row = members.find((m) => m.id === id)
    if (!row) return
    const targetCat = categoryName === SENTINEL_UNCATEGORIZED ? null : categoryName
    if ((row.category || null) === targetCat) return // pas de changement
    try {
      await updateMember(id, { category: targetCat })
    } catch (err) {
      console.error('[TechListView] drop error:', err)
    }
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm"
        style={{ color: 'var(--txt-3)' }}
      >
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        Chargement de l&rsquo;équipe…
      </div>
    )
  }

  if (error) {
    return (
      <div
        className="rounded-md p-4 text-sm"
        style={{
          background: 'var(--red-bg)',
          color: 'var(--red)',
          border: '1px solid var(--red-brd)',
        }}
      >
        Erreur de chargement : {error.message || String(error)}
        <button type="button" onClick={reload} className="ml-3 underline">
          Réessayer
        </button>
      </div>
    )
  }

  // ─── Stats compactes (remplacent les KPI cards en mode techlist) ───────
  // Compte de personnes uniques, validés, en recherche.
  const personaSet = new Set(techlistRows.map((r) => r.persona_key))
  const totalPersonae = personaSet.size
  const totalRows = techlistRows.length
  const validatedRows = techlistRows.filter((r) =>
    ['contrat_signe', 'paie_en_cours', 'paie_terminee'].includes(r.movinmotion_statut),
  ).length
  const aTrierCount = uncategorized.length

  return (
    <div className="flex flex-col gap-3">
      {/* Header compact + actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: 'var(--txt-2)' }} />
          <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
            Tech list
          </h2>
          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--txt-3)' }}>
            <span>·</span>
            <span><strong style={{ color: 'var(--txt-2)' }}>{totalPersonae}</strong> personne{totalPersonae > 1 ? 's' : ''}</span>
            <span>·</span>
            <span><strong style={{ color: 'var(--txt-2)' }}>{totalRows}</strong> attribution{totalRows > 1 ? 's' : ''}</span>
            <span>·</span>
            <span style={{ color: 'var(--green)' }}>{validatedRows} validée{validatedRows > 1 ? 's' : ''}</span>
            {aTrierCount > 0 && (
              <>
                <span>·</span>
                <span style={{ color: 'var(--amber)' }}>{aTrierCount} à trier</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle infos sensibles — neutre quand off, bleu quand on */}
          <button
            type="button"
            onClick={() => setShowSensitive((v) => !v)}
            className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
            style={{
              background: showSensitive ? 'var(--blue-bg)' : 'transparent',
              color: showSensitive ? 'var(--blue)' : 'var(--txt-2)',
              border: `1px solid ${showSensitive ? 'var(--blue-brd)' : 'var(--brd)'}`,
            }}
            title={
              showSensitive
                ? 'Masquer téléphones et emails'
                : 'Afficher téléphones et emails'
            }
          >
            {showSensitive ? (
              <>
                <Eye className="w-3.5 h-3.5" />
                Coordonnées visibles
              </>
            ) : (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Coordonnées masquées
              </>
            )}
          </button>

          {/* Ajouter */}
          {canEdit && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-opacity"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                border: '1px solid var(--blue)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter à l&rsquo;équipe
            </button>
          )}
        </div>
      </div>

      {/* Boîte "À trier" — toujours en haut, stylée distinctement */}
      <UncategorizedBox
        rows={uncategorized}
        canEdit={canEdit}
        showSensitive={showSensitive}
        isDragOver={dragOverCat === SENTINEL_UNCATEGORIZED}
        draggingId={draggingId}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOverCat(SENTINEL_UNCATEGORIZED)
        }}
        onDragLeave={() => setDragOverCat(null)}
        onDrop={() => handleDropOnCategory(SENTINEL_UNCATEGORIZED)}
        onDragStartRow={(row) => setDraggingId(row.id)}
        onDragEndRow={() => {
          setDraggingId(null)
          setDragOverCat(null)
        }}
        onUpdateRow={updateMember}
        onUpdatePersona={updatePersona}
        onRemoveRow={(rowId) => removeMember(rowId)}
        onOpenPresence={setPresenceFor}
        onOpenAttach={setAttachFor}
        onDetach={(rowId) => detachMember(rowId)}
      />

      {/* Sections par catégorie */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {categories.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            rows={byCategory[cat] || []}
            canEdit={canEdit}
            showSensitive={showSensitive}
            isDragOver={dragOverCat === cat}
            draggingId={draggingId}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverCat(cat)
            }}
            onDragLeave={() => setDragOverCat(null)}
            onDrop={() => handleDropOnCategory(cat)}
            onDragStartRow={(row) => setDraggingId(row.id)}
            onDragEndRow={() => {
              setDraggingId(null)
              setDragOverCat(null)
            }}
            onUpdateRow={updateMember}
            onUpdatePersona={updatePersona}
            onRemoveRow={(rowId) => removeMember(rowId)}
            onOpenPresence={setPresenceFor}
            onOpenAttach={setAttachFor}
            onDetach={(rowId) => detachMember(rowId)}
          />
        ))}

        {totalRows === 0 && uncategorized.length === 0 && (
          <div
            className="px-4 py-8 text-center text-sm"
            style={{ color: 'var(--txt-3)' }}
          >
            <Users
              className="w-8 h-8 mx-auto mb-2 opacity-50"
              style={{ color: 'var(--txt-3)' }}
            />
            Aucune personne dans l&rsquo;équipe pour l&rsquo;instant.
            {canEdit && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="text-xs px-3 py-1.5 rounded-md inline-flex items-center gap-1.5"
                  style={{ background: 'var(--blue)', color: '#fff' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Ajouter le premier membre
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modales */}
      <AddMemberModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        contacts={contacts}
        categories={categories}
        defaultCategory={null}
        onCreateContact={addContact}
        onAddMember={addMember}
      />

      <PresenceCalendarModal
        open={Boolean(presenceFor)}
        onClose={() => setPresenceFor(null)}
        personaName={presenceFor?.persona ? fullNameFromPersona(presenceFor.persona) : ''}
        persona={presenceFor?.persona || null}
        onSave={(fields) =>
          presenceFor && updatePersona(presenceFor.persona_key, fields)
        }
        periodes={periodes}
        anchorDate={tournageAnchor}
      />

      <AttachModal
        open={Boolean(attachFor)}
        onClose={() => setAttachFor(null)}
        childRow={attachFor}
        allMembers={members}
        onAttach={attachMember}
      />
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function UncategorizedBox({
  rows,
  canEdit,
  showSensitive,
  isDragOver,
  draggingId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStartRow,
  onDragEndRow,
  onUpdateRow,
  onUpdatePersona,
  onRemoveRow,
  onOpenPresence,
  onOpenAttach,
  onDetach,
}) {
  const count = rows.length
  // On affiche TOUJOURS la boîte (même vide) pour servir de cible de drop.
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="rounded-lg overflow-hidden transition-colors"
      style={{
        background: isDragOver ? 'var(--amber-bg)' : 'var(--bg-surf)',
        border: `2px dashed ${isDragOver ? 'var(--amber)' : 'var(--amber-brd)'}`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{
          background: 'var(--amber-bg)',
          borderBottom: count > 0 ? '1px solid var(--amber-brd)' : 'none',
        }}
      >
        <Inbox className="w-3.5 h-3.5" style={{ color: 'var(--amber)' }} />
        <span
          className="text-xs font-bold uppercase tracking-wide"
          style={{ color: 'var(--amber)' }}
        >
          À trier
        </span>
        <span className="text-xs" style={{ color: 'var(--amber)', opacity: 0.7 }}>
          · {count}
        </span>
        <span
          className="ml-auto text-[10px] italic"
          style={{ color: 'var(--amber)', opacity: 0.7 }}
        >
          Glissez les lignes vers une catégorie pour les classer
        </span>
      </div>

      {/* Rows ou empty state */}
      {count === 0 ? (
        <div
          className="px-4 py-4 text-center text-[11px]"
          style={{ color: 'var(--txt-3)', background: 'var(--bg-row)' }}
        >
          {isDragOver
            ? 'Lâcher ici pour décatégoriser'
            : 'Aucune attribution à trier.'}
        </div>
      ) : (
        rows.map((row) => (
          <AttributionRow
            key={row.id}
            row={row}
            canEdit={canEdit}
            showSensitive={showSensitive}
            isDragging={draggingId === row.id}
            onDragStart={onDragStartRow}
            onDragEnd={onDragEndRow}
            onUpdateRow={onUpdateRow}
            onUpdatePersona={onUpdatePersona}
            onRemoveRow={() => onRemoveRow(row.id)}
            onOpenPresence={() => onOpenPresence(row)}
            onAttach={() => onOpenAttach(row)}
            onDetach={row.parent_membre_id ? () => onDetach(row.id) : null}
          />
        ))
      )}
    </div>
  )
}

function CategorySection({
  category,
  rows,
  canEdit,
  showSensitive,
  isDragOver,
  draggingId,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStartRow,
  onDragEndRow,
  onUpdateRow,
  onUpdatePersona,
  onRemoveRow,
  onOpenPresence,
  onOpenAttach,
  onDetach,
}) {
  const [expanded, setExpanded] = useState(true)
  const count = rows.length

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        background: isDragOver ? 'var(--blue-bg)' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Header section */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 transition-colors"
        style={{
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--brd-sub)',
          borderTop: '1px solid var(--brd-sub)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      >
        <span
          className="text-[10px] transition-transform"
          style={{
            color: 'var(--txt-3)',
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}
        >
          ▶
        </span>
        <span
          className="text-xs font-bold uppercase tracking-wide"
          style={{ color: 'var(--txt-2)' }}
        >
          {category}
        </span>
        <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
          · {count}
        </span>
      </button>

      {/* Rows */}
      {expanded && (
        <div>
          {count === 0 ? (
            <div
              className="px-4 py-3 text-center text-[11px] italic"
              style={{ color: 'var(--txt-3)', background: 'var(--bg-row)', opacity: 0.6 }}
            >
              {isDragOver ? 'Lâcher ici' : 'Glisser une ligne ici pour la classer dans cette catégorie.'}
            </div>
          ) : (
            rows.map((row) => (
              <AttributionRow
                key={row.id}
                row={row}
                canEdit={canEdit}
                showSensitive={showSensitive}
                isDragging={draggingId === row.id}
                onDragStart={onDragStartRow}
                onDragEnd={onDragEndRow}
                onUpdateRow={onUpdateRow}
                onUpdatePersona={onUpdatePersona}
                onRemoveRow={() => onRemoveRow(row.id)}
                onOpenPresence={() => onOpenPresence(row)}
                onAttach={() => onOpenAttach(row)}
                onDetach={row.parent_membre_id ? () => onDetach(row.id) : null}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

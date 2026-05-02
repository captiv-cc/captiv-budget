// ════════════════════════════════════════════════════════════════════════════
// TechListView — Vue principale de la tech list d'un projet
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche les personnes attribuées au projet, regroupées par catégorie
// (PRODUCTION / EQUIPE TECHNIQUE / POST PRODUCTION + custom). Permet
// l'ajout d'un membre sans ligne de devis (pour les profils non budgétés).
//
// Fonctionnalités MVP Phase 1 :
//   - Affichage par catégorie (sections)
//   - Inline edit (secteur, hébergement, chauffeur, statut)
//   - Modale calendrier pour les jours de présence
//   - Modale d'ajout d'un membre
//   - Toggle "infos sensibles" (téléphone / email)
//
// Pas dans cette V1 :
//   - Drag & drop entre catégories / réordonnancement
//   - Drawer "Vue par membre" (récap budgets convenu)
//   - Forfait global UI
//   - Export PDF / partage public (Phase 2)
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { Users, Plus, Eye, EyeOff, Loader2 } from 'lucide-react'
import { useCrew } from '../../hooks/useCrew'
import { extractPeriodes, expandDays, hasAnyRange } from '../../lib/projectPeriodes'
import PersonaRow from './components/PersonaRow'
import AddMemberModal from './components/AddMemberModal'
import PresenceCalendarModal from './components/PresenceCalendarModal'

export default function TechListView({ project, projectId, canEdit = true }) {
  const {
    personae,
    personaeByCategory,
    categories,
    contacts,
    loading,
    error,
    reload,
    addMember,
    addContact,
    updatePersona,
    removeMember,
  } = useCrew(projectId)

  const [showSensitive, setShowSensitive] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [addCategory, setAddCategory] = useState('PRODUCTION')
  const [presenceFor, setPresenceFor] = useState(null) // persona ou null

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

  // Suppression d'une persona = suppression de toutes ses rows.
  // Parallel : Promise.all évite une attente en série pour N attributions.
  const handleRemovePersona = async (persona) => {
    await Promise.all((persona.members || []).map((m) => removeMember(m.id)))
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
        <button
          type="button"
          onClick={reload}
          className="ml-3 underline"
        >
          Réessayer
        </button>
      </div>
    )
  }

  const totalPersonae = personae.length

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2
            className="text-base font-bold flex items-center gap-2"
            style={{ color: 'var(--txt)' }}
          >
            <Users className="w-4 h-4" />
            Tech list
            <span
              className="text-xs font-normal"
              style={{ color: 'var(--txt-3)' }}
            >
              · {totalPersonae} personne{totalPersonae > 1 ? 's' : ''}
            </span>
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle infos sensibles */}
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
              onClick={() => {
                setAddCategory('PRODUCTION')
                setAddOpen(true)
              }}
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

      {/* Sections par catégorie */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {categories.map((cat) => {
          const items = personaeByCategory[cat] || []
          return (
            <CategorySection
              key={cat}
              category={cat}
              personae={items}
              canEdit={canEdit}
              showSensitive={showSensitive}
              onUpdatePersona={updatePersona}
              onRemovePersona={handleRemovePersona}
              onOpenPresence={(p) => setPresenceFor(p)}
              onAddInCategory={() => {
                setAddCategory(cat)
                setAddOpen(true)
              }}
            />
          )
        })}

        {totalPersonae === 0 && (
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
                  style={{
                    background: 'var(--blue)',
                    color: '#fff',
                  }}
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
        defaultCategory={addCategory}
        onCreateContact={addContact}
        onAddMember={addMember}
      />

      <PresenceCalendarModal
        open={Boolean(presenceFor)}
        onClose={() => setPresenceFor(null)}
        personaName={
          presenceFor
            ? `${presenceFor.contact?.prenom || ''} ${presenceFor.contact?.nom || ''}`.trim() || '—'
            : ''
        }
        value={presenceFor?.presence_days || []}
        onSave={(days) =>
          presenceFor && updatePersona(presenceFor.key, { presence_days: days })
        }
        periodes={periodes}
        anchorDate={tournageAnchor}
      />
    </div>
  )
}

// ─── Sous-composant : Section catégorie ─────────────────────────────────────

function CategorySection({
  category,
  personae,
  canEdit,
  showSensitive,
  onUpdatePersona,
  onRemovePersona,
  onOpenPresence,
  onAddInCategory,
}) {
  const [expanded, setExpanded] = useState(true)
  const count = personae.length

  return (
    <div>
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
        <span
          className="text-xs"
          style={{ color: 'var(--txt-3)' }}
        >
          · {count}
        </span>
        {canEdit && (
          <span
            className="ml-auto text-[11px] flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onClick={(e) => {
              e.stopPropagation()
              onAddInCategory?.()
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--blue)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
          >
            <Plus className="w-3 h-3" />
            Ajouter
          </span>
        )}
      </button>

      {/* Lignes */}
      {expanded && (
        <div>
          {personae.length === 0 ? (
            <div
              className="px-4 py-3 text-[11px]"
              style={{ color: 'var(--txt-3)', background: 'var(--bg-row)' }}
            >
              Aucune personne dans cette catégorie.
            </div>
          ) : (
            personae.map((p) => (
              <PersonaRow
                key={p.key}
                persona={p}
                canEdit={canEdit}
                showSensitive={showSensitive}
                onUpdatePersona={onUpdatePersona}
                onRemovePersona={() => onRemovePersona(p)}
                onOpenPresence={() => onOpenPresence(p)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

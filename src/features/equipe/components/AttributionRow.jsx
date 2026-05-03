// ════════════════════════════════════════════════════════════════════════════
// AttributionRow — Une ligne de la techlist (= 1 attribution principale)
// ════════════════════════════════════════════════════════════════════════════
//
// Depuis EQUIPE-P1.5 : 1 ligne = 1 row projet_membres principale (parent_membre_id
// IS NULL). Les rows rattachées sont représentées par un badge "+ N rôle".
//
// Mise en avant :
//   - Le POSTE (devis_line.produit ou specialite) en gros, blanc, gras
//   - Le NOM de la personne en sous-titre
//   - Avatar + initiales à gauche
//
// Inline edits :
//   - secteur, hebergement, chauffeur, presence_days : PERSONA-LEVEL
//     → propagent à toutes les rows de la même persona via onUpdatePersona
//   - movinmotion_statut : PER-ROW → onUpdateRow
//
// Actions :
//   - Drag (HTML5 native) : déplace la ligne entre catégories (change la
//     `category` de cette row uniquement, choix Y validé)
//   - Bouton engrenage : ouvre le MembreDrawer (Vue par membre) qui regroupe
//     toutes les actions : Rattacher / Détacher / Retirer / édition contact
//     annuaire / présence / catégorie. Cohérent avec le clic sur le nom.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Phone,
  Mail,
  MapPin,
  Calendar,
  PlaneLanding,
  PlaneTakeoff,
  ChevronDown,
  Link2,
  Settings,
  GitMerge,
  GripVertical,
  Shirt,
  Utensils,
} from 'lucide-react'
import {
  fullNameFromPersona,
  initialsFromPersona,
  effectiveSecteur,
  condensePresenceDays,
  CREW_STATUTS,
} from '../../../lib/crew'
import useBreakpoint from '../../../hooks/useBreakpoint'

// Couleurs de statut alignées sur EquipeTab.jsx (STEPS)
const STATUT_STYLES = {
  non_applicable: { color: 'var(--txt-3)', bg: 'var(--bg-elev)' },
  a_integrer:     { color: 'var(--blue)', bg: 'var(--blue-bg)' },
  integre:        { color: 'var(--purple)', bg: 'var(--purple-bg)' },
  contrat_signe:  { color: 'var(--green)', bg: 'var(--green-bg)' },
  paie_en_cours:  { color: 'var(--green)', bg: 'var(--green-bg)' },
  paie_terminee:  { color: 'var(--amber)', bg: 'var(--amber-bg)' },
}

// Calcule "J-N" / "J0" / "J+N" entre une date ISO et une date de référence ISO.
// → null si l'une des deux dates est absente.
function dayDelta(isoDate, refIsoDate) {
  if (!isoDate || !refIsoDate) return null
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(refIsoDate)
  if (!m1 || !m2) return null
  const d1 = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]))
  const d2 = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]))
  const delta = Math.round((d1 - d2) / 86400000)
  if (delta === 0) return 'J0'
  if (delta < 0) return `J${delta}`
  return `J+${delta}`
}

export default function AttributionRow({
  row,                    // techlist row enrichie (cf. listTechlistRows)
  showSensitive = false,
  canEdit = true,
  onUpdateRow,            // (rowId, fields) => Promise — per-row update
  onUpdatePersona,        // (personaKey, fields) => Promise — persona-level
  onOpenPresence,         // () => void — ouvre la modale calendrier
  // EQUIPE-P4 : onAttach / onDetach / onRemoveRow ne sont plus utilisés
  // ici — toutes ces actions sont déléguées au MembreDrawer (ouvert via le
  // bouton engrenage). Les props restent acceptées par TechListView pour
  // compat mais ne sont plus consommées par cette row.
  onDragStart,            // HTML5 drag start
  onDragEnd,              // HTML5 drag end
  // Pour le réordonnancement intra-catégorie (P1.10) : indique si on est
  // la cible d'un drop, et avec quelle position relative ('before'|'after').
  // Le parent (TechListView) calcule ça d'après la souris vs centre de la row.
  onDragOverRow,          // (rowId, position) => void
  onDragLeaveRow,         // () => void
  onDropOnRow,            // (rowId, position) => void
  dropIndicator = null,   // 'before' | 'after' | null
  isDragging = false,
  // P3 — Pastille de lot affichée à côté du nom (multi-lot uniquement).
  // Format `· LotA` avec une petite pastille colorée. Passé par le parent
  // (TechListView) qui résout lineLotMap[row.devis_line_id] → lotInfoMap[lotId].
  lotInfo = null,         // { title: string, color: string } | null
  // EQUIPE-RT-PRESENCE — soft lock collaboratif :
  // editingByOther : { user_id, full_name } | null — un autre admin édite
  //   actuellement cette row. Si non null → ring coloré + tooltip warning.
  // onEditingChange : (rowId | null) => void — broadcaste mon état d'édition
  //   (focus dans la row → rowId / focus quitte la row → null).
  editingByOther = null,
  onEditingChange = null,
  // EQUIPE-P4.3 — Drawer "Vue par membre" : (row) => void appelé au clic
  // sur le nom de la personne. Ouvre la vue consolidée.
  onOpenMembre = null,
}) {
  const persona = row.persona || {}
  const fullName = fullNameFromPersona(persona)
  const initials = initialsFromPersona(persona)
  const secteur = effectiveSecteur(persona)
  const presenceLabel = condensePresenceDays(persona.presence_days)

  // Layout responsive : sur mobile, on bascule la grille en 3 rangées
  // (main + statut/menu / logistique / secteur+devis) et on masque le
  // drag handle (D&D désactivé sur tactile, irrécupérable).
  const bp = useBreakpoint()
  const isCompact = bp.isMobile

  // Résolution du poste affiché. Priorité :
  //   1. row.specialite — override local sur cette attribution. Permet
  //      de renommer un poste sans toucher au devis (ex: 2 rows liées à
  //      la même ligne "Cadreur" qu'on veut différencier en "Cadreur Plan
  //      Serré" / "Cadreur Plan Large"). Le devis reste intact.
  //   2. devis_line.produit — nom vendu sur le devis (fallback).
  //   3. contact.specialite — spécialité de la fiche annuaire (fallback).
  //   4. '—' — placeholder.
  // L'édition est toujours autorisée : sauver une nouvelle valeur écrit
  // dans projet_membres.specialite, ce qui n'impacte ni le devis ni la
  // facturation. Si l'override diffère du nom devis, on affiche un petit
  // tag "(devis: …)" pour le rappel.
  const posteFromDevis = row.devis_line?.produit || null
  const poste =
    row.specialite ||
    posteFromDevis ||
    persona.contact?.specialite ||
    '—'
  const canEditPoste = canEdit
  const showDevisOriginalTag =
    Boolean(posteFromDevis) &&
    Boolean(row.specialite) &&
    row.specialite.trim() !== posteFromDevis.trim()

  const nbAttached = row.attached?.length || 0

  // Logistique condensée
  const firstPresenceDay = persona.presence_days?.length
    ? [...persona.presence_days].sort()[0]
    : null
  const lastPresenceDay = persona.presence_days?.length
    ? [...persona.presence_days].sort()[persona.presence_days.length - 1]
    : null
  const arrivalDelta = dayDelta(persona.arrival_date, firstPresenceDay)
  const departureDelta = dayDelta(persona.departure_date, lastPresenceDay)
  // P4-LOGISTIQUE-CLEANUP : on n'inclut plus hébergement/chauffeur/notes
  // dans la condition "présence renseignée" — ces champs partent dans la
  // tab Logistique. Seuls les jours de présence + arrivée + retour
  // comptent pour décider si la cellule "Présence" est remplie ou vide.
  const hasPresenceInfo =
    Boolean(presenceLabel) ||
    Boolean(persona.arrival_date) ||
    Boolean(persona.departure_date)

  // Régime alimentaire / taille T-shirt (depuis l'annuaire)
  const regimeAlim = persona.contact?.regime_alimentaire || null
  const tailleTshirt = persona.contact?.taille_tshirt || null

  // EQUIPE-RT-PRESENCE — handlers focus pour broadcast l'état d'édition.
  // onFocusCapture : focus entre dans la row (ou un de ses descendants).
  // onBlurCapture : focus sort. On vérifie e.relatedTarget pour ne pas
  //   reset si le focus passe d'un input à un autre DANS la même row
  //   (ex : tab vers le statut dropdown). Si relatedTarget est null OU
  //   hors de currentTarget → focus a quitté la row → setEditing(null).
  // Si le row n'est pas éditable (canEdit=false) ou pas de callback
  // (onEditingChange null) → no-op.
  const handleFocusEnter = () => {
    if (!canEdit || !onEditingChange) return
    onEditingChange(row.id)
  }
  const handleFocusLeave = (e) => {
    if (!canEdit || !onEditingChange) return
    const next = e.relatedTarget
    if (next && e.currentTarget.contains(next)) return // focus reste dans la row
    onEditingChange(null)
  }

  return (
    <div
      draggable={canEdit}
      onDragStart={(e) => {
        if (!canEdit) return
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', row.id)
        onDragStart?.(row)
      }}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={(e) => {
        if (!onDragOverRow) return
        e.preventDefault()
        e.stopPropagation()
        // Calcule la position relative dans la row (au-dessus / en-dessous
        // du milieu) pour décider si on insère avant ou après.
        const rect = e.currentTarget.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        const position = e.clientY < mid ? 'before' : 'after'
        onDragOverRow(row.id, position)
      }}
      onDragLeave={() => onDragLeaveRow?.()}
      onDrop={(e) => {
        if (!onDropOnRow) return
        e.preventDefault()
        e.stopPropagation()
        const rect = e.currentTarget.getBoundingClientRect()
        const mid = rect.top + rect.height / 2
        const position = e.clientY < mid ? 'before' : 'after'
        onDropOnRow(row.id, position)
      }}
      onFocusCapture={handleFocusEnter}
      onBlurCapture={handleFocusLeave}
      title={
        editingByOther
          ? `${editingByOther.full_name} édite cette ligne`
          : undefined
      }
      className="group grid gap-2 px-3 py-2.5 transition-all relative"
      style={{
        // Desktop (1 ligne, 7 cols) :
        //   Drag | Avatar+poste | Secteur | Logistique | Devis | Statut | Menu
        // Mobile (3 lignes via gridTemplateAreas) :
        //   ┌──────────────────────┬───────┬──────┐
        //   │       main           │statut │ menu │
        //   ├──────────────────────┴───────┴──────┤
        //   │           logistique                │
        //   ├─────────────────────────────┬───────┤
        //   │           secteur           │ devis │
        //   └─────────────────────────────┴───────┘
        // Le drag handle est masqué sur mobile (D&D tactile non supporté).
        gridTemplateColumns: isCompact
          ? 'minmax(0, 1fr) auto auto'
          : 'auto minmax(0, 2.5fr) 1fr minmax(140px, 1.7fr) auto auto auto',
        // Mobile : 3 rangées. Le Devis link est INLINE dans la cellule
        // "main" (badge à côté du nom) → on libère la 3ème row pour qu'il
        // n'y ait que le secteur. Rangées 2 et 3 restent visibles même
        // vides (placeholder cliquable, demande Hugo P4-RESP-1).
        gridTemplateAreas: isCompact
          ? `"main statut menu"
             "logistique logistique logistique"
             "secteur secteur secteur"`
          : undefined,
        alignItems: isCompact ? 'start' : 'center',
        background: editingByOther
          ? 'var(--amber-bg)'
          : 'var(--bg-row)',
        borderBottom: '1px solid var(--brd-sub)',
        // Indicateur de drop : barre bleue au-dessus ou en-dessous.
        // Soft lock collab : si editingByOther → ring amber 2px à gauche
        // pour signaler "quelqu'un édite" sans bloquer l'interaction.
        boxShadow: editingByOther
          ? 'inset 3px 0 0 0 var(--amber)'
          : dropIndicator === 'before'
            ? 'inset 0 3px 0 0 var(--blue)'
            : dropIndicator === 'after'
            ? 'inset 0 -3px 0 0 var(--blue)'
            : 'none',
        opacity: isDragging ? 0.4 : 1,
        cursor: canEdit ? 'grab' : 'default',
      }}
    >
      {/* Drag handle visuel — visible UNIQUEMENT au hover de la row.
          Masqué sur mobile (pas de D&D tactile fiable). */}
      {!isCompact && (
        <div
          className="transition-opacity opacity-0 group-hover:opacity-50 self-center"
          style={{ color: 'var(--txt-3)', display: canEdit ? 'block' : 'none' }}
          title="Glisser pour reclasser"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      )}

      {/* Poste + nom (le poste est mis en avant).
          Mobile : avatar aligné en HAUT pour rester aligné avec le poste
          quand celui-ci wrap sur 2 lignes (ex : "Directeur de production"
          + badge +N). Desktop : centré (1 seule ligne).
          Avatar décalé d'1px avec mt-0.5 sur mobile pour compenser optique-
          ment la taille de l'avatar (32px) vs hauteur de la 1ère ligne. */}
      <div
        className="flex gap-2.5 min-w-0"
        style={{
          gridArea: isCompact ? 'main' : undefined,
          alignItems: isCompact ? 'flex-start' : 'center',
        }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{
            background: persona.couleur ? `#${persona.couleur}` : 'var(--blue-bg)',
            color: persona.couleur ? '#fff' : 'var(--blue)',
            marginTop: isCompact ? 1 : 0,
          }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          {/* Le POSTE en avant — éditable si pas issu d'une ligne de devis */}
          <div
            className="text-sm font-semibold truncate flex items-center gap-1.5 flex-wrap"
            style={{ color: 'var(--txt)' }}
          >
            <PosteInline
              value={poste}
              canEdit={canEditPoste}
              onSave={(v) =>
                onUpdateRow?.(row.id, { specialite: v.trim() || null })
              }
            />
            {/* Rappel du nom devis original quand l'override diffère.
                Hover : tooltip explicatif. Cliquable pour reset → vide
                la specialite et retombe sur le nom du devis. */}
            {showDevisOriginalTag && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onUpdateRow?.(row.id, { specialite: null })
                }}
                title={`Nom de la ligne de devis : « ${posteFromDevis} ». Cliquer pour retirer l'override.`}
                className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 inline-flex items-center gap-0.5 transition-colors"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  border: '1px dashed var(--brd-sub)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--txt-2)'
                  e.currentTarget.style.borderColor = 'var(--brd)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--txt-3)'
                  e.currentTarget.style.borderColor = 'var(--brd-sub)'
                }}
              >
                devis: {posteFromDevis}
              </button>
            )}
            {nbAttached > 0 && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                style={{
                  background: 'var(--purple-bg)',
                  color: 'var(--purple)',
                  border: '1px solid var(--purple-brd)',
                }}
                title={`${nbAttached} rôle(s) rattaché(s) à cette ligne`}
              >
                <GitMerge className="w-2.5 h-2.5 inline mr-0.5" />
                +{nbAttached}
              </span>
            )}
            {/* Mobile : Devis link inline avec le poste (au lieu de la
                row 3 séparée). Garde l'espace cohérent quand pas de devis
                (badge sans contenu de fond). */}
            {isCompact && row.devis_line_id && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 inline-flex items-center"
                style={{
                  background: 'var(--blue-bg)',
                  color: 'var(--blue)',
                  border: '1px solid var(--blue-brd)',
                }}
                title="Attribution liée à une ligne de devis"
              >
                <Link2 className="w-2.5 h-2.5" />
              </span>
            )}
          </div>
          {/* Le NOM en sous-titre. Cliquable → ouvre le drawer "Vue par
              membre" (P4.3) qui consolide toutes les attributions de la
              personne sur le projet + sa logistique persona-level.
              P3 : pastille de lot inline (multi-lot uniquement). */}
          <div
            className="text-[11px] truncate flex items-center gap-1.5"
            style={{ color: 'var(--txt-2)' }}
          >
            {onOpenMembre ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenMembre(row)
                }}
                title={
                  persona.contact_id
                    ? `${fullName} — voir tous ses postes`
                    : `${fullName} (hors annuaire) — voir tous ses postes`
                }
                className="truncate text-left transition-colors"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'inherit',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--blue)'
                  e.currentTarget.style.textDecoration = 'underline'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'inherit'
                  e.currentTarget.style.textDecoration = 'none'
                }}
              >
                {fullName}
              </button>
            ) : (
              <span title={persona.contact_id ? fullName : `${fullName} (hors annuaire)`}>
                {fullName}
              </span>
            )}
            {lotInfo && (
              <span
                className="inline-flex items-center gap-1 text-[10px] shrink-0"
                style={{ color: 'var(--txt-3)' }}
                title={`Lot : ${lotInfo.title}`}
              >
                <span aria-hidden="true">·</span>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: lotInfo.color }}
                />
                <span
                  className="truncate max-w-[100px]"
                  style={{ color: lotInfo.color, fontWeight: 600 }}
                >
                  {lotInfo.title}
                </span>
              </span>
            )}
          </div>
          {showSensitive && (persona.contact?.email || persona.contact?.telephone) && (
            <div
              className="flex items-center gap-2 mt-0.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              {persona.contact.telephone && (
                <a
                  href={`tel:${persona.contact.telephone}`}
                  className="flex items-center gap-0.5 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Phone className="w-2.5 h-2.5" />
                  {persona.contact.telephone}
                </a>
              )}
              {persona.contact.email && (
                <a
                  href={`mailto:${persona.contact.email}`}
                  className="flex items-center gap-0.5 hover:underline truncate"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Mail className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">{persona.contact.email}</span>
                </a>
              )}
            </div>
          )}
          {/* Régime alim / taille T-shirt — visibles seulement avec showSensitive */}
          {showSensitive && (regimeAlim || tailleTshirt) && (
            <div
              className="flex items-center gap-2 mt-0.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              {regimeAlim && (
                <span className="flex items-center gap-0.5" title="Régime alimentaire">
                  <Utensils className="w-2.5 h-2.5" />
                  {regimeAlim}
                </span>
              )}
              {tailleTshirt && (
                <span className="flex items-center gap-0.5" title="Taille T-shirt">
                  <Shirt className="w-2.5 h-2.5" />
                  {tailleTshirt}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Secteur (persona-level) */}
      <div style={{ gridArea: isCompact ? 'secteur' : undefined, minWidth: 0 }}>
        <InlineText
          value={secteur || ''}
          placeholder="Secteur"
          icon={<MapPin className="w-3 h-3" />}
          canEdit={canEdit}
          onSave={(v) => onUpdatePersona?.(row.persona_key, { secteur: v.trim() || null })}
        />
      </div>

      {/* Présence condensée — jours de présence + arrivée + retour.
          Click ouvre la modale Présence sur le projet. Hébergement,
          chauffeur, notes logistique partent dans la future tab Logistique
          et ne sont plus affichés ici (cleanup P4). */}
      <button
        type="button"
        onClick={onOpenPresence}
        disabled={!canEdit || !onOpenPresence}
        className="text-xs px-2 py-1 rounded-md flex items-center gap-1.5 transition-all w-full"
        style={{
          gridArea: isCompact ? 'logistique' : undefined,
          background: hasPresenceInfo ? 'var(--bg-elev)' : 'transparent',
          color: 'var(--txt-2)',
          border: hasPresenceInfo ? '1px solid var(--brd-sub)' : '1px dashed var(--brd)',
          cursor: canEdit && onOpenPresence ? 'pointer' : 'default',
          opacity: hasPresenceInfo ? 1 : 0.7,
        }}
        title={
          [
            presenceLabel ? `Présence : ${presenceLabel}` : null,
            persona.arrival_date ? `Arrivée : ${persona.arrival_date}` : null,
            persona.departure_date ? `Retour : ${persona.departure_date}` : null,
          ]
            .filter(Boolean)
            .join('\n') || 'Cliquer pour configurer la présence'
        }
        onMouseEnter={(e) => {
          if (canEdit && onOpenPresence) e.currentTarget.style.opacity = hasPresenceInfo ? '0.85' : '1'
        }}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = hasPresenceInfo ? '1' : '0.7')}
      >
        {!hasPresenceInfo ? (
          <span className="text-[11px] italic flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
            <Calendar className="w-3 h-3" />
            Présence
          </span>
        ) : (
          <>
            {/* Badge présence (texte principal) */}
            <span
              className="text-[11px] truncate flex items-center gap-1"
              style={{
                color: presenceLabel ? 'var(--green)' : 'var(--txt-3)',
              }}
            >
              {presenceLabel || '—'}
            </span>
            {/* Indicateurs : arrivée / retour. Le delta J-N/J+N n'est
                affiché QUE s'il y a un décalage (≠ J0) : arriver le 1er
                jour de présence ou repartir le dernier jour est le cas
                standard, donc pas d'info à montrer. */}
            <span className="flex items-center gap-1 ml-auto shrink-0">
              {persona.arrival_date && (
                <span
                  className="inline-flex items-center justify-center gap-0.5 px-1 rounded text-[9px] leading-none"
                  style={{
                    background: 'var(--purple-bg)',
                    color: 'var(--purple)',
                    minWidth: 36,
                    height: 18,
                  }}
                  title={`Arrivée ${persona.arrival_date}${arrivalDelta ? ' (' + arrivalDelta + ')' : ''}`}
                >
                  <PlaneLanding className="w-2.5 h-2.5" />
                  {arrivalDelta && arrivalDelta !== 'J0' ? arrivalDelta : ''}
                </span>
              )}
              {persona.departure_date && (
                <span
                  className="inline-flex items-center justify-center gap-0.5 px-1 rounded text-[9px] leading-none"
                  style={{
                    background: 'var(--purple-bg)',
                    color: 'var(--purple)',
                    minWidth: 36,
                    height: 18,
                  }}
                  title={`Retour ${persona.departure_date}${departureDelta ? ' (' + departureDelta + ')' : ''}`}
                >
                  <PlaneTakeoff className="w-2.5 h-2.5" />
                  {departureDelta && departureDelta !== 'J0' ? departureDelta : ''}
                </span>
              )}
            </span>
          </>
        )}
      </button>

      {/* Lien vers la ligne de devis (read-only) — DESKTOP UNIQUEMENT.
          Sur mobile, ce badge est rendu inline avec le poste/+N (cf. plus
          haut), donc on masque la cellule dédiée pour ne pas dupliquer.
          La grille mobile a remplacé la zone "devis" en row 3 par
          "secteur secteur secteur", donc cet élément n'a plus d'area. */}
      {!isCompact && (
        <div
          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: row.devis_line_id ? 'var(--blue-bg)' : 'transparent',
            color: row.devis_line_id ? 'var(--blue)' : 'var(--txt-3)',
            border: row.devis_line_id ? '1px solid var(--blue-brd)' : '1px solid var(--brd-sub)',
          }}
          title={
            row.devis_line_id
              ? 'Attribution liée à une ligne de devis'
              : 'Attribution libre (sans ligne de devis)'
          }
        >
          <Link2 className="w-2.5 h-2.5 inline" />
        </div>
      )}

      {/* Statut d'engagement (per-row) — affiché pour TOUTES les attributions,
          pas seulement les intermittents. Mêmes valeurs / mêmes couleurs que
          la vue Attribution (À attribuer / Recherche / Contacté / Validé /
          Réglé). Stocké dans la colonne `movinmotion_statut` (nom DB
          historique, le statut sert en réalité de tracker générique sur
          l'engagement, pas seulement sur le contrat MovinMotion). */}
      <div style={{ gridArea: isCompact ? 'statut' : undefined }}>
        <StatutDropdown
          statut={row.movinmotion_statut}
          canEdit={canEdit}
          onChange={(s) => onUpdateRow?.(row.id, { movinmotion_statut: s })}
        />
      </div>

      {/* Action unique : ouvre le MembreDrawer (qui regroupe Rattacher /
          Détacher / Retirer + édition contact annuaire + présence). On a
          remplacé l'ancien menu kebab "..." par un bouton engrenage pour
          centraliser toutes les actions au même endroit (cohérent avec
          le clic sur le nom qui ouvre déjà le drawer). */}
      <div style={{ gridArea: isCompact ? 'menu' : undefined }}>
        <RowSettingsButton
          canEdit={canEdit}
          onClick={() => onOpenMembre?.(row)}
        />
      </div>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

/**
 * PosteInline — Affichage / édition du poste (titre de la ligne).
 * Édition débloquée seulement si pas de devis_line (sinon le poste est
 * figé sur devis_line.produit, pour cohérence avec la facturation).
 */
function PosteInline({ value, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value === '—' ? '' : value)

  if (!editing && !editing && draft !== (value === '—' ? '' : value)) {
    setDraft(value === '—' ? '' : value)
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== (value === '—' ? '' : value)) onSave?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(value === '—' ? '' : value)
            setEditing(false)
          }
        }}
        placeholder="Poste / spécialité"
        className="text-sm font-semibold px-1.5 py-0.5 rounded outline-none flex-1 min-w-0"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--blue)',
        }}
      />
    )
  }

  if (!canEdit) {
    return <span className="truncate" title={value}>{value}</span>
  }

  // Cliquable pour éditer. Empty state = italique gris discret.
  const isEmpty = value === '—'
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="truncate text-left transition-colors hover:underline decoration-dotted"
      style={{
        color: isEmpty ? 'var(--txt-3)' : 'var(--txt)',
        background: 'transparent',
        fontWeight: isEmpty ? 400 : 600,
        fontStyle: isEmpty ? 'italic' : 'normal',
        opacity: isEmpty ? 0.7 : 1,
      }}
      title={isEmpty ? 'Cliquer pour saisir un poste' : `${value} (cliquer pour modifier)`}
    >
      {isEmpty ? 'Saisir un poste…' : value}
    </button>
  )
}

function InlineText({ value, placeholder, icon, canEdit, onSave }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  // Quand value change depuis le parent (optimistic update terminé), resync.
  if (!editing && draft !== value) {
    setDraft(value)
  }

  if (!canEdit) {
    return (
      <div className="flex items-center gap-1 text-[11px] truncate" style={{ color: 'var(--txt-2)' }}>
        {icon && <span style={{ color: 'var(--txt-3)' }}>{icon}</span>}
        <span className="truncate">{value || '—'}</span>
      </div>
    )
  }

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft !== value) onSave?.(draft)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            setDraft(value)
            setEditing(false)
          }
        }}
        placeholder={placeholder}
        className="text-xs px-1.5 py-1 rounded outline-none w-full"
        style={{
          background: 'var(--bg-elev)',
          color: 'var(--txt)',
          border: '1px solid var(--blue)',
        }}
      />
    )
  }

  // Vide → placeholder italique discret. Rempli → texte normal.
  const isEmpty = !value
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="flex items-center gap-1 text-[11px] truncate text-left px-1.5 py-1 rounded transition-colors w-full"
      style={{
        color: isEmpty ? 'var(--txt-3)' : 'var(--txt-2)',
        fontStyle: isEmpty ? 'italic' : 'normal',
        opacity: isEmpty ? 0.55 : 1,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon && <span style={{ color: 'var(--txt-3)', opacity: isEmpty ? 0.6 : 1 }}>{icon}</span>}
      <span className="truncate">{value || placeholder}</span>
    </button>
  )
}

function StatutDropdown({ statut, canEdit, onChange }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const cur = CREW_STATUTS.find((s) => s.key === statut) || CREW_STATUTS[0]
  const style = STATUT_STYLES[statut] || STATUT_STYLES.non_applicable

  function handleOpen() {
    if (!canEdit) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom
      const dropdownH = CREW_STATUTS.length * 32 + 8
      const top = spaceBelow < dropdownH ? rect.top - dropdownH - 4 : rect.bottom + 4
      setPos({ top, left: rect.left })
    }
    setOpen(true)
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={!canEdit}
        className="text-[11px] px-2 py-1 rounded-md flex items-center gap-1 transition-opacity"
        style={{
          background: style.bg,
          color: style.color,
          border: `1px solid ${style.color}`,
          cursor: canEdit ? 'pointer' : 'default',
          minWidth: '88px',
        }}
        title={cur.label}
      >
        <span className="truncate flex-1 text-left">{cur.label}</span>
        {canEdit && <ChevronDown className="w-3 h-3 shrink-0" />}
      </button>

      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div
              className="fixed z-50 rounded-md shadow-lg overflow-hidden"
              style={{
                top: pos.top,
                left: pos.left,
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd)',
                minWidth: 140,
              }}
            >
              {CREW_STATUTS.map((s) => {
                const sStyle = STATUT_STYLES[s.key]
                const isCurrent = s.key === statut
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => {
                      onChange?.(s.key)
                      setOpen(false)
                    }}
                    className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-1.5 transition-colors"
                    style={{
                      color: sStyle.color,
                      background: isCurrent ? 'var(--bg-hov)' : 'transparent',
                      fontWeight: isCurrent ? 600 : 400,
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isCurrent ? 'var(--bg-hov)' : 'transparent')
                    }
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: sStyle.color }}
                    />
                    {s.label}
                  </button>
                )
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  )
}

// EQUIPE-P4 : remplace l'ancien RowMenu kebab par un simple bouton
// engrenage qui ouvre le MembreDrawer. Le drawer regroupe maintenant
// toutes les actions (Rattacher / Détacher / Retirer / édition contact
// / présence / catégorie) — plus besoin de dropdown spécifique sur la
// row. UX cohérente avec le clic sur le nom (qui ouvre déjà le drawer).
function RowSettingsButton({ canEdit, onClick }) {
  if (!canEdit) return <div className="w-6" />
  return (
    <button
      type="button"
      onClick={onClick}
      className="p-1.5 rounded-md transition-colors"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = 'var(--blue)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-3)'
      }}
      title="Réglages du membre"
      aria-label="Ouvrir les réglages du membre"
    >
      <Settings className="w-3.5 h-3.5" />
    </button>
  )
}

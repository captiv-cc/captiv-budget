// ════════════════════════════════════════════════════════════════════════════
// DerouleCadreurView — Vue dédiée à un cadreur (festival, FEST-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche le planning d'UN cadreur spécifique, avec 2 layouts :
//
//   - Mobile (< 640px) : layout verticale unique. Toutes les missions du
//     cadreur empilées chronologiquement, avec des cards de contexte
//     estompées entre elles qui rappellent les autres événements festival
//     au même moment. Pas de scroll horizontal jamais.
//
//   - Desktop (≥ 640px) : split 60/40. Sa journée à gauche (timeline
//     verticale épurée), le rail global à droite (compact, scrollable
//     indépendamment) pour garder le contexte spatial.
//
// Le cadreur est identifié soit par une lane type='personne' lui étant
// dédiée (FEST-1), soit par sa présence dans member_ids d'un créneau
// d'une autre lane. On agrège les deux.
//
// Cf. CHANTIER_DEROULE_FESTIVAL.md pour les conventions visuelles.
// ════════════════════════════════════════════════════════════════════════════

import { useMemo, useState } from 'react'
import {
  MapPin,
  Camera,
  Clipboard,
  AlertTriangle,
  Inbox,
  ChevronDown,
  Users,
} from 'lucide-react'
import {
  effectiveCouleurCreneau,
  formatMinHHMM,
  creneauDureeMin,
  effectiveLaneColor,
  sortCreneauxByTime,
} from '../../lib/deroule'
import useBreakpoint from '../../hooks/useBreakpoint'
import { extractPlainText } from '../../components/rich-editor/utils'

export default function DerouleCadreurView({
  // deroule passé pour future intégration (régie live, méta jour : golden
  // hour / sunset) — pas utilisé en V1.
  // eslint-disable-next-line no-unused-vars
  deroule,
  lanes = [],
  creneaux = [],
  membres = [],
  conflictsByCreneau,
  selectedMembreId,
  setSelectedMembreId,
  onSelectCreneau,
}) {
  const breakpoint = useBreakpoint()
  const isMobile = breakpoint === 'sm' || breakpoint === 'md'

  // ─── Index membres + lanes ────────────────────────────────────────────────
  const membreById = useMemo(() => {
    const m = new Map()
    for (const x of membres || []) m.set(x.id, x)
    return m
  }, [membres])

  const laneById = useMemo(() => {
    const m = new Map()
    for (const l of lanes || []) m.set(l.id, l)
    return m
  }, [lanes])

  // Lanes de type 'personne' (= cadreurs déclarés). On les expose en premier
  // dans le sélecteur ; on permet aussi de sélectionner un membre qui n'a
  // pas sa lane mais qui apparaît dans member_ids des créneaux.
  const personLanes = useMemo(
    () => (lanes || []).filter((l) => l.type === 'personne' && l.membre_id),
    [lanes],
  )

  // Membres "candidats" pour la vue Cadreur : ceux qui ont une lane perso
  // OU ceux assignés à au moins un créneau via member_ids.
  const candidateMembres = useMemo(() => {
    const set = new Set()
    for (const l of personLanes) set.add(l.membre_id)
    for (const c of creneaux || []) {
      const ids = Array.isArray(c.member_ids) ? c.member_ids : []
      for (const id of ids) set.add(id)
    }
    return [...set]
      .map((id) => membreById.get(id))
      .filter(Boolean)
      .sort((a, b) => {
        const an = `${a.contact?.nom || a.nom || ''} ${a.contact?.prenom || a.prenom || ''}`.toLowerCase()
        const bn = `${b.contact?.nom || b.nom || ''} ${b.contact?.prenom || b.prenom || ''}`.toLowerCase()
        return an.localeCompare(bn, 'fr')
      })
  }, [personLanes, creneaux, membreById])

  // ─── Sélection courante ────────────────────────────────────────────────
  // Si rien sélectionné, prendre le premier candidat (s'il existe).
  const effectiveMembreId = selectedMembreId || candidateMembres[0]?.id || null
  const selectedMembre = effectiveMembreId
    ? membreById.get(effectiveMembreId)
    : null
  const selectedMembreLane = useMemo(
    () =>
      effectiveMembreId
        ? personLanes.find((l) => l.membre_id === effectiveMembreId)
        : null,
    [personLanes, effectiveMembreId],
  )

  // ─── Calcul des missions du cadreur ───────────────────────────────────
  // Une mission = créneau qui appartient à sa lane perso OU qui contient
  // son id dans member_ids.
  const cadreurMissions = useMemo(() => {
    if (!effectiveMembreId) return []
    return sortCreneauxByTime(
      (creneaux || []).filter((c) => {
        const isHisLane =
          selectedMembreLane && c.lane_id === selectedMembreLane.id
        const isAssigned =
          Array.isArray(c.member_ids) &&
          c.member_ids.includes(effectiveMembreId)
        return isHisLane || isAssigned
      }),
    )
  }, [creneaux, effectiveMembreId, selectedMembreLane])

  // Total minutes "actives" : somme des durées de missions
  const totalActiveMin = useMemo(
    () => cadreurMissions.reduce((acc, c) => acc + creneauDureeMin(c), 0),
    [cadreurMissions],
  )

  // FEST-4 : compteur de conflits sur les missions du cadreur. Une mission
  // est en conflit si une ou plusieurs missions du MÊME cadreur la chevauchent.
  const conflictCount = useMemo(() => {
    if (!conflictsByCreneau || !effectiveMembreId) return 0
    let count = 0
    for (const c of cadreurMissions) {
      const list = conflictsByCreneau.get?.(c.id) || []
      const hasSelfConflict = list.some(
        ({ membre }) => membre?.id === effectiveMembreId,
      )
      if (hasSelfConflict) count++
    }
    return count
  }, [cadreurMissions, conflictsByCreneau, effectiveMembreId])

  // ─── Empty states ─────────────────────────────────────────────────────
  if (candidateMembres.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aucun cadreur identifié"
        subtitle="Ajoute une lane type Cadreur (depuis le bouton + Lane) ou assigne des membres à des créneaux."
      />
    )
  }

  return (
    <div>
      {/* Header vue cadreur : sélecteur + compteurs */}
      <CadreurHeader
        candidateMembres={candidateMembres}
        selectedMembre={selectedMembre}
        onSelect={setSelectedMembreId}
        missionsCount={cadreurMissions.length}
        totalActiveMin={totalActiveMin}
        conflictCount={conflictCount}
        accentColor={
          selectedMembreLane
            ? `#${effectiveLaneColor(selectedMembreLane)}`
            : 'var(--blue)'
        }
      />

      {/* Body : layout mobile (single col) ou desktop (split 60/40) */}
      {cadreurMissions.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Aucune mission attribuée"
          subtitle="Ce cadreur n'a pas encore de créneau assigné sur cette journée."
        />
      ) : isMobile ? (
        <CadreurMobileLayout
          missions={cadreurMissions}
          allCreneaux={creneaux}
          focusMembreId={effectiveMembreId}
          laneById={laneById}
          membreById={membreById}
          conflictsByCreneau={conflictsByCreneau}
          onSelectCreneau={onSelectCreneau}
        />
      ) : (
        <CadreurDesktopLayout
          missions={cadreurMissions}
          allCreneaux={creneaux}
          allLanes={lanes}
          focusMembreId={effectiveMembreId}
          laneById={laneById}
          membreById={membreById}
          conflictsByCreneau={conflictsByCreneau}
          onSelectCreneau={onSelectCreneau}
          accentColor={
            selectedMembreLane
              ? `#${effectiveLaneColor(selectedMembreLane)}`
              : 'var(--blue)'
          }
        />
      )}
    </div>
  )
}

// ─── Header vue cadreur ────────────────────────────────────────────────────
//
// Sélecteur de membre (chevron dropdown) + compteur "X missions · Yh actives".
// Tap targets ≥ 44px sur mobile (conformité CHANTIER_MOBILE_PWA).

function CadreurHeader({
  candidateMembres,
  selectedMembre,
  onSelect,
  missionsCount,
  totalActiveMin,
  conflictCount = 0,
  accentColor,
}) {
  const [pickerOpen, setPickerOpen] = useState(false)

  const fullName = selectedMembre
    ? `${selectedMembre.contact?.prenom || selectedMembre.prenom || ''} ${selectedMembre.contact?.nom || selectedMembre.nom || ''}`.trim() ||
      'Cadreur'
    : 'Sélectionner un cadreur'
  const ini =
    selectedMembre &&
    `${(selectedMembre.contact?.prenom || selectedMembre.prenom || '')[0] || ''}${(selectedMembre.contact?.nom || selectedMembre.nom || '')[0] || ''}`.toUpperCase()
  const specialite =
    selectedMembre?.specialite ||
    selectedMembre?.contact?.specialite ||
    ''

  const hStr =
    totalActiveMin >= 60
      ? `${Math.floor(totalActiveMin / 60)}h${totalActiveMin % 60 ? String(totalActiveMin % 60).padStart(2, '0') : ''}`
      : `${totalActiveMin}min`

  return (
    <div
      className="rounded-md mb-3 relative"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        padding: '10px 12px',
      }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div
          className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: `${accentColor}1f`,
            color: accentColor,
            // Tap target ≥ 44px : padding sur le parent (le clic se fait
            // sur le picker button au-dessous)
          }}
        >
          {ini || '?'}
        </div>
        {/* Sélecteur (button complet, tap target large) */}
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="flex-1 text-left flex items-center gap-2"
          style={{
            background: 'transparent',
            minHeight: 44,
            color: 'var(--txt)',
          }}
        >
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold truncate flex items-center gap-1.5">
              <span className="truncate">{fullName}</span>
              {conflictCount > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{
                    background: 'var(--red-bg)',
                    color: 'var(--red)',
                  }}
                  title={`${conflictCount} mission${conflictCount > 1 ? 's' : ''} en conflit horaire`}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {conflictCount}
                </span>
              )}
            </div>
            <div
              className="text-[11px] truncate"
              style={{ color: 'var(--txt-3)' }}
            >
              {missionsCount} mission{missionsCount > 1 ? 's' : ''} ·{' '}
              {hStr} actives{specialite ? ` · ${specialite}` : ''}
            </div>
          </div>
          <ChevronDown
            className="w-4 h-4 shrink-0"
            style={{ color: 'var(--txt-3)' }}
          />
        </button>
      </div>
      {/* Dropdown des membres */}
      {pickerOpen && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-md shadow-2xl"
          style={{
            background: 'var(--bg-surf)',
            border: '1px solid var(--brd)',
            zIndex: 30,
            maxHeight: 320,
            overflowY: 'auto',
          }}
        >
          {candidateMembres.map((m) => {
            const fn =
              `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.trim() ||
              '—'
            const initials =
              `${(m.contact?.prenom || m.prenom || '')[0] || ''}${(m.contact?.nom || m.nom || '')[0] || ''}`.toUpperCase()
            const spec = m.specialite || m.contact?.specialite || ''
            const isActive = m.id === selectedMembre?.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect?.(m.id)
                  setPickerOpen(false)
                }}
                className="w-full flex items-center gap-3 text-left transition-colors"
                style={{
                  padding: '8px 12px',
                  minHeight: 44,
                  background: isActive ? 'var(--bg-hov)' : 'transparent',
                  color: 'var(--txt)',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'var(--bg-hov)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.background = 'transparent'
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{
                    background: 'var(--accent-bg)',
                    color: 'var(--accent)',
                  }}
                >
                  {initials || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{fn}</div>
                  {spec && (
                    <div
                      className="text-[10px] truncate"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      {spec}
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Mobile layout : verticale unique avec contexte intercalé ──────────────
//
// On rend la liste des créneaux du déroulé entiers, triés par heure.
// Pour ceux qui sont des missions du cadreur : card active.
// Pour les autres : card estompée (opacity 0.55, border dashed) qui rappelle
// le contexte sans interaction.

function CadreurMobileLayout({
  missions,
  allCreneaux,
  focusMembreId,
  laneById,
  membreById,
  conflictsByCreneau,
  onSelectCreneau,
}) {
  const sortedAll = useMemo(
    () => sortCreneauxByTime(allCreneaux || []),
    [allCreneaux],
  )
  const missionIds = new Set(missions.map((m) => m.id))

  return (
    <div className="flex flex-col gap-2">
      {sortedAll.map((c) => {
        if (missionIds.has(c.id)) {
          return (
            <MissionCard
              key={c.id}
              creneau={c}
              lane={laneById.get(c.lane_id)}
              conflicts={filterSelfConflicts(
                conflictsByCreneau?.get?.(c.id) || [],
                focusMembreId,
              )}
              membreById={membreById}
              onClick={(e) => onSelectCreneau?.(c, e)}
            />
          )
        }
        return (
          <ContextCard
            key={c.id}
            creneau={c}
            lane={laneById.get(c.lane_id)}
          />
        )
      })}
    </div>
  )
}

// Filtre les conflits pour ne garder que ceux qui concernent un membre
// spécifique (le cadreur dans la vue courante). Évite de griser un bloc à
// cause d'un overlap d'un AUTRE membre — la vue Cadreur ne montre que
// les conflits "self" du membre sélectionné.
function filterSelfConflicts(conflicts, focusMembreId) {
  if (!focusMembreId || !Array.isArray(conflicts)) return []
  return conflicts.filter(({ membre }) => membre?.id === focusMembreId)
}

// ─── Desktop layout : split sa journée + rail global ──────────────────────

function CadreurDesktopLayout({
  missions,
  allCreneaux,
  allLanes,
  focusMembreId,
  laneById,
  membreById,
  conflictsByCreneau,
  onSelectCreneau,
  accentColor,
}) {
  const sortedAll = useMemo(
    () => sortCreneauxByTime(allCreneaux || []),
    [allCreneaux],
  )

  return (
    <div
      className="grid gap-3"
      style={{
        // Sa journée 60% / Rail global 40%
        gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)',
      }}
    >
      {/* Colonne gauche : sa journée */}
      <div
        className="rounded-md"
        style={{
          background: 'var(--bg-surf)',
          border: `1px solid ${accentColor}33`,
        }}
      >
        <div
          className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold"
          style={{
            color: accentColor,
            borderBottom: '1px solid var(--brd-sub)',
          }}
        >
          Sa journée · {missions.length} mission{missions.length > 1 ? 's' : ''}
        </div>
        <div className="p-2 flex flex-col gap-2">
          {missions.map((c) => (
            <MissionCard
              key={c.id}
              creneau={c}
              lane={laneById.get(c.lane_id)}
              conflicts={filterSelfConflicts(
                conflictsByCreneau?.get?.(c.id) || [],
                focusMembreId,
              )}
              membreById={membreById}
              onClick={(e) => onSelectCreneau?.(c, e)}
            />
          ))}
        </div>
      </div>

      {/* Colonne droite : rail global compact (read-only context) */}
      <div
        className="rounded-md"
        style={{
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
        }}
      >
        <div
          className="px-3 py-2 text-[10px] uppercase tracking-widest font-bold"
          style={{
            color: 'var(--txt-3)',
            borderBottom: '1px solid var(--brd-sub)',
          }}
        >
          Programme festival · {allLanes.filter((l) => l.type === 'lieu').length} scène
          {allLanes.filter((l) => l.type === 'lieu').length > 1 ? 's' : ''}
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          {sortedAll.map((c) => (
            <ContextLine
              key={c.id}
              creneau={c}
              lane={laneById.get(c.lane_id)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── MissionCard — card active pour une mission du cadreur ─────────────────

function MissionCard({ creneau: c, lane, conflicts = [], membreById, onClick }) {
  const color = effectiveCouleurCreneau(c)
  const dureeMin = creneauDureeMin(c)
  const dureeStr =
    dureeMin >= 60
      ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
      : `${dureeMin}min`
  const memberIds = Array.isArray(c.member_ids) ? c.member_ids : []
  const otherMembers = memberIds
    .map((id) => membreById.get(id))
    .filter(Boolean)
  const isCancel = c.statut === 'annule'
  const hasConflict = conflicts.length > 0
  const Icon = lane?.type === 'lieu' ? MapPin : Clipboard
  const laneLabel = lane?.libelle || ''

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex gap-2.5 text-left rounded-md transition-all"
      style={{
        background: `${color}14`,
        border: `0.5px solid ${color}55`,
        borderLeft: `3px solid ${color}`,
        padding: '10px 12px',
        minHeight: 44,
        opacity: isCancel ? 0.5 : 1,
        textDecoration: isCancel ? 'line-through' : 'none',
      }}
    >
      {/* Heure */}
      <div className="shrink-0 flex flex-col" style={{ minWidth: 48 }}>
        <div className="text-[13px] font-semibold" style={{ color: 'var(--txt)' }}>
          {formatMinHHMM(c.heure_debut_min)}
        </div>
        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {dureeStr}
        </div>
      </div>
      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span
            className="text-[13px] font-semibold truncate"
            style={{ color: 'var(--txt)' }}
          >
            {c.titre || '(sans titre)'}
          </span>
          {hasConflict && (
            <span
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1 rounded shrink-0"
              style={{
                background: 'var(--red-bg)',
                color: 'var(--red)',
              }}
              title={
                'Conflit horaire avec :\n' +
                conflicts
                  .map(({ creneau: other }) => {
                    const t = other.titre || '(sans titre)'
                    return `• ${formatMinHHMM(other.heure_debut_min)}–${formatMinHHMM(other.heure_fin_min)} ${t}`
                  })
                  .join('\n')
              }
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              Conflit
            </span>
          )}
        </div>
        {(laneLabel || c.lieu_text) && (
          <div
            className="text-[11px] mt-0.5 flex items-center gap-1 flex-wrap"
            style={{ color: 'var(--txt-3)' }}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {laneLabel}
              {c.lieu_text && ` · ${c.lieu_text}`}
            </span>
          </div>
        )}
        {c.description && (
          <div
            className="text-[10px] mt-1 line-clamp-2"
            style={{ color: 'var(--txt-2)' }}
          >
            {c.description}
          </div>
        )}
        {c.notes && (() => {
          const notesText = extractPlainText(c.notes, { maxLen: 160 })
          if (!notesText) return null
          return (
            <div
              className="text-[10px] mt-1 line-clamp-2 italic"
              style={{ color: 'var(--txt-3)' }}
            >
              {notesText}
            </div>
          )
        })()}
        {otherMembers.length > 1 && (
          <div
            className="text-[10px] mt-1.5 flex items-center gap-1"
            style={{ color: 'var(--txt-3)' }}
          >
            <Camera className="w-2.5 h-2.5" />
            <span>
              Avec{' '}
              {otherMembers
                .map(
                  (m) =>
                    `${m.contact?.prenom || m.prenom || ''} ${m.contact?.nom || m.nom || ''}`.trim(),
                )
                .filter((s, _, arr) => arr.length === 1 || s)
                .slice(0, 3)
                .join(', ')}
            </span>
          </div>
        )}
      </div>
    </button>
  )
}

// ─── ContextCard — card estompée pour un événement non assigné au cadreur ─

function ContextCard({ creneau: c, lane }) {
  const color = effectiveCouleurCreneau(c)
  const Icon = lane?.type === 'lieu' ? MapPin : Clipboard
  const laneLabel = lane?.libelle || ''
  return (
    <div
      className="w-full flex items-center gap-2 rounded-md"
      style={{
        background: 'transparent',
        border: '0.5px dashed var(--brd-sub)',
        padding: '6px 10px',
        opacity: 0.55,
        minHeight: 32,
      }}
    >
      <div
        className="text-[11px] shrink-0"
        style={{ color: 'var(--txt-3)', minWidth: 44 }}
      >
        {formatMinHHMM(c.heure_debut_min)}
      </div>
      <div className="flex-1 min-w-0 flex items-center gap-1.5">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span
          className="text-[11px] truncate"
          style={{ color: 'var(--txt-2)' }}
        >
          {c.titre || '(sans titre)'}
        </span>
        {laneLabel && (
          <span
            className="text-[10px] truncate flex items-center gap-0.5 shrink-0"
            style={{ color: 'var(--txt-3)' }}
          >
            <Icon className="w-2.5 h-2.5" />
            {laneLabel}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── ContextLine — ligne compacte pour le rail global desktop ──────────────

function ContextLine({ creneau: c, lane }) {
  const color = effectiveCouleurCreneau(c)
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: '4px 8px',
        borderRadius: 4,
        background: 'transparent',
      }}
    >
      <div
        className="text-[10px] shrink-0"
        style={{ color: 'var(--txt-3)', minWidth: 38 }}
      >
        {formatMinHHMM(c.heure_debut_min)}
      </div>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span
        className="text-[11px] truncate flex-1"
        style={{ color: 'var(--txt-2)' }}
      >
        {c.titre || '(sans titre)'}
      </span>
      {lane?.libelle && (
        <span
          className="text-[10px] shrink-0 truncate"
          style={{ color: 'var(--txt-3)', maxWidth: 100 }}
        >
          {lane.libelle}
        </span>
      )}
    </div>
  )
}

// ─── EmptyState générique ─────────────────────────────────────────────────

function EmptyState({ icon: Icon, title, subtitle }) {
  return (
    <div
      className="rounded-md p-10 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Icon
        className="w-8 h-8 mx-auto mb-2"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        {title}
      </p>
      {subtitle && (
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapPin,
  Camera,
  Clipboard,
  AlertTriangle,
  Inbox,
  Info,
  ChevronDown,
  Users,
  Check,
} from 'lucide-react'
import {
  effectiveCouleurCreneau,
  formatMinHHMM,
  creneauDureeMin,
  effectiveLaneColor,
  sortCreneauxByTime,
  effectiveAlerte,
  ALERTE_COLORS,
} from '../../lib/deroule'
import useBreakpoint from '../../hooks/useBreakpoint'
import { extractPlainText } from '../../components/rich-editor/utils'

export default function DerouleCadreurView({
  // deroule : utilisé pour calculer isTodayDeroule (now indicator dans
  // la liste mobile). Sera aussi utile pour la régie live (Sprint A).
  deroule,
  lanes = [],
  creneaux = [],
  membres = [],
  conflictsByCreneau,
  selectedMembreId,
  setSelectedMembreId,
  onSelectCreneau,
  // Sprint B : si fourni, active le bouton coche "Marquer fait" sur chaque
  // mission. Signature: (creneauId, nextStatut) => Promise<void>.
  // Si null/undefined → mode read-only (pas de bouton coche).
  onToggleStatut = null,
  // Sprint mobile-cadreur : force l'usage du layout 1-colonne quel que soit
  // le breakpoint. Utilisé par la page share (le programme festival à
  // droite encombre + brouille la lecture mobile/tablet). L'admin (DerouleTab)
  // garde le split desktop par défaut quand cette prop n'est pas fournie.
  singleColumn = false,
}) {
  const breakpoint = useBreakpoint()
  const isMobile =
    singleColumn || breakpoint === 'sm' || breakpoint === 'md'

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
          onToggleStatut={onToggleStatut}
          isTodayDeroule={
            deroule?.date_jour === new Date().toISOString().slice(0, 10)
          }
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
          onToggleStatut={onToggleStatut}
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
  // Sprint mobile : on n'affiche plus la spécialité dans le header cadreur
  // pour gagner en densité — déjà visible dans le sélecteur (dropdown)
  // et peu utile sur le terrain.

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
              {missionsCount} mission{missionsCount > 1 ? 's' : ''} · {hStr} actives
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
  // allCreneaux : on ne rend plus les ContextCards (Hugo : "trop fouilli")
  // mais on s'en sert pour construire la Map creneauxById utilisée par
  // effectiveAlerte() pour l'héritage d'alertes via soft link (un créneau
  // cadreur sans alerte hérite de celle du parent sur la scène).
  allCreneaux,
  focusMembreId,
  laneById,
  membreById,
  conflictsByCreneau,
  onSelectCreneau,
  onToggleStatut,
  // Sprint mobile : si le déroulé courant est aujourd'hui, on insère un
  // séparateur visuel "Maintenant" entre les missions terminées (ou
  // passées) et celles à venir. Permet de scanner d'un coup d'œil
  // "où j'en suis dans la journée".
  isTodayDeroule = false,
}) {
  // Liste : uniquement les missions du cadreur, triées par heure de début.
  const sortedMissions = useMemo(
    () => sortCreneauxByTime([...missions]),
    [missions],
  )
  // Index par id pour le lookup des alertes héritées (effectiveAlerte).
  const creneauxById = useMemo(() => {
    const m = new Map()
    for (const c of allCreneaux || []) m.set(c.id, c)
    return m
  }, [allCreneaux])
  // Now indicator : on insère le séparateur AVANT la 1ère mission qui se
  // termine après l'heure courante (donc en cours ou à venir). Si toutes
  // les missions sont terminées ou aucune à venir, pas de séparateur.
  const nowMin = (() => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  })()
  const nowAnchorId = useMemo(() => {
    if (!isTodayDeroule || !sortedMissions.length) return null
    const next = sortedMissions.find((c) => (c.heure_fin_min ?? 0) > nowMin)
    return next ? next.id : null
  }, [sortedMissions, isTodayDeroule, nowMin])

  // Sprint B : auto-scroll vers la prochaine mission non-"fait" au mount.
  // - Si le déroulé est aujourd'hui : scroll vers la mission "en cours"
  //   ou la prochaine à venir.
  // - Si c'est un autre jour : scroll vers la première mission non-faite.
  // On utilise un anchor ref sur le 1er match et scrollIntoView block: center.
  // Note : on calcule l'anchor target via le sorted list, pas par re-render.
  const containerRef = useRef(null)
  const targetCreneauId = useMemo(() => {
    if (missions.length === 0) return null
    const nowMin = (() => {
      const d = new Date()
      return d.getHours() * 60 + d.getMinutes()
    })()
    // Sorted missions (croissant heure_debut)
    const sorted = sortCreneauxByTime([...missions])
    // 1. En cours (now ∈ [debut, fin])
    const enCours = sorted.find(
      (c) =>
        c.statut !== 'fait' &&
        c.statut !== 'annule' &&
        c.heure_debut_min <= nowMin &&
        c.heure_fin_min > nowMin,
    )
    if (enCours) return enCours.id
    // 2. Prochaine non-faite (heure_debut > now)
    const next = sorted.find(
      (c) => c.statut !== 'fait' && c.statut !== 'annule' && c.heure_debut_min > nowMin,
    )
    if (next) return next.id
    // 3. Fallback : 1ère mission non-faite (toutes faites ou autre jour)
    const firstActive = sorted.find((c) => c.statut !== 'fait' && c.statut !== 'annule')
    if (firstActive) return firstActive.id
    return sorted[0]?.id || null
  }, [missions])

  useEffect(() => {
    if (!targetCreneauId || !containerRef.current) return
    // Léger délai pour laisser le DOM peindre les cards avant scroll.
    const t = setTimeout(() => {
      const el = containerRef.current?.querySelector(
        `[data-creneau-id="${targetCreneauId}"]`,
      )
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }, 200)
    return () => clearTimeout(t)
    // Volontairement pas dépendant de targetCreneauId pour éviter de
    // scroller en boucle au cochage. On scroll seulement au mount (et au
    // changement de membre/jour via le mount du composant).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef} className="flex flex-col gap-2">
      {sortedMissions.map((c) => {
        const showNowMarker = c.id === nowAnchorId
        const card = (
          <div key={c.id} data-creneau-id={c.id}>
            <MissionCard
              creneau={c}
              lane={laneById.get(c.lane_id)}
              conflicts={filterSelfConflicts(
                conflictsByCreneau?.get?.(c.id) || [],
                focusMembreId,
              )}
              membreById={membreById}
              focusMembreId={focusMembreId}
              creneauxById={creneauxById}
              onClick={(e) => onSelectCreneau?.(c, e)}
              onToggleStatut={onToggleStatut}
            />
          </div>
        )
        if (showNowMarker) {
          return (
            <Fragment key={`${c.id}-with-now`}>
              <NowMarker nowMin={nowMin} />
              {card}
            </Fragment>
          )
        }
        return card
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
  onToggleStatut,
  accentColor,
}) {
  const sortedAll = useMemo(
    () => sortCreneauxByTime(allCreneaux || []),
    [allCreneaux],
  )
  // Index par id pour le lookup des alertes héritées (effectiveAlerte).
  const creneauxById = useMemo(() => {
    const m = new Map()
    for (const c of allCreneaux || []) m.set(c.id, c)
    return m
  }, [allCreneaux])

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
              focusMembreId={focusMembreId}
              creneauxById={creneauxById}
              onClick={(e) => onSelectCreneau?.(c, e)}
              onToggleStatut={onToggleStatut}
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

function MissionCard({
  creneau: c,
  lane,
  conflicts = [],
  membreById,
  focusMembreId = null,
  // creneauxById : Map des créneaux du jour, pour la lookup des alertes
  // héritées via source_creneau_id (soft link). Si absent, on tombe sur
  // l'alerte locale uniquement.
  creneauxById = null,
  onClick,
  onToggleStatut = null,
}) {
  const color = effectiveCouleurCreneau(c)
  const dureeMin = creneauDureeMin(c)
  const dureeStr =
    dureeMin >= 60
      ? `${Math.floor(dureeMin / 60)}h${dureeMin % 60 ? String(dureeMin % 60).padStart(2, '0') : ''}`
      : `${dureeMin}min`
  const memberIds = Array.isArray(c.member_ids) ? c.member_ids : []
  // Co-équipiers : on exclut le cadreur focus pour ne pas afficher son
  // propre nom dans "Avec ..." (redondant).
  const otherMembers = memberIds
    .map((id) => membreById.get(id))
    .filter(Boolean)
    .filter((m) => !focusMembreId || m.id !== focusMembreId)
  const isCancel = c.statut === 'annule'
  const isFait = c.statut === 'fait'
  const hasConflict = conflicts.length > 0
  const Icon = lane?.type === 'lieu' ? MapPin : Clipboard
  const laneLabel = lane?.libelle || ''
  // Sprint mobile : si la lane est la lane perso du cadreur focus (ex :
  // "Hugo Martin" quand on regarde la vue Hugo Martin), on cache la chip
  // — elle ne raconte rien et pollue. Quand la lane est ailleurs (un lieu,
  // un autre cadreur en mode co-équipier), on la garde.
  const isOwnPersonalLane =
    lane?.type === 'personne' &&
    focusMembreId &&
    lane.membre_id === focusMembreId
  const showLaneChip = !isOwnPersonalLane && (laneLabel || c.lieu_text)
  // Désactivation visuelle : annulé OU fait (opacity réduite + strikethrough)
  const isDimmed = isCancel || isFait

  // Sprint mobile : tap sur "Conflit" → expand inline le détail des conflits.
  // Mobile-friendly (title= ne marche pas en touch).
  const [conflictExpanded, setConflictExpanded] = useState(false)

  // Sprint B : handler local du toggle statut (planifie ↔ fait).
  // Le bouton coche est rendu seulement si onToggleStatut est fourni
  // (mode "interactif", typiquement la vue mobile cadreur ou la page share).
  const handleToggle = (e) => {
    e.stopPropagation()
    if (!onToggleStatut) return
    const next = isFait ? 'planifie' : 'fait'
    Promise.resolve(onToggleStatut(c.id, next)).catch((err) => {
      // Le wrapper parent affichera un toast si besoin ; on log juste.
      console.warn('[MissionCard] toggle statut failed', err)
    })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick?.(e)
        }
      }}
      className="w-full flex gap-2.5 text-left rounded-md transition-all cursor-pointer outline-none focus-visible:ring-2"
      style={{
        background: `${color}14`,
        border: `0.5px solid ${color}55`,
        borderLeft: `3px solid ${color}`,
        padding: '10px 12px',
        minHeight: 44,
        opacity: isDimmed ? 0.55 : 1,
        textDecoration: isCancel ? 'line-through' : 'none',
      }}
    >
      {/* Heure */}
      <div className="shrink-0 flex flex-col" style={{ minWidth: 48 }}>
        <div
          className="text-[13px] font-semibold"
          style={{
            color: 'var(--txt)',
            textDecoration: isFait ? 'line-through' : undefined,
          }}
        >
          {formatMinHHMM(c.heure_debut_min)}
        </div>
        <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {dureeStr}
        </div>
      </div>
      {/* Contenu */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5 flex-wrap">
          <span
            className="text-[13px] font-semibold"
            style={{
              color: 'var(--txt)',
              // Sprint mobile : pas de truncate, on autorise 2 lignes
              // (line-clamp-2) pour afficher le titre complet sur mobile.
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'normal',
              overflowWrap: 'break-word',
            }}
          >
            {c.titre || '(sans titre)'}
          </span>
          {hasConflict && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setConflictExpanded((v) => !v)
              }}
              aria-expanded={conflictExpanded}
              className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1 rounded shrink-0 cursor-pointer"
              style={{
                background: 'var(--red-bg)',
                color: 'var(--red)',
              }}
              title="Voir les conflits horaires"
            >
              <AlertTriangle className="w-2.5 h-2.5" />
              Conflit
            </button>
          )}
        </div>
        {/* Détail des conflits — visible au tap sur le badge */}
        {hasConflict && conflictExpanded && (
          <div
            className="mt-1 rounded px-2 py-1 text-[10px]"
            style={{
              background: 'var(--red-bg)',
              color: 'var(--red)',
              borderLeft: '2px solid var(--red)',
            }}
          >
            <div className="font-semibold mb-0.5">Conflits horaires :</div>
            {conflicts.map(({ creneau: other }) => (
              <div key={other.id} className="opacity-90">
                • {formatMinHHMM(other.heure_debut_min)}–
                {formatMinHHMM(other.heure_fin_min)}{' '}
                {other.titre || '(sans titre)'}
              </div>
            ))}
          </div>
        )}
        {/* Alerte (info / important) — bandeau coloré dédié, plus discret que
            les conflits mais toujours visible sans tap.
            Sprint mobile-2.2 : utilise effectiveAlerte(), qui hérite de
            l'alerte du parent soft-link si l'enfant n'en a pas. Cas typique :
            "Hamza @ scène" a "3P CRASHS" → "Hamza @ cadreur" l'hérite
            automatiquement sans propagation BDD. */}
        {(() => {
          const ea = effectiveAlerte(c, creneauxById)
          if (!ea) return null
          const alertColor = ALERTE_COLORS[ea.niveau] || ALERTE_COLORS.important
          const AlertIc = ea.niveau === 'info' ? Info : AlertTriangle
          return (
            <div
              className="mt-1 rounded flex items-center gap-1.5 px-2 py-1"
              style={{
                background: `${alertColor}1f`,
                borderLeft: `2px solid ${alertColor}`,
              }}
            >
              <AlertIc
                className="w-3 h-3 shrink-0"
                style={{ color: alertColor }}
              />
              <span
                className="text-[11px] truncate"
                style={{ color: alertColor, fontWeight: 600 }}
              >
                {ea.text}
              </span>
            </div>
          )
        })()}
        {showLaneChip && (
          <div
            className="text-[11px] mt-0.5 flex items-center gap-1 flex-wrap"
            style={{ color: 'var(--txt-3)' }}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {/* Si lane perso cachée, on affiche juste le lieu.
                  Sinon : lane + (· lieu) */}
              {isOwnPersonalLane ? (
                c.lieu_text
              ) : (
                <>
                  {laneLabel}
                  {c.lieu_text && ` · ${c.lieu_text}`}
                </>
              )}
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
      {/* Bouton "Marquer fait" — rendu seulement si onToggleStatut fourni.
          stopPropagation pour ne pas trigger le onClick de la card. */}
      {onToggleStatut && !isCancel && (
        <button
          type="button"
          onClick={handleToggle}
          aria-label={isFait ? 'Marquer comme non fait' : 'Marquer comme fait'}
          aria-pressed={isFait}
          className="shrink-0 self-center flex items-center justify-center rounded-full transition-all"
          style={{
            width: 36,
            height: 36,
            background: isFait ? 'var(--green)' : 'transparent',
            border: isFait
              ? '2px solid var(--green)'
              : '2px solid var(--brd)',
            color: isFait ? '#FFFFFF' : 'var(--txt-3)',
            opacity: 1, // override le dim parent pour rester visible
          }}
        >
          <Check className="w-4 h-4" strokeWidth={3} />
        </button>
      )}
    </div>
  )
}

// ─── NowMarker — séparateur visuel "Maintenant HH:MM" ─────────────────────
//
// Inséré dans la liste des missions du cadreur entre les missions terminées
// et celles à venir, uniquement si le déroulé courant est aujourd'hui.
// Visuellement : ligne rouge horizontale + chip "Maintenant 19:23".

function NowMarker({ nowMin }) {
  const hh = String(Math.floor(nowMin / 60)).padStart(2, '0')
  const mm = String(nowMin % 60).padStart(2, '0')
  return (
    <div
      className="flex items-center gap-2 my-1"
      role="separator"
      aria-label={`Maintenant ${hh}:${mm}`}
    >
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
        style={{
          background: '#E24B4A',
          color: '#fff',
          letterSpacing: '0.5px',
        }}
      >
        MAINTENANT · {hh}:{mm}
      </span>
      <div
        className="flex-1"
        style={{ height: 1.5, background: '#E24B4A' }}
      />
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

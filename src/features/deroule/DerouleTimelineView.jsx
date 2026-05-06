// ════════════════════════════════════════════════════════════════════════════
// DerouleTimelineView — Vue principale desktop (timeline verticale + lanes)
// ════════════════════════════════════════════════════════════════════════════
//
// Axe Y = heures (graduées par display_step_min, default 15min)
// Axe X = lanes (Global + 1..4 équipes parallèles)
//
// Les blocs sont positionnés en absolute selon leur heure_debut/heure_fin.
// Les blocs multi_lane sont rendus PAR-DESSUS toutes les lanes, sur toute
// la largeur de la zone créneaux (mais respectent l'espace réservé à
// l'axe heures à gauche).
//
// Now line : trait rouge horizontal qui marque l'heure courante, visible
// uniquement si la conduite affichée correspond à aujourd'hui.
//
// V1 : pas de drag/resize ici (Phase C). Click sur un bloc → onSelectCreneau.
// Click sur zone vide d'une lane → onCreateCreneauAt(lane, heure).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  timeToMinutes,
  minutesToTime,
  effectiveCouleurCreneau,
  defaultLaneLibelle,
  CRENEAU_TYPE_COLORS,
  MAX_LANES,
} from '../../lib/deroule'

const PX_PER_HOUR = 60 // 60px = 1h, donc 15px = 15min, 1px ≈ 1min
const LANE_HEADER_H = 36
const TIME_COL_W = 56

/**
 * @param {Object}  deroule
 * @param {Array}   lanes
 * @param {Map}     creneauxByLane
 * @param {Array}   creneauxMultiLane
 * @param {Array}   membres                   techlist du projet
 * @param {boolean} canEdit
 * @param {Function} onSelectCreneau          (creneau) => void — ouvre l'inspecteur
 * @param {Function} onCreateCreneauAt        ({ lane_id, multi_lane, heure_debut, heure_fin }) => void
 * @param {Function} onAddLane                (libelle?) => void
 * @param {Function} onUpdateLane             (laneId, fields) => void
 * @param {Function} onDeleteLane             (laneId) => void
 */
export default function DerouleTimelineView({
  deroule,
  lanes,
  creneauxByLane,
  creneauxMultiLane,
  membres,
  canEdit,
  onSelectCreneau,
  onCreateCreneauAt,
  onAddLane,
  onUpdateLane,
  onDeleteLane,
}) {
  const containerRef = useRef(null)

  // Mapping membre_id → initiales pour les avatars
  const membreInitiales = useMemo(() => {
    const map = new Map()
    for (const m of membres || []) {
      const prenom = m.prenom || m.contact?.prenom || ''
      const nom = m.nom || m.contact?.nom || ''
      const ini = `${prenom[0] || ''}${nom[0] || ''}`.toUpperCase() || '?'
      map.set(m.id, { initiales: ini, fullName: `${prenom} ${nom}`.trim() || '—' })
    }
    return map
  }, [membres])

  // Bornes timeline
  const heureDebutMin = timeToMinutes(deroule?.heure_debut || '06:00')
  const heureFinMin = timeToMinutes(deroule?.heure_fin || '23:00')
  const totalMin = Math.max(60, heureFinMin - heureDebutMin)
  const totalHeight = (totalMin / 60) * PX_PER_HOUR
  const stepMin = deroule?.display_step_min || 15

  // Génère les graduations heures (chaque heure pleine est labelée)
  const graduations = useMemo(() => {
    const out = []
    for (let m = heureDebutMin; m <= heureFinMin; m += stepMin) {
      out.push({
        minutes: m,
        label: m % 60 === 0 ? minutesToTime(m) : null,
        isHourMark: m % 60 === 0,
      })
    }
    return out
  }, [heureDebutMin, heureFinMin, stepMin])

  // Now line — visible uniquement si déroulé = aujourd'hui
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000) // refresh chaque minute
    return () => clearInterval(timer)
  }, [])

  const isToday = useMemo(() => {
    if (!deroule?.date_jour) return false
    // FIX V0 : comparer en local time (cohérent avec selectedDate côté
    // DerouleTab qui utilise isoDate(new Date()) local). Avant : toISOString()
    // était UTC → décalage potentiel en soirée tardive ou tôt le matin.
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}` === deroule.date_jour
  }, [deroule?.date_jour, now])

  const nowMin = isToday ? now.getHours() * 60 + now.getMinutes() : null
  const nowVisible = nowMin !== null && nowMin >= heureDebutMin && nowMin <= heureFinMin

  // Calcul position en px d'un instant
  function minToTop(min) {
    return ((min - heureDebutMin) / 60) * PX_PER_HOUR
  }

  function durationToHeight(durMin) {
    return (durMin / 60) * PX_PER_HOUR
  }

  // Click sur zone vide d'une lane → suggère création
  function handleEmptyClick(e, laneId) {
    if (!canEdit) return
    if (!onCreateCreneauAt) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutesFromTop = (y / PX_PER_HOUR) * 60
    const heureMin = Math.round((heureDebutMin + minutesFromTop) / 15) * 15
    const debutClamped = Math.max(heureDebutMin, Math.min(heureFinMin - 30, heureMin))
    onCreateCreneauAt({
      lane_id: laneId,
      multi_lane: false,
      heure_debut: minutesToTime(debutClamped),
      heure_fin: minutesToTime(debutClamped + 30),
    })
  }

  function handleMultiLaneClick(e) {
    if (!canEdit) return
    if (!onCreateCreneauAt) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutesFromTop = (y / PX_PER_HOUR) * 60
    const heureMin = Math.round((heureDebutMin + minutesFromTop) / 15) * 15
    const debutClamped = Math.max(heureDebutMin, Math.min(heureFinMin - 30, heureMin))
    onCreateCreneauAt({
      lane_id: null,
      multi_lane: true,
      heure_debut: minutesToTime(debutClamped),
      heure_fin: minutesToTime(debutClamped + 30),
    })
  }

  // Sort lanes by sort_order (lane 0 d'abord)
  const sortedLanes = useMemo(
    () => [...(lanes || [])].sort((a, b) => a.sort_order - b.sort_order),
    [lanes],
  )
  const canAddLane = sortedLanes.length < MAX_LANES

  return (
    <div
      ref={containerRef}
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      {/* Header lanes */}
      <div
        className="flex sticky top-0 z-20"
        style={{
          background: 'var(--bg-elev)',
          borderBottom: '1px solid var(--brd)',
        }}
      >
        <div
          style={{
            width: TIME_COL_W,
            minWidth: TIME_COL_W,
            height: LANE_HEADER_H,
            borderRight: '1px solid var(--brd-sub)',
          }}
        />
        {sortedLanes.map((lane) => (
          <LaneHeader
            key={lane.id}
            lane={lane}
            canEdit={canEdit}
            onUpdate={onUpdateLane}
            onDelete={onDeleteLane}
          />
        ))}
        {canAddLane && canEdit && (
          <button
            type="button"
            onClick={() => onAddLane?.()}
            className="flex items-center justify-center text-xs gap-1 transition-colors"
            style={{
              width: 80,
              minWidth: 80,
              borderLeft: '1px dashed var(--brd-sub)',
              color: 'var(--txt-3)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <Plus className="w-3 h-3" />
            Lane
          </button>
        )}
      </div>

      {/* Body timeline */}
      <div
        className="relative flex"
        style={{ height: totalHeight + 16, minHeight: 200 }}
      >
        {/* Colonne heures */}
        <div
          style={{
            width: TIME_COL_W,
            minWidth: TIME_COL_W,
            position: 'relative',
            borderRight: '1px solid var(--brd-sub)',
          }}
        >
          {graduations.map((g) => (
            <div
              key={g.minutes}
              style={{
                position: 'absolute',
                top: minToTop(g.minutes),
                right: 6,
                fontSize: 10,
                color: g.isHourMark ? 'var(--txt-2)' : 'var(--txt-3)',
                fontWeight: g.isHourMark ? 500 : 400,
                lineHeight: 1,
                transform: 'translateY(-50%)',
              }}
            >
              {g.label || ''}
            </div>
          ))}
        </div>

        {/* Lanes */}
        {sortedLanes.map((lane) => {
          const creneauxLane = creneauxByLane.get(lane.id) || []
          return (
            <div
              key={lane.id}
              onClick={(e) => handleEmptyClick(e, lane.id)}
              className="flex-1 relative"
              style={{
                borderRight: '1px solid var(--brd-sub)',
                cursor: canEdit ? 'crosshair' : 'default',
                minWidth: 120,
              }}
            >
              {/* Graduations de fond */}
              {graduations.map((g) => (
                <div
                  key={g.minutes}
                  style={{
                    position: 'absolute',
                    top: minToTop(g.minutes),
                    left: 0,
                    right: 0,
                    height: 0,
                    borderTop: `1px ${g.isHourMark ? 'solid' : 'dashed'} var(--brd-sub)`,
                    opacity: g.isHourMark ? 0.6 : 0.25,
                    pointerEvents: 'none',
                  }}
                />
              ))}

              {/* Créneaux mono-lane */}
              {creneauxLane.map((c) => (
                <CreneauBlock
                  key={c.id}
                  creneau={c}
                  top={minToTop(timeToMinutes(c.heure_debut))}
                  height={durationToHeight(
                    timeToMinutes(c.heure_fin) - timeToMinutes(c.heure_debut),
                  )}
                  membreInitiales={membreInitiales}
                  onClick={() => onSelectCreneau?.(c)}
                />
              ))}
            </div>
          )
        })}

        {/* Spacer 80px à droite pour matcher la colonne "+ Lane" du header.
            Sans ce spacer, les lanes flex-1 du body s'étalent sur 80px de
            plus que celles du header → décalage croissant vers la droite. */}
        {canAddLane && canEdit && (
          <div
            style={{
              width: 80,
              minWidth: 80,
              borderLeft: '1px dashed var(--brd-sub)',
              opacity: 0.4,
            }}
          />
        )}

        {/* Couche multi-lane : par-dessus toutes les lanes (left: TIME_COL_W) */}
        <div
          onClick={handleMultiLaneClick}
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: TIME_COL_W,
            right: canAddLane && canEdit ? 80 : 0,
            bottom: 0,
          }}
        >
          {creneauxMultiLane.map((c) => (
            <CreneauBlock
              key={c.id}
              creneau={c}
              top={minToTop(timeToMinutes(c.heure_debut))}
              height={durationToHeight(
                timeToMinutes(c.heure_fin) - timeToMinutes(c.heure_debut),
              )}
              membreInitiales={membreInitiales}
              onClick={() => onSelectCreneau?.(c)}
              isMultiLane
            />
          ))}
        </div>

        {/* Now line */}
        {nowVisible && (
          <div
            className="absolute pointer-events-none z-30"
            style={{
              top: minToTop(nowMin),
              left: TIME_COL_W,
              right: 0,
              borderTop: '1.5px solid #E24B4A',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: -42,
                top: -8,
                background: '#E24B4A',
                color: 'white',
                fontSize: 9,
                fontWeight: 500,
                padding: '1px 6px',
                borderRadius: 8,
              }}
            >
              {minutesToTime(nowMin)}
            </div>
          </div>
        )}
      </div>

      {/* Légende types de créneau */}
      <div
        className="flex flex-wrap gap-3 px-3 py-2 text-[10px] items-center"
        style={{
          borderTop: '1px solid var(--brd-sub)',
          color: 'var(--txt-3)',
          background: 'var(--bg-elev)',
        }}
      >
        <span style={{ fontWeight: 500 }}>Légende</span>
        {Object.entries(CRENEAU_TYPE_COLORS).map(([type, color]) => (
          <span
            key={type}
            className="inline-flex items-center gap-1"
          >
            <span
              style={{
                width: 8,
                height: 8,
                background: color,
                borderRadius: 2,
                display: 'inline-block',
              }}
            />
            {labelForType(type)}
          </span>
        ))}
      </div>
    </div>
  )
}

function labelForType(type) {
  const labels = {
    install: 'Installation',
    repas: 'Repas',
    prise: 'Prise',
    pause: 'Pause',
    transport: 'Transport',
    brief: 'Briefing',
    live: 'Live',
    autre: 'Autre',
  }
  return labels[type] || type
}

// ─── LaneHeader (titre éditable + bouton supprimer pour lanes 1+) ──────────

function LaneHeader({ lane, canEdit, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(lane.libelle)
  const isGlobal = lane.sort_order === 0

  function commitEdit() {
    setEditing(false)
    const next = draft.trim() || defaultLaneLibelle(lane.sort_order)
    if (next !== lane.libelle) onUpdate?.(lane.id, { libelle: next })
  }

  return (
    <div
      className="flex items-center justify-between gap-1 px-2 text-xs flex-1"
      style={{
        height: LANE_HEADER_H,
        borderRight: '1px solid var(--brd-sub)',
        fontWeight: 500,
        color: 'var(--txt-2)',
        minWidth: 120,
      }}
    >
      {editing && canEdit ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(lane.libelle)
              setEditing(false)
            }
          }}
          className="flex-1 px-1 outline-none"
          style={{
            background: 'var(--bg-surf)',
            color: 'var(--txt)',
            border: '1px solid var(--blue)',
            borderRadius: 3,
            fontSize: 12,
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => canEdit && setEditing(true)}
          className="truncate text-left flex-1"
          style={{
            background: 'transparent',
            color: 'var(--txt-2)',
            cursor: canEdit ? 'text' : 'default',
          }}
          title={canEdit ? 'Cliquer pour renommer' : lane.libelle}
        >
          {lane.libelle}
        </button>
      )}
      {canEdit && !isGlobal && !editing && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete?.(lane.id)
          }}
          className="opacity-0 hover:opacity-100 transition-opacity"
          style={{
            color: 'var(--red)',
            background: 'transparent',
            fontSize: 14,
            padding: '0 4px',
            opacity: 0.5,
          }}
          title="Supprimer cette lane (doit être vide)"
        >
          ×
        </button>
      )}
    </div>
  )
}

// ─── CreneauBlock — rectangle cliquable ────────────────────────────────────

function CreneauBlock({ creneau, top, height, membreInitiales, onClick, isMultiLane }) {
  const color = effectiveCouleurCreneau(creneau)
  const minH = 24

  return (
    <div
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(creneau)
      }}
      className="absolute rounded-r"
      style={{
        top,
        left: 4,
        right: 4,
        height: Math.max(minH, height - 2),
        background: hexToBgFill(color),
        borderLeft: `2px solid ${color}`,
        padding: '4px 8px',
        cursor: 'pointer',
        overflow: 'hidden',
        pointerEvents: 'auto',
        opacity: creneau.statut === 'annule' ? 0.5 : 1,
        textDecoration: creneau.statut === 'annule' ? 'line-through' : 'none',
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 0 0 1px ' + color
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none'
      }}
      title={`${creneau.titre} · ${creneau.heure_debut.slice(0, 5)} – ${creneau.heure_fin.slice(0, 5)}`}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: hexToTextColor(color),
          lineHeight: 1.2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {isMultiLane && (
          <span style={{ marginRight: 4, opacity: 0.6 }}>↔</span>
        )}
        {creneau.titre || '(sans titre)'}
      </div>
      {height >= 36 && (
        <div
          style={{
            fontSize: 10,
            color: hexToTextColor(color),
            opacity: 0.75,
            marginTop: 1,
          }}
        >
          {creneau.heure_debut.slice(0, 5)} – {creneau.heure_fin.slice(0, 5)}
          {creneau.lieu_text && <> · {creneau.lieu_text}</>}
        </div>
      )}
      {height >= 56 && creneau.member_ids && creneau.member_ids.length > 0 && (
        <div className="flex gap-0.5 mt-1.5" style={{ pointerEvents: 'none' }}>
          {creneau.member_ids.slice(0, 3).map((mid) => {
            const m = membreInitiales.get(mid)
            return (
              <div
                key={mid}
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: hexToAvatarBg(color),
                  color: hexToTextColor(color),
                  fontSize: 9,
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title={m?.fullName || ''}
              >
                {m?.initiales || '?'}
              </div>
            )
          })}
          {creneau.member_ids.length > 3 && (
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: hexToAvatarBg(color),
                color: hexToTextColor(color),
                fontSize: 9,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              +{creneau.member_ids.length - 3}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Helpers couleur ────────────────────────────────────────────────────────

function hexToRgb(hex) {
  const clean = (hex || '').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(clean)) return [136, 135, 128]
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ]
}

function hexToBgFill(hex) {
  const [r, g, b] = hexToRgb(hex)
  // FIX V0 : 0.18 (au lieu de 0.12) pour mieux ressortir sur dark mode.
  // Sur fond très foncé, 0.12 était presque invisible.
  return `rgba(${r}, ${g}, ${b}, 0.18)`
}

function hexToAvatarBg(hex) {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, 0.3)`
}

function hexToTextColor(hex) {
  // Texte = couleur saturée du type, pleine opacité (lisible sur fond pâle)
  return hex
}

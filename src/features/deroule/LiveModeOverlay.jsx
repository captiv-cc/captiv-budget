// ════════════════════════════════════════════════════════════════════════════
// LiveModeOverlay — Vue plein écran mode régie live
// ════════════════════════════════════════════════════════════════════════════
//
// Affichage focus pour la régie ou un écran de salle. Le layout répond à la
// question "il se passe quoi où" :
//   - GRID DES VENUES (lanes type='lieu') : une card par scène avec le
//     créneau actuellement en cours sur cette scène. Si vacant → état idle.
//   - STRIP CADREURS (lanes type='personne') : qui filme quoi maintenant.
//   - SUIVANT : prochain créneau à venir (tout type confondu).
//   - Boutons "Marquer fait" et "Suivant (avancer)" en bas.
//
// Activation : document.documentElement.requestFullscreen() depuis le parent
// avant de monter ce composant. Au unmount on document.exitFullscreen().
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo } from 'react'
import { X, SkipForward, Check, Clock, MapPin, Camera, Pause } from 'lucide-react'
import { effectiveCouleurCreneau, formatMinHHMM } from '../../lib/deroule'

export default function LiveModeOverlay({
  currentCreneaux = [],
  nextCreneau = null,
  nowMin = 0,
  membreById,
  laneById,
  // Actions per-créneau (granularité venue par venue)
  onMarkCreneauDone, // (creneauId) => void
  onSkipFromCreneau, // (creneauId) => void : marque fait + lance next sur même lane
  onClose,
}) {
  // Esc ferme
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // ─── Build lanes par type ─────────────────────────────────────────────
  const { lieuLanes, personneLanes } = useMemo(() => {
    const all = laneById ? [...laneById.values()] : []
    return {
      lieuLanes: all
        .filter((l) => l.type === 'lieu')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      personneLanes: all
        .filter((l) => l.type === 'personne')
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }
  }, [laneById])

  // Pour chaque venue : créneau actuellement dessus (ou null si vacant)
  const venueState = useMemo(
    () =>
      lieuLanes.map((lane) => ({
        lane,
        creneau:
          currentCreneaux.find(
            (c) => c.lane_id === lane.id || c.multi_lane === true,
          ) || null,
      })),
    [lieuLanes, currentCreneaux],
  )

  // Pour chaque cadreur : créneau (lane perso OU multi_lane)
  const cadreurState = useMemo(
    () =>
      personneLanes.map((lane) => ({
        lane,
        creneau:
          currentCreneaux.find(
            (c) => c.lane_id === lane.id || c.multi_lane === true,
          ) || null,
      })),
    [personneLanes, currentCreneaux],
  )

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0A0A0A',
        color: '#FFFFFF',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, system-ui, sans-serif',
      }}
    >
      {/* Top bar : heure courante + bouton fermer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 28px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          shrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 800,
            letterSpacing: 1,
            color: '#FFF',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {formatMinHHMM(nowMin)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase',
            letterSpacing: 3,
            fontWeight: 600,
          }}
        >
          Mode régie · live
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Quitter le mode live (Esc)"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)',
            color: '#FFF',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          <X size={14} />
          Quitter
        </button>
      </div>

      {/* Body scrollable */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '28px 36px',
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
        }}
      >
        {/* ──── SECTION VENUES (où ça se passe) ──────────────────── */}
        {lieuLanes.length > 0 && (
          <section>
            <SectionLabel>
              <MapPin size={12} strokeWidth={2.5} />
              Sur les scènes
            </SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  lieuLanes.length === 1
                    ? '1fr'
                    : lieuLanes.length === 2
                    ? 'repeat(2, 1fr)'
                    : 'repeat(auto-fit, minmax(340px, 1fr))',
                gap: 16,
              }}
            >
              {venueState.map(({ lane, creneau }) => (
                <VenueCard
                  key={lane.id}
                  lane={lane}
                  creneau={creneau}
                  nowMin={nowMin}
                  membreById={membreById}
                  onMarkDone={onMarkCreneauDone}
                  onSkipNext={onSkipFromCreneau}
                />
              ))}
            </div>
          </section>
        )}

        {/* ──── SECTION CADREURS (qui filme quoi) ─────────────────── */}
        {personneLanes.length > 0 && (
          <section>
            <SectionLabel>
              <Camera size={12} strokeWidth={2.5} />
              Cadreurs
            </SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 12,
              }}
            >
              {cadreurState.map(({ lane, creneau }) => (
                <CadreurCard
                  key={lane.id}
                  lane={lane}
                  creneau={creneau}
                  membreById={membreById}
                  laneById={laneById}
                  onMarkDone={onMarkCreneauDone}
                  onSkipNext={onSkipFromCreneau}
                />
              ))}
            </div>
          </section>
        )}

        {/* ──── SECTION SUIVANT ──────────────────────────────────── */}
        {nextCreneau && (
          <section>
            <SectionLabel>
              <SkipForward size={12} strokeWidth={2.5} />
              Suivant
            </SectionLabel>
            <NextCard creneau={nextCreneau} laneById={laneById} nowMin={nowMin} />
          </section>
        )}

        {/* Si vraiment rien partout */}
        {lieuLanes.length === 0 && personneLanes.length === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: 64,
              color: 'rgba(255,255,255,0.4)',
            }}
          >
            Aucune lane configurée.
          </div>
        )}
      </div>

      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}

// ─── VenueCard : une scène, ce qui s'y passe maintenant ────────────────────
function VenueCard({ lane, creneau, nowMin, membreById, onMarkDone, onSkipNext }) {
  const isActive = Boolean(creneau)
  const color = creneau ? effectiveCouleurCreneau(creneau) : '#6B7280'
  const remaining = creneau
    ? (creneau.heure_fin_min ?? 0) - nowMin
    : 0
  const elapsed = creneau ? nowMin - (creneau.heure_debut_min ?? 0) : 0
  const total = creneau
    ? (creneau.heure_fin_min ?? 0) - (creneau.heure_debut_min ?? 0)
    : 0
  const progress =
    total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0
  const memberIds =
    creneau && Array.isArray(creneau.member_ids) ? creneau.member_ids : []

  return (
    <div
      style={{
        background: isActive
          ? `linear-gradient(180deg, ${color}1f 0%, transparent 100%), rgba(255,255,255,0.04)`
          : 'rgba(255,255,255,0.025)',
        border: `1px solid ${isActive ? `${color}55` : 'rgba(255,255,255,0.08)'}`,
        borderRadius: 14,
        padding: '20px 22px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Bandeau coloré en haut pour signaler l'état */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: isActive ? color : 'rgba(255,255,255,0.08)',
        }}
      />

      {/* Header : Nom venue + statut */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#FFF',
            letterSpacing: 0.3,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <MapPin size={13} style={{ color: 'rgba(255,255,255,0.5)' }} />
          {lane.libelle || '—'}
        </div>
        {isActive ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 10,
              fontWeight: 800,
              color,
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                animation: 'live-pulse 1.5s ease-in-out infinite',
              }}
            />
            En cours
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 10,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.35)',
              textTransform: 'uppercase',
              letterSpacing: 2,
            }}
          >
            <Pause size={10} />
            Vacant
          </div>
        )}
      </div>

      {/* Body : titre + horaires (ou état vide) */}
      {isActive ? (
        <>
          <div
            style={{
              fontSize: 'clamp(28px, 3vw, 42px)',
              fontWeight: 800,
              lineHeight: 1.05,
              color: '#FFF',
              letterSpacing: -0.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {creneau.titre || '(sans titre)'}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              fontSize: 14,
              color: 'rgba(255,255,255,0.85)',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Clock size={13} />
              {formatMinHHMM(creneau.heure_debut_min)} –{' '}
              {formatMinHHMM(creneau.heure_fin_min)}
            </span>
            {remaining > 0 && (
              <span style={{ color: '#22C55E', fontWeight: 600 }}>
                Reste {formatDuration(remaining)}
              </span>
            )}
          </div>

          {/* Barre de progression */}
          <div
            style={{
              height: 4,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: color,
                transition: 'width 1s linear',
              }}
            />
          </div>

          {/* Équipe assignée (petite ligne d'avatars) */}
          {memberIds.length > 0 && membreById && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginTop: 2,
              }}
            >
              {memberIds.slice(0, 6).map((mid) => {
                const m = membreById.get?.(mid)
                if (!m) return null
                return (
                  <span
                    key={mid}
                    title={m.fullName}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      padding: '3px 8px',
                      background: 'rgba(255,255,255,0.05)',
                      borderRadius: 5,
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.85)',
                    }}
                  >
                    <span
                      style={{
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: `${color}33`,
                        color,
                        fontSize: 9,
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {m.ini || '?'}
                    </span>
                    {m.fullName}
                  </span>
                )
              })}
              {memberIds.length > 6 && (
                <span
                  style={{
                    fontSize: 11,
                    color: 'rgba(255,255,255,0.5)',
                    alignSelf: 'center',
                  }}
                >
                  +{memberIds.length - 6}
                </span>
              )}
            </div>
          )}

          {/* Actions per-venue : marquer fait + suivant (lance prochain
              sur cette même venue, sans toucher aux autres scènes). */}
          {(onMarkDone || onSkipNext) && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 6,
              }}
            >
              {onMarkDone && (
                <button
                  type="button"
                  onClick={() => onMarkDone(creneau.id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 10px',
                    background: 'rgba(34,197,94,0.15)',
                    border: '1px solid rgba(34,197,94,0.4)',
                    color: '#22C55E',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: 0.2,
                  }}
                >
                  <Check size={13} strokeWidth={3} />
                  Fait
                </button>
              )}
              {onSkipNext && (
                <button
                  type="button"
                  onClick={() => onSkipNext(creneau.id)}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    padding: '7px 10px',
                    background: 'rgba(59,130,246,0.15)',
                    border: '1px solid rgba(59,130,246,0.4)',
                    color: '#3B82F6',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    letterSpacing: 0.2,
                  }}
                  title="Marque fait + lance le suivant sur cette scène"
                >
                  <SkipForward size={13} strokeWidth={3} />
                  Suivant
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            padding: '24px 0 8px',
            textAlign: 'center',
            color: 'rgba(255,255,255,0.3)',
            fontSize: 14,
            fontStyle: 'italic',
          }}
        >
          Pas de programmation
        </div>
      )}
    </div>
  )
}

// ─── CadreurCard : un cadreur, ce qu'il fait maintenant ────────────────────
function CadreurCard({ lane, creneau, membreById, laneById, onMarkDone, onSkipNext }) {
  const membre = lane.membre_id ? membreById?.get?.(lane.membre_id) : null
  const isActive = Boolean(creneau)
  const color = creneau ? effectiveCouleurCreneau(creneau) : '#6B7280'
  const creneauLane =
    creneau && !creneau.multi_lane ? laneById?.get?.(creneau.lane_id) : null

  return (
    <div
      style={{
        background: isActive
          ? `${color}10`
          : 'rgba(255,255,255,0.025)',
        border: `1px solid ${isActive ? `${color}40` : 'rgba(255,255,255,0.08)'}`,
        borderLeft: `3px solid ${isActive ? color : 'rgba(255,255,255,0.1)'}`,
        borderRadius: 8,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: isActive ? `${color}33` : 'rgba(255,255,255,0.06)',
            color: isActive ? color : 'rgba(255,255,255,0.5)',
            fontSize: 11,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            shrink: 0,
          }}
        >
          {membre?.ini || '?'}
        </span>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#FFF',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0,
          }}
        >
          {membre?.fullName || lane.libelle || '—'}
        </div>
      </div>
      {isActive ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: '#FFF',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={creneau.titre}
          >
            {creneau.titre || '(sans titre)'}
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.6)',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <span>
              {formatMinHHMM(creneau.heure_debut_min)}–
              {formatMinHHMM(creneau.heure_fin_min)}
            </span>
            {creneauLane?.libelle && (
              <span style={{ opacity: 0.7 }}>· {creneauLane.libelle}</span>
            )}
          </div>
          {/* Actions compactes pour cadreur — icon-only pour ne pas
              encombrer la card étroite. Tooltips au hover. */}
          {(onMarkDone || onSkipNext) && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginTop: 4,
              }}
            >
              {onMarkDone && (
                <button
                  type="button"
                  onClick={() => onMarkDone(creneau.id)}
                  title="Marquer fait"
                  aria-label="Marquer fait"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '5px 6px',
                    background: 'rgba(34,197,94,0.12)',
                    border: '1px solid rgba(34,197,94,0.35)',
                    color: '#22C55E',
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Check size={11} strokeWidth={3} />
                  Fait
                </button>
              )}
              {onSkipNext && (
                <button
                  type="button"
                  onClick={() => onSkipNext(creneau.id)}
                  title="Suivant (fait + lance le prochain de ce cadreur)"
                  aria-label="Suivant"
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    padding: '5px 6px',
                    background: 'rgba(59,130,246,0.12)',
                    border: '1px solid rgba(59,130,246,0.35)',
                    color: '#3B82F6',
                    borderRadius: 5,
                    fontSize: 10,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <SkipForward size={11} strokeWidth={3} />
                  Suivant
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            fontSize: 11,
            color: 'rgba(255,255,255,0.35)',
            fontStyle: 'italic',
          }}
        >
          —
        </div>
      )}
    </div>
  )
}

// ─── NextCard : prochain créneau global ───────────────────────────────────
function NextCard({ creneau, laneById, nowMin }) {
  const color = effectiveCouleurCreneau(creneau)
  const lane = laneById?.get?.(creneau.lane_id)
  const startsIn = (creneau.heure_debut_min ?? 0) - nowMin
  return (
    <div
      style={{
        background: `${color}10`,
        border: `1px solid ${color}40`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 10,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      {lane?.libelle && (
        <div
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.6)',
            textTransform: 'uppercase',
            letterSpacing: 1.5,
          }}
        >
          {lane.libelle}
        </div>
      )}
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: '#FFF',
          flex: 1,
          minWidth: 0,
        }}
      >
        {creneau.titre || '(sans titre)'}
      </div>
      <div
        style={{
          fontSize: 14,
          color: 'rgba(255,255,255,0.85)',
          display: 'flex',
          gap: 14,
          alignItems: 'center',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Clock size={13} />
          {formatMinHHMM(creneau.heure_debut_min)}
        </span>
        {startsIn > 0 && (
          <span style={{ color: '#3B82F6', fontWeight: 700 }}>
            Dans {formatDuration(startsIn)}
          </span>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 2.5,
        color: 'rgba(255,255,255,0.45)',
        textTransform: 'uppercase',
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  )
}

function formatDuration(min) {
  if (typeof min !== 'number' || min <= 0) return '0min'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

// ════════════════════════════════════════════════════════════════════════════
// LiveModeOverlay — Vue plein écran mode régie live
// ════════════════════════════════════════════════════════════════════════════
//
// Affichage focus pour la régie ou un écran de salle :
//   - EN COURS XL : titre + horaires + cadreurs + compte à rebours
//   - SUIVANT : titre + horaires (taille moyenne)
//   - Boutons "Suivant" et "Marquer fait" en bas
//   - Bouton "Quitter le plein écran" / "Désactiver live"
//
// Activation : document.documentElement.requestFullscreen() depuis le parent
// avant de monter ce composant. Au unmount on document.exitFullscreen().
// ════════════════════════════════════════════════════════════════════════════

import { useEffect } from 'react'
import { X, SkipForward, Check, Clock } from 'lucide-react'
import { effectiveCouleurCreneau, formatMinHHMM } from '../../lib/deroule'

export default function LiveModeOverlay({
  currentCreneaux = [],
  nextCreneau = null,
  nowMin = 0,
  membreById,
  laneById,
  onSkipToNext,
  onMarkDone,
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

  const primary = currentCreneaux[0] || null

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
          padding: '20px 32px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <div
          style={{
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: 1,
            color: '#FFF',
          }}
        >
          {formatMinHHMM(nowMin)}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'rgba(255,255,255,0.5)',
            textTransform: 'uppercase',
            letterSpacing: 2,
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
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
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

      {/* Body : EN COURS XL */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 64px',
          gap: 48,
          minHeight: 0,
        }}
      >
        {primary ? (
          <PrimaryCard
            creneau={primary}
            laneById={laneById}
            membreById={membreById}
            nowMin={nowMin}
          />
        ) : (
          <NoCurrent nextCreneau={nextCreneau} />
        )}

        {/* Autres en cours en parallèle (festival multi-scène) */}
        {currentCreneaux.length > 1 && (
          <div>
            <SectionLabel>Aussi en cours</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 12,
              }}
            >
              {currentCreneaux.slice(1).map((c) => (
                <SmallCard
                  key={c.id}
                  creneau={c}
                  laneById={laneById}
                  membreById={membreById}
                  variant="current"
                />
              ))}
            </div>
          </div>
        )}

        {/* Suivant */}
        {nextCreneau && (
          <div>
            <SectionLabel>Suivant</SectionLabel>
            <SmallCard
              creneau={nextCreneau}
              laneById={laneById}
              membreById={membreById}
              variant="next"
              nowMin={nowMin}
            />
          </div>
        )}
      </div>

      {/* Bottom bar : actions */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '20px 32px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'rgba(0,0,0,0.5)',
        }}
      >
        <button
          type="button"
          onClick={onMarkDone}
          disabled={!primary}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '16px 24px',
            background: primary ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.04)',
            border: `2px solid ${primary ? 'rgba(34,197,94,0.6)' : 'rgba(255,255,255,0.1)'}`,
            color: primary ? '#22C55E' : 'rgba(255,255,255,0.3)',
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 600,
            cursor: primary ? 'pointer' : 'not-allowed',
            letterSpacing: 0.3,
          }}
        >
          <Check size={18} strokeWidth={3} />
          Marquer fait
        </button>
        <button
          type="button"
          onClick={onSkipToNext}
          disabled={!primary && !nextCreneau}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '16px 24px',
            background:
              primary || nextCreneau
                ? 'rgba(59,130,246,0.18)'
                : 'rgba(255,255,255,0.04)',
            border: `2px solid ${
              primary || nextCreneau
                ? 'rgba(59,130,246,0.6)'
                : 'rgba(255,255,255,0.1)'
            }`,
            color:
              primary || nextCreneau ? '#3B82F6' : 'rgba(255,255,255,0.3)',
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 600,
            cursor:
              primary || nextCreneau ? 'pointer' : 'not-allowed',
            letterSpacing: 0.3,
          }}
        >
          <SkipForward size={18} strokeWidth={3} />
          Suivant (avancer)
        </button>
      </div>
    </div>
  )
}

// ─── PrimaryCard : créneau en cours XL ─────────────────────────────────────
function PrimaryCard({ creneau, laneById, membreById, nowMin }) {
  const color = effectiveCouleurCreneau(creneau)
  const lane = laneById?.get?.(creneau.lane_id)
  const remaining = (creneau.heure_fin_min ?? 0) - nowMin
  const elapsed = nowMin - (creneau.heure_debut_min ?? 0)
  const total = (creneau.heure_fin_min ?? 0) - (creneau.heure_debut_min ?? 0)
  const progress = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : 0
  const memberIds = Array.isArray(creneau.member_ids) ? creneau.member_ids : []

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: color,
            animation: 'live-pulse 1.5s ease-in-out infinite',
          }}
        />
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color,
            textTransform: 'uppercase',
            letterSpacing: 3,
          }}
        >
          En cours
        </span>
        {lane?.libelle && (
          <span
            style={{
              fontSize: 14,
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            · {lane.libelle}
          </span>
        )}
      </div>

      <h1
        style={{
          fontSize: 'clamp(48px, 7vw, 96px)',
          fontWeight: 800,
          lineHeight: 1.05,
          margin: 0,
          color: '#FFF',
          letterSpacing: -1.5,
        }}
      >
        {creneau.titre || '(sans titre)'}
      </h1>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          marginTop: 24,
          fontSize: 22,
          color: 'rgba(255,255,255,0.85)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Clock size={20} />
          {formatMinHHMM(creneau.heure_debut_min)} – {formatMinHHMM(creneau.heure_fin_min)}
        </span>
        {remaining > 0 && (
          <span style={{ color: '#22C55E' }}>
            Reste {formatDuration(remaining)}
          </span>
        )}
      </div>

      {/* Barre de progression */}
      <div
        style={{
          marginTop: 18,
          height: 6,
          background: 'rgba(255,255,255,0.08)',
          borderRadius: 3,
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

      {memberIds.length > 0 && membreById && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 20,
          }}
        >
          {memberIds.map((mid) => {
            const m = membreById.get?.(mid)
            if (!m) return null
            return (
              <div
                key={mid}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 12px',
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 6,
                  fontSize: 14,
                  color: 'rgba(255,255,255,0.85)',
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: `${color}33`,
                    color,
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {m.ini || '?'}
                </span>
                {m.fullName}
              </div>
            )
          })}
        </div>
      )}

      <style>{`
        @keyframes live-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}

// ─── SmallCard : créneau en parallèle ou suivant ────────────────────────
function SmallCard({ creneau, laneById, variant, nowMin }) {
  const color = effectiveCouleurCreneau(creneau)
  const lane = laneById?.get?.(creneau.lane_id)
  const startsIn =
    variant === 'next' && typeof nowMin === 'number'
      ? (creneau.heure_debut_min ?? 0) - nowMin
      : null
  return (
    <div
      style={{
        padding: '16px 18px',
        background: 'rgba(255,255,255,0.04)',
        border: `1px solid ${color}55`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: 'rgba(255,255,255,0.55)',
          marginBottom: 4,
        }}
      >
        {lane?.libelle || '—'}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: '#FFF',
          lineHeight: 1.15,
        }}
      >
        {creneau.titre || '(sans titre)'}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginTop: 6,
          fontSize: 14,
          color: 'rgba(255,255,255,0.7)',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Clock size={12} />
          {formatMinHHMM(creneau.heure_debut_min)} – {formatMinHHMM(creneau.heure_fin_min)}
        </span>
        {variant === 'next' && startsIn !== null && startsIn > 0 && (
          <span style={{ color: '#3B82F6', fontWeight: 600 }}>
            Dans {formatDuration(startsIn)}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── État vide : rien en cours ──────────────────────────────────────────
function NoCurrent({ nextCreneau }) {
  return (
    <div style={{ textAlign: 'center', padding: '0 32px' }}>
      <div
        style={{
          fontSize: 16,
          color: 'rgba(255,255,255,0.4)',
          textTransform: 'uppercase',
          letterSpacing: 4,
          marginBottom: 16,
        }}
      >
        Aucun créneau en cours
      </div>
      {nextCreneau ? (
        <div
          style={{
            fontSize: 28,
            color: 'rgba(255,255,255,0.85)',
            fontWeight: 600,
          }}
        >
          Prochain : {nextCreneau.titre || '—'} à{' '}
          {formatMinHHMM(nextCreneau.heure_debut_min)}
        </div>
      ) : (
        <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.5)' }}>
          Pas de suivant prévu.
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 3,
        color: 'rgba(255,255,255,0.4)',
        textTransform: 'uppercase',
        marginBottom: 12,
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

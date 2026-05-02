// ════════════════════════════════════════════════════════════════════════════
// PresenceCalendarModal — Présence & logistique d'une persona (P1.6)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale qui regroupe :
//   - Calendrier des jours de présence (multi-mois, avec sélection rapide
//     par période du projet : Tournage, Prépa, etc.)
//   - Section logistique : jour d'arrivée (souvent ≠ du 1er jour de
//     présence), heure d'arrivée libre, notes logistique (transport,
//     contraintes…)
//
// Toutes les valeurs sont persona-level → propagées à toutes les rows de
// la même personne via updatePersona.
//
// Usage :
//   <PresenceCalendarModal
//     open={open}
//     onClose={...}
//     personaName="Hugo Martin"
//     persona={{ presence_days, arrival_date, arrival_time, logistique_notes }}
//     onSave={(fields) => updatePersona(key, fields)}
//     periodes={extractPeriodes(project.metadata)}
//     anchorDate={firstTournageDay}
//   />
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react'
import {
  X,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
  Calendar,
  PlaneLanding,
  Clock,
  StickyNote,
} from 'lucide-react'
import {
  WEEKDAYS_SHORT_FR,
  MONTHS_FR,
  getMonthGrid,
  addMonths,
  fmtDateKey,
  isSameMonth,
  startOfMonth,
} from '../../planning/dateUtils'
import { PERIODE_KEYS, PERIODE_META, expandDays, hasAnyRange } from '../../../lib/projectPeriodes'

export default function PresenceCalendarModal({
  open,
  onClose,
  personaName = '—',
  persona = null, // { presence_days, arrival_date, arrival_time, logistique_notes }
  onSave,
  periodes = null,
  anchorDate = null,
}) {
  const initialPresence = persona?.presence_days || []
  const initialArrivalDate = persona?.arrival_date || ''
  const initialArrivalTime = persona?.arrival_time || ''
  const initialLogistique = persona?.logistique_notes || ''

  const [selected, setSelected] = useState(new Set(initialPresence))
  const [arrivalDate, setArrivalDate] = useState(initialArrivalDate)
  const [arrivalTime, setArrivalTime] = useState(initialArrivalTime)
  const [logistique, setLogistique] = useState(initialLogistique)

  const [viewMonth, setViewMonth] = useState(() => {
    if (anchorDate instanceof Date) return startOfMonth(anchorDate)
    if (periodes?.tournage && hasAnyRange(periodes.tournage)) {
      const days = expandDays(periodes.tournage)
      if (days.length) {
        const [y, m] = days[0].split('-').map(Number)
        return new Date(y, m - 1, 1)
      }
    }
    return startOfMonth(new Date())
  })

  // Reset à l'ouverture
  useEffect(() => {
    if (open) {
      setSelected(new Set(persona?.presence_days || []))
      setArrivalDate(persona?.arrival_date || '')
      setArrivalTime(persona?.arrival_time || '')
      setLogistique(persona?.logistique_notes || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Map jour → liste de périodes qui le couvrent
  const dayToPeriodes = useMemo(() => {
    const m = new Map()
    if (!periodes) return m
    for (const key of PERIODE_KEYS) {
      const p = periodes[key]
      if (!hasAnyRange(p)) continue
      for (const day of expandDays(p)) {
        if (!m.has(day)) m.set(day, [])
        m.get(day).push(key)
      }
    }
    return m
  }, [periodes])

  if (!open) return null

  const grid = getMonthGrid(viewMonth.getFullYear(), viewMonth.getMonth())

  function toggleDay(d) {
    const iso = fmtDateKey(d)
    const next = new Set(selected)
    if (next.has(iso)) next.delete(iso)
    else next.add(iso)
    setSelected(next)
  }

  function selectPeriode(key) {
    if (!periodes?.[key]) return
    const days = expandDays(periodes[key])
    const next = new Set(selected)
    for (const d of days) next.add(d)
    setSelected(next)
  }

  function clearAll() {
    setSelected(new Set())
  }

  async function handleSave() {
    const presence_days = [...selected].sort()
    await onSave?.({
      presence_days,
      arrival_date: arrivalDate || null,
      arrival_time: arrivalTime.trim() || null,
      logistique_notes: logistique.trim() || null,
    })
    onClose?.()
  }

  // Pour le bouton "Aligner sur le 1er jour de présence"
  const firstPresenceDay = selected.size ? [...selected].sort()[0] : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Calendar className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
              Présence &amp; logistique
            </h2>
            <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              {personaName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--txt-3)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hov)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--txt-3)'
            }}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Sélection rapide par période */}
        {periodes && (
          <div
            className="flex flex-wrap gap-1.5 px-5 py-3 border-b shrink-0"
            style={{ borderColor: 'var(--brd-sub)' }}
          >
            {PERIODE_KEYS.filter((k) => hasAnyRange(periodes[k])).map((k) => {
              const meta = PERIODE_META[k]
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => selectPeriode(k)}
                  className="text-xs px-2 py-1 rounded-md transition-opacity"
                  style={{
                    background: meta.bg,
                    color: meta.color,
                    border: `1px solid ${meta.color}`,
                  }}
                  title={`Sélectionner tous les jours ${meta.label.toLowerCase()}`}
                  onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
                  onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                  + {meta.label}
                </button>
              )
            })}
            {selected.size > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="text-xs px-2 py-1 rounded-md transition-colors ml-auto"
                style={{ color: 'var(--txt-3)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
              >
                Tout effacer
              </button>
            )}
          </div>
        )}

        {/* Calendrier + logistique (scroll si débordement) */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Calendrier */}
          <div>
            {/* Nav mois */}
            <div className="flex items-center justify-between mb-3">
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, -1))}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {MONTHS_FR[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </div>
              <button
                type="button"
                onClick={() => setViewMonth(addMonths(viewMonth, 1))}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--txt-2)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            {/* Headers jours */}
            <div className="grid grid-cols-7 gap-1 mb-1">
              {WEEKDAYS_SHORT_FR.map((d) => (
                <div
                  key={d}
                  className="text-[10px] text-center font-semibold uppercase py-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  {d}
                </div>
              ))}
            </div>

            {/* Grille mois */}
            <div className="grid grid-cols-7 gap-1">
              {grid.map((d, i) => {
                const iso = fmtDateKey(d)
                const inMonth = isSameMonth(d, viewMonth)
                const isSelected = selected.has(iso)
                const periodKeys = dayToPeriodes.get(iso) || []
                const primaryPeriod = periodKeys[0]
                const periodMeta = primaryPeriod ? PERIODE_META[primaryPeriod] : null

                // Style selon état :
                //   - non sélectionné + dans une période → fond couleur période
                //   - sélectionné + pas dans une période → fond bleu plein
                //   - sélectionné + dans une période → fond bleu plein +
                //     bordure couleur période (pour conserver l'info)
                //   - sinon → fond neutre
                let bgColor = 'var(--bg-elev)'
                let textColor = 'var(--txt)'
                let borderColor = 'var(--brd-sub)'
                let boxShadow = 'none'

                if (!inMonth) {
                  textColor = 'var(--txt-3)'
                } else if (isSelected) {
                  bgColor = 'var(--blue)'
                  textColor = '#fff'
                  borderColor = 'var(--blue)'
                  // Conserver l'info de période via une box-shadow inset colorée
                  if (periodMeta) {
                    boxShadow = `inset 0 0 0 2px ${periodMeta.color}`
                  }
                } else if (periodMeta) {
                  bgColor = periodMeta.bg
                  textColor = periodMeta.color
                  borderColor = periodMeta.color
                }

                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className="aspect-square rounded-md text-sm flex items-center justify-center transition-all relative"
                    style={{
                      background: bgColor,
                      color: textColor,
                      border: `1px solid ${borderColor}`,
                      boxShadow,
                      fontWeight: isSelected ? 600 : 400,
                      opacity: inMonth ? 1 : 0.5,
                    }}
                    title={
                      periodMeta
                        ? `${d.getDate()} — ${periodMeta.label}`
                        : `${d.getDate()}`
                    }
                  >
                    {d.getDate()}
                  </button>
                )
              })}
            </div>
          </div>

          {/* ── Logistique (P1.6) ──────────────────────────────────────── */}
          <div
            className="rounded-md p-3 space-y-3"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
            }}
          >
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--txt-2)' }}>
              <PlaneLanding className="w-3.5 h-3.5" />
              Logistique
            </div>

            {/* Jour + heure d'arrivée sur la même row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label
                  className="block text-[10px] font-semibold mb-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Jour d&rsquo;arrivée
                </label>
                <input
                  type="date"
                  value={arrivalDate || ''}
                  onChange={(e) => setArrivalDate(e.target.value)}
                  className="w-full text-xs px-2 py-1 rounded outline-none"
                  style={{
                    background: 'var(--bg-surf)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                  }}
                />
                {firstPresenceDay && firstPresenceDay !== arrivalDate && (
                  <button
                    type="button"
                    onClick={() => setArrivalDate(firstPresenceDay)}
                    className="mt-1 text-[10px] underline transition-colors"
                    style={{ color: 'var(--txt-3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                    title="Aligner sur le 1er jour de présence"
                  >
                    aligner sur 1<sup>er</sup> jour
                  </button>
                )}
              </div>

              <div>
                <label
                  className="flex items-center gap-1 text-[10px] font-semibold mb-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <Clock className="w-2.5 h-2.5" />
                  Heure d&rsquo;arrivée
                </label>
                <input
                  type="text"
                  value={arrivalTime}
                  onChange={(e) => setArrivalTime(e.target.value)}
                  placeholder="12h50, matin, ETA 14h…"
                  className="w-full text-xs px-2 py-1 rounded outline-none"
                  style={{
                    background: 'var(--bg-surf)',
                    border: '1px solid var(--brd)',
                    color: 'var(--txt)',
                  }}
                />
              </div>
            </div>

            <div>
              <label
                className="flex items-center gap-1 text-[10px] font-semibold mb-1"
                style={{ color: 'var(--txt-3)' }}
              >
                <StickyNote className="w-2.5 h-2.5" />
                Notes logistique
              </label>
              <textarea
                value={logistique}
                onChange={(e) => setLogistique(e.target.value)}
                rows={3}
                placeholder="Train Lyon Part-Dieu 12h50, vient en voiture, parking demandé…"
                className="w-full text-xs px-2 py-1 rounded outline-none resize-none"
                style={{
                  background: 'var(--bg-surf)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-between gap-3 px-5 py-3 border-t shrink-0"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          <div className="text-xs" style={{ color: 'var(--txt-2)' }}>
            <strong style={{ color: 'var(--txt)' }}>{selected.size}</strong> jour
            {selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-md transition-colors"
              style={{
                background: 'transparent',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="text-xs px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-colors"
              style={{
                background: 'var(--blue)',
                color: '#fff',
                border: '1px solid var(--blue)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Enregistrer
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// PlanDatesPickerModal — Calendrier multi-sélection pour applicable_dates
// ════════════════════════════════════════════════════════════════════════════
//
// Permet de sélectionner 0..N jours pour un plan ("ce plan vaut pour J1 + J3
// mais pas J2"). Vide = tous les jours par défaut.
//
// Ergonomie : affiche en arrière-plan les périodes Prépa (bleu pointillé) et
// Tournage (vert pointillé) du projet, lues via extractPeriodes(project.metadata),
// pour aider à choisir rapidement les jours pertinents.
//
// Pas de mode "+ Prépa / + Tournage" comme PresenceCalendarModal — pour les
// plans on n'a pas la dichotomie prépa/tournage à l'attribution, juste une
// liste plate de dates sélectionnées.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { extractPeriodes, PERIODE_META } from '../../lib/projectPeriodes'

const WEEKDAYS = ['LUN', 'MAR', 'MER', 'JEU', 'VEN', 'SAM', 'DIM']
const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export default function PlanDatesPickerModal({
  open,
  onClose,
  initialDates = [],
  projectMetadata = null,
  onSave,
}) {
  const [selectedDates, setSelectedDates] = useState(new Set(initialDates))
  // Mois affiché : par défaut, le 1er jour sélectionné OU 1er jour de tournage
  // OU mois courant (fallback).
  const [displayMonth, setDisplayMonth] = useState(() =>
    pickInitialMonth(initialDates, projectMetadata),
  )

  useEffect(() => {
    if (open) {
      setSelectedDates(new Set(initialDates))
      setDisplayMonth(pickInitialMonth(initialDates, projectMetadata))
    }
  }, [open, initialDates, projectMetadata])

  // Périodes du projet pour le fond coloré.
  const periodes = useMemo(
    () => (projectMetadata ? extractPeriodes(projectMetadata) : null),
    [projectMetadata],
  )

  // Map ISO date → 'prepa' | 'tournage' | null pour le rendu rapide.
  const periodeByDay = useMemo(() => {
    const map = new Map()
    if (!periodes) return map
    for (const key of ['prepa', 'tournage']) {
      const ranges = periodes[key]?.ranges || []
      for (const r of ranges) {
        const days = expandRange(r.start, r.end)
        for (const d of days) {
          // Tournage prend le dessus si overlap (rare mais possible).
          if (!map.has(d) || key === 'tournage') map.set(d, key)
        }
      }
    }
    return map
  }, [periodes])

  if (!open) return null

  function toggleDate(iso) {
    setSelectedDates((prev) => {
      const next = new Set(prev)
      if (next.has(iso)) next.delete(iso)
      else next.add(iso)
      return next
    })
  }

  function handleSave() {
    onSave?.(Array.from(selectedDates).sort())
    onClose?.()
  }

  function handleClear() {
    setSelectedDates(new Set())
  }

  // Jours du mois affiché (ligne 1 = lun de la semaine du 1er du mois).
  const cells = buildMonthGrid(displayMonth)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-md flex flex-col rounded-xl shadow-xl overflow-hidden"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <header
          className="flex items-center gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: 'var(--blue-bg)' }}
          >
            <Calendar className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Jours d&apos;application
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              {selectedDates.size === 0
                ? 'Aucun jour — le plan vaut pour tous les jours'
                : `${selectedDates.size} jour${selectedDates.size > 1 ? 's' : ''} sélectionné${selectedDates.size > 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md"
            style={{ color: 'var(--txt-3)' }}
            title="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Légende couleurs si périodes existent */}
        {periodes && (periodeByDay.size > 0) && (
          <div
            className="flex items-center gap-3 px-5 py-2 text-[10px]"
            style={{ borderBottom: '1px solid var(--brd-sub)', color: 'var(--txt-3)' }}
          >
            <LegendDot color={PERIODE_META.prepa.color} label={PERIODE_META.prepa.label} />
            <LegendDot color={PERIODE_META.tournage.color} label={PERIODE_META.tournage.label} />
          </div>
        )}

        {/* Nav mois + grille */}
        <div className="px-5 py-3">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setDisplayMonth(addMonths(displayMonth, -1))}
              className="p-1.5 rounded-md"
              style={{ color: 'var(--txt-2)' }}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
              {MONTH_NAMES[displayMonth.getMonth()]} {displayMonth.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setDisplayMonth(addMonths(displayMonth, 1))}
              className="p-1.5 rounded-md"
              style={{ color: 'var(--txt-2)' }}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Header weekdays */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="text-[10px] font-semibold text-center"
                style={{ color: 'var(--txt-3)' }}
              >
                {d}
              </div>
            ))}
          </div>

          {/* Cells */}
          <div className="grid grid-cols-7 gap-1">
            {cells.map((cell) => (
              <DayCell
                key={cell.iso}
                iso={cell.iso}
                day={cell.day}
                inMonth={cell.inMonth}
                selected={selectedDates.has(cell.iso)}
                periode={periodeByDay.get(cell.iso) || null}
                onClick={() => toggleDate(cell.iso)}
              />
            ))}
          </div>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={handleClear}
            className="text-xs"
            style={{ color: 'var(--txt-3)' }}
            disabled={selectedDates.size === 0}
          >
            Tout effacer
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-medium px-3 py-1.5 rounded-md"
              style={{
                background: 'transparent',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd)',
              }}
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="text-xs font-semibold px-3 py-1.5 rounded-md"
              style={{ background: 'var(--blue)', color: 'white' }}
            >
              Enregistrer
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function DayCell({ iso, day, inMonth, selected, periode, onClick }) {
  const periodeMeta = periode ? PERIODE_META[periode] : null
  const periodeColor = periodeMeta?.color
  const periodeBg = periodeMeta?.bg

  let bg = 'transparent'
  let color = 'var(--txt)'
  let border = '1px solid transparent'

  if (!inMonth) {
    color = 'var(--txt-3)'
  } else if (periodeBg) {
    bg = periodeBg
  }

  if (selected) {
    bg = 'var(--blue)'
    color = 'white'
    border = '1px solid var(--blue)'
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!inMonth}
      className="aspect-square rounded-md text-xs font-medium flex items-center justify-center transition-all"
      style={{
        background: bg,
        color,
        border,
        opacity: inMonth ? 1 : 0.3,
        cursor: inMonth ? 'pointer' : 'default',
        outline:
          !selected && periodeColor
            ? `1px dashed ${periodeColor}`
            : 'none',
        outlineOffset: -2,
      }}
      aria-label={iso}
    >
      {day}
    </button>
  )
}

function LegendDot({ color, label }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: color }}
      />
      {label}
    </span>
  )
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function pickInitialMonth(dates, metadata) {
  if (Array.isArray(dates) && dates.length > 0) {
    const sorted = [...dates].sort()
    const first = new Date(sorted[0])
    if (!Number.isNaN(first.getTime())) return new Date(first.getFullYear(), first.getMonth(), 1)
  }
  if (metadata) {
    try {
      const periodes = extractPeriodes(metadata)
      const tournageRanges = periodes?.tournage?.ranges || []
      if (tournageRanges.length > 0) {
        const d = new Date(tournageRanges[0].start)
        if (!Number.isNaN(d.getTime())) return new Date(d.getFullYear(), d.getMonth(), 1)
      }
    } catch {
      // fallback below
    }
  }
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function buildMonthGrid(displayMonth) {
  // Cells = 6 weeks × 7 days, démarrant au lundi de la semaine du 1er.
  const year = displayMonth.getFullYear()
  const month = displayMonth.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  // 0=dim, 1=lun … on veut commencer un lundi.
  const wd = (firstOfMonth.getDay() + 6) % 7 // 0=lun, 6=dim
  const start = new Date(year, month, 1 - wd)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const iso = toIso(d)
    cells.push({
      iso,
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    })
  }
  return cells
}

function toIso(d) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function expandRange(startIso, endIso) {
  if (!startIso) return []
  const start = new Date(startIso)
  const end = endIso ? new Date(endIso) : start
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []
  const out = []
  const cur = new Date(start)
  while (cur <= end) {
    out.push(toIso(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

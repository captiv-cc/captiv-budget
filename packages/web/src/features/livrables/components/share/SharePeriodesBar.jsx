// ════════════════════════════════════════════════════════════════════════════
// SharePeriodesBar — Bandeau périodes projet sur la page de partage (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Affiche en lecture seule les périodes saisies dans ProjetTab :
// prépa, tournage, envoi V1, livraison master, deadline.
//
// Pattern visuel proche de PeriodesRecapWidget (admin), mais en Tailwind
// pur (couleurs hex inline) pour ne pas dépendre des CSS vars du thème
// dark de l'app.
//
// Props :
//   - periodes : { prepa, tournage, envoi_v1, livraison_master, deadline }
//                où chaque valeur est { ranges: [{ start, end }] }
// ════════════════════════════════════════════════════════════════════════════

import { Calendar } from 'lucide-react'

// Méta des périodes : ordre, label, couleurs en CSS vars de l'app pour
// suivre automatiquement le thème dark/light.
const PERIODE_META = [
  { key: 'prepa',             label: 'Préparation',      color: 'var(--blue)',   bg: 'var(--blue-bg)' },
  { key: 'tournage',          label: 'Tournage',         color: 'var(--green)',  bg: 'var(--green-bg)' },
  { key: 'envoi_v1',          label: 'Envoi V1',         color: 'var(--purple)', bg: 'var(--purple-bg)' },
  { key: 'livraison_master',  label: 'Livraison master', color: 'var(--orange)', bg: 'var(--orange-bg)' },
  { key: 'deadline',          label: 'Deadline',         color: 'var(--red)',    bg: 'var(--red-bg)' },
]

export default function SharePeriodesBar({ periodes }) {
  if (!periodes || typeof periodes !== 'object') return null

  // Filtre uniquement les périodes qui ont un range valide.
  const filled = PERIODE_META.filter((m) => hasAnyRange(periodes[m.key]))
  if (filled.length === 0) return null

  return (
    <section
      className="rounded-2xl shadow-sm p-5 sm:p-6"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
        <h2
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          Calendrier projet
        </h2>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filled.map((meta) => (
          <PeriodeRow key={meta.key} meta={meta} periode={periodes[meta.key]} />
        ))}
      </div>
    </section>
  )
}

function PeriodeRow({ meta, periode }) {
  const ranges = (periode?.ranges || [])
    .filter((r) => r?.start && r?.end)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
  const days = countDays(periode)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-2)' }}
        >
          {meta.label}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          · {days} jour{days > 1 ? 's' : ''}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {ranges.map((range, idx) => (
          <span
            key={`${range.start}-${range.end}-${idx}`}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
            style={{
              background: meta.bg,
              color: meta.color,
              border: `1px solid ${meta.color}`,
            }}
          >
            <Calendar className="w-3 h-3" />
            {formatRangeFr(range)}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Helpers locaux ────────────────────────────────────────────────────────
// Volontairement dupliqués (pas d'import de projectPeriodes.js) pour rester
// 100% standalone côté page client — la page peut être ouverte hors-app.

function hasAnyRange(periode) {
  return Array.isArray(periode?.ranges) && periode.ranges.some((r) => r?.start && r?.end)
}

function countDays(periode) {
  if (!hasAnyRange(periode)) return 0
  let total = 0
  for (const range of periode.ranges) {
    if (!range?.start || !range?.end) continue
    const s = parseISO(range.start)
    const e = parseISO(range.end)
    if (!s || !e) continue
    total += Math.max(1, Math.round((e - s) / 86400000) + 1)
  }
  return total
}

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function formatRangeFr(range) {
  const sm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(range?.start || ''))
  const em = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(range?.end || ''))
  if (!sm || !em) return ''
  // Même jour → 17/05. Sinon → 12-14/05 (mois identique) ou 28/04-02/05.
  if (sm[0] === em[0]) return `${sm[3]}/${sm[2]}`
  if (sm[1] === em[1] && sm[2] === em[2]) return `${sm[3]}-${em[3]}/${sm[2]}`
  return `${sm[3]}/${sm[2]}-${em[3]}/${em[2]}`
}

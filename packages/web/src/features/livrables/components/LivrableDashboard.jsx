// ════════════════════════════════════════════════════════════════════════════
// LivrableDashboard — Tableau de bord des livrables d'un projet (LIV-25)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue dédiée (3ème toggle à côté de Liste / Pipeline) qui synthétise l'état
// du projet en un coup d'œil pour le chef de projet : KPIs, indicateurs
// qualité, agenda 30j, alertes versions qui traînent.
//
// Pas de migration ni RPC — tout est calculé côté front depuis le state
// existant (useLivrables) en pur React useMemo.
//
// Sections (validées par Hugo) :
//   1. Cartes KPI : Total · En cours · En retard · Livrés
//   2. Indicateurs qualité : % livrés + % validés au 1er coup
//   3. Activité à venir 30j : envois prévus + deadlines triés chronologiquement
//   4. Versions qui traînent : envoyées > 7j sans feedback
//
// Props :
//   - blocks            : Array
//   - livrables         : Array (plat, pour calculs)
//   - versionsByLivrable: Map<id, version[]>
//   - onLivrableClick   : (livrable) => void   (ouvre drawer)
// ════════════════════════════════════════════════════════════════════════════

import { useMemo } from 'react'
import {
  CheckSquare,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Send,
  Target,
  AlertOctagon,
  TrendingUp,
  Inbox,
} from 'lucide-react'

const MS_PER_DAY = 86_400_000
const HORIZON_AGENDA_DAYS = 30
const STUCK_VERSION_DAYS = 7

export default function LivrableDashboard({
  blocks = [],
  livrables = [],
  versionsByLivrable = new Map(),
  onLivrableClick,
}) {
  // ─── Aplatissement des versions pour les calculs ────────────────────────
  const allVersions = useMemo(() => {
    const out = []
    for (const versions of versionsByLivrable.values()) {
      for (const v of versions) out.push(v)
    }
    return out
  }, [versionsByLivrable])

  // ─── Indexes ─────────────────────────────────────────────────────────────
  const livrablesById = useMemo(
    () => new Map(livrables.map((l) => [l.id, l])),
    [livrables],
  )
  const blocksById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  // ─── KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => computeKpis(livrables), [livrables])

  // ─── Indicateurs qualité ─────────────────────────────────────────────────
  const quality = useMemo(
    () => computeQuality(livrables, allVersions),
    [livrables, allVersions],
  )

  // ─── Agenda 30j ──────────────────────────────────────────────────────────
  const upcoming = useMemo(
    () => computeUpcoming(livrables, allVersions, livrablesById),
    [livrables, allVersions, livrablesById],
  )

  // ─── Versions qui traînent ───────────────────────────────────────────────
  const stuckVersions = useMemo(
    () => computeStuckVersions(allVersions, livrablesById),
    [allVersions, livrablesById],
  )

  // Empty state si aucun livrable
  if (livrables.length === 0) {
    return (
      <div className="px-5 py-12 text-center">
        <Inbox className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--txt-3)', opacity: 0.5 }} />
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          Aucun livrable dans ce projet pour l&apos;instant.
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
          Ajoutez un bloc et un livrable pour voir le tableau de bord prendre vie.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <KpiCards kpis={kpis} />
      <QualitySection quality={quality} />
      <UpcomingSection items={upcoming} onLivrableClick={onLivrableClick} blocksById={blocksById} />
      <StuckVersionsSection items={stuckVersions} onLivrableClick={onLivrableClick} blocksById={blocksById} />
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Cartes KPI
// ════════════════════════════════════════════════════════════════════════════

function KpiCards({ kpis }) {
  const cards = [
    {
      key: 'total',
      label: 'Total',
      value: kpis.total,
      icon: CheckSquare,
      color: 'var(--txt-2)',
      bg: 'var(--bg-2)',
    },
    {
      key: 'en_cours',
      label: 'En cours',
      value: kpis.enCours,
      icon: Clock,
      color: 'var(--blue)',
      bg: 'var(--blue-bg)',
    },
    {
      key: 'retard',
      label: 'En retard',
      value: kpis.enRetard,
      icon: AlertTriangle,
      color: 'var(--red)',
      bg: 'var(--red-bg)',
      emphasize: kpis.enRetard > 0,
    },
    {
      key: 'livres',
      label: 'Livrés',
      value: kpis.livres,
      icon: CheckCircle2,
      color: 'var(--green)',
      bg: 'var(--green-bg)',
    },
  ]

  return (
    <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
      {cards.map((c) => (
        <KpiCard key={c.key} card={c} />
      ))}
    </section>
  )
}

function KpiCard({ card }) {
  const Icon = card.icon
  return (
    <div
      className="flex flex-col items-start gap-2 p-4 rounded-xl"
      style={{
        background: 'var(--bg-surf)',
        border: card.emphasize ? `1px solid ${card.color}` : '1px solid var(--brd)',
      }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex items-center justify-center w-8 h-8 rounded-lg"
          style={{ background: card.bg }}
        >
          <Icon className="w-4 h-4" style={{ color: card.color }} />
        </span>
        <span
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          {card.label}
        </span>
      </div>
      <div
        className="text-3xl sm:text-4xl font-bold tabular-nums leading-none"
        style={{ color: card.emphasize ? card.color : 'var(--txt)' }}
      >
        {card.value}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Indicateurs qualité (barres de progression)
// ════════════════════════════════════════════════════════════════════════════

function QualitySection({ quality }) {
  const indicators = [
    {
      key: 'livres',
      label: 'Livrés',
      hint: `${quality.livres} sur ${quality.total} livrables`,
      ratio: quality.total > 0 ? quality.livres / quality.total : 0,
      color: 'var(--green)',
      bg: 'var(--green-bg)',
    },
    {
      key: 'first_pass',
      label: 'Validés du premier coup',
      hint:
        quality.totalAvecValide > 0
          ? `${quality.firstPass} sur ${quality.totalAvecValide} validés`
          : 'Aucun livrable validé pour l\u2019instant',
      ratio:
        quality.totalAvecValide > 0 ? quality.firstPass / quality.totalAvecValide : 0,
      color: 'var(--blue)',
      bg: 'var(--blue-bg)',
    },
  ]

  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
        <h2
          className="text-[11px] uppercase tracking-wider font-semibold"
          style={{ color: 'var(--txt-3)' }}
        >
          Indicateurs qualité
        </h2>
      </div>
      <div className="space-y-4">
        {indicators.map((ind) => (
          <ProgressBar key={ind.key} indicator={ind} />
        ))}
      </div>
    </section>
  )
}

function ProgressBar({ indicator }) {
  const pct = Math.round(indicator.ratio * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-medium" style={{ color: 'var(--txt)' }}>
          {indicator.label}
        </span>
        <span
          className="text-sm font-bold tabular-nums"
          style={{ color: indicator.color }}
        >
          {pct} %
        </span>
      </div>
      <div
        className="h-2 rounded-full overflow-hidden"
        style={{ background: 'var(--bg-elev)' }}
      >
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: indicator.color }}
        />
      </div>
      <p className="mt-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
        {indicator.hint}
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Activité à venir 30j
// ════════════════════════════════════════════════════════════════════════════

function UpcomingSection({ items, onLivrableClick, blocksById }) {
  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
        <h2
          className="text-[11px] uppercase tracking-wider font-semibold flex-1"
          style={{ color: 'var(--txt-3)' }}
        >
          À venir · 30 jours
        </h2>
        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {items.length} jalon{items.length > 1 ? 's' : ''}
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs italic py-3" style={{ color: 'var(--txt-3)' }}>
          Aucun jalon planifié dans les 30 prochains jours.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item) => (
            <UpcomingRow
              key={item.id}
              item={item}
              onLivrableClick={onLivrableClick}
              blocksById={blocksById}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

function UpcomingRow({ item, onLivrableClick, blocksById }) {
  const isEnvoi = item.type === 'envoi'
  const Icon = isEnvoi ? Send : Target
  const color = isEnvoi ? 'var(--purple)' : 'var(--orange)'
  const livrable = item.livrable
  const block = livrable ? blocksById.get(livrable.block_id) : null
  const numero = livrableFullNumero(livrable, block)

  const label = isEnvoi
    ? `Envoi ${item.version.numero_label}`
    : 'Livraison master'

  const isClickable = Boolean(livrable && onLivrableClick)
  const handleClick = () => {
    if (isClickable) onLivrableClick(livrable)
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={!isClickable}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors"
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
        onMouseEnter={(e) => {
          if (isClickable) e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <span
          className="flex items-center justify-center w-7 h-7 rounded-full shrink-0"
          style={{ background: 'var(--bg-elev)', border: `1.5px solid ${color}` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            <span style={{ color }}>{label}</span>
            <span className="mx-1.5" aria-hidden="true">·</span>
            {numero && (
              <span className="font-mono text-xs" style={{ color: 'var(--txt-3)' }}>
                {numero}{' '}
              </span>
            )}
            <span>{livrable?.nom || 'Sans titre'}</span>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div
            className="text-sm font-semibold tabular-nums"
            style={{ color: 'var(--txt)' }}
          >
            {formatDateFR(item.dateIso)}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {formatRelativeFutureFR(item.dayOffset)}
          </div>
        </div>
      </button>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Versions qui traînent
// ════════════════════════════════════════════════════════════════════════════

function StuckVersionsSection({ items, onLivrableClick, blocksById }) {
  if (items.length === 0) return null
  return (
    <section
      className="rounded-xl p-4 sm:p-5"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--red-brd, var(--red))',
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <AlertOctagon className="w-4 h-4" style={{ color: 'var(--red)' }} />
        <h2
          className="text-[11px] uppercase tracking-wider font-semibold flex-1"
          style={{ color: 'var(--red)' }}
        >
          Versions sans retour · &gt; 7 jours
        </h2>
        <span
          className="text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded"
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
        >
          {items.length}
        </span>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--txt-2)' }}>
        Ces versions ont été envoyées au client mais n&apos;ont pas reçu de retour
        depuis plus de 7 jours. Pensez à relancer.
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <StuckRow
            key={item.version.id}
            item={item}
            onLivrableClick={onLivrableClick}
            blocksById={blocksById}
          />
        ))}
      </ul>
    </section>
  )
}

function StuckRow({ item, onLivrableClick, blocksById }) {
  const livrable = item.livrable
  const block = livrable ? blocksById.get(livrable.block_id) : null
  const numero = livrableFullNumero(livrable, block)

  const isClickable = Boolean(livrable && onLivrableClick)
  const handleClick = () => {
    if (isClickable) onLivrableClick(livrable)
  }

  return (
    <li>
      <button
        type="button"
        onClick={handleClick}
        disabled={!isClickable}
        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors"
        style={{ cursor: isClickable ? 'pointer' : 'default' }}
        onMouseEnter={(e) => {
          if (isClickable) e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <span
          className="font-mono text-xs font-bold shrink-0 px-2 py-0.5 rounded"
          style={{ background: 'var(--red-bg)', color: 'var(--red)' }}
        >
          {item.version.numero_label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            {numero && (
              <span className="font-mono text-xs mr-1.5" style={{ color: 'var(--txt-3)' }}>
                {numero}
              </span>
            )}
            {livrable?.nom || 'Sans titre'}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Envoyée le {formatDateFR(item.version.date_envoi)} ·{' '}
            <span style={{ color: 'var(--red)', fontWeight: 600 }}>
              il y a {item.daysSince} jour{item.daysSince > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </button>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Calculs purs
// ════════════════════════════════════════════════════════════════════════════

function computeKpis(livrables) {
  const today = todayMidnight()
  let total = 0, enCours = 0, enRetard = 0, livres = 0
  for (const l of livrables) {
    if (l.deleted_at) continue
    total++
    if (l.statut === 'en_cours' || l.statut === 'a_valider') enCours++
    if (l.statut === 'livre') livres++
    if (l.date_livraison && l.statut !== 'livre' && l.statut !== 'archive') {
      const d = parseISO(l.date_livraison)
      if (d != null && d < today) enRetard++
    }
  }
  return { total, enCours, enRetard, livres }
}

function computeQuality(livrables, allVersions) {
  const total = livrables.filter((l) => !l.deleted_at).length
  const livres = livrables.filter((l) => !l.deleted_at && l.statut === 'livre').length

  // % validés du 1er coup : pour chaque livrable ayant au moins une version
  // validée, vérifier si la PREMIÈRE version envoyée (sort_order croissant
  // ou date_envoi croissante) est `valide`.
  const versionsByLivrable = new Map()
  for (const v of allVersions) {
    if (!versionsByLivrable.has(v.livrable_id)) versionsByLivrable.set(v.livrable_id, [])
    versionsByLivrable.get(v.livrable_id).push(v)
  }
  let totalAvecValide = 0
  let firstPass = 0
  for (const versions of versionsByLivrable.values()) {
    const hasValide = versions.some((v) => v.statut_validation === 'valide')
    if (!hasValide) continue
    totalAvecValide++
    // Première version envoyée par sort_order, fallback date_envoi.
    const envoyees = versions
      .filter((v) => v.date_envoi)
      .sort((a, b) => {
        if (a.sort_order !== b.sort_order) return (a.sort_order || 0) - (b.sort_order || 0)
        return String(a.date_envoi || '').localeCompare(String(b.date_envoi || ''))
      })
    if (envoyees.length === 0) continue
    if (envoyees[0].statut_validation === 'valide') firstPass++
  }

  return { total, livres, totalAvecValide, firstPass }
}

function computeUpcoming(livrables, allVersions, livrablesById) {
  const today = todayMidnight()
  const horizon = today + HORIZON_AGENDA_DAYS * MS_PER_DAY
  const items = []

  // Envois prévus non envoyés
  for (const v of allVersions) {
    if (v.date_envoi) continue // déjà envoyé
    if (!v.date_envoi_prevu) continue
    const d = parseISO(v.date_envoi_prevu)
    if (d == null || d < today || d > horizon) continue
    const livrable = livrablesById.get(v.livrable_id)
    if (!livrable || livrable.deleted_at) continue
    items.push({
      id: `env-${v.id}`,
      type: 'envoi',
      dateMs: d,
      dateIso: v.date_envoi_prevu,
      dayOffset: Math.round((d - today) / MS_PER_DAY),
      version: v,
      livrable,
    })
  }

  // Deadlines livraison master non livrées
  for (const l of livrables) {
    if (l.deleted_at) continue
    if (l.statut === 'livre' || l.statut === 'archive') continue
    if (!l.date_livraison) continue
    const d = parseISO(l.date_livraison)
    if (d == null || d < today || d > horizon) continue
    items.push({
      id: `dl-${l.id}`,
      type: 'deadline',
      dateMs: d,
      dateIso: l.date_livraison,
      dayOffset: Math.round((d - today) / MS_PER_DAY),
      livrable: l,
    })
  }

  items.sort((a, b) => a.dateMs - b.dateMs)
  return items
}

function computeStuckVersions(allVersions, livrablesById) {
  const today = Date.now()
  const threshold = today - STUCK_VERSION_DAYS * MS_PER_DAY
  const items = []
  for (const v of allVersions) {
    if (!v.date_envoi) continue
    if (v.statut_validation !== 'en_attente') continue
    const sentMs = parseISO(v.date_envoi)
    if (sentMs == null) continue
    if (sentMs > threshold) continue
    const livrable = livrablesById.get(v.livrable_id)
    if (!livrable || livrable.deleted_at) continue
    if (livrable.statut === 'archive') continue
    const daysSince = Math.floor((today - sentMs) / MS_PER_DAY)
    items.push({ version: v, livrable, daysSince })
  }
  // Trie par "depuis le plus longtemps en attente"
  items.sort((a, b) => b.daysSince - a.daysSince)
  return items
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function todayMidnight() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
}

function formatDateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

function formatRelativeFutureFR(dayOffset) {
  if (dayOffset === 0) return 'Aujourd\u2019hui'
  if (dayOffset === 1) return 'Demain'
  return `Dans ${dayOffset} jours`
}

function livrableFullNumero(livrable, block) {
  if (!livrable) return ''
  const prefix = (block?.prefixe || '').trim()
  const numero = (livrable.numero || '').trim()
  return prefix && numero && !numero.startsWith(prefix) ? `${prefix}${numero}` : numero
}

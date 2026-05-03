// ════════════════════════════════════════════════════════════════════════════
// EquipePreviewModal — Mode "vue seule" admin (EQUIPE-P4-PREVIEW)
// ════════════════════════════════════════════════════════════════════════════
//
// Modal plein écran qui affiche la Crew list dans le même style que la page
// publique /share/equipe/:token, mais branché sur les données admin locales
// (pas de token, pas de RPC public). Utile pour consulter / projeter la
// crew list sans tomber sur l'UI dense d'édition.
//
// Différences avec la page share publique :
//   - Pas de token, pas de fetch RPC : on lit directement les données
//     déjà chargées (members, project, org, lots).
//   - showSensitive = true forcé (l'admin voit toutes les coordonnées).
//   - Bouton de fermeture + Escape pour sortir du mode preview.
//   - Pas de toggle theme (hérite du thème de l'app).
//
// Pattern : table dense desktop + cards mobile (mêmes seuils que la page
// share). Réutilise les helpers locaux de formatage.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo } from 'react'
import { X, Users, Inbox, Phone, Mail, MapPin } from 'lucide-react'
import useBreakpoint from '../../../hooks/useBreakpoint'
import { groupTechlistByCategory } from '../../../lib/crew'

// Palette identique à la page share + EquipeTab
const LOT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6',
]
function lotColor(lots, lotId) {
  const idx = lots.findIndex((l) => l.id === lotId)
  return LOT_PALETTE[((idx >= 0 ? idx : 0) + LOT_PALETTE.length) % LOT_PALETTE.length]
}

export default function EquipePreviewModal({
  open,
  onClose,
  project,
  org,
  lots = [], // lotsWithRef côté EquipeTab
  members = [], // techlistRows déjà filtrées principales (+ par lot si actif)
  lineLotMap = {}, // { devis_line_id : lotId }
  selectedLotId = null, // string | null — lot actif sur l'EquipeTab
  // EQUIPE-P4-CATEGORIES : ordre custom des catégories (drag & drop côté
  // Crew list). Si fourni, on respecte cet ordre dans les sections de la
  // vue ; sinon fallback DEFAULT_CATEGORIES.
  categoryOrder = [],
}) {
  // Escape pour fermer
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ── Données dérivées ────────────────────────────────────────────────
  const lotInfoMap = useMemo(() => {
    const map = {}
    for (const l of lots) map[l.id] = { title: l.title, color: lotColor(lots, l.id) }
    return map
  }, [lots])

  // Plage de jours de présence (union → plage continue, comme la share page)
  const presenceDays = useMemo(() => {
    const set = new Set()
    for (const m of members) {
      for (const d of m.presence_days || []) {
        if (typeof d === 'string') set.add(d)
      }
    }
    if (set.size === 0) return []
    const sorted = [...set].sort()
    const parse = (iso) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
      return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
    }
    const fmt = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const start = parse(sorted[0])
    const end = parse(sorted[sorted.length - 1])
    if (!start || !end) return sorted
    const out = []
    for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
      out.push(fmt(new Date(t)))
    }
    return out
  }, [members])

  const sections = useMemo(
    () => groupTechlistByCategory(members, categoryOrder),
    [members, categoryOrder],
  )
  const totalPersonae = useMemo(
    () => new Set(members.map((m) => m.contact?.id || m.id)).size,
    [members],
  )

  // Quand un lot est sélectionné côté EquipeTab, on n'affiche pas la
  // pastille de lot (toutes les rows visibles ont le même → redondant) et
  // on cache le bandeau Lots. Le scope est rappelé dans le header.
  const showLotDot = lots.length > 1 && !selectedLotId
  const showLotsBanner = lots.length > 1 && !selectedLotId
  const scopedLot = selectedLotId
    ? lots.find((l) => l.id === selectedLotId)
    : null
  const scopedLotColor = scopedLot ? lotInfoMap[scopedLot.id]?.color : null
  const brandColor = org?.brand_color || '#3B82F6'
  const projectName = project?.title || project?.name || project?.titre || 'Projet'
  const projectRef = project?.ref_projet || ''

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'var(--bg)' }}
      role="dialog"
      aria-label="Vue seule — Crew list"
    >
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header
        className="flex items-center justify-between gap-3 px-5 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--brd-sub)', background: 'var(--bg-surf)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'var(--purple-bg)' }}
          >
            <Users className="w-4 h-4" style={{ color: 'var(--purple)' }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold truncate" style={{ color: 'var(--txt)' }}>
                Crew list
              </h1>
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-3)',
                  border: '1px solid var(--brd-sub)',
                }}
              >
                Vue seule
              </span>
              {/* Si un lot est filtré côté EquipeTab, on rappelle le scope
                  dans le header avec la couleur du lot. */}
              {scopedLot && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1 font-semibold"
                  style={{
                    background: 'var(--bg-elev)',
                    color: scopedLotColor || 'var(--txt-2)',
                    border: `1px solid ${scopedLotColor || 'var(--brd)'}`,
                  }}
                  title={`Filtré sur le lot ${scopedLot.title}`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: scopedLotColor || 'var(--txt-2)' }}
                  />
                  Lot · {scopedLot.title}
                </span>
              )}
            </div>
            <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              {projectName}
              {projectRef && (
                <span className="ml-2 font-mono" style={{ opacity: 0.7 }}>
                  {projectRef}
                </span>
              )}
              {' · '}
              {totalPersonae} personne{totalPersonae > 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-md transition-colors shrink-0"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hov)'
            e.currentTarget.style.color = 'var(--txt)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--txt-3)'
          }}
          title="Fermer (Esc)"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* ─── Body ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
          {/* Bandeau lots — multi-lot ET scope "Tous" uniquement (sinon
              redondant avec le tag scope dans le header). */}
          {showLotsBanner && (
            <div className="mb-4">
              <LotsBanner lots={lots} lotInfoMap={lotInfoMap} />
            </div>
          )}

          {sections.length === 0 ? (
            <div
              className="rounded-xl p-12 text-center"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
            >
              <Users
                className="w-10 h-10 mx-auto mb-3"
                style={{ color: 'var(--txt-3)', opacity: 0.4 }}
              />
              <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                Aucune attribution.
              </p>
            </div>
          ) : (
            <ResponsiveContent
              sections={sections}
              showLotDot={showLotDot}
              presenceDays={presenceDays}
              lotInfoMap={lotInfoMap}
              lineLotMap={lineLotMap}
              brandColor={brandColor}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Bandeau lots ──────────────────────────────────────────────────────────

function LotsBanner({ lots, lotInfoMap }) {
  return (
    <div
      className="flex items-center gap-3 flex-wrap rounded-md px-3 py-2"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <span
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: 'var(--txt-3)' }}
      >
        Lots
      </span>
      {lots.map((l) => {
        const color = lotInfoMap[l.id]?.color || 'var(--txt-3)'
        return (
          <span
            key={l.id}
            className="inline-flex items-center gap-1.5 text-xs"
            style={{ color }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ background: color }}
            />
            <strong>{l.title}</strong>
          </span>
        )
      })}
    </div>
  )
}

// ─── Switch desktop/mobile ────────────────────────────────────────────────

function ResponsiveContent(props) {
  const bp = useBreakpoint()
  if (bp.isMobile) return <CardsList {...props} />
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      <Table {...props} />
    </div>
  )
}

// ─── Table desktop ────────────────────────────────────────────────────────

function Table({ sections, showLotDot, presenceDays, lotInfoMap, lineLotMap, brandColor }) {
  const nbDays = presenceDays.length
  const isLightBrand = isLightColor(brandColor)
  const brandTextColor = isLightBrand ? '#0F172A' : '#FFFFFF'

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              background: 'var(--bg-elev)',
              borderBottom: '1px solid var(--brd-sub)',
            }}
          >
            {showLotDot && <Th width="22px" />}
            <Th>Poste</Th>
            <Th>Personne</Th>
            <Th>Téléphone</Th>
            <Th>Email</Th>
            <Th>Secteur</Th>
            {nbDays > 0 && (
              <th
                colSpan={nbDays}
                className="px-1.5 py-2 text-[10px] font-bold uppercase tracking-wider text-center"
                style={{ color: 'var(--txt-2)' }}
              >
                Présence
              </th>
            )}
          </tr>
          {nbDays > 0 && (
            <tr
              style={{
                background: 'var(--bg-elev)',
                borderBottom: '1px solid var(--brd-sub)',
              }}
            >
              {showLotDot && <th />}
              <th />
              <th />
              <th />
              <th />
              <th />
              {presenceDays.map((iso) => (
                <th
                  key={iso}
                  className="px-1 py-1 text-center align-middle"
                  style={{
                    minWidth: 28,
                    color: 'var(--txt-3)',
                    borderLeft: '1px solid var(--brd-sub)',
                  }}
                >
                  <div className="text-[10px] font-bold leading-none">{dayLetter(iso)}</div>
                  <div className="text-[8px] leading-none mt-0.5" style={{ opacity: 0.7 }}>
                    {formatDayMonth(iso)}
                  </div>
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              showLotDot={showLotDot}
              presenceDays={presenceDays}
              lotInfoMap={lotInfoMap}
              lineLotMap={lineLotMap}
              brandColor={brandColor}
              brandTextColor={brandTextColor}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({ section, showLotDot, presenceDays, lotInfoMap, lineLotMap, brandColor, brandTextColor }) {
  const isATrier = section.key === '__a_trier__'
  const totalCols = (showLotDot ? 1 : 0) + 5 + (presenceDays.length || 0)
  return (
    <>
      <tr>
        <td
          colSpan={totalCols}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
          style={{
            background: isATrier ? 'rgba(254,243,199,1)' : brandColor,
            color: isATrier ? '#92400E' : brandTextColor,
          }}
        >
          {isATrier ? (
            <span className="inline-flex items-center gap-1.5">
              <Inbox className="w-3 h-3" />
              À TRIER
            </span>
          ) : (
            section.label
          )}
          <span
            className="ml-2 font-normal"
            style={{ opacity: 0.85, color: isATrier ? '#92400E' : brandTextColor }}
          >
            ·  {section.rows.length} poste{section.rows.length > 1 ? 's' : ''}
          </span>
        </td>
      </tr>
      {section.rows.map((m, i) => (
        <Row
          key={m.id}
          m={m}
          zebra={i % 2 === 1}
          showLotDot={showLotDot}
          presenceDays={presenceDays}
          lotInfoMap={lotInfoMap}
          lineLotMap={lineLotMap}
        />
      ))}
    </>
  )
}

function Row({ m, zebra, showLotDot, presenceDays, lotInfoMap, lineLotMap }) {
  const poste = m.devis_line?.produit || m.specialite || m.contact?.specialite || '—'
  const fullName = `${m.prenom || m.contact?.prenom || ''} ${m.nom || m.contact?.nom || ''}`.trim() || '—'
  const tel = formatPhone(m.contact?.telephone || m.telephone || '')
  const email = m.contact?.email || m.email || ''
  const secteur = m.secteur || m.contact?.ville || ''
  const lotId = resolveLotId(m, lineLotMap)
  const lotInfo = lotId ? lotInfoMap[lotId] : null
  const presenceSet = new Set(m.presence_days || [])

  return (
    <tr
      style={{
        background: zebra ? 'var(--bg-elev)' : 'transparent',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      {showLotDot && (
        <td className="px-2 align-middle text-center">
          {lotInfo && (
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: lotInfo.color }}
              title={`Lot · ${lotInfo.title}`}
            />
          )}
        </td>
      )}
      <td className="px-3 py-2 font-semibold align-middle" style={{ color: 'var(--txt)' }}>
        {poste}
      </td>
      <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt)' }}>
        {fullName}
      </td>
      <td className="px-3 py-2 align-middle whitespace-nowrap" style={{ color: 'var(--txt)' }}>
        {tel || <span style={{ color: 'var(--txt-3)' }}>—</span>}
      </td>
      <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt)' }}>
        {email || <span style={{ color: 'var(--txt-3)' }}>—</span>}
      </td>
      <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt-2)' }}>
        {secteur || <span style={{ color: 'var(--txt-3)' }}>—</span>}
      </td>
      {presenceDays.map((iso) => {
        const present = presenceSet.has(iso)
        return (
          <td
            key={iso}
            className="px-1 py-2 text-center align-middle"
            style={{
              borderLeft: '1px solid var(--brd-sub)',
              background: present ? 'rgba(34,197,94,0.18)' : undefined,
              color: present ? 'rgb(22,101,52)' : 'var(--txt-3)',
              fontWeight: present ? 700 : 400,
              fontSize: 11,
            }}
          >
            {present ? 'X' : ''}
          </td>
        )
      })}
    </tr>
  )
}

// ─── Cards mobile ──────────────────────────────────────────────────────────

function CardsList({ sections, showLotDot, presenceDays, lotInfoMap, lineLotMap, brandColor }) {
  const isLightBrand = isLightColor(brandColor)
  const brandTextColor = isLightBrand ? '#0F172A' : '#FFFFFF'
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <CardSection
          key={section.key}
          section={section}
          showLotDot={showLotDot}
          presenceDays={presenceDays}
          lotInfoMap={lotInfoMap}
          lineLotMap={lineLotMap}
          brandColor={brandColor}
          brandTextColor={brandTextColor}
        />
      ))}
    </div>
  )
}

function CardSection({
  section,
  showLotDot,
  presenceDays,
  lotInfoMap,
  lineLotMap,
  brandColor,
  brandTextColor,
}) {
  const isATrier = section.key === '__a_trier__'
  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <header
        className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5"
        style={{
          background: isATrier ? 'rgba(254,243,199,1)' : brandColor,
          color: isATrier ? '#92400E' : brandTextColor,
        }}
      >
        {isATrier && <Inbox className="w-3 h-3" />}
        <span>{isATrier ? 'À TRIER' : section.label}</span>
        <span className="font-normal" style={{ opacity: 0.85 }}>
          ·  {section.rows.length} poste{section.rows.length > 1 ? 's' : ''}
        </span>
      </header>
      <ul className="divide-y" style={{ borderColor: 'var(--brd-sub)' }}>
        {section.rows.map((m) => (
          <Card
            key={m.id}
            m={m}
            showLotDot={showLotDot}
            presenceDays={presenceDays}
            lotInfoMap={lotInfoMap}
            lineLotMap={lineLotMap}
          />
        ))}
      </ul>
    </section>
  )
}

function Card({ m, showLotDot, presenceDays, lotInfoMap, lineLotMap }) {
  const poste = m.devis_line?.produit || m.specialite || m.contact?.specialite || '—'
  const fullName =
    `${m.prenom || m.contact?.prenom || ''} ${m.nom || m.contact?.nom || ''}`.trim() || '—'
  const tel = formatPhone(m.contact?.telephone || m.telephone || '')
  const email = m.contact?.email || m.email || ''
  const secteur = m.secteur || m.contact?.ville || ''
  const lotId = resolveLotId(m, lineLotMap)
  const lotInfo = lotId ? lotInfoMap[lotId] : null
  const presenceSet = new Set(m.presence_days || [])

  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2">
        {showLotDot && lotInfo && (
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: lotInfo.color }}
            title={`Lot · ${lotInfo.title}`}
          />
        )}
        <strong className="text-sm truncate" style={{ color: 'var(--txt)' }}>
          {poste}
        </strong>
      </div>
      <div className="text-sm truncate mt-0.5" style={{ color: 'var(--txt-2)' }}>
        {fullName}
      </div>
      {(tel || email || secteur) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] min-w-0">
          {tel && (
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--txt)' }}>
              <Phone className="w-3 h-3" />
              {tel}
            </span>
          )}
          {email && (
            <span
              className="inline-flex items-center gap-1 truncate max-w-full"
              style={{ color: 'var(--txt)' }}
            >
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{email}</span>
            </span>
          )}
          {secteur && (
            <span className="inline-flex items-center gap-1" style={{ color: 'var(--txt-3)' }}>
              <MapPin className="w-3 h-3" />
              {secteur}
            </span>
          )}
        </div>
      )}
      {presenceDays.length > 0 && (
        <div className="mt-2 -mx-0.5 overflow-x-auto">
          <div
            className="inline-grid gap-px"
            style={{
              gridTemplateColumns: `repeat(${presenceDays.length}, minmax(26px, 1fr))`,
              minWidth: '100%',
            }}
          >
            {presenceDays.map((iso) => {
              const present = presenceSet.has(iso)
              return (
                <div
                  key={iso}
                  className="flex flex-col items-center py-1 rounded-sm"
                  style={{
                    background: present ? 'rgba(34,197,94,0.10)' : 'transparent',
                    color: present ? 'rgb(34,150,75)' : 'var(--txt-3)',
                    opacity: present ? 1 : 0.55,
                  }}
                >
                  <span className="text-[9px] leading-none font-semibold">
                    {dayLetter(iso)}
                  </span>
                  <span
                    className="text-[8px] leading-none mt-0.5"
                    style={{ opacity: 0.75 }}
                  >
                    {formatDayMonth(iso)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </li>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function Th({ children, width = null }) {
  return (
    <th
      className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: 'var(--txt-2)',
        ...(width ? { width } : {}),
      }}
    >
      {children}
    </th>
  )
}

// Résout le lot d'une row (priorité devis_line → fallback lot_id direct)
function resolveLotId(row, lineLotMap) {
  if (row.devis_line_id) return lineLotMap?.[row.devis_line_id] || null
  return row.lot_id || null
}

function dayLetter(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return '?'
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return ['D', 'L', 'M', 'M', 'J', 'V', 'S'][d.getDay()] || '?'
}

function formatDayMonth(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return ''
  return `${m[3]}/${m[2]}`
}

function formatPhone(phone) {
  if (!phone) return ''
  const raw = String(phone).trim()
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10 && digits[0] === '0') {
    return digits.match(/.{2}/g).join(' ')
  }
  if (digits.length === 11 && digits.startsWith('33')) {
    const local = digits.slice(2)
    return '+33 ' + local[0] + ' ' + local.slice(1).match(/.{2}/g).join(' ')
  }
  return raw
}

function isLightColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim())
  if (!m) return false
  const v = m[1]
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160
}

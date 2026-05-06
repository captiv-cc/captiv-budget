// ════════════════════════════════════════════════════════════════════════════
// EquipeShareSession — Page publique /share/equipe/:token (EQUIPE-P4.2D)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY de la techlist d'un projet, partagée à un destinataire
// externe via un lien public. Aucune authentification requise.
//
// Sécurité : la RPC share_equipe_fetch (SECURITY DEFINER) filtre les données
// côté serveur — pas de champs financiers (cout_estime, budget_convenu),
// pas de movinmotion_statut, coords gated par show_sensitive.
//
// Layout : on calque visuellement le PDF (mêmes colonnes, mêmes sections,
// mêmes couleurs lot). Toggle light/dark + responsive mobile.
//
// Pattern aligné sur LivrableShareSession.jsx (LIV-24C).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Check, Loader2, Users, Inbox, Phone, Mail, MapPin } from 'lucide-react'
import { useEquipeShareSession } from '../hooks/useEquipeShareSession'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'
import { groupTechlistByCategory, computePresenceColumns } from '../lib/crew'
import PresencePlaneIcons from '../features/equipe/components/PresencePlaneIcons'
// Sessions Phase A : helpers purs pour calculer la légende et la couleur
// active par jour, identiques à ceux utilisés dans EquipePreviewModal
// (= cohérence visuelle entre vue interne et vue partagée).
import {
  effectiveCouleur,
  effectiveLabel,
  getActiveSessionForDay,
  groupSessionsByMembre,
  paletteAt,
  firstDateOfSession,
} from '../lib/sessions'

// Palette identique à EquipeTab/PDF pour les badges de lot.
const LOT_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6',
]
function lotColor(lots, lotId) {
  const idx = lots.findIndex((l) => l.id === lotId)
  return LOT_PALETTE[((idx >= 0 ? idx : 0) + LOT_PALETTE.length) % LOT_PALETTE.length]
}

const THEME_STORAGE_KEY = 'equipe-share-theme'

export default function EquipeShareSession() {
  const { token } = useParams()
  const { payload, loading, error } = useEquipeShareSession(token)

  // Toggle light/dark — default DARK (cohérent avec l'app + décision Hugo).
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.dataset.checkTheme = 'light'
    } else {
      delete root.dataset.checkTheme
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (loading) {
    return (
      <FullScreenStatus icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}>
        Chargement…
      </FullScreenStatus>
    )
  }
  if (error || !payload) {
    return <ErrorState error={error} />
  }

  return <ShareContent payload={payload} theme={theme} setTheme={setTheme} />
}

// ─── Contenu principal ──────────────────────────────────────────────────────

function ShareContent({ payload, theme, setTheme }) {
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  // Wrappés en useMemo pour éviter les warnings react-hooks/exhaustive-deps
  // sur les useMemo qui dépendent de ces tableaux (sinon nouvelle référence
  // à chaque render → recalcul inutile).
  const lots = useMemo(() => payload.lots || [], [payload.lots])
  const membres = useMemo(() => payload.membres || [], [payload.membres])
  // Sessions Phase A : flat array depuis la RPC (cf. migration
  // 20260507_share_equipe_include_sessions). Vide pour les vieux
  // payloads pré-Phase A — pas de crash, juste pas de coloring sessions.
  const sessions = useMemo(() => payload.sessions || [], [payload.sessions])
  // EQUIPE-P4-CATEGORIES : ordre custom des catégories tel que défini par
  // l'admin sur la Crew list. La RPC le retourne au top-level du payload
  // (extrait de projects.metadata.equipe.category_order). Tableau vide =
  // retombée sur l'ordre par défaut (À TRIER → DEFAULT_CATEGORIES → custom).
  const categoryOrder = useMemo(
    () => (Array.isArray(payload.category_order) ? payload.category_order : []),
    [payload.category_order],
  )
  const showSensitive = share.show_sensitive !== false
  const scope = share.scope || 'all'
  const scopedLot = scope === 'lot' ? lots.find((l) => l.id === share.lot_id) : null
  const showLotDot = scope === 'all' && lots.length > 1
  const showLotsBanner = showLotDot

  // Brand color (default neutral si non config par admin)
  const brandColor = org?.brand_color || '#3B82F6'

  // Lot info map { lotId: { title, color } }
  const lotInfoMap = useMemo(() => {
    const map = {}
    for (const l of lots) map[l.id] = { title: l.title, color: lotColor(lots, l.id) }
    return map
  }, [lots])

  // Map devis_id → lot.id (via ref_devis_id)
  const devisIdToLotId = useMemo(() => {
    const map = {}
    for (const l of lots) {
      if (l.ref_devis_id) map[l.ref_devis_id] = l.id
    }
    return map
  }, [lots])

  // Plage de jours pour la grille Présence + Set des jours "transit"
  // (= arrivée/retour hors plage tournage). Le helper étend la plage
  // contiguë automatiquement pour absorber les transits qui sortent du
  // shoot, et marque ces jours comme tels pour que la UI les rende
  // discrètement (italique + opacity + pictogramme ✈).
  const { days: presenceDays, transitSet: transitDaysSet } = useMemo(
    () => computePresenceColumns(membres),
    [membres],
  )

  // Partition par catégorie : on respecte l'ordre custom posé par l'admin
  // sur la Crew list (categoryOrder), sinon ordre par défaut.
  const sections = useMemo(
    () => groupTechlistByCategory(membres, categoryOrder),
    [membres, categoryOrder],
  )

  // Sessions Phase A — agrégats pour le rendu :
  // - sessionsByMembre : pour le coloring des cellules X par session
  // - sessionsLegendItems : pour la légende au-dessus du tableau (1 chip
  //   par session distincte du projet, mêmes règles que EquipePreviewModal).
  const sessionsByMembre = useMemo(() => groupSessionsByMembre(sessions), [sessions])
  const sessionsLegendItems = useMemo(() => {
    if (!sessions.length) return []
    const byOrder = new Map()
    for (const s of sessions) {
      const order = Number(s.sort_order) || 1
      if (!byOrder.has(order)) {
        byOrder.set(order, { labels: new Set(), lieux: new Set(), minDate: null })
      }
      const entry = byOrder.get(order)
      const trimLabel = (s.label || '').trim()
      if (trimLabel) entry.labels.add(trimLabel)
      const trimLieu = (s.lieu_principal_text || '').trim()
      if (trimLieu) entry.lieux.add(trimLieu)
      const date = firstDateOfSession(s)
      if (date && (!entry.minDate || date < entry.minDate)) {
        entry.minDate = date
      }
    }
    const items = []
    for (const [order, entry] of byOrder) {
      const labels = [...entry.labels]
      const lieux = [...entry.lieux]
      items.push({
        sortOrder: order,
        color: paletteAt(order),
        label: labels.length === 1 ? labels[0] : null,
        lieu: lieux.length === 1 ? lieux[0] : null,
        minDate: entry.minDate || null,
      })
    }
    items.sort((a, b) => {
      if (!a.minDate && !b.minDate) return a.sortOrder - b.sortOrder
      if (!a.minDate) return 1
      if (!b.minDate) return -1
      return a.minDate.localeCompare(b.minDate)
    })
    return items
  }, [sessions])

  // Stats compactes
  const totalPersonae = useMemo(
    () => new Set(membres.map((m) => m.contact?.id || m.id)).size,
    [membres],
  )

  // Construction des metaItems pour le SharePageHeader (typés).
  const metaItems = []
  if (project.ref_projet) metaItems.push({ type: 'ref', value: project.ref_projet })
  if (scope === 'lot' && scopedLot) {
    const lotColor = lotInfoMap[scopedLot.id]?.color
    metaItems.push({
      type: 'scope',
      value: `Lot · ${scopedLot.title}`,
      color: lotColor,
    })
  }
  if (share.label) metaItems.push({ type: 'label', value: share.label })
  if (payload.generated_at) metaItems.push({ type: 'date', value: payload.generated_at })

  return (
    <div
      className="min-h-screen share-theme-transition"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 sm:py-8 share-fade-in">
        {/* ── Header unifié partagé ──────────────────────────────────────── */}
        <SharePageHeader
          pageTitle="Crew list"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
        />

        {/* ── Bandeau lots (multi-lot + scope='all') ─────────────────────── */}
        {showLotsBanner && (
          <div className="mt-4">
            <LotsBanner lots={lots} lotInfoMap={lotInfoMap} />
          </div>
        )}

        {/* ── Légende sessions (Phase A) ─────────────────────────────────
            Affichée si le projet a au moins 2 sessions distinctes (sinon
            la couleur unique n'a rien à expliquer). Reproduit la légende
            de la modale Vue Seule interne pour cohérence visuelle. */}
        {sessionsLegendItems.length >= 2 && (
          <div className="mt-4">
            <SessionsLegend items={sessionsLegendItems} />
          </div>
        )}

        {/* ── Stats ──────────────────────────────────────────────────────── */}
        <p
          className="text-sm mt-4 mb-3"
          style={{ color: 'var(--txt-3)' }}
        >
          {totalPersonae} personne{totalPersonae > 1 ? 's' : ''}
        </p>

        {/* ── Tableau ────────────────────────────────────────────────────── */}
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
              Aucune attribution dans ce périmètre.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile (< sm) : layout cards compactes */}
            <div className="block sm:hidden">
              <CardsList
                sections={sections}
                showLotDot={showLotDot}
                showSensitive={showSensitive}
                presenceDays={presenceDays}
                transitSet={transitDaysSet}
                lotInfoMap={lotInfoMap}
                devisIdToLotId={devisIdToLotId}
                brandColor={brandColor}
                sessionsByMembre={sessionsByMembre}
              />
            </div>
            {/* Tablette + desktop : tableau dense */}
            <div
              className="hidden sm:block rounded-lg overflow-hidden"
              style={{
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
            >
              <Table
                sections={sections}
                showLotDot={showLotDot}
                showSensitive={showSensitive}
                presenceDays={presenceDays}
                transitSet={transitDaysSet}
                lotInfoMap={lotInfoMap}
                devisIdToLotId={devisIdToLotId}
                brandColor={brandColor}
                sessionsByMembre={sessionsByMembre}
              />
            </div>
          </>
        )}

        {/* ── Footer "Powered by captiv." centré subtil ──────────────────── */}
        <SharePageFooter />
      </div>
    </div>
  )
}

// ─── Bandeau LOTS ───────────────────────────────────────────────────────────

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

// ─── Tableau ────────────────────────────────────────────────────────────────

function Table({
  sections,
  showLotDot,
  showSensitive,
  presenceDays,
  transitSet,
  lotInfoMap,
  devisIdToLotId,
  brandColor,
  sessionsByMembre = null,
}) {
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
            {showSensitive && <Th>Téléphone</Th>}
            {showSensitive && <Th>Email</Th>}
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
              {showSensitive && <th />}
              {showSensitive && <th />}
              <th />
              {presenceDays.map((iso) => {
                const isTransit = transitSet?.has?.(iso) || false
                return (
                  <th
                    key={iso}
                    className="px-1 py-1 text-center align-middle"
                    style={{
                      minWidth: 28,
                      color: 'var(--txt-3)',
                      borderLeft: '1px solid var(--brd-sub)',
                      background: isTransit ? 'rgba(139,92,246,0.05)' : undefined,
                      fontStyle: isTransit ? 'italic' : 'normal',
                      opacity: isTransit ? 0.55 : 1,
                    }}
                    title={isTransit ? 'Jour de transit (hors tournage)' : undefined}
                  >
                    <div className="text-[10px] font-bold leading-none">
                      {dayLetter(iso)}
                    </div>
                    <div
                      className="text-[8px] leading-none mt-0.5"
                      style={{ opacity: 0.7 }}
                    >
                      {formatDayMonth(iso)}
                    </div>
                  </th>
                )
              })}
            </tr>
          )}
        </thead>
        <tbody>
          {sections.map((section) => (
            <Section
              key={section.key}
              section={section}
              showLotDot={showLotDot}
              showSensitive={showSensitive}
              presenceDays={presenceDays}
              lotInfoMap={lotInfoMap}
              devisIdToLotId={devisIdToLotId}
              brandColor={brandColor}
              brandTextColor={brandTextColor}
              sessionsByMembre={sessionsByMembre}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Section({
  section,
  showLotDot,
  showSensitive,
  presenceDays,
  lotInfoMap,
  devisIdToLotId,
  brandColor,
  brandTextColor,
  sessionsByMembre = null,
}) {
  const isATrier = section.key === '__a_trier__'
  const totalCols =
    (showLotDot ? 1 : 0) + 3 + (showSensitive ? 2 : 0) + (presenceDays.length || 0)

  return (
    <>
      <tr>
        <td
          colSpan={totalCols}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider"
          style={{
            background: isATrier ? 'rgba(254,243,199,1)' : brandColor,
            color: isATrier ? '#92400E' : brandTextColor,
            ...(isATrier
              ? {}
              : { border: 'none' }),
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
            style={{
              opacity: 0.85,
              color: isATrier ? '#92400E' : brandTextColor,
            }}
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
          showSensitive={showSensitive}
          presenceDays={presenceDays}
          lotInfoMap={lotInfoMap}
          devisIdToLotId={devisIdToLotId}
          memberSessions={sessionsByMembre?.get?.(m.id) || []}
        />
      ))}
    </>
  )
}

function Row({
  m,
  zebra,
  showLotDot,
  showSensitive,
  presenceDays,
  lotInfoMap,
  devisIdToLotId,
  memberSessions = [],
}) {
  // Sessions Phase A — coloring : si le membre a au moins 1 session,
  // chaque cellule X cochée prend la couleur de la session active du
  // jour. Sinon (legacy / pas de session), couleur verte par défaut.
  const hasSessions = memberSessions.length >= 1
  // Poste résolu (cohérent avec l'admin Crew list / AttributionRow) :
  // 1. m.specialite — override local sur l'attribution (rename par l'admin).
  // 2. m.devis_line.produit — poste original de la ligne de devis.
  // 3. m.contact.specialite — spécialité annuaire (fallback contact ad-hoc).
  // L'override gagne pour que les renames côté Crew list soient propagés
  // dans le partage public.
  const poste =
    m.specialite ||
    m.devis_line?.produit ||
    m.contact?.specialite ||
    '—'
  const fullName = `${m.prenom || ''} ${m.nom || ''}`.trim() || '—'
  const tel = showSensitive ? formatPhone(m.contact?.telephone || m.telephone || '') : ''
  const email = showSensitive ? (m.contact?.email || m.email || '') : ''
  const secteur = m.secteur || m.contact?.ville || ''
  // EQUIPE-AUDIT-FIX-J : fallback m.lot_id pour les rows ad-hoc (EQUIPE-P4.4
  // — membres rattachés à un lot directement, sans devis_line). Sans ce
  // fallback la pastille de lot disparaissait pour ces rows côté share, alors
  // qu'elle reste visible côté admin (TechListView lotInfoForRow).
  const lotId = m.devis_line?.devis_id
    ? devisIdToLotId[m.devis_line.devis_id]
    : (m.lot_id || null)
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
      {showSensitive && (
        <td className="px-3 py-2 align-middle whitespace-nowrap" style={{ color: 'var(--txt)' }}>
          {tel ? (
            <CopyButton
              value={m.contact?.telephone || m.telephone || ''}
              displayValue={tel}
              ariaLabel={`Copier le numéro ${tel}`}
            />
          ) : (
            <span style={{ color: 'var(--txt-3)' }}>—</span>
          )}
        </td>
      )}
      {showSensitive && (
        <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt)' }}>
          {email ? (
            <CopyButton
              value={email}
              ariaLabel={`Copier l'email ${email}`}
            />
          ) : (
            <span style={{ color: 'var(--txt-3)' }}>—</span>
          )}
        </td>
      )}
      <td className="px-3 py-2 align-middle" style={{ color: 'var(--txt-2)' }}>
        {secteur || <span style={{ color: 'var(--txt-3)' }}>—</span>}
      </td>
      {presenceDays.map((iso) => {
        const present = presenceSet.has(iso)
        // Session active du jour pour ce membre — détermine la couleur
        // de la cellule X. Si aucune session ne couvre le jour (ou pas
        // de sessions du tout), fallback vert classique pour la
        // compatibilité visuelle.
        const activeSession = hasSessions
          ? getActiveSessionForDay(memberSessions, iso)
          : null
        const colorHex = activeSession ? effectiveCouleur(activeSession) : null
        const cellBg = present
          ? colorHex
            ? hexToRgba(colorHex, 0.22)
            : 'rgba(34,197,94,0.18)'
          : undefined
        const cellColor = present
          ? colorHex
            ? `#${colorHex}`
            : 'rgb(22,101,52)'
          : 'var(--txt-3)'
        return (
          <td
            key={iso}
            className="px-1 py-2 text-center align-middle"
            style={{
              position: 'relative',
              borderLeft: '1px solid var(--brd-sub)',
              background: cellBg,
              color: cellColor,
              fontWeight: present ? 700 : 400,
              fontSize: 11,
            }}
            title={
              activeSession
                ? `${effectiveLabel(activeSession)}${
                    activeSession.lieu_principal_text
                      ? ' · ' + activeSession.lieu_principal_text
                      : ''
                  }`
                : undefined
            }
          >
            <PresencePlaneIcons persona={m} iso={iso} />
            {present ? 'X' : ''}
          </td>
        )
      })}
    </tr>
  )
}

// ─── CopyButton — texte cliquable qui copie au lieu d'ouvrir mailto/tel ────
//
// Décision Hugo P4.2 : sur la page share publique, on préfère le copier-coller
// au déclenchement automatique de l'app mail / tel par défaut. Beaucoup de
// destinataires n'ont pas de client mail configuré sur leur poste — copier la
// valeur est plus universel.
//
// Affiche la valeur (avec icône optionnelle), au clic copie dans le presse-
// papiers et flash "Copié ✓" ~1.4s. Le composant rend NULL si pas de valeur.

function CopyButton({ icon, value, displayValue = null, ariaLabel = null, truncate = false }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null

  const text = displayValue || value

  async function handleCopy(e) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Fallback : créer un input invisible, sélectionner, exec copy
      const ta = document.createElement('textarea')
      ta.value = value
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* no-op */ }
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copié ✓' : 'Cliquer pour copier'}
      aria-label={ariaLabel || `Copier ${text}`}
      className="inline-flex items-center gap-1 transition-colors group"
      style={{
        color: copied ? 'var(--green)' : 'var(--txt)',
        cursor: 'pointer',
        background: 'transparent',
        border: 'none',
        padding: 0,
        fontSize: 'inherit',
        fontFamily: 'inherit',
        maxWidth: truncate ? '100%' : undefined,
        minWidth: 0,
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.color = 'var(--blue)'
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.color = 'var(--txt)'
      }}
    >
      {copied ? (
        <Check className="w-3 h-3 shrink-0" />
      ) : icon ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span className={truncate ? 'truncate' : ''}>
        {copied ? 'Copié' : text}
      </span>
    </button>
  )
}

// ─── Cards (mobile) ─────────────────────────────────────────────────────────
//
// Layout vertical compact pour les écrans < sm. Mêmes sections que le tableau
// (À TRIER + catégories), mais chaque ligne devient une card autonome avec
// poste · personne · coords cliquables · secteur · grille présence mini.

function CardsList({
  sections,
  showLotDot,
  showSensitive,
  presenceDays,
  lotInfoMap,
  devisIdToLotId,
  brandColor,
  sessionsByMembre = null,
}) {
  const isLightBrand = isLightColor(brandColor)
  const brandTextColor = isLightBrand ? '#0F172A' : '#FFFFFF'
  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <CardSection
          key={section.key}
          section={section}
          showLotDot={showLotDot}
          showSensitive={showSensitive}
          presenceDays={presenceDays}
          lotInfoMap={lotInfoMap}
          devisIdToLotId={devisIdToLotId}
          brandColor={brandColor}
          brandTextColor={brandTextColor}
          sessionsByMembre={sessionsByMembre}
        />
      ))}
    </div>
  )
}

function CardSection({
  section,
  showLotDot,
  showSensitive,
  presenceDays,
  lotInfoMap,
  devisIdToLotId,
  brandColor,
  brandTextColor,
  sessionsByMembre = null,
}) {
  const isATrier = section.key === '__a_trier__'
  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Bandeau section */}
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

      {/* Cards de la section.
          Pas de `divide-y` ici : sur mobile en dark mode, les fins traits
          1px ressortaient comme des lignes claires sur le fond sombre et
          alourdissaient la lecture (cf. retour Hugo sur la share matos).
          On utilise une légère alternance de fond (zebra striping) alignée
          sur le pattern du tableau desktop (Row zebra). */}
      <ul>
        {section.rows.map((m, i) => (
          <Card
            key={m.id}
            m={m}
            zebra={i % 2 === 1}
            showLotDot={showLotDot}
            showSensitive={showSensitive}
            presenceDays={presenceDays}
            lotInfoMap={lotInfoMap}
            devisIdToLotId={devisIdToLotId}
            memberSessions={sessionsByMembre?.get?.(m.id) || []}
          />
        ))}
      </ul>
    </section>
  )
}

function Card({
  m,
  zebra = false,
  showLotDot,
  showSensitive,
  presenceDays,
  lotInfoMap,
  devisIdToLotId,
  memberSessions = [],
}) {
  const hasSessions = memberSessions.length >= 1
  // Poste résolu (cohérent avec l'admin Crew list / AttributionRow) :
  // 1. m.specialite — override local sur l'attribution (rename par l'admin).
  // 2. m.devis_line.produit — poste original de la ligne de devis.
  // 3. m.contact.specialite — spécialité annuaire (fallback contact ad-hoc).
  // L'override gagne pour que les renames côté Crew list soient propagés
  // dans le partage public.
  const poste =
    m.specialite ||
    m.devis_line?.produit ||
    m.contact?.specialite ||
    '—'
  const fullName = `${m.prenom || ''} ${m.nom || ''}`.trim() || '—'
  const tel = showSensitive
    ? formatPhone(m.contact?.telephone || m.telephone || '')
    : ''
  const telRaw = showSensitive ? (m.contact?.telephone || m.telephone || '') : ''
  const email = showSensitive ? (m.contact?.email || m.email || '') : ''
  const secteur = m.secteur || m.contact?.ville || ''
  // EQUIPE-AUDIT-FIX-J : fallback m.lot_id pour les rows ad-hoc (EQUIPE-P4.4
  // — membres rattachés à un lot directement, sans devis_line). Sans ce
  // fallback la pastille de lot disparaissait pour ces rows côté share, alors
  // qu'elle reste visible côté admin (TechListView lotInfoForRow).
  const lotId = m.devis_line?.devis_id
    ? devisIdToLotId[m.devis_line.devis_id]
    : (m.lot_id || null)
  const lotInfo = lotId ? lotInfoMap[lotId] : null
  const presenceSet = new Set(m.presence_days || [])

  return (
    <li
      className="px-3 py-2.5"
      style={{ background: zebra ? 'var(--bg-elev)' : 'transparent' }}
    >
      {/* Row 1 : lot dot + Poste */}
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

      {/* Row 2 : Personne (légèrement muted) */}
      <div className="text-sm truncate mt-0.5" style={{ color: 'var(--txt-2)' }}>
        {fullName}
      </div>

      {/* Row 3 : Coordonnées + Secteur — inline si possible
          Subtilité Hugo (P4.2) : sur mobile (= ce composant Card), le tap-
          to-call sur le numéro est l'interaction naturelle → on garde
          `tel:`. En revanche pour l'email, beaucoup de mobiles ouvrent
          un client mail rarement utilisé (Gmail web, etc.) → on préfère
          le copier-coller. Sur desktop (Row), tout est en copy. */}
      {(tel || email || secteur) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] min-w-0">
          {tel && (
            <a
              href={`tel:${telRaw}`}
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--blue)' }}
            >
              <Phone className="w-3 h-3" />
              {tel}
            </a>
          )}
          {email && (
            <CopyButton
              icon={<Mail className="w-3 h-3" />}
              value={email}
              ariaLabel={`Copier l'email ${email}`}
              truncate
            />
          )}
          {secteur && (
            <span
              className="inline-flex items-center gap-1"
              style={{ color: 'var(--txt-3)' }}
            >
              <MapPin className="w-3 h-3" />
              {secteur}
            </span>
          )}
        </div>
      )}

      {/* Row 4 : grille présence allégée — jours présents subtilement teintés
          en vert, jours absents totalement transparents (pas de "·" pour
          éviter le bruit visuel). Lecture rapide : l'œil capte uniquement les
          cellules colorées. */}
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
              const activeSession = hasSessions
                ? getActiveSessionForDay(memberSessions, iso)
                : null
              const colorHex = activeSession ? effectiveCouleur(activeSession) : null
              const cellBg = present
                ? colorHex
                  ? hexToRgba(colorHex, 0.16)
                  : 'rgba(34,197,94,0.10)'
                : 'transparent'
              const cellColor = present
                ? colorHex
                  ? `#${colorHex}`
                  : 'rgb(34,150,75)'
                : 'var(--txt-3)'
              return (
                <div
                  key={iso}
                  className="flex flex-col items-center py-1 rounded-sm"
                  style={{
                    position: 'relative',
                    background: cellBg,
                    color: cellColor,
                    opacity: present ? 1 : 0.55,
                  }}
                  title={
                    activeSession
                      ? `${effectiveLabel(activeSession)}${
                          activeSession.lieu_principal_text
                            ? ' · ' + activeSession.lieu_principal_text
                            : ''
                        }`
                      : undefined
                  }
                >
                  <PresencePlaneIcons persona={m} iso={iso} />
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3 p-8"
      style={{ background: 'var(--bg)', color: 'var(--txt-2)' }}
    >
      {icon}
      <p className="text-sm">{children}</p>
    </div>
  )
}

function ErrorState({ error }) {
  const msg = error?.message || ''
  const isInvalid = /invalid|expired|28000/i.test(msg)
  return (
    <FullScreenStatus icon={<AlertCircle className="w-7 h-7" style={{ color: 'var(--red)' }} />}>
      {isInvalid
        ? "Ce lien n'est plus valide ou a expiré."
        : 'Impossible de charger la techlist.'}
    </FullScreenStatus>
  )
}

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

// Hex (sans #) → "rgba(r,g,b,a)". Utilisé pour les fonds de cellule
// session-colorées avec un alpha contrôlé (typiquement 0.22 pour rester
// lisible sur fond clair ET sombre).
function hexToRgba(hex, alpha = 1) {
  if (!hex) return `rgba(34,197,94,${alpha})`
  const clean = hex.replace('#', '')
  let r = 0, g = 0, b = 0
  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16)
    g = parseInt(clean[1] + clean[1], 16)
    b = parseInt(clean[2] + clean[2], 16)
  } else if (clean.length === 6) {
    r = parseInt(clean.slice(0, 2), 16)
    g = parseInt(clean.slice(2, 4), 16)
    b = parseInt(clean.slice(4, 6), 16)
  }
  return `rgba(${r},${g},${b},${alpha})`
}

// Légende sessions (Phase A) — affichée au-dessus du tableau quand le
// projet a 2+ sessions distinctes. Reproduit visuellement la légende
// utilisée dans EquipePreviewModal pour cohérence vue interne / partagée.
function SessionsLegend({ items }) {
  return (
    <div
      className="rounded-md px-3 py-2 flex items-center gap-3 flex-wrap"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
    >
      <span
        className="text-[10px] uppercase tracking-widest font-bold shrink-0"
        style={{ color: 'var(--txt-3)' }}
      >
        Sessions
      </span>
      {items.map((it) => {
        const display = it.label
          ? it.lieu
            ? `${it.label} (${it.lieu})`
            : it.label
          : `Session ${it.sortOrder}`
        return (
          <span
            key={it.sortOrder}
            className="text-[11px] inline-flex items-center gap-1.5"
            style={{ color: 'var(--txt-2)' }}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: `#${it.color}` }}
            />
            {display}
          </span>
        )
      })}
      {/* Hint réservé au desktop : sur mobile pas de hover, le texte
          serait trompeur. Caché en < sm. */}
      <span
        className="hidden sm:inline text-[10px] italic ml-auto"
        style={{ color: 'var(--txt-3)' }}
      >
        Survolez une cellule pour le détail
      </span>
    </div>
  )
}

// ─── Réutilisation par le portail projet ─────────────────────────────────────
// PROJECT-SHARE-2/5 : on expose ShareContent sous le nom EquipeShareView
// pour que la sous-page /share/projet/:token/equipe puisse le réutiliser
// avec le payload retourné par la RPC share_projet_equipe_fetch (même
// shape que share_equipe_fetch). Aucune modification du composant lui-même
// — c'est exactement le rendu utilisé par /share/equipe/:token, juste
// rendu accessible depuis un autre module.
//
// Signature attendue : <EquipeShareView payload setTheme theme />
export { ShareContent as EquipeShareView }

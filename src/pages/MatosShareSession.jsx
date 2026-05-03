// ════════════════════════════════════════════════════════════════════════════
// MatosShareSession — Page publique /share/materiel/:token (MATOS-SHARE-3)
// ════════════════════════════════════════════════════════════════════════════
//
// Vue READ-ONLY simplifiée de la liste matériel d'un projet, partagée à un
// destinataire externe (client, DOP, régisseur) via un lien public. Aucune
// authentification requise.
//
// Sécurité : la RPC share_matos_fetch (SECURITY DEFINER) filtre les données
// côté serveur — pas de numero_reference loueurs, et les colonnes
// remarques/flag/checklist/photos sont remplacées par NULL si le toggle
// correspondant est OFF dans le token.config.
//
// Layout : inspiré de la Crew list (cf. EquipeShareSession). Hero unifié
// (SharePageHeader) + sections par bloc avec table dense desktop / cards
// mobile. Toggle dark/light en haut à droite (clé sessionStorage propre
// à la page matériel).
//
// Pattern aligné sur EquipeShareSession + LivrableShareSession.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertCircle,
  Loader2,
  Package,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { useMatosShareSession } from '../hooks/useMatosShareSession'
import { normalizeShareConfig } from '../lib/matosShare'
import SharePageHeader from '../components/share/SharePageHeader'
import SharePageFooter from '../components/share/SharePageFooter'

const THEME_STORAGE_KEY = 'matos-share-theme'

export default function MatosShareSession() {
  const { token } = useParams()
  const { payload, loading, error } = useMatosShareSession(token)

  // Toggle dark/light, persisté localStorage. Default 'dark' (cohérent
  // avec hub portail + EquipeShareSession). Le client peut basculer en
  // light pour impression / lecture en plein soleil.
  const [theme, setTheme] = useState(() => {
    if (typeof localStorage === 'undefined') return 'dark'
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
  })
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') root.dataset.checkTheme = 'light'
    else delete root.dataset.checkTheme
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_STORAGE_KEY, theme)
    }
    return () => {
      delete root.dataset.checkTheme
    }
  }, [theme])

  if (loading) {
    return (
      <FullScreenStatus
        icon={<Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />}
      >
        Chargement de la liste matériel…
      </FullScreenStatus>
    )
  }

  if (error || !payload) {
    return <ErrorState error={error} />
  }

  return (
    <ShareContent
      payload={payload}
      theme={theme}
      onToggleTheme={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
    />
  )
}

// ─── Contenu principal ──────────────────────────────────────────────────────

function ShareContent({ payload, theme, onToggleTheme }) {
  const share = payload.share || {}
  const project = payload.project || {}
  const org = payload.org || null
  const version = payload.version || null
  const blocks = useMemo(() => payload.blocks || [], [payload.blocks])
  const items = useMemo(() => payload.items || [], [payload.items])
  const stats = payload.stats || {}
  const config = useMemo(() => normalizeShareConfig(share.config), [share.config])

  // Group items by block_id pour rendu en sections.
  const itemsByBlock = useMemo(() => {
    const map = {}
    for (const it of items) {
      if (!map[it.block_id]) map[it.block_id] = []
      map[it.block_id].push(it)
    }
    return map
  }, [items])

  // Mode compact (densité réduite) — utile sur projets très chargés. État
  // local par session, pas de persistance (le visiteur reset à l'ouverture).
  // Auto-default à true si plus de 50 items pour éviter le scroll infini.
  const totalItems = stats.total_items || 0
  const [compact, setCompact] = useState(() => totalItems > 50)
  // Si le total change (refetch), on ne re-bascule pas — respect du choix user.

  // MetaItems pour le SharePageHeader (typés).
  const metaItems = []
  if (project.ref_projet) {
    metaItems.push({ type: 'ref', value: project.ref_projet })
  }
  if (version) {
    // On affiche la version effective + son mode (active = courante,
    // snapshot = figée). Indique au visiteur ce qu'il consulte.
    const isActiveMode = version.mode === 'active'
    const versionLabel = version.label
      ? `${version.numero ? `V${version.numero} ` : ''}${version.label}`
      : version.numero
        ? `V${version.numero}`
        : 'Version'
    metaItems.push({
      type: 'scope',
      value: isActiveMode
        ? `${versionLabel} · Active`
        : `${versionLabel} · Figée`,
      color: isActiveMode ? 'rgba(74,222,128,0.95)' : 'rgba(251,191,36,0.95)',
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
        <SharePageHeader
          pageTitle="Liste matériel"
          project={project}
          org={org}
          metaItems={metaItems}
          theme={theme}
          onToggleTheme={onToggleTheme}
        />

        {/* Stats compactes + toggle densité */}
        <div className="mt-4 mb-3 flex items-center justify-between gap-3">
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            {stats.total_items || 0} item{(stats.total_items || 0) > 1 ? 's' : ''}
            {' · '}
            {stats.total_blocks || 0} bloc{(stats.total_blocks || 0) > 1 ? 's' : ''}
          </p>
          <button
            type="button"
            onClick={() => setCompact((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-md transition-colors"
            style={{
              background: 'var(--bg-surf)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd-sub)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-elev)'
              e.currentTarget.style.color = 'var(--txt)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-surf)'
              e.currentTarget.style.color = 'var(--txt-2)'
            }}
            title={compact ? 'Mode confort (lignes aérées)' : 'Mode compact (lignes denses)'}
          >
            {compact ? (
              <Maximize2 className="w-3 h-3" />
            ) : (
              <Minimize2 className="w-3 h-3" />
            )}
            {compact ? 'Confort' : 'Compact'}
          </button>
        </div>

        {/* Légende des flags si toggle ON */}
        {config.show_flags && (
          <FlagLegend />
        )}

        {/* Liste */}
        {blocks.length === 0 ? (
          <EmptyState />
        ) : (
          <div className={compact ? 'space-y-2 sm:space-y-3' : 'space-y-4 sm:space-y-5'}>
            {blocks.map((block) => (
              <BlockSection
                key={block.id}
                block={block}
                items={itemsByBlock[block.id] || []}
                config={config}
                compact={compact}
              />
            ))}
          </div>
        )}

        <SharePageFooter generatedAt={payload.generated_at} />
      </div>
    </div>
  )
}

// ─── Légende des flags ──────────────────────────────────────────────────────

function FlagLegend() {
  return (
    <div
      className="mb-3 flex items-center gap-3 flex-wrap text-[11px] px-3 py-2 rounded-md"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
        color: 'var(--txt-3)',
      }}
    >
      <span className="font-semibold uppercase tracking-wider text-[10px]">
        Légende
      </span>
      <FlagDot flag="ok" label="OK" />
      <FlagDot flag="attention" label="Attention" />
      <FlagDot flag="probleme" label="Problème" />
    </div>
  )
}

function FlagDot({ flag, label }) {
  const colors = {
    ok:        { bg: 'rgba(34,197,94,0.18)',  fg: 'rgb(34,150,75)' },
    attention: { bg: 'rgba(251,191,36,0.20)', fg: 'rgb(202,138,4)' },
    probleme:  { bg: 'rgba(239,68,68,0.20)',  fg: 'rgb(220,38,38)' },
  }
  const c = colors[flag] || colors.ok
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: c.fg }}
      />
      <span style={{ color: c.fg }}>{label}</span>
    </span>
  )
}

// ─── Section par bloc ───────────────────────────────────────────────────────

function BlockSection({ block, items, config, compact = false }) {
  const couleur = block.couleur || null
  const headerBg = couleur || 'var(--bg-elev)'
  const headerColor = couleur ? '#FFFFFF' : 'var(--txt)'
  const description = block.description?.trim() || null

  return (
    <section
      className="rounded-lg overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
      }}
    >
      {/* Header bloc — couleur custom si définie */}
      <header
        className={`px-3 sm:px-4 ${compact ? 'py-1.5' : 'py-2'} flex items-center gap-2`}
        style={{
          background: headerBg,
          color: headerColor,
          textShadow: couleur ? '0 1px 2px rgba(0,0,0,0.25)' : 'none',
        }}
      >
        <span className="text-xs sm:text-sm font-bold uppercase tracking-wider truncate">
          {block.titre}
        </span>
        <span
          className="text-[11px] font-medium opacity-80"
          style={{ color: 'inherit' }}
        >
          ·  {items.length} item{items.length > 1 ? 's' : ''}
        </span>
      </header>

      {/* Description bloc (si renseignée). Affichée sous le header avec un
          fond légèrement décalé pour bien la séparer du header coloré et de
          la liste. Multi-ligne respectée (whitespace-pre-line). */}
      {description && (
        <div
          className={`px-3 sm:px-4 ${compact ? 'py-1.5' : 'py-2'}`}
          style={{
            background: 'var(--bg-elev)',
            borderBottom: '1px solid var(--brd-sub)',
            color: 'var(--txt-2)',
          }}
        >
          <p
            className="text-[11px] sm:text-xs leading-snug whitespace-pre-line"
            style={{ color: 'var(--txt-2)' }}
          >
            {description}
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <p
          className={`px-4 ${compact ? 'py-2' : 'py-3'} text-xs italic`}
          style={{ color: 'var(--txt-3)' }}
        >
          Aucun item dans ce bloc.
        </p>
      ) : (
        <>
          {/* Mobile (<sm) : cards */}
          <div className="block sm:hidden">
            <CardsList items={items} config={config} compact={compact} />
          </div>
          {/* Tablette + desktop : tableau */}
          <div className="hidden sm:block">
            <ItemsTable items={items} config={config} compact={compact} />
          </div>
        </>
      )}
    </section>
  )
}

// ─── Mode 'liste' (desktop) : tableau dense ─────────────────────────────────

function ItemsTable({ items, config, compact = false }) {
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
            {config.show_flags && <Th width="32px" align="center">Flag</Th>}
            <Th>Désignation</Th>
            {config.show_quantites && <Th width="60px" align="right">Qté</Th>}
            {config.show_loueurs && <Th>Loueur(s)</Th>}
            {config.show_checklist && (
              <>
                <Th width="40px" align="center">Pré</Th>
                <Th width="40px" align="center">Post</Th>
                <Th width="40px" align="center">Prod</Th>
              </>
            )}
            {config.show_remarques && <Th>Remarques</Th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <ItemRow
              key={it.id}
              item={it}
              zebra={i % 2 === 1}
              config={config}
              compact={compact}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Cell padding selon le mode. Compact = lignes denses pour gros projets.
function cellY(compact) {
  return compact ? 'py-1' : 'py-2'
}

// Style discret pour les cellules vides (loueur absent, qté null, etc.) —
// cohérent dans tout le tableau.
const EMPTY_DASH_STYLE = {
  color: 'var(--txt-3)',
  opacity: 0.45,
}

function ItemRow({ item, zebra, config, compact = false }) {
  const py = cellY(compact)
  return (
    <tr
      style={{
        background: zebra ? 'var(--bg-elev)' : 'transparent',
        borderBottom: '1px solid var(--brd-sub)',
      }}
    >
      {config.show_flags && (
        <td className={`px-2 ${py} align-middle text-center`}>
          <FlagBadge flag={item.flag} />
        </td>
      )}
      <td className={`px-3 ${py} align-middle`} style={{ color: 'var(--txt)' }}>
        {item.label && (
          <span
            className="text-[10px] font-semibold uppercase tracking-wider mr-1.5"
            style={{ color: 'var(--txt-3)' }}
          >
            {item.label}
          </span>
        )}
        <span className="font-medium">{item.designation}</span>
      </td>
      {config.show_quantites && (
        <td
          className={`px-3 ${py} align-middle text-right tabular-nums font-semibold`}
          style={{ color: 'var(--txt)' }}
        >
          {item.quantite ?? <span style={EMPTY_DASH_STYLE}>—</span>}
        </td>
      )}
      {config.show_loueurs && (
        <td className={`px-3 ${py} align-middle`} style={{ color: 'var(--txt-2)' }}>
          {Array.isArray(item.loueurs) && item.loueurs.length > 0 ? (
            <span className="inline-flex flex-wrap gap-x-1.5 gap-y-0.5">
              {item.loueurs.map((l, idx) => (
                <span key={l.id || idx}>
                  {l.nom || '—'}
                  {idx < item.loueurs.length - 1 && (
                    <span style={{ color: 'var(--txt-3)' }}> · </span>
                  )}
                </span>
              ))}
            </span>
          ) : (
            <span style={EMPTY_DASH_STYLE}>—</span>
          )}
        </td>
      )}
      {config.show_checklist && (
        <>
          <td className={`px-2 ${py} align-middle text-center`}>
            <CheckMark done={Boolean(item.pre_check_at)} />
          </td>
          <td className={`px-2 ${py} align-middle text-center`}>
            <CheckMark done={Boolean(item.post_check_at)} />
          </td>
          <td className={`px-2 ${py} align-middle text-center`}>
            <CheckMark done={Boolean(item.prod_check_at)} />
          </td>
        </>
      )}
      {config.show_remarques && (
        <td className={`px-3 ${py} align-middle`} style={{ color: 'var(--txt-2)' }}>
          {item.remarques ? (
            <span className="text-[11px] italic">{item.remarques}</span>
          ) : (
            <span style={EMPTY_DASH_STYLE}>—</span>
          )}
        </td>
      )}
    </tr>
  )
}

// ─── Mode 'liste' (mobile) : cards par item ─────────────────────────────────

function CardsList({ items, config, compact = false }) {
  return (
    <ul className="divide-y" style={{ borderColor: 'var(--brd-sub)' }}>
      {items.map((it) => (
        <ItemCard key={it.id} item={it} config={config} compact={compact} />
      ))}
    </ul>
  )
}

function ItemCard({ item, config, compact = false }) {
  return (
    <li className={`px-3 ${compact ? 'py-1.5' : 'py-2.5'} space-y-1`}>
      {/* Row 1 : flag + label + designation + qté */}
      <div className="flex items-center gap-2 min-w-0">
        {config.show_flags && (
          <FlagBadge flag={item.flag} />
        )}
        <div className="flex-1 min-w-0">
          {item.label && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wider mr-1.5"
              style={{ color: 'var(--txt-3)' }}
            >
              {item.label}
            </span>
          )}
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--txt)' }}
          >
            {item.designation}
          </span>
        </div>
        {config.show_quantites && (
          <span
            className="text-sm font-bold shrink-0 tabular-nums"
            style={{ color: 'var(--txt)' }}
          >
            ×{item.quantite ?? '?'}
          </span>
        )}
      </div>
      {/* Row 2 : loueurs */}
      {config.show_loueurs && Array.isArray(item.loueurs) && item.loueurs.length > 0 && (
        <div
          className="text-[11px] flex flex-wrap gap-x-1.5"
          style={{ color: 'var(--txt-3)' }}
        >
          {item.loueurs.map((l, idx) => (
            <span key={l.id || idx}>
              {l.nom || '—'}
              {idx < item.loueurs.length - 1 && (
                <span style={{ color: 'var(--txt-3)' }}> · </span>
              )}
            </span>
          ))}
        </div>
      )}
      {/* Row 3 : checklist (si toggle) */}
      {config.show_checklist && (
        <div className="text-[10px] flex gap-3" style={{ color: 'var(--txt-3)' }}>
          <ChecklistMicro label="Pré"  done={Boolean(item.pre_check_at)} />
          <ChecklistMicro label="Post" done={Boolean(item.post_check_at)} />
          <ChecklistMicro label="Prod" done={Boolean(item.prod_check_at)} />
        </div>
      )}
      {/* Row 4 : remarques */}
      {config.show_remarques && item.remarques && (
        <p
          className="text-[11px] italic"
          style={{ color: 'var(--txt-2)' }}
        >
          {item.remarques}
        </p>
      )}
    </li>
  )
}

// ─── Helpers UI ─────────────────────────────────────────────────────────────

function Th({ children, width = null, align = 'left' }) {
  const justify = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'
  return (
    <th
      className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
      style={{
        color: 'var(--txt-2)',
        textAlign: justify,
        ...(width ? { width } : {}),
      }}
    >
      {children}
    </th>
  )
}

function FlagBadge({ flag }) {
  if (!flag) {
    return (
      <span
        className="inline-block w-2.5 h-2.5 rounded-full"
        style={{ background: 'var(--brd)', opacity: 0.4 }}
        title="Flag masqué"
      />
    )
  }
  const colors = {
    ok:        { bg: 'rgb(34,197,94)',  title: 'OK' },
    attention: { bg: 'rgb(251,191,36)', title: 'Attention' },
    probleme:  { bg: 'rgb(239,68,68)',  title: 'Problème' },
  }
  const c = colors[flag] || colors.ok
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full"
      style={{ background: c.bg }}
      title={c.title}
    />
  )
}

function CheckMark({ done }) {
  if (done) {
    return (
      <span
        className="inline-flex items-center justify-center w-4 h-4 rounded text-[11px] font-bold"
        style={{
          background: 'rgba(34,197,94,0.18)',
          color: 'rgb(34,150,75)',
        }}
      >
        ✓
      </span>
    )
  }
  return (
    <span
      className="inline-block w-4 h-4 rounded"
      style={{
        border: '1px dashed var(--brd-sub)',
        opacity: 0.5,
      }}
    />
  )
}

function ChecklistMicro({ label, done }) {
  return (
    <span
      className="inline-flex items-center gap-1"
      style={{
        color: done ? 'rgb(34,150,75)' : 'var(--txt-3)',
        fontWeight: done ? 600 : 400,
      }}
    >
      <span style={{ opacity: done ? 1 : 0.4 }}>{done ? '✓' : '·'}</span>
      {label}
    </span>
  )
}

// ─── États système ─────────────────────────────────────────────────────────

function FullScreenStatus({ icon, children }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div className="flex flex-col items-center gap-3">
        {icon}
        <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
          {children}
        </p>
      </div>
    </div>
  )
}

function ErrorState({ error }) {
  const msg = String(error?.message || '').toLowerCase()
  const isInvalid = msg.includes('invalid') || msg.includes('expired')

  const techDetail = !isInvalid
    ? [error?.code, error?.message, error?.hint, error?.details]
        .filter(Boolean)
        .join(' · ')
    : null

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg)', color: 'var(--txt)' }}
    >
      <div
        className="max-w-md w-full text-center p-6 sm:p-8 rounded-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        <AlertCircle
          className="w-10 h-10 mx-auto mb-3"
          style={{ color: 'var(--red)', opacity: 0.7 }}
        />
        <h1 className="text-base font-bold mb-2" style={{ color: 'var(--txt)' }}>
          Lien {isInvalid ? 'invalide' : 'inaccessible'}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--txt-2)' }}>
          {isInvalid
            ? 'Ce lien n\u2019est plus valide. Il a peut-être été révoqué ou a expiré. Contactez la production pour en obtenir un nouveau.'
            : 'Impossible de charger la liste matériel pour le moment. Réessayez dans quelques instants.'}
        </p>
        {techDetail && (
          <details className="mt-4 text-left">
            <summary
              className="cursor-pointer text-[10px] uppercase tracking-wider"
              style={{ color: 'var(--txt-3)' }}
            >
              Détails techniques
            </summary>
            <pre
              className="mt-2 text-[10px] whitespace-pre-wrap break-all p-2 rounded"
              style={{
                color: 'var(--txt-3)',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
              }}
            >
              {techDetail}
            </pre>
          </details>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div
      className="rounded-xl p-12 text-center"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <Package
        className="w-10 h-10 mx-auto mb-3"
        style={{ color: 'var(--txt-3)', opacity: 0.4 }}
      />
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Aucun bloc matériel sur cette version.
      </p>
    </div>
  )
}

// ─── Réutilisation par le portail projet (commit 5/5) ──────────────────────
// On expose ShareContent sous le nom MatosShareView pour que la sous-page
// /share/projet/:token/materiel puisse le réutiliser avec le payload
// retourné par share_projet_materiel_fetch (même shape).
export { ShareContent as MatosShareView }

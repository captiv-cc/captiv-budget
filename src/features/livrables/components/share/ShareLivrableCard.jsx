// ════════════════════════════════════════════════════════════════════════════
// ShareLivrableCard — Card livrable sur la page de partage (LIV-24C)
// ════════════════════════════════════════════════════════════════════════════
//
// Card par livrable : numéro · nom, statut, méta (format / durée), prochaine
// échéance (envoi prévu ou livraison master), accordéon des versions
// envoyées avec lien Frame + statut validation client.
//
// Volontairement neutre — pas de mention monteur, pas de notes internes,
// pas de date d'étape (ces champs sont déjà filtrés côté serveur dans
// share_livrables_fetch).
// ════════════════════════════════════════════════════════════════════════════

import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, Clock, Film, Cloud } from 'lucide-react'
import { normalizeExternalUrl } from '../../../../lib/livrableShare'

// Mapping statuts livrables → libellés client + couleurs (CSS vars de l'app
// pour suivre auto le thème dark/light).
const STATUT_META = {
  brief:     { label: 'À démarrer',      color: 'var(--txt-3)', bg: 'var(--bg-elev)' },
  en_cours:  { label: 'En préparation',  color: 'var(--blue)',   bg: 'var(--blue-bg)' },
  a_valider: { label: 'À valider',       color: 'var(--orange)', bg: 'var(--orange-bg)' },
  valide:    { label: 'Validé',          color: 'var(--green)',  bg: 'var(--green-bg)' },
  livre:     { label: 'Livré',           color: 'var(--green)',  bg: 'var(--green-bg)' },
  archive:   { label: 'Archivé',         color: 'var(--txt-3)',  bg: 'var(--bg-elev)' },
}

const VERSION_STATUT_META = {
  en_attente:         { label: 'En attente de retour',  color: 'var(--orange)', bg: 'var(--orange-bg)' },
  retours_a_integrer: { label: 'Retours à intégrer',    color: 'var(--red)',    bg: 'var(--red-bg)' },
  valide:             { label: 'Validée',               color: 'var(--green)',  bg: 'var(--green-bg)' },
  rejete:             { label: 'Rejetée',               color: 'var(--red)',    bg: 'var(--red-bg)' },
}

export default function ShareLivrableCard({ livrable, block, versions, config }) {
  // Auto-déplie l'accordéon si au moins une version a été envoyée — c'est
  // l'info la plus utile pour le client. Sinon, on reste plié.
  const hasVersionsEnvoyees = versions.some((v) => v.date_envoi)
  const [expanded, setExpanded] = useState(hasVersionsEnvoyees)

  // Numéro complet (préfixe bloc + numéro) — cohérent avec l'affichage admin.
  const prefix = (block?.prefixe || '').trim()
  const numero = (livrable.numero || '').trim()
  const fullNumero =
    prefix && numero && !numero.startsWith(prefix) ? `${prefix}${numero}` : numero

  const statutMeta = STATUT_META[livrable.statut] || STATUT_META.brief

  // Prochaine échéance pertinente : si on a une livraison_master, on l'affiche
  // en priorité (c'est la deadline contractuelle du client). Sinon, la
  // première date d'envoi prévue d'une version non envoyée.
  const nextEnvoiPrevu = config.show_envoi_prevu
    ? findNextEnvoiPrevu(versions)
    : null

  return (
    <article
      className="rounded-xl shadow-sm overflow-hidden"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Header card — clic = toggle accordéon (si versions) */}
      <button
        type="button"
        onClick={() => versions.length > 0 && setExpanded((v) => !v)}
        className="w-full text-left px-5 py-4 flex items-start gap-3 transition-colors"
        disabled={versions.length === 0}
        style={{ cursor: versions.length === 0 ? 'default' : 'pointer' }}
        onMouseEnter={(e) => {
          if (versions.length > 0) e.currentTarget.style.background = 'var(--bg-hov)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Chevron — invisible si pas de versions */}
        <span className="pt-0.5 shrink-0" style={{ color: 'var(--txt-3)' }}>
          {versions.length === 0 ? (
            <span className="inline-block w-4" aria-hidden="true" />
          ) : expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>

        <div className="flex-1 min-w-0">
          {/* Ligne 1 : numéro + nom + statut */}
          <div className="flex items-start gap-2 flex-wrap">
            {fullNumero && (
              <span
                className="font-mono text-xs pt-0.5 shrink-0"
                style={{ color: 'var(--txt-3)' }}
              >
                {fullNumero}
              </span>
            )}
            <h3
              className="font-semibold leading-snug flex-1 min-w-0"
              style={{ color: 'var(--txt)' }}
            >
              {livrable.nom || 'Sans titre'}
            </h3>
            <StatutBadge meta={statutMeta} />
          </div>

          {/* Ligne 2 : meta (format / durée) + prochaine échéance */}
          <div
            className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
            style={{ color: 'var(--txt-3)' }}
          >
            {livrable.format && <span>{livrable.format}</span>}
            {livrable.format && livrable.duree && <span aria-hidden="true">·</span>}
            {livrable.duree && <span>{livrable.duree}</span>}
            {(livrable.format || livrable.duree) && livrable.date_livraison && (
              <span aria-hidden="true">·</span>
            )}
            {livrable.date_livraison && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" />
                Livraison {formatDateFR(livrable.date_livraison)}
              </span>
            )}
            {nextEnvoiPrevu && (
              <span
                className="inline-flex items-center gap-1 ml-auto font-medium"
                style={{ color: 'var(--purple)' }}
              >
                Prochain envoi {nextEnvoiPrevu.numero_label} · {formatDateFR(nextEnvoiPrevu.date_envoi_prevu)}
              </span>
            )}
          </div>
        </div>
      </button>

      {/* Liens du livrable (Frame / Drive) */}
      {(livrable.lien_frame || livrable.lien_drive) && (
        <div
          className="px-5 py-2.5 flex items-center gap-2 flex-wrap text-xs"
          style={{ background: 'var(--bg-elev)', borderTop: '1px solid var(--brd-sub)' }}
        >
          <span
            className="text-[10px] uppercase tracking-wider font-semibold mr-1"
            style={{ color: 'var(--txt-3)' }}
          >
            Liens
          </span>
          {livrable.lien_frame && (
            <a
              href={normalizeExternalUrl(livrable.lien_frame)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors"
              style={{
                background: 'var(--txt)',
                color: 'var(--bg-surf)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
            >
              <Film className="w-3 h-3" />
              Voir sur Frame
            </a>
          )}
          {livrable.lien_drive && (
            <a
              href={normalizeExternalUrl(livrable.lien_drive)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-medium transition-colors"
              style={{
                color: 'var(--txt)',
                background: 'var(--bg-surf)',
                border: '1px solid var(--brd)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hov)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-surf)' }}
            >
              <Cloud className="w-3 h-3" />
              Master sur Drive
            </a>
          )}
        </div>
      )}

      {/* Accordéon versions */}
      {expanded && versions.length > 0 && (
        <div
          className="px-5 py-4"
          style={{ background: 'var(--bg-elev)', borderTop: '1px solid var(--brd-sub)' }}
        >
          <p
            className="text-[10px] uppercase tracking-wider font-semibold mb-3"
            style={{ color: 'var(--txt-3)' }}
          >
            Versions
          </p>
          <ol className="space-y-2.5">
            {versions.map((v) => (
              <VersionItem key={v.id} version={v} config={config} />
            ))}
          </ol>
        </div>
      )}
    </article>
  )
}

// ─── Sous-composants ──────────────────────────────────────────────────────

function StatutBadge({ meta }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider shrink-0"
      style={{
        background: meta.bg,
        color: meta.color,
        border: `1px solid ${meta.color}33`,
      }}
    >
      {meta.label}
    </span>
  )
}

function VersionItem({ version, config }) {
  const isEnvoyee = Boolean(version.date_envoi)
  const validationMeta =
    VERSION_STATUT_META[version.statut_validation] || VERSION_STATUT_META.en_attente

  return (
    <li
      className="rounded-lg p-3"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="font-mono text-xs font-bold pt-0.5 shrink-0"
          style={{ color: 'var(--txt)' }}
        >
          {version.numero_label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {isEnvoyee ? (
              <span style={{ color: 'var(--txt-2)' }}>
                Envoyée le <span className="font-medium" style={{ color: 'var(--txt)' }}>
                  {formatDateFR(version.date_envoi)}
                </span>
              </span>
            ) : version.date_envoi_prevu && config.show_envoi_prevu ? (
              <span style={{ color: 'var(--txt-3)' }}>
                Envoi prévu le <span className="font-medium" style={{ color: 'var(--txt)' }}>
                  {formatDateFR(version.date_envoi_prevu)}
                </span>
              </span>
            ) : (
              <span className="italic" style={{ color: 'var(--txt-3)' }}>À venir</span>
            )}
            {isEnvoyee && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
                style={{
                  background: validationMeta.bg,
                  color: validationMeta.color,
                }}
              >
                {validationMeta.label}
              </span>
            )}
            {version.lien_frame && (
              <a
                href={normalizeExternalUrl(version.lien_frame)}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
                style={{ background: 'var(--txt)', color: 'var(--bg-surf)' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
              >
                Voir la version
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
          {config.show_feedback && version.feedback_client && (
            <p
              className="mt-2 text-xs italic whitespace-pre-wrap leading-relaxed"
              style={{ color: 'var(--txt-2)' }}
            >
              « {version.feedback_client} »
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function findNextEnvoiPrevu(versions) {
  // Première version non envoyée qui a une date prévisionnelle.
  for (const v of versions) {
    if (!v.date_envoi && v.date_envoi_prevu) return v
  }
  return null
}

function formatDateFR(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  if (!m) return iso || ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

// ════════════════════════════════════════════════════════════════════════════
// LivrableShareModal — Gestion des tokens de partage public livrables (LIV-24D)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis le bouton "Partager" de LivrablesTab. Permet aux
// membres CAPTIV de :
//   1. Créer un nouveau lien /share/livrables/:token avec label + expiration
//      + config (calendar_level + toggles).
//   2. Lister les liens actifs + révoqués du projet.
//   3. Copier l'URL, ouvrir, renommer, révoquer/restaurer, supprimer.
//
// Pattern aligné sur ShareChecklistModal (MAT-10L). Mode édition de config
// non géré en V1 (l'admin révoque + recrée si besoin de changer les toggles).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Plus,
  Share2,
  Trash2,
  X,
  RotateCcw,
  Pencil,
  Calendar,
} from 'lucide-react'
import {
  CALENDAR_LEVELS,
  CALENDAR_LEVEL_LABELS,
  CALENDAR_LEVEL_DESCRIPTIONS,
  DEFAULT_SHARE_CONFIG,
  buildShareUrl,
  getShareTokenState,
} from '../../../lib/livrableShare'
import { useLivrableShareTokens } from '../../../hooks/useLivrableShareTokens'
import { confirm, prompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

export default function LivrableShareModal({ open, onClose, projectId }) {
  const { tokens, loading, create, update, revoke, restore, remove } =
    useLivrableShareTokens(open ? projectId : null)

  const [showRevoked, setShowRevoked] = useState(false)
  const [creating, setCreating] = useState(false)

  // ─── Form de création (déplié par défaut si liste vide) ────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('') // input type=date → 'YYYY-MM-DD'
  const [config, setConfig] = useState({ ...DEFAULT_SHARE_CONFIG })

  // Pré-déplie le form si aucun token actif n'existe (UX sympa au 1er coup).
  useEffect(() => {
    if (!open) return
    const hasActive = tokens.some((t) => getShareTokenState(t) === 'active')
    setFormOpen(!hasActive)
  }, [open, tokens])

  // Reset state à chaque ouverture/fermeture.
  useEffect(() => {
    if (!open) {
      setShowRevoked(false)
      setLabel('')
      setExpiresAt('')
      setConfig({ ...DEFAULT_SHARE_CONFIG })
    }
  }, [open])

  // Partition active / révoqués + expirés.
  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  if (!open) return null

  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    try {
      // Si l'admin a tapé une date au format YYYY-MM-DD, on la transforme en
      // ISO datetime fin de journée (23:59:59) pour être inclusif.
      const expiresIso = expiresAt
        ? `${expiresAt}T23:59:59`
        : null
      const newToken = await create({
        label: label.trim() || null,
        config,
        expiresAt: expiresIso,
      })
      // Copy auto pour l'admin (UX agréable).
      try {
        await navigator.clipboard.writeText(buildShareUrl(newToken.token))
        notify.success('Lien créé et copié dans le presse-papiers')
      } catch {
        notify.success('Lien créé')
      }
      // Reset form.
      setLabel('')
      setExpiresAt('')
      setConfig({ ...DEFAULT_SHARE_CONFIG })
      setFormOpen(false)
    } catch (err) {
      notify.error('Création échouée : ' + (err?.message || err))
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async (token) => {
    try {
      await navigator.clipboard.writeText(buildShareUrl(token.token))
      notify.success('Lien copié')
    } catch {
      notify.error('Impossible de copier le lien')
    }
  }

  const handleRename = async (token) => {
    const newLabel = await prompt({
      title: 'Renommer le lien',
      defaultValue: token.label || '',
      placeholder: 'Ex : Client Renault',
      confirmLabel: 'Renommer',
    })
    if (newLabel === null) return
    try {
      await update(token.id, { label: newLabel })
      notify.success('Lien renommé')
    } catch (err) {
      notify.error('Renommage échoué : ' + (err?.message || err))
    }
  }

  const handleRevoke = async (token) => {
    const ok = await confirm({
      title: 'Révoquer ce lien',
      message:
        'Le client ne pourra plus accéder à la page. Vous pouvez le restaurer plus tard si besoin.',
      confirmLabel: 'Révoquer',
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(token.id)
      notify.success('Lien révoqué')
    } catch (err) {
      notify.error('Révocation échouée : ' + (err?.message || err))
    }
  }

  const handleRestore = async (token) => {
    try {
      await restore(token.id)
      notify.success('Lien restauré')
    } catch (err) {
      notify.error('Restauration échouée : ' + (err?.message || err))
    }
  }

  const handleDelete = async (token) => {
    const ok = await confirm({
      title: 'Supprimer définitivement',
      message: 'Cette action efface aussi l\u2019historique des vues. Préférez "Révoquer" pour garder la trace.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await remove(token.id)
      notify.success('Lien supprimé')
    } catch (err) {
      notify.error('Suppression échouée : ' + (err?.message || err))
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => {
        // Click backdrop → close. Préserver clic interne via stopPropagation
        // dans le contenu.
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
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
            <Share2 className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Partager les livrables
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Liens de consultation publique pour vos clients
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

        {/* Contenu scrollable */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Form de création repliable */}
          <CreateFormSection
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            label={label}
            setLabel={setLabel}
            expiresAt={expiresAt}
            setExpiresAt={setExpiresAt}
            config={config}
            setConfig={setConfig}
            creating={creating}
            onSubmit={handleCreate}
            hasAnyActive={activeTokens.length > 0}
          />

          {/* Liste tokens actifs */}
          <section>
            <h3
              className="text-[11px] uppercase tracking-wider font-semibold mb-2"
              style={{ color: 'var(--txt-3)' }}
            >
              Liens actifs · {activeTokens.length}
            </h3>
            {loading && tokens.length === 0 ? (
              <SkeletonList />
            ) : activeTokens.length === 0 ? (
              <EmptyState
                message="Aucun lien actif pour ce projet."
                hint="Créez un nouveau lien ci-dessus pour partager le suivi avec un client."
              />
            ) : (
              <ul className="space-y-2">
                {activeTokens.map((t) => (
                  <TokenCard
                    key={t.id}
                    token={t}
                    onCopy={handleCopy}
                    onRename={handleRename}
                    onRevoke={handleRevoke}
                    onDelete={handleDelete}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Liens révoqués / expirés (repliable) */}
          {otherTokens.length > 0 && (
            <section>
              <button
                type="button"
                onClick={() => setShowRevoked((v) => !v)}
                className="flex items-center gap-1 text-[11px] uppercase tracking-wider font-semibold mb-2"
                style={{ color: 'var(--txt-3)' }}
              >
                <ChevronDown
                  className="w-3 h-3 transition-transform"
                  style={{ transform: showRevoked ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
                Liens révoqués / expirés · {otherTokens.length}
              </button>
              {showRevoked && (
                <ul className="space-y-2">
                  {otherTokens.map((t) => (
                    <TokenCard
                      key={t.id}
                      token={t}
                      onCopy={handleCopy}
                      onRename={handleRename}
                      onRestore={handleRestore}
                      onDelete={handleDelete}
                      readOnly
                    />
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Form section (création)
// ════════════════════════════════════════════════════════════════════════════

function CreateFormSection({
  open,
  onToggle,
  label,
  setLabel,
  expiresAt,
  setExpiresAt,
  config,
  setConfig,
  creating,
  onSubmit,
  hasAnyActive,
}) {
  return (
    <section
      className="rounded-lg border"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--brd-sub)',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Plus className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
            {hasAnyActive ? 'Nouveau lien' : 'Créer votre premier lien'}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            Choisissez un destinataire et ce que le client peut voir
          </div>
        </div>
        <ChevronDown
          className="w-4 h-4 transition-transform"
          style={{ color: 'var(--txt-3)', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
        />
      </button>

      {open && (
        <div
          className="px-4 pb-4 pt-2 space-y-3 border-t"
          style={{ borderColor: 'var(--brd-sub)' }}
        >
          {/* Label */}
          <Field label="Destinataire (optionnel)">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex : Client Renault, Équipe brand…"
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
          </Field>

          {/* Expiration */}
          <Field label="Expiration (optionnel)">
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="flex-1 text-sm px-3 py-1.5 rounded-md outline-none"
                style={{
                  background: 'var(--bg-surf)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              />
              {expiresAt && (
                <button
                  type="button"
                  onClick={() => setExpiresAt('')}
                  className="text-[11px] px-2 py-1"
                  style={{ color: 'var(--txt-3)' }}
                >
                  Effacer
                </button>
              )}
            </div>
            <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
              Vide = pas d&apos;expiration. Le lien restera valide jusqu&apos;à révocation manuelle.
            </p>
          </Field>

          {/* Calendar level — select 3 valeurs */}
          <Field label="Calendrier visible par le client">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {CALENDAR_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setConfig({ ...config, calendar_level: level })}
                  className="text-left rounded-md px-3 py-2 transition-all"
                  style={{
                    background: config.calendar_level === level ? 'var(--blue-bg)' : 'var(--bg-surf)',
                    border: `1px solid ${config.calendar_level === level ? 'var(--blue)' : 'var(--brd)'}`,
                    color: config.calendar_level === level ? 'var(--blue)' : 'var(--txt)',
                  }}
                >
                  <div className="text-xs font-semibold">{CALENDAR_LEVEL_LABELS[level]}</div>
                  <div
                    className="text-[10px] mt-0.5 leading-snug"
                    style={{ color: config.calendar_level === level ? 'var(--blue)' : 'var(--txt-3)' }}
                  >
                    {CALENDAR_LEVEL_DESCRIPTIONS[level]}
                  </div>
                </button>
              ))}
            </div>
          </Field>

          {/* Toggles */}
          <div className="grid grid-cols-1 gap-1.5">
            <Toggle
              checked={config.show_periodes}
              onChange={(v) => setConfig({ ...config, show_periodes: v })}
              label="Afficher les périodes du projet"
              hint="Tournage, livraison master, deadline…"
            />
            <Toggle
              checked={config.show_envoi_prevu}
              onChange={(v) => setConfig({ ...config, show_envoi_prevu: v })}
              label="Afficher les dates d'envoi prévisionnelles"
              hint='Ex : "V2 prévue le 12/05"'
            />
            <Toggle
              checked={config.show_feedback}
              onChange={(v) => setConfig({ ...config, show_feedback: v })}
              label="Afficher le feedback client des versions précédentes"
              hint="Mémoire des échanges sur chaque version"
            />
          </div>

          {/* Bouton créer */}
          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onSubmit}
              disabled={creating}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all"
              style={{
                background: 'var(--blue)',
                color: 'white',
                border: '1px solid var(--blue)',
                opacity: creating ? 0.6 : 1,
                cursor: creating ? 'not-allowed' : 'pointer',
              }}
            >
              <Plus className="w-3 h-3" />
              {creating ? 'Création…' : 'Créer le lien'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Card token
// ════════════════════════════════════════════════════════════════════════════

function TokenCard({ token, onCopy, onRename, onRevoke, onRestore, onDelete, readOnly = false }) {
  const state = getShareTokenState(token)
  const url = buildShareUrl(token.token)
  const config = token.config || {}

  return (
    <li
      className="rounded-lg p-3 border"
      style={{
        background: 'var(--bg-elev)',
        borderColor: 'var(--brd-sub)',
        opacity: state === 'active' ? 1 : 0.7,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Label + état */}
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {token.label || 'Lien sans label'}
            </h4>
            <StateBadge state={state} expiresAt={token.expires_at} />
          </div>

          {/* Méta : créé le · vues · expiration */}
          <div className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]" style={{ color: 'var(--txt-3)' }}>
            <span>Créé {formatRelative(token.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {token.view_count || 0} vue{(token.view_count || 0) > 1 ? 's' : ''}
              {token.last_accessed_at && (
                <span> · dernière {formatRelative(token.last_accessed_at)}</span>
              )}
            </span>
            {token.expires_at && state === 'active' && (
              <>
                <span aria-hidden="true">·</span>
                <span>Expire {formatDateFR(token.expires_at)}</span>
              </>
            )}
          </div>

          {/* URL + config résumée */}
          <div className="mt-2 flex items-center gap-1 flex-wrap">
            <code
              className="text-[10px] px-2 py-1 rounded font-mono truncate"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt-2)',
                border: '1px solid var(--brd-sub)',
                maxWidth: '100%',
              }}
              title={url}
            >
              {url}
            </code>
          </div>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap text-[10px]" style={{ color: 'var(--txt-3)' }}>
            <ConfigPill label={`Calendrier : ${CALENDAR_LEVEL_LABELS[config.calendar_level] || '—'}`} />
            {config.show_periodes && <ConfigPill label="Périodes" />}
            {config.show_envoi_prevu && <ConfigPill label="Dates prévues" />}
            {config.show_feedback && <ConfigPill label="Feedback" />}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1.5 flex-wrap pt-2 border-t" style={{ borderColor: 'var(--brd-sub)' }}>
        <ActionButton onClick={() => onCopy(token)} icon={Copy} label="Copier" />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--txt-2)', background: 'var(--bg-surf)', border: '1px solid var(--brd-sub)' }}
        >
          <ExternalLink className="w-3 h-3" />
          Ouvrir
        </a>
        <ActionButton onClick={() => onRename(token)} icon={Pencil} label="Renommer" />

        <div className="ml-auto flex items-center gap-1.5">
          {readOnly && state === 'revoked' && (
            <ActionButton onClick={() => onRestore(token)} icon={RotateCcw} label="Restaurer" />
          )}
          {!readOnly && state === 'active' && (
            <ActionButton onClick={() => onRevoke(token)} icon={X} label="Révoquer" tone="warning" />
          )}
          <ActionButton onClick={() => onDelete(token)} icon={Trash2} label="Supprimer" tone="danger" />
        </div>
      </div>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Helpers UI
// ════════════════════════════════════════════════════════════════════════════

function Field({ label, children }) {
  return (
    <label className="block">
      <span
        className="block text-[11px] uppercase tracking-wider font-semibold mb-1"
        style={{ color: 'var(--txt-3)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-start gap-3 px-3 py-2 rounded-md text-left transition-colors"
      style={{
        background: checked ? 'var(--blue-bg)' : 'var(--bg-surf)',
        border: `1px solid ${checked ? 'var(--blue)' : 'var(--brd)'}`,
      }}
    >
      <span
        className="mt-0.5 inline-block w-8 h-4 rounded-full relative transition-colors"
        style={{ background: checked ? 'var(--blue)' : 'var(--brd)' }}
      >
        <span
          className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
          style={{ left: checked ? '17px' : '3px' }}
        />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-xs font-semibold" style={{ color: checked ? 'var(--blue)' : 'var(--txt)' }}>
          {label}
        </span>
        <span className="block text-[10px]" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}

function ActionButton({ onClick, icon: Icon, label, tone = 'default' }) {
  const colorVar =
    tone === 'danger' ? 'var(--red)' : tone === 'warning' ? 'var(--orange)' : 'var(--txt-2)'
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors"
      style={{
        color: colorVar,
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-surf)'
      }}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  )
}

function StateBadge({ state, expiresAt }) {
  const meta =
    state === 'revoked'
      ? { label: 'Révoqué', color: 'var(--red)', bg: 'var(--red-bg)' }
      : state === 'expired'
        ? { label: 'Expiré', color: 'var(--orange)', bg: 'var(--orange-bg)' }
        : { label: 'Actif', color: 'var(--green)', bg: 'var(--green-bg)' }
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider"
      style={{ background: meta.bg, color: meta.color }}
      title={state === 'expired' && expiresAt ? `Expiré le ${formatDateFR(expiresAt)}` : null}
    >
      {meta.label}
    </span>
  )
}

function ConfigPill({ label }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-[9px]"
      style={{
        background: 'var(--bg-surf)',
        color: 'var(--txt-3)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      {label}
    </span>
  )
}

function EmptyState({ message, hint }) {
  return (
    <div
      className="text-center py-8 rounded-lg border-2 border-dashed"
      style={{ borderColor: 'var(--brd-sub)' }}
    >
      <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
        {message}
      </p>
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {[0, 1].map((i) => (
        <li
          key={i}
          className="rounded-lg p-3 border animate-pulse"
          style={{ background: 'var(--bg-elev)', borderColor: 'var(--brd-sub)', height: 80 }}
        />
      ))}
    </ul>
  )
}

// ─── Format helpers ──────────────────────────────────────────────────────

function formatDateFR(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now - d
  const min = Math.round(diffMs / 60000)
  if (min < 1) return 'à l\u2019instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `il y a ${h}h`
  const days = Math.round(h / 24)
  if (days < 30) return `il y a ${days}j`
  return `le ${formatDateFR(iso)}`
}

// ════════════════════════════════════════════════════════════════════════════
// MaterielShareModal — Gestion des tokens de partage public matériel (MAT-SHARE-4)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis l'entrée "Lien web partageable" du menu Partager
// (cf. ExportPdfMenu). Permet aux admins / charge_prod / coordinateurs
// attachés de :
//   1. Créer un nouveau lien /share/materiel/:token avec :
//      - Label interne
//      - Mode version (active suivante OU snapshot figé sur Vx)
//      - 6 toggles (loueurs, qté, remarques, flags, checklist, photos)
//      - Expiration optionnelle
//   2. Lister les liens actifs + révoqués/expirés du projet
//   3. Copier l'URL, ouvrir, renommer, révoquer/restaurer, supprimer
//
// Pattern aligné sur TechlistShareModal (équipe) et LivrableShareModal
// (livrables). Spécificité matos : choix de version (active vs snapshot).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import {
  DEFAULT_SHARE_CONFIG,
  buildShareUrl,
  getMatosShareTokenState,
  getMatosShareVersionMode,
  normalizeShareConfig,
} from '../../../lib/matosShare'
import { useMatosShareTokens } from '../../../hooks/useMatosShareTokens'
import { confirm, prompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

export default function MaterielShareModal({
  open,
  onClose,
  projectId,
  // Liste de toutes les versions du projet (pour le picker snapshot).
  // Doit inclure { id, numero, label, is_active }.
  versions = [],
  // Version active actuelle (pour le label par défaut "Suivre la version
  // active : Vx"). Null si aucune.
  activeVersion = null,
}) {
  const { tokens, loading, create, update, revoke, restore, remove } =
    useMatosShareTokens(open ? projectId : null)

  const [showRevoked, setShowRevoked] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [editingTokenId, setEditingTokenId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [versionMode, setVersionMode] = useState('active')
  const [versionId, setVersionId] = useState(null)
  const [config, setConfig] = useState({ ...DEFAULT_SHARE_CONFIG })

  // Pré-déplie le form si aucun token actif et pas en mode édition
  useEffect(() => {
    if (!open) return
    if (editingTokenId) return
    const hasActive = tokens.some(
      (t) => getMatosShareTokenState(t) === 'active',
    )
    setFormOpen(!hasActive)
  }, [open, tokens, editingTokenId])

  // Reset form à chaque fermeture
  useEffect(() => {
    if (!open) {
      setShowRevoked(false)
      setEditingTokenId(null)
      setLabel('')
      setExpiresAt('')
      setVersionMode('active')
      setVersionId(null)
      setConfig({ ...DEFAULT_SHARE_CONFIG })
    }
  }, [open])

  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getMatosShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  // Map des versions par id pour affichage rapide
  const versionsById = useMemo(() => {
    const map = {}
    for (const v of versions) map[v.id] = v
    return map
  }, [versions])

  if (!open) return null

  const isEditMode = editingTokenId !== null
  const canSubmit =
    !submitting &&
    (versionMode === 'active' ||
      (versionMode === 'snapshot' && versionId))

  function handleStartEdit(t) {
    const mode = getMatosShareVersionMode(t)
    const expiresShort = t.expires_at
      ? String(t.expires_at).slice(0, 10)
      : ''
    setEditingTokenId(t.id)
    setLabel(t.label || '')
    setExpiresAt(expiresShort)
    setVersionMode(mode)
    setVersionId(t.version_id || null)
    setConfig(normalizeShareConfig(t.config))
    setFormOpen(true)
  }

  function handleCancelEdit() {
    setEditingTokenId(null)
    setLabel('')
    setExpiresAt('')
    setVersionMode('active')
    setVersionId(null)
    setConfig({ ...DEFAULT_SHARE_CONFIG })
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const expiresIso = expiresAt ? `${expiresAt}T23:59:59` : null
      const finalVersionId = versionMode === 'snapshot' ? versionId : null

      if (isEditMode) {
        await update(editingTokenId, {
          label: label.trim() || null,
          expiresAt: expiresIso,
          versionId: finalVersionId,
          config,
        })
        notify.success('Lien mis à jour')
        handleCancelEdit()
        setFormOpen(false)
      } else {
        const newToken = await create({
          label: label.trim() || null,
          versionId: finalVersionId,
          config,
          expiresAt: expiresIso,
        })
        try {
          await navigator.clipboard.writeText(buildShareUrl(newToken.token))
          notify.success('Lien créé et copié')
        } catch {
          notify.success('Lien créé')
        }
        setLabel('')
        setExpiresAt('')
        setVersionMode('active')
        setVersionId(null)
        setConfig({ ...DEFAULT_SHARE_CONFIG })
        setFormOpen(false)
      }
    } catch (err) {
      console.error('[MaterielShareModal] submit error', err)
      notify.error(
        (isEditMode ? 'Mise à jour' : 'Création') +
          ' échouée : ' +
          (err?.message || err),
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCopy(t) {
    try {
      await navigator.clipboard.writeText(buildShareUrl(t.token))
      notify.success('Lien copié')
    } catch {
      notify.error('Impossible de copier')
    }
  }

  function handleOpen(t) {
    window.open(buildShareUrl(t.token), '_blank', 'noopener,noreferrer')
  }

  async function handleRename(t) {
    const newLabel = await prompt({
      title: 'Renommer le lien',
      message: 'Nouveau libellé interne :',
      initialValue: t.label || '',
      placeholder: 'Ex : Client Renault, DOP, Régisseur Paul…',
      confirmLabel: 'Renommer',
    })
    if (newLabel === null) return
    try {
      await update(t.id, { label: newLabel })
      notify.success('Lien renommé')
    } catch (err) {
      notify.error('Renommage échoué : ' + (err?.message || err))
    }
  }

  async function handleRevoke(t) {
    const ok = await confirm({
      title: 'Révoquer ce lien',
      message:
        'Le destinataire ne pourra plus accéder à la liste matériel. L\u2019historique de vues est conservé.',
      confirmLabel: 'Révoquer',
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(t.id)
      notify.success('Lien révoqué')
    } catch (err) {
      notify.error('Révocation échouée : ' + (err?.message || err))
    }
  }

  async function handleRestore(t) {
    try {
      await restore(t.id)
      notify.success('Lien restauré')
    } catch (err) {
      notify.error('Restauration échouée : ' + (err?.message || err))
    }
  }

  async function handleDelete(t) {
    const ok = await confirm({
      title: 'Supprimer définitivement',
      message:
        'Cette action efface aussi l\u2019historique des vues. Préférez « Révoquer » pour garder la trace.',
      confirmLabel: 'Supprimer',
      danger: true,
    })
    if (!ok) return
    try {
      await remove(t.id)
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
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        className="relative w-full max-w-2xl max-h-[92vh] flex flex-col rounded-xl shadow-xl overflow-hidden"
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
            <Share2 className="w-4 h-4" style={{ color: 'var(--blue)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold" style={{ color: 'var(--txt)' }}>
              Partager la liste matériel
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Lien public read-only pour client / DOP / régisseur.
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <CreateFormSection
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            label={label}
            setLabel={setLabel}
            expiresAt={expiresAt}
            setExpiresAt={setExpiresAt}
            versionMode={versionMode}
            setVersionMode={setVersionMode}
            versionId={versionId}
            setVersionId={setVersionId}
            versions={versions}
            activeVersion={activeVersion}
            config={config}
            setConfig={setConfig}
            submitting={submitting}
            canSubmit={canSubmit}
            onSubmit={handleSubmit}
            hasAnyActive={activeTokens.length > 0}
            isEditMode={isEditMode}
            onCancelEdit={handleCancelEdit}
          />

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
                hint="Créez-en un ci-dessus pour partager la liste matériel."
              />
            ) : (
              <ul className="space-y-2">
                {activeTokens.map((t) => (
                  <TokenCard
                    key={t.id}
                    token={t}
                    versionsById={versionsById}
                    isEditing={editingTokenId === t.id}
                    onCopy={() => handleCopy(t)}
                    onOpen={() => handleOpen(t)}
                    onRename={() => handleRename(t)}
                    onEdit={() => handleStartEdit(t)}
                    onRevoke={() => handleRevoke(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </ul>
            )}
          </section>

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
                  style={{
                    transform: showRevoked ? 'rotate(0deg)' : 'rotate(-90deg)',
                  }}
                />
                Révoqués / expirés · {otherTokens.length}
              </button>
              {showRevoked && (
                <ul className="space-y-2">
                  {otherTokens.map((t) => (
                    <TokenCard
                      key={t.id}
                      token={t}
                      versionsById={versionsById}
                      onCopy={() => handleCopy(t)}
                      onOpen={() => handleOpen(t)}
                      onRestore={() => handleRestore(t)}
                      onDelete={() => handleDelete(t)}
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
// Form de création / édition
// ════════════════════════════════════════════════════════════════════════════

function CreateFormSection({
  open,
  onToggle,
  label,
  setLabel,
  expiresAt,
  setExpiresAt,
  versionMode,
  setVersionMode,
  versionId,
  setVersionId,
  versions,
  activeVersion,
  config,
  setConfig,
  submitting,
  canSubmit,
  onSubmit,
  hasAnyActive,
  isEditMode = false,
  onCancelEdit = null,
}) {
  const HeaderIcon = isEditMode ? Pencil : Plus
  const headerTitle = isEditMode
    ? 'Modifier le lien'
    : hasAnyActive
      ? 'Nouveau lien'
      : 'Créer votre premier lien'
  const headerSubtitle = isEditMode
    ? 'Le lien public reste le même — seules les options changent.'
    : 'Choisissez la version à exposer et les options d\u2019affichage.'

  return (
    <section
      className="rounded-lg"
      style={{
        background: 'var(--bg-elev)',
        border: `1px solid ${isEditMode ? 'var(--blue)' : 'var(--brd-sub)'}`,
      }}
    >
      <button
        type="button"
        onClick={isEditMode ? undefined : onToggle}
        disabled={isEditMode}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
        style={{ cursor: isEditMode ? 'default' : 'pointer' }}
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center"
          style={{ background: 'var(--blue-bg)' }}
        >
          <HeaderIcon className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
            {headerTitle}
          </div>
          <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            {headerSubtitle}
          </div>
        </div>
        {!isEditMode && (
          <ChevronDown
            className="w-4 h-4 transition-transform"
            style={{
              color: 'var(--txt-3)',
              transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            }}
          />
        )}
      </button>

      {open && (
        <div
          className="px-4 pb-4 pt-2 space-y-3"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {/* Label */}
          <Field label="Destinataire (optionnel)">
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Ex : Client Renault, DOP Marc…"
              maxLength={80}
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
          </Field>

          {/* Mode version */}
          <Field label="Version partagée">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <RadioCard
                checked={versionMode === 'active'}
                onClick={() => {
                  setVersionMode('active')
                  setVersionId(null)
                }}
                title="Version active"
                hint={
                  activeVersion
                    ? `Suit la version active courante (actuellement ${formatVersionLabel(activeVersion)}).`
                    : 'Suit la version active courante du projet.'
                }
              />
              <RadioCard
                checked={versionMode === 'snapshot'}
                onClick={() => setVersionMode('snapshot')}
                title="Version figée"
                hint="Snapshot d\u2019une version spécifique. Le lien ne change pas même si l\u2019admin active une autre version."
              />
            </div>
            {versionMode === 'snapshot' && (
              <select
                value={versionId || ''}
                onChange={(e) => setVersionId(e.target.value || null)}
                className="mt-2 w-full text-sm px-3 py-1.5 rounded-md outline-none"
                style={{
                  background: 'var(--bg-surf)',
                  color: 'var(--txt)',
                  border: '1px solid var(--brd)',
                }}
              >
                <option value="">Sélectionner une version…</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {formatVersionLabel(v)}
                    {v.is_active ? ' · active' : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Expiration */}
          <Field label="Expiration (optionnelle)">
            <div className="flex items-center gap-2">
              <Calendar
                className="w-3.5 h-3.5"
                style={{ color: 'var(--txt-3)' }}
              />
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
              Vide = lien permanent.
            </p>
          </Field>

          {/* Toggles config */}
          <Field label="Options d'affichage">
            <div className="space-y-1">
              <Toggle
                checked={config.show_loueurs}
                onChange={(v) => setConfig({ ...config, show_loueurs: v })}
                label="Loueur(s)"
                hint="Affiche les fournisseurs (numéro de série jamais exposé)"
              />
              <Toggle
                checked={config.show_quantites}
                onChange={(v) => setConfig({ ...config, show_quantites: v })}
                label="Quantités"
                hint="Colonne Qté"
              />
              <Toggle
                checked={config.show_remarques}
                onChange={(v) => setConfig({ ...config, show_remarques: v })}
                label="Remarques"
                hint="Notes internes (à activer si pertinentes pour le destinataire)"
              />
              <Toggle
                checked={config.show_flags}
                onChange={(v) => setConfig({ ...config, show_flags: v })}
                label="Flags (OK / Attention / Problème)"
                hint="État de chaque item"
              />
              <Toggle
                checked={config.show_checklist}
                onChange={(v) => setConfig({ ...config, show_checklist: v })}
                label="Checklist (Pré / Post / Prod)"
                hint="Mode tournage — états des cases cochées"
              />
              <Toggle
                checked={config.show_photos}
                onChange={(v) => setConfig({ ...config, show_photos: v })}
                label="Photos"
                hint="Photos d\u2019item / pelicase (V2 — pas encore visible côté public)"
              />
            </div>
          </Field>

          {/* Bouton submit */}
          <div className="flex justify-end items-center gap-2 pt-1">
            {isEditMode && onCancelEdit && (
              <button
                type="button"
                onClick={onCancelEdit}
                disabled={submitting}
                className="text-xs font-medium px-3 py-1.5 rounded-md"
                style={{
                  background: 'transparent',
                  color: 'var(--txt-2)',
                  border: '1px solid var(--brd)',
                }}
              >
                Annuler
              </button>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-all"
              style={{
                background: 'var(--blue)',
                color: 'white',
                border: '1px solid var(--blue)',
                opacity: canSubmit ? 1 : 0.5,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {isEditMode ? (
                <Pencil className="w-3 h-3" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              {submitting
                ? isEditMode
                  ? 'Enregistrement…'
                  : 'Création…'
                : isEditMode
                  ? 'Enregistrer'
                  : 'Créer le lien'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function RadioCard({ checked, onClick, title, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-md px-3 py-2 transition-all"
      style={{
        background: checked ? 'var(--blue-bg)' : 'var(--bg-surf)',
        border: `1px solid ${checked ? 'var(--blue)' : 'var(--brd)'}`,
        color: checked ? 'var(--blue)' : 'var(--txt)',
      }}
    >
      <div className="text-xs font-semibold">{title}</div>
      <div
        className="text-[10px] mt-0.5 leading-snug"
        style={{ color: checked ? 'var(--blue)' : 'var(--txt-3)' }}
      >
        {hint}
      </div>
    </button>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Card token (liste)
// ════════════════════════════════════════════════════════════════════════════

function TokenCard({
  token,
  versionsById,
  isEditing = false,
  onCopy,
  onOpen,
  onRename,
  onEdit,
  onRevoke,
  onRestore,
  onDelete,
  readOnly = false,
}) {
  const state = getMatosShareTokenState(token)
  const versionMode = getMatosShareVersionMode(token)
  const url = buildShareUrl(token.token)
  const cfg = normalizeShareConfig(token.config)
  const snapshotVersion = token.version_id ? versionsById[token.version_id] : null

  return (
    <li
      className="rounded-lg p-3"
      style={{
        background: 'var(--bg-elev)',
        border: `1px solid ${isEditing ? 'var(--blue)' : 'var(--brd-sub)'}`,
        opacity: state === 'active' ? 1 : 0.7,
      }}
    >
      {/* Label + état + version */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h4
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--txt)' }}
            >
              {token.label || 'Lien sans label'}
            </h4>
            <StateBadge state={state} expiresAt={token.expires_at} />
            <VersionBadge
              mode={versionMode}
              snapshotVersion={snapshotVersion}
            />
          </div>

          <div
            className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]"
            style={{ color: 'var(--txt-3)' }}
          >
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

          {/* URL */}
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

          {/* Config résumée */}
          <div
            className="mt-1.5 flex items-center gap-1 flex-wrap text-[10px]"
            style={{ color: 'var(--txt-3)' }}
          >
            {cfg.show_loueurs   && <ConfigPill label="Loueurs" />}
            {cfg.show_quantites && <ConfigPill label="Qté" />}
            {cfg.show_remarques && <ConfigPill label="Remarques" />}
            {cfg.show_flags     && <ConfigPill label="Flags" />}
            {cfg.show_checklist && <ConfigPill label="Checklist" />}
            {cfg.show_photos    && <ConfigPill label="Photos" />}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div
        className="mt-3 flex items-center gap-1.5 flex-wrap pt-2"
        style={{ borderTop: '1px solid var(--brd-sub)' }}
      >
        <ActionButton onClick={onCopy} icon={Copy} label="Copier" />
        <ActionButton onClick={onOpen} icon={ExternalLink} label="Ouvrir" />
        {!readOnly && state === 'active' && onEdit && (
          <ActionButton
            onClick={onEdit}
            icon={Pencil}
            label={isEditing ? 'En cours…' : 'Modifier'}
          />
        )}
        {!readOnly && state === 'active' && !onEdit && onRename && (
          <ActionButton onClick={onRename} icon={Pencil} label="Renommer" />
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {readOnly && state === 'revoked' && onRestore && (
            <ActionButton
              onClick={onRestore}
              icon={RotateCcw}
              label="Restaurer"
            />
          )}
          {!readOnly && state === 'active' && onRevoke && (
            <ActionButton
              onClick={onRevoke}
              icon={X}
              label="Révoquer"
              tone="warning"
            />
          )}
          {onDelete && (
            <ActionButton
              onClick={onDelete}
              icon={Trash2}
              label="Supprimer"
              tone="danger"
            />
          )}
        </div>
      </div>
    </li>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Sous-composants
// ════════════════════════════════════════════════════════════════════════════

function Field({ label, children }) {
  return (
    <div>
      <label
        className="block text-[11px] font-semibold mb-1"
        style={{ color: 'var(--txt-2)' }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2 cursor-pointer select-none py-0.5">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-[11px] font-semibold"
          style={{ color: 'var(--txt-2)' }}
        >
          {label}
        </div>
        {hint && (
          <div className="text-[10px] leading-snug" style={{ color: 'var(--txt-3)' }}>
            {hint}
          </div>
        )}
      </div>
    </label>
  )
}

function StateBadge({ state, expiresAt }) {
  const map = {
    active: { text: 'Actif', color: 'var(--green)' },
    expired: { text: 'Expiré', color: 'var(--amber)' },
    revoked: { text: 'Révoqué', color: 'var(--red)' },
  }
  const meta = map[state] || map.active
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{ background: `${meta.color}1a`, color: meta.color }}
      title={
        state === 'expired' && expiresAt
          ? `Expiré le ${formatDateFR(expiresAt)}`
          : undefined
      }
    >
      {meta.text}
    </span>
  )
}

function VersionBadge({ mode, snapshotVersion }) {
  if (mode === 'active') {
    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
        style={{ background: 'rgba(74,222,128,0.18)', color: 'rgb(34,150,75)' }}
        title="Le lien suit la version active courante du projet."
      >
        <Link2 className="w-2.5 h-2.5" />
        Active
      </span>
    )
  }
  // snapshot
  return (
    <span
      className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
      style={{
        background: 'rgba(251,191,36,0.20)',
        color: 'rgb(202,138,4)',
      }}
      title="Version figée — le lien ne change pas si une autre version devient active."
    >
      {snapshotVersion ? formatVersionLabel(snapshotVersion) : 'Version figée'}
    </span>
  )
}

function ConfigPill({ label }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded inline-block"
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

function ActionButton({ onClick, icon: Icon, label, tone }) {
  const colors = {
    danger: 'var(--red)',
    warning: 'var(--orange)',
  }
  const baseColor = 'var(--txt-2)'
  const toneColor = colors[tone] || baseColor
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors"
      style={{
        background: 'var(--bg-surf)',
        color: tone ? toneColor : baseColor,
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

function SkeletonList() {
  return (
    <ul className="space-y-2">
      {[0, 1].map((i) => (
        <li
          key={i}
          className="rounded-lg p-3 animate-pulse"
          style={{
            background: 'var(--bg-elev)',
            border: '1px solid var(--brd-sub)',
            height: 80,
          }}
        />
      ))}
    </ul>
  )
}

function EmptyState({ message, hint }) {
  return (
    <div
      className="rounded-lg px-4 py-6 text-center"
      style={{
        background: 'var(--bg-elev)',
        border: '1px dashed var(--brd-sub)',
      }}
    >
      <p className="text-xs font-semibold" style={{ color: 'var(--txt-2)' }}>
        {message}
      </p>
      {hint && (
        <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatVersionLabel(v) {
  if (!v) return 'Version'
  if (v.label) {
    return `${v.numero ? `V${v.numero} ` : ''}${v.label}`
  }
  return v.numero ? `V${v.numero}` : 'Version'
}

function formatDateFR(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 1) return "aujourd'hui"
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays} j`
  return `le ${formatDateFR(iso)}`
}

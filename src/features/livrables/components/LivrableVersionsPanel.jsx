// ════════════════════════════════════════════════════════════════════════════
// LivrableVersionsPanel — onglet "Versions" du drawer details (LIV-8 → LIV-9)
// ════════════════════════════════════════════════════════════════════════════
//
// Panel d'historique des versions d'un livrable. Extrait du
// `LivrableVersionsDrawer` original (LIV-8) pour cohabiter avec
// `LivrableEtapesPanel` (LIV-9) dans un drawer commun avec tabs
// (`LivrableDetailsDrawer`).
//
// Garde toute la logique interne :
//   - liste desc (sort_order desc), inline edit tous champs
//   - suppression physique avec confirm
//   - addVersion + side effect reset livrable (statut + version_label)
//   - sync bidirectionnelle livrable ↔ versions via
//     `computeLivrableStatutFromVersions` (statut terminé respecté)
//
// Props :
//   - livrable     : livrable parent
//   - versions     : Array<livrable_version> filtré sur livrable.id
//   - actions      : `useLivrables.actions`
//   - canEdit      : booléen
// ════════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  ExternalLink,
  History,
  Link2,
  Plus,
  Trash2,
} from 'lucide-react'
import {
  LIVRABLE_VERSION_STATUTS,
  computeLivrableStatutFromVersions,
} from '../../../lib/livrablesHelpers'
import { confirm, prompt as uiPrompt } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'
import VersionStatutPill from './VersionStatutPill'

export default function LivrableVersionsPanel({
  livrable,
  versions = [],
  actions,
  canEdit = true,
}) {
  // Versions triées DESC (la plus récente en haut)
  const ordered = useMemo(() => {
    return versions
      .slice()
      .sort((a, b) => (b?.sort_order ?? 0) - (a?.sort_order ?? 0))
  }, [versions])

  // ─── Helper : sync statut livrable depuis une liste simulée de versions ──
  // Centralise la règle "le livrable suit la version la plus récente" :
  //   - si version la plus récente est `valide` → livrable `valide`
  //   - sinon → livrable `a_valider`
  //   - on n'écrase JAMAIS un statut terminé (`livre`, `archive`)
  const syncLivrableStatut = useCallback(
    async (simulatedVersions, extraPatch = {}) => {
      if (!livrable) return
      const targetStatut = computeLivrableStatutFromVersions(
        livrable,
        simulatedVersions,
      )
      const patch = { ...extraPatch }
      if (targetStatut && targetStatut !== livrable.statut) {
        patch.statut = targetStatut
      }
      if (Object.keys(patch).length === 0) return
      try {
        await actions.updateLivrable(livrable.id, patch)
      } catch (err) {
        notify.error('Sync livrable échoué : ' + (err?.message || err))
      }
    },
    [actions, livrable],
  )

  // ─── Ajout d'une version ─────────────────────────────────────────────────
  const [adding, setAdding] = useState(false)
  const handleAddVersion = useCallback(async () => {
    if (!canEdit || !livrable || adding) return
    setAdding(true)
    try {
      const created = await actions.addVersion(livrable.id, {})
      const nextLabel = created?.numero_label || livrable.version_label || null
      const simulated = [...versions, created].filter(Boolean)
      await syncLivrableStatut(simulated, { version_label: nextLabel })
    } catch (err) {
      notify.error('Création version impossible : ' + (err?.message || err))
    } finally {
      setAdding(false)
    }
  }, [actions, adding, canEdit, livrable, versions, syncLivrableStatut])

  return (
    <div className="flex flex-col h-full">
      {/* Liste des versions */}
      <div className="flex-1 overflow-y-auto p-4">
        {ordered.length === 0 ? (
          <EmptyVersions canEdit={canEdit} onAdd={handleAddVersion} adding={adding} />
        ) : (
          <div className="flex flex-col gap-3">
            {ordered.map((v) => (
              <VersionCard
                key={v.id}
                version={v}
                versions={versions}
                actions={actions}
                canEdit={canEdit}
                onSyncLivrable={syncLivrableStatut}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer : ajouter une nouvelle version (si non-empty + canEdit) */}
      {canEdit && ordered.length > 0 && (
        <footer
          className="px-4 py-3"
          style={{
            borderTop: '1px solid var(--brd-sub)',
            background: 'var(--bg-surf)',
          }}
        >
          <button
            type="button"
            onClick={handleAddVersion}
            disabled={adding}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{
              background: adding ? 'var(--bg-hov)' : 'var(--blue-bg)',
              color: 'var(--blue)',
              opacity: adding ? 0.6 : 1,
            }}
          >
            <Plus className="w-4 h-4" />
            Nouvelle version
          </button>
          <p
            className="text-[11px] text-center mt-2"
            style={{ color: 'var(--txt-3)' }}
          >
            Repassera le livrable en « À valider ».
          </p>
        </footer>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// EmptyVersions — état vide avec CTA
// ════════════════════════════════════════════════════════════════════════════

function EmptyVersions({ canEdit, onAdd, adding }) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center py-12 px-6 rounded-lg"
      style={{
        background: 'var(--bg-surf)',
        border: '1px dashed var(--brd-sub)',
      }}
    >
      <History
        className="w-8 h-8 mb-3 opacity-30"
        style={{ color: 'var(--txt-3)' }}
      />
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
        Aucune version envoyée
      </p>
      <p className="text-xs mb-4 max-w-xs" style={{ color: 'var(--txt-3)' }}>
        Ajoute une première version quand tu envoies un cut au client. Tu pourras
        tracer les retours et suivre le statut de validation.
      </p>
      {canEdit && (
        <button
          type="button"
          onClick={onAdd}
          disabled={adding}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium"
          style={{
            background: 'var(--blue-bg)',
            color: 'var(--blue)',
            opacity: adding ? 0.6 : 1,
          }}
        >
          <Plus className="w-4 h-4" />
          Première version
        </button>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// VersionCard — carte d'une version (inline edit tous champs)
// ════════════════════════════════════════════════════════════════════════════

function VersionCard({ version, versions = [], actions, canEdit, onSyncLivrable }) {
  // États locaux pour inline edit
  const [numeroLabel, setNumeroLabel] = useState(version.numero_label || '')
  const [dateEnvoi, setDateEnvoi] = useState(version.date_envoi || '')
  const [feedback, setFeedback] = useState(version.feedback_client || '')

  useEffect(() => setNumeroLabel(version.numero_label || ''), [version.numero_label])
  useEffect(() => setDateEnvoi(version.date_envoi || ''), [version.date_envoi])
  useEffect(() => setFeedback(version.feedback_client || ''), [version.feedback_client])

  const saveField = useCallback(
    async (field, value, { nullIfEmpty = true } = {}) => {
      if (!canEdit) return
      const current = version[field] ?? (nullIfEmpty ? null : '')
      const nextValue =
        nullIfEmpty && (value === '' || value == null) ? null : value
      if (nextValue === current) return
      try {
        await actions.updateVersion(version.id, { [field]: nextValue })
      } catch (err) {
        notify.error('Erreur sauvegarde : ' + (err?.message || err))
      }
    },
    [actions, canEdit, version],
  )

  const handleStatutChange = useCallback(
    async (next) => {
      if (!canEdit || next === version.statut_validation) return
      try {
        await actions.updateVersion(version.id, { statut_validation: next })
        // Side effect : on simule l'update local pour calculer le statut
        // cible du livrable via `computeLivrableStatutFromVersions`. La
        // règle est : on suit la version la plus récente. Si on édite une
        // version intermédiaire, le statut du livrable peut changer.
        const simulated = versions.map((v) =>
          v.id === version.id ? { ...v, statut_validation: next } : v,
        )
        await onSyncLivrable?.(simulated)
      } catch (err) {
        notify.error('Erreur statut version : ' + (err?.message || err))
      }
    },
    [actions, canEdit, version.id, version.statut_validation, versions, onSyncLivrable],
  )

  const handleEditLink = useCallback(async () => {
    if (!canEdit) return
    const next = await uiPrompt({
      title: 'Lien Frame.io de la version',
      message: 'Colle l\'URL Frame.io (laisse vide pour retirer).',
      placeholder: 'https://app.frame.io/…',
      initialValue: version.lien_frame || '',
      confirmLabel: 'Enregistrer',
    })
    if (next === null) return
    try {
      await actions.updateVersion(version.id, {
        lien_frame: next.trim() || null,
      })
    } catch (err) {
      notify.error('Erreur lien : ' + (err?.message || err))
    }
  }, [actions, canEdit, version])

  const handleDelete = useCallback(async () => {
    if (!canEdit) return
    const ok = await confirm({
      title: `Supprimer la version "${version.numero_label || 'sans label'}" ?`,
      message:
        'Suppression définitive (pas de corbeille pour les versions). Le livrable lui-même reste intact.',
      confirmLabel: 'Supprimer',
      cancelLabel: 'Annuler',
      danger: true,
    })
    if (!ok) return
    try {
      await actions.deleteVersion(version.id)
      // Side effect : si on supprime la version la plus récente, le statut
      // du livrable doit suivre la nouvelle "plus récente" restante.
      const simulated = versions.filter((v) => v.id !== version.id)
      await onSyncLivrable?.(simulated)
      notify.success('Version supprimée')
    } catch (err) {
      notify.error('Erreur suppression : ' + (err?.message || err))
    }
  }, [actions, canEdit, version.id, version.numero_label, versions, onSyncLivrable])

  const statut =
    LIVRABLE_VERSION_STATUTS[version.statut_validation] ||
    LIVRABLE_VERSION_STATUTS.en_attente

  return (
    <article
      className="rounded-lg p-3 flex flex-col gap-2.5"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd)',
        borderLeft: `3px solid ${statut.color}`,
      }}
    >
      {/* Ligne 1 : numero_label + date + statut + delete */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={numeroLabel}
          onChange={(e) => setNumeroLabel(e.target.value)}
          onBlur={() =>
            saveField('numero_label', numeroLabel.trim(), { nullIfEmpty: false })
          }
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          disabled={!canEdit}
          placeholder="V?"
          className="bg-transparent focus:outline-none text-sm font-bold font-mono w-20 shrink-0"
          style={{
            color: 'var(--txt)',
            cursor: canEdit ? 'text' : 'default',
          }}
        />

        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-3)' }}>
          <Calendar className="w-3 h-3" />
          <input
            type="date"
            value={dateEnvoi}
            onChange={(e) => setDateEnvoi(e.target.value)}
            onBlur={() => saveField('date_envoi', dateEnvoi)}
            disabled={!canEdit}
            className="bg-transparent focus:outline-none"
            style={{
              color: dateEnvoi ? 'var(--txt-2)' : 'var(--txt-3)',
              cursor: canEdit ? 'text' : 'default',
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-1">
          <VersionStatutPill
            value={version.statut_validation}
            onChange={handleStatutChange}
            canEdit={canEdit}
            size="xs"
            align="right"
          />
          {canEdit && (
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Supprimer la version"
              className="p-1 rounded shrink-0"
              style={{ color: 'var(--txt-3)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--red-bg)'
                e.currentTarget.style.color = 'var(--red)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Ligne 2 : lien Frame */}
      <div>
        {version.lien_frame ? (
          <div className="flex items-center gap-2">
            <a
              href={version.lien_frame}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded"
              style={{
                background: 'var(--blue-bg)',
                color: 'var(--blue)',
                fontWeight: 500,
                maxWidth: '100%',
              }}
              title={version.lien_frame}
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              <span className="truncate">{shortUrl(version.lien_frame)}</span>
            </a>
            {canEdit && (
              <button
                type="button"
                onClick={handleEditLink}
                className="text-[11px] underline"
                style={{ color: 'var(--txt-3)' }}
              >
                Modifier
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={handleEditLink}
            className="flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-dashed"
            style={{
              borderColor: 'var(--brd-sub)',
              color: 'var(--txt-3)',
            }}
          >
            <Link2 className="w-3 h-3" />
            Ajouter un lien Frame.io
          </button>
        ) : null}
      </div>

      {/* Ligne 3 : feedback client (textarea inline) */}
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onBlur={() => saveField('feedback_client', feedback.trim())}
        disabled={!canEdit}
        placeholder="Feedback client / retours…"
        rows={2}
        className="w-full bg-transparent focus:outline-none text-xs resize-y rounded px-2 py-1.5"
        style={{
          color: 'var(--txt-2)',
          border: '1px solid var(--brd-sub)',
          background: 'var(--bg-elev)',
          minHeight: '48px',
        }}
      />
    </article>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Raccourcit une URL pour l'affichage dans une chip (host + path court). */
function shortUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    const host = u.host.replace(/^www\./, '')
    const path = u.pathname
    if (path.length <= 20) return host + path
    return host + path.slice(0, 18) + '…'
  } catch {
    return url.length > 36 ? url.slice(0, 34) + '…' : url
  }
}

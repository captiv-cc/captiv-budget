// ════════════════════════════════════════════════════════════════════════════
// PlansShareModal — Gestion des tokens de partage public plans (PLANS-SHARE-5c)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis le bouton "Partager" du header de PlansTab. Permet
// aux utilisateurs autorisés (canEdit plans) de :
//   1. Créer un nouveau lien /share/plans/:token avec :
//        - Label libre (ex: "Régisseur Paul")
//        - Périmètre radio : "Tous les plans" (par défaut, suit l'évolution
//          du projet) / "Sélection" (checklist des plans, groupés par
//          catégorie pour la lisibilité)
//        - Toggle "Inclure les anciennes versions"
//        - Expiration optionnelle (date)
//   2. Lister les liens actifs + révoqués du projet
//   3. Copier l'URL, ouvrir, révoquer/restaurer, supprimer
//
// Pattern aligné sur TechlistShareModal.jsx (P4.2C) et MaterielShareModal.jsx.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  Copy,
  ExternalLink,
  History,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import {
  buildShareUrl,
  getPlansShareTokenState,
  SHARE_SCOPES,
} from '../../lib/plansShare'
import { usePlansShareTokens } from '../../hooks/usePlansShareTokens'
import { confirm } from '../../lib/confirm'
import { notify } from '../../lib/notify'

export default function PlansShareModal({
  open,
  onClose,
  projectId,
  // Liste des plans actifs (non archivés) — utilisée pour la checklist
  // de sélection. Fournie par PlansTab depuis usePlans (évite un double load).
  plans = [],
  // Catégories actives de l'org (pour grouper la sélection).
  categories = [],
}) {
  const { tokens, loading, create, revoke, restore, remove } = usePlansShareTokens(
    open ? projectId : null,
  )

  // ─── Form state ────────────────────────────────────────────────────────
  const [formOpen, setFormOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [label, setLabel] = useState('')
  const [scope, setScope] = useState(SHARE_SCOPES.ALL)
  const [selectedIds, setSelectedIds] = useState([])
  const [showVersions, setShowVersions] = useState(false)
  const [expiresAt, setExpiresAt] = useState('')

  // Pré-déplie le form au 1er coup si pas de token actif.
  useEffect(() => {
    if (!open) return
    const hasActive = tokens.some((t) => getPlansShareTokenState(t) === 'active')
    setFormOpen(!hasActive)
  }, [open, tokens])

  // Reset form à la fermeture.
  useEffect(() => {
    if (!open) {
      setLabel('')
      setScope(SHARE_SCOPES.ALL)
      setSelectedIds([])
      setShowVersions(false)
      setExpiresAt('')
    }
  }, [open])

  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getPlansShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  if (!open) return null

  const totalPlansCount = plans.length

  async function handleCreate() {
    if (creating) return
    if (scope === SHARE_SCOPES.SELECTION && selectedIds.length === 0) {
      notify.error('Sélectionnez au moins un plan')
      return
    }
    setCreating(true)
    try {
      const expiresIso = expiresAt ? `${expiresAt}T23:59:59` : null
      const newToken = await create({
        label: label.trim() || null,
        scope,
        selectedPlanIds: scope === SHARE_SCOPES.SELECTION ? selectedIds : [],
        showVersions,
        expiresAt: expiresIso,
      })
      try {
        await navigator.clipboard.writeText(buildShareUrl(newToken.token))
        notify.success('Lien créé et copié dans le presse-papiers')
      } catch {
        notify.success('Lien créé')
      }
      // Reset
      setLabel('')
      setScope(SHARE_SCOPES.ALL)
      setSelectedIds([])
      setShowVersions(false)
      setExpiresAt('')
      setFormOpen(false)
    } catch (err) {
      console.error('[PlansShareModal] create error', err)
      notify.error('Création échouée : ' + (err?.message || err))
    } finally {
      setCreating(false)
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

  async function handleRevoke(t) {
    const ok = await confirm({
      title: 'Révoquer ce lien',
      message:
        'Le destinataire ne pourra plus accéder aux plans. L\'historique de vues est conservé.',
      confirmLabel: 'Révoquer',
      destructive: true,
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
      title: 'Supprimer définitivement ce lien',
      message: 'L\'historique de vues sera effacé. Préférez "Révoquer" pour garder la trace.',
      confirmLabel: 'Supprimer',
      destructive: true,
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
              Partager les plans
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Crée un lien public read-only pour un destinataire externe.
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
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* ─── Form de création ──────────────────────────────────────── */}
          {formOpen ? (
            <CreateForm
              label={label}
              setLabel={setLabel}
              scope={scope}
              setScope={setScope}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              showVersions={showVersions}
              setShowVersions={setShowVersions}
              expiresAt={expiresAt}
              setExpiresAt={setExpiresAt}
              plans={plans}
              categories={categories}
              creating={creating}
              onCancel={() => setFormOpen(false)}
              onCreate={handleCreate}
              hasExistingTokens={tokens.length > 0}
            />
          ) : (
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="w-full text-sm py-2 rounded-md flex items-center justify-center gap-1.5 transition-colors"
              style={{
                background: 'var(--blue-bg)',
                color: 'var(--blue)',
                border: '1px dashed var(--blue-brd)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
            >
              <Plus className="w-3.5 h-3.5" />
              Nouveau lien de partage
            </button>
          )}

          {/* ─── Liste des tokens ──────────────────────────────────────── */}
          <div className="space-y-3">
            {loading ? (
              <p className="text-xs text-center py-4" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </p>
            ) : tokens.length === 0 ? (
              <p
                className="text-xs text-center py-6 italic"
                style={{ color: 'var(--txt-3)' }}
              >
                Aucun lien de partage pour ce projet.
              </p>
            ) : (
              <>
                {activeTokens.length > 0 && (
                  <Section title={`Actifs (${activeTokens.length})`}>
                    {activeTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        totalPlansCount={totalPlansCount}
                        onCopy={() => handleCopy(t)}
                        onOpen={() => handleOpen(t)}
                        onRevoke={() => handleRevoke(t)}
                      />
                    ))}
                  </Section>
                )}
                {otherTokens.length > 0 && (
                  <Section
                    title={`Révoqués / expirés (${otherTokens.length})`}
                    muted
                  >
                    {otherTokens.map((t) => (
                      <TokenRow
                        key={t.id}
                        token={t}
                        totalPlansCount={totalPlansCount}
                        muted
                        onCopy={() => handleCopy(t)}
                        onOpen={() => handleOpen(t)}
                        onRestore={() => handleRestore(t)}
                        onDelete={() => handleDelete(t)}
                      />
                    ))}
                  </Section>
                )}
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <footer
          className="flex items-center justify-end gap-2 px-5 py-3 shrink-0"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md"
            style={{
              background: 'transparent',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            Fermer
          </button>
        </footer>
      </div>
    </div>
  )
}

// ─── Sous-composants ────────────────────────────────────────────────────────

function Section({ title, muted = false, children }) {
  return (
    <div>
      <p
        className="text-[10px] uppercase tracking-widest font-bold mb-2"
        style={{ color: muted ? 'var(--txt-3)' : 'var(--txt-2)', opacity: muted ? 0.7 : 1 }}
      >
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function CreateForm({
  label,
  setLabel,
  scope,
  setScope,
  selectedIds,
  setSelectedIds,
  showVersions,
  setShowVersions,
  expiresAt,
  setExpiresAt,
  plans,
  categories,
  creating,
  onCancel,
  onCreate,
  hasExistingTokens,
}) {
  return (
    <div
      className="rounded-md p-3 space-y-3"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      <p
        className="text-[10px] uppercase tracking-widest font-bold"
        style={{ color: 'var(--blue)' }}
      >
        Nouveau lien
      </p>

      {/* Label */}
      <div>
        <label
          className="block text-[11px] font-semibold mb-1"
          style={{ color: 'var(--txt-2)' }}
        >
          Libellé interne (optionnel)
        </label>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder='Ex: "Régisseur Paul", "Équipe lumière"…'
          maxLength={80}
          className="input text-sm h-9 w-full"
        />
      </div>

      {/* Scope (radio) */}
      <div>
        <label
          className="block text-[11px] font-semibold mb-1.5"
          style={{ color: 'var(--txt-2)' }}
        >
          Périmètre du partage
        </label>
        <div className="flex flex-col gap-1.5">
          <ScopeRadio
            checked={scope === SHARE_SCOPES.ALL}
            onChange={() => setScope(SHARE_SCOPES.ALL)}
            label="Tous les plans"
            hint={`${plans.length} plan${plans.length > 1 ? 's' : ''} actif${plans.length > 1 ? 's' : ''} aujourd'hui — la liste suit l'évolution du projet.`}
          />
          <ScopeRadio
            checked={scope === SHARE_SCOPES.SELECTION}
            onChange={() => setScope(SHARE_SCOPES.SELECTION)}
            label="Sélection manuelle"
            hint="Choisis les plans à exposer un par un (figé)."
          />
        </div>
      </div>

      {/* Sélection (visible si scope=selection) */}
      {scope === SHARE_SCOPES.SELECTION && (
        <PlanSelectionList
          plans={plans}
          categories={categories}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
        />
      )}

      {/* Toggle versions */}
      <div>
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showVersions}
            onChange={(e) => setShowVersions(e.target.checked)}
            className="mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div
              className="text-[11px] font-semibold flex items-center gap-1.5"
              style={{ color: 'var(--txt-2)' }}
            >
              <History
                className="w-3 h-3"
                style={{ color: showVersions ? 'var(--blue)' : 'var(--txt-3)' }}
              />
              Inclure les anciennes versions
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
              {showVersions
                ? 'Le destinataire pourra naviguer entre V1, V2… de chaque plan.'
                : 'Seule la version courante de chaque plan est accessible.'}
            </div>
          </div>
        </label>
      </div>

      {/* Expiration */}
      <div>
        <label
          className="block text-[11px] font-semibold mb-1"
          style={{ color: 'var(--txt-2)' }}
        >
          Expiration (optionnelle)
        </label>
        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--txt-3)' }} />
          <input
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="input text-sm h-9 flex-1"
          />
          {expiresAt && (
            <button
              type="button"
              onClick={() => setExpiresAt('')}
              className="text-[11px]"
              style={{ color: 'var(--txt-3)' }}
            >
              Effacer
            </button>
          )}
        </div>
        <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
          Vide = lien permanent (à utiliser avec parcimonie).
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        {hasExistingTokens && (
          <button
            type="button"
            onClick={onCancel}
            disabled={creating}
            className="text-xs px-3 py-1.5 rounded-md"
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
          onClick={onCreate}
          disabled={creating}
          className="text-xs px-3 py-1.5 rounded-md font-semibold"
          style={{
            background: 'var(--blue)',
            color: '#fff',
            opacity: creating ? 0.6 : 1,
            cursor: creating ? 'wait' : 'pointer',
          }}
        >
          {creating ? 'Création…' : 'Créer le lien'}
        </button>
      </div>
    </div>
  )
}

function ScopeRadio({ checked, onChange, label, hint }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer select-none">
      <input
        type="radio"
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div
          className="text-[12px] font-semibold"
          style={{ color: checked ? 'var(--txt)' : 'var(--txt-2)' }}
        >
          {label}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
          {hint}
        </div>
      </div>
    </label>
  )
}

function PlanSelectionList({ plans, categories, selectedIds, setSelectedIds }) {
  const [search, setSearch] = useState('')

  // Groupe les plans par catégorie (id null = sans catégorie en bas).
  const grouped = useMemo(() => {
    const groups = new Map()
    const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const q = norm(search.trim())
    const filtered = q
      ? plans.filter((p) => {
          if (norm(p.name).includes(q)) return true
          if (norm(p.description).includes(q)) return true
          if (Array.isArray(p.tags) && p.tags.some((t) => norm(t).includes(q))) return true
          return false
        })
      : plans
    for (const p of filtered) {
      const key = p.category_id || '__none'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(p)
    }
    // Tri : catégories par sort_order, "sans catégorie" en dernier.
    const sorted = []
    for (const c of categories) {
      if (groups.has(c.id)) sorted.push({ cat: c, items: groups.get(c.id) })
    }
    if (groups.has('__none')) {
      sorted.push({ cat: null, items: groups.get('__none') })
    }
    return sorted
  }, [plans, categories, search])

  const allSelected = plans.length > 0 && selectedIds.length === plans.length
  const noneSelected = selectedIds.length === 0

  function toggle(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function selectAll() {
    setSelectedIds(plans.map((p) => p.id))
  }

  function clearAll() {
    setSelectedIds([])
  }

  return (
    <div
      className="rounded-md"
      style={{
        background: 'var(--bg-surf)',
        border: '1px solid var(--brd-sub)',
      }}
    >
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-2.5 py-2"
        style={{ borderBottom: '1px solid var(--brd-sub)' }}
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--txt-3)' }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un plan…"
            className="text-xs bg-transparent flex-1 min-w-0 outline-none"
            style={{ color: 'var(--txt)' }}
          />
        </div>
        <span className="text-[10px] tabular-nums" style={{ color: 'var(--txt-3)' }}>
          {selectedIds.length}/{plans.length}
        </span>
        <button
          type="button"
          onClick={allSelected ? clearAll : selectAll}
          className="text-[10px] font-semibold"
          style={{ color: 'var(--blue)' }}
        >
          {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
        </button>
      </div>
      {/* Liste */}
      <div className="max-h-56 overflow-y-auto py-1">
        {plans.length === 0 ? (
          <p className="text-[11px] text-center py-3 italic" style={{ color: 'var(--txt-3)' }}>
            Aucun plan dans ce projet.
          </p>
        ) : grouped.length === 0 ? (
          <p className="text-[11px] text-center py-3 italic" style={{ color: 'var(--txt-3)' }}>
            Aucun résultat.
          </p>
        ) : (
          grouped.map(({ cat, items }) => (
            <div key={cat?.id || '__none'} className="mb-1">
              <div
                className="text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 flex items-center gap-1.5"
                style={{ color: 'var(--txt-3)' }}
              >
                {cat ? (
                  <>
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: cat.color }}
                    />
                    {cat.label}
                  </>
                ) : (
                  'Sans catégorie'
                )}
              </div>
              {items.map((p) => {
                const checked = selectedIds.includes(p.id)
                return (
                  <label
                    key={p.id}
                    className="flex items-center gap-2 px-2.5 py-1 cursor-pointer select-none"
                    style={{
                      background: checked ? 'var(--blue-bg)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) e.currentTarget.style.background = 'var(--bg-hov)'
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                    />
                    <span
                      className="text-xs flex-1 min-w-0 truncate"
                      style={{
                        color: checked ? 'var(--txt)' : 'var(--txt-2)',
                        fontWeight: checked ? 600 : 400,
                      }}
                    >
                      {p.name}
                    </span>
                    {p.current_version > 1 && (
                      <span
                        className="text-[10px]"
                        style={{ color: 'var(--txt-3)' }}
                        title={`Version ${p.current_version}`}
                      >
                        V{p.current_version}
                      </span>
                    )}
                    <span
                      className="text-[10px] uppercase font-semibold"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      {p.file_type}
                    </span>
                  </label>
                )
              })}
            </div>
          ))
        )}
      </div>
      {noneSelected && (
        <p
          className="text-[10px] px-2.5 py-1.5 italic"
          style={{
            color: 'var(--amber)',
            borderTop: '1px solid var(--brd-sub)',
          }}
        >
          Sélectionne au moins un plan pour pouvoir créer le lien.
        </p>
      )}
    </div>
  )
}

function TokenRow({
  token,
  totalPlansCount,
  muted = false,
  onCopy,
  onOpen,
  onRevoke,
  onRestore,
  onDelete,
}) {
  const state = getPlansShareTokenState(token)
  const stateLabels = {
    active: { text: 'Actif', color: 'var(--green)' },
    expired: { text: 'Expiré', color: 'var(--amber)' },
    revoked: { text: 'Révoqué', color: 'var(--red)' },
  }
  const stateMeta = stateLabels[state] || stateLabels.active

  // Formatage du périmètre.
  const isAll = token.scope === SHARE_SCOPES.ALL
  const selectedCount = Array.isArray(token.selected_plan_ids)
    ? token.selected_plan_ids.length
    : 0

  return (
    <div
      className="rounded-md px-3 py-2.5 flex items-center gap-3"
      style={{
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {token.label || `Lien #${(token.token || '').slice(0, 6)}`}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: `${stateMeta.color}1a`,
              color: stateMeta.color,
              fontWeight: 600,
            }}
          >
            {stateMeta.text}
          </span>
          {/* Scope */}
          <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            ·{' '}
            {isAll
              ? `Tous les plans${totalPlansCount ? ` (${totalPlansCount})` : ''}`
              : `${selectedCount} plan${selectedCount > 1 ? 's' : ''} sélectionné${selectedCount > 1 ? 's' : ''}`}
          </span>
          {token.show_versions && (
            <span
              className="text-[10px] inline-flex items-center gap-0.5"
              style={{ color: 'var(--txt-3)' }}
              title="Versions historiques accessibles"
            >
              <History className="w-2.5 h-2.5" />
              Versions
            </span>
          )}
        </div>
        <div
          className="text-[10px] mt-0.5 truncate"
          style={{ color: 'var(--txt-3)' }}
        >
          {token.view_count > 0
            ? `${token.view_count} vue${token.view_count > 1 ? 's' : ''}`
            : 'Pas encore consulté'}
          {token.last_accessed_at &&
            ' · dernière vue ' + formatRelativeDate(token.last_accessed_at)}
          {token.expires_at && ' · expire ' + formatDate(token.expires_at)}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {state === 'active' && (
          <>
            <IconBtn title="Copier le lien" onClick={onCopy}>
              <Copy className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Ouvrir" onClick={onOpen}>
              <ExternalLink className="w-3.5 h-3.5" />
            </IconBtn>
            <IconBtn title="Révoquer" danger onClick={onRevoke}>
              <X className="w-3.5 h-3.5" />
            </IconBtn>
          </>
        )}
        {state !== 'active' && (
          <>
            {onRestore && state === 'revoked' && (
              <IconBtn title="Restaurer" onClick={onRestore}>
                <RotateCcw className="w-3.5 h-3.5" />
              </IconBtn>
            )}
            {onDelete && (
              <IconBtn title="Supprimer définitivement" danger onClick={onDelete}>
                <Trash2 className="w-3.5 h-3.5" />
              </IconBtn>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function IconBtn({ title, onClick, danger = false, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1.5 rounded transition-colors"
      style={{ color: 'var(--txt-3)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hov)'
        e.currentTarget.style.color = danger ? 'var(--red)' : 'var(--txt)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--txt-3)'
      }}
    >
      {children}
    </button>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

function formatRelativeDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays < 1) return "aujourd'hui"
  if (diffDays === 1) return 'hier'
  if (diffDays < 7) return `il y a ${diffDays} j`
  return `le ${formatDate(iso)}`
}

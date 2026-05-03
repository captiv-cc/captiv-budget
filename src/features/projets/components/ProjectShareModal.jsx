// ════════════════════════════════════════════════════════════════════════════
// ProjectShareModal — Gestion des tokens portail projet (PROJECT-SHARE-4)
// ════════════════════════════════════════════════════════════════════════════
//
// Modale ouverte depuis le bouton "Partager" du header projet (ProjetLayout).
// Permet aux admins / charge_prod / coordinateurs (gating isInternal côté
// caller) de :
//   1. Créer un nouveau lien /share/projet/:token avec :
//      - Un libellé interne (Régisseur Paul, Client Renault, …)
//      - Une expiration optionnelle
//      - Une liste de pages activées (équipe, livrables, …)
//      - Une config par page (scope lot pour équipe, calendar_level pour
//        livrables, etc.) avec sub-form repliable.
//   2. Lister les liens actifs + révoqués/expirés du projet.
//   3. Copier l'URL du HUB, ouvrir, renommer, révoquer/restaurer, supprimer.
//
// Pattern cousin : TechlistShareModal (équipe), LivrableShareModal (livrables).
// La différence : ici on assemble plusieurs pages dans un même token, avec
// pour chaque page sa propre sub-config.
//
// Pour ajouter une page : entrée dans PAGE_DEFS ci-dessous + composant
// SubFormForPage correspondant. SHARE_PAGES (lib) reste la source de vérité
// "page registrée côté DB".
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import {
  DEFAULT_PAGE_CONFIGS,
  SHARE_PAGES,
  buildProjectShareUrl,
  getProjectShareTokenState,
  isProjectShareTokenProtected,
  totalViews,
} from '../../../lib/projectShare'
import {
  CALENDAR_LEVELS,
  CALENDAR_LEVEL_LABELS,
  CALENDAR_LEVEL_DESCRIPTIONS,
} from '../../../lib/livrableShare'
import { useProjectShareTokens } from '../../../hooks/useProjectShareTokens'
import { confirm } from '../../../lib/confirm'
import { notify } from '../../../lib/notify'

// ─── Métadonnées des pages (icône, couleur, libellé) ────────────────────────
//
// Source de vérité pour le rendu UI des pages dans la modale (header de
// section + pill dans la liste des tokens). Aligné avec le PAGE_REGISTRY du
// hub (ProjectShareSession) — les couleurs / icônes doivent matcher l'UI
// publique pour cohérence visuelle.
const PAGE_DEFS = {
  equipe: {
    label: 'Équipe',
    description: 'Crew list — postes, présence, secteurs',
    Icon: Users,
    color: 'var(--purple)',
    bgColor: 'var(--purple-bg)',
  },
  livrables: {
    label: 'Livrables',
    description: 'Suivi des livrables, versions, dates',
    Icon: CheckSquare,
    color: 'var(--blue)',
    bgColor: 'var(--blue-bg)',
  },
}

// ─── Helpers config ─────────────────────────────────────────────────────────
function makeInitialConfigs() {
  // Clone profond des DEFAULT_PAGE_CONFIGS pour avoir un state de form modifiable.
  const out = {}
  for (const [k, v] of Object.entries(DEFAULT_PAGE_CONFIGS)) {
    out[k] = { ...v }
  }
  return out
}

function makeInitialEnabled() {
  // Par défaut, on coche toutes les pages registrées — l'admin peut décocher
  // celles qu'il ne veut pas exposer pour ce destinataire.
  return SHARE_PAGES.slice()
}

// ════════════════════════════════════════════════════════════════════════════
// Modale principale
// ════════════════════════════════════════════════════════════════════════════
export default function ProjectShareModal({
  open,
  onClose,
  projectId,
  // Lots du projet — pour le sub-form équipe (dropdown de scope). Optionnel :
  // si non fourni ou tableau vide, le dropdown est caché et scope='all'.
  lots = [],
  lotInfoMap = {},
}) {
  const { tokens, loading, create, update, revoke, restore, remove } =
    useProjectShareTokens(open ? projectId : null)

  const [showRevoked, setShowRevoked] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state. `editingTokenId === null` → mode création ; sinon mode édition
  // d'un token existant (le form est pré-rempli avec ses valeurs et le submit
  // appelle update au lieu de create).
  const [editingTokenId, setEditingTokenId] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [enabledPages, setEnabledPages] = useState(makeInitialEnabled)
  const [pageConfigs, setPageConfigs] = useState(makeInitialConfigs)

  // Password gate (PROJECT-SHARE-PWD)
  //   - passwordEnabled : true = portail protégé (input visible)
  //   - passwordValue   : mdp en clair tapé dans le form (jamais persisté en
  //                       state au refetch — purge à chaque ouverture)
  //   - passwordHint    : indice optionnel (visible en clair côté gate)
  //   - hadPasswordOnEntry : true si on est entré en mode édition d'un token
  //                          déjà protégé. Permet de garder le mdp inchangé
  //                          si l'admin ne re-tape rien.
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [passwordValue, setPasswordValue] = useState('')
  const [passwordHint, setPasswordHint] = useState('')
  const [hadPasswordOnEntry, setHadPasswordOnEntry] = useState(false)

  // Pré-déplie le form si aucun token actif (UX au 1er coup d'œil) — mais
  // seulement en mode création (l'édition gère elle-même l'ouverture).
  useEffect(() => {
    if (!open) return
    if (editingTokenId) return
    const hasActive = tokens.some(
      (t) => getProjectShareTokenState(t) === 'active',
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
      setEnabledPages(makeInitialEnabled())
      setPageConfigs(makeInitialConfigs())
      setPasswordEnabled(false)
      setPasswordValue('')
      setPasswordHint('')
      setHadPasswordOnEntry(false)
    }
  }, [open])

  const { activeTokens, otherTokens } = useMemo(() => {
    const active = []
    const other = []
    for (const t of tokens) {
      if (getProjectShareTokenState(t) === 'active') active.push(t)
      else other.push(t)
    }
    return { activeTokens: active, otherTokens: other }
  }, [tokens])

  if (!open) return null

  const togglePage = (pageKey) => {
    setEnabledPages((prev) =>
      prev.includes(pageKey)
        ? prev.filter((p) => p !== pageKey)
        : [...prev, pageKey],
    )
  }

  const updatePageConfig = (pageKey, partial) => {
    setPageConfigs((prev) => ({
      ...prev,
      [pageKey]: { ...prev[pageKey], ...partial },
    }))
  }

  const isEditMode = editingTokenId !== null
  // Password validation : en création, si le toggle est activé il FAUT un
  // mdp non vide. En édition, si on entre avec un mdp existant, on peut
  // laisser le champ vide pour garder l'ancien (cf. computePasswordPayload).
  const passwordOk = !passwordEnabled
    ? true
    : isEditMode && hadPasswordOnEntry
      ? true // ok de garder l'ancien
      : passwordValue.length > 0
  const canSubmit = enabledPages.length > 0 && passwordOk && !submitting

  // Bascule la modale en mode édition d'un token existant : pré-remplit tous
  // les champs du form avec les valeurs du token et l'ouvre. Préserve la
  // shape complète des configs (DEFAULT merge avec ce qui était stocké) pour
  // que les sub-forms aient toutes les clés attendues.
  function handleStartEdit(t) {
    const tokenEnabled = Array.isArray(t.enabled_pages)
      ? t.enabled_pages.filter((p) => SHARE_PAGES.includes(p))
      : []
    const stored = (t.page_configs && typeof t.page_configs === 'object')
      ? t.page_configs
      : {}
    const mergedConfigs = makeInitialConfigs()
    for (const p of SHARE_PAGES) {
      mergedConfigs[p] = {
        ...mergedConfigs[p],
        ...(stored[p] || {}),
      }
    }
    // expires_at en DB est un timestamptz ISO, l'input type=date attend
    // 'YYYY-MM-DD'. On tronque la partie temps.
    const expiresShort = t.expires_at
      ? String(t.expires_at).slice(0, 10)
      : ''
    const protectedToken = isProjectShareTokenProtected(t)
    setEditingTokenId(t.id)
    setLabel(t.label || '')
    setExpiresAt(expiresShort)
    setEnabledPages(tokenEnabled.length > 0 ? tokenEnabled : makeInitialEnabled())
    setPageConfigs(mergedConfigs)
    setPasswordEnabled(protectedToken)
    setPasswordValue('') // le hash n'est jamais relu — placeholder "(inchangé)" géré côté UI
    setPasswordHint(t.password_hint || '')
    setHadPasswordOnEntry(protectedToken)
    setFormOpen(true)
  }

  // Sort du mode édition et remet le form en état "création vierge".
  function handleCancelEdit() {
    setEditingTokenId(null)
    setLabel('')
    setExpiresAt('')
    setEnabledPages(makeInitialEnabled())
    setPageConfigs(makeInitialConfigs())
    setPasswordEnabled(false)
    setPasswordValue('')
    setPasswordHint('')
    setHadPasswordOnEntry(false)
  }

  // Calcule la clé `password` à transmettre à create/update :
  //   - undefined → ne touche pas au mdp existant (édition silencieuse)
  //   - null      → efface le mdp (token redevient public)
  //   - string    → pose ou remplace le mdp
  function computePasswordPayload() {
    if (!passwordEnabled) {
      // Toggle off → on veut clear (sauf en création où NULL = pas de mdp,
      // équivalent à undefined côté DB).
      if (isEditMode && hadPasswordOnEntry) return null // explicit clear
      return undefined
    }
    // Toggle on
    if (passwordValue && passwordValue.length > 0) return passwordValue
    // Toggle on mais champ vide
    if (isEditMode && hadPasswordOnEntry) {
      // L'admin garde l'ancien mdp tel quel → ne pas envoyer la clé
      return undefined
    }
    // En création, toggle on + champ vide = pas accepté (validé via canSubmit)
    return undefined
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const expiresIso = expiresAt ? `${expiresAt}T23:59:59` : null
      const finalConfigs = {}
      for (const p of enabledPages) {
        finalConfigs[p] = pageConfigs[p]
      }
      const passwordPayload = computePasswordPayload()
      const hintPayload = passwordEnabled
        ? (passwordHint || '').trim() || null
        : null

      if (isEditMode) {
        const patch = {
          label: label.trim() || null,
          expiresAt: expiresIso,
          enabledPages,
          pageConfigs: finalConfigs,
          passwordHint: hintPayload,
        }
        if (passwordPayload !== undefined) patch.password = passwordPayload
        await update(editingTokenId, patch)
        notify.success('Portail mis à jour')
        setEditingTokenId(null)
        setLabel('')
        setExpiresAt('')
        setEnabledPages(makeInitialEnabled())
        setPageConfigs(makeInitialConfigs())
        setPasswordEnabled(false)
        setPasswordValue('')
        setPasswordHint('')
        setHadPasswordOnEntry(false)
        setFormOpen(false)
      } else {
        const newToken = await create({
          label: label.trim() || null,
          enabledPages,
          pageConfigs: finalConfigs,
          expiresAt: expiresIso,
          password: passwordEnabled && passwordValue ? passwordValue : null,
          passwordHint: hintPayload,
        })
        try {
          await navigator.clipboard.writeText(buildProjectShareUrl(newToken.token))
          notify.success('Portail créé et lien copié')
        } catch {
          notify.success('Portail créé')
        }
        setLabel('')
        setExpiresAt('')
        setEnabledPages(makeInitialEnabled())
        setPageConfigs(makeInitialConfigs())
        setPasswordEnabled(false)
        setPasswordValue('')
        setPasswordHint('')
        setFormOpen(false)
      }
    } catch (err) {
      console.error('[ProjectShareModal] submit error', err)
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
      await navigator.clipboard.writeText(buildProjectShareUrl(t.token))
      notify.success('Lien copié')
    } catch {
      notify.error('Impossible de copier')
    }
  }

  function handleOpen(t) {
    window.open(buildProjectShareUrl(t.token), '_blank', 'noopener,noreferrer')
  }

  async function handleRevoke(t) {
    const ok = await confirm({
      title: 'Révoquer ce portail',
      message:
        'Le destinataire ne pourra plus accéder aux pages partagées. L\u2019historique de vues est conservé.',
      confirmLabel: 'Révoquer',
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(t.id)
      notify.success('Portail révoqué')
    } catch (err) {
      notify.error('Révocation échouée : ' + (err?.message || err))
    }
  }

  async function handleRestore(t) {
    try {
      await restore(t.id)
      notify.success('Portail restauré')
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
      notify.success('Portail supprimé')
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
              Partager le projet
            </h2>
            <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
              Lien public unique vers un portail multi-pages.
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
          {/* Form (création ou édition selon editingTokenId) */}
          <CreateFormSection
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            label={label}
            setLabel={setLabel}
            expiresAt={expiresAt}
            setExpiresAt={setExpiresAt}
            enabledPages={enabledPages}
            togglePage={togglePage}
            pageConfigs={pageConfigs}
            updatePageConfig={updatePageConfig}
            lots={lots}
            lotInfoMap={lotInfoMap}
            passwordEnabled={passwordEnabled}
            setPasswordEnabled={setPasswordEnabled}
            passwordValue={passwordValue}
            setPasswordValue={setPasswordValue}
            passwordHint={passwordHint}
            setPasswordHint={setPasswordHint}
            hadPasswordOnEntry={hadPasswordOnEntry}
            submitting={submitting}
            canSubmit={canSubmit}
            onSubmit={handleSubmit}
            hasAnyActive={activeTokens.length > 0}
            isEditMode={isEditMode}
            onCancelEdit={handleCancelEdit}
          />

          {/* Liens actifs */}
          <section>
            <h3
              className="text-[11px] uppercase tracking-wider font-semibold mb-2"
              style={{ color: 'var(--txt-3)' }}
            >
              Portails actifs · {activeTokens.length}
            </h3>
            {loading && tokens.length === 0 ? (
              <SkeletonList />
            ) : activeTokens.length === 0 ? (
              <EmptyState
                message="Aucun portail actif pour ce projet."
                hint="Créez-en un ci-dessus pour partager les pages avec un destinataire externe."
              />
            ) : (
              <ul className="space-y-2">
                {activeTokens.map((t) => (
                  <TokenCard
                    key={t.id}
                    token={t}
                    isEditing={editingTokenId === t.id}
                    onCopy={() => handleCopy(t)}
                    onOpen={() => handleOpen(t)}
                    onEdit={() => handleStartEdit(t)}
                    onRevoke={() => handleRevoke(t)}
                    onDelete={() => handleDelete(t)}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* Révoqués / expirés */}
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
// Form de création
// ════════════════════════════════════════════════════════════════════════════

function CreateFormSection({
  open,
  onToggle,
  label,
  setLabel,
  expiresAt,
  setExpiresAt,
  enabledPages,
  togglePage,
  pageConfigs,
  updatePageConfig,
  lots,
  lotInfoMap,
  passwordEnabled,
  setPasswordEnabled,
  passwordValue,
  setPasswordValue,
  passwordHint,
  setPasswordHint,
  hadPasswordOnEntry = false,
  submitting,
  canSubmit,
  onSubmit,
  hasAnyActive,
  isEditMode = false,
  onCancelEdit = null,
}) {
  // En mode édition la section reste forcée ouverte (toggle UX désactivé) —
  // on a explicitement choisi d'éditer un token, donc on doit voir le form.
  // L'admin sort du mode via le bouton "Annuler".
  const HeaderIcon = isEditMode ? Pencil : Plus
  const headerTitle = isEditMode
    ? 'Modifier le portail'
    : hasAnyActive
      ? 'Nouveau portail'
      : 'Créer votre premier portail'
  const headerSubtitle = isEditMode
    ? 'Le lien public reste le même — seules les pages et options changent.'
    : 'Choisissez un destinataire et les pages à exposer.'

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
              placeholder="Ex : Régisseur Paul, Client Renault…"
              maxLength={80}
              className="w-full text-sm px-3 py-1.5 rounded-md outline-none"
              style={{
                background: 'var(--bg-surf)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
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
              Vide = lien permanent (à utiliser avec parcimonie).
            </p>
          </Field>

          {/* Pages activées + sub-config */}
          <Field label="Pages partagées">
            <div className="space-y-2">
              {SHARE_PAGES.map((pageKey) => (
                <PageCard
                  key={pageKey}
                  pageKey={pageKey}
                  enabled={enabledPages.includes(pageKey)}
                  onToggle={() => togglePage(pageKey)}
                  config={pageConfigs[pageKey]}
                  onConfigChange={(partial) =>
                    updatePageConfig(pageKey, partial)
                  }
                  lots={lots}
                  lotInfoMap={lotInfoMap}
                />
              ))}
            </div>
            {enabledPages.length === 0 && (
              <p
                className="text-[10px] mt-1.5"
                style={{ color: 'var(--orange)' }}
              >
                Au moins une page doit être activée pour créer le portail.
              </p>
            )}
          </Field>

          {/* Protection par mot de passe (PROJECT-SHARE-PWD) */}
          <PasswordSection
            enabled={passwordEnabled}
            setEnabled={setPasswordEnabled}
            value={passwordValue}
            setValue={setPasswordValue}
            hint={passwordHint}
            setHint={setPasswordHint}
            hadPasswordOnEntry={hadPasswordOnEntry}
            isEditMode={isEditMode}
          />

          {/* Bouton créer */}
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
                  : 'Créer le portail'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Card par page (toggle enable + sub-form) ───────────────────────────────

function PageCard({
  pageKey,
  enabled,
  onToggle,
  config,
  onConfigChange,
  lots,
  lotInfoMap,
}) {
  const def = PAGE_DEFS[pageKey]
  if (!def) return null
  const { Icon, label, description, color, bgColor } = def

  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${enabled ? color : 'var(--brd-sub)'}`,
        opacity: enabled ? 1 : 0.85,
        transition: 'border-color 120ms ease, opacity 120ms ease',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left"
      >
        <input
          type="checkbox"
          checked={enabled}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer"
        />
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: bgColor }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-sm font-semibold"
            style={{ color: 'var(--txt)' }}
          >
            {label}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {description}
          </div>
        </div>
      </button>

      {enabled && (
        <div
          className="px-3 pb-3 pt-1 space-y-2"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          {pageKey === 'equipe' && (
            <EquipeSubForm
              config={config}
              onConfigChange={onConfigChange}
              lots={lots}
              lotInfoMap={lotInfoMap}
            />
          )}
          {pageKey === 'livrables' && (
            <LivrablesSubForm
              config={config}
              onConfigChange={onConfigChange}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Section mot de passe (PROJECT-SHARE-PWD) ───────────────────────────────
//
// UI repliable : un toggle "Protéger par mot de passe" + 2 champs (mdp + indice
// optionnel) quand activé. En édition, si le token avait déjà un mdp, le champ
// affiche un placeholder "(inchangé)" — l'admin peut taper un nouveau mdp pour
// le remplacer, ou laisser vide pour garder l'ancien.

function PasswordSection({
  enabled,
  setEnabled,
  value,
  setValue,
  hint,
  setHint,
  hadPasswordOnEntry,
  isEditMode,
}) {
  return (
    <div
      className="rounded-md overflow-hidden"
      style={{
        background: 'var(--bg-surf)',
        border: `1px solid ${enabled ? 'var(--blue)' : 'var(--brd-sub)'}`,
        transition: 'border-color 120ms ease',
      }}
    >
      <label
        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer select-none"
      >
        <input
          type="checkbox"
          checked={Boolean(enabled)}
          onChange={(e) => setEnabled(e.target.checked)}
          className="cursor-pointer"
        />
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
          style={{ background: 'var(--blue-bg)' }}
        >
          <Lock className="w-3.5 h-3.5" style={{ color: 'var(--blue)' }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
            Protéger par mot de passe
          </div>
          <div className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
            {enabled
              ? 'Le destinataire devra saisir le mot de passe pour accéder au portail.'
              : 'Désactivé — le portail est accessible directement avec le lien.'}
          </div>
        </div>
      </label>

      {enabled && (
        <div
          className="px-3 pb-3 pt-1 space-y-2"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <div>
            <label
              className="block text-[10px] font-semibold mb-1"
              style={{ color: 'var(--txt-3)' }}
            >
              Mot de passe
            </label>
            <input
              type="text" /* texte clair pour faciliter la copie/transmission par l'admin */
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={
                isEditMode && hadPasswordOnEntry
                  ? '(inchangé — taper un nouveau mdp pour le remplacer)'
                  : 'Ex : Renault2026, codeProd…'
              }
              autoComplete="new-password"
              className="w-full text-sm px-3 py-1.5 rounded outline-none font-mono"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
            {!isEditMode && enabled && !value && (
              <p
                className="text-[10px] mt-1"
                style={{ color: 'var(--orange)' }}
              >
                Mot de passe requis pour activer la protection.
              </p>
            )}
          </div>
          <div>
            <label
              className="block text-[10px] font-semibold mb-1"
              style={{ color: 'var(--txt-3)' }}
            >
              Indice (optionnel)
            </label>
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder='Ex : "Code projet", "Demande à Paul"'
              maxLength={120}
              className="w-full text-sm px-3 py-1.5 rounded outline-none"
              style={{
                background: 'var(--bg-elev)',
                color: 'var(--txt)',
                border: '1px solid var(--brd)',
              }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
              Affiché AVANT authentification — éviter d&rsquo;y mettre le mdp.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-form Équipe ────────────────────────────────────────────────────────

function EquipeSubForm({ config, onConfigChange, lots, lotInfoMap }) {
  const isMultiLot = lots && lots.length > 1
  // En cas de "all" ou pas de lot_id, on force scope à 'all' (cohérent avec
  // TechlistShareModal).
  const scopeValue =
    config?.scope === 'lot' && config?.lot_id ? config.lot_id : 'all'

  const onScopeChange = (val) => {
    if (val === 'all') {
      onConfigChange({ scope: 'all', lot_id: null })
    } else {
      onConfigChange({ scope: 'lot', lot_id: val })
    }
  }

  return (
    <>
      {isMultiLot && (
        <div>
          <label
            className="block text-[10px] font-semibold mb-1"
            style={{ color: 'var(--txt-3)' }}
          >
            Périmètre lot
          </label>
          <select
            value={scopeValue}
            onChange={(e) => onScopeChange(e.target.value)}
            className="w-full text-xs px-2 py-1.5 rounded outline-none"
            style={{
              background: 'var(--bg-elev)',
              color: 'var(--txt)',
              border: '1px solid var(--brd)',
            }}
          >
            <option value="all">Tous les lots</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                Lot · {l.title}
              </option>
            ))}
          </select>
          {scopeValue !== 'all' && (
            <div
              className="mt-1 flex items-center gap-1.5 text-[10px]"
              style={{ color: 'var(--txt-3)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background: lotInfoMap[scopeValue]?.color || 'var(--txt-3)',
                }}
              />
              <span>
                Filtrage strict — seules les attributions de ce lot seront visibles.
              </span>
            </div>
          )}
        </div>
      )}

      <Toggle
        checked={config?.show_sensitive !== false}
        onChange={(v) => onConfigChange({ show_sensitive: v })}
        label={
          <span className="inline-flex items-center gap-1.5">
            {config?.show_sensitive !== false ? (
              <Eye className="w-3 h-3" style={{ color: 'var(--blue)' }} />
            ) : (
              <EyeOff className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
            )}
            Afficher les coordonnées (téléphone + email)
          </span>
        }
        hint={
          config?.show_sensitive !== false
            ? 'Le destinataire pourra contacter chaque membre directement.'
            : 'Mode anonyme : la techlist liste seulement postes et noms.'
        }
      />
    </>
  )
}

// ─── Sub-form Livrables ─────────────────────────────────────────────────────

function LivrablesSubForm({ config, onConfigChange }) {
  return (
    <>
      <div>
        <label
          className="block text-[10px] font-semibold mb-1"
          style={{ color: 'var(--txt-3)' }}
        >
          Calendrier visible par le client
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          {CALENDAR_LEVELS.map((level) => {
            const active = (config?.calendar_level || 'hidden') === level
            return (
              <button
                key={level}
                type="button"
                onClick={() => onConfigChange({ calendar_level: level })}
                className="text-left rounded px-2 py-1.5 transition-all"
                style={{
                  background: active ? 'var(--blue-bg)' : 'var(--bg-elev)',
                  border: `1px solid ${active ? 'var(--blue)' : 'var(--brd)'}`,
                  color: active ? 'var(--blue)' : 'var(--txt)',
                }}
              >
                <div className="text-[11px] font-semibold">
                  {CALENDAR_LEVEL_LABELS[level]}
                </div>
                <div
                  className="text-[9px] mt-0.5 leading-snug"
                  style={{
                    color: active ? 'var(--blue)' : 'var(--txt-3)',
                  }}
                >
                  {CALENDAR_LEVEL_DESCRIPTIONS[level]}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-1">
        <Toggle
          checked={config?.show_periodes !== false}
          onChange={(v) => onConfigChange({ show_periodes: v })}
          label="Afficher les périodes du projet"
          hint="Tournage, livraison master, deadline…"
        />
        <Toggle
          checked={config?.show_envoi_prevu !== false}
          onChange={(v) => onConfigChange({ show_envoi_prevu: v })}
          label="Afficher les dates d'envoi prévisionnelles"
          hint='Ex : "V2 prévue le 12/05"'
        />
        <Toggle
          checked={config?.show_feedback !== false}
          onChange={(v) => onConfigChange({ show_feedback: v })}
          label="Afficher le feedback client des versions précédentes"
          hint="Mémoire des échanges sur chaque version"
        />
      </div>
    </>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Card token (liste)
// ════════════════════════════════════════════════════════════════════════════

function TokenCard({
  token,
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
  const state = getProjectShareTokenState(token)
  const url = buildProjectShareUrl(token.token)
  const enabledPages = Array.isArray(token.enabled_pages)
    ? token.enabled_pages
    : []
  const views = totalViews(token)

  return (
    <li
      className="rounded-lg p-3"
      style={{
        background: 'var(--bg-elev)',
        // En mode édition courante on souligne la card en bleu pour ancrer
        // visuellement le lien avec le form en haut.
        border: `1px solid ${isEditing ? 'var(--blue)' : 'var(--brd-sub)'}`,
        opacity: state === 'active' ? 1 : 0.7,
      }}
    >
      {/* Label + état + pages */}
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h4
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--txt)' }}
            >
              {token.label || 'Portail sans label'}
            </h4>
            <StateBadge state={state} expiresAt={token.expires_at} />
            {isProjectShareTokenProtected(token) && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold inline-flex items-center gap-1"
                style={{
                  background: 'var(--blue-bg)',
                  color: 'var(--blue)',
                }}
                title="Portail protégé par mot de passe"
              >
                <Lock className="w-2.5 h-2.5" />
                Protégé
              </span>
            )}
          </div>

          {/* Méta */}
          <div
            className="mt-1 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px]"
            style={{ color: 'var(--txt-3)' }}
          >
            <span>Créé {formatRelative(token.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="w-3 h-3" />
              {views} vue{views > 1 ? 's' : ''}
              {token.last_accessed_at && (
                <span> · dernière {formatRelativeFromMap(token.last_accessed_at)}</span>
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

          {/* Pages activées */}
          {enabledPages.length > 0 && (
            <div className="mt-2 flex items-center gap-1 flex-wrap">
              {enabledPages.map((pageKey) => {
                const def = PAGE_DEFS[pageKey]
                if (!def) {
                  return (
                    <span
                      key={pageKey}
                      className="text-[10px] px-2 py-0.5 rounded"
                      style={{
                        background: 'var(--bg-surf)',
                        color: 'var(--txt-3)',
                        border: '1px solid var(--brd-sub)',
                      }}
                    >
                      {pageKey}
                    </span>
                  )
                }
                const { Icon, label, color, bgColor } = def
                const pageViews =
                  Number(token.view_counts?.[pageKey] || 0)
                return (
                  <span
                    key={pageKey}
                    className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                    style={{
                      background: bgColor,
                      color,
                    }}
                    title={
                      pageViews > 0
                        ? `${pageViews} vue${pageViews > 1 ? 's' : ''} sur ${label}`
                        : `Aucune vue de ${label}`
                    }
                  >
                    <Icon className="w-2.5 h-2.5" />
                    {label}
                    {pageViews > 0 && (
                      <span className="font-semibold opacity-80">· {pageViews}</span>
                    )}
                  </span>
                )
              })}
            </div>
          )}
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
// Sous-composants génériques
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
          <div
            className="text-[10px] leading-snug"
            style={{ color: 'var(--txt-3)' }}
          >
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
      style={{
        background: `${meta.color}1a`,
        color: meta.color,
      }}
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

// ─── Helpers de date ────────────────────────────────────────────────────────

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

// last_accessed_at est un map { page: timestamp }. On prend le plus récent.
function formatRelativeFromMap(value) {
  if (!value) return ''
  if (typeof value === 'string') return formatRelative(value)
  if (typeof value === 'object') {
    let latest = null
    for (const v of Object.values(value)) {
      if (!v) continue
      if (!latest || new Date(v).getTime() > new Date(latest).getTime()) {
        latest = v
      }
    }
    return latest ? formatRelative(latest) : ''
  }
  return ''
}

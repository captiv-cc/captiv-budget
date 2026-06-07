// ════════════════════════════════════════════════════════════════════════════
// CustomTypesModal — Gestion des types de créneaux personnalisés du projet
// ════════════════════════════════════════════════════════════════════════════
//
// Sprint Festival types V2. CRUD complet sur projects.creneau_types JSONB.
//
// Features :
//   - Liste des types CORE (read-only, en haut, grisés)
//   - Liste des types CUSTOM du projet (édition inline : libellé + couleur)
//   - Bouton "+ Ajouter un type" → form inline (libellé + color picker)
//   - Suppression : bloquée si utilisé (toast d'erreur explicatif)
//   - Limit 20 custom par projet
//   - Bouton "Copier depuis un autre projet" → picker projet → confirm
//
// Props :
//   - open : boolean
//   - project : { id, title, creneau_types }
//   - allUserProjects : liste pour le picker template (optionnel)
//   - onClose
//   - onProjectUpdate(updatedCreneauTypes) — callback pour rafraîchir
//     l'état local du projet dans le parent (sinon le user voit pas les
//     changes avant un refetch)
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react'
import { X, Plus, Trash2, Copy, AlertCircle, Loader2, Check } from 'lucide-react'
import {
  getProjectCreneauTypes,
  addCustomType,
  updateCustomType,
  removeCustomType,
  copyTypesFromProject,
  fetchProjectCustomTypes,
  MAX_CUSTOM_TYPES,
} from '../../lib/creneauTypes'
import { supabase } from '../../lib/supabase'
import { notify } from '../../lib/notify'

export default function CustomTypesModal({
  open,
  project,
  allUserProjects = [],
  onClose,
  onProjectUpdate,
}) {
  // Liste des types custom (état local synchronisé avec BDD)
  const [customTypes, setCustomTypes] = useState(
    () => (Array.isArray(project?.creneau_types) ? project.creneau_types : []),
  )
  // Reset à chaque ouverture pour reprendre l'état latest du projet
  useEffect(() => {
    if (!open) return
    setCustomTypes(
      Array.isArray(project?.creneau_types) ? project.creneau_types : [],
    )
  }, [open, project])

  // Esc to close
  useEffect(() => {
    if (!open) return undefined
    function onKey(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // ─── Form "Ajouter un type" ─────────────────────────────────────────────
  const [adding, setAdding] = useState(false)
  const [newLibelle, setNewLibelle] = useState('')
  const [newCouleur, setNewCouleur] = useState('#A855F7')
  const [saving, setSaving] = useState(false)

  // ─── Copie depuis un autre projet ───────────────────────────────────────
  const [copyOpen, setCopyOpen] = useState(false)
  const [copySrcId, setCopySrcId] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  // Liste fetchée à la demande (à l'ouverture du form copy). On filtre
  // pour ne montrer que les projets qui ont au moins 1 type custom — sinon
  // pas la peine d'apparaître dans la liste.
  const [otherProjects, setOtherProjects] = useState(allUserProjects)
  const [loadingProjects, setLoadingProjects] = useState(false)
  useEffect(() => {
    // Si le parent a déjà passé des projets, on les utilise. Sinon on fetch
    // au moment où le user ouvre le formulaire copy.
    if (allUserProjects && allUserProjects.length > 0) {
      setOtherProjects(allUserProjects)
    }
  }, [allUserProjects])
  async function ensureProjectsLoaded() {
    // No refetch si déjà chargé
    if (otherProjects.length > 0 || loadingProjects) return
    setLoadingProjects(true)
    try {
      // Lit l'org du projet courant pour scope la requête.
      // RLS filtre déjà sur les projets accessibles, mais on précise
      // pour la lisibilité de la query.
      const orgId = project.org_id || null
      let query = supabase
        .from('projects')
        .select('id, title, creneau_types')
        .neq('id', project.id)
        .order('updated_at', { ascending: false })
        .limit(100)
      if (orgId) query = query.eq('org_id', orgId)
      const { data, error } = await query
      if (error) throw error
      // Ne garde que ceux qui ont au moins 1 type custom (sinon rien à copier)
      const withTypes = (data || []).filter(
        (p) => Array.isArray(p.creneau_types) && p.creneau_types.length > 0,
      )
      setOtherProjects(withTypes)
    } catch (e) {
      console.warn('[CustomTypesModal] fetch projects failed', e)
      notify.error('Impossible de charger la liste des projets')
    } finally {
      setLoadingProjects(false)
    }
  }

  // ─── List view : types CORE (read-only) ─────────────────────────────────
  const allTypes = useMemo(
    () =>
      getProjectCreneauTypes({
        ...project,
        creneau_types: customTypes,
      }),
    [project, customTypes],
  )
  const coreTypes = allTypes.filter((t) => !t.isCustom)

  if (!open || !project) return null

  // ─── Handlers ───────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!newLibelle.trim()) {
      notify.error('Libellé requis')
      return
    }
    if (customTypes.length >= MAX_CUSTOM_TYPES) {
      notify.error(`Maximum ${MAX_CUSTOM_TYPES} types personnalisés`)
      return
    }
    setSaving(true)
    try {
      const created = await addCustomType(project.id, {
        libelle: newLibelle.trim(),
        couleur: newCouleur,
      })
      const next = [...customTypes, created]
      setCustomTypes(next)
      onProjectUpdate?.(next)
      setNewLibelle('')
      setAdding(false)
      notify.success('Type ajouté', false)
    } catch (e) {
      notify.error(e.message || 'Erreur lors de la création')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(key, patch) {
    setSaving(true)
    try {
      await updateCustomType(project.id, key, patch)
      const next = customTypes.map((t) =>
        t.key === key ? { ...t, ...patch } : t,
      )
      setCustomTypes(next)
      onProjectUpdate?.(next)
    } catch (e) {
      notify.error(e.message || 'Erreur')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(key, libelle) {
    setSaving(true)
    try {
      await removeCustomType(project.id, key)
      const next = customTypes.filter((t) => t.key !== key)
      setCustomTypes(next)
      onProjectUpdate?.(next)
      notify.success(`"${libelle}" supprimé`, false)
    } catch (e) {
      // Erreur dédiée : type utilisé
      if (e?.code === 'TYPE_IN_USE') {
        notify.error(e.message)
      } else {
        notify.error(e.message || 'Erreur de suppression')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleCopyFromProject() {
    if (!copySrcId || copySrcId === project.id) return
    setCopyBusy(true)
    try {
      const result = await copyTypesFromProject(copySrcId, project.id)
      // Refetch local
      const fresh = await fetchProjectCustomTypes(project.id)
      setCustomTypes(fresh)
      onProjectUpdate?.(fresh)
      const parts = [
        `${result.added} type${result.added > 1 ? 's' : ''} ajouté${result.added > 1 ? 's' : ''}`,
      ]
      if (result.skipped > 0) {
        parts.push(`${result.skipped} ignoré${result.skipped > 1 ? 's' : ''} (limite atteinte)`)
      }
      notify.success(parts.join(' · '), false)
      setCopyOpen(false)
      setCopySrcId('')
    } catch (e) {
      notify.error(e.message || 'Erreur de copie')
    } finally {
      setCopyBusy(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      onClick={() => !saving && !copyBusy && onClose?.()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 100%)',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-surf)',
          border: '1px solid var(--brd)',
          borderRadius: 10,
          boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--brd-sub)',
            background: 'var(--bg-elev)',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
              }}
            >
              Types de créneaux personnalisés
            </div>
            <div
              style={{ fontSize: 11, color: 'var(--txt-3)', marginTop: 2 }}
            >
              {customTypes.length} / {MAX_CUSTOM_TYPES} types ajoutés à ce projet
            </div>
          </div>
          <button
            type="button"
            onClick={() => !saving && !copyBusy && onClose?.()}
            style={{
              padding: 6,
              background: 'transparent',
              border: 'none',
              color: 'var(--txt-3)',
              cursor: 'pointer',
              borderRadius: 4,
            }}
            title="Fermer (Échap)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            overflow: 'auto',
          }}
        >
          {/* CORE — read-only */}
          <section>
            <SectionLabel>Types standards (verrouillés)</SectionLabel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: 6,
              }}
            >
              {coreTypes.map((t) => (
                <CoreChip key={t.key} type={t} />
              ))}
            </div>
          </section>

          {/* CUSTOM */}
          <section>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <SectionLabel noMargin>
                Types personnalisés ({customTypes.length})
              </SectionLabel>
              <div style={{ display: 'flex', gap: 6 }}>
                {/* Copier depuis un autre projet — toujours visible.
                    Charge la liste à la demande (au click). */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !copyOpen
                    setCopyOpen(next)
                    if (next) ensureProjectsLoaded()
                  }}
                  disabled={saving || copyBusy}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  <Copy size={11} />
                  Copier d&apos;un projet
                </button>
                {/* + Ajouter */}
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  disabled={
                    saving || copyBusy || customTypes.length >= MAX_CUSTOM_TYPES
                  }
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 10px',
                    background: 'var(--blue, #3B82F6)',
                    border: '1px solid var(--blue, #3B82F6)',
                    color: 'white',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor:
                      customTypes.length >= MAX_CUSTOM_TYPES
                        ? 'not-allowed'
                        : 'pointer',
                    opacity:
                      customTypes.length >= MAX_CUSTOM_TYPES ? 0.5 : 1,
                  }}
                >
                  <Plus size={11} />
                  Ajouter un type
                </button>
              </div>
            </div>

            {/* Form "Copier depuis" inline */}
            {copyOpen && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid rgba(59,130,246,0.3)',
                  borderRadius: 6,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--txt-2)' }}>
                  Copier les types depuis :
                </span>
                {loadingProjects ? (
                  <span
                    style={{
                      flex: 1,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: 'var(--txt-3)',
                      fontStyle: 'italic',
                    }}
                  >
                    <Loader2
                      size={12}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                    Chargement des projets…
                  </span>
                ) : otherProjects.length === 0 ? (
                  <span
                    style={{
                      flex: 1,
                      fontSize: 12,
                      color: 'var(--txt-3)',
                      fontStyle: 'italic',
                    }}
                  >
                    Aucun autre projet avec des types personnalisés.
                  </span>
                ) : (
                  <select
                    value={copySrcId}
                    onChange={(e) => setCopySrcId(e.target.value)}
                    disabled={copyBusy}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      background: 'var(--bg-surf)',
                      border: '1px solid var(--brd-sub)',
                      color: 'var(--txt)',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    <option value="">— Choisir un projet —</option>
                    {otherProjects
                      .filter((p) => p.id !== project.id)
                      .map((p) => {
                        const nbTypes = Array.isArray(p.creneau_types)
                          ? p.creneau_types.length
                          : 0
                        return (
                          <option key={p.id} value={p.id}>
                            {p.title}
                            {nbTypes > 0
                              ? ` (${nbTypes} type${nbTypes > 1 ? 's' : ''})`
                              : ''}
                          </option>
                        )
                      })}
                  </select>
                )}
                <button
                  type="button"
                  onClick={handleCopyFromProject}
                  disabled={!copySrcId || copyBusy}
                  style={{
                    padding: '5px 10px',
                    background: copySrcId
                      ? 'var(--blue, #3B82F6)'
                      : 'var(--brd)',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: copySrcId ? 'pointer' : 'not-allowed',
                  }}
                >
                  {copyBusy ? (
                    <Loader2
                      size={11}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  ) : (
                    'Copier'
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCopyOpen(false)
                    setCopySrcId('')
                  }}
                  disabled={copyBusy}
                  style={{
                    padding: '5px 8px',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
              </div>
            )}

            {/* Form "Ajouter" inline */}
            {adding && (
              <div
                style={{
                  padding: '10px 12px',
                  background: 'rgba(34,197,94,0.06)',
                  border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  marginBottom: 8,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                }}
              >
                <input
                  type="text"
                  value={newLibelle}
                  onChange={(e) => setNewLibelle(e.target.value)}
                  placeholder="Libellé du nouveau type"
                  autoFocus
                  disabled={saving}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAdd()
                  }}
                  style={{
                    flex: '1 1 200px',
                    padding: '6px 10px',
                    background: 'var(--bg-surf)',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt)',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                />
                <input
                  type="color"
                  value={newCouleur}
                  onChange={(e) => setNewCouleur(e.target.value)}
                  disabled={saving}
                  title="Couleur du type"
                  style={{
                    width: 38,
                    height: 30,
                    padding: 2,
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving || !newLibelle.trim()}
                  style={{
                    padding: '6px 12px',
                    background: '#22C55E',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    cursor: newLibelle.trim() ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {saving ? (
                    <Loader2
                      size={11}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  ) : (
                    <Check size={11} />
                  )}
                  Ajouter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false)
                    setNewLibelle('')
                  }}
                  disabled={saving}
                  style={{
                    padding: '6px 10px',
                    background: 'transparent',
                    border: '1px solid var(--brd-sub)',
                    color: 'var(--txt-2)',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  Annuler
                </button>
              </div>
            )}

            {/* List custom */}
            {customTypes.length === 0 ? (
              <div
                style={{
                  padding: '24px 12px',
                  textAlign: 'center',
                  color: 'var(--txt-3)',
                  fontSize: 12,
                  fontStyle: 'italic',
                  background: 'var(--bg-elev)',
                  border: '1px dashed var(--brd-sub)',
                  borderRadius: 6,
                }}
              >
                Aucun type personnalisé. Clique &quot;+ Ajouter un type&quot;
                pour créer ton premier (ex&nbsp;: &quot;Pyrotechnie&quot;,
                &quot;Maquillage&quot;, &quot;Brief sécurité&quot;...).
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {customTypes
                  .slice()
                  .sort(
                    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
                  )
                  .map((t) => (
                    <CustomRow
                      key={t.key}
                      type={t}
                      busy={saving}
                      onUpdate={(patch) => handleUpdate(t.key, patch)}
                      onRemove={() => handleRemove(t.key, t.libelle)}
                    />
                  ))}
              </div>
            )}
          </section>

          {/* Hint info */}
          <div
            style={{
              padding: '8px 12px',
              background: 'rgba(245,158,11,0.06)',
              border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--txt-3)',
              display: 'flex',
              gap: 6,
              alignItems: 'flex-start',
            }}
          >
            <AlertCircle
              size={12}
              style={{ marginTop: 1, flexShrink: 0, color: '#F59E0B' }}
            />
            <div>
              Un type ne peut pas être supprimé tant qu&apos;il est utilisé
              par des créneaux. Le renommer ne touche pas aux créneaux
              existants (clé interne conservée). L&apos;import IA n&apos;utilise
              que les types standards.
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────

function SectionLabel({ children, noMargin = false }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 1.5,
        color: 'var(--txt-3)',
        marginBottom: noMargin ? 0 : 8,
      }}
    >
      {children}
    </div>
  )
}

function CoreChip({ type }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        background: `${type.couleur}10`,
        border: `1px solid ${type.couleur}40`,
        borderRadius: 4,
        opacity: 0.85,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: type.couleur,
          flexShrink: 0,
        }}
      />
      <span
        style={{
          fontSize: 11,
          color: 'var(--txt-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={type.libelle}
      >
        {type.libelle}
      </span>
    </div>
  )
}

function CustomRow({ type, busy, onUpdate, onRemove }) {
  const [localLibelle, setLocalLibelle] = useState(type.libelle)
  const [localCouleur, setLocalCouleur] = useState(type.couleur)
  // Sync si patch externe
  useEffect(() => {
    setLocalLibelle(type.libelle)
    setLocalCouleur(type.couleur)
  }, [type.libelle, type.couleur])

  function commitIfDirty() {
    const patch = {}
    if (localLibelle.trim() && localLibelle !== type.libelle) {
      patch.libelle = localLibelle.trim()
    }
    if (localCouleur && localCouleur !== type.couleur) {
      patch.couleur = localCouleur
    }
    if (Object.keys(patch).length > 0) onUpdate(patch)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        background: 'var(--bg-elev)',
        border: '1px solid var(--brd-sub)',
        borderRadius: 5,
      }}
    >
      <input
        type="color"
        value={localCouleur}
        onChange={(e) => setLocalCouleur(e.target.value)}
        onBlur={commitIfDirty}
        disabled={busy}
        style={{
          width: 26,
          height: 26,
          padding: 1,
          background: 'transparent',
          border: '1px solid var(--brd-sub)',
          borderRadius: 4,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      />
      <input
        type="text"
        value={localLibelle}
        onChange={(e) => setLocalLibelle(e.target.value)}
        onBlur={commitIfDirty}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        disabled={busy}
        style={{
          flex: 1,
          padding: '4px 8px',
          background: 'transparent',
          border: '1px solid transparent',
          color: 'var(--txt)',
          borderRadius: 4,
          fontSize: 12,
          minWidth: 0,
        }}
      />
      <span
        style={{
          fontSize: 10,
          color: 'var(--txt-3)',
          fontFamily: 'monospace',
        }}
        title="Clé interne (immuable)"
      >
        {type.key}
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title="Supprimer (bloqué si utilisé par des créneaux)"
        style={{
          padding: 4,
          background: 'transparent',
          border: 'none',
          color: 'var(--red, #EF4444)',
          cursor: 'pointer',
          borderRadius: 3,
          opacity: 0.7,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.opacity = 1
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.opacity = 0.7
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

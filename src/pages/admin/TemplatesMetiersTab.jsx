/**
 * Onglet Templates métiers — Chantier 4D
 *
 * CRUD complet sur les templates de permissions prestataires.
 *
 * Fonctionnalités :
 *   1. Liste dédupliquée (par `key`) : si une version org override existe, elle
 *      masque le template système correspondant. Sinon le système est affiché
 *      en lecture seule avec un bouton "Personnaliser".
 *   2. Créer un template org (from scratch)
 *   3. Personnaliser un template système → clone_metier_template() RPC
 *   4. Éditer un template org : nom, description, couleur, icône + matrice
 *   5. Supprimer un template org (avec garde si utilisé par project_access)
 *
 * Accessible aux admins uniquement (route gardée).
 */

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import {
  Plus,
  Edit3,
  Trash2,
  Copy,
  X,
  Check,
  Minus,
  Shield,
  Lock,
  AlertTriangle,
  Save,
  Loader2,
} from 'lucide-react'

const DEFAULT_COLORS = [
  '#F5A623',
  '#3B82F6',
  '#10B981',
  '#8B5CF6',
  '#EF4444',
  '#EC4899',
  '#14B8A6',
  '#F97316',
]

// ─── Composant principal ─────────────────────────────────────────────────────
export default function TemplatesMetiersTab() {
  const { org } = useAuth()
  const orgId = org?.id

  const [loading, setLoading] = useState(true)
  const [templates, setTemplates] = useState([]) // metiers_template rows (system + org)
  const [outils, setOutils] = useState([]) // outils_catalogue
  const [perms, setPerms] = useState({}) // template_id → {outil_key: {read, comment, edit}}
  const [usageByTpl, setUsageByTpl] = useState({}) // template_id → count of project_access rows
  const [editing, setEditing] = useState(null) // template row en cours d'édition
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)

  // ─── Chargement ─────────────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [tplRes, outilsRes, permsRes, accessRes] = await Promise.all([
        supabase
          .from('metiers_template')
          .select('id, org_id, key, label, description, icon, color, is_system, base_template_id')
          .order('is_system', { ascending: false })
          .order('label'),
        supabase
          .from('outils_catalogue')
          .select('key, label, icon, sort_order')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('metier_template_permissions')
          .select('template_id, outil_key, can_read, can_comment, can_edit'),
        supabase
          .from('project_access')
          .select('metier_template_id')
          .not('metier_template_id', 'is', null),
      ])

      setTemplates(tplRes.data || [])
      setOutils(outilsRes.data || [])

      // Index perms : template_id → { outil_key: {read, comment, edit} }
      const map = {}
      for (const p of permsRes.data || []) {
        if (!map[p.template_id]) map[p.template_id] = {}
        map[p.template_id][p.outil_key] = {
          read: p.can_read,
          comment: p.can_comment,
          edit: p.can_edit,
        }
      }
      setPerms(map)

      // Comptage usage par template
      const usage = {}
      for (const a of accessRes.data || []) {
        usage[a.metier_template_id] = (usage[a.metier_template_id] || 0) + 1
      }
      setUsageByTpl(usage)
    } catch (e) {
      console.error('[TemplatesMetiers] load error:', e)
      toast.error('Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // ─── Déduplication par key : org override masque le système ────────────
  const visibleTemplates = (() => {
    const orgKeys = new Set(templates.filter((t) => t.org_id === orgId).map((t) => t.key))
    // On garde : tous les org + les systèmes dont la key n'est pas déjà en org
    return templates.filter((t) => t.org_id === orgId || (t.is_system && !orgKeys.has(t.key)))
  })()

  // ─── Actions ────────────────────────────────────────────────────────────
  async function clone(sourceId) {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('clone_metier_template', { source_id: sourceId })
      if (error) throw error
      toast.success('Template cloné — édite-le librement')
      await loadAll()
      // Ouvre direct l&apos;éditeur sur le nouveau template
      const newTpl = (await supabase.from('metiers_template').select('*').eq('id', data).single())
        .data
      if (newTpl) setEditing(newTpl)
    } catch (e) {
      console.error(e)
      toast.error(e.message || 'Clonage impossible')
    } finally {
      setBusy(false)
    }
  }

  async function deleteTemplate(tpl) {
    const usage = usageByTpl[tpl.id] || 0
    if (usage > 0) {
      toast.error(
        `Ce template est utilisé par ${usage} prestataire${usage > 1 ? 's' : ''}. Retire-les d'abord.`,
      )
      return
    }
    if (!confirm(`Supprimer le template "${tpl.label}" ?\nCette action est irréversible.`)) return

    setBusy(true)
    try {
      // Les permissions sont supprimées en cascade
      const { error } = await supabase.from('metiers_template').delete().eq('id', tpl.id)
      if (error) throw error
      toast.success('Template supprimé')
      await loadAll()
    } catch (e) {
      console.error(e)
      toast.error(e.message || 'Suppression impossible')
    } finally {
      setBusy(false)
    }
  }

  function startCreate() {
    setEditing({
      id: null,
      org_id: orgId,
      key: '',
      label: '',
      description: '',
      icon: 'Shield',
      color: DEFAULT_COLORS[0],
      is_system: false,
      base_template_id: null,
    })
    setShowCreate(true)
  }

  // ─── Rendu ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--txt-3)' }} />
      </div>
    )
  }

  return (
    <div>
      {/* Header section */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--txt)' }}>
            Templates métiers
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Définis des profils de permissions réutilisables pour tes prestataires
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg"
          style={{ background: 'var(--blue)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" /> Nouveau template
        </button>
      </div>

      {/* Grille de cartes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {visibleTemplates.map((tpl) => (
          <TemplateCard
            key={tpl.id}
            tpl={tpl}
            outils={outils}
            perms={perms[tpl.id] || {}}
            usage={usageByTpl[tpl.id] || 0}
            onEdit={() => setEditing(tpl)}
            onClone={() => clone(tpl.id)}
            onDelete={() => deleteTemplate(tpl)}
            isOrgTemplate={tpl.org_id === orgId}
            busy={busy}
          />
        ))}
      </div>

      {visibleTemplates.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--txt-3)' }}>
          <Shield className="w-10 h-10 mx-auto mb-3" />
          <p className="text-sm">Aucun template disponible</p>
        </div>
      )}

      {/* Modal édition */}
      {editing && (
        <TemplateEditorModal
          template={editing}
          outils={outils}
          perms={perms[editing.id] || {}}
          onClose={() => {
            setEditing(null)
            setShowCreate(false)
          }}
          onSaved={async () => {
            setEditing(null)
            setShowCreate(false)
            await loadAll()
          }}
          isNew={showCreate}
          orgId={orgId}
        />
      )}
    </div>
  )
}

// ─── Carte template ─────────────────────────────────────────────────────────
function TemplateCard({
  tpl,
  outils,
  perms,
  usage,
  onEdit,
  onClone,
  onDelete,
  isOrgTemplate,
  busy,
}) {
  const permCount = Object.keys(perms).length

  return (
    <div
      className="rounded-xl p-4"
      style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${tpl.color}22`, color: tpl.color }}
        >
          <Shield className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {tpl.label}
            </h3>
            {tpl.is_system && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(100,100,100,.15)', color: 'var(--txt-3)' }}
              >
                <Lock className="w-3 h-3" /> Système
              </span>
            )}
            {tpl.base_template_id && !tpl.is_system && (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                style={{ background: 'rgba(139,92,246,.15)', color: 'var(--purple)' }}
              >
                Override
              </span>
            )}
          </div>
          {tpl.description && (
            <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--txt-3)' }}>
              {tpl.description}
            </p>
          )}
          <div
            className="flex items-center gap-3 mt-2 text-[11px]"
            style={{ color: 'var(--txt-3)' }}
          >
            <span>
              {permCount} outil{permCount > 1 ? 's' : ''}
            </span>
            <span>·</span>
            <span>
              {usage} prestataire{usage > 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Aperçu matrice */}
      <div className="flex flex-wrap gap-1 mt-3">
        {outils.map((o) => {
          const p = perms[o.key]
          if (!p) return null
          const level = p.edit ? 'edit' : p.comment ? 'comment' : p.read ? 'read' : null
          if (!level) return null
          const colors = {
            read: { bg: 'rgba(0,122,255,.12)', color: 'var(--blue)' },
            comment: { bg: 'rgba(245,158,11,.15)', color: 'var(--orange)' },
            edit: { bg: 'rgba(0,200,117,.15)', color: 'var(--green)' },
          }
          return (
            <span
              key={o.key}
              className="text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ background: colors[level].bg, color: colors[level].color }}
              title={`${o.label} : ${level}`}
            >
              {o.label}
            </span>
          )
        })}
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-2 mt-3 pt-3"
        style={{ borderTop: '1px solid var(--brd-sub)' }}
      >
        {isOrgTemplate ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={onEdit}
              className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
              style={{ background: 'rgba(0,122,255,.1)', color: 'var(--blue)' }}
            >
              <Edit3 className="w-3.5 h-3.5" /> Éditer
            </button>
            <button
              type="button"
              disabled={busy || usage > 0}
              onClick={onDelete}
              className="inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
              style={{
                background: usage > 0 ? 'transparent' : 'rgba(255,59,48,.1)',
                color: usage > 0 ? 'var(--txt-3)' : 'var(--red)',
                opacity: usage > 0 ? 0.5 : 1,
              }}
              title={usage > 0 ? 'Utilisé par des prestataires' : 'Supprimer'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={onClone}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2 py-1.5 rounded-md"
            style={{ background: 'rgba(139,92,246,.12)', color: 'var(--purple)' }}
          >
            <Copy className="w-3.5 h-3.5" /> Personnaliser
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Modal édition / création ───────────────────────────────────────────────
function TemplateEditorModal({
  template,
  outils,
  perms: initialPerms,
  onClose,
  onSaved,
  isNew,
  orgId,
}) {
  const [label, setLabel] = useState(template.label || '')
  const [description, setDescription] = useState(template.description || '')
  const [color, setColor] = useState(template.color || DEFAULT_COLORS[0])
  const [matrix, setMatrix] = useState(() => {
    // Copy perms into editable matrix
    const m = {}
    for (const o of outils) {
      const p = initialPerms[o.key]
      m[o.key] = p
        ? { read: Boolean(p.read), comment: Boolean(p.comment), edit: Boolean(p.edit) }
        : { read: false, comment: false, edit: false }
    }
    return m
  })
  const [saving, setSaving] = useState(false)

  function toggleCell(outilKey, field) {
    setMatrix((prev) => {
      const cell = { ...prev[outilKey], [field]: !prev[outilKey][field] }
      // Règles d'implication : edit => comment+read, comment => read
      if (field === 'edit' && cell.edit) {
        cell.comment = true
        cell.read = true
      }
      if (field === 'comment' && cell.comment) {
        cell.read = true
      }
      // Si on décoche read, on décoche tout
      if (field === 'read' && !cell.read) {
        cell.comment = false
        cell.edit = false
      }
      // Si on décoche comment, on décoche edit
      if (field === 'comment' && !cell.comment) {
        cell.edit = false
      }
      return { ...prev, [outilKey]: cell }
    })
  }

  async function save() {
    if (!label.trim()) {
      toast.error('Nom obligatoire')
      return
    }
    setSaving(true)
    try {
      let templateId = template.id

      if (isNew) {
        // Création d'un nouveau template org
        const key =
          label
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 40) || 'custom'
        const { data, error } = await supabase
          .from('metiers_template')
          .insert({
            org_id: orgId,
            key,
            label: label.trim(),
            description: description.trim() || null,
            icon: 'Shield',
            color,
            is_system: false,
          })
          .select()
          .single()
        if (error) throw error
        templateId = data.id
      } else {
        // Mise à jour du template existant
        const { error } = await supabase
          .from('metiers_template')
          .update({
            label: label.trim(),
            description: description.trim() || null,
            color,
          })
          .eq('id', templateId)
        if (error) throw error
      }

      // Matrice : on supprime tout et on réinsère uniquement les outils avec au moins une perm
      const { error: delErr } = await supabase
        .from('metier_template_permissions')
        .delete()
        .eq('template_id', templateId)
      if (delErr) throw delErr

      const rows = Object.entries(matrix)
        .filter(([, p]) => p.read || p.comment || p.edit)
        .map(([outil_key, p]) => ({
          template_id: templateId,
          outil_key,
          can_read: p.read,
          can_comment: p.comment,
          can_edit: p.edit,
        }))

      if (rows.length > 0) {
        const { error: insErr } = await supabase.from('metier_template_permissions').insert(rows)
        if (insErr) throw insErr
      }

      toast.success(isNew ? 'Template créé' : 'Template enregistré')
      onSaved()
    } catch (e) {
      console.error(e)
      toast.error(e.message || "Erreur à l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl flex flex-col"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: `${color}22`, color }}
            >
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                {isNew ? 'Nouveau template métier' : `Éditer : ${template.label}`}
              </h3>
              {template.base_template_id && (
                <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                  Override d&apos;un template système
                </p>
              )}
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-white/5">
            <X className="w-5 h-5" style={{ color: 'var(--txt-3)' }} />
          </button>
        </div>

        {/* Body scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Infos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-2)' }}>
                Nom *
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--brd)',
                  color: 'var(--txt)',
                }}
                placeholder="ex. Monteur freelance"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-2)' }}>
                Couleur
              </label>
              <div className="flex items-center gap-1.5">
                {DEFAULT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full transition-transform"
                    style={{
                      background: c,
                      border: color === c ? '2px solid var(--txt)' : '2px solid transparent',
                      transform: color === c ? 'scale(1.1)' : 'scale(1)',
                    }}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--txt-2)' }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg resize-none"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--brd)',
                color: 'var(--txt)',
              }}
              placeholder="Brève description du profil"
            />
          </div>

          {/* Matrice de permissions */}
          <div>
            <label className="block text-xs font-medium mb-2" style={{ color: 'var(--txt-2)' }}>
              Permissions par outil
            </label>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th
                      className="text-left px-3 py-2 font-medium"
                      style={{ color: 'var(--txt-3)' }}
                    >
                      Outil
                    </th>
                    <th className="px-3 py-2 font-medium w-20" style={{ color: 'var(--txt-3)' }}>
                      Lecture
                    </th>
                    <th className="px-3 py-2 font-medium w-20" style={{ color: 'var(--txt-3)' }}>
                      Comment.
                    </th>
                    <th className="px-3 py-2 font-medium w-20" style={{ color: 'var(--txt-3)' }}>
                      Édition
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {outils.map((o, i) => {
                    const cell = matrix[o.key] || { read: false, comment: false, edit: false }
                    return (
                      <tr
                        key={o.key}
                        style={{
                          borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)',
                          background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,.02)',
                        }}
                      >
                        <td className="px-3 py-2" style={{ color: 'var(--txt)' }}>
                          {o.label}
                        </td>
                        <MatrixCheckbox
                          checked={cell.read}
                          onToggle={() => toggleCell(o.key, 'read')}
                          variant="read"
                        />
                        <MatrixCheckbox
                          checked={cell.comment}
                          onToggle={() => toggleCell(o.key, 'comment')}
                          variant="comment"
                        />
                        <MatrixCheckbox
                          checked={cell.edit}
                          onToggle={() => toggleCell(o.key, 'edit')}
                          variant="edit"
                        />
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p
              className="text-[11px] mt-2 flex items-center gap-1"
              style={{ color: 'var(--txt-3)' }}
            >
              <AlertTriangle className="w-3 h-3" />
              Édition implique commentaire + lecture · Commentaire implique lecture
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3"
          style={{ borderTop: '1px solid var(--brd-sub)' }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium rounded-lg"
            style={{ color: 'var(--txt-2)' }}
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg"
            style={{ background: 'var(--blue)', color: '#fff' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Case à cocher colorée pour la matrice ─────────────────────────────────
function MatrixCheckbox({ checked, onToggle, variant }) {
  const colors = {
    read: { bg: 'rgba(0,122,255,.15)', color: 'var(--blue)' },
    comment: { bg: 'rgba(245,158,11,.18)', color: 'var(--orange)' },
    edit: { bg: 'rgba(0,200,117,.18)', color: 'var(--green)' },
  }[variant]
  return (
    <td className="px-3 py-2 text-center">
      <button
        type="button"
        onClick={onToggle}
        className="w-7 h-7 rounded-md inline-flex items-center justify-center transition-all"
        style={{
          background: checked ? colors.bg : 'transparent',
          border: checked ? `1px solid ${colors.color}` : '1px solid var(--brd)',
          color: checked ? colors.color : 'var(--txt-3)',
        }}
      >
        {checked ? <Check className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5 opacity-40" />}
      </button>
    </td>
  )
}

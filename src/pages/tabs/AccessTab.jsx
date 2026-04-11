/**
 * Onglet Accès — Chantier 3B.2
 *
 * Gestion des utilisateurs attachés à un projet (project_access) et de leurs
 * éventuels overrides de permissions (project_access_permissions).
 *
 * Visible par : admin + charge_prod attaché au projet.
 *
 * Fonctionnalités :
 *   1. Liste des users attachés avec leur rôle + template métier
 *   2. Ajout d'un user (modal) : sélection profile + template (si prestataire)
 *   3. Édition des overrides par outil (prestataire uniquement)
 *      → matrice outil × [read, comment, edit] en 3 états :
 *         - hérité du template (NULL)
 *         - forcé à TRUE (override vert)
 *         - forcé à FALSE (override rouge)
 *   4. Retrait d'un user
 *
 * Sécurité :
 *   - L'affichage de l'onglet est contrôlé par ProjetLayout (admin OR charge_prod
 *     attaché). Les écritures sont doublement protégées par les policies RLS.
 */

import { useEffect, useState, useCallback } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import {
  UserPlus, Trash2, X, Check, Minus, ChevronDown, ChevronRight,
  Shield, User as UserIcon, Settings, Info, Search,
  Euro, Briefcase, ExternalLink,
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────
const ROLE_LABELS = {
  admin:        'Admin',
  charge_prod:  'Chargé de prod',
  coordinateur: 'Coordinateur',
  prestataire:  'Prestataire',
}

const ROLE_COLORS = {
  admin:        { bg: 'rgba(255,59,48,.12)',  color: 'var(--red)',    border: 'rgba(255,59,48,.28)' },
  charge_prod:  { bg: 'rgba(0,122,255,.12)',  color: 'var(--blue)',   border: 'rgba(0,122,255,.28)' },
  coordinateur: { bg: 'rgba(0,200,117,.12)',  color: 'var(--green)',  border: 'rgba(0,200,117,.28)' },
  prestataire:  { bg: 'rgba(156,95,253,.12)', color: 'var(--purple)', border: 'rgba(156,95,253,.28)' },
}

function initials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
}

// ─── Composant principal ─────────────────────────────────────────────────────
export default function AccessTab() {
  const { project } = useOutletContext()
  const { isAdmin } = useAuth()
  const projectId = project?.id

  const [loading,    setLoading]    = useState(true)
  const [accessList, setAccessList] = useState([])   // project_access JOIN profiles
  const [outils,     setOutils]     = useState([])   // outils_catalogue
  const [templates,  setTemplates]  = useState([])   // metiers_template
  const [templatePerms, setTemplatePerms] = useState({}) // template_id → {outil: {read, comment, edit}}
  const [overrides,  setOverrides]  = useState({})   // user_id → {outil: {read, comment, edit}}
  const [expanded,   setExpanded]   = useState(null) // user_id dont la matrice est ouverte
  const [showAdd,    setShowAdd]    = useState(false)
  // ch4C.1 : contacts crew liés à un profil (user_id) → {user_id: contact}
  const [contactsByUser, setContactsByUser] = useState({})

  // ─── Chargement initial ─────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const [accRes, outilsRes, tplRes, tplPermsRes, ovRes, ctsRes] = await Promise.all([
        supabase
          .from('project_access')
          .select(`
            user_id, metier_template_id, role_label, note, added_at, added_by,
            profiles:user_id ( id, full_name, role ),
            template:metier_template_id ( id, key, label, color )
          `)
          .eq('project_id', projectId)
          .order('added_at'),
        supabase
          .from('outils_catalogue')
          .select('key, label, icon, sort_order')
          .eq('is_active', true)
          .order('sort_order'),
        supabase
          .from('metiers_template')
          .select('id, org_id, key, label, color, is_system'),
        supabase
          .from('metier_template_permissions')
          .select('template_id, outil_key, can_read, can_comment, can_edit'),
        supabase
          .from('project_access_permissions')
          .select('user_id, outil_key, can_read, can_comment, can_edit')
          .eq('project_id', projectId),
        // ch4C.1 : tous les contacts crew liés à un profil (filtrés par RLS same-org)
        supabase
          .from('contacts')
          .select('id, nom, prenom, regime, specialite, tarif_jour_ref, user_id')
          .not('user_id', 'is', null)
          .eq('actif', true),
      ])

      setAccessList(accRes.data || [])
      setOutils(outilsRes.data || [])

      // ch4D : déduplication par `key` — si un override org existe, il masque
      // le template système correspondant dans le picker.
      const allTpls = tplRes.data || []
      const orgKeys = new Set(allTpls.filter(t => t.org_id).map(t => t.key))
      const dedupedTpls = allTpls.filter(t => t.org_id || !orgKeys.has(t.key))
      setTemplates(dedupedTpls)

      // Index des perms de template : template_id → { outil: {read, comment, edit} }
      const tplMap = {}
      for (const p of tplPermsRes.data || []) {
        if (!tplMap[p.template_id]) tplMap[p.template_id] = {}
        tplMap[p.template_id][p.outil_key] = {
          read: p.can_read, comment: p.can_comment, edit: p.can_edit,
        }
      }
      setTemplatePerms(tplMap)

      // Index des overrides : user_id → { outil: {read, comment, edit} }
      const ovMap = {}
      for (const o of ovRes.data || []) {
        if (!ovMap[o.user_id]) ovMap[o.user_id] = {}
        ovMap[o.user_id][o.outil_key] = {
          read: o.can_read, comment: o.can_comment, edit: o.can_edit,
        }
      }
      setOverrides(ovMap)

      // Index contacts par user_id
      const ctsMap = {}
      for (const c of ctsRes.data || []) {
        if (c.user_id) ctsMap[c.user_id] = c
      }
      setContactsByUser(ctsMap)
    } catch (err) {
      console.error(err)
      toast.error('Erreur de chargement')
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { loadAll() }, [loadAll])

  // ─── Actions : retrait d'un user ────────────────────────────────────────
  async function handleRemove(userId, fullName) {
    if (!confirm(`Retirer ${fullName || 'cet utilisateur'} du projet ?`)) return
    const { error } = await supabase
      .from('project_access')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId)
    if (error) {
      toast.error('Retrait impossible : ' + error.message)
      return
    }
    toast.success('Accès retiré')
    loadAll()
  }

  // ─── Actions : override d'une permission ────────────────────────────────
  // Cycle : hérité (NULL) → forcé TRUE → forcé FALSE → hérité
  async function cycleOverride(userId, outilKey, action) {
    const current = overrides[userId]?.[outilKey] || {}
    const currentVal = current[action] // true | false | null | undefined
    let nextVal
    if (currentVal === null || currentVal === undefined) nextVal = true
    else if (currentVal === true) nextVal = false
    else nextVal = null

    // Construction de la row complète (3 champs) : on ne touche que l'action
    // mais il faut envoyer les 3 pour upsert
    const row = {
      user_id:    userId,
      project_id: projectId,
      outil_key:  outilKey,
      can_read:    action === 'read'    ? nextVal : (current.read    ?? null),
      can_comment: action === 'comment' ? nextVal : (current.comment ?? null),
      can_edit:    action === 'edit'    ? nextVal : (current.edit    ?? null),
    }

    // Si les 3 valeurs sont NULL → supprimer la row (pas de surcharge)
    const allNull =
      row.can_read === null && row.can_comment === null && row.can_edit === null

    if (allNull) {
      const { error } = await supabase
        .from('project_access_permissions')
        .delete()
        .eq('user_id', userId)
        .eq('project_id', projectId)
        .eq('outil_key', outilKey)
      if (error) { toast.error(error.message); return }
    } else {
      const { error } = await supabase
        .from('project_access_permissions')
        .upsert(row, { onConflict: 'user_id,project_id,outil_key' })
      if (error) { toast.error(error.message); return }
    }

    // Mise à jour locale
    setOverrides(prev => {
      const next = { ...prev }
      if (!next[userId]) next[userId] = {}
      else next[userId] = { ...next[userId] }
      if (allNull) {
        delete next[userId][outilKey]
      } else {
        next[userId][outilKey] = { read: row.can_read, comment: row.can_comment, edit: row.can_edit }
      }
      return next
    })
  }

  // ─── Rendu ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 rounded-full animate-spin"
             style={{ borderColor: 'var(--blue)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--txt)' }}>
            <Shield className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            Accès au projet
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
            Qui voit quoi sur ce projet. Les prestataires héritent des droits de leur métier,
            avec possibilité d'ajuster par outil.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{ background: 'var(--blue)', color: 'white' }}
        >
          <UserPlus className="w-3.5 h-3.5" />
          Ajouter un accès
        </button>
      </div>

      {/* ── Info banner ─────────────────────────────────────────────────── */}
      <div className="flex items-start gap-2 p-3 rounded-lg text-xs"
           style={{ background: 'var(--blue-bg)', color: 'var(--txt-2)', border: '1px solid rgba(0,122,255,.2)' }}>
        <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--blue)' }} />
        <div>
          <p className="font-medium mb-0.5" style={{ color: 'var(--txt)' }}>Comment ça marche</p>
          <p>
            Les rôles internes (admin, chargé de prod, coordinateur) n'ont pas besoin de template :
            ils accèdent à tous les outils de leurs projets attachés.
            Un prestataire reçoit un <strong>métier</strong> (ex: Monteur) qui définit ses permissions par défaut.
            Vous pouvez ensuite <strong>surcharger</strong> une permission spécifique pour ce projet uniquement.
          </p>
        </div>
      </div>

      {/* ── Liste des accès ─────────────────────────────────────────────── */}
      {accessList.length === 0 ? (
        <div className="p-8 text-center rounded-lg text-sm"
             style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)', border: '1px dashed var(--brd)' }}>
          Aucun utilisateur n'est encore attaché à ce projet.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--brd)', background: 'var(--bg-surf)' }}>
          {accessList.map((a, idx) => {
            const prof = a.profiles
            const isPrestataire = prof?.role === 'prestataire'
            const isExpanded = expanded === a.user_id
            const roleColors = ROLE_COLORS[prof?.role] || ROLE_COLORS.prestataire
            const contact = contactsByUser[a.user_id]  // ch4C.1 : fiche crew liée
            return (
              <div key={a.user_id}
                   style={idx > 0 ? { borderTop: '1px solid var(--brd-sub)' } : {}}>
                {/* Ligne principale */}
                <div className="flex items-center gap-3 p-3">
                  {/* Avatar */}
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                       style={{ background: roleColors.bg, color: roleColors.color, border: `1px solid ${roleColors.border}` }}>
                    {initials(prof?.full_name)}
                  </div>

                  {/* Nom + rôle + template */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
                        {prof?.full_name || '—'}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                            style={{ background: roleColors.bg, color: roleColors.color, border: `1px solid ${roleColors.border}` }}>
                        {ROLE_LABELS[prof?.role] || prof?.role}
                      </span>
                      {isPrestataire && a.template && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
                              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}>
                          <UserIcon className="w-3 h-3" />
                          {a.template.label}
                        </span>
                      )}
                      {isPrestataire && !a.template && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                              style={{ background: 'rgba(255,174,0,.12)', color: 'var(--amber)', border: '1px solid rgba(255,174,0,.28)' }}>
                          Aucun métier
                        </span>
                      )}
                      {a.role_label && (
                        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>· {a.role_label}</span>
                      )}
                    </div>
                    {a.note && (
                      <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--txt-3)' }}>{a.note}</p>
                    )}
                    {/* ch4C.1 : infos crew (si compte lié à un contact) */}
                    {contact && (
                      <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: 'var(--txt-3)' }}>
                        {contact.specialite && (
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            {contact.specialite}
                          </span>
                        )}
                        {contact.regime && (
                          <span>{contact.regime}</span>
                        )}
                        {contact.tarif_jour_ref && (
                          <span className="inline-flex items-center gap-0.5">
                            <Euro className="w-3 h-3" />
                            {Number(contact.tarif_jour_ref).toLocaleString('fr-FR')}/j
                          </span>
                        )}
                        <Link
                          to="/crew"
                          className="inline-flex items-center gap-0.5 hover:underline"
                          style={{ color: 'var(--blue)' }}
                          title="Voir la fiche crew"
                        >
                          Fiche crew
                          <ExternalLink className="w-2.5 h-2.5" />
                        </Link>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isPrestataire && (
                      <button
                        onClick={() => setExpanded(isExpanded ? null : a.user_id)}
                        className="p-2 rounded-md transition-colors text-xs flex items-center gap-1"
                        style={{ color: 'var(--txt-2)', background: isExpanded ? 'var(--bg-elev)' : 'transparent' }}
                        title="Éditer les permissions"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(a.user_id, prof?.full_name)}
                      className="p-2 rounded-md transition-colors"
                      style={{ color: 'var(--red)' }}
                      title="Retirer l'accès"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Matrice des permissions (prestataires uniquement) */}
                {isExpanded && isPrestataire && (
                  <PermissionsMatrix
                    userId={a.user_id}
                    outils={outils}
                    templatePerms={a.metier_template_id ? templatePerms[a.metier_template_id] || {} : {}}
                    userOverrides={overrides[a.user_id] || {}}
                    onCycle={(outil, action) => cycleOverride(a.user_id, outil, action)}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Modal d'ajout ────────────────────────────────────────────────── */}
      {showAdd && (
        <AddAccessModal
          projectId={projectId}
          alreadyAttached={accessList.map(a => a.user_id)}
          templates={templates}
          contactsByUser={contactsByUser}
          onClose={() => setShowAdd(false)}
          onAdded={() => { setShowAdd(false); loadAll() }}
        />
      )}
    </div>
  )
}

// ─── Sous-composant : matrice outil × action ────────────────────────────────
function PermissionsMatrix({ outils, templatePerms, userOverrides, onCycle }) {
  return (
    <div className="p-3" style={{ background: 'var(--bg)', borderTop: '1px solid var(--brd-sub)' }}>
      <p className="text-[11px] mb-2" style={{ color: 'var(--txt-3)' }}>
        <strong style={{ color: 'var(--txt-2)' }}>Clic sur une case</strong> pour cycler :
        hérité du métier → forcer OUI → forcer NON → hérité.
      </p>
      <div className="rounded-md overflow-hidden" style={{ border: '1px solid var(--brd-sub)' }}>
        <table className="w-full text-xs">
          <thead style={{ background: 'var(--bg-elev)' }}>
            <tr>
              <th className="text-left px-3 py-2 font-medium" style={{ color: 'var(--txt-2)' }}>Outil</th>
              <th className="text-center px-3 py-2 font-medium w-24" style={{ color: 'var(--txt-2)' }}>Lire</th>
              <th className="text-center px-3 py-2 font-medium w-24" style={{ color: 'var(--txt-2)' }}>Commenter</th>
              <th className="text-center px-3 py-2 font-medium w-24" style={{ color: 'var(--txt-2)' }}>Éditer</th>
            </tr>
          </thead>
          <tbody>
            {outils.map(o => {
              const tpl = templatePerms[o.key] || {}
              const ov = userOverrides[o.key] || {}
              return (
                <tr key={o.key} style={{ borderTop: '1px solid var(--brd-sub)' }}>
                  <td className="px-3 py-2" style={{ color: 'var(--txt)' }}>{o.label}</td>
                  <PermCell tpl={tpl.read}    override={ov.read}    onClick={() => onCycle(o.key, 'read')} />
                  <PermCell tpl={tpl.comment} override={ov.comment} onClick={() => onCycle(o.key, 'comment')} />
                  <PermCell tpl={tpl.edit}    override={ov.edit}    onClick={() => onCycle(o.key, 'edit')} />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Sous-composant : cellule permission 3 états ────────────────────────────
function PermCell({ tpl, override, onClick }) {
  // Valeur effective : override si défini, sinon template
  const effective = override !== null && override !== undefined ? override : (tpl || false)
  const isOverride = override !== null && override !== undefined

  let bg, color, Icon, title
  if (isOverride) {
    if (override === true) {
      bg = 'rgba(0,200,117,.18)'; color = 'var(--green)'; Icon = Check
      title = 'Forcé OUI (surcharge)'
    } else {
      bg = 'rgba(255,59,48,.15)'; color = 'var(--red)'; Icon = X
      title = 'Forcé NON (surcharge)'
    }
  } else {
    // Hérité
    if (effective) {
      bg = 'rgba(0,122,255,.10)'; color = 'var(--blue)'; Icon = Check
      title = 'Hérité du métier : OUI'
    } else {
      bg = 'var(--bg-elev)'; color = 'var(--txt-3)'; Icon = Minus
      title = 'Hérité du métier : NON'
    }
  }

  return (
    <td className="text-center px-3 py-1.5">
      <button
        onClick={onClick}
        className="inline-flex items-center justify-center w-7 h-7 rounded-md transition-all"
        style={{
          background: bg,
          color,
          border: isOverride ? `1px solid ${color}` : '1px solid var(--brd-sub)',
        }}
        title={title}
      >
        <Icon className="w-3.5 h-3.5" />
      </button>
    </td>
  )
}

// ─── Sous-composant : modal d'ajout d'un user ───────────────────────────────
function AddAccessModal({ projectId, alreadyAttached, templates, contactsByUser = {}, onClose, onAdded }) {
  const { user: currentUser } = useAuth()
  const [loading, setLoading]     = useState(true)
  const [profiles, setProfiles]   = useState([])
  const [search, setSearch]       = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [selectedTpl,  setSelectedTpl]  = useState('')
  const [tplAutoPicked, setTplAutoPicked] = useState(false) // flag visuel
  const [roleLabel,    setRoleLabel]    = useState('')
  const [note,         setNote]         = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .order('full_name')
      setProfiles((data || []).filter(p => !alreadyAttached.includes(p.id)))
      setLoading(false)
    })()
  }, [alreadyAttached])

  // ch4C.1 : auto-sélection du template métier d'après la specialite du contact lié
  useEffect(() => {
    if (!selectedUser || selectedUser.role !== 'prestataire') {
      setTplAutoPicked(false)
      return
    }
    const contact = contactsByUser[selectedUser.id]
    if (!contact?.specialite || !templates.length) return
    const spec = contact.specialite.toLowerCase().trim()
    // Match sur label OU key du template (case-insensitive, contient)
    const match = templates.find(t => {
      const lbl = (t.label || '').toLowerCase()
      const key = (t.key   || '').toLowerCase()
      return lbl === spec || key === spec || lbl.includes(spec) || spec.includes(lbl)
    })
    if (match) {
      setSelectedTpl(match.id)
      setTplAutoPicked(true)
      // Pré-remplir le rôle libre avec la spécialité si vide
      setRoleLabel(prev => prev || contact.specialite)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser])

  const filtered = profiles.filter(p =>
    (p.full_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const isPrestataire = selectedUser?.role === 'prestataire'
  // Pour les prestataires, le template est requis
  const canSave = selectedUser && (!isPrestataire || selectedTpl)

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    const row = {
      user_id:    selectedUser.id,
      project_id: projectId,
      metier_template_id: isPrestataire ? selectedTpl : null,
      role_label: roleLabel || null,
      note:       note || null,
      added_by:   currentUser?.id || null,
    }
    const { error } = await supabase.from('project_access').insert(row)
    setSaving(false)
    if (error) {
      toast.error('Ajout impossible : ' + error.message)
      return
    }
    toast.success(`${selectedUser.full_name || 'Utilisateur'} ajouté au projet`)
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ background: 'rgba(0,0,0,.6)' }}
         onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl p-5 space-y-4"
           style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
           onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--txt)' }}>
            <UserPlus className="w-4 h-4" style={{ color: 'var(--blue)' }} />
            Ajouter un accès
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-md transition-colors"
                  style={{ color: 'var(--txt-3)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Recherche user */}
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--txt-2)' }}>
            Utilisateur
          </label>
          {selectedUser ? (
            <div className="flex items-center gap-2 p-2 rounded-md"
                 style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)' }}>
              <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                   style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>
                {initials(selectedUser.full_name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
                  {selectedUser.full_name || '—'}
                </p>
                <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                  {ROLE_LABELS[selectedUser.role] || selectedUser.role}
                </p>
              </div>
              <button onClick={() => setSelectedUser(null)}
                      className="p-1 rounded" style={{ color: 'var(--txt-3)' }}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2"
                        style={{ color: 'var(--txt-3)' }} />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Rechercher un utilisateur…"
                  className="w-full pl-8 pr-3 py-2 rounded-md text-sm"
                  style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
                />
              </div>
              <div className="mt-2 max-h-48 overflow-auto rounded-md"
                   style={{ border: '1px solid var(--brd-sub)' }}>
                {loading ? (
                  <div className="p-3 text-center text-xs" style={{ color: 'var(--txt-3)' }}>Chargement…</div>
                ) : filtered.length === 0 ? (
                  <div className="p-3 text-center text-xs" style={{ color: 'var(--txt-3)' }}>
                    Aucun utilisateur disponible
                  </div>
                ) : (
                  filtered.map(p => {
                    const ct = contactsByUser[p.id]
                    return (
                      <button
                        key={p.id}
                        onClick={() => setSelectedUser(p)}
                        className="w-full flex items-center gap-2 p-2 text-left transition-colors hover:opacity-80"
                        style={{ borderBottom: '1px solid var(--brd-sub)' }}
                      >
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                             style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}>
                          {initials(p.full_name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate" style={{ color: 'var(--txt)' }}>{p.full_name || '—'}</p>
                          {ct?.specialite && (
                            <p className="text-[10px] truncate" style={{ color: 'var(--txt-3)' }}>{ct.specialite}</p>
                          )}
                        </div>
                        <span className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                          {ROLE_LABELS[p.role] || p.role}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </>
          )}
        </div>

        {/* Template métier (prestataire uniquement) */}
        {isPrestataire && (
          <div>
            <label className="text-xs font-medium block mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--txt-2)' }}>
              Métier <span style={{ color: 'var(--red)' }}>*</span>
              {tplAutoPicked && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: 'rgba(16,185,129,.15)', color: '#10b981' }}>
                  Auto
                </span>
              )}
            </label>
            <select
              value={selectedTpl}
              onChange={e => { setSelectedTpl(e.target.value); setTplAutoPicked(false) }}
              className="w-full px-3 py-2 rounded-md text-sm"
              style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
            >
              <option value="">— Choisir un métier —</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.label} {t.is_system ? '(système)' : ''}
                </option>
              ))}
            </select>
            {tplAutoPicked && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--txt-3)' }}>
                Pré-rempli depuis la fiche crew de l'utilisateur.
              </p>
            )}
          </div>
        )}

        {/* Rôle libre + note */}
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--txt-2)' }}>
            Rôle sur ce projet <span style={{ color: 'var(--txt-3)' }}>(optionnel)</span>
          </label>
          <input
            type="text"
            value={roleLabel}
            onChange={e => setRoleLabel(e.target.value)}
            placeholder="ex: Chef op, Script, 2e assistant…"
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--txt-2)' }}>
            Note <span style={{ color: 'var(--txt-3)' }}>(optionnel)</span>
          </label>
          <input
            type="text"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="ex: Sur le tournage des 3-5 mai"
            className="w-full px-3 py-2 rounded-md text-sm"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd)', color: 'var(--txt)' }}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-2 rounded-md text-xs font-medium"
            style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)', border: '1px solid var(--brd)' }}
          >
            Annuler
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="px-3 py-2 rounded-md text-xs font-medium transition-opacity"
            style={{
              background: 'var(--blue)',
              color: 'white',
              opacity: canSave && !saving ? 1 : 0.5,
              cursor: canSave && !saving ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Ajout…' : 'Ajouter au projet'}
          </button>
        </div>
      </div>
    </div>
  )
}

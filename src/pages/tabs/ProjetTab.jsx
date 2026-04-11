/**
 * Onglet PROJET — fiche projet visuelle
 *
 * Refonte 2026-04-12 :
 *   - Mode VUE par défaut pour tous les utilisateurs (lecture seule visuelle)
 *   - Mode ÉDITION sur demande pour admin + charge_prod uniquement
 *   - Bloc Équipe groupé par personne (récap visuel des membres du projet)
 *   - Bloc Gestion des accès (admin/charge_prod) pour déléguer vers AccessTab
 *   - Détails admin repliables (ref projet, BC, date devis)
 *
 * Cette page est la première vue de TOUS les utilisateurs (admin, charge_prod,
 * coordinateur, prestataires) → elle doit résumer le projet visuellement, et
 * n'autoriser l'édition qu'aux rôles habilités.
 */
import { useState, useEffect, useRef } from 'react'
import { useOutletContext, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { useProjectPermissions } from '../../hooks/useProjectPermissions'
import {
  Save, Plus, Trash2, Check, X, RefreshCw, Upload,
  Building2, Clapperboard, FileText, StickyNote, Users, Shield,
  ChevronDown, ChevronRight, Edit2, Calendar, Mail, Phone, MapPin,
} from 'lucide-react'

// ─── Définition des champs dynamiques PROJET ─────────────────────────────────
const PROJET_FIELDS_DEF = [
  { key: 'type_projet',           label: 'Type',                  placeholder: 'Film institutionnel, pub…', group: 'base' },
  { key: 'titre_projet',          label: 'Titre',                 placeholder: 'Titre du film / de la prod',group: 'base' },
  { key: 'agence',                label: 'Agence',                placeholder: "Nom de l'agence",            group: 'prod' },
  { key: 'production',            label: 'Production',            placeholder: 'Société de production',      group: 'prod' },
  { key: 'production_executive',  label: 'Production exécutive',  placeholder: 'Société exec.',              group: 'prod' },
  { key: 'realisateur',           label: 'Réalisateur',           placeholder: 'Nom du réalisateur',         group: 'equipe' },
  { key: 'producteur',            label: 'Producteur',            placeholder: 'Nom du producteur',          group: 'equipe' },
  { key: 'nb_livrables',          label: 'Nombre de livrables',   placeholder: 'Ex : 3',                     group: 'livrables_specs' },
  { key: 'duree_master',          label: 'Durée master',          placeholder: "Ex : 3'00\"",                group: 'livrables_specs' },
  { key: 'format_master',         label: 'Format master',         placeholder: 'Ex : MP4 H264, ProRes…',    group: 'livrables_specs' },
  { key: 'prepa_jours',           label: 'Prépa — jours',         placeholder: 'Ex : 2j',                    group: 'planning' },
  { key: 'prepa_dates',           label: 'Prépa — dates',         placeholder: 'Ex : 01-02/05/2026',         group: 'planning' },
  { key: 'tournage_jours',        label: 'Tournage — jours',      placeholder: 'Ex : 3j',                    group: 'planning' },
  { key: 'tournage_dates',        label: 'Tournage — dates',      placeholder: 'Ex : 05-07/05/2026',         group: 'planning' },
  { key: 'envoi_v1',              label: 'Envoi V1',              placeholder: 'JJ/MM/AAAA',                 group: 'planning' },
  { key: 'livraison_master',      label: 'Livraison MASTER',      placeholder: 'JJ/MM/AAAA',                 group: 'planning' },
  { key: 'deadline',              label: 'Deadline',              placeholder: 'JJ/MM/AAAA',                 group: 'planning' },
]

const ALL_KEYS = PROJET_FIELDS_DEF.map(f => f.key)

const EMPTY_LIVRABLE = () => ({
  id: Date.now() + Math.random(),
  nom: '', format: '', duree: '', livraison: ''
})

// ─── Helpers de mapping project ⇄ draft (formulaire d'édition) ───────────────
function buildDraftFromProject(project) {
  const meta = project.metadata || {}
  const fields = {}
  fields.type_projet  = meta.type_projet ?? project.type_projet  ?? ''
  fields.agence       = meta.agence      ?? project.agence       ?? ''
  fields.realisateur  = meta.realisateur ?? project.realisateur  ?? ''
  ALL_KEYS.forEach(k => { if (fields[k] === undefined) fields[k] = meta[k] ?? '' })

  const visible = {}
  ALL_KEYS.forEach(k => { visible[k] = meta._visible?.[k] !== false })

  let livrables = []
  try {
    livrables = Array.isArray(project.livrables_json)
      ? project.livrables_json
      : JSON.parse(project.livrables_json || '[]')
  } catch { livrables = [] }
  if (!livrables.length) livrables = [EMPTY_LIVRABLE()]

  return {
    title:        project.title         || '',
    description:  project.description   || '',
    ref_projet:   project.ref_projet    || '',
    bon_commande: project.bon_commande  || '',
    date_devis:   project.date_devis    || '',
    client_id:    project.client_id     || '',
    cover_url:    project.cover_url     || '',
    fields,
    visible,
    livrables,
    noteProd:     project.note_prod     || '',
  }
}

function buildPayloadFromDraft(draft) {
  const metadata = { ...draft.fields, _visible: draft.visible }
  return {
    title:          draft.title         || null,
    description:    draft.description   || null,
    client_id:      draft.client_id     || null,
    ref_projet:     draft.ref_projet,
    bon_commande:   draft.bon_commande,
    date_devis:     draft.date_devis    || null,
    cover_url:      draft.cover_url     || null,
    type_projet:    draft.fields.type_projet  || null,
    agence:         draft.fields.agence       || null,
    realisateur:    draft.fields.realisateur  || null,
    note_prod:      draft.noteProd,
    metadata,
    livrables_json: draft.livrables,
    updated_at:     new Date().toISOString(),
  }
}

// ─── Regroupement des membres par personne ───────────────────────────────────
// Si Marc est cadreur ET monteur, il apparaît une seule fois avec deux postes.
function groupMembresByPerson(membres) {
  const map = {}
  membres.forEach(m => {
    const key = m.contact_id ? `c_${m.contact_id}` : `l_${m.id}`
    if (!map[key]) {
      map[key] = {
        key,
        contact_id: m.contact_id,
        nom:    m.nom    || m.contact?.nom    || '',
        prenom: m.prenom || m.contact?.prenom || '',
        email:  m.email  || m.contact?.email  || '',
        user_id: m.contact?.user_id || null,
        postes: [],
      }
    }
    const poste = (m.specialite || '').trim()
    if (poste && !map[key].postes.includes(poste)) {
      map[key].postes.push(poste)
    }
  })
  return Object.values(map).sort((a, b) =>
    `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`)
  )
}

function initials(person) {
  const a = (person.prenom || '').trim()[0] || ''
  const b = (person.nom    || '').trim()[0] || ''
  return (a + b).toUpperCase() || '?'
}

function fullName(person) {
  return `${person.prenom || ''} ${person.nom || ''}`.trim() || 'Sans nom'
}

// ══════════════════════════════════════════════════════════════════════════════
// COMPOSANT PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════
export default function ProjetTab() {
  const { project, setProject, projectId } = useOutletContext()
  const { isAdmin, isChargeProd } = useAuth()
  const canEdit = isAdmin || isChargeProd

  // Permissions par outil (pour masquer/adapter les blocs liés aux outils
  // dont l'utilisateur n'a pas accès, ex: livrables)
  const { canSee: canSeeOutil } = useProjectPermissions(projectId)
  const canSeeLivrables = canSeeOutil('livrables')

  // Mode édition + draft local
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(null)
  const [saving,  setSaving]  = useState(false)

  // Données auxiliaires (vue)
  const [clientsList,    setClientsList]    = useState([])
  const [membres,        setMembres]        = useState([])
  const [loadingMembres, setLoadingMembres] = useState(true)
  const [accessCount,    setAccessCount]    = useState(null)

  // UI : section "Détails admin" repliable (ouverte par défaut en édition
  // pour ne pas l'oublier)
  const [showAdmin, setShowAdmin] = useState(true)

  // ─── Chargements ───────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.from('clients').select('id, name').order('name')
      .then(({ data }) => setClientsList(data || []))
  }, [])

  useEffect(() => {
    if (!projectId) return
    setLoadingMembres(true)
    supabase
      .from('projet_membres')
      .select('*, contact:contacts(nom, prenom, email, user_id)')
      .eq('project_id', projectId)
      .then(({ data }) => {
        setMembres(data || [])
        setLoadingMembres(false)
      })
  }, [projectId])

  useEffect(() => {
    if (!projectId || !canEdit) return
    // ⚠️ project_access a une PK composite (user_id, project_id) — pas de colonne `id`.
    // On compte sur user_id pour récupérer le bon `count`.
    supabase
      .from('project_access')
      .select('user_id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .then(({ count }) => setAccessCount(count ?? 0))
  }, [projectId, canEdit])

  // ─── Actions ───────────────────────────────────────────────────────────────
  function startEdit() {
    if (!canEdit) return
    setDraft(buildDraftFromProject(project))
    setEditing(true)
  }

  function cancelEdit() {
    setDraft(null)
    setEditing(false)
  }

  async function saveEdit() {
    if (!draft || saving) return
    setSaving(true)
    const payload = buildPayloadFromDraft(draft)
    const { data, error } = await supabase
      .from('projects').update(payload).eq('id', projectId)
      .select('*, clients(*)').single()
    setSaving(false)
    if (error) {
      alert('Erreur sauvegarde : ' + error.message)
      return
    }
    if (data) {
      setProject(data)
      setDraft(null)
      setEditing(false)
    }
  }

  if (!project) return null

  // ─── Rendu ────────────────────────────────────────────────────────────────
  const persons = groupMembresByPerson(membres)
  const meta = project.metadata || {}
  const get = (k) => meta[k] ?? project[k] ?? ''

  return (
    <div className="p-5 max-w-4xl mx-auto space-y-4 pb-16">
      {editing ? (
        <EditView
          draft={draft}
          setDraft={setDraft}
          clientsList={clientsList}
          onCancel={cancelEdit}
          onSave={saveEdit}
          saving={saving}
          showAdmin={showAdmin}
          setShowAdmin={setShowAdmin}
          projectId={projectId}
        />
      ) : (
        <ReadView
          project={project}
          get={get}
          canEdit={canEdit}
          onEdit={startEdit}
          persons={persons}
          loadingMembres={loadingMembres}
          accessCount={accessCount}
          canSeeLivrables={canSeeLivrables}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE LECTURE — fiche projet visuelle
// ══════════════════════════════════════════════════════════════════════════════
function ReadView({
  project, get, canEdit, onEdit,
  persons, loadingMembres, accessCount,
  canSeeLivrables,
}) {
  const planningSpecs = [
    { label: 'Nb livrables', value: get('nb_livrables') },
    { label: 'Durée master', value: get('duree_master') },
    { label: 'Format master', value: get('format_master') },
  ].filter(c => c.value)

  const planningChips = [
    { label: 'Prépa — jours',    value: get('prepa_jours') },
    { label: 'Prépa — dates',    value: get('prepa_dates') },
    { label: 'Tournage — jours', value: get('tournage_jours') },
    { label: 'Tournage — dates', value: get('tournage_dates') },
    { label: 'Envoi V1',         value: get('envoi_v1') },
    { label: 'Livraison MASTER', value: get('livraison_master') },
    { label: 'Deadline',         value: get('deadline') },
  ].filter(c => c.value)

  const hasPlanning = planningSpecs.length > 0 || planningChips.length > 0

  let livrables = []
  try {
    livrables = Array.isArray(project.livrables_json)
      ? project.livrables_json
      : JSON.parse(project.livrables_json || '[]')
  } catch { livrables = [] }
  livrables = livrables.filter(l => l.nom || l.format || l.duree || l.livraison)

  return (
    <>
      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <div className="card overflow-visible">
        <div className="p-6">
          <div className="flex items-start gap-4">
            {/* Avatar projet — image projet, sinon logo client, sinon initiales */}
            <ProjectAvatar project={project} />

            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-gray-900 truncate mb-2">
                {project.title || 'Projet sans nom'}
              </h1>
              <SubLine get={get} project={project} />
              <ClientLine project={project} />
              {project.description && (
                <div className="mt-4 pl-3 border-l-2 border-blue-100">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Description</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                    {project.description}
                  </p>
                </div>
              )}
            </div>
            {canEdit && (
              <button onClick={onEdit} className="btn-secondary btn-sm shrink-0">
                <Edit2 className="w-3.5 h-3.5" />Modifier
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ADMIN (admin/charge_prod uniquement, juste sous le hero) ─ */}
      {canEdit && (
        <AdminFooter project={project} accessCount={accessCount} />
      )}

      {/* ── IDENTITÉ (+ planning fusionné) ───────────────────────────────── */}
      <SectionCard icon={<Clapperboard className="w-4 h-4" />} title="Identité">
        <div className="space-y-5">
          <InfoGrid items={[
            { label: 'Type',                value: get('type_projet') },
            { label: 'Titre',               value: get('titre_projet') },
            { label: 'Agence',              value: get('agence') },
            { label: 'Production',          value: get('production') },
            { label: 'Production exéc.',    value: get('production_executive') },
            { label: 'Réalisateur',         value: get('realisateur') },
            { label: 'Producteur',          value: get('producteur') },
          ]} />

          {hasPlanning && (
            <div className="pt-4 border-t border-gray-100 space-y-4">
              {planningSpecs.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText className="w-3 h-3 text-gray-500" />
                    <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Spécifications</p>
                  </div>
                  <InfoGrid items={planningSpecs} />
                </div>
              )}
              {planningChips.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Calendar className="w-3 h-3 text-gray-500" />
                    <p className="text-[11px] font-semibold text-gray-600 uppercase tracking-wider">Planning</p>
                  </div>
                  <InfoGrid items={planningChips} />
                </div>
              )}
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── ÉQUIPE ───────────────────────────────────────────────────────── */}
      <SectionCard
        icon={<Users className="w-4 h-4" />}
        title={`Équipe${persons.length ? ` (${persons.length})` : ''}`}
        action={
          <Link to={`/projets/${project.id}/equipe`} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            Voir l'équipe →
          </Link>
        }
      >
        {loadingMembres ? (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <RefreshCw className="w-3 h-3 animate-spin" />Chargement…
          </div>
        ) : persons.length === 0 ? (
          <EmptyHint>Aucun membre attribué pour le moment.</EmptyHint>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {persons.map(p => (
              <div key={p.key} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-white px-3 py-2">
                <div className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">
                  {initials(p)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{fullName(p)}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {p.postes.length ? p.postes.join(' · ') : <span className="italic text-gray-400">Sans poste défini</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── LIVRABLES ────────────────────────────────────────────────────── */}
      {/* Si l'utilisateur n'a pas accès à l'outil "livrables" et qu'il n'y en
          a pas, on masque complètement le bloc (pas de teasing inutile). */}
      {livrables.length === 0 && !canSeeLivrables ? null : livrables.length === 0 ? (
        <Link
          to={`/projets/${project.id}/livrables`}
          className="flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 text-xs text-gray-500 hover:text-blue-700 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-gray-400" />
            Aucun livrable défini
          </span>
          <span className="font-medium">Voir →</span>
        </Link>
      ) : (
        <SectionCard
          icon={<FileText className="w-4 h-4" />}
          title={`Livrables (${livrables.length})`}
          action={
            <Link to={`/projets/${project.id}/livrables`} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Voir tout →
            </Link>
          }
        >
          <ul className="space-y-1.5">
            {livrables.map((l, i) => (
              <li key={l.id || i} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-gray-400 font-mono w-5 shrink-0">{i + 1}.</span>
                <span className="text-gray-800 font-medium">{l.nom || <span className="italic text-gray-400">Sans nom</span>}</span>
                <span className="text-gray-400">·</span>
                <span className="text-xs text-gray-500">{[l.format, l.duree].filter(Boolean).join(' — ') || '—'}</span>
                {l.livraison && (
                  <>
                    <span className="text-gray-400">·</span>
                    <span className="text-xs text-gray-500">Livraison {l.livraison}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* ── NOTE DE PROD (admin/charge_prod uniquement) ──────────────────── */}
      {canEdit && project.note_prod && (
        <SectionCard icon={<StickyNote className="w-4 h-4" />} title="Note de production / hors devis">
          <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{project.note_prod}</p>
        </SectionCard>
      )}
    </>
  )
}

// ─── Sous-composants de la vue lecture ──────────────────────────────────────

// Avatar projet 64×64. Cascade de fallback :
//   1) project.cover_url      (à venir, upload côté projet — colonne future)
//   2) project.clients.logo_url (logo client déjà géré côté DB clients)
//   3) initiales du titre projet sur fond coloré déterministe
function ProjectAvatar({ project }) {
  const src = project.cover_url || project.clients?.logo_url || null

  if (src) {
    return (
      <img
        src={src}
        alt={project.title || 'Projet'}
        className="w-16 h-16 rounded-xl object-cover shrink-0 ring-1 ring-gray-100 bg-white"
        onError={e => { e.currentTarget.style.display = 'none' }}
      />
    )
  }

  // Fallback : initiales sur fond coloré (hash déterministe sur le titre)
  const title = (project.title || '?').trim()
  const initials = title
    .split(/\s+/).slice(0, 2)
    .map(w => w[0]).join('')
    .toUpperCase() || '?'

  const palette = [
    'from-blue-500 to-indigo-600',
    'from-purple-500 to-pink-600',
    'from-emerald-500 to-teal-600',
    'from-amber-500 to-orange-600',
    'from-rose-500 to-red-600',
    'from-cyan-500 to-blue-600',
  ]
  let h = 0
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) | 0
  const grad = palette[Math.abs(h) % palette.length]

  return (
    <div className={`w-16 h-16 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold text-lg shrink-0 ring-1 ring-black/5 shadow-sm`}>
      {initials}
    </div>
  )
}

// Uploader pour le visuel projet — composant utilisé en mode édition.
// Upload vers Supabase Storage (bucket "project-covers"), path = <projectId>/<filename>.
// Met à jour le draft via onChange(url) avec l'URL publique. La persistance en
// base se fait via le bouton "Enregistrer" classique (cover_url est dans le draft).
function ProjectCoverUploader({ projectId, project, currentUrl, onChange }) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  async function handleFile(file) {
    if (!file || !projectId) return
    setError(null)

    if (!file.type.startsWith('image/')) {
      setError('Le fichier doit être une image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image trop lourde (max 5 Mo).')
      return
    }

    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${projectId}/cover-${Date.now()}.${ext}`

      const { error: upErr } = await supabase.storage
        .from('project-covers')
        .upload(path, file, { upsert: true, contentType: file.type })
      if (upErr) throw upErr

      const { data: pub } = supabase.storage
        .from('project-covers')
        .getPublicUrl(path)

      onChange(pub.publicUrl)
    } catch (e) {
      console.error('Upload cover projet:', e)
      setError(e.message || 'Erreur lors de l\'upload.')
    } finally {
      setUploading(false)
    }
  }

  function handleRemove() {
    onChange('')
    setError(null)
  }

  // L'avatar préview reflète l'état courant (URL ou fallback initiales du draft)
  const previewProject = { ...project, cover_url: currentUrl }

  return (
    <div>
      <FieldLabel>Visuel du projet</FieldLabel>
      <div className="flex items-center gap-4">
        <ProjectAvatar project={previewProject} />
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
              className="btn-secondary btn-sm"
            >
              {uploading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {uploading ? 'Envoi…' : (currentUrl ? 'Remplacer' : 'Téléverser')}
            </button>
            {currentUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={uploading}
                className="btn-secondary btn-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="w-3.5 h-3.5" />Retirer
              </button>
            )}
          </div>
          <p className="text-[11px] text-gray-400">
            JPG, PNG ou WebP — 5 Mo max. À défaut, le logo du client (s'il existe) ou les initiales du projet seront utilisés.
          </p>
          {error && <p className="text-[11px] text-red-600">{error}</p>}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}

function SubLine({ get, project }) {
  const parts = [
    get('type_projet'),
    get('realisateur') && `Réalisé par ${get('realisateur')}`,
    get('agence') && `Agence ${get('agence')}`,
  ].filter(Boolean)
  if (!parts.length) return null
  return <p className="text-sm text-gray-500">{parts.join(' · ')}</p>
}

function ClientLine({ project }) {
  const c = project.clients
  const ref = project.ref_projet
  if (!c && !ref) return null
  return (
    <div className="flex items-center gap-3 mt-1 text-xs text-gray-400 flex-wrap">
      {c?.name && <span className="text-gray-600 font-medium">{c.name}</span>}
      {ref && <span className="font-mono">{ref}</span>}
      {c?.email && (
        <span className="flex items-center gap-1">
          <Mail className="w-3 h-3" />{c.email}
        </span>
      )}
      {c?.phone && (
        <span className="flex items-center gap-1">
          <Phone className="w-3 h-3" />{c.phone}
        </span>
      )}
      {c?.address && (
        <span className="flex items-center gap-1">
          <MapPin className="w-3 h-3" />{c.address}
        </span>
      )}
    </div>
  )
}

// Footer compact regroupant les infos admin (réf, BC, date devis)
// et l'accès délégué vers AccessTab. Visible uniquement pour admin/charge_prod.
function AdminFooter({ project, accessCount }) {
  const adminBits = [
    project.ref_projet   && { label: 'Réf', value: project.ref_projet, mono: true },
    project.bon_commande && { label: 'BC',  value: project.bon_commande, mono: true },
    project.date_devis   && { label: 'Devis du', value: project.date_devis },
  ].filter(Boolean)

  const accessLabel =
    accessCount === null ? '—' :
    accessCount === 0    ? 'Aucun accès délégué' :
    `${accessCount} utilisateur${accessCount > 1 ? 's' : ''}`

  return (
    <div className="card mt-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5 text-xs">
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-gray-500">
        <Building2 className="w-3.5 h-3.5 text-gray-400" />
        {adminBits.length === 0 ? (
          <span className="italic text-gray-400">Aucune info admin renseignée</span>
        ) : adminBits.map((b, i) => (
          <span key={b.label} className="flex items-center gap-1.5">
            <span className="text-gray-400 uppercase tracking-wide text-[10px] font-semibold">{b.label}</span>
            <span className={`text-gray-700 ${b.mono ? 'font-mono' : ''}`}>{b.value}</span>
            {i < adminBits.length - 1 && <span className="text-gray-300 ml-3">·</span>}
          </span>
        ))}
      </div>
      <Link
        to={`/projets/${project.id}/access`}
        className="flex items-center gap-1.5 text-gray-500 hover:text-blue-600 transition-colors"
      >
        <Shield className="w-3.5 h-3.5 text-gray-400" />
        <span>{accessLabel}</span>
        <span className="text-blue-600 font-medium ml-1">Gérer →</span>
      </Link>
    </div>
  )
}

function SectionCard({ icon, title, action, children }) {
  return (
    <div className="card overflow-visible">
      <div className="card-header">
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-gray-400">{icon}</span>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</h2>
        </div>
        {action && <div>{action}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function InfoGrid({ items }) {
  const filled = items.filter(i => i.value)
  if (!filled.length) return <EmptyHint>Aucune information renseignée.</EmptyHint>
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-3">
      {filled.map(i => (
        <div key={i.label} className="min-w-[160px]">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{i.label}</p>
          <p className="text-sm text-gray-800 mt-0.5">{i.value}</p>
        </div>
      ))}
    </div>
  )
}

function EmptyHint({ children }) {
  return <p className="text-xs text-gray-400 italic">{children}</p>
}

// ══════════════════════════════════════════════════════════════════════════════
// VUE ÉDITION — formulaire complet (admin + charge_prod uniquement)
// ══════════════════════════════════════════════════════════════════════════════
function EditView({ draft, setDraft, clientsList, onCancel, onSave, saving, showAdmin, setShowAdmin, projectId }) {
  const setA = (k, v) => setDraft(p => ({ ...p, [k]: v }))
  const setF = (k, v) => setDraft(p => ({ ...p, fields: { ...p.fields, [k]: v } }))

  function addLivrable() {
    setDraft(p => ({ ...p, livrables: [...p.livrables, EMPTY_LIVRABLE()] }))
  }
  function updateLivrable(id, key, val) {
    setDraft(p => ({
      ...p,
      livrables: p.livrables.map(l => l.id === id ? { ...l, [key]: val } : l),
    }))
  }
  function deleteLivrable(id) {
    setDraft(p => ({
      ...p,
      livrables: p.livrables.filter(l => l.id !== id).length
        ? p.livrables.filter(l => l.id !== id)
        : [EMPTY_LIVRABLE()],
    }))
  }

  function renderDynField(key) {
    const def = PROJET_FIELDS_DEF.find(f => f.key === key)
    if (!def) return null
    return (
      <Field
        key={key}
        label={def.label}
        placeholder={def.placeholder}
        value={draft.fields[key] || ''}
        onChange={v => setF(key, v)}
      />
    )
  }

  return (
    <>
      {/* ── Barre d'actions sticky en haut ───────────────────────────────── */}
      <div className="sticky top-2 z-20 card px-4 py-2.5 flex items-center justify-between shadow-md ring-1 ring-blue-100">
        <div className="flex items-center gap-2 text-gray-700">
          <Edit2 className="w-4 h-4 text-blue-500" />
          <span className="text-sm font-semibold">Mode édition</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onCancel} disabled={saving} className="btn-secondary btn-sm">
            <X className="w-3.5 h-3.5" />Annuler
          </button>
          <button onClick={onSave} disabled={saving} className="btn-primary btn-sm">
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      {/* ── BLOC DÉTAILS ADMIN (repliable, en 2e position pour ne pas l'oublier) ─ */}
      <div className="card overflow-visible">
        <button
          type="button"
          onClick={() => setShowAdmin(s => !s)}
          className="w-full card-header flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 text-gray-700">
            <Building2 className="w-4 h-4 text-gray-400" />
            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">Détails admin</h2>
          </div>
          {showAdmin ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>
        {showAdmin && (
          <div className="p-5 space-y-3">
            <Field label="Référence projet" placeholder="CAPTIV-2026-001"
              value={draft.ref_projet} onChange={v => setA('ref_projet', v)} />
            <Field label="Bon de commande client" placeholder="N° BC / PO"
              value={draft.bon_commande} onChange={v => setA('bon_commande', v)} />
            <Field label="Date du devis" type="date"
              value={draft.date_devis} onChange={v => setA('date_devis', v)} />
          </div>
        )}
      </div>

      {/* ── BLOC IDENTITÉ ────────────────────────────────────────────────── */}
      <Block icon={<Clapperboard className="w-4 h-4" />} title="Identité">
        <div className="space-y-4">
          {/* Visuel projet (upload Supabase Storage → cover_url) */}
          <ProjectCoverUploader
            projectId={projectId}
            project={draft}
            currentUrl={draft.cover_url}
            onChange={url => setA('cover_url', url)}
          />
          <Field
            label="Nom du projet"
            placeholder="Titre du projet…"
            value={draft.title}
            onChange={v => setA('title', v)}
            big
          />
          <div>
            <FieldLabel>Description</FieldLabel>
            <textarea
              className="input text-sm w-full resize-y min-h-[80px]"
              placeholder="Description du projet (visible par tous les utilisateurs ayant accès)…"
              value={draft.description}
              onChange={e => setA('description', e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Client</FieldLabel>
            <select
              className="input text-sm"
              value={draft.client_id || ''}
              onChange={e => setA('client_id', e.target.value)}
            >
              <option value="">— Aucun client —</option>
              {clientsList.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <FieldSubSection label="Général">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['type_projet', 'titre_projet'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Production">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['agence', 'production', 'production_executive'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Équipe">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['realisateur', 'producteur'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Spécifications">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['nb_livrables', 'duree_master', 'format_master'].map(renderDynField)}
            </div>
          </FieldSubSection>
          <FieldSubSection label="Planning">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {['prepa_jours', 'prepa_dates', 'tournage_jours', 'tournage_dates', 'envoi_v1', 'livraison_master', 'deadline'].map(renderDynField)}
            </div>
          </FieldSubSection>
        </div>
      </Block>

      {/* ── BLOC LIVRABLES ───────────────────────────────────────────────── */}
      <Block icon={<FileText className="w-4 h-4" />} title="Livrables"
        actions={
          <button onClick={addLivrable} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
            <Plus className="w-3.5 h-3.5" />Ajouter
          </button>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-8">N°</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400">NOM</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-32">FORMAT</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-24">DURÉE</th>
                <th className="text-left py-2 px-2 text-xs font-semibold text-gray-400 w-32">LIVRAISON</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {draft.livrables.map((l, i) => (
                <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50/50 group">
                  <td className="py-1.5 px-2 text-xs text-gray-400 font-mono">{i + 1}</td>
                  <td className="py-1.5 px-1">
                    <input className="input-cell w-full text-sm" value={l.nom}
                      onChange={e => updateLivrable(l.id, 'nom', e.target.value)}
                      placeholder="Film 3 min 16/9…" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input className="input-cell w-full text-xs" value={l.format}
                      onChange={e => updateLivrable(l.id, 'format', e.target.value)}
                      placeholder="MP4, MOV…" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input className="input-cell w-full text-xs" value={l.duree}
                      onChange={e => updateLivrable(l.id, 'duree', e.target.value)}
                      placeholder="3'00&quot;" />
                  </td>
                  <td className="py-1.5 px-1">
                    <input className="input-cell w-full text-xs" value={l.livraison}
                      onChange={e => updateLivrable(l.id, 'livraison', e.target.value)}
                      placeholder="01/06/2026" />
                  </td>
                  <td className="py-1.5 px-1">
                    <button onClick={() => deleteLivrable(l.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      {/* ── BLOC NOTE DE PROD ────────────────────────────────────────────── */}
      <Block icon={<StickyNote className="w-4 h-4" />} title="Note de production / hors devis">
        <textarea
          className="w-full text-sm text-gray-700 bg-amber-50/60 border border-amber-100 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-amber-300 focus:border-amber-300 placeholder-amber-300"
          rows={6}
          placeholder="Informations hors devis, contraintes techniques, budget hors-champ, remarques de production…"
          value={draft.noteProd}
          onChange={e => setA('noteProd', e.target.value)}
        />
      </Block>

    </>
  )
}

// ─── Composants utilitaires (formulaire) ──────────────────────────────────────
function Block({ icon, title, children, actions }) {
  return (
    <div className="card overflow-visible">
      <div className="card-header">
        <div className="flex items-center gap-2 text-gray-700">
          <span className="text-gray-400">{icon}</span>
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500">{title}</h2>
        </div>
        {actions && <div>{actions}</div>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function FieldSubSection({ label, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-px flex-1 bg-gray-100" />
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest px-1">{label}</span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children }) {
  return <label className="text-xs font-medium text-gray-500 block mb-1.5">{children}</label>
}

function Field({ label, value, onChange, placeholder, type = 'text', big = false }) {
  return (
    <div>
      {label && <FieldLabel>{label}</FieldLabel>}
      <input
        type={type}
        className={`input ${big ? 'text-base font-semibold text-gray-900' : 'text-sm'}`}
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  )
}

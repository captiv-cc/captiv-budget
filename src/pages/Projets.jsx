import { useState, useEffect, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { notify } from '../lib/notify'
import { useAuth } from '../contexts/AuthContext'
import {
  LayoutGrid,
  List as ListIcon,
  Archive,
  ArchiveRestore,
  ChevronDown,
  Plus,
  Search,
  Trash2,
  ArrowRight,
  FolderOpen,
} from 'lucide-react'
import { STATUS_OPTIONS } from '../features/projets/constants'
import StatusBadgeMenu from '../features/projets/components/StatusBadgeMenu'
import ProjectAvatar from '../features/projets/components/ProjectAvatar'

// Persisté en localStorage : la préférence de vue de l'utilisateur
const VIEW_KEY = 'captiv:projets-view'

// Options de tri exposées dans la barre d'outils
const SORT_OPTIONS = [
  { value: 'recent', label: 'Récents' },
  { value: 'oldest', label: 'Anciens' },
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'deadline', label: 'Échéance' },
]

export default function Projets() {
  const { org, profile, isInternal, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all' ou un value de STATUS_OPTIONS
  const [sortBy, setSortBy] = useState('recent')
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'list'
    return window.localStorage.getItem(VIEW_KEY) || 'list'
  })
  const [showModal, setShowModal] = useState(false)
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, viewMode)
    } catch {
      // Ignore localStorage errors
    }
  }, [viewMode])
  const [form, setForm] = useState({
    title: '',
    client_id: '',
    status: 'prospect',
    description: '',
    date_debut: '',
    date_fin: '',
  })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (org?.id) loadAll()
  }, [org?.id])

  async function loadAll() {
    setLoading(true)
    const [projRes, clsRes] = await Promise.all([
      supabase
        .from('projects')
        .select('*, clients(name)')
        .eq('org_id', org.id)
        .order('updated_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('org_id', org.id).order('name'),
    ])
    if (projRes.error) {
      console.error('[Projets] load projects:', projRes.error)
      notify.error('Impossible de charger les projets')
    }
    if (clsRes.error) {
      console.error('[Projets] load clients:', clsRes.error)
      notify.error('Impossible de charger les clients')
    }
    setProjects(projRes.data || [])
    setClients(clsRes.data || [])
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const { data, error } = await supabase
      .from('projects')
      .insert({ ...form, org_id: org.id, created_by: profile?.id })
      .select()
      .single()
    if (error) {
      console.error('[Projets] create:', error)
      notify.error('Impossible de créer le projet : ' + error.message)
      return
    }
    if (data) {
      setShowModal(false)
      setForm({
        title: '',
        client_id: '',
        status: 'prospect',
        description: '',
        date_debut: '',
        date_fin: '',
      })
      navigate(`/projets/${data.id}`)
    }
  }

  async function deleteProject(id) {
    if (!isAdmin) return
    if (!confirm('Supprimer ce projet et tous ses devis ?')) return
    const { error } = await supabase.from('projects').delete().eq('id', id)
    if (error) {
      console.error('[Projets] delete:', error)
      notify.error('Impossible de supprimer le projet : ' + error.message)
      return
    }
    setProjects((p) => p.filter((x) => x.id !== id))
    notify.success('Projet supprimé')
  }

  // Archivage : flag d'affichage uniquement, le contenu du projet est intact.
  // Optimistic update + rollback en cas d'erreur réseau, pour rester réactif.
  async function archiveProject(id) {
    if (!isInternal) return
    if (
      !confirm(
        'Archiver ce projet ? Il sera masqué de la liste principale et accessible via "Projets archivés".',
      )
    )
      return
    const previous = projects
    const now = new Date().toISOString()
    setProjects((p) => p.map((x) => (x.id === id ? { ...x, archived_at: now } : x)))
    const { error } = await supabase.from('projects').update({ archived_at: now }).eq('id', id)
    if (error) {
      console.error('[Projets] archive:', error)
      setProjects(previous)
      notify.error("Impossible d'archiver : " + error.message)
    }
  }

  async function unarchiveProject(id) {
    if (!isInternal) return
    if (!confirm('Désarchiver ce projet ? Il réapparaîtra dans la liste principale.')) return
    const previous = projects
    setProjects((p) => p.map((x) => (x.id === id ? { ...x, archived_at: null } : x)))
    const { error } = await supabase.from('projects').update({ archived_at: null }).eq('id', id)
    if (error) {
      console.error('[Projets] unarchive:', error)
      setProjects(previous)
      notify.error('Impossible de désarchiver : ' + error.message)
    }
  }

  async function updateStatus(projectId, newStatus) {
    // Optimistic UI : on bascule l'affichage avant la confirmation serveur
    const previous = projects
    setProjects((p) => p.map((x) => (x.id === projectId ? { ...x, status: newStatus } : x)))
    const { error } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', projectId)
    if (error) {
      console.error('[Projets] updateStatus:', error)
      setProjects(previous)
      notify.error('Impossible de mettre à jour le statut : ' + error.message)
    }
  }

  // Pipeline : on sépare les projets en deux piles (actifs / archivés) puis on
  // applique recherche, filtre statut, et tri. Tout passe par un seul useMemo
  // pour éviter de balayer projects[] plusieurs fois par render.
  const { activeList, archivedList, statusCounts } = useMemo(() => {
    const q = search.trim().toLowerCase()
    const matchSearch = (p) =>
      !q || p.title.toLowerCase().includes(q) || p.clients?.name?.toLowerCase().includes(q)

    const cmp = (a, b) => {
      switch (sortBy) {
        case 'oldest':
          return new Date(a.updated_at) - new Date(b.updated_at)
        case 'az':
          return (a.title || '').localeCompare(b.title || '', 'fr')
        case 'za':
          return (b.title || '').localeCompare(a.title || '', 'fr')
        case 'deadline':
          if (!a.date_fin && !b.date_fin) return 0
          if (!a.date_fin) return 1
          if (!b.date_fin) return -1
          return new Date(a.date_fin) - new Date(b.date_fin)
        case 'recent':
        default:
          return new Date(b.updated_at) - new Date(a.updated_at)
      }
    }

    const active = []
    const archived = []
    // Compteurs : seuls les projets non archivés alimentent les chips —
    // l'archivage est un layer indépendant du statut métier.
    const counts = { all: 0 }
    for (const opt of STATUS_OPTIONS) counts[opt.value] = 0

    for (const p of projects) {
      if (p.archived_at) {
        // Section archivée : on applique uniquement la recherche, pas le
        // filtre statut (sinon "En cours" cacherait des projets archivés
        // terminés et l'utilisateur ne saurait pas où ils sont passés).
        if (matchSearch(p)) archived.push(p)
        continue
      }
      counts.all++
      if (counts[p.status] !== undefined) counts[p.status]++
      if (matchSearch(p) && (statusFilter === 'all' || p.status === statusFilter)) {
        active.push(p)
      }
    }

    active.sort(cmp)
    // Archivés : tri par date d'archivage récente, indépendamment du sortBy global
    archived.sort((a, b) => new Date(b.archived_at) - new Date(a.archived_at))

    return { activeList: active, archivedList: archived, statusCounts: counts }
  }, [projects, search, statusFilter, sortBy])

  // Auto-expand de la section archivée quand on tape une recherche qui matche
  // des projets archivés. On ne force pas le repli si l'utilisateur l'a ouverte
  // manuellement, d'où le OR.
  const showArchived = archivedExpanded || (search.trim() !== '' && archivedList.length > 0)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Projets
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {statusCounts.all} projets
          </p>
        </div>
        {isInternal && (
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau projet
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          className="input pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un projet ou un client…"
        />
      </div>

      {/* Toolbar : chips de filtre à gauche, tri + toggle vue à droite */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip
            label="Tous"
            count={statusCounts.all}
            active={statusFilter === 'all'}
            onClick={() => setStatusFilter('all')}
          />
          {STATUS_OPTIONS.map((opt) => (
            <FilterChip
              key={opt.value}
              label={opt.label}
              count={statusCounts[opt.value] || 0}
              active={statusFilter === opt.value}
              onClick={() => setStatusFilter(opt.value)}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Tri */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="text-xs rounded-md px-2.5 py-1.5 outline-none cursor-pointer"
            style={{
              background: 'var(--bg-elev)',
              border: '1px solid var(--brd-sub)',
              color: 'var(--txt-2)',
            }}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Toggle vue liste / grille */}
          <div
            className="flex items-center rounded-md p-0.5"
            style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
          >
            <ViewToggleButton
              active={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              icon={ListIcon}
              title="Vue liste"
            />
            <ViewToggleButton
              active={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              icon={LayoutGrid}
              title="Vue grille"
            />
          </div>
        </div>
      </div>

      {/* Contenu : liste ou grille */}
      {loading && (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      )}
      {!loading && activeList.length === 0 && (
        <div className="card p-12 text-center">
          <FolderOpen className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            Aucun projet trouvé
          </p>
        </div>
      )}

      {!loading && activeList.length > 0 && viewMode === 'list' && (
        <ProjectListView
          projects={activeList}
          isAdmin={isAdmin}
          isInternal={isInternal}
          onUpdateStatus={updateStatus}
          onDelete={deleteProject}
          onArchive={archiveProject}
        />
      )}

      {!loading && activeList.length > 0 && viewMode === 'grid' && (
        <ProjectGridView
          projects={activeList}
          isAdmin={isAdmin}
          isInternal={isInternal}
          onUpdateStatus={updateStatus}
          onDelete={deleteProject}
          onArchive={archiveProject}
        />
      )}

      {/* ── Section "Projets archivés" ─────────────────────────────────── */}
      {!loading && (archivedList.length > 0 || archivedExpanded) && (
        <div className="mt-8">
          <button
            onClick={() => setArchivedExpanded((v) => !v)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-1 py-1.5 rounded transition-colors"
            style={{ color: 'var(--txt-3)', letterSpacing: '0.08em' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
          >
            <ChevronDown
              className="w-3.5 h-3.5 transition-transform"
              style={{ transform: showArchived ? 'rotate(0deg)' : 'rotate(-90deg)' }}
            />
            <Archive className="w-3.5 h-3.5" />
            <span>Projets archivés ({archivedList.length})</span>
          </button>

          {showArchived && (
            <div className="mt-3">
              {archivedList.length === 0 && (
                <p className="text-xs px-1" style={{ color: 'var(--txt-3)' }}>
                  Aucun projet archivé pour cette recherche.
                </p>
              )}
              {archivedList.length > 0 && viewMode === 'list' && (
                <ProjectListView
                  projects={archivedList}
                  isAdmin={isAdmin}
                  isInternal={isInternal}
                  onUpdateStatus={updateStatus}
                  onDelete={deleteProject}
                  onUnarchive={unarchiveProject}
                  archived
                />
              )}
              {archivedList.length > 0 && viewMode === 'grid' && (
                <ProjectGridView
                  projects={archivedList}
                  isAdmin={isAdmin}
                  isInternal={isInternal}
                  onUpdateStatus={updateStatus}
                  onDelete={deleteProject}
                  onUnarchive={unarchiveProject}
                  archived
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal nouveau projet */}
      {showModal && (
        <Modal title="Nouveau projet" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="label">Titre du projet *</label>
              <input
                className="input"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Ex: Film institutionnel 2026"
                required
              />
            </div>
            <div>
              <label className="label">Client</label>
              <select
                className="input"
                value={form.client_id}
                onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}
              >
                <option value="">— Sélectionner un client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date début</label>
                <input
                  type="date"
                  className="input"
                  value={form.date_debut}
                  onChange={(e) => setForm((f) => ({ ...f, date_debut: e.target.value }))}
                />
              </div>
              <div>
                <label className="label">Date fin</label>
                <input
                  type="date"
                  className="input"
                  value={form.date_fin}
                  onChange={(e) => setForm((f) => ({ ...f, date_fin: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="label">Statut</label>
              <select
                className="input"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input resize-none h-20"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Brève description du projet…"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                Annuler
              </button>
              <button type="submit" className="btn-primary">
                Créer le projet
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ─── Vues partagées (utilisées par la liste active ET la liste archivée) ──

function ProjectListView({
  projects,
  isAdmin,
  isInternal,
  onUpdateStatus,
  onDelete,
  onArchive,
  onUnarchive,
  archived,
}) {
  return (
    <div className="card" style={{ overflow: 'hidden', opacity: archived ? 0.75 : 1 }}>
      {projects.map((p, i) => (
        <div
          key={p.id}
          className="flex items-center justify-between px-5 py-3.5 transition-colors group"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Link to={`/projets/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0">
            <ProjectAvatar project={p} size={40} rounded="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                {p.title}
              </p>
              <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                {p.clients?.name || '—'}
              </p>
            </div>
          </Link>
          <div className="ml-4 shrink-0">
            <StatusBadgeMenu
              project={p}
              onChange={onUpdateStatus}
              canEdit={isInternal && !archived}
            />
          </div>
          <span className="text-xs shrink-0 ml-3" style={{ color: 'var(--txt-3)' }}>
            {new Date(p.updated_at).toLocaleDateString('fr-FR')}
          </span>
          <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
            {isAdmin && (
              <button
                onClick={() => onDelete(p.id)}
                className="btn-ghost btn-sm"
                style={{ color: 'var(--txt-3)' }}
                title="Supprimer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {isInternal && !archived && onArchive && (
              <button
                onClick={() => onArchive(p.id)}
                className="btn-ghost btn-sm"
                style={{ color: 'var(--txt-3)' }}
                title="Archiver"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            )}
            {isInternal && archived && onUnarchive && (
              <button
                onClick={() => onUnarchive(p.id)}
                className="btn-ghost btn-sm"
                style={{ color: 'var(--txt-3)' }}
                title="Désarchiver"
              >
                <ArchiveRestore className="w-3.5 h-3.5" />
              </button>
            )}
            <Link to={`/projets/${p.id}`} className="btn-ghost btn-sm">
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      ))}
    </div>
  )
}

function ProjectGridView({
  projects,
  _isAdmin,
  isInternal,
  onUpdateStatus,
  _onDelete,
  onArchive,
  onUnarchive,
  archived,
}) {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3"
      style={{ opacity: archived ? 0.75 : 1 }}
    >
      {projects.map((p) => (
        <div key={p.id} className="relative group">
          <Link
            to={`/projets/${p.id}`}
            className="card p-4 transition-all flex flex-col gap-3"
            style={{ textDecoration: 'none' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--brd)'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = ''
              e.currentTarget.style.transform = ''
            }}
          >
            <ProjectAvatar project={p} size={48} rounded="lg" />
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                {p.title}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                {p.clients?.name || '—'}
              </p>
            </div>
            <div className="flex items-center justify-between mt-auto">
              <StatusBadgeMenu
                project={p}
                onChange={onUpdateStatus}
                canEdit={isInternal && !archived}
              />
              <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                {new Date(p.updated_at).toLocaleDateString('fr-FR')}
              </span>
            </div>
          </Link>
          {/* Bouton archive/unarchive en absolute, top-right, visible au hover */}
          {isInternal && (
            <button
              onClick={archived ? () => onUnarchive(p.id) : () => onArchive(p.id)}
              className="absolute top-2 right-2 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-all"
              style={{
                width: '26px',
                height: '26px',
                background: 'var(--bg-elev)',
                border: '1px solid var(--brd-sub)',
                color: 'var(--txt-3)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--txt)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--txt-3)'
              }}
              title={archived ? 'Désarchiver' : 'Archiver'}
            >
              {archived ? (
                <ArchiveRestore className="w-3.5 h-3.5" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Petits composants UI ────────────────────────────────────────────────────

function FilterChip({ label, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="text-xs font-medium rounded-full px-3 py-1.5 transition-all flex items-center gap-1.5"
      style={
        active
          ? { background: 'var(--blue-bg)', color: 'var(--blue)', border: '1px solid transparent' }
          : { background: 'transparent', color: 'var(--txt-2)', border: '1px solid var(--brd-sub)' }
      }
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-hov)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span>{label}</span>
      <span className="text-[10px] opacity-70">{count}</span>
    </button>
  )
}

function ViewToggleButton({ active, onClick, icon: Icon, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center justify-center rounded transition-all"
      style={{
        width: '26px',
        height: '24px',
        background: active ? 'var(--bg-hov)' : 'transparent',
        color: active ? 'var(--txt)' : 'var(--txt-3)',
      }}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

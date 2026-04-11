import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Search, FolderOpen, ArrowRight, Trash2, Edit2 } from 'lucide-react'
import { STATUS_OPTIONS } from '../features/projets/constants'
import StatusBadgeMenu from '../features/projets/components/StatusBadgeMenu'
import ProjectAvatar from '../features/projets/components/ProjectAvatar'

export default function Projets() {
  const { org, profile, isInternal, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [clients, setClients]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [search, setSearch]     = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', client_id: '', status: 'prospect', description: '', date_debut: '', date_fin: '' })

  useEffect(() => { if (org?.id) loadAll() }, [org])

  async function loadAll() {
    setLoading(true)
    const [{ data: projs }, { data: cls }] = await Promise.all([
      supabase.from('projects').select('*, clients(name)').eq('org_id', org.id).order('updated_at', { ascending: false }),
      supabase.from('clients').select('id, name').eq('org_id', org.id).order('name'),
    ])
    setProjects(projs || [])
    setClients(cls || [])
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    const { data } = await supabase.from('projects')
      .insert({ ...form, org_id: org.id, created_by: profile?.id })
      .select().single()
    if (data) {
      setShowModal(false)
      setForm({ title: '', client_id: '', status: 'prospect', description: '', date_debut: '', date_fin: '' })
      navigate(`/projets/${data.id}`)
    }
  }

  async function deleteProject(id) {
    if (!isAdmin) return
    if (!confirm('Supprimer ce projet et tous ses devis ?')) return
    await supabase.from('projects').delete().eq('id', id)
    setProjects(p => p.filter(x => x.id !== id))
  }

  async function updateStatus(projectId, newStatus) {
    // Optimistic UI : on bascule l'affichage avant la confirmation serveur
    const previous = projects
    setProjects(p => p.map(x => x.id === projectId ? { ...x, status: newStatus } : x))
    const { error } = await supabase
      .from('projects')
      .update({ status: newStatus })
      .eq('id', projectId)
    if (error) {
      console.error('Erreur changement statut projet:', error)
      setProjects(previous)
      alert('Impossible de mettre à jour le statut : ' + error.message)
    }
  }

  const filtered = projects.filter(p =>
    p.title.toLowerCase().includes(search.toLowerCase()) ||
    p.clients?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Projets</h1>
          <p className="text-sm text-gray-500 mt-0.5">{projects.length} projets</p>
        </div>
        {isInternal && (
          <button onClick={() => setShowModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Nouveau projet
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Rechercher un projet ou un client…" />
      </div>

      {/* Liste */}
      <div className="card divide-y divide-gray-50">
        {loading && (
          <div className="p-8 text-center text-sm text-gray-400">Chargement…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="p-12 text-center">
            <FolderOpen className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Aucun projet trouvé</p>
          </div>
        )}
        {filtered.map(p => (
          <div key={p.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 transition-colors group">
            <Link to={`/projets/${p.id}`} className="flex items-center gap-3 flex-1 min-w-0">
              <ProjectAvatar project={p} size={40} rounded="lg" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">{p.title}</p>
                <p className="text-xs text-gray-500">{p.clients?.name || '—'}</p>
              </div>
            </Link>
            <div className="ml-4 shrink-0">
              <StatusBadgeMenu project={p} onChange={updateStatus} canEdit={isInternal} />
            </div>
            <span className="text-xs text-gray-400 shrink-0 ml-3">
              {new Date(p.updated_at).toLocaleDateString('fr-FR')}
            </span>
            <div className="flex items-center gap-1 ml-3 opacity-0 group-hover:opacity-100 transition-opacity">
              {isAdmin && (
                <button onClick={() => deleteProject(p.id)} className="btn-ghost btn-sm text-gray-400 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <Link to={`/projets/${p.id}`} className="btn-ghost btn-sm">
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      {/* Modal nouveau projet */}
      {showModal && (
        <Modal title="Nouveau projet" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="label">Titre du projet *</label>
              <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                placeholder="Ex: Film institutionnel 2026" required />
            </div>
            <div>
              <label className="label">Client</label>
              <select className="input" value={form.client_id} onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}>
                <option value="">— Sélectionner un client —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date début</label>
                <input type="date" className="input" value={form.date_debut} onChange={e => setForm(f => ({ ...f, date_debut: e.target.value }))} />
              </div>
              <div>
                <label className="label">Date fin</label>
                <input type="date" className="input" value={form.date_fin} onChange={e => setForm(f => ({ ...f, date_fin: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="label">Statut</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Description</label>
              <textarea className="input resize-none h-20" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Brève description du projet…" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Annuler</button>
              <button type="submit" className="btn-primary">Créer le projet</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  )
}

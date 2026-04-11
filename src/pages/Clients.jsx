import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { Plus, Search, Trash2, Edit2, Users, X, Check } from 'lucide-react'

const EMPTY = { name:'', contact_name:'', email:'', phone:'', address:'', siret:'', tva_number:'', notes:'' }

export default function Clients() {
  const { org } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [modal, setModal]     = useState(null) // null | 'create' | client_obj
  const [form, setForm]       = useState(EMPTY)
  const [saving, setSaving]   = useState(false)

  useEffect(() => { if (org?.id) load() }, [org])

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('clients').select('*').eq('org_id', org.id).order('name')
    setClients(data || [])
    setLoading(false)
  }

  function openCreate() { setForm(EMPTY); setModal('create') }
  function openEdit(c)  { setForm({ name: c.name, contact_name: c.contact_name||'', email: c.email||'', phone: c.phone||'', address: c.address||'', siret: c.siret||'', tva_number: c.tva_number||'', notes: c.notes||'' }); setModal(c) }

  async function save(e) {
    e.preventDefault(); setSaving(true)
    try {
      if (!org?.id) throw new Error('Organisation introuvable — rechargez la page (Cmd+R)')

      if (modal === 'create') {
        const { data, error } = await supabase.from('clients').insert({ ...form, org_id: org.id }).select().single()
        if (error) throw error
        if (data) setClients(p => [...p, data].sort((a,b) => a.name.localeCompare(b.name)))
      } else {
        const { data, error } = await supabase.from('clients').update(form).eq('id', modal.id).select().single()
        if (error) throw error
        if (data) setClients(p => p.map(c => c.id === data.id ? data : c))
      }
      setModal(null)
    } catch(err) {
      alert('Erreur : ' + (err.message || JSON.stringify(err)))
    } finally { setSaving(false) }
  }

  async function del(id) {
    if (!confirm('Supprimer ce client ?')) return
    await supabase.from('clients').delete().eq('id', id)
    setClients(p => p.filter(c => c.id !== id))
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Clients</h1><p className="text-sm text-gray-500">{clients.length} clients</p></div>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" /> Nouveau client</button>
      </div>

      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" />
      </div>

      <div className="card divide-y divide-gray-50">
        {loading && <div className="p-8 text-center text-sm text-gray-400">Chargement…</div>}
        {!loading && filtered.length === 0 && (
          <div className="p-12 text-center">
            <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500 text-sm">Aucun client</p>
          </div>
        )}
        {filtered.map(c => (
          <div key={c.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 group">
            <div>
              <p className="text-sm font-semibold text-gray-900">{c.name}</p>
              <p className="text-xs text-gray-500">{[c.contact_name, c.email, c.phone].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEdit(c)} className="btn-ghost btn-sm"><Edit2 className="w-3.5 h-3.5" /></button>
              <button onClick={() => del(c.id)} className="btn-ghost btn-sm text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">{modal === 'create' ? 'Nouveau client' : 'Modifier le client'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={save} className="p-6 space-y-4">
              <div>
                <label className="label">Raison sociale *</label>
                <input className="input" value={form.name} onChange={e => setForm(f=>({...f, name:e.target.value}))} required placeholder="Nom de la société ou du client" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Contact</label><input className="input" value={form.contact_name} onChange={e => setForm(f=>({...f, contact_name:e.target.value}))} placeholder="Nom du contact" /></div>
                <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={e => setForm(f=>({...f, email:e.target.value}))} placeholder="contact@client.fr" /></div>
                <div><label className="label">Téléphone</label><input className="input" value={form.phone} onChange={e => setForm(f=>({...f, phone:e.target.value}))} placeholder="+33 6 00 00 00 00" /></div>
                <div><label className="label">SIRET</label><input className="input" value={form.siret} onChange={e => setForm(f=>({...f, siret:e.target.value}))} placeholder="000 000 000 00000" /></div>
                <div><label className="label">N° TVA intracom.</label><input className="input" value={form.tva_number} onChange={e => setForm(f=>({...f, tva_number:e.target.value}))} placeholder="FR 00 000000000" /></div>
              </div>
              <div><label className="label">Adresse</label><textarea className="input resize-none h-16" value={form.address} onChange={e => setForm(f=>({...f, address:e.target.value}))} placeholder="Adresse complète…" /></div>
              <div><label className="label">Notes</label><textarea className="input resize-none h-14" value={form.notes} onChange={e => setForm(f=>({...f, notes:e.target.value}))} /></div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModal(null)} className="btn-secondary">Annuler</button>
                <button type="submit" disabled={saving} className="btn-primary">
                  {saving ? <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Check className="w-4 h-4" />}
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

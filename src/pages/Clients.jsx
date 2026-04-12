import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { notify } from '../lib/notify'
import { useAuth } from '../contexts/AuthContext'
import { clientSchema } from '../lib/schemas'
import { useFormValidation } from '../hooks/useFormValidation'
import FieldError from '../components/FieldError'
import {
  Plus,
  Search,
  Users,
  X,
  Check,
  Trash2,
  Building2,
  Mail,
  Phone,
  MapPin,
  FileText,
  ChevronDown,
  FolderOpen,
  Filter,
} from 'lucide-react'

// ─── Constantes ──────────────────────────────────────────────────────────────

const TYPES = [
  { value: 'production', label: 'Production', color: 'var(--blue)' },
  { value: 'agence', label: 'Agence', color: 'var(--purple, #8b5cf6)' },
  { value: 'marque', label: 'Marque', color: 'var(--amber)' },
  { value: 'institution', label: 'Institution', color: 'var(--green)' },
  { value: 'association', label: 'Association', color: 'var(--teal, #14b8a6)' },
  { value: 'particulier', label: 'Particulier', color: 'var(--txt-3)' },
]

const STATUTS = [
  { value: 'actif', label: 'Actif', color: 'var(--green)' },
  { value: 'prospect', label: 'Prospect', color: 'var(--amber)' },
  { value: 'inactif', label: 'Inactif', color: 'var(--txt-3)' },
]

const EMPTY = {
  nom_commercial: '',
  raison_sociale: '',
  type_client: 'production',
  statut: 'actif',
  contact_name: '',
  contact_fonction: '',
  email: '',
  email_facturation: '',
  phone: '',
  address: '',
  code_postal: '',
  ville: '',
  pays: 'France',
  siret: '',
  tva_number: '',
  notes: '',
}

function typeInfo(val) {
  return TYPES.find((t) => t.value === val) || TYPES[0]
}
function statutInfo(val) {
  return STATUTS.find((s) => s.value === val) || STATUTS[0]
}

// ─── Composant principal ─────────────────────────────────────────────────────

export default function Clients() {
  const { org } = useAuth()
  const [clients, setClients] = useState([])
  const [projectCounts, setProjectCounts] = useState({}) // client_id → nb projets
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('') // '' = tous
  const [filterStatut, setFilterStatut] = useState('actif') // par défaut on montre les actifs
  const [showFilters, setShowFilters] = useState(false)

  // Slide-over state
  const [panel, setPanel] = useState(null) // null | 'create' | client_obj
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState('identite')

  const { errors, validate, clearErrors, clearField } = useFormValidation(clientSchema)

  // ── Chargement ──────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const [clientsRes, projectsRes] = await Promise.all([
      supabase.from('clients').select('*').eq('org_id', org.id).order('nom_commercial'),
      supabase
        .from('projects')
        .select('client_id')
        .eq('org_id', org.id)
        .not('client_id', 'is', null),
    ])
    if (clientsRes.error) {
      console.error('[Clients] load:', clientsRes.error)
      notify.error('Impossible de charger les clients')
    }
    setClients(clientsRes.data || [])

    // Compter les projets par client
    const counts = {}
    for (const p of projectsRes.data || []) {
      counts[p.client_id] = (counts[p.client_id] || 0) + 1
    }
    setProjectCounts(counts)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    if (org?.id) load()
  }, [org?.id, load])

  // ── Filtrage ────────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return clients.filter((c) => {
      if (filterStatut && c.statut !== filterStatut) return false
      if (filterType && c.type_client !== filterType) return false
      if (q) {
        const haystack = [
          c.nom_commercial,
          c.raison_sociale,
          c.contact_name,
          c.email,
          c.ville,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [clients, search, filterType, filterStatut])

  // Stats rapides
  const stats = useMemo(() => ({
    total: clients.length,
    actifs: clients.filter((c) => c.statut === 'actif').length,
    prospects: clients.filter((c) => c.statut === 'prospect').length,
  }), [clients])

  // ── CRUD ────────────────────────────────────────────────────────────────────

  function openCreate() {
    setForm(EMPTY)
    setPanel('create')
    setActiveSection('identite')
    clearErrors()
  }

  function openEdit(c) {
    setForm({
      nom_commercial: c.nom_commercial || '',
      raison_sociale: c.raison_sociale || '',
      type_client: c.type_client || 'production',
      statut: c.statut || 'actif',
      contact_name: c.contact_name || '',
      contact_fonction: c.contact_fonction || '',
      email: c.email || '',
      email_facturation: c.email_facturation || '',
      phone: c.phone || '',
      address: c.address || '',
      code_postal: c.code_postal || '',
      ville: c.ville || '',
      pays: c.pays || 'France',
      siret: c.siret || '',
      tva_number: c.tva_number || '',
      notes: c.notes || '',
    })
    setPanel(c)
    setActiveSection('identite')
    clearErrors()
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    try {
      const validated = validate(form)
      if (!validated) { setSaving(false); return }
      if (!org?.id) throw new Error('Organisation introuvable')

      if (panel === 'create') {
        const { data, error } = await supabase
          .from('clients')
          .insert({ ...form, org_id: org.id })
          .select()
          .single()
        if (error) throw error
        if (data) setClients((p) => [...p, data].sort((a, b) => a.nom_commercial.localeCompare(b.nom_commercial)))
        notify.success('Client créé')
      } else {
        const { data, error } = await supabase
          .from('clients')
          .update(form)
          .eq('id', panel.id)
          .select()
          .single()
        if (error) throw error
        if (data) setClients((p) => p.map((c) => (c.id === data.id ? data : c)))
        notify.success('Client mis à jour')
      }
      setPanel(null)
    } catch (err) {
      notify.error('Erreur : ' + (err.message || JSON.stringify(err)))
    } finally {
      setSaving(false)
    }
  }

  async function del(id) {
    if (!confirm('Supprimer ce client ? Les projets associés ne seront pas supprimés.')) return
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) {
      console.error('[Clients] delete:', error)
      notify.error('Impossible de supprimer : ' + error.message)
      return
    }
    setClients((p) => p.filter((c) => c.id !== id))
    setPanel(null)
    notify.success('Client supprimé')
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // ── Rendu ───────────────────────────────────────────────────────────────────

  return (
    <div className="p-6" style={{ maxWidth: panel ? '100%' : '1100px', margin: '0 auto' }}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>Clients</h1>
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            {stats.total} clients · {stats.actifs} actifs · {stats.prospects} prospects
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" /> Nouveau client
        </button>
      </div>

      {/* Barre de recherche + filtres */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--txt-3)' }} />
          <input
            className="input pl-9 w-full"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par nom, contact, email, ville…"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`btn-secondary flex items-center gap-1.5 ${showFilters ? 'ring-2 ring-blue-200' : ''}`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filtres
          {(filterType || filterStatut !== 'actif') && (
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: 'var(--blue)' }}
            />
          )}
        </button>
      </div>

      {/* Filtres déroulants */}
      {showFilters && (
        <div
          className="flex items-center gap-3 mb-4 p-3 rounded-xl"
          style={{ background: 'var(--bg-sub)', border: '1px solid var(--brd)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>Statut</span>
            <select
              value={filterStatut}
              onChange={(e) => setFilterStatut(e.target.value)}
              className="input text-sm py-1"
            >
              <option value="">Tous</option>
              {STATUTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>Type</span>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="input text-sm py-1"
            >
              <option value="">Tous</option>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {(filterType || filterStatut !== 'actif') && (
            <button
              onClick={() => { setFilterType(''); setFilterStatut('actif') }}
              className="text-xs underline"
              style={{ color: 'var(--blue)' }}
            >
              Réinitialiser
            </button>
          )}
        </div>
      )}

      {/* Layout : liste + slide-over */}
      <div className="flex gap-0">
        {/* Liste */}
        <div className={`flex-1 transition-all duration-300 ${panel ? 'mr-5' : ''}`} style={{ minWidth: 0 }}>
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
          >
            {loading && (
              <div className="p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="p-12 text-center">
                <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
                <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
                  {search || filterType || filterStatut !== 'actif'
                    ? 'Aucun client ne correspond aux filtres'
                    : 'Aucun client pour le moment'}
                </p>
              </div>
            )}
            {filtered.map((c) => {
              const type = typeInfo(c.type_client)
              const statut = statutInfo(c.statut)
              const projCount = projectCounts[c.id] || 0
              const isActive = panel && panel !== 'create' && panel.id === c.id
              return (
                <div
                  key={c.id}
                  onClick={() => openEdit(c)}
                  className="flex items-center gap-4 px-5 py-3.5 cursor-pointer transition-colors"
                  style={{
                    borderBottom: '1px solid var(--brd-sub)',
                    background: isActive ? 'var(--bg-sub)' : 'transparent',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--bg-hover, var(--bg-sub))' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  {/* Avatar initiales */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: type.color + '18', color: type.color }}
                  >
                    {(c.nom_commercial || '?').slice(0, 2).toUpperCase()}
                  </div>

                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                        {c.nom_commercial}
                      </p>
                      {c.raison_sociale && c.raison_sociale !== c.nom_commercial && (
                        <span className="text-xs truncate hidden sm:inline" style={{ color: 'var(--txt-3)' }}>
                          ({c.raison_sociale})
                        </span>
                      )}
                    </div>
                    <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                      {[c.contact_name, c.ville, c.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-2 shrink-0">
                    {projCount > 0 && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: 'var(--bg-sub)', color: 'var(--txt-2)' }}
                      >
                        {projCount} projet{projCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{ background: type.color + '18', color: type.color }}
                    >
                      {type.label}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: statut.color }}
                      title={statut.label}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Slide-over */}
        {panel && (
          <div
            className="w-[480px] shrink-0 rounded-xl overflow-hidden flex flex-col"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              maxHeight: 'calc(100vh - 180px)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5 shrink-0"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
                {panel === 'create' ? 'Nouveau client' : 'Fiche client'}
              </h3>
              <div className="flex items-center gap-1">
                {panel !== 'create' && (
                  <button
                    onClick={() => del(panel.id)}
                    className="p-1.5 rounded-lg transition-colors hover:bg-red-50"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4" style={{ color: 'var(--red, #ef4444)' }} />
                  </button>
                )}
                <button
                  onClick={() => setPanel(null)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Navigation sections */}
            <div
              className="flex gap-0 px-5 shrink-0"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              {[
                { key: 'identite', label: 'Identité', icon: Building2 },
                { key: 'contact', label: 'Contact', icon: Mail },
                { key: 'legal', label: 'Légal', icon: FileText },
                { key: 'projets', label: 'Projets', icon: FolderOpen },
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setActiveSection(key)}
                  className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative"
                  style={{
                    color: activeSection === key ? 'var(--blue)' : 'var(--txt-3)',
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  {activeSection === key && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                      style={{ background: 'var(--blue)' }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Contenu scrollable */}
            <form onSubmit={save} className="flex-1 overflow-y-auto">
              <div className="p-5 space-y-4">

                {/* Section Identité */}
                {activeSection === 'identite' && (
                  <>
                    <div>
                      <label className="label">Nom commercial *</label>
                      <input
                        className="input"
                        value={form.nom_commercial}
                        onChange={(e) => { set('nom_commercial', e.target.value); clearField('nom_commercial') }}
                        placeholder="V and B Fest, TF1 Production…"
                      />
                      <FieldError error={errors.nom_commercial} />
                      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                        Le nom utilisé au quotidien dans l&apos;app
                      </p>
                    </div>
                    <div>
                      <label className="label">Raison sociale</label>
                      <input
                        className="input"
                        value={form.raison_sociale}
                        onChange={(e) => set('raison_sociale', e.target.value)}
                        placeholder="Association l'Opus Sonore, SAS TF1…"
                      />
                      <p className="text-xs mt-1" style={{ color: 'var(--txt-3)' }}>
                        Le nom légal affiché sur les devis et factures
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Type *</label>
                        <select
                          className="input"
                          value={form.type_client}
                          onChange={(e) => set('type_client', e.target.value)}
                        >
                          {TYPES.map((t) => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Statut *</label>
                        <select
                          className="input"
                          value={form.statut}
                          onChange={(e) => set('statut', e.target.value)}
                        >
                          {STATUTS.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label">Notes internes</label>
                      <textarea
                        className="input resize-none h-20"
                        value={form.notes}
                        onChange={(e) => set('notes', e.target.value)}
                        placeholder="Infos utiles sur ce client…"
                      />
                    </div>
                  </>
                )}

                {/* Section Contact */}
                {activeSection === 'contact' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Nom du contact</label>
                        <input
                          className="input"
                          value={form.contact_name}
                          onChange={(e) => set('contact_name', e.target.value)}
                          placeholder="Jean Dupont"
                        />
                      </div>
                      <div>
                        <label className="label">Fonction</label>
                        <input
                          className="input"
                          value={form.contact_fonction}
                          onChange={(e) => set('contact_fonction', e.target.value)}
                          placeholder="Directeur artistique"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Email</label>
                        <input
                          type="email"
                          className="input"
                          value={form.email}
                          onChange={(e) => { set('email', e.target.value); clearField('email') }}
                          placeholder="contact@client.fr"
                        />
                        <FieldError error={errors.email} />
                      </div>
                      <div>
                        <label className="label">Email facturation</label>
                        <input
                          type="email"
                          className="input"
                          value={form.email_facturation}
                          onChange={(e) => { set('email_facturation', e.target.value); clearField('email_facturation') }}
                          placeholder="compta@client.fr"
                        />
                        <FieldError error={errors.email_facturation} />
                      </div>
                    </div>
                    <div>
                      <label className="label">Téléphone</label>
                      <input
                        className="input"
                        value={form.phone}
                        onChange={(e) => { set('phone', e.target.value); clearField('phone') }}
                        placeholder="+33 1 00 00 00 00"
                      />
                      <FieldError error={errors.phone} />
                    </div>
                    <div>
                      <label className="label">Adresse</label>
                      <input
                        className="input"
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                        placeholder="12 rue de la Paix"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">Code postal</label>
                        <input
                          className="input"
                          value={form.code_postal}
                          onChange={(e) => set('code_postal', e.target.value)}
                          placeholder="75002"
                        />
                      </div>
                      <div>
                        <label className="label">Ville</label>
                        <input
                          className="input"
                          value={form.ville}
                          onChange={(e) => set('ville', e.target.value)}
                          placeholder="Paris"
                        />
                      </div>
                      <div>
                        <label className="label">Pays</label>
                        <input
                          className="input"
                          value={form.pays}
                          onChange={(e) => set('pays', e.target.value)}
                          placeholder="France"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Section Légal */}
                {activeSection === 'legal' && (
                  <>
                    <div>
                      <label className="label">SIRET</label>
                      <input
                        className="input"
                        value={form.siret}
                        onChange={(e) => { set('siret', e.target.value); clearField('siret') }}
                        placeholder="000 000 000 00000"
                      />
                      <FieldError error={errors.siret} />
                    </div>
                    <div>
                      <label className="label">N° TVA intracommunautaire</label>
                      <input
                        className="input"
                        value={form.tva_number}
                        onChange={(e) => set('tva_number', e.target.value)}
                        placeholder="FR 00 000000000"
                      />
                    </div>
                    {panel !== 'create' && (
                      <div
                        className="p-3 rounded-lg"
                        style={{ background: 'var(--bg-sub)', border: '1px solid var(--brd-sub)' }}
                      >
                        <p className="text-xs font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
                          Nom affiché sur les documents légaux
                        </p>
                        <p className="text-sm font-semibold" style={{ color: 'var(--txt)' }}>
                          {form.raison_sociale || form.nom_commercial || '—'}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--txt-3)' }}>
                          {form.raison_sociale
                            ? 'La raison sociale sera utilisée sur les devis et factures'
                            : 'Sans raison sociale, le nom commercial sera utilisé'}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {/* Section Projets liés */}
                {activeSection === 'projets' && (
                  <ClientProjects clientId={panel !== 'create' ? panel.id : null} />
                )}
              </div>

              {/* Footer : boutons save */}
              {activeSection !== 'projets' && (
                <div
                  className="flex justify-end gap-2 px-5 py-3 shrink-0"
                  style={{ borderTop: '1px solid var(--brd-sub)' }}
                >
                  <button type="button" onClick={() => setPanel(null)} className="btn-secondary">
                    Annuler
                  </button>
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    Enregistrer
                  </button>
                </div>
              )}
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sous-composant : projets liés à un client ──────────────────────────────

function ClientProjects({ clientId }) {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!clientId) {
      setProjects([])
      setLoading(false)
      return
    }
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, title, status, date_debut, date_fin')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      setProjects(data || [])
      setLoading(false)
    })()
  }, [clientId])

  const STATUS_COLOR = {
    prospect: 'var(--amber)',
    en_cours: 'var(--blue)',
    termine: 'var(--green)',
    archive: 'var(--txt-3)',
  }
  const STATUS_LABEL = {
    prospect: 'Prospect',
    en_cours: 'En cours',
    termine: 'Terminé',
    archive: 'Archivé',
  }

  if (!clientId) {
    return (
      <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
        Enregistrez le client pour voir ses projets
      </p>
    )
  }

  if (loading) {
    return <p className="text-sm" style={{ color: 'var(--txt-3)' }}>Chargement…</p>
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-6">
        <FolderOpen className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--txt-3)' }} />
        <p className="text-sm" style={{ color: 'var(--txt-3)' }}>Aucun projet lié</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium" style={{ color: 'var(--txt-2)' }}>
        {projects.length} projet{projects.length > 1 ? 's' : ''}
      </p>
      {projects.map((p) => (
        <a
          key={p.id}
          href={`/projets/${p.id}/projet`}
          className="flex items-center gap-3 p-3 rounded-lg transition-colors"
          style={{ background: 'var(--bg-sub)', border: '1px solid var(--brd-sub)' }}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: STATUS_COLOR[p.status] || 'var(--txt-3)' }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
              {p.title}
            </p>
            {p.date_debut && (
              <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
                {new Date(p.date_debut).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}
                {p.date_fin && ` → ${new Date(p.date_fin).toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })}`}
              </p>
            )}
          </div>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium shrink-0"
            style={{
              background: (STATUS_COLOR[p.status] || 'var(--txt-3)') + '18',
              color: STATUS_COLOR[p.status] || 'var(--txt-3)',
            }}
          >
            {STATUS_LABEL[p.status] || p.status}
          </span>
        </a>
      ))}
    </div>
  )
}

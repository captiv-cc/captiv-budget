/**
 * Page Crew — BDD globale des intervenants
 * Vues : Grille / Liste
 * Features : régime filter · search · sort · compteur projets · CRUD slide-over
 */
import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CATS } from '../lib/cotisations'
import TvaPicker from '../components/TvaPicker'
import { notify } from '../lib/notify'
import {
  Plus,
  Search,
  Trash2,
  X,
  Check,
  LayoutGrid,
  List as ListIcon,
  Users,
  Phone,
  Mail,
  Euro,
  Link2,
  Briefcase,
  Send,
  Copy,
  Loader2,
  User,
  CreditCard,
  Archive,
  ArchiveRestore,
  ChevronDown,
} from 'lucide-react'
import { contactSchema } from '../lib/schemas'
import { useFormValidation } from '../hooks/useFormValidation'
import FieldError from '../components/FieldError'

// ─── Constantes ───────────────────────────────────────────────────────────────

const VIEW_KEY = 'captiv:crew-view'

const SORT_OPTIONS = [
  { value: 'az', label: 'A → Z' },
  { value: 'za', label: 'Z → A' },
  { value: 'regime', label: 'Régime' },
  { value: 'tarif', label: 'Tarif/j' },
  { value: 'projets', label: 'Projets' },
]

const EMPTY = {
  nom: '',
  prenom: '',
  date_naissance: '',
  email: '',
  telephone: '',
  address: '',
  code_postal: '',
  ville: '',
  pays: 'France',
  regime: 'Externe',
  specialite: '',
  taille_tshirt: '',
  regime_alimentaire: '',
  permis: false,
  vehicule: false,
  tarif_jour_ref: '',
  iban: '',
  siret: '',
  notes: '',
  actif: true,
  default_tva: 0,
  user_id: null,
}

const TAILLES_TSHIRT = ['XS', 'S', 'M', 'L', 'XL', 'XXL']
const REGIMES_ALIMENTAIRES = [
  'Omnivore',
  'Végétarien',
  'Végan',
  'Sans gluten',
  'Sans porc',
  'Halal',
  'Casher',
  'Autre',
]

// eslint-disable-next-line react-refresh/only-export-components
export const REGIME_COLORS = {
  'Intermittent Technicien': { bg: 'rgba(156,95,253,.12)', fg: 'var(--purple)' },
  'Intermittent Artiste': { bg: 'rgba(255,92,196,.12)', fg: '#ff5ac4' },
  Interne: { bg: 'rgba(100,116,139,.12)', fg: 'var(--txt-2)' },
  Externe: { bg: 'rgba(255,159,10,.12)', fg: 'var(--amber)' },
  Technique: { bg: 'var(--blue-bg)', fg: 'var(--blue)' },
  Frais: { bg: 'rgba(100,116,139,.08)', fg: 'var(--txt-3)' },
}

function RegimeBadge({ regime }) {
  const c = REGIME_COLORS[regime] || { bg: 'var(--bg-elev)', fg: 'var(--txt-3)' }
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.fg }}
    >
      {regime}
    </span>
  )
}

function Avatar({ nom, prenom, regime, size = 9 }) {
  const c = REGIME_COLORS[regime] || { bg: 'var(--bg-elev)', fg: 'var(--txt-3)' }
  const initials = ((prenom?.[0] || '') + (nom?.[0] || '')).toUpperCase() || '?'
  return (
    <div
      className={`w-${size} h-${size} rounded-full flex items-center justify-center text-xs font-bold shrink-0`}
      style={{ background: c.bg, color: c.fg }}
    >
      {initials}
    </div>
  )
}

// ─── Chip de filtre (même style que Projets/Clients) ────────────────────────

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

// ─── Page principale ─────────────────────────────────────────────────────────

export default function Contacts() {
  const { org } = useAuth()
  const [contacts, setContacts] = useState([])
  const [projCounts, setProjCounts] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('tous')
  const [sortBy, setSortBy] = useState('az')
  const [viewMode, setViewMode] = useState(() => {
    if (typeof window === 'undefined') return 'grid'
    return window.localStorage.getItem(VIEW_KEY) || 'list'
  })

  const [archivedExpanded, setArchivedExpanded] = useState(false)

  // Slide-over state
  const [panel, setPanel] = useState(null) // null | 'create' | contact_obj
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState('identite')

  // Liaison compte
  const [profiles, setProfiles] = useState([])
  const [pendingInvites, setPendingInvites] = useState({})

  const { errors, validate, clearErrors, clearField } = useFormValidation(contactSchema)

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_KEY, viewMode)
    } catch {
      // Ignore localStorage errors
    }
  }, [viewMode])

  // ── Chargement ────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const [ctsRes, pmRes, profsRes, invsRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('org_id', org.id).order('nom'),
      supabase
        .from('projet_membres')
        .select('contact_id, project_id')
        .not('contact_id', 'is', null),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('org_id', org.id)
        .order('full_name'),
      supabase
        .from('invitations_log')
        .select('id, contact_id, email, mode, invited_at, last_resent_at, resend_count')
        .eq('org_id', org.id)
        .is('accepted_at', null)
        .order('invited_at', { ascending: false }),
    ])
    if (ctsRes.error) console.error('[Crew] load contacts:', ctsRes.error)
    if (pmRes.error) console.error('[Crew] load membres:', pmRes.error)
    setContacts(ctsRes.data || [])
    setProfiles(profsRes.data || [])

    const invMap = {}
    for (const inv of invsRes.data || []) {
      if (inv.contact_id && !invMap[inv.contact_id]) invMap[inv.contact_id] = inv
    }
    setPendingInvites(invMap)

    const counts = {}
    for (const row of pmRes.data || []) {
      counts[row.contact_id] = counts[row.contact_id] || new Set()
      counts[row.contact_id].add(row.project_id)
    }
    const final = {}
    for (const [id, set] of Object.entries(counts)) final[id] = set.size
    setProjCounts(final)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    if (org?.id) load()
  }, [org?.id, load])

  // ── Filtrage + tri + compteurs (useMemo) ──────────────────────────────────

  const { filtered, archivedList, regimeCounts } = useMemo(() => {
    const q = search.toLowerCase()
    const matchSearch = (c) => {
      if (!q) return true
      const haystack = [c.nom, c.prenom, c.email, c.specialite, c.telephone, c.ville]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    }

    const cmp = (a, b) => {
      switch (sortBy) {
        case 'za':
          return `${b.nom}${b.prenom}`.localeCompare(`${a.nom}${a.prenom}`, 'fr')
        case 'regime':
          return (a.regime || '').localeCompare(b.regime || '', 'fr')
        case 'tarif':
          return (Number(b.tarif_jour_ref) || 0) - (Number(a.tarif_jour_ref) || 0)
        case 'projets':
          return (projCounts[b.id] || 0) - (projCounts[a.id] || 0)
        case 'az':
        default:
          return `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`, 'fr')
      }
    }

    const rCounts = { tous: 0 }
    for (const cat of CATS) rCounts[cat] = 0

    const active = []
    const archived = []

    for (const c of contacts) {
      if (c.actif === false) {
        if (matchSearch(c)) archived.push(c)
        continue
      }
      rCounts.tous++
      if (rCounts[c.regime] !== undefined) rCounts[c.regime]++

      if (filter !== 'tous' && c.regime !== filter) continue
      if (matchSearch(c)) active.push(c)
    }

    active.sort(cmp)
    archived.sort((a, b) => `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`, 'fr'))

    return { filtered: active, archivedList: archived, regimeCounts: rCounts }
  }, [contacts, search, filter, sortBy, projCounts])

  // ── CRUD ──────────────────────────────────────────────────────────────────

  function openCreate() {
    setForm(EMPTY)
    setPanel('create')
    setActiveSection('identite')
    clearErrors()
  }

  function openEdit(c) {
    setForm({
      nom: c.nom || '',
      prenom: c.prenom || '',
      date_naissance: c.date_naissance || '',
      email: c.email || '',
      telephone: c.telephone || '',
      address: c.address || '',
      code_postal: c.code_postal || '',
      ville: c.ville || '',
      pays: c.pays || 'France',
      regime: c.regime || 'Externe',
      specialite: c.specialite || '',
      taille_tshirt: c.taille_tshirt || '',
      regime_alimentaire: c.regime_alimentaire || '',
      permis: c.permis ?? false,
      vehicule: c.vehicule ?? false,
      tarif_jour_ref: c.tarif_jour_ref || '',
      iban: c.iban || '',
      siret: c.siret || '',
      notes: c.notes || '',
      actif: c.actif ?? true,
      default_tva: c.default_tva ?? 0,
      user_id: c.user_id || null,
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
      const payload = {
        ...form,
        tarif_jour_ref: form.tarif_jour_ref ? Number(form.tarif_jour_ref) : null,
        default_tva: Number(form.default_tva ?? 0),
        user_id: form.user_id || null,
      }
      if (panel === 'create') {
        const { data, error } = await supabase
          .from('contacts')
          .insert({ ...payload, org_id: org.id })
          .select()
          .single()
        if (error) throw error
        setContacts((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
        notify.success('Contact créé')
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .update(payload)
          .eq('id', panel.id)
          .select()
          .single()
        if (error) throw error
        setContacts((p) => p.map((c) => (c.id === data.id ? data : c)))
        notify.success('Contact mis à jour')
      }
      setPanel(null)
    } catch (err) {
      notify.error('Erreur : ' + (err.message || JSON.stringify(err)))
    } finally {
      setSaving(false)
    }
  }

  async function del(id) {
    if (!confirm('Archiver ce contact ?')) return
    const { error } = await supabase.from('contacts').update({ actif: false }).eq('id', id)
    if (error) {
      console.error('[Crew] archive:', error)
      notify.error('Impossible d\'archiver le contact : ' + error.message)
      return
    }
    setContacts((p) => p.filter((c) => c.id !== id))
    setPanel(null)
    notify.success('Contact archivé')
  }

  async function hardDelete(id) {
    if (!confirm('Supprimer définitivement ce contact ? Cette action est irréversible.')) return
    const { error } = await supabase.from('contacts').delete().eq('id', id)
    if (error) {
      console.error('[Crew] delete:', error)
      notify.error('Impossible de supprimer : ' + error.message)
      return
    }
    setContacts((p) => p.filter((c) => c.id !== id))
    setPanel(null)
    notify.success('Contact supprimé')
  }

  async function unarchive(id) {
    if (!confirm('Restaurer ce contact ?')) return
    const { error } = await supabase.from('contacts').update({ actif: true }).eq('id', id)
    if (error) {
      console.error('[Crew] unarchive:', error)
      notify.error('Impossible de restaurer : ' + error.message)
      return
    }
    setContacts((p) => p.map((c) => (c.id === id ? { ...c, actif: true } : c)))
    notify.success('Contact restauré')
  }

  // Auto-expand quand une recherche matche des archivés
  const showArchived = archivedExpanded || (search.trim() !== '' && archivedList.length > 0)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // ── Rendu ─────────────────────────────────────────────────────────────────

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>Crew</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {regimeCounts.tous} personne{regimeCounts.tous > 1 ? 's' : ''} dans la base
          </p>
        </div>
        <button onClick={openCreate} className="btn-primary">
          <Plus className="w-4 h-4" /> <span className="hidden sm:inline">Nouveau contact</span>
        </button>
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
          placeholder="Rechercher par nom, spécialité, email, téléphone…"
        />
      </div>

      {/* Toolbar : chips filtre + tri + toggle vue */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <FilterChip
            label="Tous"
            count={regimeCounts.tous}
            active={filter === 'tous'}
            onClick={() => setFilter('tous')}
          />
          {CATS.filter((r) => regimeCounts[r] > 0).map((r) => (
            <FilterChip
              key={r}
              label={r}
              count={regimeCounts[r] || 0}
              active={filter === r}
              onClick={() => setFilter(filter === r ? 'tous' : r)}
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
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          {/* Toggle vue */}
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

      {/* Contenu */}
      {loading && (
        <div className="card p-8 text-center text-sm" style={{ color: 'var(--txt-3)' }}>
          Chargement…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card p-12 text-center">
          <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
          <p className="text-sm" style={{ color: 'var(--txt-2)' }}>
            {search || filter !== 'tous' ? 'Aucun résultat' : 'Aucun contact dans la base'}
          </p>
          {!search && filter === 'tous' && (
            <button
              onClick={openCreate}
              className="mt-3 text-sm font-medium"
              style={{ color: 'var(--blue)' }}
            >
              + Ajouter le premier contact
            </button>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              projCount={projCounts[c.id] || 0}
              pendingInvite={pendingInvites[c.id]}
              onClick={() => openEdit(c)}
            />
          ))}
        </div>
      )}

      {!loading && filtered.length > 0 && viewMode === 'list' && (
        <CrewListView
          contacts={filtered}
          projCounts={projCounts}
          pendingInvites={pendingInvites}
          onEdit={openEdit}
        />
      )}

      {/* ── Section archivés ────────────────────────────────────────────────── */}
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
            <span>Contacts archivés ({archivedList.length})</span>
          </button>

          {showArchived && (
            <div className="mt-3">
              {archivedList.length === 0 && (
                <p className="text-xs px-1" style={{ color: 'var(--txt-3)' }}>
                  Aucun contact archivé.
                </p>
              )}
              {archivedList.length > 0 && (
                <div className="card" style={{ overflow: 'hidden', opacity: 0.75 }}>
                  {archivedList.map((c, i) => (
                    <div
                      key={c.id}
                      className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-3.5 transition-colors"
                      style={{ borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Avatar nom={c.nom} prenom={c.prenom} regime={c.regime} size={8} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
                          {c.prenom} {c.nom}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
                          {[c.specialite, c.ville, c.email].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </div>
                      <span className="hidden sm:inline"><RegimeBadge regime={c.regime} /></span>
                      <button
                        onClick={() => unarchive(c.id)}
                        className="btn-ghost btn-sm flex items-center gap-1 text-xs shrink-0"
                        style={{ color: 'var(--txt-3)' }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                        title="Restaurer"
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Slide-over ──────────────────────────────────────────────────────── */}
      {panel && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            style={{ background: 'rgba(0,0,0,0.3)' }}
            onClick={() => setPanel(null)}
          />

          {/* Panneau */}
          <div
            className="fixed top-0 right-0 h-full z-50 flex flex-col"
            style={{
              width: '500px',
              maxWidth: '90vw',
              background: 'var(--bg-surf)',
              borderLeft: '1px solid var(--brd)',
              boxShadow: '-8px 0 30px rgba(0,0,0,0.15)',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <div className="flex items-center gap-3">
                {panel !== 'create' && (
                  <Avatar nom={form.nom} prenom={form.prenom} regime={form.regime} />
                )}
                <h3 className="font-semibold" style={{ color: 'var(--txt)' }}>
                  {panel === 'create' ? 'Nouveau contact' : `${form.prenom} ${form.nom}`}
                </h3>
              </div>
              <div className="flex items-center gap-1">
                {panel !== 'create' && (
                  <>
                    <button
                      onClick={() => del(panel.id)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--txt-2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                      title="Archiver"
                    >
                      <Archive className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => hardDelete(panel.id)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--txt-3)' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red, #ef4444)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                      title="Supprimer définitivement"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
                <button
                  onClick={() => setPanel(null)}
                  className="p-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--txt-3)' }}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Onglets */}
            <div
              className="flex gap-0 px-4 sm:px-6 shrink-0 overflow-x-auto"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              {[
                { key: 'identite', label: 'Identité', icon: User },
                { key: 'contact', label: 'Contact', icon: Mail },
                { key: 'finance', label: 'Finance', icon: CreditCard },
                { key: 'compte', label: 'Compte', icon: Link2 },
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
              <div className="p-4 sm:p-6 space-y-4">

                {/* Section Identité */}
                {activeSection === 'identite' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Prénom</label>
                        <input
                          className="input"
                          value={form.prenom}
                          onChange={(e) => set('prenom', e.target.value)}
                          placeholder="Prénom"
                        />
                      </div>
                      <div>
                        <label className="label">Nom *</label>
                        <input
                          className="input"
                          value={form.nom}
                          onChange={(e) => { set('nom', e.target.value); clearField('nom') }}
                          placeholder="Nom de famille"
                        />
                        <FieldError error={errors.nom} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Date de naissance</label>
                        <input
                          type="date"
                          className="input"
                          value={form.date_naissance}
                          onChange={(e) => set('date_naissance', e.target.value)}
                        />
                      </div>
                      <div>
                        <label className="label">Spécialité / Poste</label>
                        <input
                          className="input"
                          value={form.specialite}
                          onChange={(e) => set('specialite', e.target.value)}
                          placeholder="Chef opérateur, Monteur…"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="label">Régime *</label>
                      <select
                        className="input"
                        value={form.regime}
                        onChange={(e) => set('regime', e.target.value)}
                      >
                        {CATS.map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>

                    {/* Logistique */}
                    <div
                      className="pt-3 mt-1"
                      style={{ borderTop: '1px solid var(--brd-sub)' }}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--txt-3)' }}>
                        Logistique
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label">Taille t-shirt</label>
                          <select
                            className="input"
                            value={form.taille_tshirt}
                            onChange={(e) => set('taille_tshirt', e.target.value)}
                          >
                            <option value="">—</option>
                            {TAILLES_TSHIRT.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">Régime alimentaire</label>
                          <select
                            className="input"
                            value={form.regime_alimentaire}
                            onChange={(e) => set('regime_alimentaire', e.target.value)}
                          >
                            <option value="">—</option>
                            {REGIMES_ALIMENTAIRES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        <label
                          className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg"
                          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                        >
                          <input
                            type="checkbox"
                            checked={form.permis}
                            onChange={(e) => set('permis', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs" style={{ color: 'var(--txt-2)' }}>Permis de conduire</span>
                        </label>
                        <label
                          className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg"
                          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
                        >
                          <input
                            type="checkbox"
                            checked={form.vehicule}
                            onChange={(e) => set('vehicule', e.target.checked)}
                            className="rounded"
                          />
                          <span className="text-xs" style={{ color: 'var(--txt-2)' }}>Véhicule personnel</span>
                        </label>
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="label">Notes internes</label>
                      <textarea
                        className="input resize-none h-20"
                        value={form.notes}
                        onChange={(e) => set('notes', e.target.value)}
                        placeholder="Disponibilités, infos utiles…"
                      />
                    </div>
                  </>
                )}

                {/* Section Contact */}
                {activeSection === 'contact' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Email</label>
                        <input
                          type="email"
                          className="input"
                          value={form.email}
                          onChange={(e) => { set('email', e.target.value); clearField('email') }}
                          placeholder="email@exemple.fr"
                        />
                        <FieldError error={errors.email} />
                      </div>
                      <div>
                        <label className="label">Téléphone</label>
                        <input
                          className="input"
                          value={form.telephone}
                          onChange={(e) => { set('telephone', e.target.value); clearField('telephone') }}
                          placeholder="+33 6 00 00 00 00"
                        />
                        <FieldError error={errors.telephone} />
                      </div>
                    </div>
                    <div>
                      <label className="label">Adresse</label>
                      <input
                        className="input"
                        value={form.address}
                        onChange={(e) => set('address', e.target.value)}
                        placeholder="Numéro et rue"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">Code postal</label>
                        <input
                          className="input"
                          value={form.code_postal}
                          onChange={(e) => set('code_postal', e.target.value)}
                          placeholder="00000"
                        />
                      </div>
                      <div>
                        <label className="label">Ville</label>
                        <input
                          className="input"
                          value={form.ville}
                          onChange={(e) => set('ville', e.target.value)}
                          placeholder="Ville"
                        />
                      </div>
                      <div>
                        <label className="label">Pays</label>
                        <input
                          className="input"
                          value={form.pays}
                          onChange={(e) => set('pays', e.target.value)}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Section Finance */}
                {activeSection === 'finance' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Tarif jour HT (€)</label>
                        <input
                          type="number"
                          className="input"
                          value={form.tarif_jour_ref}
                          onChange={(e) => { set('tarif_jour_ref', e.target.value); clearField('tarif_jour_ref') }}
                          placeholder="350"
                          min={0}
                          step={5}
                        />
                        <FieldError error={errors.tarif_jour_ref} />
                      </div>
                      <div>
                        <label className="label">SIRET</label>
                        <input
                          className="input"
                          value={form.siret}
                          onChange={(e) => { set('siret', e.target.value); clearField('siret') }}
                          placeholder="14 chiffres"
                        />
                        <FieldError error={errors.siret} />
                      </div>
                    </div>
                    <TvaPicker
                      value={form.default_tva}
                      onChange={(v) => set('default_tva', v)}
                      label="TVA par défaut · 0% pour un cachet/intermittent, 20% pour un libéral"
                    />
                    <div>
                      <label className="label">IBAN</label>
                      <input
                        className="input"
                        value={form.iban}
                        onChange={(e) => set('iban', e.target.value)}
                        placeholder="FR76 0000 0000 0000 0000 0000 000"
                      />
                    </div>
                  </>
                )}

                {/* Section Compte lié */}
                {activeSection === 'compte' && (
                  <CompteSection
                    form={form}
                    set={set}
                    panel={panel}
                    profiles={profiles}
                    contacts={contacts}
                    pendingInvite={typeof panel === 'object' ? pendingInvites[panel.id] : null}
                    onInvited={load}
                  />
                )}

              </div>

              {/* Footer : boutons save */}
              {(
                <div
                  className="flex justify-end gap-2 px-4 sm:px-6 py-4 shrink-0"
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
        </>
      )}
    </div>
  )
}

// ─── Carte contact (vue grille) ──────────────────────────────────────────────

function ContactCard({ contact: c, projCount, pendingInvite, onClick }) {
  return (
    <div
      onClick={onClick}
      className="card p-4 cursor-pointer transition-all group"
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--brd)'
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = ''
        e.currentTarget.style.transform = ''
      }}
    >
      {/* Avatar + identité */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar nom={c.nom} prenom={c.prenom} regime={c.regime} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
            {c.prenom} {c.nom}
          </p>
          {c.specialite && (
            <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              {c.specialite}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <RegimeBadge regime={c.regime} />
        {c.user_id && !pendingInvite && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap inline-flex items-center gap-1"
            style={{ background: 'rgba(0,200,117,.12)', color: 'var(--green)' }}
          >
            <Link2 className="w-2.5 h-2.5" />
            Compte actif
          </span>
        )}
        {c.user_id && pendingInvite && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap inline-flex items-center gap-1"
            style={{ background: 'rgba(255,159,10,.12)', color: 'var(--orange)' }}
          >
            <Send className="w-2.5 h-2.5" />
            En attente
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {c.email && (
          <p className="flex items-center gap-1.5 text-xs truncate" style={{ color: 'var(--txt-3)' }}>
            <Mail className="w-3 h-3 shrink-0" />
            {c.email}
          </p>
        )}
        {c.telephone && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-3)' }}>
            <Phone className="w-3 h-3 shrink-0" />
            {c.telephone}
          </p>
        )}
        {c.tarif_jour_ref && (
          <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-3)' }}>
            <Euro className="w-3 h-3 shrink-0" />
            {Number(c.tarif_jour_ref).toLocaleString('fr-FR')} € / jour
          </p>
        )}
      </div>

      {projCount > 0 && (
        <div
          className="mt-3 pt-2 flex items-center gap-1.5 text-[11px]"
          style={{ borderTop: '1px solid var(--brd-sub)', color: 'var(--txt-3)' }}
        >
          <Briefcase className="w-3 h-3" />
          {projCount} projet{projCount > 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}

// ─── Vue liste ───────────────────────────────────────────────────────────────

function CrewListView({ contacts, projCounts, pendingInvites, onEdit }) {
  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {contacts.map((c, i) => (
        <div
          key={c.id}
          onClick={() => onEdit(c)}
          className="flex items-center gap-3 sm:gap-4 px-3 sm:px-5 py-3 sm:py-3.5 cursor-pointer transition-colors"
          style={{ borderTop: i === 0 ? 'none' : '1px solid var(--brd-sub)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hov)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <Avatar nom={c.nom} prenom={c.prenom} regime={c.regime} size={8} />

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--txt)' }}>
              {c.prenom} {c.nom}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--txt-3)' }}>
              {[c.specialite, c.ville, c.email].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {c.tarif_jour_ref && (
              <span className="text-xs font-medium hidden md:inline" style={{ color: 'var(--txt-2)' }}>
                {Number(c.tarif_jour_ref).toLocaleString('fr-FR')} €/j
              </span>
            )}
            {(projCounts[c.id] || 0) > 0 && (
              <span
                className="text-xs px-2 py-0.5 rounded-full font-medium hidden sm:inline"
                style={{ background: 'var(--bg-sub)', color: 'var(--txt-2)' }}
              >
                {projCounts[c.id]} proj.
              </span>
            )}
            <RegimeBadge regime={c.regime} />
            {c.user_id && !pendingInvites[c.id] && (
              <span
                className="w-5 h-5 rounded-full hidden sm:flex items-center justify-center shrink-0"
                style={{ background: 'rgba(0,200,117,.12)', color: 'var(--green)' }}
                title="Compte actif"
              >
                <Link2 className="w-3 h-3" />
              </span>
            )}
            {c.user_id && pendingInvites[c.id] && (
              <span
                className="w-5 h-5 rounded-full hidden sm:flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,159,10,.12)', color: 'var(--orange)' }}
                title="Invitation en attente"
              >
                <Send className="w-3 h-3" />
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Section Compte lié (dans le slide-over) ─────────────────────────────────

function CompteSection({ form, set, panel, profiles, contacts, pendingInvite, onInvited }) {
  const isCreate = panel === 'create'
  const contactId = typeof panel === 'object' ? panel.id : null

  const linkedUserIds = contacts
    .filter((c) => c.user_id && (isCreate || c.id !== panel?.id))
    .map((c) => c.user_id)

  const availableProfiles = profiles.filter(
    (p) => !linkedUserIds.includes(p.id) || p.id === form.user_id,
  )

  const [inviting, setInviting] = useState(null)
  const [inviteLink, setInviteLink] = useState(null)
  const [inviteRole, setInviteRole] = useState('prestataire')

  async function sendInvite(mode, resend = false) {
    if (!contactId) return
    if (!form.email) {
      notify.error("L'email du contact est requis pour l'invitation.")
      return
    }
    setInviting(mode)
    setInviteLink(null)
    try {
      const fullName = [form.prenom, form.nom].filter(Boolean).join(' ').trim()
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: {
          contact_id: contactId,
          email: form.email,
          full_name: fullName,
          role: inviteRole,
          mode,
          resend,
        },
      })
      if (error) {
        let detailed = error.message || 'Erreur inconnue'
        try {
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json()
            if (body?.error) detailed = body.error
          } else if (error.context && typeof error.context.text === 'function') {
            const txt = await error.context.text()
            if (txt) detailed = txt
          }
        } catch {
          /* ignore */
        }
        throw new Error(detailed)
      }
      if (data?.error) throw new Error(data.error)

      if (data?.user_id) set('user_id', data.user_id)
      if (mode === 'email') {
        notify.success(resend ? 'Invitation relancée par email !' : 'Invitation envoyée par email !')
        onInvited?.()
      } else {
        setInviteLink(data?.action_link || null)
        if (data?.action_link) {
          try {
            await navigator.clipboard.writeText(data.action_link)
            notify.success('Lien copié dans le presse-papier')
          } catch {
            notify.success('Lien généré')
          }
        }
        onInvited?.()
      }
    } catch (err) {
      notify.error('Invitation échouée : ' + (err.message || JSON.stringify(err)))
    } finally {
      setInviting(null)
    }
  }

  async function copyLink() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      notify.success('Lien copié')
    } catch {
      notify.error('Impossible de copier')
    }
  }

  return (
    <>
      {/* Lier à un compte existant */}
      <div>
        <label className="label">
          <Link2 className="w-3 h-3 inline-block mr-1 -mt-0.5" />
          Compte utilisateur lié
        </label>
        <select
          className="input"
          value={form.user_id || ''}
          onChange={(e) => set('user_id', e.target.value || null)}
        >
          <option value="">— Aucun compte lié —</option>
          {availableProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name || '(sans nom)'} · {p.role}
            </option>
          ))}
        </select>
        <p className="text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
          Lier ce contact à un compte permet d&apos;afficher ses infos crew dans les onglets équipe et accès projet.
        </p>
      </div>

      {/* Invitation (nouvelle) */}
      {!isCreate && !form.user_id && (
        <div
          className="p-3 rounded-lg space-y-3"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--brd-sub)' }}
        >
          <div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--txt)' }}>
              Inviter cette personne à créer un compte
            </p>
            <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
              Envoie un email d&apos;invitation ou génère un lien à partager.
            </p>
          </div>

          <div>
            <label className="label">Rôle du compte créé</label>
            <select
              className="input"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              disabled={Boolean(inviting)}
            >
              <option value="prestataire">Prestataire</option>
              <option value="coordinateur">Coordinateur</option>
              <option value="charge_prod">Chargé de prod</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => sendInvite('email')}
              disabled={Boolean(inviting) || !form.email}
              className="btn-primary flex-1 justify-center text-xs py-2"
            >
              {inviting === 'email' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Envoyer email
            </button>
            <button
              type="button"
              onClick={() => sendInvite('link')}
              disabled={Boolean(inviting) || !form.email}
              className="btn-secondary flex-1 justify-center text-xs py-2"
            >
              {inviting === 'link' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
              Générer un lien
            </button>
          </div>

          {inviteLink && (
            <InviteLinkDisplay link={inviteLink} onCopy={copyLink} />
          )}
        </div>
      )}

      {/* Invitation en attente */}
      {!isCreate && form.user_id && pendingInvite && (
        <div
          className="p-3 rounded-lg space-y-3"
          style={{
            background: 'rgba(255,159,10,.08)',
            border: '1px solid rgba(255,159,10,.3)',
          }}
        >
          <div className="flex items-start gap-2">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: 'rgba(255,159,10,.15)' }}
            >
              <Send className="w-3 h-3" style={{ color: 'var(--orange)' }} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold" style={{ color: 'var(--txt)' }}>
                Invitation en attente
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--txt-3)' }}>
                Envoyée le{' '}
                {new Date(pendingInvite.invited_at).toLocaleDateString('fr-FR', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {pendingInvite.last_resent_at && (
                  <>
                    {' '}· Dernière relance le{' '}
                    {new Date(pendingInvite.last_resent_at).toLocaleDateString('fr-FR')}
                  </>
                )}
                {pendingInvite.resend_count > 0 && (
                  <>
                    {' '}· {pendingInvite.resend_count} relance
                    {pendingInvite.resend_count > 1 ? 's' : ''}
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => sendInvite('email', true)}
              disabled={Boolean(inviting) || !form.email}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-50"
              style={{ background: 'var(--orange)', color: 'white' }}
            >
              {inviting === 'email' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
              Renvoyer email
            </button>
            <button
              type="button"
              onClick={() => sendInvite('link', true)}
              disabled={Boolean(inviting) || !form.email}
              className="btn-secondary flex-1 justify-center text-xs py-2"
            >
              {inviting === 'link' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Link2 className="w-3.5 h-3.5" />
              )}
              Regénérer lien
            </button>
          </div>

          {inviteLink && (
            <InviteLinkDisplay link={inviteLink} onCopy={copyLink} />
          )}
        </div>
      )}
    </>
  )
}

// ─── Petit composant : affichage du lien d'invitation ────────────────────────

function InviteLinkDisplay({ link, onCopy }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium" style={{ color: 'var(--green)' }}>
        ✓ Lien d&apos;invitation généré — copié dans le presse-papier
      </p>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={link}
          onClick={(e) => e.target.select()}
          className="input text-[10px] font-mono flex-1"
        />
        <button
          type="button"
          onClick={onCopy}
          className="btn-secondary px-2"
          title="Copier à nouveau"
        >
          <Copy className="w-3 h-3" />
        </button>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
        Colle ce lien dans un message WhatsApp/SMS/email. Il expire selon la configuration Supabase (24h par défaut).
      </p>
    </div>
  )
}

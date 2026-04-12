/**
 * Page Contacts — BDD globale des intervenants
 * Vues : Grille / Liste tableau
 * Features : régime filter · search · sort · compteur projets · CRUD
 */
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { CATS } from '../lib/cotisations'
import TvaPicker from '../components/TvaPicker'
import { notify } from '../lib/notify'
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  X,
  Check,
  LayoutGrid,
  List,
  Users,
  Phone,
  Mail,
  Euro,
  ChevronUp,
  ChevronDown,
  Minus,
  Link2,
  Briefcase,
  Send,
  Copy,
  Loader2,
} from 'lucide-react'
import { contactSchema } from '../lib/schemas'
import { useFormValidation } from '../hooks/useFormValidation'
import FieldError from '../components/FieldError'

// ─── Constantes ───────────────────────────────────────────────────────────────
const EMPTY = {
  nom: '',
  prenom: '',
  email: '',
  telephone: '',
  regime: 'Externe',
  specialite: '',
  tarif_jour_ref: '',
  iban: '',
  siret: '',
  notes: '',
  actif: true,
  default_tva: 0,
  user_id: null, // ch4C : lien vers profiles.id (compte app)
}

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

// ─── Page principale ─────────────────────────────────────────────────────────
export default function Contacts() {
  const { org } = useAuth()
  const [contacts, setContacts] = useState([])
  const [projCounts, setProjCounts] = useState({}) // { contact_id: count }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('tous')
  const [view, setView] = useState('grid') // 'grid' | 'list'
  const [sort, setSort] = useState({ col: 'nom', dir: 'asc' })
  const [modal, setModal] = useState(null) // null | 'create' | contact_obj
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  // ch4C : liste des profils de l'org (pour le dropdown "Lier à un compte")
  const [profiles, setProfiles] = useState([])
  // ch4C.2 : invitations en attente (contact_id → row invitations_log)
  const [pendingInvites, setPendingInvites] = useState({})

  const { errors, validate, clearErrors, clearField } = useFormValidation(contactSchema)

  const load = useCallback(async () => {
    if (!org?.id) return
    setLoading(true)
    const [ctsRes, pmRes, profsRes, invsRes] = await Promise.all([
      supabase.from('contacts').select('*').eq('org_id', org.id).eq('actif', true).order('nom'),
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
    if (ctsRes.error) console.error('[Contacts] load contacts:', ctsRes.error)
    if (pmRes.error) console.error('[Contacts] load membres:', pmRes.error)
    setContacts(ctsRes.data || [])
    setProfiles(profsRes.data || [])
    // Garder la plus récente par contact
    const invMap = {}
    for (const inv of invsRes.data || []) {
      if (inv.contact_id && !invMap[inv.contact_id]) invMap[inv.contact_id] = inv
    }
    setPendingInvites(invMap)
    // Compter le nb de projets distincts par contact
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
    load()
  }, [load])

  // ── Modal helpers ─────────────────────────────────────────────────────────
  function openCreate() {
    setForm(EMPTY)
    setModal('create')
    clearErrors()
  }
  function openEdit(c) {
    setForm({
      nom: c.nom || '',
      prenom: c.prenom || '',
      email: c.email || '',
      telephone: c.telephone || '',
      regime: c.regime || 'Externe',
      specialite: c.specialite || '',
      tarif_jour_ref: c.tarif_jour_ref || '',
      iban: c.iban || '',
      siret: c.siret || '',
      notes: c.notes || '',
      actif: c.actif ?? true,
      default_tva: c.default_tva ?? 0,
      user_id: c.user_id || null,
    })
    setModal(c)
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
        user_id: form.user_id || null, // empty string → null
      }
      if (modal === 'create') {
        const { data, error } = await supabase
          .from('contacts')
          .insert({ ...payload, org_id: org.id })
          .select()
          .single()
        if (error) throw error
        setContacts((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
      } else {
        const { data, error } = await supabase
          .from('contacts')
          .update(payload)
          .eq('id', modal.id)
          .select()
          .single()
        if (error) throw error
        setContacts((p) => p.map((c) => (c.id === data.id ? data : c)))
      }
      setModal(null)
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
      console.error('[Contacts] archive:', error)
      notify.error('Impossible d\'archiver le contact : ' + error.message)
      return
    }
    setContacts((p) => p.filter((c) => c.id !== id))
  }

  // ── Sort ─────────────────────────────────────────────────────────────────
  function toggleSort(col) {
    setSort((s) =>
      s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' },
    )
  }

  // ── Filtrage + tri ────────────────────────────────────────────────────────
  const filtered = contacts
    .filter((c) => {
      const q = search.toLowerCase()
      const matchS =
        !q ||
        `${c.nom} ${c.prenom} ${c.email || ''} ${c.specialite || ''} ${c.telephone || ''}`
          .toLowerCase()
          .includes(q)
      const matchF = filter === 'tous' || c.regime === filter
      return matchS && matchF
    })
    .sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.col === 'nom')
        return dir * `${a.nom}${a.prenom}`.localeCompare(`${b.nom}${b.prenom}`, 'fr')
      if (sort.col === 'regime') return dir * (a.regime || '').localeCompare(b.regime || '', 'fr')
      if (sort.col === 'specialite')
        return dir * (a.specialite || '').localeCompare(b.specialite || '', 'fr')
      if (sort.col === 'tarif_jour_ref')
        return dir * ((Number(a.tarif_jour_ref) || 0) - (Number(b.tarif_jour_ref) || 0))
      if (sort.col === 'projets') return dir * ((projCounts[a.id] || 0) - (projCounts[b.id] || 0))
      return 0
    })

  // Compteurs par régime
  const counts = contacts.reduce((acc, c) => {
    acc[c.regime] = (acc[c.regime] || 0) + 1
    return acc
  }, {})

  const inputStyle = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
    borderRadius: 8,
    padding: '6px 10px',
    width: '100%',
    fontSize: 13,
    outline: 'none',
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Crew
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--txt-3)' }}>
            {contacts.length} personne{contacts.length !== 1 ? 's' : ''} dans la base
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Bascule grille / liste */}
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--brd)' }}
          >
            {[
              ['grid', LayoutGrid],
              ['list', List],
            ].map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="w-8 h-8 flex items-center justify-center transition-colors"
                style={
                  view === v
                    ? { background: 'var(--blue)', color: 'white' }
                    : { background: 'var(--bg-surf)', color: 'var(--txt-3)' }
                }
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--blue)', color: 'white' }}
          >
            <Plus className="w-4 h-4" /> Nouveau contact
          </button>
        </div>
      </div>

      {/* ── Barre recherche ──────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher par nom, spécialité, email, téléphone…"
          style={{ ...inputStyle, paddingLeft: 36 }}
        />
      </div>

      {/* ── Chips de filtre par régime ──────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <FilterChip
          label="Tous"
          count={contacts.length}
          active={filter === 'tous'}
          onClick={() => setFilter('tous')}
        />
        {CATS.filter((r) => counts[r] > 0).map((r) => (
          <FilterChip
            key={r}
            label={r}
            count={counts[r] || 0}
            active={filter === r}
            onClick={() => setFilter(filter === r ? 'tous' : r)}
            color={REGIME_COLORS[r]?.fg}
          />
        ))}
      </div>

      {/* ── Contenu ──────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-xl h-32 animate-pulse"
              style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Users className="w-12 h-12 mb-4" style={{ color: 'var(--txt-3)', opacity: 0.3 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--txt-3)' }}>
            {search || filter !== 'tous' ? 'Aucun résultat' : 'Aucun contact dans la base'}
          </p>
          {!search && filter === 'tous' && (
            <button
              onClick={openCreate}
              className="mt-4 text-sm font-medium"
              style={{ color: 'var(--blue)' }}
            >
              + Ajouter le premier contact
            </button>
          )}
        </div>
      ) : view === 'grid' ? (
        /* ── VUE GRILLE ─────────────────────────────────────────────────────── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => (
            <ContactCard
              key={c.id}
              contact={c}
              projCount={projCounts[c.id] || 0}
              pendingInvite={pendingInvites[c.id]}
              onEdit={() => openEdit(c)}
              onDelete={() => del(c.id)}
            />
          ))}
        </div>
      ) : (
        /* ── VUE LISTE ──────────────────────────────────────────────────────── */
        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--brd)' }}>
          {/* En-tête colonnes cliquables */}
          <div
            className="grid text-[11px] font-bold uppercase tracking-wider px-4 py-2.5"
            style={{
              gridTemplateColumns: '2fr 1.2fr 1.2fr 90px 80px 80px 60px',
              background: 'var(--bg-elev)',
              color: 'var(--txt-3)',
              borderBottom: '1px solid var(--brd)',
            }}
          >
            {[
              { col: 'nom', label: 'Nom' },
              { col: 'regime', label: 'Régime' },
              { col: 'specialite', label: 'Spécialité' },
              { col: 'tarif_jour_ref', label: 'Tarif/j' },
              { col: 'projets', label: 'Projets', center: true },
            ].map(({ col, label, center }) => (
              <button
                key={col}
                onClick={() => toggleSort(col)}
                className={`flex items-center gap-1 font-bold uppercase tracking-wider text-[11px] ${center ? 'justify-center' : ''}`}
                style={{ color: sort.col === col ? 'var(--blue)' : 'var(--txt-3)' }}
              >
                {label}
                {sort.col === col ? (
                  sort.dir === 'asc' ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )
                ) : (
                  <Minus className="w-3 h-3 opacity-30" />
                )}
              </button>
            ))}
            <span className="col-span-2" />
          </div>

          {/* Lignes */}
          {filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              projCount={projCounts[c.id] || 0}
              pendingInvite={pendingInvites[c.id]}
              onEdit={() => openEdit(c)}
              onDelete={() => del(c.id)}
            />
          ))}
        </div>
      )}

      {/* ── Modal créer / éditer ─────────────────────────────────────────────── */}
      {modal && (
        <ContactModal
          modal={modal}
          form={form}
          setForm={setForm}
          saving={saving}
          onSave={save}
          onClose={() => setModal(null)}
          profiles={profiles}
          linkedUserIds={contacts
            .filter((c) => c.user_id && (modal === 'create' || c.id !== modal.id))
            .map((c) => c.user_id)}
          pendingInvite={typeof modal === 'object' ? pendingInvites[modal.id] : null}
          onInvited={load}
          errors={errors}
          clearField={clearField}
        />
      )}
    </div>
  )
}

// ─── Carte contact (vue grille) ───────────────────────────────────────────────
function ContactCard({ contact: c, projCount, pendingInvite, onEdit, onDelete }) {
  const _col = REGIME_COLORS[c.regime] || { bg: 'var(--bg-elev)', fg: 'var(--txt-3)' }
  return (
    <div
      className="rounded-xl p-4 group relative transition-all"
      style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
    >
      {/* Actions hover */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg transition-colors"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg transition-colors"
          style={{ background: 'var(--bg-elev)', color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Avatar + identité */}
      <div className="flex items-start gap-3 mb-3">
        <Avatar nom={c.nom} prenom={c.prenom} regime={c.regime} />
        <div className="min-w-0 flex-1 pr-14">
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
            title="Ce contact est lié à un compte app"
          >
            <Link2 className="w-2.5 h-2.5" />
            Compte actif
          </span>
        )}
        {c.user_id && pendingInvite && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap inline-flex items-center gap-1"
            style={{ background: 'rgba(255,159,10,.12)', color: 'var(--orange)' }}
            title={`Invitation envoyée le ${new Date(pendingInvite.invited_at).toLocaleDateString('fr-FR')}${pendingInvite.resend_count > 0 ? ` · ${pendingInvite.resend_count} relance${pendingInvite.resend_count > 1 ? 's' : ''}` : ''}`}
          >
            <Send className="w-2.5 h-2.5" />
            En attente
          </span>
        )}
      </div>

      <div className="mt-3 space-y-1">
        {c.email && (
          <a
            href={`mailto:${c.email}`}
            className="flex items-center gap-1.5 text-xs truncate"
            style={{ color: 'var(--txt-3)' }}
          >
            <Mail className="w-3 h-3 shrink-0" />
            {c.email}
          </a>
        )}
        {c.telephone && (
          <a
            href={`tel:${c.telephone}`}
            className="flex items-center gap-1.5 text-xs"
            style={{ color: 'var(--txt-3)' }}
          >
            <Phone className="w-3 h-3 shrink-0" />
            {c.telephone}
          </a>
        )}
        {c.tarif_jour_ref && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--txt-3)' }}>
            <Euro className="w-3 h-3 shrink-0" />
            {Number(c.tarif_jour_ref).toLocaleString('fr-FR')} € / jour
          </div>
        )}
      </div>

      {/* Compteur projets */}
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

// ─── Ligne contact (vue liste) ────────────────────────────────────────────────
function ContactRow({ contact: c, projCount, pendingInvite, onEdit, onDelete }) {
  return (
    <div
      className="grid items-center px-4 py-3 group transition-colors text-sm"
      style={{
        gridTemplateColumns: '2fr 1.2fr 1.2fr 90px 80px 80px 60px',
        borderTop: '1px solid var(--brd-sub)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elev)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = '')}
    >
      {/* Nom */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Avatar nom={c.nom} prenom={c.prenom} regime={c.regime} size={8} />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--txt)' }}>
            {c.prenom} {c.nom}
          </p>
          <div className="flex items-center gap-2">
            {c.email && (
              <a
                href={`mailto:${c.email}`}
                className="text-[11px] truncate"
                style={{ color: 'var(--txt-3)' }}
              >
                {c.email}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Régime + badge compte lié */}
      <div className="flex items-center gap-1.5">
        <RegimeBadge regime={c.regime} />
        {c.user_id && !pendingInvite && (
          <span
            title="Compte app lié"
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--green-bg)', color: 'var(--green)' }}
          >
            <Link2 className="w-2.5 h-2.5" />
          </span>
        )}
        {c.user_id && pendingInvite && (
          <span
            title={`Invitation en attente (envoyée le ${new Date(pendingInvite.invited_at).toLocaleDateString('fr-FR')})`}
            className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--orange-bg)', color: 'var(--orange)' }}
          >
            <Send className="w-2.5 h-2.5" />
          </span>
        )}
      </div>

      {/* Spécialité */}
      <div className="text-xs truncate" style={{ color: 'var(--txt-2)' }}>
        {c.specialite || '—'}
      </div>

      {/* Tarif */}
      <div className="text-xs text-right font-medium" style={{ color: 'var(--txt-2)' }}>
        {c.tarif_jour_ref ? `${Number(c.tarif_jour_ref).toLocaleString('fr-FR')} €` : '—'}
      </div>

      {/* Projets */}
      <div className="flex justify-center">
        {projCount > 0 ? (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
          >
            {projCount} proj.
          </span>
        ) : (
          <span className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
            —
          </span>
        )}
      </div>

      {/* Téléphone */}
      <div className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
        {c.telephone || '—'}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: 'var(--txt-3)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── Modal créer / éditer ─────────────────────────────────────────────────────
function ContactModal({
  modal,
  form,
  setForm,
  saving,
  onSave,
  onClose,
  profiles = [],
  linkedUserIds = [],
  pendingInvite = null,
  onInvited,
  errors = {},
  clearField = () => {},
}) {
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const isCreate = modal === 'create'
  const contactId = typeof modal === 'object' ? modal.id : null

  // Users disponibles pour liaison : non liés à un autre contact, + le user actuellement lié (si édition)
  const availableProfiles = profiles.filter(
    (p) => !linkedUserIds.includes(p.id) || p.id === form.user_id,
  )

  // ch4C.2 : état pour l'invitation (email + lien)
  const [inviting, setInviting] = useState(null) // null | 'email' | 'link'
  const [inviteLink, setInviteLink] = useState(null) // URL retournée par mode='link'
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
      // Si la fonction renvoie un status non-2xx, supabase-js met l'erreur dans `error`
      // mais le body JSON (avec notre message) est dans error.context.
      if (error) {
        let detailed = error.message || 'Erreur inconnue'
        try {
          // Tente de lire le body de la réponse pour récupérer notre message
          if (error.context && typeof error.context.json === 'function') {
            const body = await error.context.json()
            if (body?.error) detailed = body.error
          } else if (error.context && typeof error.context.text === 'function') {
            const txt = await error.context.text()
            if (txt) detailed = txt
          }
        } catch {
          /* ignore — on garde le message par défaut */
        }
        throw new Error(detailed)
      }
      if (data?.error) throw new Error(data.error)

      // Succès : maj locale du form + refresh parent
      if (data?.user_id) set('user_id', data.user_id)
      if (mode === 'email') {
        notify.success(resend ? 'Invitation relancée par email !' : 'Invitation envoyée par email !')
        onInvited?.()
      } else {
        setInviteLink(data?.action_link || null)
        if (data?.action_link) {
          // Copie auto dans le presse-papier
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
      notify.error('Impossible de copier — sélectionnez et copiez à la main')
    }
  }

  const inputStyle = {
    background: 'var(--bg-elev)',
    border: '1px solid var(--brd)',
    color: 'var(--txt)',
    borderRadius: 8,
    padding: '8px 12px',
    width: '100%',
    fontSize: 13,
    outline: 'none',
  }
  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--txt-3)',
    display: 'block',
    marginBottom: 4,
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,.6)' }} /* shadows/overlays OK */
    >
      <div
        className="w-full max-w-lg flex flex-col max-h-[90vh] rounded-2xl shadow-2xl"
        style={{ background: 'var(--bg-surf)', border: '1px solid var(--brd)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: '1px solid var(--brd-sub)' }}
        >
          <div className="flex items-center gap-3">
            {!isCreate && <Avatar nom={form.nom} prenom={form.prenom} regime={form.regime} />}
            <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
              {isCreate ? 'Nouveau contact' : `${form.prenom} ${form.nom}`}
            </h3>
          </div>
          <button onClick={onClose}>
            <X className="w-4 h-4" style={{ color: 'var(--txt-3)' }} />
          </button>
        </div>

        <form onSubmit={onSave} className="overflow-y-auto flex-1 p-6 space-y-4">
          {/* Identité */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Prénom *</label>
              <input
                required
                value={form.prenom}
                onChange={(e) => set('prenom', e.target.value)}
                placeholder="Jean"
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Nom *</label>
              <input
                required
                value={form.nom}
                onChange={(e) => { set('nom', e.target.value); clearField('nom') }}
                placeholder="Dupont"
                style={inputStyle}
              />
              <FieldError error={errors.nom} />
            </div>
          </div>

          {/* Régime + spécialité */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Régime</label>
              <select
                value={form.regime}
                onChange={(e) => set('regime', e.target.value)}
                style={inputStyle}
              >
                {CATS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Spécialité / Poste</label>
              <input
                value={form.specialite}
                onChange={(e) => set('specialite', e.target.value)}
                placeholder="Chef opérateur, Monteur…"
                style={inputStyle}
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => { set('email', e.target.value); clearField('email') }}
                placeholder="jean@exemple.fr"
                style={inputStyle}
              />
              <FieldError error={errors.email} />
            </div>
            <div>
              <label style={labelStyle}>Téléphone</label>
              <input
                value={form.telephone}
                onChange={(e) => { set('telephone', e.target.value); clearField('telephone') }}
                placeholder="+33 6 00 00 00 00"
                style={inputStyle}
              />
              <FieldError error={errors.telephone} />
            </div>
          </div>

          {/* Finance */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label style={labelStyle}>Tarif jour HT (€)</label>
              <input
                type="number"
                value={form.tarif_jour_ref}
                onChange={(e) => { set('tarif_jour_ref', e.target.value); clearField('tarif_jour_ref') }}
                placeholder="350"
                min={0}
                step={5}
                style={inputStyle}
              />
              <FieldError error={errors.tarif_jour_ref} />
            </div>
            <div>
              <label style={labelStyle}>SIRET</label>
              <input
                value={form.siret}
                onChange={(e) => { set('siret', e.target.value); clearField('siret') }}
                placeholder="000 000 000 00000"
                style={inputStyle}
              />
              <FieldError error={errors.siret} />
            </div>
          </div>

          {/* TVA */}
          <TvaPicker
            value={form.default_tva}
            onChange={(v) => set('default_tva', v)}
            label="TVA par défaut · 0% pour un cachet/intermittent, 20% pour un libéral"
          />

          {/* IBAN */}
          <div>
            <label style={labelStyle}>IBAN</label>
            <input
              value={form.iban}
              onChange={(e) => set('iban', e.target.value)}
              placeholder="FR76 0000 0000 0000 0000 0000 000"
              style={inputStyle}
            />
          </div>

          {/* ── Lien compte app (ch4C.1) ──────────────────────────────────── */}
          <div>
            <label style={labelStyle}>
              <Link2 className="w-3 h-3 inline-block mr-1 -mt-0.5" />
              Compte utilisateur lié
            </label>
            <select
              value={form.user_id || ''}
              onChange={(e) => set('user_id', e.target.value || null)}
              style={inputStyle}
            >
              <option value="">— Aucun compte lié —</option>
              {availableProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || '(sans nom)'} · {p.role}
                </option>
              ))}
            </select>
            <p className="text-[11px] mt-1" style={{ color: 'var(--txt-3)' }}>
              Lier ce contact à un compte permet d&apos;afficher ses infos crew (tarif, régime) dans
              les onglets équipe et accès projet.
            </p>
          </div>

          {/* ── Invitation (ch4C.2) ─ 3 cas : nouvelle / en attente / activée ─ */}
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
                  Envoie un email d&apos;invitation OU génère un lien à partager par message /
                  WhatsApp.
                </p>
              </div>

              {/* Rôle à attribuer */}
              <div>
                <label style={labelStyle}>Rôle du compte créé</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={inputStyle}
                  disabled={Boolean(inviting)}
                >
                  <option value="prestataire">Prestataire</option>
                  <option value="coordinateur">Coordinateur</option>
                  <option value="charge_prod">Chargé de prod</option>
                </select>
              </div>

              {/* Boutons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => sendInvite('email')}
                  disabled={Boolean(inviting) || !form.email}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--blue)', color: 'white' }}
                  title={
                    !form.email
                      ? "Ajoutez un email au contact d'abord"
                      : "Envoyer un email d'invitation"
                  }
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
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    background: 'var(--bg-surf)',
                    color: 'var(--txt)',
                    border: '1px solid var(--brd)',
                  }}
                  title={
                    !form.email
                      ? "Ajoutez un email au contact d'abord"
                      : 'Générer un lien à partager'
                  }
                >
                  {inviting === 'link' ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5" />
                  )}
                  Générer un lien
                </button>
              </div>

              {/* Lien généré (mode link) */}
              {inviteLink && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium" style={{ color: 'var(--green)' }}>
                    ✓ Lien d&apos;invitation généré — copié dans le presse-papier
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      readOnly
                      value={inviteLink}
                      onClick={(e) => e.target.select()}
                      style={{ ...inputStyle, fontSize: 10, fontFamily: 'monospace' }}
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="px-2 rounded-md shrink-0"
                      style={{
                        background: 'var(--bg-surf)',
                        color: 'var(--txt-2)',
                        border: '1px solid var(--brd)',
                      }}
                      title="Copier à nouveau"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--txt-3)' }}>
                    Colle ce lien dans un message WhatsApp/SMS/email. Il expire selon la
                    configuration de ton projet Supabase (24h par défaut).
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Invitation en attente : bouton "Relancer" (ch4C.2) ───────────── */}
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
                        {' '}
                        · Dernière relance le{' '}
                        {new Date(pendingInvite.last_resent_at).toLocaleDateString('fr-FR')}
                      </>
                    )}
                    {pendingInvite.resend_count > 0 && (
                      <>
                        {' '}
                        · {pendingInvite.resend_count} relance
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
                  title="Renvoyer l'invitation par email"
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
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-opacity disabled:opacity-50"
                  style={{
                    background: 'var(--bg-surf)',
                    color: 'var(--txt)',
                    border: '1px solid var(--brd)',
                  }}
                  title="Regénérer un lien à partager"
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
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium" style={{ color: 'var(--green)' }}>
                    ✓ Nouveau lien généré — copié dans le presse-papier
                  </p>
                  <div className="flex gap-1.5">
                    <input
                      readOnly
                      value={inviteLink}
                      onClick={(e) => e.target.select()}
                      style={{ ...inputStyle, fontSize: 10, fontFamily: 'monospace' }}
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="px-2 rounded-md shrink-0"
                      style={{
                        background: 'var(--bg-surf)',
                        color: 'var(--txt-2)',
                        border: '1px solid var(--brd)',
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={labelStyle}>Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={3}
              placeholder="Disponibilités, infos utiles…"
              style={{ ...inputStyle, resize: 'none' }}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm transition-colors"
              style={{ background: 'var(--bg-elev)', color: 'var(--txt-2)' }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: 'var(--blue)', color: 'white' }}
            >
              {saving ? (
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Chip filtre ──────────────────────────────────────────────────────────────
function FilterChip({ label, count, active, onClick, color }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all"
      style={
        active
          ? { background: color || 'var(--blue)', color: 'white' }
          : {
              background: 'var(--bg-elev)',
              color: 'var(--txt-2)',
              border: '1px solid var(--brd-sub)',
            }
      }
    >
      {label}
      <span
        className="text-[10px] px-1 rounded"
        style={{
          background: active ? 'rgba(255,255,255,.25)' : 'var(--bg)',
          color: active ? 'white' : 'var(--txt-3)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

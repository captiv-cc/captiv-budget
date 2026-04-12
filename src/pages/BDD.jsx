import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { notify } from '../lib/notify'
import { useAuth } from '../contexts/AuthContext'
import { fmtEur, UNITES } from '../lib/cotisations'
import {
  Plus,
  Search,
  Trash2,
  Edit2,
  Database,
  X,
  Check,
  ChevronDown,
  ChevronRight,
  Truck,
  Mail,
  Phone,
} from 'lucide-react'
import TvaPicker from '../components/TvaPicker'

// Sous-catégories suggérées (datalist — l'utilisateur peut en saisir d'autres)
const CAT_SUGGESTIONS = [
  'Direction',
  'Production',
  'Régie',
  'Caméra',
  'Son',
  'Lumière',
  'Décor',
  'Costumes',
  'Maquillage',
  'Post-production',
  'Communication',
  'Transport',
  'Hébergement',
  'Restauration',
  'Location',
  'Autre',
]

const FOURN_TYPES = [
  'Matériel',
  'Logistique',
  'Postprod',
  'Catering',
  'Transport',
  'Hébergement',
  'Autre',
]

const EMPTY = {
  ref: '',
  categorie: '',
  produit: '',
  description: '',
  unite: 'J',
  tarif_defaut: '',
  notes: '',
  actif: true,
}

const FOURN_EMPTY = {
  nom: '',
  type: '',
  siret: '',
  email: '',
  phone: '',
  notes: '',
  default_tva: 20,
}

export default function BDD() {
  const { org } = useAuth()
  const [produits, setProduits] = useState([])
  const [grilleCC, setGrilleCC] = useState([])
  const [fournisseurs, setFournisseurs] = useState([])
  const [fournUsage, setFournUsage] = useState({}) // { fournisseur_id: count }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState('catalogue')
  const [modal, setModal] = useState(null) // null | 'create' | item
  const [form, setForm] = useState(EMPTY)
  const [fournModal, setFournModal] = useState(null) // null | 'create' | item
  const [fournForm, setFournForm] = useState(FOURN_EMPTY)
  const [collapsed, setCollapsed] = useState({})

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [prodsRes, grilleRes, fournsRes, usageRes] =
      await Promise.all([
        supabase
          .from('produits_bdd')
          .select('*')
          .eq('org_id', org.id)
          .order('categorie')
          .order('produit'),
        supabase.from('grille_cc').select('*').order('type_contrat').order('intitule'),
        supabase.from('fournisseurs').select('*').order('nom'),
        supabase.from('devis_lines').select('fournisseur_id').not('fournisseur_id', 'is', null),
      ])
    if (prodsRes.error) console.error('[BDD] load produits:', prodsRes.error)
    if (grilleRes.error) console.error('[BDD] load grille:', grilleRes.error)
    if (fournsRes.error) console.error('[BDD] load fournisseurs:', fournsRes.error)
    setProduits(prodsRes.data || [])
    setGrilleCC(grilleRes.data || [])
    setFournisseurs(fournsRes.data || [])
    const usage = {}
    for (const r of usageRes.data || []) {
      usage[r.fournisseur_id] = (usage[r.fournisseur_id] || 0) + 1
    }
    setFournUsage(usage)
    setLoading(false)
  }, [org?.id])

  useEffect(() => {
    if (org?.id) loadAll()
  }, [org?.id, loadAll])

  // ── CRUD ─────────────────────────────────────────────────────────────────
  async function save(e) {
    e.preventDefault()
    const { id: _id, regime: _r, grille_cc_j: _g, ...rest } = form // on écarte les anciens champs
    const payload = {
      ...rest,
      regime: form.regime || 'Externe', // garde la colonne pour compat ProduitAutocomplete
      tarif_defaut: form.tarif_defaut !== '' ? parseFloat(form.tarif_defaut) || null : null,
      org_id: org.id,
    }
    if (modal === 'create') {
      const { data, error } = await supabase.from('produits_bdd').insert(payload).select().single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data)
        setProduits((p) =>
          [...p, data].sort(
            (a, b) =>
              (a.categorie || '').localeCompare(b.categorie || '') ||
              a.produit.localeCompare(b.produit),
          ),
        )
    } else {
      const { data, error } = await supabase
        .from('produits_bdd')
        .update(payload)
        .eq('id', modal.id)
        .select()
        .single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data) setProduits((p) => p.map((x) => (x.id === data.id ? data : x)))
    }
    setModal(null)
  }

  async function del(id) {
    if (!confirm('Supprimer cette ligne ?')) return
    const { error } = await supabase.from('produits_bdd').delete().eq('id', id)
    if (error) {
      console.error('[BDD] delete produit:', error)
      notify.error('Impossible de supprimer : ' + error.message)
      return
    }
    setProduits((p) => p.filter((x) => x.id !== id))
  }

  async function toggleActif(item) {
    const newActif = !item.actif
    const { data, error } = await supabase
      .from('produits_bdd')
      .update({ actif: newActif })
      .eq('id', item.id)
      .select()
      .single()
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    if (data) setProduits((p) => p.map((x) => (x.id === data.id ? data : x)))
  }

  // ── Fournisseurs CRUD ────────────────────────────────────────────────────
  async function saveFourn(e) {
    e.preventDefault()
    const { id: _id, ...rest } = fournForm
    const payload = {
      nom: (rest.nom || '').trim(),
      type: rest.type || null,
      siret: rest.siret || null,
      email: rest.email || null,
      phone: rest.phone || null,
      notes: rest.notes || null,
      default_tva: Number(rest.default_tva ?? 20),
    }
    if (!payload.nom) {
      notify.warn('Le nom est obligatoire.')
      return
    }
    if (fournModal === 'create') {
      const { data, error } = await supabase.from('fournisseurs').insert(payload).select().single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data) setFournisseurs((p) => [...p, data].sort((a, b) => a.nom.localeCompare(b.nom)))
    } else {
      const { data, error } = await supabase
        .from('fournisseurs')
        .update(payload)
        .eq('id', fournModal.id)
        .select()
        .single()
      if (error) {
        notify.error(`Erreur : ${error.message}`)
        return
      }
      if (data)
        setFournisseurs((p) =>
          p.map((x) => (x.id === data.id ? data : x)).sort((a, b) => a.nom.localeCompare(b.nom)),
        )
    }
    setFournModal(null)
  }

  async function delFourn(f) {
    const count = fournUsage[f.id] || 0
    const msg =
      count > 0
        ? `Supprimer "${f.nom}" ?\n\n⚠ Ce fournisseur est utilisé sur ${count} ligne${count > 1 ? 's' : ''} de devis.\nLes lignes ne seront pas supprimées, mais leur lien fournisseur sera vidé.`
        : `Supprimer "${f.nom}" ?`
    if (!confirm(msg)) return
    const { error } = await supabase.from('fournisseurs').delete().eq('id', f.id)
    if (error) {
      notify.error(`Erreur : ${error.message}`)
      return
    }
    setFournisseurs((p) => p.filter((x) => x.id !== f.id))
    setFournUsage((u) => {
      const n = { ...u }
      delete n[f.id]
      return n
    })
  }

  // ── Filtres & regroupement par sous-catégorie ────────────────────────────
  const sq = search.toLowerCase()
  const filtered = produits.filter(
    (p) =>
      !sq ||
      p.produit?.toLowerCase().includes(sq) ||
      p.categorie?.toLowerCase().includes(sq) ||
      p.description?.toLowerCase().includes(sq) ||
      p.notes?.toLowerCase().includes(sq),
  )

  // Grouper par catégorie (ordre alpha, vide en dernier)
  const byCat = filtered.reduce((acc, p) => {
    const k = p.categorie?.trim() || ''
    if (!acc[k]) acc[k] = []
    acc[k].push(p)
    return acc
  }, {})

  const cats = Object.keys(byCat).sort((a, b) => {
    if (a === '' && b !== '') return 1
    if (a !== '' && b === '') return -1
    return a.localeCompare(b)
  })

  const grilleByType = grilleCC
    .filter(
      (g) =>
        !sq || g.intitule?.toLowerCase().includes(sq) || g.type_contrat?.toLowerCase().includes(sq),
    )
    .reduce((acc, g) => {
      const key = g.type_contrat || 'Autre'
      if (!acc[key]) acc[key] = []
      acc[key].push(g)
      return acc
    }, {})

  const totalActive = produits.length

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--txt)' }}>
            Catalogue
          </h1>
          <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
            {totalActive} poste{totalActive !== 1 ? 's' : ''} · régime et bloc choisis à
            l&apos;ajout dans le devis
          </p>
        </div>
        {tab === 'catalogue' && (
          <button
            onClick={() => {
              setForm(EMPTY)
              setModal('create')
            }}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Nouveau poste
          </button>
        )}
        {tab === 'fournisseurs' && (
          <button
            onClick={() => {
              setFournForm(FOURN_EMPTY)
              setFournModal('create')
            }}
            className="btn-primary btn-sm"
          >
            <Plus className="w-3.5 h-3.5" /> Nouveau fournisseur
          </button>
        )}
      </div>

      {/* Tabs */}
      <div
        className="flex gap-1 mb-5 p-1 rounded-xl w-fit"
        style={{ background: 'var(--bg-elev)' }}
      >
        {[
          ['catalogue', 'Postes & prestations'],
          ['fournisseurs', 'Fournisseurs'],
          ['grille', 'Grille CC Audiovisuelle'],
        ].map(([val, lbl]) => (
          <button
            key={val}
            onClick={() => setTab(val)}
            className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
            style={
              tab === val
                ? {
                    background: 'var(--bg-surf)',
                    color: 'var(--txt)',
                    boxShadow: '0 1px 4px rgba(0,0,0,.3)',
                  }
                : { color: 'var(--txt-3)' }
            }
          >
            {lbl}
          </button>
        ))}
      </div>

      {/* Recherche */}
      <div className="relative mb-5">
        <Search
          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--txt-3)' }}
        />
        <input
          className="input pl-9 w-full"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher un poste, une prestation…"
        />
      </div>

      {/* ── Catalogue ────────────────────────────────────────────────────────── */}
      {tab === 'catalogue' && (
        <div className="space-y-3">
          {loading && (
            <div className="rounded-xl p-10 text-center" style={{ border: '1px solid var(--brd)' }}>
              <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                Chargement…
              </p>
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div
              className="rounded-xl p-16 text-center"
              style={{ border: '1px dashed var(--brd)' }}
            >
              <Database className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
                {search ? 'Aucun résultat' : 'Catalogue vide'}
              </p>
              <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>
                {search
                  ? 'Essayez un autre terme ou ajoutez ce poste au catalogue'
                  : 'Ajoutez vos postes habituels — ils seront proposés à la création de devis'}
              </p>
              {!search && (
                <button
                  onClick={() => {
                    setForm(EMPTY)
                    setModal('create')
                  }}
                  className="btn-primary btn-sm"
                >
                  <Plus className="w-3.5 h-3.5" /> Premier poste
                </button>
              )}
            </div>
          )}

          {cats.map((cat) => {
            const lines = [...(byCat[cat] || [])].sort(
              (a, b) => (b.actif ? 1 : 0) - (a.actif ? 1 : 0) || a.produit.localeCompare(b.produit),
            )
            const isCollapsed = collapsed[cat]

            return (
              <div
                key={cat || '__sans_cat'}
                className="rounded-xl overflow-hidden"
                style={{ border: '1px solid var(--brd)' }}
              >
                {/* En-tête sous-catégorie */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                  style={{ background: 'var(--bg-elev)', borderLeft: '4px solid var(--blue)' }}
                  onClick={() => setCollapsed((p) => ({ ...p, [cat]: !p[cat] }))}
                >
                  {isCollapsed ? (
                    <ChevronRight
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: 'var(--txt-3)' }}
                    />
                  ) : (
                    <ChevronDown
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: 'var(--txt-3)' }}
                    />
                  )}
                  <span
                    className="text-xs font-bold uppercase tracking-wider flex-1"
                    style={{ color: cat ? 'var(--blue)' : 'var(--txt-3)' }}
                  >
                    {cat || 'Sans catégorie'}
                  </span>
                  <span className="text-xs mr-2" style={{ color: 'var(--txt-3)' }}>
                    {lines.length} poste{lines.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setForm({ ...EMPTY, categorie: cat })
                      setModal('create')
                    }}
                    className="btn-ghost btn-sm"
                    style={{ color: 'var(--txt-3)' }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--blue)')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                    title="Ajouter un poste dans cette catégorie"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {!isCollapsed && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr
                        className="text-[11px] font-semibold uppercase"
                        style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd-sub)' }}
                      >
                        <th className="px-4 py-2 text-left">Intitulé</th>
                        <th className="px-4 py-2 text-left">Description devis</th>
                        <th className="px-4 py-2 text-center">Unité</th>
                        <th className="px-4 py-2 text-right">Tarif indicatif</th>
                        <th className="px-4 py-2 text-center w-10" title="Actif">
                          ✓
                        </th>
                        <th className="px-4 py-2 w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr
                          key={line.id}
                          className="group transition-colors"
                          style={{
                            borderBottom: '1px solid var(--brd-sub)',
                            opacity: line.actif ? 1 : 0.38,
                          }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = 'var(--bg-elev)')
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-sm" style={{ color: 'var(--txt)' }}>
                              {line.produit}
                            </p>
                            {line.ref && (
                              <p className="text-[11px]" style={{ color: 'var(--txt-3)' }}>
                                #{line.ref}
                              </p>
                            )}
                          </td>
                          <td className="px-4 py-2.5" style={{ maxWidth: 260 }}>
                            {line.description ? (
                              <p className="text-xs" style={{ color: 'var(--txt-2)' }}>
                                {line.description}
                              </p>
                            ) : (
                              <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                                —
                              </span>
                            )}
                            {line.notes && (
                              <p
                                className="text-[11px] italic mt-0.5"
                                style={{ color: 'var(--txt-3)' }}
                              >
                                {line.notes}
                              </p>
                            )}
                          </td>
                          <td
                            className="px-4 py-2.5 text-center text-xs"
                            style={{ color: 'var(--txt-3)' }}
                          >
                            {line.unite}
                          </td>
                          <td
                            className="px-4 py-2.5 text-right text-sm font-semibold"
                            style={{ color: line.tarif_defaut ? 'var(--txt)' : 'var(--txt-3)' }}
                          >
                            {line.tarif_defaut ? fmtEur(line.tarif_defaut) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => toggleActif(line)}
                              className="w-5 h-5 rounded flex items-center justify-center mx-auto transition-all"
                              style={{
                                background: line.actif ? 'var(--green)' : 'transparent',
                                border: `1.5px solid ${line.actif ? 'var(--green)' : 'var(--brd)'}`,
                              }}
                              title={line.actif ? 'Archiver' : 'Réactiver'}
                            >
                              {line.actif && <Check className="w-3 h-3 text-white" />}
                            </button>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => {
                                  setForm({
                                    ...EMPTY,
                                    ...line,
                                    tarif_defaut: line.tarif_defaut ?? '',
                                  })
                                  setModal(line)
                                }}
                                className="btn-ghost btn-sm"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => del(line.id)}
                                className="btn-ghost btn-sm"
                                style={{ color: 'var(--txt-3)' }}
                                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--red)')}
                                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt-3)')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Fournisseurs ───────────────────────────────────────────────────── */}
      {tab === 'fournisseurs' &&
        (() => {
          const fq = search.toLowerCase()
          const fFiltered = fournisseurs.filter(
            (f) =>
              !fq ||
              f.nom?.toLowerCase().includes(fq) ||
              f.type?.toLowerCase().includes(fq) ||
              f.email?.toLowerCase().includes(fq) ||
              f.phone?.toLowerCase().includes(fq) ||
              f.notes?.toLowerCase().includes(fq),
          )
          // Grouper par type
          const byType = fFiltered.reduce((acc, f) => {
            const k = f.type?.trim() || ''
            if (!acc[k]) acc[k] = []
            acc[k].push(f)
            return acc
          }, {})
          const types = Object.keys(byType).sort((a, b) => {
            if (a === '' && b !== '') return 1
            if (a !== '' && b === '') return -1
            return a.localeCompare(b)
          })

          return (
            <div className="space-y-3">
              {loading && (
                <div
                  className="rounded-xl p-10 text-center"
                  style={{ border: '1px solid var(--brd)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--txt-3)' }}>
                    Chargement…
                  </p>
                </div>
              )}

              {!loading && fFiltered.length === 0 && (
                <div
                  className="rounded-xl p-16 text-center"
                  style={{ border: '1px dashed var(--brd)' }}
                >
                  <Truck className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--txt-3)' }} />
                  <p className="text-sm font-medium mb-1" style={{ color: 'var(--txt-2)' }}>
                    {search ? 'Aucun résultat' : 'Aucun fournisseur'}
                  </p>
                  <p className="text-xs mb-4" style={{ color: 'var(--txt-3)' }}>
                    {search
                      ? 'Essayez un autre terme ou ajoutez ce fournisseur'
                      : 'Ajoutez vos fournisseurs habituels — ils seront proposés dans le budget réel'}
                  </p>
                  {!search && (
                    <button
                      onClick={() => {
                        setFournForm(FOURN_EMPTY)
                        setFournModal('create')
                      }}
                      className="btn-primary btn-sm"
                    >
                      <Plus className="w-3.5 h-3.5" /> Premier fournisseur
                    </button>
                  )}
                </div>
              )}

              {types.map((type) => {
                const items = byType[type]
                return (
                  <div
                    key={type || '__sans_type'}
                    className="rounded-xl overflow-hidden"
                    style={{ border: '1px solid var(--brd)' }}
                  >
                    <div
                      className="flex items-center gap-3 px-4 py-3"
                      style={{
                        background: 'var(--bg-elev)',
                        borderLeft: '4px solid var(--purple)',
                      }}
                    >
                      <span
                        className="text-xs font-bold uppercase tracking-wider flex-1"
                        style={{ color: type ? 'var(--purple)' : 'var(--txt-3)' }}
                      >
                        {type || 'Sans type'}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                        {items.length} fournisseur{items.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr
                          className="text-[11px] font-semibold uppercase"
                          style={{
                            color: 'var(--txt-3)',
                            borderBottom: '1px solid var(--brd-sub)',
                          }}
                        >
                          <th className="px-4 py-2 text-left">Nom</th>
                          <th className="px-4 py-2 text-left">Contact</th>
                          <th className="px-4 py-2 text-left">SIRET</th>
                          <th className="px-4 py-2 w-16"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((f) => {
                          return (
                            <tr
                              key={f.id}
                              className="group transition-colors"
                              style={{ borderBottom: '1px solid var(--brd-sub)' }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.background = 'var(--bg-elev)')
                              }
                              onMouseLeave={(e) =>
                                (e.currentTarget.style.background = 'transparent')
                              }
                            >
                              <td className="px-4 py-2.5">
                                <p className="font-medium text-sm" style={{ color: 'var(--txt)' }}>
                                  {f.nom}
                                </p>
                                {f.notes && (
                                  <p
                                    className="text-[11px] italic mt-0.5"
                                    style={{ color: 'var(--txt-3)' }}
                                  >
                                    {f.notes}
                                  </p>
                                )}
                              </td>
                              <td className="px-4 py-2.5">
                                {f.email && (
                                  <div
                                    className="flex items-center gap-1.5 text-xs"
                                    style={{ color: 'var(--txt-2)' }}
                                  >
                                    <Mail className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                                    {f.email}
                                  </div>
                                )}
                                {f.phone && (
                                  <div
                                    className="flex items-center gap-1.5 text-xs mt-0.5"
                                    style={{ color: 'var(--txt-2)' }}
                                  >
                                    <Phone className="w-3 h-3" style={{ color: 'var(--txt-3)' }} />
                                    {f.phone}
                                  </div>
                                )}
                                {!f.email && !f.phone && (
                                  <span className="text-xs" style={{ color: 'var(--txt-3)' }}>
                                    —
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--txt-3)' }}>
                                {f.siret || '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      setFournForm({ ...FOURN_EMPTY, ...f })
                                      setFournModal(f)
                                    }}
                                    className="btn-ghost btn-sm"
                                  >
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => delFourn(f)}
                                    className="btn-ghost btn-sm"
                                    style={{ color: 'var(--txt-3)' }}
                                    onMouseEnter={(e) =>
                                      (e.currentTarget.style.color = 'var(--red)')
                                    }
                                    onMouseLeave={(e) =>
                                      (e.currentTarget.style.color = 'var(--txt-3)')
                                    }
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              })}
            </div>
          )
        })()}

      {/* ── Grille CC ──────────────────────────────────────────────────────── */}
      {tab === 'grille' && (
        <div className="space-y-4">
          {Object.keys(grilleByType).length === 0 && (
            <p className="text-sm text-center py-10" style={{ color: 'var(--txt-3)' }}>
              Aucune donnée
            </p>
          )}
          {Object.entries(grilleByType).map(([type, items]) => (
            <div
              key={type}
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--brd)' }}
            >
              <div
                className="px-4 py-2.5 text-xs font-bold uppercase tracking-wider"
                style={{
                  background: 'var(--bg-elev)',
                  color: 'var(--txt-2)',
                  borderBottom: '1px solid var(--brd-sub)',
                }}
              >
                {type}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="text-[11px] font-semibold uppercase"
                    style={{ color: 'var(--txt-3)', borderBottom: '1px solid var(--brd-sub)' }}
                  >
                    <th className="px-4 py-2 text-left">Intitulé</th>
                    <th className="px-4 py-2 text-center">Filière</th>
                    <th className="px-4 py-2 text-center">Niveau</th>
                    <th className="px-4 py-2 text-right">Journée min (€)</th>
                    <th className="px-4 py-2 text-right">Semaine min (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((g) => (
                    <tr key={g.id} style={{ borderBottom: '1px solid var(--brd-sub)' }}>
                      <td className="px-4 py-2 font-medium" style={{ color: 'var(--txt)' }}>
                        {g.intitule}
                      </td>
                      <td
                        className="px-4 py-2 text-center text-xs"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {g.filiere || '—'}
                      </td>
                      <td
                        className="px-4 py-2 text-center text-xs"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {g.niveau || '—'}
                      </td>
                      <td
                        className="px-4 py-2 text-right font-semibold"
                        style={{ color: 'var(--green)' }}
                      >
                        {g.journee_min ? (
                          fmtEur(g.journee_min)
                        ) : (
                          <span className="text-xs italic" style={{ color: 'var(--txt-3)' }}>
                            Gré à gré
                          </span>
                        )}
                      </td>
                      <td
                        className="px-4 py-2 text-right text-xs"
                        style={{ color: 'var(--txt-3)' }}
                      >
                        {g.semaine_min ? fmtEur(g.semaine_min) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* ── Modal ──────────────────────────────────────────────────────────── */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null)
          }}
        >
          <div
            className="rounded-2xl w-full max-w-md"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              boxShadow: '0 24px 80px rgba(0,0,0,.8)',
            }}
          >
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
                {modal === 'create' ? 'Nouveau poste' : 'Modifier'}
              </h3>
              <button onClick={() => setModal(null)} style={{ color: 'var(--txt-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={save} className="p-6 space-y-4">
              {/* Intitulé */}
              <div>
                <label className="label">Intitulé *</label>
                <input
                  className="input w-full"
                  required
                  autoFocus
                  value={form.produit}
                  onChange={(e) => setForm((f) => ({ ...f, produit: e.target.value }))}
                  placeholder="Ex : Directeur de production, Location caméra…"
                />
              </div>

              {/* Sous-catégorie */}
              <div>
                <label className="label">
                  Sous-catégorie
                  <span className="ml-1 font-normal" style={{ color: 'var(--txt-3)' }}>
                    (pour regrouper)
                  </span>
                </label>
                <input
                  className="input w-full"
                  list="cat-suggestions"
                  value={form.categorie}
                  onChange={(e) => setForm((f) => ({ ...f, categorie: e.target.value }))}
                  placeholder="Ex : Direction, Caméra, Transport…"
                />
                <datalist id="cat-suggestions">
                  {CAT_SUGGESTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              {/* Description → recopiée dans la ligne devis */}
              <div>
                <label className="label">
                  Description devis
                  <span
                    className="ml-1.5 text-[11px] font-normal px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}
                  >
                    pré-remplie dans la ligne
                  </span>
                </label>
                <textarea
                  className="input w-full resize-none"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Ce texte sera automatiquement copié dans la colonne Description du devis…"
                />
              </div>

              {/* Unité + Tarif indicatif */}
              <div className="flex gap-3">
                <div className="w-28">
                  <label className="label">Unité par défaut</label>
                  <select
                    className="input w-full"
                    value={form.unite}
                    onChange={(e) => setForm((f) => ({ ...f, unite: e.target.value }))}
                  >
                    {UNITES.map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="label">
                    Tarif indicatif HT (€){' '}
                    <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                      (optionnel)
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input w-full text-right"
                    min={0}
                    step={0.01}
                    value={form.tarif_defaut}
                    onChange={(e) => setForm((f) => ({ ...f, tarif_defaut: e.target.value }))}
                    placeholder="Point de départ"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="label">
                  Notes{' '}
                  <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                    (fournisseur, conditions…)
                  </span>
                </label>
                <input
                  className="input w-full"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModal(null)} className="btn-secondary">
                  Annuler
                </button>
                <button type="submit" className="btn-primary">
                  <Check className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Fournisseur ──────────────────────────────────────────────── */}
      {fournModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,.7)', backdropFilter: 'blur(4px)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setFournModal(null)
          }}
        >
          <div
            className="rounded-2xl w-full max-w-md"
            style={{
              background: 'var(--bg-surf)',
              border: '1px solid var(--brd)',
              boxShadow: '0 24px 80px rgba(0,0,0,.8)',
            }}
          >
            <div
              className="flex items-center justify-between px-6 py-4"
              style={{ borderBottom: '1px solid var(--brd-sub)' }}
            >
              <h3 className="font-semibold text-sm" style={{ color: 'var(--txt)' }}>
                {fournModal === 'create' ? 'Nouveau fournisseur' : 'Modifier le fournisseur'}
              </h3>
              <button onClick={() => setFournModal(null)} style={{ color: 'var(--txt-3)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={saveFourn} className="p-6 space-y-4">
              <div>
                <label className="label">Nom *</label>
                <input
                  className="input w-full"
                  required
                  autoFocus
                  value={fournForm.nom}
                  onChange={(e) => setFournForm((f) => ({ ...f, nom: e.target.value }))}
                  placeholder="Ex : CINECOM, Panavision…"
                />
              </div>

              <div>
                <label className="label">
                  Type{' '}
                  <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                    (optionnel)
                  </span>
                </label>
                <input
                  className="input w-full"
                  list="fourn-types"
                  value={fournForm.type || ''}
                  onChange={(e) => setFournForm((f) => ({ ...f, type: e.target.value }))}
                  placeholder="Ex : Matériel, Logistique, Postprod…"
                />
                <datalist id="fourn-types">
                  {FOURN_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="label">Email</label>
                  <input
                    type="email"
                    className="input w-full"
                    value={fournForm.email || ''}
                    onChange={(e) => setFournForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="contact@…"
                  />
                </div>
                <div className="flex-1">
                  <label className="label">Téléphone</label>
                  <input
                    className="input w-full"
                    value={fournForm.phone || ''}
                    onChange={(e) => setFournForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="06…"
                  />
                </div>
              </div>

              <div>
                <label className="label">
                  SIRET{' '}
                  <span className="font-normal" style={{ color: 'var(--txt-3)' }}>
                    (optionnel)
                  </span>
                </label>
                <input
                  className="input w-full"
                  value={fournForm.siret || ''}
                  onChange={(e) => setFournForm((f) => ({ ...f, siret: e.target.value }))}
                  placeholder="14 chiffres"
                />
              </div>

              <TvaPicker
                value={fournForm.default_tva}
                onChange={(v) => setFournForm((f) => ({ ...f, default_tva: v }))}
                label="TVA par défaut · 20% pour la majorité, 0% si étranger / exonéré"
              />

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input w-full resize-none"
                  rows={2}
                  value={fournForm.notes || ''}
                  onChange={(e) => setFournForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Conditions, contact privilégié…"
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setFournModal(null)} className="btn-secondary">
                  Annuler
                </button>
                <button type="submit" className="btn-primary">
                  <Check className="w-4 h-4" /> Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
